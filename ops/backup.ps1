param(
  [Parameter(Mandatory = $true)][string]$EnvFile,
  [Parameter(Mandatory = $true)][string]$ProjectName,
  [Parameter(Mandatory = $true)][string]$BackupDir,
  [string]$ComposeFile = "docker-compose.production.yaml"
)

$ErrorActionPreference = "Stop"
if ($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]+$') { throw "ProjectName no es seguro." }
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envPath = (Resolve-Path $EnvFile).Path
$composePath = (Resolve-Path (Join-Path $repo $ComposeFile)).Path
$backupPath = [IO.Path]::GetFullPath($BackupDir)
[IO.Directory]::CreateDirectory($backupPath) | Out-Null
$env:BACKUP_DIR = $backupPath
$compose = @("--project-name", $ProjectName, "--env-file", $envPath, "-f", $composePath)

function Invoke-Compose {
  param([string[]]$Arguments)
  & docker compose @compose @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose falló: $($Arguments -join ' ')" }
}

$apiRunning = ((& docker compose @compose ps --status running -q api | Out-String).Trim()).Length -gt 0
try {
  if ($apiRunning) { Invoke-Compose -Arguments @("stop", "api") }
  Invoke-Compose -Arguments @("--profile", "ops", "run", "--rm", "backup")
}
finally {
  if ($apiRunning) { Invoke-Compose -Arguments @("up", "-d", "--wait", "--wait-timeout", "180", "api") }
}
