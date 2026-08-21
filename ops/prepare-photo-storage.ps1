param(
  [Parameter(Mandatory=$true)][string]$EnvFile,
  [Parameter(Mandatory=$true)][string]$DeploymentStateFile,
  [Parameter(Mandatory=$true)][string]$ProjectName,
  [string]$ComposeFile="docker-compose.production.yaml",
  [int]$TestFailAfter=0,
  [ValidateSet("","staging","promotion","post_verify")][string]$TestFailAt=""
)
$ErrorActionPreference="Stop"
if($ProjectName-notmatch '^[a-z0-9][a-z0-9_-]+$'){throw "ProjectName no es seguro."}
if(($TestFailAfter-gt 0-or $TestFailAt)-and $ProjectName-notmatch '^rsp07f-r3-'){throw "La inyección de fallo solo se permite en proyectos RSP-07F-R3 aislados."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envPath=(Resolve-Path $EnvFile).Path;$statePath=(Resolve-Path $DeploymentStateFile).Path;$composePath=(Resolve-Path (Join-Path $repo $ComposeFile)).Path
$compose=@("--project-name",$ProjectName,"--env-file",$envPath,"--env-file",$statePath,"-f",$composePath)
$apiId=(& docker compose @compose ps -a -q api|Out-String).Trim();if($LASTEXITCODE-ne 0-or-not $apiId){throw "No se encontró el container API previo."}
$apiRunning=(& docker inspect --format '{{.State.Running}}' $apiId|Out-String).Trim();if($LASTEXITCODE-ne 0-or $apiRunning-ne 'false'){throw "El API previo debe estar detenido antes de capturar fotos."}
$tempRoot=Join-Path ([IO.Path]::GetTempPath()) ("rsp-photo-import-{0}-{1}"-f $PID,[Guid]::NewGuid().ToString('N'));$legacy=Join-Path $tempRoot "legacy";[IO.Directory]::CreateDirectory($legacy)|Out-Null
$saved=@{};foreach($name in @('PHOTO_STORAGE_IMPORT_DIR','PHOTO_LEGACY_SOURCE_STATUS','PHOTO_STORAGE_PROJECT_NAME','PHOTO_STORAGE_TEST_FAIL_AFTER','PHOTO_STORAGE_TEST_FAIL_AT')){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try{
  $mounts=(& docker inspect --format '{{range .Mounts}}{{println .Destination}}{{end}}' $apiId|Out-String);if($LASTEXITCODE-ne 0){throw "No se pudieron inspeccionar mounts del API previo."}
  $alreadyPersistent=($mounts-split "`r?`n")-contains '/var/lib/registro-perforaciones'
  $available=$false
  if(-not $alreadyPersistent){$oldPreference=$ErrorActionPreference;$ErrorActionPreference='Continue';try{& docker cp "${apiId}:/api/public/." $legacy 2>$null;$available=($LASTEXITCODE-eq 0)}finally{$ErrorActionPreference=$oldPreference}}
  if(-not $alreadyPersistent-and-not $available){throw "El filesystem de fotos del API legacy no pudo exportarse; no es seguro continuar."}
  $env:PHOTO_STORAGE_IMPORT_DIR=$legacy.Replace('\','/');$env:PHOTO_LEGACY_SOURCE_STATUS=$(if($available){'available'}else{'not_applicable'});$env:PHOTO_STORAGE_PROJECT_NAME=$ProjectName
  if($TestFailAfter-gt 0){$env:PHOTO_STORAGE_TEST_FAIL_AFTER=[string]$TestFailAfter}else{Remove-Item Env:PHOTO_STORAGE_TEST_FAIL_AFTER -ErrorAction SilentlyContinue}
  if($TestFailAt){$env:PHOTO_STORAGE_TEST_FAIL_AT=$TestFailAt}else{Remove-Item Env:PHOTO_STORAGE_TEST_FAIL_AT -ErrorAction SilentlyContinue}
  $output=(& docker compose @compose --profile ops run --rm prepare-photo-storage|Out-String)
  if($LASTEXITCODE-ne 0-or $output-notmatch 'PHOTO_STORAGE_READY'){throw "No se pudo preparar el storage persistente de fotos."}
  Write-Output $output.Trim()
}finally{
  foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
  $full=[IO.Path]::GetFullPath($tempRoot);$system=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());if($full.StartsWith($system,[StringComparison]::OrdinalIgnoreCase)-and [IO.Path]::GetFileName($full)-like 'rsp-photo-import-*'){Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue}
}
