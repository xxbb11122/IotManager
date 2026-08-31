[CmdletBinding()]
param(
    [string]$ProjectName = 'iot-manager-p0',
    [string]$EnvironmentFile = 'deploy/.env.integration',
    [string]$StateFile = 'deploy/.runtime/iot-manager-p0/runtime.env',
    [string]$BaseUrl = 'https://iot-manager.localhost',
    [int]$TimeoutSeconds = 240,
    [switch]$Observability
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Resolve-RepositoryPath {
    param([string]$Path)
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    return Join-Path $repositoryRoot $Path
}

$environmentPath = Resolve-RepositoryPath $EnvironmentFile
$statePath = Resolve-RepositoryPath $StateFile
if (-not (Test-Path -LiteralPath $environmentPath)) { throw "Environment file was not found: $environmentPath" }
$observabilityEnabled = $Observability.IsPresent
if ($env:IOT_ENABLE_OBSERVABILITY) {
    if ($env:IOT_ENABLE_OBSERVABILITY -notin @('true', 'false')) {
        throw 'IOT_ENABLE_OBSERVABILITY must be true or false.'
    }
    $observabilityEnabled = $observabilityEnabled -or $env:IOT_ENABLE_OBSERVABILITY -eq 'true'
}

function Get-ComposeArguments {
    $args = @('compose', '--project-name', $ProjectName, '--profile', 'application')
    if ($observabilityEnabled) { $args += @('--profile', 'observability') }
    $args += @('--env-file', $environmentPath)
    if (Test-Path -LiteralPath $statePath) { $args += @('--env-file', $statePath) }
    $args += @('-f', (Join-Path $repositoryRoot 'deploy/docker-compose.yml'), '-f', (Join-Path $repositoryRoot 'deploy/docker-compose.integration.yml'))
    return $args
}

function Invoke-Docker {
    param([string[]]$Arguments, [string]$Description)
    # Docker Desktop may write informational host warnings to STDERR while
    # returning success. Under ErrorActionPreference=Stop, PowerShell 5.1
    # turns that into NativeCommandError before the exit code can be checked.
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $result = & docker @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) { throw "$Description failed with exit code ${exitCode}: $result" }
    return $result
}

function Get-ServiceContainerId {
    param([string]$Service)
    $args = (Get-ComposeArguments) + @('ps', '-q', $Service)
    $id = (Invoke-Docker -Arguments $args -Description "Resolve container for $Service" | Out-String).Trim()
    if (-not $id) { throw "Service is not running: $Service" }
    return $id
}

function Get-ContainerHealth {
    param([string]$ContainerId)
    return (Invoke-Docker -Arguments @('inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', $ContainerId) -Description "Inspect health for $ContainerId" | Out-String).Trim()
}

function Get-HttpStatus {
    param([string]$Url, [string]$CaCertificate, [string]$OutputPath)
    $status = & curl.exe --silent --show-error --ssl-no-revoke --output $OutputPath --write-out '%{http_code}' --cacert $CaCertificate $Url
    if ($LASTEXITCODE -ne 0) { throw "HTTP request failed: $Url" }
    return $status.Trim()
}

function Get-EnvironmentValue {
    param([string]$Key)
    $pattern = '^\s*' + [regex]::Escape($Key) + '=(.*)$'
    $line = Get-Content -LiteralPath $environmentPath -Encoding UTF8 |
        Where-Object { $_ -match $pattern } |
        Select-Object -Last 1
    if (-not $line) { throw "Required value was not found in the environment file: $Key" }
    $null = $line -match $pattern
    $value = $Matches[1].Trim()
    if (-not $value) { throw "Required value is empty in the environment file: $Key" }
    return $value
}

Invoke-Docker -Arguments @('info') -Description 'Docker Engine check' | Out-Null
$compose = Get-ComposeArguments
$artifacts = Join-Path $repositoryRoot ("artifacts/p0-runtime/{0}" -f (Get-Date -Format 'yyyyMMddTHHmmssZ'))
[System.IO.Directory]::CreateDirectory($artifacts) | Out-Null

$services = @('postgres', 'keycloak', 'caddy', 'backend', 'backup', 'wal-g-archive', 'wal-g-backup')
if ($observabilityEnabled) { $services += @('alertmanager', 'prometheus') }
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
    $unhealthy = @()
    foreach ($service in $services) {
        try {
            $id = Get-ServiceContainerId -Service $service
            if ((Get-ContainerHealth -ContainerId $id) -ne 'healthy') { $unhealthy += $service }
        }
        catch { $unhealthy += $service }
    }
    if ($unhealthy.Count -eq 0) { break }
    Start-Sleep -Seconds 3
} while ((Get-Date) -lt $deadline)
if ($unhealthy.Count -gt 0) { throw "Timed out waiting for healthy services: $($unhealthy -join ', ')" }

foreach ($service in $services) {
    $id = Get-ServiceContainerId -Service $service
    $published = (& docker port $id 2>$null | Out-String).Trim()
    if ($service -ne 'caddy' -and $published) { throw "Internal service unexpectedly publishes host ports: $service -> $published" }
}

