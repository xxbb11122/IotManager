[CmdletBinding()]
param(
    [ValidateSet('local', 'immutable')]
    [string]$Mode = 'local',
    [string]$DigestManifest,
    [string]$DigestEnvironmentFile,
    [string]$ReleaseServicesFile,
    [string]$ReleaseCandidateFile,
    [string]$ReleaseTopologyFile,
    [ValidateSet('PITR')]
    [string]$Confirmation
)

# The physical drill intentionally has one canonical implementation: the
# Bash version performs the WAL segment probe, restore-point assertion, RPO/
# RTO checks, and container digest evidence.  The Windows entry point calls
# that implementation through Git Bash so PowerShell users receive exactly
# the same fail-closed behavior instead of a partially duplicated PITR path.
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$scriptPath = Join-Path $PSScriptRoot 'wal-recovery-drill.sh'

function Resolve-RepositoryPath {
    param([string]$Path)
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    return Join-Path $repositoryRoot $Path
}

function Find-GitBash {
    $command = Get-Command bash.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($candidate in @(
            'C:\Program Files\Git\bin\bash.exe',
            'C:\Program Files\Git\usr\bin\bash.exe'
        )) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    throw 'wal-recovery-drill.ps1 requires Git Bash. Install Git for Windows or run scripts/runtime/wal-recovery-drill.sh on a Linux recovery runner.'
}

if ($Confirmation) {
    $env:IOT_PITR_CONFIRM = $Confirmation
}
if ($env:IOT_PITR_CONFIRM -ne 'PITR') {
    throw 'Set -Confirmation PITR (or IOT_PITR_CONFIRM=PITR) only after approving an isolated recovery target.'
}

$arguments = @($scriptPath, '--mode', $Mode)
if ($DigestManifest) { $arguments += @('--digest-manifest', (Resolve-RepositoryPath $DigestManifest)) }
if ($DigestEnvironmentFile) { $arguments += @('--digest-env-file', (Resolve-RepositoryPath $DigestEnvironmentFile)) }
if ($ReleaseServicesFile) { $arguments += @('--release-services', (Resolve-RepositoryPath $ReleaseServicesFile)) }
if ($ReleaseCandidateFile) { $arguments += @('--release-candidate', (Resolve-RepositoryPath $ReleaseCandidateFile)) }
if ($ReleaseTopologyFile) { $arguments += @('--release-topology', (Resolve-RepositoryPath $ReleaseTopologyFile)) }

& (Find-GitBash) @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Physical WAL-G recovery drill failed with exit code $LASTEXITCODE."
}
