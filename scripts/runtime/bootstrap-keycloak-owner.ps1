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
if (-not (Test-Path -LiteralPath $environmentPath)) { throw "Environment file was not found: $environmentPath" }

$compose = @('compose', '--project-name', $ProjectName, '--env-file', $environmentPath)
if (Test-Path -LiteralPath $statePath) { $compose += @('--env-file', $statePath) }
foreach ($composeFile in $ComposeFiles) {
    $composePath = if ([System.IO.Path]::IsPathRooted($composeFile)) { $composeFile } else { Join-Path $repositoryRoot $composeFile }
    if (-not (Test-Path -LiteralPath $composePath)) { throw "Compose file was not found: $composePath" }
    $compose += @('-f', $composePath)
}

# Windows PowerShell 5.1 materializes native stderr as an ErrorRecord even
# when it is redirected. kcadm writes a non-secret "Logging into ..." notice
# to stderr on a successful login, so capture it and decide solely by Docker's
# exit code rather than allowing ErrorActionPreference=Stop to abort first.
$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $bootstrapArguments = @('exec', '-T', 'keycloak', '/opt/keycloak/bin/bootstrap-owner.sh')
    if ($VerifyIdempotence) { $bootstrapArguments += '--verify-idempotent' }
    $output = & docker @($compose + $bootstrapArguments) 2>&1
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
$exitCode = $LASTEXITCODE
$output | ForEach-Object { Write-Host $_ }
if ($exitCode -ne 0) { throw "Keycloak bootstrap failed with exit code $exitCode." }
function Get-BootstrapSubject {
    param([string]$Role)

    $prefix = "IOT_BOOTSTRAP_${Role}_SUBJECT="
    $subjectLine = $output | Where-Object { $_ -match "^$([regex]::Escape($prefix))" } | Select-Object -Last 1
    if (-not $subjectLine) { return $null }
    $subject = $subjectLine.ToString().Substring($prefix.Length).Trim()
    if ($subject -notmatch '^[0-9a-fA-F-]{36}$') { throw "Keycloak $Role bootstrap returned an invalid subject format." }
    return $subject
}
$ownerSubject = Get-BootstrapSubject 'OWNER'
if (-not $ownerSubject) { throw 'Keycloak OWNER bootstrap did not return a subject.' }
$adminSubject = Get-BootstrapSubject 'ADMIN'
$operatorSubject = Get-BootstrapSubject 'OPERATOR'
$viewerSubject = Get-BootstrapSubject 'VIEWER'
if ($VerifyIdempotence -and -not ($output | Where-Object { $_ -match '^KEYCLOAK_BOOTSTRAP_IDEMPOTENT=true$' })) {
    throw 'Keycloak bootstrap did not prove idempotence.'
}

$stateDirectory = Split-Path -Parent $statePath
[System.IO.Directory]::CreateDirectory($stateDirectory) | Out-Null
$retained = @()
if (Test-Path -LiteralPath $statePath) {
    # Keep an array even when the state file has zero or one retained line.
    # Otherwise PowerShell collapses it to a scalar string and `+=` appends
    # multiple role assignments into one invalid environment line.
    $retained = @(Get-Content -LiteralPath $statePath -Encoding UTF8 |
        Where-Object { $_ -notmatch '^IOT_BOOTSTRAP_(OWNER|ADMIN|OPERATOR|VIEWER)_SUBJECT=' })
}
$retained += "IOT_BOOTSTRAP_OWNER_SUBJECT=$ownerSubject"
if ($adminSubject) { $retained += "IOT_BOOTSTRAP_ADMIN_SUBJECT=$adminSubject" }
if ($operatorSubject) { $retained += "IOT_BOOTSTRAP_OPERATOR_SUBJECT=$operatorSubject" }
if ($viewerSubject) { $retained += "IOT_BOOTSTRAP_VIEWER_SUBJECT=$viewerSubject" }
[System.IO.File]::WriteAllLines($statePath, [string[]]$retained, [System.Text.UTF8Encoding]::new($false))
try { & icacls $statePath /inheritance:r /grant:r "$($env:USERNAME):F" | Out-Null } catch { Write-Warning "Unable to harden runtime state ACL: $($_.Exception.Message)" }
Write-Host "Keycloak bootstrap state written: $statePath"