$caCertificate = Join-Path $artifacts 'caddy-integration-root.crt'
Invoke-Docker -Arguments ($compose + @('cp', "caddy`:/data/caddy/pki/authorities/local/root.crt", $caCertificate)) -Description 'Export Caddy integration CA' | Out-Null

$discoveryPath = Join-Path $artifacts 'openid-configuration.json'
if ((Get-HttpStatus -Url "$BaseUrl/auth/realms/iot-manager/.well-known/openid-configuration" -CaCertificate $caCertificate -OutputPath $discoveryPath) -ne '200') {
    throw 'Keycloak discovery endpoint did not return HTTP 200 through Caddy.'
}

$apiPath = Join-Path $artifacts 'unauthenticated-api.txt'
if ((Get-HttpStatus -Url "$BaseUrl/api/v1/devices" -CaCertificate $caCertificate -OutputPath $apiPath) -ne '401') {
    throw 'Unauthenticated API request did not return HTTP 401.'
}

$h2Path = Join-Path $artifacts 'h2-console.txt'
if ((Get-HttpStatus -Url "$BaseUrl/h2-console" -CaCertificate $caCertificate -OutputPath $h2Path) -ne '404') {
    throw 'Production H2 console route did not return HTTP 404.'
}

$publicMetricsPath = Join-Path $artifacts 'public-prometheus.txt'
if ((Get-HttpStatus -Url "$BaseUrl/actuator/prometheus" -CaCertificate $caCertificate -OutputPath $publicMetricsPath) -ne '404') {
    throw 'Public Prometheus route did not return HTTP 404.'
}

$baseUri = [Uri]$BaseUrl
$httpUrl = "http://$($baseUri.Host)/"
$redirectHeadersPath = Join-Path $artifacts 'http-redirect-headers.txt'
$redirectBodyPath = Join-Path $artifacts 'http-redirect-body.txt'
$redirectStatus = & curl.exe --silent --show-error --max-redirs 0 --dump-header $redirectHeadersPath --output $redirectBodyPath --write-out '%{http_code}' $httpUrl
if ($LASTEXITCODE -ne 0) { throw "HTTP redirect request failed: $httpUrl" }
if ($redirectStatus.Trim() -ne '308') { throw "HTTP endpoint did not return the expected 308 redirect; received $($redirectStatus.Trim())." }
$redirectHeaders = Get-Content -LiteralPath $redirectHeadersPath -Raw -Encoding UTF8
if ($redirectHeaders -notmatch ('(?im)^location:\s*' + [regex]::Escape("$BaseUrl/"))) {
    throw "HTTP endpoint did not redirect to the expected HTTPS origin: $BaseUrl"
}

$allowedOrigin = Get-EnvironmentValue -Key 'IOT_WEB_ORIGIN'
$allowedCorsHeadersPath = Join-Path $artifacts 'cors-allowed-headers.txt'
$allowedCorsBodyPath = Join-Path $artifacts 'cors-allowed-body.txt'
$allowedCorsStatus = & curl.exe --silent --show-error --ssl-no-revoke --request OPTIONS --header "Origin: $allowedOrigin" --header 'Access-Control-Request-Method: GET' --dump-header $allowedCorsHeadersPath --output $allowedCorsBodyPath --write-out '%{http_code}' --cacert $caCertificate "$BaseUrl/api/v1/devices"
if ($LASTEXITCODE -ne 0) { throw 'Allowed-origin CORS preflight request failed.' }
$allowedCorsHeaders = Get-Content -LiteralPath $allowedCorsHeadersPath -Raw -Encoding UTF8
if ($allowedCorsStatus.Trim() -match '^5') { throw "Allowed-origin CORS preflight returned server error: $($allowedCorsStatus.Trim())" }
if ($allowedCorsHeaders -notmatch ('(?im)^access-control-allow-origin:\s*' + [regex]::Escape($allowedOrigin) + '\s*$')) {
    throw "Allowed-origin CORS preflight did not return the configured origin: $allowedOrigin"
}

$rejectedOrigin = 'https://untrusted-origin.invalid'
$rejectedCorsHeadersPath = Join-Path $artifacts 'cors-rejected-headers.txt'
$rejectedCorsBodyPath = Join-Path $artifacts 'cors-rejected-body.txt'
$rejectedCorsStatus = & curl.exe --silent --show-error --ssl-no-revoke --request OPTIONS --header "Origin: $rejectedOrigin" --header 'Access-Control-Request-Method: GET' --dump-header $rejectedCorsHeadersPath --output $rejectedCorsBodyPath --write-out '%{http_code}' --cacert $caCertificate "$BaseUrl/api/v1/devices"
if ($LASTEXITCODE -ne 0) { throw 'Rejected-origin CORS preflight request failed.' }
$rejectedCorsHeaders = Get-Content -LiteralPath $rejectedCorsHeadersPath -Raw -Encoding UTF8
if ($rejectedCorsStatus.Trim() -match '^5') { throw "Rejected-origin CORS preflight returned server error: $($rejectedCorsStatus.Trim())" }
if ($rejectedCorsHeaders -match ('(?im)^access-control-allow-origin:\s*' + [regex]::Escape($rejectedOrigin) + '\s*$')) {
    throw 'Rejected-origin CORS preflight unexpectedly allowed an untrusted origin.'
}

