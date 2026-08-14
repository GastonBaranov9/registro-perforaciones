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
  [string]$ComposeFile="docker-compose.production.yaml"
)
$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "deployment-state.ps1")
if($ProjectName-notmatch '^[a-z0-9][a-z0-9_-]+$'){throw "ProjectName no es seguro."}
Assert-DeploymentImageRef $TargetApiImage;Assert-DeploymentImageRef $TargetFrontImage
Assert-DeploymentIdentifier "APP_VERSION" $TargetVersion;Assert-DeploymentIdentifier "GIT_SHA" $GitSha
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

$audit=[ordered]@{format=2;project=$ProjectName;started_at_utc=[DateTime]::UtcNow.ToString('o');status='started';deployment_state=$deploymentPath;previous_config_hash=$previous.ConfigHash;previous_api_ref=$previous.ApiImage;previous_api_id='';previous_front_ref=$previous.FrontImage;previous_front_id='';previous_version=$previous.AppVersion;previous_git_sha=$previous.GitSha;target_config_hash=(Get-DeploymentConfigHash $TargetApiImage $TargetFrontImage $TargetVersion $GitSha);target_api_ref=$TargetApiImage;target_front_ref=$TargetFrontImage;target_version=$TargetVersion;git_sha=$GitSha;backup_bundle=''}
try{
  Clear-DeploymentEnvironment
  Log "deploy_start" "target=$TargetVersion config=$($audit.target_config_hash)"
  Assert-ComposeState $previous;Compose @("config","--quiet")
  $runningApi=ContainerValue "api" '{{.Config.Image}}';$runningFront=ContainerValue "front" '{{.Config.Image}}';$runningVersion=EnvVersion "api"
  if($runningApi-ne $previous.ApiImage-or $runningFront-ne $previous.FrontImage-or $runningVersion-ne $previous.AppVersion){throw "El runtime no coincide con el deployment state previo; reconciliar antes de desplegar."}
  $audit.previous_api_id=ContainerValue "api" '{{.Image}}';$audit.previous_front_id=ContainerValue "front" '{{.Image}}'
  $audit|ConvertTo-Json|Set-Content -LiteralPath $auditFile -Encoding utf8

  Log "maintenance_start"
  Compose @("stop","proxy");Compose @("--profile","ops","up","-d","--wait","--wait-timeout","60","maintenance");$maintenance=$true
  Compose @("stop","api")
  Log "backup_start"
  $backupOutput=(& (Join-Path $PSScriptRoot "backup.ps1") -EnvFile $envPath -DeploymentStateFile $deploymentPath -ProjectName $ProjectName -BackupDir $backupPath -ComposeFile $ComposeFile|Out-String)
  $match=[regex]::Match($backupOutput,'BACKUP_BUNDLE=(rsp-backup-\d{8}T\d{6}Z)');if(-not $match.Success){throw "El backup previo no produjo un bundle valido."};$audit.backup_bundle=$match.Groups[1].Value
  Log "backup_ok" "bundle=$($audit.backup_bundle)"

  Set-DeploymentEnvironment $TargetApiImage $TargetFrontImage $TargetVersion $GitSha
  Compose @("config","--quiet")
  if($BuildImages){Log "image_build_start";Compose @("build","api","front")}else{Log "image_pull_start";Compose @("pull","api","front")}
  Log "migrate_start";Compose @("--profile","ops","run","--rm","migrate");Log "migrate_ok"
  Log "services_start";Compose @("up","-d","--no-deps","--wait","--wait-timeout","180","api","front")
  Compose @("stop","maintenance");Compose @("rm","-f","maintenance");$maintenance=$false
  Compose @("up","-d","--no-deps","--wait","--wait-timeout","180","proxy")
  Log "health_ok";Log "smoke_start"
  $smoke=& (Join-Path $PSScriptRoot "smoke.ps1") -EnvFile $envPath -DeploymentStateFile $deploymentPath -ProjectName $ProjectName -AdminEmail $SmokeAdminEmail -AdminPasswordFile $SmokeAdminPasswordFile -ComposeFile $ComposeFile
  if($smoke-notcontains "SMOKE_OK"){throw "El smoke operacional fallo."};Log "smoke_ok"

  $written=Write-DeploymentStateAtomic $deploymentPath $TargetApiImage $TargetFrontImage $TargetVersion $GitSha;$persisted=$true
  Clear-DeploymentEnvironment;Assert-ComposeState $written
  $audit.status='success';$audit.completed_at_utc=[DateTime]::UtcNow.ToString('o');$audit|ConvertTo-Json|Set-Content -LiteralPath $auditFile -Encoding utf8
  Log "deployment_state_ok" "config=$($written.ConfigHash)"
  Write-Output "DEPLOY_OK";Write-Output "DEPLOY_AUDIT=$auditFile";Write-Output "DEPLOYMENT_STATE=$deploymentPath"
}catch{
  $audit.status='failed';$audit.failed_at_utc=[DateTime]::UtcNow.ToString('o');$audit.failure='Ver logs operativos anteriores.';$audit|ConvertTo-Json|Set-Content -LiteralPath $auditFile -Encoding utf8
  if(-not $maintenance){try{Compose @("stop","proxy");Compose @("--profile","ops","up","-d","--wait","--wait-timeout","60","maintenance");$maintenance=$true}catch{}}
  Write-Output "DEPLOY_FAILED";Write-Output "DEPLOYMENT_STATE_PERSISTED=$persisted";Write-Output "ROLLBACK_REQUIRED=$auditFile"
  throw
}finally{Restore-DeploymentEnvironment}
