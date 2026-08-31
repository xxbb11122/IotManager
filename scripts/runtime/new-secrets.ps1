[CmdletBinding()]
param(
    [string]$SecretDirectory,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $SecretDirectory) {
    $SecretDirectory = Join-Path $repositoryRoot 'deploy/.runtime/iot-manager-p0/secrets'
}
elseif (-not [System.IO.Path]::IsPathRooted($SecretDirectory)) {
    $SecretDirectory = Join-Path $repositoryRoot $SecretDirectory
}

function New-RandomHex {
    param([int]$Bytes = 48)

    $buffer = [byte[]]::new($Bytes)
    # RandomNumberGenerator.Fill is only available in newer .NET runtimes.
    # Windows PowerShell 5.1 is still common on developer machines, so use
    # the compatible instance API rather than making secret generation depend
    # on PowerShell 7.
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($buffer)
    }
    finally {
        $generator.Dispose()
    }
    # Convert.ToHexString is unavailable on the .NET Framework runtime used
    # by Windows PowerShell 5.1. BitConverter is supported by both it and
    # PowerShell 7/.NET, and produces the same lowercase hexadecimal value.
    return ([BitConverter]::ToString($buffer) -replace '-', '').ToLowerInvariant()
}

function Protect-SecretDirectory {
    param([string]$Path)

    # ACL changes are limited to the generated integration directory. If the
    # filesystem does not support Windows ACLs, the caller still gets a clear
    # warning rather than silently exposing secret values.
    try {
        # icacls requires /grant:r and the principal/permission expression as
        # two distinct arguments. Combining them is accepted by some builds
        # but rejected by the Windows version bundled with older systems.
        & icacls $Path /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "icacls exited with $LASTEXITCODE" }
    }
    catch {
        Write-Warning "Unable to harden ACL for $Path. Apply user-only access before starting Compose: $($_.Exception.Message)"
    }
}

[System.IO.Directory]::CreateDirectory($SecretDirectory) | Out-Null
Protect-SecretDirectory -Path $SecretDirectory

$secretNames = @(
    'postgres_admin_password',
    'iot_db_owner_password',
    'iot_db_app_password',
    'keycloak_db_password',
    'keycloak_bootstrap_admin_password',
    'keycloak_owner_password',
    'keycloak_admin_password',
    'keycloak_operator_password',
    'keycloak_viewer_password',
    'weather_fingerprint_secret',
    'metrics_scrape_token',
    'walg_s3_access_key',
    'walg_s3_secret_key'
)
$utf8 = [System.Text.UTF8Encoding]::new($false)

foreach ($name in $secretNames) {
    $path = Join-Path $SecretDirectory $name
    if ((Test-Path -LiteralPath $path) -and -not $Force) {
        Write-Host "Preserved existing secret: $name"
        continue
    }
    [System.IO.File]::WriteAllText($path, (New-RandomHex), $utf8)
    Write-Host "Generated secret: $name"
}

Write-Host "Secret directory ready: $SecretDirectory"