$oversizedPayloadPath = Join-Path $artifacts 'oversized-request-body.tmp'
$oversizedResponsePath = Join-Path $artifacts 'oversized-response.txt'
try {
    [System.IO.File]::WriteAllText($oversizedPayloadPath, ('a' * (1024 * 1024 + 1)), [System.Text.UTF8Encoding]::new($false))
    $oversizedStatus = & curl.exe --silent --show-error --ssl-no-revoke --request POST --header 'Content-Type: application/json' --data-binary "@$oversizedPayloadPath" --output $oversizedResponsePath --write-out '%{http_code}' --cacert $caCertificate "$BaseUrl/api/v1/devices"
    if ($LASTEXITCODE -ne 0) { throw 'Oversized request-body check failed to reach Caddy.' }
    if ($oversizedStatus.Trim() -ne '413') { throw "Caddy did not reject an API body over 1 MB; received $($oversizedStatus.Trim())." }
}
finally {
    if (Test-Path -LiteralPath $oversizedPayloadPath) { Remove-Item -LiteralPath $oversizedPayloadPath -Force }
}

$headersPath = Join-Path $artifacts 'response-headers.txt'
& curl.exe --silent --show-error --ssl-no-revoke --head --cacert $caCertificate "$BaseUrl/" | Set-Content -LiteralPath $headersPath -Encoding UTF8
if ($LASTEXITCODE -ne 0) { throw 'Unable to read HTTPS response headers through Caddy.' }
$headers = Get-Content -LiteralPath $headersPath -Raw -Encoding UTF8
foreach ($header in @('strict-transport-security', 'x-content-type-options', 'x-frame-options', 'content-security-policy', 'permissions-policy')) {
    if ($headers -notmatch "(?im)^$header`:") { throw "Required security header is missing: $header" }
}

if ($observabilityEnabled) {
    # Keep the opaque scrape token inside the Backend container. The evidence
    # contains only metric names and Prometheus target health, never secrets.
    $metricsPath = Join-Path $artifacts 'prometheus-backend-metrics.txt'
    # Use a PowerShell single-quoted literal so `$token` and `$(cat ...)` are
    # evaluated only by the private container's POSIX shell, never by the
    # Windows host before Docker receives the command.
    $privateMetricsScrapeCommand = 'token=$(cat /run/secrets/IOT_METRICS_SCRAPE_TOKEN); wget -qO- --header=X-Iot-Metrics-Token:$token http://127.0.0.1:8080/actuator/prometheus'
    $metrics = Invoke-Docker -Arguments ($compose + @(
        'exec', '-T', 'backend', '/bin/sh', '-ec',
        $privateMetricsScrapeCommand
    )) -Description 'Scrape private Backend Prometheus endpoint'
    $metrics | Set-Content -LiteralPath $metricsPath -Encoding UTF8
    if (-not ((Get-Content -LiteralPath $metricsPath -Raw -Encoding UTF8) -match '(?m)^# HELP iot_websocket_sessions_active ')) {
        throw 'Authenticated internal Prometheus scrape did not expose the IoT metric registry.'
    }

    # Prometheus can become container-healthy before its first scheduled
    # scrape. Poll the private API for the configured Backend job rather than
    # treating that expected startup interval as a failed platform check.
    $targetsPath = Join-Path $artifacts 'prometheus-targets.json'
    $targetsDeadline = (Get-Date).AddSeconds([Math]::Min($TimeoutSeconds, 90))
    $targetsText = ''
    $backendTargetUp = $false
    do {
        $targets = Invoke-Docker -Arguments ($compose + @(
            'exec', '-T', 'backend', '/bin/sh', '-ec',
            'wget -qO- http://prometheus:9090/api/v1/targets'
        )) -Description 'Read private Prometheus target status'
        $targetsText = ($targets | Out-String).Trim()
        $backendTargetUp = $targetsText -match '"job"\s*:\s*"iot-manager-backend"' -and
            $targetsText -match '"health"\s*:\s*"up"'
        if (-not $backendTargetUp) { Start-Sleep -Seconds 3 }
    } while (-not $backendTargetUp -and (Get-Date) -lt $targetsDeadline)
    $targetsText | Set-Content -LiteralPath $targetsPath -Encoding UTF8
    if (-not $backendTargetUp) { throw 'Prometheus did not report an up Backend target within the startup window.' }
}

Invoke-Docker -Arguments ($compose + @('ps', '--format', 'json')) -Description 'Capture Compose status' |
    Set-Content -LiteralPath (Join-Path $artifacts 'compose-ps.json') -Encoding UTF8

Write-Host "P0 runtime smoke checks passed. Evidence directory: $artifacts"
