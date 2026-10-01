[CmdletBinding()]
param(
  [string]$SdkPath = $env:ANDROID_HOME,
  [ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$AvdName = 'IotManagerApi36',
  [ValidateRange(5554,5682)][int]$Port = 5554
)
$ErrorActionPreference = 'Stop'
if ($Port % 2 -ne 0) { throw 'The emulator console port must be even.' }
if (-not $SdkPath) { throw 'Pass -SdkPath with the existing Android SDK directory.' }
$SdkPath = (Resolve-Path -LiteralPath $SdkPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $SdkPath 'emulator\emulator.exe'))) { throw 'Android emulator.exe was not found.' }
$projectPath = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $projectPath 'artifacts\android-test-runtime'
$aliasPath = Join-Path $runtimePath 'sdk'
$tempPath = Join-Path $runtimePath 'temp'
if ($runtimePath -match '[^\x00-\x7F]') { throw 'This test helper requires an ASCII project path for the emulator alias.' }
New-Item -ItemType Directory -Path $runtimePath,$tempPath -Force | Out-Null
if (-not (Test-Path -LiteralPath $aliasPath)) {
  New-Item -ItemType Junction -Path $aliasPath -Target $SdkPath | Out-Null
} else {
  $alias = Get-Item -LiteralPath $aliasPath
  if ($alias.LinkType -ne 'Junction' -or $alias.Target -notcontains $SdkPath) { throw 'Existing SDK alias points elsewhere.' }
}
# Only this helper and its child process see the aliases. The SDK stays on D:.
$env:ANDROID_HOME = $aliasPath
$env:ANDROID_SDK_ROOT = $aliasPath
$env:TEMP = $tempPath
$env:TMP = $tempPath
$adb = Join-Path $aliasPath 'platform-tools\adb.exe'
$emulator = Join-Path $aliasPath 'emulator\emulator.exe'
$serial = "emulator-$Port"
if ((& $adb devices) -match "^$serial\s+device") {
  Write-Output "Already connected: $serial"
  exit 0
}
if ((& $emulator -list-avds) -notcontains $AvdName) { throw "AVD not found: $AvdName" }
$arguments = @('-avd',$AvdName,'-port',"$Port",'-no-window','-no-audio','-no-boot-anim','-no-snapshot','-gpu','swiftshader','-feature','-Vulkan')
$helperProcess = Start-Process -FilePath $emulator -ArgumentList $arguments -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $runtimePath 'emulator.stdout.log') `
  -RedirectStandardError (Join-Path $runtimePath 'emulator.stderr.log')
Write-Output "Starting existing AVD without wiping data. Launcher PID: $($helperProcess.Id)"
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  if ((& $adb devices) -match "^$serial\s+device") {
    $booted = & $adb -s $serial shell getprop sys.boot_completed
    if ($booted.Trim() -eq '1') { Write-Output "Boot complete: $serial"; exit 0 }
  }
  Start-Sleep -Seconds 3
}
throw "Emulator has not finished booting. See $runtimePath\emulator.*.log. No AVD data was reset."
