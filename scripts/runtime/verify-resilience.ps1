[CmdletBinding()]
param(
    [string]$ProjectName = 'iot-manager-p0',
    [string]$EnvironmentFile = 'deploy/.env.integration',
    [string]$StateFile = 'deploy/.runtime/iot-manager-p0/runtime.env',
    [int]$TimeoutSeconds = 240,
    [ValidateSet('RESILIENCE')]
    [string]$Confirm
)

# This verifier deliberately restarts and briefly pauses only the explicitly
# named integration Compose project. It proves that the production readiness
# probe fails closed on PostgreSQL loss, a normal restart preserves the live
# PostgreSQL volume, and a Backend that starts before PostgreSQL keeps retrying
# until its dependency returns. It is not a replacement for the protected PITR
# drill.

$ErrorActionPreference = 'Stop'
if ($Confirm -ne 'RESILIENCE') {
    throw 'Set -Confirm RESILIENCE to run controlled PostgreSQL restart/pause checks.'
}

$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Resolve-RepositoryPath {
    param([string]$Path)
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    return Join-Path $repositoryRoot $Path
}

$environmentPath = Resolve-RepositoryPath $EnvironmentFile
$statePath = Resolve-RepositoryPath $StateFile
if (-not (Test-Path -LiteralPath $environmentPath)) { throw "Environment file was not found: $environmentPath" }

function Invoke-Docker {
    param([string[]]$Arguments, [string]$Description)
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $result = & docker @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) { throw "$Description failed with exit code ${exitCode}: $result" }
    return $result
}

function Get-EnvironmentValue {
    param([string]$Key)
    $pattern = '^\s*' + [regex]::Escape($Key) + '=(.*)$'
    $line = Get-Content -LiteralPath $environmentPath -Encoding UTF8 |
        Where-Object { $_ -match $pattern } |
        Select-Object -Last 1
    if (-not $line) { throw "Required value was not found in the environment file: $Key" }
    $null = $line -match $pattern
    $value = $Matches[1].Trim()
    if (-not $value) { throw "Required value is empty in the environment file: $Key" }
    return $value
}

Invoke-Docker -Arguments @('info') -Description 'Docker Engine check' | Out-Null
$compose = @('compose', '--project-name', $ProjectName, '--profile', 'application', '--env-file', $environmentPath)
if (Test-Path -LiteralPath $statePath) { $compose += @('--env-file', $statePath) }
$compose += @('-f', (Join-Path $repositoryRoot 'deploy/docker-compose.yml'), '-f', (Join-Path $repositoryRoot 'deploy/docker-compose.integration.yml'))

function Get-ServiceContainerId {
    param(
        [string]$Service,
        [switch]$IncludeStopped
    )
    $psArguments = @('ps')
    if ($IncludeStopped) { $psArguments += '-a' }
    $psArguments += @('-q', $Service)
    return (Invoke-Docker -Arguments ($compose + $psArguments) -Description "Resolve container for $Service" | Out-String).Trim()
}

function Wait-ServiceHealthy {
    param([string]$Service)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $id = Get-ServiceContainerId -Service $Service
        $health = if ($id) {
            (Invoke-Docker -Arguments @('inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', $id) -Description "Inspect health for $Service" | Out-String).Trim()
        } else { 'none' }
        if ($health -eq 'healthy') { return }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)
    throw "Service did not become healthy after resilience check: $Service ($health)"
}

$bootstrapUser = Get-EnvironmentValue -Key 'POSTGRES_BOOTSTRAP_USERNAME'
$databaseName = Get-EnvironmentValue -Key 'IOT_DB_DATABASE'
function Get-PostgresSnapshot {
    param([string]$PostgresId)
    $queries = [ordered]@{
        migrations = 'SELECT count(*) FROM flyway_schema_history WHERE success'
        roles = 'SELECT count(*) FROM roles'
        devices = 'SELECT count(*) FROM devices'
        commands = 'SELECT count(*) FROM device_commands'
    }
    $values = [ordered]@{}
    foreach ($entry in $queries.GetEnumerator()) {
        $values[$entry.Key] = (Invoke-Docker -Arguments @('exec', '-u', 'postgres', $PostgresId, 'psql', '-U', $bootstrapUser, '-d', $databaseName, '-Atc', $entry.Value) -Description "Read PostgreSQL $($entry.Key) snapshot" | Out-String).Trim()
    }
    if ($values.migrations -ne '18') { throw "Expected 18 successful PostgreSQL migrations, found $($values.migrations)." }
    if ($values.roles -ne '4') { throw "Expected four platform role seeds, found $($values.roles)." }
    return ($values.Values -join '|')
}

Wait-ServiceHealthy -Service 'postgres'
Wait-ServiceHealthy -Service 'backend'
$resilienceStartedAt = (Get-Date).ToUniversalTime().ToString('o')
$postgresId = Get-ServiceContainerId -Service 'postgres'
$beforeSnapshot = Get-PostgresSnapshot -PostgresId $postgresId

