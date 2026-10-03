[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$phoneProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$phoneEnvironment = Join-Path $phoneProjectRoot 'deploy/.runtime/iot-manager-p0/phone-lan.env'
if (-not (Test-Path -LiteralPath $phoneEnvironment)) { throw 'Phone LAN environment is missing. See deploy/DEPLOYMENT.md.' }
$phoneDomainLine = Get-Content -LiteralPath $phoneEnvironment | Where-Object { $_ -match '^DOMAIN=' } | Select-Object -Last 1
$phoneAddress = $phoneDomainLine.Substring(7).Trim()
if (-not (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -eq $phoneAddress })) {
    throw "This computer no longer has address $phoneAddress. Update LAN config and rebuild the public phone endpoints before starting."
}
$phoneDockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$phoneDocker = if ($phoneDockerCommand) { $phoneDockerCommand.Source } elseif ($env:IOT_DOCKER_CLI_PATH) { $env:IOT_DOCKER_CLI_PATH } else { Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe' }
if (-not $phoneDocker -or -not (Test-Path -LiteralPath $phoneDocker)) { throw 'Docker CLI not found. Set IOT_DOCKER_CLI_PATH for a nonstandard installation.' }
$phoneEngineVersion = & $phoneDocker info --format '{{.ServerVersion}}' 2>$null
if ($LASTEXITCODE -ne 0) {
    $phoneDockerDirectory = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $phoneDocker))
    $phoneDesktop = Join-Path $phoneDockerDirectory 'Docker Desktop.exe'
    if ($env:IOT_DOCKER_DESKTOP_EXE) { $phoneDesktop = $env:IOT_DOCKER_DESKTOP_EXE }
    if (-not (Test-Path -LiteralPath $phoneDesktop)) { throw 'Docker Engine is stopped and Docker Desktop was not found.' }
    $phonePreviousLocalAppData = $env:LOCALAPPDATA
    try {
        if ($env:IOT_DOCKER_DESKTOP_LOCALAPPDATA) { $env:LOCALAPPDATA = $env:IOT_DOCKER_DESKTOP_LOCALAPPDATA }
        Start-Process -FilePath $phoneDesktop -WindowStyle Hidden
    } finally { $env:LOCALAPPDATA = $phonePreviousLocalAppData }
    $phoneEngineDeadline = [DateTime]::UtcNow.AddSeconds(60)
    do {
        Start-Sleep -Seconds 2
        $phoneEngineVersion = & $phoneDocker info --format '{{.ServerVersion}}' 2>$null
        if ($LASTEXITCODE -eq 0) { break }
    } while ([DateTime]::UtcNow -lt $phoneEngineDeadline)
    if ($LASTEXITCODE -ne 0) { throw 'Docker Engine did not become available within 60 seconds.' }
}
$phoneArguments = @('compose', '--project-name', 'iot-manager-p0', '--profile', 'application')
foreach ($relativeEnv in @('deploy/.env.integration', 'deploy/.runtime/iot-manager-p0/runtime.env', 'deploy/.runtime/iot-manager-p0/phone-lan.env')) {
    $phoneArguments += @('--env-file', (Join-Path $phoneProjectRoot $relativeEnv))
}
foreach ($relativeCompose in @('deploy/docker-compose.yml', 'deploy/docker-compose.integration.yml', 'deploy/docker-compose.phone-lan.yml')) {
    $phoneArguments += @('-f', (Join-Path $phoneProjectRoot $relativeCompose))
}
& $phoneDocker @phoneArguments config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Phone Compose configuration is invalid.' }
& $phoneDocker @phoneArguments up -d --no-build --wait --wait-timeout 180
if ($LASTEXITCODE -ne 0) { throw 'Phone services did not reach healthy status.' }
& $phoneDocker @phoneArguments exec -T keycloak /bin/bash /opt/keycloak/bin/reconcile-glass-client.sh --verify-idempotent
if ($LASTEXITCODE -ne 0) { throw 'Glass login-client reconciliation failed.' }
Write-Output "Phone setup: http://$phoneAddress/mobile/"
Write-Output "Glass App: https://$phoneAddress/glass/"
