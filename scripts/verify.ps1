[CmdletBinding()]
param(
    [switch]$Android,
    [switch]$SkipBackend,
    [switch]$SkipWeb,
    [switch]$SkipDeploy
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot

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

function Invoke-NodeCheck {
    Require-Command node 'Install Node.js 22 or newer.'
    $majorVersion = [int]((& node --version).TrimStart('v').Split('.')[0])
    if ($majorVersion -lt 22) {
        throw "Node.js 22 or newer is required; found $(& node --version)."
    }
}

function Invoke-MavenJdkCheck {
    Require-Command java 'Configure JDK 17 and put it on PATH.'
    Require-Command mvn 'Install Maven 3.9 or newer.'
    $mavenVersion = (& mvn --version 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect Maven's Java runtime (exit code $LASTEXITCODE)."
    }
    if ($mavenVersion -notmatch 'Java version: 17(?:[.\s]|$)') {
        throw "Backend and Edge Agent verification require Maven to use JDK 17. Maven reported:`n$mavenVersion"
    }
}

if (-not $SkipBackend) {
    Invoke-MavenJdkCheck
    foreach ($component in @('backend', 'edge-agent')) {
        Write-Host "==> ${component}: tests and package (JDK 17)"
        Invoke-InDirectory $component {
            Invoke-Native "$component Maven verify" { mvn --batch-mode --no-transfer-progress verify }
        }
    }
}

if (-not $SkipWeb) {
    Invoke-NodeCheck
    foreach ($app in @('frontend', 'console', 'client')) {
        Write-Host "==> ${app}: install and build"
        Invoke-InDirectory $app {
            Invoke-Native "$app npm ci" { npm ci }
            if ($app -eq 'client') {
                Invoke-Native 'client npm test' { npm test }
            }
            Invoke-Native "$app npm run build" { npm run build }
        }
    }
}

if (-not $SkipDeploy) {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        Write-Host '==> Deployment: Docker Compose and Caddy configuration'
        $previousDomain = $env:DOMAIN
        try {
            $env:DOMAIN = 'ci.example.test'
            Invoke-Native 'Docker Compose configuration validation' {
                docker compose -f (Join-Path $repositoryRoot 'deploy/docker-compose.yml') config --quiet
            }
            $caddyfile = Join-Path $repositoryRoot 'deploy/Caddyfile'
            Invoke-Native 'Caddy configuration validation' {
                docker run --rm -e DOMAIN=ci.example.test -v "${caddyfile}:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
            }
        }
        finally {
            $env:DOMAIN = $previousDomain
        }
    }
    else {
        Write-Warning 'Docker was not found. Deployment configuration validation was skipped.'
    }
}

if ($Android) {
    Invoke-NodeCheck
    if (-not $env:ANDROID_SDK_ROOT -and -not $env:ANDROID_HOME) {
        throw 'Set ANDROID_SDK_ROOT (or ANDROID_HOME) to an Android SDK containing API 36 and Build Tools 36.0.0.'
    }
    Write-Host '==> Android: Capacitor sync and debug APK build (JDK 21+ expected)'
    Invoke-InDirectory 'client' {
        Invoke-Native 'client npm ci' { npm ci }
        Invoke-Native 'client npm run build' { npm run build }
        Invoke-Native 'Capacitor Android sync' { npx cap sync android }
    }
    Invoke-InDirectory 'client/android' {
        Invoke-Native 'Android debug APK build' { .\gradlew.bat --no-daemon assembleDebug }
    }
}

Write-Host 'Verification completed successfully.'