# Compose restart policy is part of the deployment contract, not an inferred
# property of a successful manual restart. Assert every long-running database
# dependent service before exercising its normal and dependency-startup paths.
foreach ($service in @('backend', 'backup', 'wal-g-archive', 'wal-g-backup')) {
    $serviceId = Get-ServiceContainerId -Service $service
    if (-not $serviceId) { throw "Required service is missing for restart-policy verification: $service" }
    $restartPolicy = (Invoke-Docker -Arguments @('inspect', '--format', '{{.HostConfig.RestartPolicy.Name}}', $serviceId) -Description "Inspect restart policy for $service" | Out-String).Trim()
    if ($restartPolicy -ne 'unless-stopped') {
        throw "Service $service must use restart policy unless-stopped, found $restartPolicy"
    }
}

Invoke-Docker -Arguments ($compose + @('restart', 'postgres')) -Description 'Restart PostgreSQL for persistence verification' | Out-Null
Wait-ServiceHealthy -Service 'postgres'
Wait-ServiceHealthy -Service 'backend'
$postgresId = Get-ServiceContainerId -Service 'postgres'
$afterPostgresRestart = Get-PostgresSnapshot -PostgresId $postgresId
if ($afterPostgresRestart -ne $beforeSnapshot) {
    throw "PostgreSQL restart changed persisted platform counts: before=$beforeSnapshot after=$afterPostgresRestart"
}

Invoke-Docker -Arguments ($compose + @('restart', 'backend')) -Description 'Restart Backend for persistence verification' | Out-Null
Wait-ServiceHealthy -Service 'backend'
$backendId = Get-ServiceContainerId -Service 'backend'
$afterBackendRestart = Get-PostgresSnapshot -PostgresId $postgresId
if ($afterBackendRestart -ne $beforeSnapshot) {
    throw "Backend restart changed persisted platform counts: before=$beforeSnapshot after=$afterBackendRestart"
}

