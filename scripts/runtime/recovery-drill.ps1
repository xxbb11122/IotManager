[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupFile,
    [string]$SourceProjectName = 'iot-manager-p0',
    [string]$RecoveryProjectName = 'iot-manager-p0-recovery',
    [string]$EnvironmentFile = 'deploy/.env.integration',
    [ValidateSet('RESTORE')]
    [string]$Confirm
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Resolve-RepositoryPath {
    param([string]$Path)
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    return Join-Path $repositoryRoot $Path
}

$environmentPath = Resolve-RepositoryPath $EnvironmentFile
if ($Confirm -ne 'RESTORE') { throw 'Set -Confirm RESTORE after validating the independent recovery target.' }
if ($RecoveryProjectName -eq $SourceProjectName) { throw 'Recovery project must differ from the running source project.' }
if (-not (Test-Path -LiteralPath $environmentPath)) { throw "Environment file was not found: $environmentPath" }
$backupPath = (Resolve-Path -LiteralPath $BackupFile).Path
if (-not $backupPath.EndsWith('.dump')) { throw 'BackupFile must be a PostgreSQL custom-format .dump file.' }
$checksumPath = "$backupPath.sha256"
if (-not (Test-Path -LiteralPath $checksumPath)) {
    throw "Backup checksum sidecar was not found: $checksumPath"
}
$backupFileName = [System.IO.Path]::GetFileName($backupPath)
$checksumFileName = "$backupFileName.sha256"

function Get-EnvironmentValue {
    param([string]$Key)
    $pattern = '^\s*' + [regex]::Escape($Key) + '=(.*)$'
    $line = Get-Content -LiteralPath $environmentPath -Encoding UTF8 |
        Where-Object { $_ -match $pattern } |
        Select-Object -Last 1
    if (-not $line) { throw "Required value was not found in the environment file: $Key" }
    $null = $line -match $pattern
    return $Matches[1].Trim()
}

function Invoke-Docker {
    param([string[]]$Arguments, [string]$Description)
    # Docker Desktop may emit informational warnings to STDERR on successful
    # calls; PowerShell 5.1 otherwise converts them into terminating errors.
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & docker @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) { throw "$Description failed with exit code ${exitCode}: $output" }
    return $output
}

Invoke-Docker -Arguments @('info') -Description 'Docker Engine check' | Out-Null
$volumeName = "$RecoveryProjectName`_postgres-data"
# A missing volume is the expected first-run case. Docker Desktop writes that
# expected lookup failure to STDERR, which PowerShell 5.1 otherwise promotes
# to a terminating NativeCommandError under ErrorActionPreference=Stop.
$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $null = & docker volume inspect $volumeName 2>&1
    $volumeInspectExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
if ($volumeInspectExitCode -eq 0) {
    throw "Refusing recovery because target volume already exists: $volumeName. Choose a new RecoveryProjectName."
}

$compose = @('compose', '--project-name', $RecoveryProjectName, '--env-file', $environmentPath,
    '-f', (Join-Path $repositoryRoot 'deploy/docker-compose.yml'), '-f', (Join-Path $repositoryRoot 'deploy/docker-compose.integration.yml'))
$bootstrapUser = Get-EnvironmentValue -Key 'POSTGRES_BOOTSTRAP_USERNAME'
$databaseName = Get-EnvironmentValue -Key 'IOT_DB_DATABASE'
$ownerUsername = Get-EnvironmentValue -Key 'IOT_DB_OWNER_USERNAME'
$expectedFlywayVersion = if ($env:IOT_EXPECTED_FLYWAY_VERSION) { $env:IOT_EXPECTED_FLYWAY_VERSION } else { '18' }
$requiredRoleCodes = if ($env:IOT_REQUIRED_ROLE_CODES) { $env:IOT_REQUIRED_ROLE_CODES } else { 'OWNER,ADMIN,OPERATOR,VIEWER' }
if ([string]::IsNullOrWhiteSpace($expectedFlywayVersion)) { throw 'IOT_EXPECTED_FLYWAY_VERSION must not be empty.' }
if ($requiredRoleCodes -notmatch '^[A-Z]+(,[A-Z]+)*$') { throw 'IOT_REQUIRED_ROLE_CODES must be a comma-separated uppercase role-code list.' }
$requiredRoleCodes = (($requiredRoleCodes -split ',' | Sort-Object -Unique) -join ',')
Invoke-Docker -Arguments ($compose + @('up', '-d', '--build', 'volume-init', 'postgres')) -Description 'Start isolated recovery PostgreSQL' | Out-Null

$deadline = (Get-Date).AddSeconds(120)
do {
    $postgresId = (Invoke-Docker -Arguments ($compose + @('ps', '-q', 'postgres')) -Description 'Resolve recovery PostgreSQL' | Out-String).Trim()
    $health = if ($postgresId) { (Invoke-Docker -Arguments @('inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', $postgresId) -Description 'Inspect recovery PostgreSQL health' | Out-String).Trim() } else { 'none' }
    if ($health -eq 'healthy') { break }
    Start-Sleep -Seconds 3
} while ((Get-Date) -lt $deadline)
if ($health -ne 'healthy') { throw 'Isolated recovery PostgreSQL did not become healthy.' }

