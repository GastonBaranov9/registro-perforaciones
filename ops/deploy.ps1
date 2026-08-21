param(
  [Parameter(Mandatory=$true)][string]$EnvFile,
  [Parameter(Mandatory=$true)][string]$DeploymentStateFile,
  [Parameter(Mandatory=$true)][string]$ProjectName,
  [Parameter(Mandatory=$true)][string]$BackupDir,
  [Parameter(Mandatory=$true)][string]$StateDir,
  [Parameter(Mandatory=$true)][string]$TargetApiImage,
  [Parameter(Mandatory=$true)][string]$TargetFrontImage,
  [Parameter(Mandatory=$true)][string]$TargetVersion,
  [Parameter(Mandatory=$true)][string]$GitSha,
  [Parameter(Mandatory=$true)][string]$SmokeAdminEmail,
  [Parameter(Mandatory=$true)][string]$SmokeAdminPasswordFile,
  [switch]$BuildImages,
  [ValidateSet("","preflight","maintenance","photo_storage","backup","images","migrate","services","services_incompatible","health","smoke","persist_state")][string]$TestFailAfterPhase="",
  [int]$TestPhotoCopyFailAfter=0,
  [string]$ComposeFile="docker-compose.production.yaml"
)
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "deployment-state.ps1")
. (Join-Path $PSScriptRoot "deployment-audit.ps1")
if($ProjectName-notmatch '^[a-z0-9][a-z0-9_-]+$'){throw "ProjectName no es seguro."}
Assert-DeploymentImageRef $TargetApiImage;Assert-DeploymentImageRef $TargetFrontImage
Assert-DeploymentIdentifier "APP_VERSION" $TargetVersion;Assert-DeploymentIdentifier "GIT_SHA" $GitSha
if(($TestFailAfterPhase-or $TestPhotoCopyFailAfter-gt 0)-and $ProjectName-notmatch '^rsp07f-r[23]-[a-z0-9_-]+$'){throw "La inyeccion de fallo solo se permite en proyectos RSP-07F-R2/R3 aislados."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path;$envPath=(Resolve-Path $EnvFile).Path;$deploymentPath=(Resolve-Path $DeploymentStateFile).Path;$composePath=(Resolve-Path (Join-Path $repo $ComposeFile)).Path
$backupPath=[IO.Path]::GetFullPath($BackupDir);$statePath=[IO.Path]::GetFullPath($StateDir);[IO.Directory]::CreateDirectory($backupPath)|Out-Null;[IO.Directory]::CreateDirectory($statePath)|Out-Null
$compose=@("--project-name",$ProjectName,"--env-file",$envPath,"--env-file",$deploymentPath,"-f",$composePath)
$auditFile=Join-Path $statePath "deploy-$ProjectName.json"
$previous=Read-DeploymentState $deploymentPath
$savedEnvironment=@{}
foreach($name in @('API_IMAGE_REF','FRONT_IMAGE_REF','APP_VERSION','GIT_SHA')){$savedEnvironment[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
$maintenance=$false;$persisted=$false
function Log([string]$Event,[string]$Detail=""){Write-Output "[$([DateTime]::UtcNow.ToString('o'))] $Event $Detail".TrimEnd()}
function Compose([string[]]$Arguments){& docker compose @compose @Arguments;if($LASTEXITCODE-ne 0){throw "docker compose fallo: $($Arguments-join ' ')"}}
function Clear-DeploymentEnvironment{foreach($name in @('API_IMAGE_REF','FRONT_IMAGE_REF','APP_VERSION','GIT_SHA')){[Environment]::SetEnvironmentVariable($name,$null,'Process')}}
function Set-DeploymentEnvironment([string]$Api,[string]$Front,[string]$Version,[string]$Sha){$env:API_IMAGE_REF=$Api;$env:FRONT_IMAGE_REF=$Front;$env:APP_VERSION=$Version;$env:GIT_SHA=$Sha}
function Restore-DeploymentEnvironment{foreach($name in $savedEnvironment.Keys){[Environment]::SetEnvironmentVariable($name,$savedEnvironment[$name],'Process')}}
function ContainerValue([string]$Service,[string]$Format){$id=(& docker compose @compose ps -q $Service|Out-String).Trim();if(-not $id){throw "No hay contenedor previo para $Service."};$value=(& docker inspect --format $Format $id|Out-String).Trim();if($LASTEXITCODE-ne 0-or-not $value){throw "No se pudo inspeccionar $Service."};return $value}
function EnvVersion([string]$Service){$id=(& docker compose @compose ps -q $Service|Out-String).Trim();$line=(& docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' $id|Select-String '^APP_VERSION='|Select-Object -First 1).Line;return $(if($line){($line-split '=',2)[1]}else{'unknown'})}
function Assert-ComposeState([object]$Expected){
  $json=(& docker compose @compose config --format json|Out-String);if($LASTEXITCODE-ne 0){throw "No se pudo renderizar Compose desde deployment state."}
  $config=$json|ConvertFrom-Json
  if($config.services.api.image-ne $Expected.ApiImage-or $config.services.front.image-ne $Expected.FrontImage-or $config.services.api.environment.APP_VERSION-ne $Expected.AppVersion-or $config.services.api.environment.GIT_SHA-ne $Expected.GitSha){throw "Compose no reproduce el deployment state persistido."}
}
function Test-PhaseFailure([string]$Phase){if($TestFailAfterPhase-eq $Phase){throw "Fallo controlado RSP-07F-R2 despues de $Phase."}}

$audit=[ordered]@{format=3;project=$ProjectName;started_at_utc=[DateTime]::UtcNow.ToString('o');updated_at_utc=[DateTime]::UtcNow.ToString('o');status='started';phase_started='preflight';phase_completed='none';database_recovery='not_required';legacy_schema_without_ledger=$false;deployment_state=$deploymentPath;deployment_state_persisted=$false;previous_config_hash=$previous.ConfigHash;previous_api_ref=$previous.ApiImage;previous_api_id='';previous_front_ref=$previous.FrontImage;previous_front_id='';previous_version=$previous.AppVersion;previous_git_sha=$previous.GitSha;target_config_hash=(Get-DeploymentConfigHash $TargetApiImage $TargetFrontImage $TargetVersion $GitSha);target_api_ref=$TargetApiImage;target_front_ref=$TargetFrontImage;target_version=$TargetVersion;git_sha=$GitSha;backup_bundle=''}
$previousApiContainerId='';$previousProxyContainerId=''
try{
  Write-DeploymentAuditAtomic $auditFile $audit
  Clear-DeploymentEnvironment
  Log "deploy_start" "target=$TargetVersion config=$($audit.target_config_hash)"
  Assert-ComposeState $previous;Compose @("config","--quiet")
  $runningApi=ContainerValue "api" '{{.Config.Image}}';$runningFront=ContainerValue "front" '{{.Config.Image}}';$runningVersion=EnvVersion "api"
  if($runningApi-ne $previous.ApiImage-or $runningFront-ne $previous.FrontImage-or $runningVersion-ne $previous.AppVersion){throw "El runtime no coincide con el deployment state previo; reconciliar antes de desplegar."}
  $previousApiContainerId=(& docker compose @compose ps -a -q api|Out-String).Trim();$previousProxyContainerId=(& docker compose @compose ps -a -q proxy|Out-String).Trim()
  if(-not $previousApiContainerId-or-not $previousProxyContainerId){throw "Faltan containers previos necesarios para una recuperación sin recreate."}
  $audit.previous_api_id=ContainerValue "api" '{{.Image}}';$audit.previous_front_id=ContainerValue "front" '{{.Image}}'
  Complete-DeploymentAuditPhase $audit 'preflight' $auditFile;Test-PhaseFailure 'preflight'

  Set-DeploymentEnvironment $TargetApiImage $TargetFrontImage $TargetVersion $GitSha
  Compose @("config","--quiet")
  if($BuildImages){Log "image_build_start";Compose @("build","api","front")}else{Log "image_pull_start";Compose @("pull","api","front")}

  Start-DeploymentAuditPhase $audit 'maintenance' $auditFile
  Log "maintenance_start"
  Compose @("stop","proxy");Compose @("--profile","ops","up","-d","--wait","--wait-timeout","60","maintenance");$maintenance=$true
  Compose @("stop","api")
  Complete-DeploymentAuditPhase $audit 'maintenance' $auditFile;Test-PhaseFailure 'maintenance'

  Start-DeploymentAuditPhase $audit 'photo_storage' $auditFile
  Log "photo_storage_start"
  $prepareArgs=@{EnvFile=$envPath;DeploymentStateFile=$deploymentPath;ProjectName=$ProjectName;ComposeFile=$ComposeFile}
  if($TestPhotoCopyFailAfter-gt 0){$prepareArgs.TestFailAfter=$TestPhotoCopyFailAfter}
  $photoOutput=(& (Join-Path $PSScriptRoot "prepare-photo-storage.ps1") @prepareArgs|Out-String)
  if($photoOutput-notmatch 'PHOTO_STORAGE_READY[\s\S]*DB_LEDGER=(present|absent)'){throw "La preparación de fotos no produjo evidencia válida."}
  $audit.legacy_schema_without_ledger=($matches[1]-eq 'absent')
  Complete-DeploymentAuditPhase $audit 'photo_storage' $auditFile;Log "photo_storage_ok";Test-PhaseFailure 'photo_storage'

  Start-DeploymentAuditPhase $audit 'backup' $auditFile
  Log "backup_start"
  $backupOutput=(& (Join-Path $PSScriptRoot "backup.ps1") -EnvFile $envPath -DeploymentStateFile $deploymentPath -ProjectName $ProjectName -BackupDir $backupPath -ComposeFile $ComposeFile|Out-String)
  $match=[regex]::Match($backupOutput,'BACKUP_BUNDLE=(rsp-backup-\d{8}T\d{6}Z)');if(-not $match.Success){throw "El backup previo no produjo un bundle valido."};$audit.backup_bundle=$match.Groups[1].Value
  Complete-DeploymentAuditPhase $audit 'backup' $auditFile;Log "backup_ok" "bundle=$($audit.backup_bundle)";Test-PhaseFailure 'backup'

  Start-DeploymentAuditPhase $audit 'images' $auditFile
  Compose @("config","--quiet")
  Complete-DeploymentAuditPhase $audit 'images' $auditFile;Test-PhaseFailure 'images'
  $audit.database_recovery='operator_assessment_required'
  Start-DeploymentAuditPhase $audit 'migrate' $auditFile
  Log "migrate_start"
  if($audit.legacy_schema_without_ledger){Compose @("--profile","ops","run","--rm","migrate","npm","run","db:migrate","--","--adopt-current-schema")}else{Compose @("--profile","ops","run","--rm","migrate")}
  Log "migrate_ok";Complete-DeploymentAuditPhase $audit 'migrate' $auditFile;Test-PhaseFailure 'migrate'
  Start-DeploymentAuditPhase $audit 'services' $auditFile
  Log "services_start";Compose @("up","-d","--no-deps","--wait","--wait-timeout","180","api","front")
  Compose @("stop","maintenance");Compose @("rm","-f","maintenance");$maintenance=$false
  Compose @("up","-d","--no-deps","--wait","--wait-timeout","180","proxy")
  Complete-DeploymentAuditPhase $audit 'services' $auditFile
  if($TestFailAfterPhase-eq 'services_incompatible'){$audit.database_recovery='restore_required';Write-DeploymentAuditAtomic $auditFile $audit;throw "Fallo incompatible controlado RSP-07F-R2 despues de services."}
  Test-PhaseFailure 'services'
  Start-DeploymentAuditPhase $audit 'health' $auditFile;Log "health_ok";Complete-DeploymentAuditPhase $audit 'health' $auditFile;Test-PhaseFailure 'health'
  Start-DeploymentAuditPhase $audit 'smoke' $auditFile;Log "smoke_start"
  $smoke=& (Join-Path $PSScriptRoot "smoke.ps1") -EnvFile $envPath -DeploymentStateFile $deploymentPath -ProjectName $ProjectName -AdminEmail $SmokeAdminEmail -AdminPasswordFile $SmokeAdminPasswordFile -ComposeFile $ComposeFile
  if($smoke-notcontains "SMOKE_OK"){throw "El smoke operacional fallo."};Log "smoke_ok";Complete-DeploymentAuditPhase $audit 'smoke' $auditFile;Test-PhaseFailure 'smoke'

  Start-DeploymentAuditPhase $audit 'persist_state' $auditFile
  $written=Write-DeploymentStateAtomic $deploymentPath $TargetApiImage $TargetFrontImage $TargetVersion $GitSha;$persisted=$true
  $audit.deployment_state_persisted=$true;Complete-DeploymentAuditPhase $audit 'persist_state' $auditFile;Test-PhaseFailure 'persist_state'
  Clear-DeploymentEnvironment;Assert-ComposeState $written
  Start-DeploymentAuditPhase $audit 'complete' $auditFile;$audit.status='success';$audit.completed_at_utc=[DateTime]::UtcNow.ToString('o');Complete-DeploymentAuditPhase $audit 'complete' $auditFile
  Log "deployment_state_ok" "config=$($written.ConfigHash)"
  Write-Output "DEPLOY_OK";Write-Output "DEPLOY_AUDIT=$auditFile";Write-Output "DEPLOYMENT_STATE=$deploymentPath"
}catch{
  $audit.status='failed';$audit.failed_at_utc=[DateTime]::UtcNow.ToString('o');$audit.failure='Ver logs operativos anteriores.';Write-DeploymentAuditAtomic $auditFile $audit
  $restoredWithoutRecreate=$false
  $phaseRank=$script:DeploymentAuditPhases[[string]$audit.phase_started]
  if($audit.phase_started-eq 'preflight'){$restoredWithoutRecreate=$true}
  elseif($audit.database_recovery-eq 'not_required'-and-not $audit.deployment_state_persisted-and $phaseRank-le $script:DeploymentAuditPhases.images-and $previousApiContainerId-and $previousProxyContainerId){
    try{Compose @("stop","maintenance");Compose @("rm","-f","maintenance");& docker start $previousApiContainerId $previousProxyContainerId|Out-Null;if($LASTEXITCODE-ne 0){throw "No se pudo reiniciar el runtime previo."};$maintenance=$false;$restoredWithoutRecreate=$true}catch{}
  }
  if(-not $restoredWithoutRecreate-and $audit.phase_started-ne 'preflight'-and-not $maintenance){try{Compose @("stop","proxy");Compose @("--profile","ops","up","-d","--wait","--wait-timeout","60","maintenance");$maintenance=$true}catch{}}
  Write-Output "DEPLOY_FAILED";Write-Output "DEPLOYMENT_STATE_PERSISTED=$persisted"
  if($audit.phase_started-eq 'preflight'-or $restoredWithoutRecreate){Write-Output "ROLLBACK_NOT_REQUIRED=$auditFile"}else{Write-Output "ROLLBACK_REQUIRED=$auditFile"}
  throw
}finally{Restore-DeploymentEnvironment}
