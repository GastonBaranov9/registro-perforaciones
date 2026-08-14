param(
  [Parameter(Mandatory=$true)][string]$EnvFile,
  [Parameter(Mandatory=$true)][string]$ProjectName,
  [Parameter(Mandatory=$true)][string]$StateFile,
  [Parameter(Mandatory=$true)][ValidateSet("Application","Full")][string]$Level,
  [Parameter(Mandatory=$true)][string]$Confirm,
  [Parameter(Mandatory=$true)][string]$BackupDir,
  [Parameter(Mandatory=$true)][string]$SmokeAdminEmail,
  [Parameter(Mandatory=$true)][string]$SmokeAdminPasswordFile,
  [string]$ComposeFile="docker-compose.production.yaml"
)
$ErrorActionPreference="Stop"
if($ProjectName-notmatch '^[a-z0-9][a-z0-9_-]+$'){throw "ProjectName no es seguro."}
if($Level-eq 'Application' -and $Confirm-ne 'DATABASE_BACKWARD_COMPATIBLE'){throw "Rollback de aplicación exige confirmar DATABASE_BACKWARD_COMPATIBLE."}
if($Level-eq 'Full' -and $Confirm-ne 'RESTORE_EXISTING_TARGET_FROM_BACKUP'){throw "Rollback completo exige RESTORE_EXISTING_TARGET_FROM_BACKUP."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path;$envPath=(Resolve-Path $EnvFile).Path;$composePath=(Resolve-Path (Join-Path $repo $ComposeFile)).Path;$resolvedState=(Resolve-Path $StateFile).Path
$state=Get-Content -Raw -LiteralPath $resolvedState|ConvertFrom-Json
if($state.format-ne 1-or $state.project-ne $ProjectName){throw "El registro de deploy no corresponde al proyecto."}
if($state.previous_api_ref-notmatch '^[A-Za-z0-9][A-Za-z0-9._/@:-]+$' -or $state.previous_front_ref-notmatch '^[A-Za-z0-9][A-Za-z0-9._/@:-]+$'){throw "El registro no contiene referencias previas seguras."}
$apiId=(& docker image inspect --format '{{.Id}}' $state.previous_api_ref|Out-String).Trim();$frontId=(& docker image inspect --format '{{.Id}}' $state.previous_front_ref|Out-String).Trim()
if($LASTEXITCODE-ne 0-or $apiId-ne $state.previous_api_id-or $frontId-ne $state.previous_front_id){throw "Las referencias previas ya no resuelven a las imágenes registradas; no se reconstruirán."}
$compose=@("--project-name",$ProjectName,"--env-file",$envPath,"-f",$composePath)
function Log([string]$Event,[string]$Detail=""){Write-Output "[$([DateTime]::UtcNow.ToString('o'))] $Event $Detail".TrimEnd()}
function Compose([string[]]$Arguments){& docker compose @compose @Arguments;if($LASTEXITCODE-ne 0){throw "docker compose falló: $($Arguments-join ' ')"}}
$oldApi=$env:API_IMAGE_REF;$oldFront=$env:FRONT_IMAGE_REF;$oldVersion=$env:APP_VERSION;$oldSha=$env:GIT_SHA
$env:API_IMAGE_REF=[string]$state.previous_api_ref;$env:FRONT_IMAGE_REF=[string]$state.previous_front_ref;$env:APP_VERSION=[string]$state.previous_version;$env:GIT_SHA=[string]$state.previous_git_sha
try{
  Log "rollback_start" "level=$Level version=$($state.previous_version)"
  Compose @("config","--quiet")
  Compose @("stop","proxy");Compose @("--profile","ops","up","-d","--wait","--wait-timeout","60","maintenance");Compose @("stop","api")
  if($Level-eq 'Full'){
    if($state.backup_bundle-notmatch '^rsp-backup-\d{8}T\d{6}Z$'){throw "El registro no contiene un bundle previo válido."}
    Log "restore_start" "bundle=$($state.backup_bundle)"
    & (Join-Path $PSScriptRoot "restore-full.ps1") -EnvFile $envPath -ProjectName $ProjectName -BackupDir $BackupDir -Bundle $state.backup_bundle -Confirm $Confirm -ComposeFile $ComposeFile
    if($LASTEXITCODE-ne 0){throw "Restore completo falló."};Log "restore_ok"
  }else{Log "database_compatibility" "operator_confirmed=true"}
  Compose @("up","-d","--no-deps","--force-recreate","--wait","--wait-timeout","180","api","front")
  Compose @("stop","maintenance");Compose @("rm","-f","maintenance");Compose @("up","-d","--no-deps","--wait","--wait-timeout","180","proxy")
  Log "smoke_start"
  $smoke=& (Join-Path $PSScriptRoot "smoke.ps1") -EnvFile $envPath -ProjectName $ProjectName -AdminEmail $SmokeAdminEmail -AdminPasswordFile $SmokeAdminPasswordFile -ComposeFile $ComposeFile
  if($LASTEXITCODE-ne 0-or $smoke-notcontains 'SMOKE_OK'){throw "Smoke posterior al rollback falló."}
  $state|Add-Member -Force NoteProperty rollback_level $Level;$state|Add-Member -Force NoteProperty rollback_at_utc ([DateTime]::UtcNow.ToString('o'));$state|Add-Member -Force NoteProperty rollback_status 'success';$state|ConvertTo-Json|Set-Content -LiteralPath $resolvedState -Encoding utf8
  Write-Output "ROLLBACK_OK"
}catch{
  $state|Add-Member -Force NoteProperty rollback_status 'failed';$state|Add-Member -Force NoteProperty rollback_failure $_.Exception.Message;$state|ConvertTo-Json|Set-Content -LiteralPath $resolvedState -Encoding utf8
  Write-Output "ROLLBACK_FAILED";throw
}finally{
  if($null-eq $oldApi){Remove-Item Env:API_IMAGE_REF -ErrorAction SilentlyContinue}else{$env:API_IMAGE_REF=$oldApi};if($null-eq $oldFront){Remove-Item Env:FRONT_IMAGE_REF -ErrorAction SilentlyContinue}else{$env:FRONT_IMAGE_REF=$oldFront};if($null-eq $oldVersion){Remove-Item Env:APP_VERSION -ErrorAction SilentlyContinue}else{$env:APP_VERSION=$oldVersion};if($null-eq $oldSha){Remove-Item Env:GIT_SHA -ErrorAction SilentlyContinue}else{$env:GIT_SHA=$oldSha}
}
