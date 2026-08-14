param(
  [Parameter(Mandatory=$true)][string]$EnvFile,
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
if($ProjectName-notmatch '^[a-z0-9][a-z0-9_-]+$'){throw "ProjectName no es seguro."}
foreach($ref in @($TargetApiImage,$TargetFrontImage)){if($ref-notmatch '^[A-Za-z0-9][A-Za-z0-9._/@:-]+$' -or $ref-match '(^|:)latest$'){throw "Las imágenes objetivo deben usar tag/digest explícito y nunca latest."}}
if($TargetVersion-notmatch '^[A-Za-z0-9._-]+$' -or $GitSha-notmatch '^[A-Za-z0-9._-]+$'){throw "Versión/GIT_SHA no son seguros."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path;$envPath=(Resolve-Path $EnvFile).Path;$composePath=(Resolve-Path (Join-Path $repo $ComposeFile)).Path
$backupPath=[IO.Path]::GetFullPath($BackupDir);$statePath=[IO.Path]::GetFullPath($StateDir);[IO.Directory]::CreateDirectory($backupPath)|Out-Null;[IO.Directory]::CreateDirectory($statePath)|Out-Null
$compose=@("--project-name",$ProjectName,"--env-file",$envPath,"-f",$composePath)
$stateFile=Join-Path $statePath "deploy-$ProjectName.json"
$maintenance=$false
function Log([string]$Event,[string]$Detail=""){Write-Output "[$([DateTime]::UtcNow.ToString('o'))] $Event $Detail".TrimEnd()}
function Compose([string[]]$Arguments){& docker compose @compose @Arguments;if($LASTEXITCODE-ne 0){throw "docker compose falló: $($Arguments-join ' ')"}}
function ContainerValue([string]$Service,[string]$Format){$id=(& docker compose @compose ps -q $Service|Out-String).Trim();if(-not $id){throw "No hay contenedor previo para $Service."};$value=(& docker inspect --format $Format $id|Out-String).Trim();if($LASTEXITCODE-ne 0-or-not $value){throw "No se pudo inspeccionar $Service."};return $value}
function EnvVersion([string]$Service){$id=(& docker compose @compose ps -q $Service|Out-String).Trim();$line=(& docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' $id|Select-String '^APP_VERSION='|Select-Object -First 1).Line;return $(if($line){($line-split '=',2)[1]}else{'unknown'})}
function ImageRevision([string]$Service){$labels=ContainerValue $Service '{{json .Config.Labels}}'|ConvertFrom-Json;$revision=$labels.'org.opencontainers.image.revision';return $(if($revision){$revision}else{'unknown'})}

$state=[ordered]@{format=1;project=$ProjectName;started_at_utc=[DateTime]::UtcNow.ToString('o');status='started';previous_api_ref='';previous_api_id='';previous_front_ref='';previous_front_id='';previous_version='';previous_git_sha='';target_api_ref=$TargetApiImage;target_front_ref=$TargetFrontImage;target_version=$TargetVersion;git_sha=$GitSha;backup_bundle=''}
try{
  Log "deploy_start" "target=$TargetVersion"
  Compose @("config","--quiet")
  $state.previous_api_ref=ContainerValue "api" '{{.Config.Image}}';$state.previous_api_id=ContainerValue "api" '{{.Image}}';$state.previous_front_ref=ContainerValue "front" '{{.Config.Image}}';$state.previous_front_id=ContainerValue "front" '{{.Image}}';$state.previous_version=EnvVersion "api";$state.previous_git_sha=ImageRevision "api"
  $state|ConvertTo-Json|Set-Content -LiteralPath $stateFile -Encoding utf8

  Log "maintenance_start"
  Compose @("stop","proxy");Compose @("--profile","ops","up","-d","--wait","--wait-timeout","60","maintenance");$maintenance=$true
  Compose @("stop","api")
  Log "backup_start"
  $backupOutput=(& (Join-Path $PSScriptRoot "backup.ps1") -EnvFile $envPath -ProjectName $ProjectName -BackupDir $backupPath -ComposeFile $ComposeFile|Out-String)
  $match=[regex]::Match($backupOutput,'BACKUP_BUNDLE=(rsp-backup-\d{8}T\d{6}Z)');if(-not $match.Success){throw "El backup previo no produjo un bundle válido."};$state.backup_bundle=$match.Groups[1].Value
  Log "backup_ok" "bundle=$($state.backup_bundle)"

  $oldApi=$env:API_IMAGE_REF;$oldFront=$env:FRONT_IMAGE_REF;$oldVersion=$env:APP_VERSION;$oldSha=$env:GIT_SHA
  $env:API_IMAGE_REF=$TargetApiImage;$env:FRONT_IMAGE_REF=$TargetFrontImage;$env:APP_VERSION=$TargetVersion;$env:GIT_SHA=$GitSha
  try{
    Compose @("config","--quiet")
    if($BuildImages){Log "image_build_start";Compose @("build","api","front")}else{Log "image_pull_start";Compose @("pull","api","front")}
    Log "migrate_start";Compose @("--profile","ops","run","--rm","migrate");Log "migrate_ok"
    Log "services_start";Compose @("up","-d","--no-deps","--wait","--wait-timeout","180","api","front")
    Compose @("stop","maintenance");Compose @("rm","-f","maintenance");$maintenance=$false
    Compose @("up","-d","--no-deps","--wait","--wait-timeout","180","proxy")
    Log "health_ok"
    Log "smoke_start"
    $smoke=& (Join-Path $PSScriptRoot "smoke.ps1") -EnvFile $envPath -ProjectName $ProjectName -AdminEmail $SmokeAdminEmail -AdminPasswordFile $SmokeAdminPasswordFile -ComposeFile $ComposeFile
    if($LASTEXITCODE-ne 0-or $smoke-notcontains "SMOKE_OK"){throw "El smoke operacional falló."}
    Log "smoke_ok"
  }finally{
    if($null-eq $oldApi){Remove-Item Env:API_IMAGE_REF -ErrorAction SilentlyContinue}else{$env:API_IMAGE_REF=$oldApi};if($null-eq $oldFront){Remove-Item Env:FRONT_IMAGE_REF -ErrorAction SilentlyContinue}else{$env:FRONT_IMAGE_REF=$oldFront};if($null-eq $oldVersion){Remove-Item Env:APP_VERSION -ErrorAction SilentlyContinue}else{$env:APP_VERSION=$oldVersion};if($null-eq $oldSha){Remove-Item Env:GIT_SHA -ErrorAction SilentlyContinue}else{$env:GIT_SHA=$oldSha}
  }
  $state.status='success';$state.completed_at_utc=[DateTime]::UtcNow.ToString('o');$state|ConvertTo-Json|Set-Content -LiteralPath $stateFile -Encoding utf8
  Write-Output "DEPLOY_OK"
  Write-Output "DEPLOY_STATE=$stateFile"
}catch{
  $state.status='failed';$state.failed_at_utc=[DateTime]::UtcNow.ToString('o');$state.failure=$_.Exception.Message;$state|ConvertTo-Json|Set-Content -LiteralPath $stateFile -Encoding utf8
  if(-not $maintenance){try{Compose @("stop","proxy");Compose @("--profile","ops","up","-d","--wait","--wait-timeout","60","maintenance");$maintenance=$true}catch{}}
  Write-Output "DEPLOY_FAILED"
  Write-Output "ROLLBACK_REQUIRED=$stateFile"
  throw
}
