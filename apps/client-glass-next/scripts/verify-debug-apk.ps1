param(
  [string]$Apk,
  [string]$PreviousApk,
  [string]$Output = 'verification/apk-verification.json'
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $Apk) { $Apk = Join-Path $projectRoot 'android/app/build/outputs/apk/debug/app-debug.apk' }
$apkPath = (Resolve-Path -LiteralPath $Apk).Path
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
if (-not $sdkRoot) { throw 'Set ANDROID_HOME or ANDROID_SDK_ROOT.' }
$buildTools = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory |
  Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
  Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $buildTools) { throw 'Android build-tools were not found.' }
$aapt = Join-Path $buildTools.FullName 'aapt.exe'
$signer = Join-Path $buildTools.FullName 'apksigner.bat'
$badging = (& $aapt dump badging $apkPath) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'aapt failed.' }
$identity = [regex]::Match($badging, "package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'")
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$gradle = Get-Content -LiteralPath (Join-Path $projectRoot 'android/app/build.gradle') -Raw
$expectedCode = [int][regex]::Match($gradle, 'def resolvedVersionCode = (\d+)').Groups[1].Value
if (-not $identity.Success -or $identity.Groups[1].Value -ne 'com.iot.manager.glassnext' -or
    $identity.Groups[2].Value -ne [string]$expectedCode -or $identity.Groups[3].Value -ne $package.version) {
  throw 'APK identity does not match the independent App source version.'
}
function Verify-Signature([string]$Path) {
  $verification = (& $signer verify --verbose --print-certs $Path) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
  $digest = [regex]::Match($verification, 'Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]+)').Groups[1].Value.ToLowerInvariant()
  if ($digest.Length -ne 64) { throw 'A signer certificate digest is required.' }
  return $digest
}
$certificate = Verify-Signature $apkPath
$sameSigner = $null
if ($PreviousApk) {
  $previousPath = (Resolve-Path -LiteralPath $PreviousApk).Path
  $sameSigner = (Verify-Signature $previousPath) -eq $certificate
  if (-not $sameSigner) { throw 'The previous APK uses a different signer; an in-place upgrade is not valid.' }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($apkPath)
try {
  $dist = (Resolve-Path (Join-Path $projectRoot 'dist')).Path
  $files = @(Get-ChildItem -LiteralPath $dist -File -Recurse | ForEach-Object {
    $relative = [System.IO.Path]::GetRelativePath($dist, $_.FullName).Replace('\', '/')
    $entry = $archive.GetEntry('assets/public/' + $relative)
    if (-not $entry) { throw "Missing packaged resource: $relative" }
    $stream = $entry.Open()
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try { $actual = [Convert]::ToHexString($hasher.ComputeHash($stream)).ToLowerInvariant() }
    finally { $stream.Dispose(); $hasher.Dispose() }
    $expected = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "Packaged resource differs from dist: $relative" }
    [pscustomobject]@{ path = $relative; sha256 = $actual; bytes = $entry.Length }
  })
  $reader = [System.IO.StreamReader]::new($archive.GetEntry('assets/public/build-info.json').Open())
  try { $buildInfo = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  if ($buildInfo.version -ne $package.version) { throw 'Packaged build identity version differs from the App.' }
  $result = [ordered]@{
    verifiedAt = [DateTime]::UtcNow.ToString('o')
    applicationId = $identity.Groups[1].Value
    versionName = $package.version
    versionCode = $expectedCode
    sha256 = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
    bytes = (Get-Item -LiteralPath $apkPath).Length
    certificateSha256 = $certificate
    sameSignerAsPrevious = $sameSigner
    buildInfo = $buildInfo
    allDistFilesMatch = $true
    files = $files
  }
  $outputPath = if ([System.IO.Path]::IsPathRooted($Output)) { $Output } else { Join-Path $projectRoot $Output }
  New-Item -ItemType Directory -Path (Split-Path $outputPath) -Force | Out-Null
  $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $outputPath -Encoding utf8
  [pscustomobject]@{ version = $package.version; code = $expectedCode; files = $files.Count; signature = 'verified'; sameSigner = $sameSigner; sha256 = $result.sha256 } | ConvertTo-Json
} finally { $archive.Dispose() }
