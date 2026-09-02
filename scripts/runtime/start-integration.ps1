[CmdletBinding()]
param(
    [string]$ProjectName = 'iot-manager-p0',
    [string]$EnvironmentFile = 'deploy/.env.integration',
    [string]$StateFile = 'deploy/.runtime/iot-manager-p0/runtime.env',
    [string]$BaseUrl = 'https://iot-manager.localhost',
    [switch]$Observability,
    [switch]$Verify,
    [ValidateSet('local', 'immutable')]
    [string]$Mode = 'local',
    [string]$DigestManifest,
    [string]$DigestEnvironmentFile,
    [string]$ReleaseServicesFile,
    [string]$ReleaseCandidateFile,
    [string]$ReleaseTopologyFile,
    [string]$RuntimeDigestEvidenceFile
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
if ($env:IOT_RUNTIME_MODE -and -not $PSBoundParameters.ContainsKey('Mode')) {
    $Mode = $env:IOT_RUNTIME_MODE
}
if (-not $DigestManifest -and $env:IOT_DIGEST_MANIFEST) {
    $DigestManifest = $env:IOT_DIGEST_MANIFEST
}
if (-not $DigestEnvironmentFile -and $env:IOT_DIGEST_ENV_FILE) {
    $DigestEnvironmentFile = $env:IOT_DIGEST_ENV_FILE
}
if (-not $ReleaseServicesFile -and $env:IOT_RELEASE_SERVICES_FILE) {
    $ReleaseServicesFile = $env:IOT_RELEASE_SERVICES_FILE
}
if (-not $ReleaseCandidateFile -and $env:IOT_RELEASE_CANDIDATE_FILE) {
    $ReleaseCandidateFile = $env:IOT_RELEASE_CANDIDATE_FILE
}
if (-not $ReleaseTopologyFile -and $env:IOT_RELEASE_TOPOLOGY_FILE) {
    $ReleaseTopologyFile = $env:IOT_RELEASE_TOPOLOGY_FILE
}
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
    if ($script:digestEnvironmentPath) { $args += @('--env-file', $script:digestEnvironmentPath) }
    if (Test-Path -LiteralPath $statePath) { $args += @('--env-file', $statePath) }
    $args += @('-f', (Join-Path $repositoryRoot 'deploy/docker-compose.yml'), '-f', (Join-Path $repositoryRoot 'deploy/docker-compose.integration.yml'))
    if ($Mode -eq 'immutable') { $args += @('-f', (Join-Path $repositoryRoot 'deploy/docker-compose.immutable.yml')) }
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

$digestEnvironmentPath = $null
$releaseServicesPath = $null
$releaseCandidatePath = $null
$releaseTopologyPath = $null
if ($Mode -eq 'immutable') {
    if (-not $DigestManifest) { throw 'Immutable mode requires -DigestManifest <image-digests.json>.' }
    $digestManifestPath = Resolve-RepositoryPath $DigestManifest
    if (-not (Test-Path -LiteralPath $digestManifestPath)) { throw "Digest manifest was not found: $digestManifestPath" }
    if ($DigestEnvironmentFile) {
        $digestEnvironmentPath = Resolve-RepositoryPath $DigestEnvironmentFile
    }
    else {
        $digestEnvironmentPath = Join-Path (Split-Path -Parent $digestManifestPath) 'image-digests.env'
    }
    if ($ReleaseServicesFile) {
        $releaseServicesPath = Resolve-RepositoryPath $ReleaseServicesFile
    }
    else {
        $releaseServicesPath = Join-Path (Split-Path -Parent $digestManifestPath) 'release-services.json'
    }
    if ($ReleaseCandidateFile) {
        $releaseCandidatePath = Resolve-RepositoryPath $ReleaseCandidateFile
    }
    else {
        $releaseCandidatePath = Join-Path (Split-Path -Parent $digestManifestPath) 'release-candidate.json'
    }
    if ($ReleaseTopologyFile) {
        $releaseTopologyPath = Resolve-RepositoryPath $ReleaseTopologyFile
    }
    else {
        $releaseTopologyPath = Join-Path (Split-Path -Parent $digestManifestPath) 'release-topology.json'
    }
    if (-not (Test-Path -LiteralPath $releaseServicesPath)) { throw "Immutable mode requires release services metadata: $releaseServicesPath" }
    if (-not (Test-Path -LiteralPath $releaseCandidatePath)) { throw "Immutable mode requires the frozen release candidate: $releaseCandidatePath" }
    if (-not (Test-Path -LiteralPath $releaseTopologyPath)) { throw "Immutable mode requires the frozen release topology: $releaseTopologyPath" }
    $manifestValidationArgs = @(
        (Join-Path $repositoryRoot 'scripts/ci/release-tools.mjs'),
        'validate-digest-manifest',
        '--candidate', $releaseCandidatePath,
        '--topology', $releaseTopologyPath,
        '--services', $releaseServicesPath,
        '--manifest', $digestManifestPath
    )
    if ($env:IOT_IMAGE_MANIFEST_SHA256) { $manifestValidationArgs += @('--expected-manifest-sha256', $env:IOT_IMAGE_MANIFEST_SHA256) }
    if ($env:IOT_RELEASE_CANDIDATE_ID) { $manifestValidationArgs += @('--expected-release-candidate-id', $env:IOT_RELEASE_CANDIDATE_ID) }
    if ($env:IOT_SOURCE_SHA) { $manifestValidationArgs += @('--expected-source-sha', $env:IOT_SOURCE_SHA) }
    & node @manifestValidationArgs
    if ($LASTEXITCODE -ne 0) { throw 'Immutable digest manifest validation failed.' }
    & node (Join-Path $repositoryRoot 'scripts/ci/release-tools.mjs') render-digest-env --manifest $digestManifestPath --output $digestEnvironmentPath
    if ($LASTEXITCODE -ne 0) { throw 'Digest environment rendering failed.' }
}

& (Join-Path $PSScriptRoot 'new-secrets.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Secret generation failed.' }

$startFlags = if ($Mode -eq 'local') { @('-d', '--build') } else { @('-d', '--no-build') }
$identity = (Compose-Arguments) + @('up') + $startFlags + @('volume-init', 'postgres', 'keycloak', 'caddy')
Invoke-Native -Description 'Start identity plane' -Arguments $identity
Wait-ServiceHealthy -Service 'keycloak'
Wait-ServiceHealthy -Service 'caddy'
Assert-IdentityPlane

& (Join-Path $PSScriptRoot 'reconcile-keycloak-realm.ps1') -ProjectName $ProjectName -EnvironmentFile $EnvironmentFile -StateFile $StateFile -VerifyIdempotence
& (Join-Path $PSScriptRoot 'bootstrap-keycloak-owner.ps1') -ProjectName $ProjectName -EnvironmentFile $EnvironmentFile -StateFile $StateFile -VerifyIdempotence

$applicationServices = @('backend', 'backup', 'wal-g-archive', 'wal-g-backup')
if ($observabilityEnabled) { $applicationServices += @('alertmanager', 'prometheus') }
$application = (Compose-Arguments -Application -Observability:$observabilityEnabled) + @('up') + $startFlags + $applicationServices
Invoke-Native -Description 'Start application plane' -Arguments $application

if ($Verify) {
    & (Join-Path $PSScriptRoot 'verify-stack.ps1') -ProjectName $ProjectName -EnvironmentFile $EnvironmentFile -StateFile $StateFile -Observability:$observabilityEnabled
}

if ($Mode -eq 'immutable') {
    $runtimeEvidencePath = if ($RuntimeDigestEvidenceFile) {
        Resolve-RepositoryPath $RuntimeDigestEvidenceFile
    }
    else {
        Join-Path $repositoryRoot 'artifacts/release/runtime-service-digests.json'
    }
    $verifyArgs = @(
        (Join-Path $repositoryRoot 'scripts/ci/release-tools.mjs'),
        'verify-service-digests',
        '--phase', 'runtime',
        '--project', $ProjectName,
        '--env', $environmentPath,
        '--state-env', $statePath,
        '--image-env', $digestEnvironmentPath,
        '--base-compose', (Join-Path $repositoryRoot 'deploy/docker-compose.yml'),
        '--runtime-compose', (Join-Path $repositoryRoot 'deploy/docker-compose.integration.yml'),
        '--immutable-compose', (Join-Path $repositoryRoot 'deploy/docker-compose.immutable.yml'),
        '--services', $releaseServicesPath,
        '--manifest', $digestManifestPath,
        '--output', $runtimeEvidencePath
    )
    & node @verifyArgs
    if ($LASTEXITCODE -ne 0) { throw 'Immutable runtime digest verification failed.' }
}

Write-Host "Integration stack started. Project: $ProjectName (mode: $Mode)"
