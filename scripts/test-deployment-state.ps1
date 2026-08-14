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
  Write-DeploymentStateAtomic $statePath $apiN $frontN 'n' 'abc123'|Out-Null
  $before=[IO.File]::ReadAllBytes($statePath)
  $rejected=$false;try{Write-DeploymentStateAtomic $statePath 'latest' $frontN 'bad' 'abc123'|Out-Null}catch{$rejected=$true}
  if(-not $rejected-or [Convert]::ToBase64String($before)-ne [Convert]::ToBase64String([IO.File]::ReadAllBytes($statePath))){throw "Un target invalido modifico el estado N."}
  $n1=Write-DeploymentStateAtomic $statePath $apiN1 $frontN1 'n1' 'def456'
  $bash=(Get-Command bash.exe -ErrorAction Stop).Source
  $repoUnix=$repo.Replace('\','/');$stateUnix=$statePath.Replace('\','/');$testUnix=(Join-Path $repo 'scripts/test-deployment-state-posix.sh').Replace('\','/')
  $parity=(& $bash $testUnix $repoUnix $stateUnix|Out-String).Trim()
  if($LASTEXITCODE-ne 0-or $parity-ne "n1|$($n1.ConfigHash)"){throw "PowerShell/POSIX no interpretan el mismo deployment state."}
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
  [pscustomobject]@{state_format=1;atomic_failure_preserved_n=$rejected;powershell_posix_parity=$true;base_env='n';persisted_after_deploy='n1';clean_compose='n1';persisted_after_rollback=$rolled.AppVersion;config_hash_nonsecret=$true}|ConvertTo-Json -Compress
}finally{
  foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
  $full=[IO.Path]::GetFullPath($tempRoot);$system=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());if($full.StartsWith($system,[StringComparison]::OrdinalIgnoreCase)-and [IO.Path]::GetFileName($full)-like 'rsp07f-r1-state-*'){Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue}
}
