[CmdletBinding()]
param(
    [string]$ProjectName = 'iot-manager-p0',
    [string]$EnvironmentFile = 'deploy/.env.integration',
    [string]$StateFile = 'deploy/.runtime/iot-manager-p0/runtime.env',
    [string[]]$ComposeFiles = @('deploy/docker-compose.yml', 'deploy/docker-compose.integration.yml'),
    [switch]$VerifyIdempotence
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

if (-not (Test-Path -LiteralPath $environmentPath)) {
    throw "Environment file was not found: $environmentPath"
}

$compose = @('compose', '--project-name', $ProjectName, '--env-file', $environmentPath)
if (Test-Path -LiteralPath $statePath) { $compose += @('--env-file', $statePath) }
foreach ($composeFile in $ComposeFiles) {
    $composePath = if ([System.IO.Path]::IsPathRooted($composeFile)) { $composeFile } else { Join-Path $repositoryRoot $composeFile }
    if (-not (Test-Path -LiteralPath $composePath)) { throw "Compose file was not found: $composePath" }
    $compose += @('-f', $composePath)
}

$reconcileArguments = @('exec', '-T', 'keycloak', '/opt/keycloak/bin/reconcile-keycloak-realm.sh')
if ($VerifyIdempotence) { $reconcileArguments += '--verify-idempotent' }
$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $output = & docker @($compose + $reconcileArguments) 2>&1
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
$exitCode = $LASTEXITCODE
$output | ForEach-Object { Write-Host $_ }
if ($exitCode -ne 0) { throw "Keycloak realm reconciliation failed with exit code $exitCode." }
if ($VerifyIdempotence -and -not ($output | Where-Object { $_ -match '^KEYCLOAK_REALM_RECONCILE_IDEMPOTENT=true$' })) {
    throw 'Keycloak realm reconciliation did not prove idempotence.'
}
