[CmdletBinding()]
param(
    [string]$ProjectName = 'iot-manager-p0',
    [string]$EnvironmentFile = 'deploy/.env.integration',
    [string]$StateFile = 'deploy/.runtime/iot-manager-p0/runtime.env',
    [string]$OutputDirectory
)

# Keep redaction behavior identical to the existing hardened Bash collector.
# This wrapper avoids a second, potentially divergent secret-redaction path.
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$scriptPath = Join-Path $PSScriptRoot 'collect-runtime-diagnostics.sh'
$bash = (Get-Command bash.exe -ErrorAction SilentlyContinue).Source
if (-not $bash) {
    foreach ($candidate in @('C:\Program Files\Git\bin\bash.exe', 'C:\Program Files\Git\usr\bin\bash.exe')) {
        if (Test-Path -LiteralPath $candidate) { $bash = $candidate; break }
    }
}
if (-not $bash) {
    throw 'collect-runtime-diagnostics.ps1 requires Git Bash to run the canonical redacting collector.'
}

$env:IOT_COMPOSE_PROJECT = $ProjectName
$env:IOT_ENVIRONMENT_FILE = if ([System.IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repositoryRoot $EnvironmentFile }
$env:IOT_RUNTIME_STATE_FILE = if ([System.IO.Path]::IsPathRooted($StateFile)) { $StateFile } else { Join-Path $repositoryRoot $StateFile }
if ($OutputDirectory) {
    $env:IOT_DIAGNOSTIC_DIRECTORY = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory } else { Join-Path $repositoryRoot $OutputDirectory }
}

& $bash $scriptPath
if ($LASTEXITCODE -ne 0) {
    throw "Runtime diagnostics collection failed with exit code $LASTEXITCODE."
}
