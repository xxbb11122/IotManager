[CmdletBinding()]
param(
    [string]$ProjectName = 'iot-manager-p0',
    [string]$EnvironmentFile = 'deploy/.env.integration',
    [string]$StateFile = 'deploy/.runtime/iot-manager-p0/runtime.env',
    [string]$BaseUrl = 'https://iot-manager.localhost',
    [switch]$Observability,
    [switch]$Verify
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Resolve-RepositoryPath {
    param([string]$Path)
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    return Join-Path $repositoryRoot $Path
}

function Get-EnvironmentFileValue {
    param(
        [string]$Path,
        [string]$Name
    )

    $escapedName = [regex]::Escape($Name)
    $line = Get-Content -LiteralPath $Path -Encoding UTF8 |
        Where-Object { $_ -match "^\s*$escapedName=(.*)$" } |
        Select-Object -Last 1
    if ($null -eq $line) { return $null }
    return $line.ToString().Substring($line.ToString().IndexOf('=') + 1).Trim()
}

function Assert-IntegrationRoleMatrixConfiguration {
    param([string]$Path)

    if ((Get-EnvironmentFileValue -Path $Path -Name 'IOT_CREATE_INTEGRATION_IDENTITIES') -ne 'true') {
        throw "Integration environment must set IOT_CREATE_INTEGRATION_IDENTITIES=true. Update $Path from deploy/.env.integration.example before running the Gate 2 stack."
    }
    foreach ($name in @(
            'IOT_ADMIN_USERNAME', 'IOT_ADMIN_DISPLAY_NAME', 'IOT_ADMIN_EMAIL',
            'IOT_OPERATOR_USERNAME', 'IOT_OPERATOR_DISPLAY_NAME', 'IOT_OPERATOR_EMAIL',
            'IOT_VIEWER_USERNAME', 'IOT_VIEWER_DISPLAY_NAME', 'IOT_VIEWER_EMAIL'
        )) {
        if ([string]::IsNullOrWhiteSpace((Get-EnvironmentFileValue -Path $Path -Name $name))) {
            throw "Integration environment is missing $name. Update $Path from deploy/.env.integration.example before running the Gate 2 stack."
        }
    }
}

$environmentPath = Resolve-RepositoryPath $EnvironmentFile
$environmentTemplate = Join-Path $repositoryRoot 'deploy/.env.integration.example'
$statePath = Resolve-RepositoryPath $StateFile
$observabilityEnabled = $Observability.IsPresent
if ($env:IOT_ENABLE_OBSERVABILITY) {
    if ($env:IOT_ENABLE_OBSERVABILITY -notin @('true', 'false')) {
        throw 'IOT_ENABLE_OBSERVABILITY must be true or false.'
    }
    $observabilityEnabled = $observabilityEnabled -or $env:IOT_ENABLE_OBSERVABILITY -eq 'true'
}

function Invoke-Native {
    param([string]$Description, [string[]]$Arguments)
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Description failed with exit code $LASTEXITCODE." }
}

function Compose-Arguments {
    param([switch]$Application, [switch]$Observability)
    $args = @('compose', '--project-name', $ProjectName)
    if ($Application) { $args += @('--profile', 'application') }
    if ($Observability) { $args += @('--profile', 'observability') }
    $args += @('--env-file', $environmentPath)
    if (Test-Path -LiteralPath $statePath) { $args += @('--env-file', $statePath) }
    $args += @('-f', (Join-Path $repositoryRoot 'deploy/docker-compose.yml'), '-f', (Join-Path $repositoryRoot 'deploy/docker-compose.integration.yml'))
    return $args
}

function Wait-ServiceHealthy {
    param([string]$Service, [int]$TimeoutSeconds = 180)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $compose = Compose-Arguments
        $id = (& docker @($compose + @('ps', '-q', $Service)) | Out-String).Trim()
        if ($id) {
            $health = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $id | Out-String).Trim()
            if ($health -eq 'healthy') { return }
        }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)
    throw "$Service did not become healthy within $TimeoutSeconds seconds."
}

function Assert-IdentityPlane {
    $temporaryCertificate = Join-Path ([System.IO.Path]::GetTempPath()) ("iot-manager-caddy-{0}.crt" -f [guid]::NewGuid())
    $temporaryResponse = "$($temporaryCertificate).response"
    try {
        $compose = Compose-Arguments
        Invoke-Native -Description 'Export integration Caddy CA' -Arguments ($compose + @('cp', 'caddy:/data/caddy/pki/authorities/local/root.crt', $temporaryCertificate))
        # Schannel performs an online revocation lookup even when --cacert
        # explicitly pins Caddy's local integration CA. That lookup cannot
        # succeed for an offline, freshly generated CA, so disable only the
        # revocation lookup; TLS chain and hostname validation remain active.
        $status = & curl.exe --silent --show-error --ssl-no-revoke --output $temporaryResponse --write-out '%{http_code}' --cacert $temporaryCertificate "$BaseUrl/auth/realms/iot-manager/.well-known/openid-configuration"
        if ($LASTEXITCODE -ne 0) { throw 'Identity-plane discovery request failed through Caddy.' }
        if ($status.Trim() -ne '200') { throw "Identity-plane discovery request returned $($status.Trim()) instead of HTTP 200." }
    }
    finally {
        Remove-Item -LiteralPath $temporaryCertificate -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $temporaryResponse -Force -ErrorAction SilentlyContinue
    }
}

Invoke-Native -Description 'Docker Engine check' -Arguments @('info')
if (-not (Test-Path -LiteralPath $environmentPath)) {
    Copy-Item -LiteralPath $environmentTemplate -Destination $environmentPath
    Write-Host "Created non-secret integration environment file: $environmentPath"
}
Assert-IntegrationRoleMatrixConfiguration -Path $environmentPath

& (Join-Path $PSScriptRoot 'new-secrets.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Secret generation failed.' }

$identity = (Compose-Arguments) + @('up', '-d', '--build', 'volume-init', 'postgres', 'keycloak', 'caddy')
Invoke-Native -Description 'Start identity plane' -Arguments $identity
Wait-ServiceHealthy -Service 'keycloak'
Wait-ServiceHealthy -Service 'caddy'
Assert-IdentityPlane

& (Join-Path $PSScriptRoot 'reconcile-keycloak-realm.ps1') -ProjectName $ProjectName -EnvironmentFile $EnvironmentFile -StateFile $StateFile -VerifyIdempotence
& (Join-Path $PSScriptRoot 'bootstrap-keycloak-owner.ps1') -ProjectName $ProjectName -EnvironmentFile $EnvironmentFile -StateFile $StateFile -VerifyIdempotence

$applicationServices = @('backend', 'backup', 'wal-g-archive', 'wal-g-backup')
if ($observabilityEnabled) { $applicationServices += @('alertmanager', 'prometheus') }
$application = (Compose-Arguments -Application -Observability:$observabilityEnabled) + @('up', '-d', '--build') + $applicationServices
Invoke-Native -Description 'Start application plane' -Arguments $application

if ($Verify) {
    & (Join-Path $PSScriptRoot 'verify-stack.ps1') -ProjectName $ProjectName -EnvironmentFile $EnvironmentFile -StateFile $StateFile -Observability:$observabilityEnabled
}

Write-Host "Integration stack started. Project: $ProjectName"