$paused = $false
$coldStartPending = $false
try {
    Invoke-Docker -Arguments @('pause', $postgresId) -Description 'Pause PostgreSQL for readiness fail-closed verification' | Out-Null
    $paused = $true
    Start-Sleep -Seconds 9
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $outageProbe = & docker exec $backendId /bin/sh -ec 'wget -S -O /dev/null http://127.0.0.1:8080/actuator/health/readiness 2>&1 || true' 2>&1
        $outageExit = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($outageExit -ne 0 -or ($outageProbe | Out-String) -notmatch 'HTTP/1\.1 503') {
        throw "Backend readiness did not report HTTP 503 while PostgreSQL was paused: $outageProbe"
    }

    Invoke-Docker -Arguments @('unpause', $postgresId) -Description 'Resume PostgreSQL after readiness verification' | Out-Null
    $paused = $false
    Wait-ServiceHealthy -Service 'postgres'
    Wait-ServiceHealthy -Service 'backend'

    # Restart Backend while PostgreSQL is stopped. The production Flyway retry
    # contract must keep the same Backend process alive for at least Docker's
    # restart-policy activation window, then PostgreSQL returning must make it
    # healthy without any additional Backend action.
    $coldStartPending = $true
    Invoke-Docker -Arguments ($compose + @('stop', 'postgres')) -Description 'Stop PostgreSQL for dependency-startup recovery verification' | Out-Null
    # `docker compose ps -q` reports only running containers. The explicit
    # all-state lookup makes this assertion prove the service was stopped
    # rather than mistaking a stopped container for a missing one.
    $postgresOutageId = Get-ServiceContainerId -Service 'postgres' -IncludeStopped
    $postgresOutageState = if ($postgresOutageId) {
        (Invoke-Docker -Arguments @('inspect', '--format', '{{.State.Status}}', $postgresOutageId) -Description 'Inspect stopped PostgreSQL dependency-startup state' | Out-String).Trim()
    } else { 'none' }
    if ($postgresOutageState -ne 'exited') {
        throw "PostgreSQL was not stopped before Backend dependency-startup verification: state=$postgresOutageState"
    }
    $backendStartupId = Get-ServiceContainerId -Service 'backend'
    if (-not $backendStartupId) { throw 'Backend container disappeared before dependency-startup verification.' }
    $backendRestartBaseline = (Invoke-Docker -Arguments @('inspect', '--format', '{{.RestartCount}}', $backendStartupId) -Description 'Inspect Backend restart count before dependency-startup verification' | Out-String).Trim()
    $backendStartedBefore = (Invoke-Docker -Arguments @('inspect', '--format', '{{.State.StartedAt}}', $backendStartupId) -Description 'Inspect Backend start time before dependency-startup verification' | Out-String).Trim()
    Invoke-Docker -Arguments @('restart', $backendStartupId) -Description 'Restart Backend before PostgreSQL for dependency-startup recovery verification' | Out-Null
    Start-Sleep -Seconds 12
    $backendObservedId = Get-ServiceContainerId -Service 'backend'
    if ($backendObservedId -ne $backendStartupId) { throw 'Backend container identity changed during application-level dependency retry.' }
    $backendStartupState = if ($backendStartupId) {
        (Invoke-Docker -Arguments @('inspect', '--format', '{{.State.Status}}', $backendStartupId) -Description 'Inspect Backend dependency-startup state' | Out-String).Trim()
    } else { 'none' }
    $backendStartupHealth = (Invoke-Docker -Arguments @('inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', $backendStartupId) -Description 'Inspect Backend dependency-startup health' | Out-String).Trim()
    $backendRestartObserved = (Invoke-Docker -Arguments @('inspect', '--format', '{{.RestartCount}}', $backendStartupId) -Description 'Inspect Backend restart count during dependency-startup verification' | Out-String).Trim()
    $backendStartedObserved = (Invoke-Docker -Arguments @('inspect', '--format', '{{.State.StartedAt}}', $backendStartupId) -Description 'Inspect Backend start time during dependency-startup verification' | Out-String).Trim()
    if ($backendStartupState -ne 'running') {
        throw "Backend exited instead of retrying its unavailable PostgreSQL dependency: state=$backendStartupState"
    }
    if ($backendStartupHealth -eq 'healthy') { throw 'Backend unexpectedly reported healthy while PostgreSQL was stopped.' }
    if ($backendRestartObserved -ne $backendRestartBaseline) {
        throw "Backend relied on Docker restart instead of Flyway in-process retry: before=$backendRestartBaseline after=$backendRestartObserved"
    }
    if ($backendStartedObserved -eq $backendStartedBefore) {
        throw 'Backend restart did not create a new startup attempt for dependency retry verification.'
    }
    Invoke-Docker -Arguments ($compose + @('start', 'postgres')) -Description 'Restore PostgreSQL after dependency-startup recovery verification' | Out-Null
    Wait-ServiceHealthy -Service 'postgres'
    Wait-ServiceHealthy -Service 'backend'
    $backendRestartAfterRecovery = (Invoke-Docker -Arguments @('inspect', '--format', '{{.RestartCount}}', $backendStartupId) -Description 'Inspect Backend restart count after dependency recovery' | Out-String).Trim()
    if ($backendRestartAfterRecovery -ne $backendRestartBaseline) {
        throw "Backend restarted during dependency recovery instead of completing the in-process Flyway retry: before=$backendRestartBaseline after=$backendRestartAfterRecovery"
    }
    $postgresId = Get-ServiceContainerId -Service 'postgres'
    $afterDependencyRecovery = Get-PostgresSnapshot -PostgresId $postgresId
    if ($afterDependencyRecovery -ne $beforeSnapshot) {
        throw "Dependency-startup recovery changed persisted platform counts: before=$beforeSnapshot after=$afterDependencyRecovery"
    }
    $scheduledTaskErrors = (Invoke-Docker -Arguments @('logs', '--since', $resilienceStartedAt, $backendStartupId) -Description 'Inspect Backend scheduled-task errors during resilience verification' | Out-String)
    if ($scheduledTaskErrors -match 'Unexpected error occurred in scheduled task') {
        throw 'Backend emitted an unhandled scheduled-task error during PostgreSQL resilience verification.'
    }
    $coldStartPending = $false
}
finally {
    if ($paused) {
        try { Invoke-Docker -Arguments @('unpause', $postgresId) -Description 'Resume PostgreSQL after readiness verification' | Out-Null }
        catch { Write-Warning "Cleanup could not resume PostgreSQL: $_" }
    }
    if ($coldStartPending) {
        # Failure-only recovery for the explicitly named test project. Backend
        # is not manually restarted here: its configured retry contract must
        # recover once PostgreSQL is available again.
        try { Invoke-Docker -Arguments ($compose + @('start', 'postgres')) -Description 'Cleanup PostgreSQL after dependency-startup recovery verification' | Out-Null }
        catch { Write-Warning "Cleanup could not restart PostgreSQL: $_" }
    }
}

$artifactDirectory = Join-Path $repositoryRoot ("artifacts/p0-runtime/{0}-resilience" -f (Get-Date -Format 'yyyyMMddTHHmmssZ'))
[System.IO.Directory]::CreateDirectory($artifactDirectory) | Out-Null
@(
    'postgres_restart_persistence=passed',
    'backend_restart_persistence=passed',
    'backend_restart_policy=unless-stopped',
    'postgres_outage_readiness=http_503',
    'postgres_recovery=healthy',
    'backend_dependency_startup_retry=passed',
    'backend_dependency_startup_outage_seconds=12',
    "backend_dependency_startup_state=$backendStartupState",
    "backend_dependency_startup_health=$backendStartupHealth",
    'backend_scheduled_task_errors=none',
    "dependency_startup_snapshot=$afterDependencyRecovery",
    "snapshot=$beforeSnapshot"
) | Set-Content -LiteralPath (Join-Path $artifactDirectory 'resilience-summary.txt') -Encoding UTF8

Write-Host "P0 resilience checks passed. Evidence directory: $artifactDirectory"
