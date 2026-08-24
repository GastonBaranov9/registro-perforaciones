param(
  [Parameter(Mandatory=$true)][string]$EnvFile,
  [string]$DeploymentStateFile="",
  [Parameter(Mandatory=$true)][string]$ProjectName,
  [Parameter(Mandatory=$true)][string]$BackupDir,
  [Parameter(Mandatory=$true)][string]$Bundle,
  [Parameter(Mandatory=$true)][string]$Confirm,
  [string]$ComposeFile="docker-compose.production.yaml"
)
$ErrorActionPreference="Stop"
if($ProjectName-notmatch '^[a-z0-9][a-z0-9_-]+$'){throw "ProjectName no es seguro."}
if($Confirm-ne "RESTORE_EXISTING_TARGET_FROM_BACKUP"){throw "Confirm debe ser RESTORE_EXISTING_TARGET_FROM_BACKUP."}
if($Bundle-notmatch '^rsp-backup-\d{8}T\d{6}Z$'){throw "Bundle no reconocido."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path;$envPath=(Resolve-Path $EnvFile).Path;$composePath=(Resolve-Path (Join-Path $repo $ComposeFile)).Path;$backupPath=(Resolve-Path $BackupDir).Path
$bundlePath=(Resolve-Path (Join-Path $backupPath $Bundle)).Path
if([IO.Directory]::GetParent($bundlePath).FullName-ne $backupPath){throw "El bundle debe ser hijo directo de BackupDir."}
$env:BACKUP_DIR=$backupPath;$env:RESTORE_BUNDLE=$Bundle;$env:RESTORE_CONFIRM=$Confirm
$compose=@("--project-name",$ProjectName,"--env-file",$envPath)
if($DeploymentStateFile){$compose+=@("--env-file",(Resolve-Path $DeploymentStateFile).Path)}
$compose+=@("-f",$composePath)
& docker compose @compose stop api
if($LASTEXITCODE-ne 0){throw "No se pudo detener API antes del restore completo."}
& docker compose @compose --profile ops run --rm restore
if($LASTEXITCODE-ne 0){throw "Restore completo falló; mantener modo mantenimiento y revisar el bundle."}
Write-Output "RESTORE_FULL_OK=$Bundle"
