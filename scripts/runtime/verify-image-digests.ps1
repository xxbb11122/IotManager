[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Candidate,
    [Parameter(Mandatory = $true)]
    [string]$Services,
    [Parameter(Mandatory = $true)]
    [string]$Manifest,
    [Parameter(Mandatory = $true)]
    [string]$RuntimeEvidence,
    [Parameter(Mandatory = $true)]
    [string]$RecoveryEvidence,
    [Parameter(Mandatory = $true)]
    [string]$Output
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Resolve-RepositoryPath {
    param([string]$Path)
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    return Join-Path $repositoryRoot $Path
}

$arguments = @(
    (Join-Path $repositoryRoot 'scripts/ci/release-tools.mjs'),
    'aggregate-service-digests',
    '--candidate', (Resolve-RepositoryPath $Candidate),
    '--services', (Resolve-RepositoryPath $Services),
    '--manifest', (Resolve-RepositoryPath $Manifest),
    '--runtime-evidence', (Resolve-RepositoryPath $RuntimeEvidence),
    '--recovery-evidence', (Resolve-RepositoryPath $RecoveryEvidence),
    '--output', (Resolve-RepositoryPath $Output)
)

& node @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Release service-union digest verification failed with exit code $LASTEXITCODE."
}
