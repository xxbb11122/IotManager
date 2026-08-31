[CmdletBinding()]
param(
    [switch]$Android,
    [switch]$Strict,
    [switch]$SkipBackend,
    [switch]$SkipWeb,
    [switch]$SkipDeploy
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$script:strictMode = $Strict.IsPresent
$script:skipSummaries = [System.Collections.Generic.List[string]]::new()
$script:summaryFile = [string]$env:IOT_VERIFY_SUMMARY_FILE
$script:utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)

if (-not [string]::IsNullOrWhiteSpace($script:summaryFile)) {
    $summaryDirectory = Split-Path -Parent $script:summaryFile
    if (-not [string]::IsNullOrWhiteSpace($summaryDirectory)) {
        New-Item -ItemType Directory -Force -Path $summaryDirectory | Out-Null
    }
    [System.IO.File]::WriteAllText(
        $script:summaryFile,
        "scope,total,failures,errors,skipped$([Environment]::NewLine)",
        $script:utf8WithoutBom
    )
}

function Require-Command {
    param([string]$Name, [string]$Hint)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name was not found. $Hint"
    }
}

function Invoke-Native {
    param([string]$Description, [scriptblock]$Command)

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

function Invoke-InDirectory {
    param([string]$Directory, [scriptblock]$Action)

    Push-Location (Join-Path $repositoryRoot $Directory)
    try {
        & $Action
    }
    finally {
        Pop-Location
    }
}

function Write-VerificationSummary {
    param(
        [string]$Scope,
        [int]$Total,
        [int]$Failures,
        [int]$Errors,
        [int]$Skipped
    )

    Write-Host "==> ${Scope}: tests=$Total, failures=$Failures, errors=$Errors, skipped=$Skipped"
    if (-not [string]::IsNullOrWhiteSpace($script:summaryFile)) {
        [System.IO.File]::AppendAllText(
            $script:summaryFile,
            "${Scope},$Total,$Failures,$Errors,$Skipped$([Environment]::NewLine)",
            $script:utf8WithoutBom
        )
    }
}

function Register-Skip {
    param([string]$Description)

    if ($script:strictMode) {
        throw "Strict verification refuses to continue: $Description"
    }
    [void]$script:skipSummaries.Add($Description)
}

function Convert-TestCount {
    param([object]$Value, [string]$Label)

    [int]$parsed = 0
    $text = [string]$Value
    if (-not [int]::TryParse($text, [ref]$parsed) -or $parsed -lt 0) {
        throw "Invalid $Label count: $text"
    }
    return $parsed
}

function Invoke-NodeCheck {
    Require-Command node 'Install Node.js 22 (use the repository .nvmrc).'
    $majorVersion = [int]((& node --version).TrimStart('v').Split('.')[0])
    if ($majorVersion -ne 22) {
        throw "Node.js 22 is required; found $(& node --version). Activate the version in .nvmrc."
    }
}

function Get-MavenWrapperPath {
    $wrapper = Join-Path $repositoryRoot 'mvnw.cmd'
    if (-not (Test-Path -LiteralPath $wrapper -PathType Leaf)) {
        throw "Maven Wrapper was not found at $wrapper. Restore the repository wrapper files."
    }
    return $wrapper
}

function Invoke-Maven {
    param([string]$Description, [string[]]$Arguments)

    & $script:mavenWrapper @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

function Invoke-MavenJdkCheck {
    Require-Command java 'Configure JDK 17 and put it on PATH.'
    # Keep Wrapper downloads out of an interrupted or IDE-managed global .m2
    # cache. Callers can still supply MAVEN_USER_HOME explicitly; otherwise
    # verification uses a stable per-user application cache.
    if ([string]::IsNullOrWhiteSpace($env:MAVEN_USER_HOME)) {
        $localApplicationData = [Environment]::GetFolderPath('LocalApplicationData')
        if (-not [string]::IsNullOrWhiteSpace($localApplicationData)) {
            $env:MAVEN_USER_HOME = Join-Path $localApplicationData 'iot-manager-maven-wrapper'
        }
    }
    $script:mavenWrapper = Get-MavenWrapperPath
    $mavenVersion = (& $script:mavenWrapper --version 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect Maven Wrapper (exit code $LASTEXITCODE)."
    }
    $mavenMatch = [regex]::Match($mavenVersion, '(?m)^Apache Maven (\d+)\.(\d+)\.(\d+)')
    if (-not $mavenMatch.Success) {
        throw "Unable to determine the Maven Wrapper version:`n$mavenVersion"
    }
    $major = [int]$mavenMatch.Groups[1].Value
    $minor = [int]$mavenMatch.Groups[2].Value
    if ($major -ne 3 -or $minor -lt 9) {
        throw "Maven Wrapper must resolve Maven 3.9 or newer. Maven reported:`n$mavenVersion"
    }
    if ($mavenVersion -notmatch 'Java version: 17(?:[.\s]|$)') {
        throw "Backend and Edge Agent verification require Maven to use JDK 17. Maven reported:`n$mavenVersion"
    }
}

function Get-JavaVersionOutput {
    $javaExecutable = (Get-Command java -ErrorAction Stop).Source
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $javaExecutable
    $startInfo.Arguments = '-version'
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    [void]$process.Start()
    $standardOutput = $process.StandardOutput.ReadToEnd()
    $standardError = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "Unable to inspect the Java runtime (exit code $($process.ExitCode)): $standardError$standardOutput"
    }
    return "$standardOutput$standardError"
}

function Invoke-AndroidJdkCheck {
    Require-Command java 'Configure JDK 21 for Android builds.'
    $versionOutput = Get-JavaVersionOutput
    if ($versionOutput -notmatch 'version "(\d+)') {
        throw "Unable to determine the Android Java version:`n$versionOutput"
    }
    if ([int]$Matches[1] -ne 21) {
        throw "Android verification requires JDK 21. Java reported:`n$versionOutput"
    }
}

function Get-SurefireAttribute {
    param([System.Xml.XmlElement]$Suite, [string]$Attribute, [string]$ReportPath)

    return Convert-TestCount $Suite.GetAttribute($Attribute) "$Attribute in $ReportPath"
}

function Collect-SurefireSummary {
    param([string]$Component)

    $reportDirectory = Join-Path $repositoryRoot "$Component/target/surefire-reports"
    $reports = @(Get-ChildItem -LiteralPath $reportDirectory -Filter 'TEST-*.xml' -File -ErrorAction SilentlyContinue)
    if ($reports.Count -eq 0) {
        throw "$Component did not produce any Surefire XML reports."
    }

    [int]$tests = 0
    [int]$failures = 0
    [int]$errors = 0
    [int]$skipped = 0
    foreach ($report in $reports) {
        $document = [System.Xml.XmlDocument]::new()
        $document.Load($report.FullName)
        $suite = [System.Xml.XmlElement]$document.DocumentElement
        # PowerShell's XML adapter resolves `.Name` to the XML `name`
        # attribute when one exists, so use the DOM node's LocalName instead.
        if ($null -eq $suite -or $suite.LocalName -ne 'testsuite') {
            throw "Unable to read the testsuite summary from $($report.FullName)."
        }
        $tests += Get-SurefireAttribute $suite 'tests' $report.FullName
        $failures += Get-SurefireAttribute $suite 'failures' $report.FullName
        $errors += Get-SurefireAttribute $suite 'errors' $report.FullName
        $skipped += Get-SurefireAttribute $suite 'skipped' $report.FullName
    }

    if ($tests -eq 0) {
        throw "$Component reported zero executed tests."
    }
    Write-VerificationSummary "surefire:$Component" $tests $failures $errors $skipped
    if ($failures -ne 0 -or $errors -ne 0) {
        throw "$Component Surefire reports contain failures or errors despite Maven success."
    }
    if ($skipped -ne 0) {
        Register-Skip "$Component Surefire reports contain $skipped skipped test(s)"
    }
}

function Get-TapCount {
    param([string]$Report, [string]$Label)

    $pattern = "(?m)^# $([regex]::Escape($Label))\s+(\d+)\s*$"
    $matches = [regex]::Matches($Report, $pattern)
    if ($matches.Count -eq 0) {
        return 0
    }
    return Convert-TestCount $matches[$matches.Count - 1].Groups[1].Value "Node test $Label"
}

function Invoke-ClientUnitTests {
    $report = [System.IO.Path]::GetTempFileName()
    $previousErrorActionPreference = $ErrorActionPreference
    [int]$exitCode = 0
    try {
        $ErrorActionPreference = 'Continue'
        & npm test -- --test-reporter=tap 2>&1 | Tee-Object -FilePath $report
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    try {
        if ($exitCode -ne 0) {
            throw "client Node unit tests failed with exit code $exitCode."
        }
        $content = [System.IO.File]::ReadAllText($report)
        $tests = Get-TapCount $content 'tests'
        $failures = Get-TapCount $content 'fail'
        $cancelled = Get-TapCount $content 'cancelled'
        $skipped = Get-TapCount $content 'skipped'
        if ($tests -eq 0) {
            throw 'client Node tests reported zero executed tests.'
        }
        Write-VerificationSummary 'node:client' $tests $failures $cancelled $skipped
        if ($failures -ne 0 -or $cancelled -ne 0) {
            throw 'client Node tests contain failures or cancellations.'
        }
        if ($skipped -ne 0) {
            Register-Skip "client Node tests contain $skipped skipped test(s)"
        }
    }
    finally {
        Remove-Item -LiteralPath $report -Force -ErrorAction SilentlyContinue
    }
}

function Get-PlaywrightStat {
    param([object]$Stats, [string]$Name)

    $property = $Stats.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return 0
    }
    return Convert-TestCount $property.Value "Playwright $Name"
}

function Invoke-ClientPlaywrightTests {
    $report = [System.IO.Path]::GetTempFileName()
    $arguments = @('playwright', 'test', '--reporter=json')
    if ($script:strictMode) {
        # Runtime-auth is executed separately by runtime-e2e.yml with a real stack.
        $arguments += 'e2e/mobile-client.spec.js'
    }

    $previousErrorActionPreference = $ErrorActionPreference
    [int]$exitCode = 0
    try {
        $ErrorActionPreference = 'Continue'
        & npx @arguments 1> $report
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    try {
        if ($exitCode -ne 0) {
            $details = [System.IO.File]::ReadAllText($report)
            throw "client Playwright tests failed with exit code $exitCode.`n$details"
        }
        $payload = [System.IO.File]::ReadAllText($report) | ConvertFrom-Json
        $expected = Get-PlaywrightStat $payload.stats 'expected'
        $unexpected = Get-PlaywrightStat $payload.stats 'unexpected'
        $flaky = Get-PlaywrightStat $payload.stats 'flaky'
        $skipped = Get-PlaywrightStat $payload.stats 'skipped'
        if ($expected -eq 0) {
            throw 'client Playwright tests reported zero executed tests.'
        }
        Write-VerificationSummary 'playwright:client' $expected $unexpected $flaky $skipped
        if ($unexpected -ne 0 -or $flaky -ne 0) {
            throw 'client Playwright tests contain unexpected or flaky results.'
        }
        if ($skipped -ne 0) {
            Register-Skip "client Playwright tests contain $skipped skipped test(s)"
        }
    }
    finally {
        Remove-Item -LiteralPath $report -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-WebPlaywrightTests {
    param([string]$App)

    $report = [System.IO.Path]::GetTempFileName()
    $previousErrorActionPreference = $ErrorActionPreference
    [int]$exitCode = 0
    try {
        $ErrorActionPreference = 'Continue'
        & npx playwright test '--reporter=json' 1> $report
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    try {
        if ($exitCode -ne 0) {
            $details = [System.IO.File]::ReadAllText($report)
            throw "$App Playwright tests failed with exit code $exitCode.`n$details"
        }
        $payload = [System.IO.File]::ReadAllText($report) | ConvertFrom-Json
        $expected = Get-PlaywrightStat $payload.stats 'expected'
        $unexpected = Get-PlaywrightStat $payload.stats 'unexpected'
        $flaky = Get-PlaywrightStat $payload.stats 'flaky'
        $skipped = Get-PlaywrightStat $payload.stats 'skipped'
        if ($expected -eq 0) {
            throw "$App Playwright tests reported zero executed tests."
        }
        Write-VerificationSummary "playwright:$App" $expected $unexpected $flaky $skipped
        if ($unexpected -ne 0 -or $flaky -ne 0) {
            throw "$App Playwright tests contain unexpected or flaky results."
        }
        if ($skipped -ne 0) {
            Register-Skip "$App Playwright tests contain $skipped skipped test(s)"
        }
    }
    finally {
        Remove-Item -LiteralPath $report -Force -ErrorAction SilentlyContinue
    }
}

if (-not $SkipBackend) {
    Invoke-MavenJdkCheck
    foreach ($component in @('backend', 'edge-agent')) {
        Write-Host "==> ${component}: tests and package (JDK 17, Maven Wrapper)"
        Invoke-Maven "$component Maven clean verify" @(
            '--batch-mode',
            '--no-transfer-progress',
            '-f', (Join-Path $repositoryRoot "$component/pom.xml"),
            'clean',
            'verify'
        )
        $surefireReports = Join-Path $repositoryRoot "$component/target/surefire-reports"
        # Surefire may emit a harmless .dumpstream notice for Maven's
        # cross-drive classpath layout on Windows. A plain .dump is the
        # diagnostic created for an abnormal fork shutdown and must fail CI.
        $surefireDumps = Get-ChildItem -Path $surefireReports -Filter '*.dump' -ErrorAction SilentlyContinue
        if ($surefireDumps) {
            $names = ($surefireDumps | Select-Object -ExpandProperty Name) -join ', '
            throw "$component Maven verification produced Surefire shutdown dump(s): $names"
        }
        Collect-SurefireSummary $component
    }
}

if (-not $SkipWeb) {
    Invoke-NodeCheck
    Write-Host '==> Security: public Vite environment policy'
    Invoke-Native 'Public Vite environment policy' { node (Join-Path $repositoryRoot 'scripts/verify-public-build-env.js') }
    foreach ($app in @('frontend', 'console', 'client')) {
        Write-Host "==> ${app}: install and build"
        Invoke-InDirectory $app {
            Invoke-Native "$app npm ci" { npm ci }
            if ($app -eq 'client') {
                Invoke-ClientUnitTests
                Invoke-ClientPlaywrightTests
            }
            else {
                Invoke-WebPlaywrightTests -App $app
            }
            Invoke-Native "$app npm run build" { npm run build }
        }
    }
}

if (-not $SkipDeploy) {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        Write-Host '==> Deployment: Docker Compose configuration'
        $previousDomain = $env:DOMAIN
        $previousAcmeEmail = $env:ACME_EMAIL
        try {
            $env:DOMAIN = 'ci.example.test'
            $env:ACME_EMAIL = 'ci@example.test'
            $deployEnvironment = Join-Path $repositoryRoot 'deploy/.env.example'
            Invoke-Native 'Docker Compose configuration validation' {
                docker compose --env-file $deployEnvironment -f (Join-Path $repositoryRoot 'deploy/docker-compose.yml') config --quiet
            }
        }
        finally {
            $env:DOMAIN = $previousDomain
            $env:ACME_EMAIL = $previousAcmeEmail
        }
        $dockerReady = $false
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            # Docker Desktop may emit a harmless daemon warning on stderr even
            # when `docker info` succeeds. With ErrorActionPreference=Stop,
            # Windows PowerShell may turn that line into a terminating error.
            $ErrorActionPreference = 'Continue'
            & docker info 2>$null | Out-Null
            $dockerReady = $LASTEXITCODE -eq 0
        }
        catch {
            $dockerReady = $false
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        if ($dockerReady) {
            Write-Host '==> Deployment: Caddy configuration'
            $caddyfile = Join-Path $repositoryRoot 'deploy/Caddyfile'
            Invoke-Native 'Caddy configuration validation' {
                docker run --rm -e DOMAIN=ci.example.test -e ACME_EMAIL=ci@example.test -v "${caddyfile}:/etc/caddy/Caddyfile:ro" caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
            }
        }
        else {
            Register-Skip 'Docker Engine is unavailable; Caddy runtime validation was skipped'
        }
    }
    else {
        Register-Skip 'Docker CLI is unavailable; deployment validation was skipped'
    }
}

if ($Android) {
    Invoke-NodeCheck
    Invoke-AndroidJdkCheck
    if (-not $env:ANDROID_SDK_ROOT -and -not $env:ANDROID_HOME) {
        throw 'Set ANDROID_SDK_ROOT (or ANDROID_HOME) to an Android SDK containing API 36 and Build Tools 36.0.0.'
    }
    Write-Host '==> Android: Capacitor sync and debug APK build (JDK 21)'
    Invoke-InDirectory 'client' {
        Invoke-Native 'client npm ci' { npm ci }
        Invoke-Native 'client npm run build' { npm run build }
        Invoke-Native 'Capacitor Android sync' { npx cap sync android }
    }
    Write-Host '==> Android: verify synchronized public web assets contain no credentials'
    Invoke-Native 'Android synchronized public web asset policy' { node (Join-Path $repositoryRoot 'scripts/verify-public-build-env.js') }
    Invoke-InDirectory 'client/android' {
        Invoke-Native 'Android debug APK build' { .\gradlew.bat --no-daemon assembleDebug }
    }
}

if ($script:skipSummaries.Count -gt 0) {
    Write-Host 'Verification completed with declared non-strict skips:'
    foreach ($summary in $script:skipSummaries) {
        Write-Host "  - $summary"
    }
}
else {
    Write-Host 'Verification completed successfully.'
}
