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
  [ValidateRange(1,65535)][int]$SmokeInternalPort=18443,
  [string]$SmokeCaFile="",
  [switch]$BuildImages,
  [string]$Recognition027File="",
  [string]$Recognition027Sha256="",
  [ValidateSet("","preflight","maintenance","photo_storage","backup","images","migrate","services","services_incompatible","health","smoke","persist_state")][string]$TestFailAfterPhase="",
  [int]$TestPhotoCopyFailAfter=0,
  [string]$ComposeFile="docker-compose.production.yaml"
)
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "deployment-state.ps1")
. (Join-Path $PSScriptRoot "deployment-audit.ps1")
. (Join-Path $PSScriptRoot "validation-026.ps1")
. (Join-Path $PSScriptRoot "validation-027.ps1")
. (Join-Path $PSScriptRoot "recognition-027.ps1")
if($ProjectName-notmatch '^[a-z0-9][a-z0-9_-]+$'){throw "ProjectName no es seguro."}
Assert-DeploymentGitSha $GitSha
if($BuildImages){Assert-DeploymentImageRef $TargetApiImage $GitSha;Assert-DeploymentImageRef $TargetFrontImage $GitSha}
else{Assert-DeploymentRemoteImageRef $TargetApiImage $GitSha;Assert-DeploymentRemoteImageRef $TargetFrontImage $GitSha}
Assert-DeploymentIdentifier "APP_VERSION" $TargetVersion
if(($TestFailAfterPhase-or $TestPhotoCopyFailAfter-gt 0)-and $ProjectName-notmatch '^rsp07f-r[23]-[a-z0-9_-]+$'){throw "La inyeccion de fallo solo se permite en proyectos RSP-07F-R2/R3 aislados."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path;$envPath=(Resolve-Path $EnvFile).Path;$deploymentPath=(Resolve-Path $DeploymentStateFile).Path;$composePath=(Resolve-Path (Join-Path $repo $ComposeFile)).Path
$backupPath=[IO.Path]::GetFullPath($BackupDir);$statePath=[IO.Path]::GetFullPath($StateDir);[IO.Directory]::CreateDirectory($backupPath)|Out-Null;[IO.Directory]::CreateDirectory($statePath)|Out-Null
$compose=@("--project-name",$ProjectName,"--env-file",$envPath,"--env-file",$deploymentPath,"-f",$composePath)
$operationLock=Open-DeploymentOperationLock $deploymentPath
try{
$auditFile=Resolve-Rsp027DeploymentAudit $statePath $ProjectName
$recognition027=$null
$priorAudit=$null
# Do not lose the pre-migration baseline or bypass a failed gate on a retry
# just because 026 is already in the ledger. Recovery requires operator review.
if(Test-Path -LiteralPath $auditFile){
  $priorAudit=[IO.File]::ReadAllText($auditFile) | ConvertFrom-Json
  if($priorAudit.validation_026 -eq 'pending'){throw '026: validacion anterior pendiente; conservar evidencia y revisar recuperacion antes de reintentar.'}
  if($priorAudit.validation_027 -eq 'pending' -or ($priorAudit.validation_027 -eq 'passed' -and $priorAudit.status -ne 'success')){
    if(-not $Recognition027File){throw '027: validacion/despliegue anterior pendiente; conservar evidencia y revisar recuperacion antes de reintentar.'}
    $recognition027=Use-Rsp027Recognition $statePath $ProjectName $Recognition027File $Recognition027Sha256 $GitSha $deploymentPath $compose (Join-Path $repo 'api/db/migrations')
    $auditFile=$recognition027.attempt
  }
}
if(($Recognition027File -or $Recognition027Sha256) -and $null -eq $recognition027){throw '027: reconocimiento no aplicable a este intento.'}
$previous=Read-DeploymentState $deploymentPath
$savedEnvironment=@{}
foreach($name in @('API_IMAGE_REF','FRONT_IMAGE_REF','APP_VERSION','GIT_SHA','SMOKE_INTERNAL_PORT')){$savedEnvironment[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
$env:SMOKE_INTERNAL_PORT=[string]$SmokeInternalPort
$maintenance=$false;$persisted=$false;$smokeProxyAttempted=$false
$validate026=$false;$baseline026=$null
$validate027=$false;$baseline027=$null
$migrationDir=Join-Path $repo 'api/db/migrations'
function Log([string]$Event,[string]$Detail=""){Write-Output "[$([DateTime]::UtcNow.ToString('o'))] $Event $Detail".TrimEnd()}
function Compose([string[]]$Arguments){& docker compose @compose @Arguments;if($LASTEXITCODE-ne 0){throw "docker compose fallo: $($Arguments-join ' ')"}}
function ComposeSmoke([string[]]$Arguments){& docker compose @compose -f (Join-Path $PSScriptRoot 'smoke-proxy.compose.yaml') @Arguments;if($LASTEXITCODE-ne 0){throw 'Fallo el proxy privado de smoke.'}}
function Clear-DeploymentEnvironment{foreach($name in @('API_IMAGE_REF','FRONT_IMAGE_REF','APP_VERSION','GIT_SHA')){[Environment]::SetEnvironmentVariable($name,$null,'Process')}}
function Set-DeploymentEnvironment([string]$Api,[string]$Front,[string]$Version,[string]$Sha){$env:API_IMAGE_REF=$Api;$env:FRONT_IMAGE_REF=$Front;$env:APP_VERSION=$Version;$env:GIT_SHA=$Sha}
function Restore-DeploymentEnvironment{foreach($name in $savedEnvironment.Keys){[Environment]::SetEnvironmentVariable($name,$savedEnvironment[$name],'Process')}}
function ContainerValue([string]$Service,[string]$Format){$id=(& docker compose @compose ps -q $Service|Out-String).Trim();if(-not $id){throw "No hay contenedor previo para $Service."};$value=(& docker inspect --format $Format $id|Out-String).Trim();if($LASTEXITCODE-ne 0-or-not $value){throw "No se pudo inspeccionar $Service."};return $value}
function Assert-RuntimeImage([string]$Service,[string]$Reference){
  $expected=(& docker image inspect --format '{{.Id}}' $Reference|Out-String).Trim()
  if($LASTEXITCODE-ne 0-or $expected-cnotmatch '^sha256:[a-f0-9]{64}$'){throw "No se pudo resolver la imagen registrada de $Service."}
  $running=ContainerValue $Service '{{.Image}}'
  if($running-cnotmatch '^sha256:[a-f0-9]{64}$'-or $running-cne $expected){throw "La identidad de imagen de $Service no coincide con deployment state."}
  return $running
}
function EnvVersion([string]$Service){$id=(& docker compose @compose ps -q $Service|Out-String).Trim();$line=(& docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' $id|Select-String '^APP_VERSION='|Select-Object -First 1).Line;return $(if($line){($line-split '=',2)[1]}else{'unknown'})}
function Assert-ComposeState([object]$Expected){
  $json=(& docker compose @compose config --format json|Out-String);if($LASTEXITCODE-ne 0){throw "No se pudo renderizar Compose desde deployment state."}
  $config=$json|ConvertFrom-Json
  if($config.services.api.image-ne $Expected.ApiImage-or $config.services.front.image-ne $Expected.FrontImage-or $config.services.api.environment.APP_VERSION-ne $Expected.AppVersion-or $config.services.api.environment.GIT_SHA-ne $Expected.GitSha){throw "Compose no reproduce el deployment state persistido."}
}
function Test-PhaseFailure([string]$Phase){if($TestFailAfterPhase-eq $Phase){throw "Fallo controlado RSP-07F-R2 despues de $Phase."}}

# Recovery uses Docker labels, not Compose interpolation or the persisted state file.
# Capture diagnostics in memory: logging must never interrupt containment.
function Recovery-Docker([string[]]$Arguments){
  $oldPreference=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try{
    $output=(& docker @Arguments 2>&1 | Out-String).Trim();$code=$LASTEXITCODE
    if($code -ne 0){throw "docker $($Arguments -join ' '): exit=$code; $output"}
    return $output
  }finally{$ErrorActionPreference=$oldPreference}
}
function Recovery-Ids([string]$Service){
  $raw=Recovery-Docker @('ps','-a','-q','--filter',"label=com.docker.compose.project=$ProjectName",'--filter',"label=com.docker.compose.service=$Service")
  return @($raw -split '\s+' | Where-Object {$_})
}
function Test-RecoveryStopped([string]$Service){
  try{
    foreach($id in @(Recovery-Ids $Service)){
      if((Recovery-Docker @('inspect','--format','{{.State.Status}}',$id)) -notin @('exited','created','dead')){return $false}
    }
    return $true
  }catch{$recoveryErrors.Add("verify/$Service`: $($_.Exception.Message)");return $false}
}
function Stop-RecoveryService([string]$Service){
  try{$ids=@(Recovery-Ids $Service)}catch{$recoveryErrors.Add("list/$Service`: $($_.Exception.Message)");return}
  foreach($id in $ids){
    try{if((Recovery-Docker @('inspect','--format','{{.State.Status}}',$id)) -in @('exited','created','dead')){continue}}
    catch{$recoveryErrors.Add("inspect/$Service`: $($_.Exception.Message)")}
    try{Recovery-Docker @('stop','--time','10',$id) | Out-Null}
    catch{
      $recoveryErrors.Add("stop/$Service`: $($_.Exception.Message)")
      try{Recovery-Docker @('stop','--time','0',$id) | Out-Null}
      catch{$recoveryErrors.Add("force-stop/$Service`: $($_.Exception.Message)")}
    }
  }
}
function Test-RecoveryMaintenance{
  try{
    $ids=@(Recovery-Ids 'maintenance');if(-not $ids.Count){return $false}
    foreach($id in $ids){
      if((Recovery-Docker @('inspect','--format','{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}',$id)) -ne 'running/healthy'){return $false}
    }
    return $true
  }catch{$recoveryErrors.Add("verify/maintenance: $($_.Exception.Message)");return $false}
}

$audit=[ordered]@{format=3;project=$ProjectName;started_at_utc=[DateTime]::UtcNow.ToString('o');updated_at_utc=[DateTime]::UtcNow.ToString('o');status='started';phase_started='preflight';phase_completed='none';database_recovery='not_required';legacy_schema_without_ledger=$false;deployment_state=$deploymentPath;deployment_state_persisted=$false;previous_config_hash=$previous.ConfigHash;previous_api_ref=$previous.ApiImage;previous_api_id='';previous_front_ref=$previous.FrontImage;previous_front_id='';previous_version=$previous.AppVersion;previous_git_sha=$previous.GitSha;target_config_hash=(Get-DeploymentConfigHash $TargetApiImage $TargetFrontImage $TargetVersion $GitSha);target_api_ref=$TargetApiImage;target_front_ref=$TargetFrontImage;target_version=$TargetVersion;git_sha=$GitSha;backup_bundle=''}
$previousApiContainerId='';$previousProxyContainerId=''
if($recognition027){
  $audit.validation_027='pending'
  $audit.recognition_027=@{record=$recognition027.record;record_sha256=$recognition027.record_sha256;incident=$recognition027.incident;incident_sha256=$recognition027.incident_sha256;archived_incident=$recognition027.archived_incident;operator=$recognition027.operator;reason=$recognition027.reason;consumed_at_utc=$recognition027.consumed_at_utc}
}elseif($priorAudit.recognition_027){$audit.recognition_027=$priorAudit.recognition_027}
# Failure here must not enter deployment recovery or overwrite an existing attempt.
if($recognition027){
  try{New-Rsp027AttemptAudit $recognition027 $audit $statePath $ProjectName}
  catch{$initialAuditError=$_;try{Restore-DeploymentEnvironment}catch{};throw $initialAuditError}
}
try{
  Write-DeploymentAuditAtomic $auditFile $audit
  Clear-DeploymentEnvironment
  Log "deploy_start" "target=$TargetVersion config=$($audit.target_config_hash)"
  Assert-ComposeState $previous;Compose @("config","--quiet")
  # Aliases are accepted only when both resolve to the container's exact image ID.
  $audit.previous_api_id=Assert-RuntimeImage 'api' $previous.ApiImage
  $audit.previous_front_id=Assert-RuntimeImage 'front' $previous.FrontImage
  $runningVersion=EnvVersion "api"
  if($runningVersion-ne $previous.AppVersion){throw "El runtime no coincide con el deployment state previo; reconciliar antes de desplegar."}
  $previousApiContainerId=(& docker compose @compose ps -a -q api|Out-String).Trim();$previousProxyContainerId=(& docker compose @compose ps -a -q proxy|Out-String).Trim()
  if(-not $previousApiContainerId-or-not $previousProxyContainerId){throw "Faltan containers previos necesarios para una recuperación sin recreate."}
  # RSP-specific initial upgrade, automatic and without an opt-out switch.
  # Subsequent deployments must not reassert the initial policy after legitimate edits.
  if($ProjectName -eq 'rsp-pilot'){$validate026=Test-Rsp026Upgrade $compose $migrationDir}
  if($ProjectName -eq 'rsp-pilot' -and -not $validate026 -and (Test-Path (Join-Path $migrationDir '027_prefiltro_constructivo.sql'))){
    $validate027=Test-Rsp027Upgrade $compose $migrationDir $priorAudit $previous.GitSha
    if($validate027){Assert-Rsp027Services $compose;Assert-Rsp026Images $compose $previous.GitSha $previous.ApiImage $previous.FrontImage}
    if($validate027 -and $BuildImages){Assert-Rsp027BuildSource $repo $GitSha}
  }
  if($recognition027 -and ($validate026 -or -not $validate027)){throw '027: reconocimiento requiere ejecutar toda la actualizacion inicial 026 -> 027.'}
  $audit.validation_026=if($validate026){'pending'}else{'not_required'}
  $audit.validation_027=if($validate027){'pending'}else{'not_required'}
  Complete-DeploymentAuditPhase $audit 'preflight' $auditFile;Test-PhaseFailure 'preflight'

  Set-DeploymentEnvironment $TargetApiImage $TargetFrontImage $TargetVersion $GitSha
  Compose @("config","--quiet")
  if($BuildImages){Log "image_build_start";Compose @("build","api","front")}else{Log "image_pull_start";Compose @("pull","api","front")}
  if($validate027){Assert-Rsp027TargetMigrations $TargetApiImage $TargetFrontImage $GitSha $migrationDir}

  # A failure from this point leaves maintenance active; recovery is no longer a no-op.
  $audit.database_recovery='operator_assessment_required'
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
  if($backupOutput -notmatch ('(?m)^BACKUP_VERIFIED_FULL='+[regex]::Escape($audit.backup_bundle)+'\r?$')){throw "Falta verificacion del respaldo completo; migraciones bloqueadas."}
  Complete-DeploymentAuditPhase $audit 'backup' $auditFile;Log "backup_ok" "bundle=$($audit.backup_bundle)";Test-PhaseFailure 'backup'
  if($validate026){
    $baseline026=Get-Rsp026Snapshot $compose
    Assert-Rsp026Ledger $baseline026.ledger 25 $migrationDir
    Assert-Rsp026Baseline $baseline026
    $audit.validation_026_evidence=Join-Path $statePath "$($audit.backup_bundle)-026.json"
    $evidence026=[ordered]@{source_git_sha=$previous.GitSha;target_git_sha=$GitSha;backup_bundle=$audit.backup_bundle;before=$baseline026}
    [IO.File]::WriteAllText($audit.validation_026_evidence,(ConvertTo-Json -InputObject $evidence026 -Depth 14),[Text.UTF8Encoding]::new($false))
    Write-DeploymentAuditAtomic $auditFile $audit
  }

  Start-DeploymentAuditPhase $audit 'images' $auditFile
  if($validate027){
    $baseline027=Get-Rsp027Snapshot $compose
    Assert-Rsp026Ledger $baseline027.ledger 26 $migrationDir
    Assert-Rsp027Baseline $baseline027
    $audit.validation_027_evidence=Join-Path $statePath "$($audit.backup_bundle)-027.json"
    $evidence027=[ordered]@{source_git_sha=$previous.GitSha;target_git_sha=$GitSha;backup_bundle=$audit.backup_bundle;before=$baseline027;checks=@('baseline')}
    Write-Rsp027Evidence $audit.validation_027_evidence $evidence027
    Write-DeploymentAuditAtomic $auditFile $audit
  }
  Compose @("config","--quiet")
  Complete-DeploymentAuditPhase $audit 'images' $auditFile;Test-PhaseFailure 'images'
  $audit.database_recovery='operator_assessment_required'
  Start-DeploymentAuditPhase $audit 'migrate' $auditFile
  Log "migrate_start"
  if($audit.legacy_schema_without_ledger){Compose @("--profile","ops","run","--rm","migrate","npm","run","db:migrate","--","--adopt-current-schema")}else{Compose @("--profile","ops","run","--rm","migrate")}
  Log "migrate_ok";Complete-DeploymentAuditPhase $audit 'migrate' $auditFile;Test-PhaseFailure 'migrate'
  if($validate027){
    $migrated027=Get-Rsp027Snapshot $compose
    Assert-Rsp026Ledger $migrated027.ledger 27 $migrationDir
    Assert-Rsp027Conservation $baseline027 $migrated027
    $evidence027.after_migration=$migrated027;$evidence027.checks+=@('ledger-027','structure','strict-conservation')
    Write-Rsp027Evidence $audit.validation_027_evidence $evidence027
  }
  Start-DeploymentAuditPhase $audit 'services' $auditFile
  Log "services_start";Compose @("up","-d","--no-deps","--wait","--wait-timeout","180","api","front")
  $smokeProxyAttempted=$true
  ComposeSmoke @('--profile','ops','up','-d','--no-deps','--wait','--wait-timeout','60','smoke-proxy')
  Complete-DeploymentAuditPhase $audit 'services' $auditFile
  if($TestFailAfterPhase-eq 'services_incompatible'){$audit.database_recovery='restore_required';Write-DeploymentAuditAtomic $auditFile $audit;throw "Fallo incompatible controlado RSP-07F-R2 despues de services."}
  Test-PhaseFailure 'services'
  Start-DeploymentAuditPhase $audit 'health' $auditFile;Log "health_ok";Complete-DeploymentAuditPhase $audit 'health' $auditFile;Test-PhaseFailure 'health'
  Start-DeploymentAuditPhase $audit 'smoke' $auditFile;Log "smoke_start"
  $smoke=& (Join-Path $PSScriptRoot "smoke.ps1") -EnvFile $envPath -DeploymentStateFile $deploymentPath -ProjectName $ProjectName -AdminEmail $SmokeAdminEmail -AdminPasswordFile $SmokeAdminPasswordFile -ComposeFile $ComposeFile -ConnectPort $SmokeInternalPort -TlsCaFile $SmokeCaFile -Validate026:$validate026 -Validate027:$validate027
  if($smoke-notcontains "SMOKE_OK"){throw "El smoke operacional fallo."}
  if($validate026){
    if($smoke -notcontains 'SMOKE_026_API_OK'){throw '026: falta validacion del contrato API autenticado.'}
    $after026=Get-Rsp026Snapshot $compose
    Assert-Rsp026Ledger $after026.ledger 26 $migrationDir
    Assert-Rsp026Conservation $baseline026 $after026
    $policy026=Get-Rsp026Policy $compose
    Assert-Rsp026Policy $policy026
    Assert-Rsp026Images $compose $GitSha $TargetApiImage $TargetFrontImage
    $evidence026.after=$after026;$evidence026.policy=$policy026;$evidence026.validated_at_utc=[DateTime]::UtcNow.ToString('o')
    [IO.File]::WriteAllText($audit.validation_026_evidence,(ConvertTo-Json -InputObject $evidence026 -Depth 14),[Text.UTF8Encoding]::new($false))
    $audit.validation_026='passed';Log 'validation_026_ok'
  }
  if($validate027){
    if($smoke -notcontains 'SMOKE_027_API_OK'){throw '027: falta smoke privado autenticado.'}
    $smokeUser=@($smoke | Where-Object {$_ -cmatch '^SMOKE_027_USER=[1-9][0-9]*$'})
    if($smokeUser.Count -ne 1){throw '027: falta identidad del usuario smoke.'}
    $after027=Get-Rsp027Snapshot $compose
    Assert-Rsp026Ledger $after027.ledger 27 $migrationDir
    Assert-Rsp027Conservation $baseline027 $after027 ([long]($smokeUser[0] -split '=')[1])
    Assert-Rsp026Images $compose $GitSha $TargetApiImage $TargetFrontImage
    $persistence027=Assert-Rsp027Persistence $compose (Join-Path $backupPath $audit.backup_bundle)
    $evidence027.after_smoke=$after027;$evidence027.persistence=$persistence027
    $evidence027.checks+=@('authenticated-smoke','post-smoke-conservation','images','persistence')
    $evidence027.validated_at_utc=[DateTime]::UtcNow.ToString('o')
    Write-Rsp027Evidence $audit.validation_027_evidence $evidence027
    $audit.validation_027='passed';Log 'validation_027_ok'
  }
  Log "smoke_ok";Complete-DeploymentAuditPhase $audit 'smoke' $auditFile;Test-PhaseFailure 'smoke'

  Start-DeploymentAuditPhase $audit 'persist_state' $auditFile
  $written=Write-DeploymentStateAtomic $deploymentPath $TargetApiImage $TargetFrontImage $TargetVersion $GitSha;$persisted=$true
  $audit.deployment_state_persisted=$true;Complete-DeploymentAuditPhase $audit 'persist_state' $auditFile;Test-PhaseFailure 'persist_state'
  Clear-DeploymentEnvironment;Assert-ComposeState $written
  # All critical checks and state persistence succeeded while public writes were blocked.
  if($validate026 -and $audit.validation_026 -ne 'passed'){throw '026: reapertura bloqueada sin validacion completa.'}
  if($validate027 -and $audit.validation_027 -ne 'passed'){throw '027: reapertura bloqueada sin validacion completa.'}
  ComposeSmoke @('stop','smoke-proxy');ComposeSmoke @('rm','-f','smoke-proxy');$smokeProxyAttempted=$false
  Compose @('stop','maintenance');$maintenance=$false;Compose @('rm','-f','maintenance')
  Compose @('up','-d','--no-deps','--wait','--wait-timeout','180','proxy')
  $publicSmoke=& (Join-Path $PSScriptRoot 'smoke.ps1') -EnvFile $envPath -DeploymentStateFile $deploymentPath -ProjectName $ProjectName -AdminEmail $SmokeAdminEmail -AdminPasswordFile $SmokeAdminPasswordFile -ComposeFile $ComposeFile -TlsCaFile $SmokeCaFile -PublicOnly
  if($publicSmoke -notcontains 'PUBLIC_SMOKE_OK'){throw 'Fallo la comprobacion del proxy publicado.'}
  Start-DeploymentAuditPhase $audit 'complete' $auditFile;$audit.status='success';$audit.completed_at_utc=[DateTime]::UtcNow.ToString('o');Complete-DeploymentAuditPhase $audit 'complete' $auditFile
  Log "deployment_state_ok" "config=$($written.ConfigHash)"
  Write-Output "DEPLOY_OK";Write-Output "DEPLOY_AUDIT=$auditFile";Write-Output "DEPLOYMENT_STATE=$deploymentPath"
}catch{
  $originalError=$_;$recoveryErrors=[Collections.Generic.List[string]]::new()
  $recoveryRequired=($audit.database_recovery -ne 'not_required' -or $audit.phase_started -ne 'preflight')
  $publicBlocked=$false;$maintenanceVerified=$false
  if($recoveryRequired){
    Stop-RecoveryService 'proxy'
    if(-not (Test-RecoveryStopped 'proxy')){Stop-RecoveryService 'api'}
    if(-not (Test-RecoveryMaintenance)){
      try{Recovery-Docker (@('compose')+$compose+@('--profile','ops','up','-d','--no-deps','--no-recreate','--wait','--wait-timeout','60','maintenance')) | Out-Null}
      catch{$recoveryErrors.Add("start/maintenance: $($_.Exception.Message)")}
    }
    if($smokeProxyAttempted){Stop-RecoveryService 'smoke-proxy';$smokeProxyAttempted=$false}
    $maintenanceVerified=Test-RecoveryMaintenance
    $publicBlocked=Test-RecoveryStopped 'proxy'
    if(-not $publicBlocked){Stop-RecoveryService 'api'}
  }
  # Only after all protection attempts may audit or output fail.
  $audit.status='failed';$audit.failed_at_utc=[DateTime]::UtcNow.ToString('o')
  $audit.failure=$originalError.ToString();$audit.failure_stack=$originalError.ScriptStackTrace
  $audit.recovery_public_blocked=$publicBlocked;$audit.recovery_maintenance_verified=$maintenanceVerified
  $audit.recovery_errors=@($recoveryErrors.ToArray())
  try{Write-DeploymentAuditAtomic $auditFile $audit}catch{$recoveryErrors.Add("audit: $($_.Exception.Message)")}
  $urgent=$recoveryRequired -and -not $publicBlocked
  $originalError.Exception.Data['RecoveryPublicBlocked']=$publicBlocked
  $originalError.Exception.Data['RecoveryErrors']=$recoveryErrors.ToArray()
  $originalError.Exception.Data['UrgentManualIntervention']=$urgent
  try{
    Write-Output 'DEPLOY_FAILED';Write-Output "DEPLOYMENT_STATE_PERSISTED=$persisted"
    if($recoveryRequired){
      Write-Output "RECOVERY_PUBLIC_BLOCKED=$($publicBlocked.ToString().ToLowerInvariant())"
      Write-Output "RECOVERY_MAINTENANCE_VERIFIED=$($maintenanceVerified.ToString().ToLowerInvariant())"
      Write-Output "ROLLBACK_REQUIRED=$auditFile"
    }else{Write-Output "ROLLBACK_NOT_REQUIRED=$auditFile"}
    foreach($detail in $recoveryErrors){Write-Warning $detail -WarningAction Continue}
    if($urgent){Write-Warning 'RECOVERY_CRITICAL: acceso publico no confirmado bloqueado; INTERVENCION MANUAL URGENTE.' -WarningAction Continue}
  }catch{
    $recoveryErrors.Add("report: $($_.Exception.Message)")
    $originalError.Exception.Data['RecoveryErrors']=$recoveryErrors.ToArray()
    try{[Console]::Error.WriteLine("DEPLOY_FAILED; RECOVERY_PUBLIC_BLOCKED=$publicBlocked; URGENT_MANUAL_INTERVENTION=$urgent")}catch{}
  }
  throw $originalError
}finally{
  # Never replace the original deployment failure with a cleanup/reporting failure.
  try{Restore-DeploymentEnvironment}catch{if($originalError){$originalError.Exception.Data['EnvironmentRestoreError']=$_.Exception.Message}else{throw}}
}
}finally{$operationLock.Dispose()}