$restoreArgs = $compose + @('--profile', 'application', 'run', '--rm', '--no-deps',
    '-e', 'PGHOST=postgres',
    '-e', 'PGPORT=5432',
    '-e', "PGUSER=$ownerUsername",
    '-e', 'PGPASSWORD_SECRET_FILE=/run/secrets/iot_db_owner_password',
    '-e', 'IOT_RESTORE_CONFIRM=RESTORE',
    '-v', "$backupPath`:/restore/$backupFileName`:ro",
    '-v', "$checksumPath`:/restore/$checksumFileName`:ro",
    'backup', '/bin/sh', '/scripts/restore.sh', "/restore/$backupFileName")
Invoke-Docker -Arguments $restoreArgs -Description 'Restore logical backup into isolated PostgreSQL' | Out-Null

# The logical restore uses the constrained owner role through the backup
# helper. For verification, query locally inside the isolated PostgreSQL
# container as its bootstrap admin. Passing psql arguments separately avoids
# Windows Docker CLI quoting from swallowing its one-line result.
$latestFlywayVersion = (Invoke-Docker -Arguments @('exec', '-u', 'postgres', $postgresId, 'psql', '-U', $bootstrapUser, '-d', $databaseName,
    '-Atc', 'SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1') -Description 'Verify recovered Flyway version' | Out-String).Trim()
if ($latestFlywayVersion -ne $expectedFlywayVersion) { throw "Recovered Flyway version is $latestFlywayVersion; expected $expectedFlywayVersion." }
$failedMigrationCount = (Invoke-Docker -Arguments @('exec', '-u', 'postgres', $postgresId, 'psql', '-U', $bootstrapUser, '-d', $databaseName,
    '-Atc', 'SELECT count(*) FROM flyway_schema_history WHERE NOT success') -Description 'Verify recovered Flyway failures' | Out-String).Trim()
if ($failedMigrationCount -notmatch '^0$') { throw "Recovered database contains $failedMigrationCount failed Flyway migration row(s)." }

# A Flyway row count alone cannot prove that the restored schema is useful.
# Verify the critical authorization, device, weather and agent tables, then
# use the restricted application role for an isolated read/write transaction.
$requiredTableCount = (Invoke-Docker -Arguments @('exec', '-u', 'postgres', $postgresId, 'psql', '-U', $bootstrapUser, '-d', $databaseName,
    '-Atc', "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('devices', 'app_users', 'roles', 'agent_credentials', 'site_weather_snapshots', 'weather_provider_access_events')") -Description 'Verify recovered critical tables' | Out-String).Trim()
if ($requiredTableCount -notmatch '^6$') { throw "Recovered database is missing required platform tables; found $requiredTableCount of 6." }

$roleSql = "SELECT coalesce(string_agg(code, ',' ORDER BY code), '') FROM roles WHERE code = ANY(string_to_array('$requiredRoleCodes', ','))"
$recoveredRoleCodes = (Invoke-Docker -Arguments @('exec', '-u', 'postgres', $postgresId, 'psql', '-U', $bootstrapUser, '-d', $databaseName,
    '-Atc', $roleSql) -Description 'Verify recovered role seed data' | Out-String).Trim()
if ($recoveredRoleCodes -ne $requiredRoleCodes) { throw "Recovered database is missing required role codes: expected $requiredRoleCodes, found $recoveredRoleCodes." }

# The backup service mounts only the migration/backup owner credential. Run
# this application-role transaction through PostgreSQL's local helper, where
# the app secret is needed for database initialization but is not exposed to
# the operational backup sidecar. Every psql argument stays separate, avoiding
# PowerShell native-command quote rewriting.
$applicationProbeSql = "BEGIN; CREATE TEMP TABLE iot_recovery_write_probe (id integer NOT NULL); INSERT INTO iot_recovery_write_probe (id) VALUES (1); SELECT count(*) FROM iot_recovery_write_probe; ROLLBACK; SELECT has_schema_privilege(current_user, 'public', 'USAGE'); SELECT has_table_privilege(current_user, 'public.devices', 'SELECT,INSERT,UPDATE,DELETE');"
$applicationProbeArgs = $compose + @('exec', '-T', 'postgres', 'application-role-psql.sh', '-v', 'ON_ERROR_STOP=1', '-Atc', $applicationProbeSql)
$applicationProbeOutput = Invoke-Docker -Arguments $applicationProbeArgs -Description 'Verify recovered application-role read/write transaction' | Out-String
if ($applicationProbeOutput -notmatch '(?m)^1\s*$') { throw 'Recovered database did not complete the application-role read/write transaction.' }
if ([regex]::Matches($applicationProbeOutput, '(?m)^t\s*$').Count -ne 2) { throw 'Recovered database did not retain required application privileges on the public schema and devices table.' }

Write-Host "Logical recovery drill passed in isolated project: $RecoveryProjectName"
Write-Host "The recovery project and volume were intentionally retained for inspection. Stop it with docker compose --project-name $RecoveryProjectName down (without -v)."
