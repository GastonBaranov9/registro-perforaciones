param(
  [Parameter(Mandatory=$true)][string]$EnvFile,
  [Parameter(Mandatory=$true)][string]$DeploymentStateFile,
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
. (Join-Path $PSScriptRoot "deployment-state.ps1")
. (Join-Path $PSScriptRoot "deployment-audit.ps1")
if($ProjectName-notmatch '^[a-z0-9][a-z0-9_-]+$'){throw "ProjectName no es seguro."}
if($Level-eq 'Application' -and $Confirm-ne 'DATABASE_BACKWARD_COMPATIBLE'){throw "Rollback de aplicacion exige confirmar DATABASE_BACKWARD_COMPATIBLE."}
if($Level-eq 'Full' -and $Confirm-ne 'RESTORE_EXISTING_TARGET_FROM_BACKUP'){throw "Rollback completo exige RESTORE_EXISTING_TARGET_FROM_BACKUP."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path;$envPath=(Resolve-Path $EnvFile).Path;$deploymentPath=(Resolve-Path $DeploymentStateFile).Path;$composePath=(Resolve-Path (Join-Path $repo $ComposeFile)).Path;$resolvedState=(Resolve-Path $StateFile).Path
$state=Read-DeploymentAuditForRollback $resolvedState $ProjectName $deploymentPath
$current=Read-DeploymentState $deploymentPath
if($state.rollback_noop){
  if($current.ConfigHash-ne $state.previous_config_hash){throw "Preflight fallido pero deployment state no conserva N."}
  $state|Add-Member -Force NoteProperty rollback_status 'not_required';$state|Add-Member -Force NoteProperty rollback_at_utc ([DateTime]::UtcNow.ToString('o'));Write-DeploymentAuditAtomic $resolvedState $state
  Write-Output "ROLLBACK_NOT_REQUIRED";return
}
if($state.rollback_requires_full-and $Level-ne 'Full'){throw "El audit clasifica la DB como restore_required; exige rollback Full."}
if($Level-eq 'Full'-and-not $state.backup_completed){throw "Rollback Full exige una fase backup completada."}
$allowedHashes=if($state.status-eq 'success'-and $Level-eq 'Application'){@($state.target_config_hash)}else{@($state.previous_config_hash,$state.target_config_hash)}
if($current.ConfigHash-notin $allowedHashes){throw "El deployment state actual no pertenece al deploy auditado."}
$apiId=(& docker image inspect --format '{{.Id}}' $state.previous_api_ref|Out-String).Trim();$frontId=(& docker image inspect --format '{{.Id}}' $state.previous_front_ref|Out-String).Trim()
if($LASTEXITCODE-ne 0-or $apiId-ne $state.previous_api_id-or $frontId-ne $state.previous_front_id){throw "Las referencias previas ya no resuelven a las imagenes registradas; no se reconstruiran."}
$compose=@("--project-name",$ProjectName,"--env-file",$envPath,"--env-file",$deploymentPath,"-f",$composePath)
$savedEnvironment=@{};foreach($name in @('API_IMAGE_REF','FRONT_IMAGE_REF','APP_VERSION','GIT_SHA')){$savedEnvironment[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
function Log([string]$Event,[string]$Detail=""){Write-Output "[$([DateTime]::UtcNow.ToString('o'))] $Event $Detail".TrimEnd()}
function Compose([string[]]$Arguments){& docker compose @compose @Arguments;if($LASTEXITCODE-ne 0){throw "docker compose fallo: $($Arguments-join ' ')"}}
function Clear-DeploymentEnvironment{foreach($name in @('API_IMAGE_REF','FRONT_IMAGE_REF','APP_VERSION','GIT_SHA')){[Environment]::SetEnvironmentVariable($name,$null,'Process')}}
function Restore-DeploymentEnvironment{foreach($name in $savedEnvironment.Keys){[Environment]::SetEnvironmentVariable($name,$savedEnvironment[$name],'Process')}}
function Assert-ComposeState([object]$Expected){$json=(& docker compose @compose config --format json|Out-String);if($LASTEXITCODE-ne 0){throw "No se pudo renderizar Compose desde deployment state."};$config=$json|ConvertFrom-Json;if($config.services.api.image-ne $Expected.ApiImage-or $config.services.front.image-ne $Expected.FrontImage-or $config.services.api.environment.APP_VERSION-ne $Expected.AppVersion-or $config.services.api.environment.GIT_SHA-ne $Expected.GitSha){throw "Compose no reproduce el deployment state persistido."}}
$env:API_IMAGE_REF=[string]$state.previous_api_ref;$env:FRONT_IMAGE_REF=[string]$state.previous_front_ref;$env:APP_VERSION=[string]$state.previous_version;$env:GIT_SHA=[string]$state.previous_git_sha
try{
  Log "rollback_start" "level=$Level version=$($state.previous_version)"
  Compose @("config","--quiet");Compose @("stop","proxy");Compose @("--profile","ops","up","-d","--wait","--wait-timeout","60","maintenance");Compose @("stop","api")
  if($Level-eq 'Full'){
    if($state.backup_bundle-notmatch '^rsp-backup-\d{8}T\d{6}Z$'){throw "El registro no contiene un bundle previo valido."}
    Log "restore_start" "bundle=$($state.backup_bundle)"
    & (Join-Path $PSScriptRoot "restore-full.ps1") -EnvFile $envPath -DeploymentStateFile $deploymentPath -ProjectName $ProjectName -BackupDir $BackupDir -Bundle $state.backup_bundle -Confirm $Confirm -ComposeFile $ComposeFile
    Log "restore_ok"
  }else{Log "database_compatibility" "operator_confirmed=true"}
  Compose @("up","-d","--no-deps","--force-recreate","--wait","--wait-timeout","180","api","front")
  Compose @("stop","maintenance");Compose @("rm","-f","maintenance");Compose @("up","-d","--no-deps","--wait","--wait-timeout","180","proxy")
  Log "smoke_start"
  $smoke=& (Join-Path $PSScriptRoot "smoke.ps1") -EnvFile $envPath -DeploymentStateFile $deploymentPath -ProjectName $ProjectName -AdminEmail $SmokeAdminEmail -AdminPasswordFile $SmokeAdminPasswordFile -ComposeFile $ComposeFile
  if($smoke-notcontains 'SMOKE_OK'){throw "Smoke posterior al rollback fallo."}
  $written=Write-DeploymentStateAtomic $deploymentPath ([string]$state.previous_api_ref) ([string]$state.previous_front_ref) ([string]$state.previous_version) ([string]$state.previous_git_sha)
  Clear-DeploymentEnvironment;Assert-ComposeState $written
  $state|Add-Member -Force NoteProperty rollback_level $Level;$state|Add-Member -Force NoteProperty rollback_at_utc ([DateTime]::UtcNow.ToString('o'));$state|Add-Member -Force NoteProperty rollback_status 'success';Write-DeploymentAuditAtomic $resolvedState $state
  Log "deployment_state_ok" "config=$($written.ConfigHash)";Write-Output "ROLLBACK_OK"
}catch{
  $state|Add-Member -Force NoteProperty rollback_status 'failed';$state|Add-Member -Force NoteProperty rollback_failure 'Ver logs operativos anteriores.';Write-DeploymentAuditAtomic $resolvedState $state
  try{Compose @("stop","proxy");Compose @("--profile","ops","up","-d","--wait","--wait-timeout","60","maintenance")}catch{}
  Write-Output "ROLLBACK_FAILED";throw
}finally{Restore-DeploymentEnvironment}
