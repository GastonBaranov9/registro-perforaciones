param([string]$ProjectName="rsp07f-r1-state-$PID")
$ErrorActionPreference="Stop"
if($ProjectName-notmatch '^rsp07f-r1-state-[A-Za-z0-9-]+$'){throw "ProjectName no es seguro."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $repo "ops/deployment-state.ps1")
$tempRoot=Join-Path ([IO.Path]::GetTempPath()) "$ProjectName-$([Guid]::NewGuid().ToString('N'))"
[IO.Directory]::CreateDirectory($tempRoot)|Out-Null
$statePath=Join-Path $tempRoot "deployment.env";$basePath=Join-Path $tempRoot "production.env"
$apiN="example/api:n";$frontN="example/front:n";$apiN1="example/api:n1";$frontN1="example/front:n1"
$saved=@{};foreach($name in @('API_IMAGE_REF','FRONT_IMAGE_REF','APP_VERSION','GIT_SHA')){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try{
  $digest='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  $validRefs=@('repo:v1','registry.example/repo:v1','registry.example:5000/repo:v1','registry.example/team/repo:v1',"registry.example/repo@sha256:$digest","registry.example:5000/team/repo@sha256:$digest","registry.example/team/repo:v1@sha256:$digest")
  $invalidRefs=@('repo','registry.example/repo','registry.example:5000/repo','registry.example/team/repo','repo:latest','repo:Latest','repo:LATEST','repo:','repo@sha256:','repo@sha256:1234',"repo@sha256:$digest@sha256:$digest")
  foreach($ref in $validRefs){Assert-DeploymentImageRef $ref}
  foreach($ref in $invalidRefs){$accepted=$true;try{Assert-DeploymentImageRef $ref}catch{$accepted=$false};if($accepted){throw "Referencia mutable o malformada aceptada: $ref"}}

  $historicalPath=Join-Path $tempRoot 'historical-implicit-latest.env'
  $historical="DEPLOYMENT_STATE_FORMAT=1`nAPI_IMAGE_REF=registry.example/api`nFRONT_IMAGE_REF=example/front:n`nAPP_VERSION=n`nGIT_SHA=abc123`nDEPLOY_CONFIG_SHA256=$('0'*64)`n"
  [IO.File]::WriteAllText($historicalPath,$historical,[Text.UTF8Encoding]::new($false));$historicalBefore=[IO.File]::ReadAllBytes($historicalPath)
  $historicalRejected=$false;try{Read-DeploymentState $historicalPath|Out-Null}catch{$historicalRejected=$true}
  if(-not $historicalRejected-or [Convert]::ToBase64String($historicalBefore)-ne [Convert]::ToBase64String([IO.File]::ReadAllBytes($historicalPath))){throw 'Un deployment state historico mutable no fue rechazado intacto.'}

  Write-DeploymentStateAtomic $statePath $apiN $frontN 'n' 'abc123'|Out-Null
  $before=[IO.File]::ReadAllBytes($statePath)
  $rejected=$false;try{Write-DeploymentStateAtomic $statePath 'latest' $frontN 'bad' 'abc123'|Out-Null}catch{$rejected=$true}
  if(-not $rejected-or [Convert]::ToBase64String($before)-ne [Convert]::ToBase64String([IO.File]::ReadAllBytes($statePath))){throw "Un target invalido modifico el estado N."}
  $n1=Write-DeploymentStateAtomic $statePath $apiN1 $frontN1 'n1' 'def456'
  $bash=(Get-Command bash.exe -ErrorAction Stop).Source
  $repoUnix=$repo.Replace('\','/');$stateUnix=$statePath.Replace('\','/');$testUnix=(Join-Path $repo 'scripts/test-deployment-state-posix.sh').Replace('\','/')
  $parity=@(& $bash $testUnix $repoUnix $stateUnix)
  if($LASTEXITCODE-ne 0-or $parity[0]-ne "n1|$($n1.ConfigHash)"-or (Read-DeploymentState $statePath).AppVersion-ne 'n2'){throw "PowerShell/POSIX no leen y escriben el mismo deployment state."}

  # El deploy debe rechazar refs mutables antes de resolver paths, crear dirs o invocar Docker.
  $preflightStateBytes=[IO.File]::ReadAllBytes($statePath)
  $preflightRoot=Join-Path $tempRoot 'preflight-must-not-exist'
  foreach($pair in @(@('repo',$frontN),@($apiN,'registry.example:5000/front'),@('repo:latest',$frontN))){
    $failed=$false
    try{& (Join-Path $repo 'ops/deploy.ps1') -EnvFile (Join-Path $tempRoot 'missing.env') -DeploymentStateFile $statePath -ProjectName 'rsp07f-r11-preflight' -BackupDir (Join-Path $preflightRoot 'backup') -StateDir (Join-Path $preflightRoot 'state') -TargetApiImage $pair[0] -TargetFrontImage $pair[1] -TargetVersion 'r11' -GitSha 'abc123' -SmokeAdminEmail 'test@example.test' -SmokeAdminPasswordFile (Join-Path $tempRoot 'missing.secret') -ComposeFile 'docker-compose.production.yaml'|Out-Null}catch{$failed=$true}
    if(-not $failed-or [IO.Directory]::Exists($preflightRoot)-or [Convert]::ToBase64String($preflightStateBytes)-ne [Convert]::ToBase64String([IO.File]::ReadAllBytes($statePath))){throw 'Deploy PowerShell produjo efectos antes de rechazar una referencia mutable.'}
  }

  $deployUnix=(Join-Path $repo 'ops/deploy.sh').Replace('\','/')
  $posixSaved=@{};foreach($name in @('ENV_FILE','DEPLOYMENT_STATE_FILE','PROJECT_NAME','BACKUP_DIR','STATE_DIR','TARGET_API_IMAGE','TARGET_FRONT_IMAGE','TARGET_VERSION','TARGET_GIT_SHA','ADMIN_EMAIL','ADMIN_PASSWORD_FILE')){$posixSaved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
  try{
    $env:ENV_FILE=(Join-Path $tempRoot 'missing.env').Replace('\','/');$env:DEPLOYMENT_STATE_FILE=$stateUnix;$env:PROJECT_NAME='rsp07f-r11-preflight';$env:BACKUP_DIR=(Join-Path $preflightRoot 'backup').Replace('\','/');$env:STATE_DIR=(Join-Path $preflightRoot 'state').Replace('\','/');$env:TARGET_API_IMAGE='registry.example:5000/api';$env:TARGET_FRONT_IMAGE=$frontN;$env:TARGET_VERSION='r11';$env:TARGET_GIT_SHA='abc123';$env:ADMIN_EMAIL='test@example.test';$env:ADMIN_PASSWORD_FILE=(Join-Path $tempRoot 'missing.secret').Replace('\','/')
    $savedErrorActionPreference=$ErrorActionPreference;$ErrorActionPreference='Continue'
    try{& $bash $deployUnix 2>$null|Out-Null;$posixExit=$LASTEXITCODE}finally{$ErrorActionPreference=$savedErrorActionPreference}
    if($posixExit-eq 0-or [IO.Directory]::Exists($preflightRoot)-or [Convert]::ToBase64String($preflightStateBytes)-ne [Convert]::ToBase64String([IO.File]::ReadAllBytes($statePath))){throw 'Deploy POSIX produjo efectos antes de rechazar una referencia mutable.'}
  }finally{foreach($name in $posixSaved.Keys){[Environment]::SetEnvironmentVariable($name,$posixSaved[$name],'Process')}}

  $n1=Write-DeploymentStateAtomic $statePath $apiN1 $frontN1 'n1' 'def456'
  $base=@"
PGUSER=test
PGPASSWORD=test-only
PGDATABASE=test
FASTIFY_SECRET=test-only-not-real
PUBLIC_HOST=state.example.test
PUBLIC_ORIGIN=https://state.example.test
CORS_ORIGINS=
MAP_STATIC_URL_TEMPLATE=https://maps.example.test/static?lat={latitud}&lon={longitud}&key={apiKey}
MAP_STATIC_ALLOWED_HOST=maps.example.test
MAP_STATIC_API_KEY=test-only
MAP_STATIC_ATTRIBUTION=Test
API_IMAGE_REF=$apiN
FRONT_IMAGE_REF=$frontN
APP_VERSION=n
GIT_SHA=abc123
TLS_CERT_FILE=C:/test-only/tls.crt
TLS_KEY_FILE=C:/test-only/tls.key
BACKUP_DIR=C:/test-only/backups
"@
  [IO.File]::WriteAllText($basePath,$base,[Text.UTF8Encoding]::new($false))
  foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$null,'Process')}
  $args=@("--project-name",$ProjectName,"--env-file",$basePath,"--env-file",$statePath,"-f",(Join-Path $repo 'docker-compose.production.yaml'))
  $json=(& docker compose @args config --format json|Out-String);if($LASTEXITCODE-ne 0){throw "Compose no renderizo deployment state N+1."};$config=$json|ConvertFrom-Json
  if($config.services.api.image-ne $apiN1-or $config.services.front.image-ne $frontN1-or $config.services.api.environment.APP_VERSION-ne 'n1'){throw "Un proceso limpio regreso a las refs N del env base."}
  $rolled=Write-DeploymentStateAtomic $statePath $apiN $frontN 'n' 'abc123'
  $json=(& docker compose @args config --format json|Out-String);if($LASTEXITCODE-ne 0){throw "Compose no renderizo rollback N."};$config=$json|ConvertFrom-Json
  if($config.services.api.image-ne $apiN-or $config.services.front.image-ne $frontN-or $config.services.api.environment.APP_VERSION-ne 'n'){throw "Rollback no persistio refs N."}
  [pscustomobject]@{state_format=1;atomic_failure_preserved_n=$rejected;explicit_image_ref_matrix=$true;historical_mutable_state_rejected_intact=$historicalRejected;mutable_ref_preflight_no_side_effects=$true;powershell_posix_parity=$true;base_env='n';persisted_after_deploy='n1';clean_compose='n1';persisted_after_rollback=$rolled.AppVersion;config_hash_nonsecret=$true}|ConvertTo-Json -Compress
}finally{
  foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
  $full=[IO.Path]::GetFullPath($tempRoot);$system=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());if($full.StartsWith($system,[StringComparison]::OrdinalIgnoreCase)-and [IO.Path]::GetFileName($full)-like 'rsp07f-r1-state-*'){Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue}
}
