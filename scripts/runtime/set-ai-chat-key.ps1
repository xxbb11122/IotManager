[CmdletBinding()]
param(
    [string]$SecretDirectory,
    [switch]$ReplaceExisting
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $SecretDirectory) {
    $SecretDirectory = Join-Path $repositoryRoot 'deploy/.runtime/iot-manager-p0/secrets'
}
elseif (-not [IO.Path]::IsPathRooted($SecretDirectory)) {
    throw 'SecretDirectory must be an absolute path'
}
if (-not (Test-Path -LiteralPath $SecretDirectory -PathType Container)) {
    throw "Secret directory is unavailable: $SecretDirectory"
}

$keyFile = Join-Path $SecretDirectory 'ai_chat_api_key'
if ((Test-Path -LiteralPath $keyFile -PathType Leaf) -and (Get-Item -LiteralPath $keyFile).Length -gt 0 -and -not $ReplaceExisting) {
    throw 'A Chat API Key already exists; use the rotation procedure before replacing it'
}

$secureKey = Read-Host 'DeepSeek API Key (input hidden)' -AsSecureString
if ($secureKey.Length -eq 0) {
    $secureKey.Dispose()
    throw 'The Chat API Key cannot be empty'
}
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
$temporaryFile = $null
try {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($plainKey -match '[\r\n]' -or $plainKey -ne $plainKey.Trim()) {
        throw 'The Chat API Key must not contain newlines or surrounding whitespace'
    }
    if (-not $plainKey.StartsWith('sk-')) {
        throw 'DeepSeek API Keys start with sk-; copy the complete key from the DeepSeek platform'
    }
    $temporaryFile = Join-Path $SecretDirectory ('.ai_chat_api_key.' + [guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($temporaryFile, $plainKey, [Text.UTF8Encoding]::new($false))
    $plainKey = $null
    & icacls $temporaryFile /inheritance:r /grant:r "$($env:USERNAME):F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to set Chat API Key file ACL' }
    if ((Test-Path -LiteralPath $keyFile -PathType Leaf) -and (Get-Item -LiteralPath $keyFile).Length -gt 0 -and -not $ReplaceExisting) {
        throw 'A Chat API Key was added while the prompt was open; refusing to overwrite it'
    }
    Move-Item -LiteralPath $temporaryFile -Destination $keyFile -Force
}
finally {
    $plainKey = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secureKey.Dispose()
    if ($temporaryFile -and (Test-Path -LiteralPath $temporaryFile)) {
        Remove-Item -LiteralPath $temporaryFile -Force
    }
}
Write-Host "Chat API Key saved in the protected local file: $keyFile"
