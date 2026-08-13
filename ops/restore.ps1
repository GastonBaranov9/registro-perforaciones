param(
  [Parameter(Mandatory = $true)][string]$EnvFile,
  [Parameter(Mandatory = $true)][string]$ProjectName,
  [Parameter(Mandatory = $true)][string]$BackupDir,
  [Parameter(Mandatory = $true)][string]$Bundle,
  [Parameter(Mandatory = $true)][string]$Confirm,
  [string]$ComposeFile = "docker-compose.production.yaml"
)

$ErrorActionPreference = "Stop"
if ($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]+$') { throw "ProjectName no es seguro." }
if ($Confirm -ne "RESTORE_EMPTY_TARGET") { throw "Confirm debe ser exactamente RESTORE_EMPTY_TARGET." }
if ($Bundle -notmatch '^rsp-backup-\d{8}T\d{6}Z$') { throw "Bundle no reconocido." }
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envPath = (Resolve-Path $EnvFile).Path
$composePath = (Resolve-Path (Join-Path $repo $ComposeFile)).Path
$backupPath = (Resolve-Path $BackupDir).Path
$bundlePath = (Resolve-Path (Join-Path $backupPath $Bundle)).Path
if ([IO.Directory]::GetParent($bundlePath).FullName -ne $backupPath) { throw "El bundle debe ser hijo directo de BackupDir." }
$env:BACKUP_DIR = $backupPath
$env:RESTORE_BUNDLE = $Bundle
$env:RESTORE_CONFIRM = $Confirm
$compose = @("--project-name", $ProjectName, "--env-file", $envPath, "-f", $composePath)

function Invoke-Compose {
  param([string[]]$Arguments)
  & docker compose @compose @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose falló: $($Arguments -join ' ')" }
}

$ok = $false
try {
  Invoke-Compose -Arguments @("stop", "api")
  Invoke-Compose -Arguments @("--profile", "ops", "run", "--rm", "restore")
  $ok = $true
}
finally {
  if ($ok) {
    Invoke-Compose -Arguments @("up", "-d", "--wait", "--wait-timeout", "180", "api")
    Invoke-Compose -Arguments @("exec", "-T", "api", "node", "-e", "fetch('http://127.0.0.1:3000/ready').then(async r=>{if(!r.ok)throw new Error(await r.text())}).catch(()=>process.exit(1))")
  }
}
