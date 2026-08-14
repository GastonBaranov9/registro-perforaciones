param([string]$ProjectName="rsp07f-r2-final-$PID")
$ErrorActionPreference="Stop"
if($ProjectName-notmatch '^rsp07f-r2-final-[A-Za-z0-9-]+$'){throw "ProjectName debe comenzar con rsp07f-r2-final-."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path;$composeFile=Join-Path $repo "docker-compose.production.yaml"
$tempRoot=Join-Path ([IO.Path]::GetTempPath()) $ProjectName;$backupDir=Join-Path $tempRoot "backups";$stateDir=Join-Path $tempRoot "state";$tlsDir=Join-Path $tempRoot "tls";$envFile=Join-Path $tempRoot "production.env";$deploymentStateFile=Join-Path $tempRoot "deployment.env";$passwordFile=Join-Path $tempRoot "admin-password"
foreach($dir in @($tempRoot,$backupDir,$stateDir,$tlsDir)){[IO.Directory]::CreateDirectory($dir)|Out-Null}
function RandomHex([int]$Bytes){$b=New-Object byte[] $Bytes;$g=[Security.Cryptography.RandomNumberGenerator]::Create();try{$g.GetBytes($b)}finally{$g.Dispose()};return -join($b|ForEach-Object{$_.ToString('x2')})}
function FreePort{$l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$l.Start();try{return ([Net.IPEndPoint]$l.LocalEndpoint).Port}finally{$l.Stop()}}
$pgPassword=RandomHex 24;$fastifySecret=RandomHex 48;$mapKey=RandomHex 16;$adminPassword=" $(RandomHex 24) ";$adminEmail="admin-$ProjectName@example.test";$hostName="rsp07f.example.test";$httpPort=FreePort;$httpsPort=FreePort;$origin="https://${hostName}:$httpsPort";$gitSha=(& git rev-parse HEAD|Out-String).Trim()
$apiN="rsp07f-api:${ProjectName}-n";$frontN="rsp07f-front:${ProjectName}-n";$apiN1="rsp07f-api:${ProjectName}-n1";$frontN1="rsp07f-front:${ProjectName}-n1"
$cert=Join-Path $tlsDir "ephemeral.crt";$key=Join-Path $tlsDir "ephemeral.key";$openssl=(Get-Command openssl.exe -ErrorAction Stop).Source
$oldArg=$env:MSYS2_ARG_CONV_EXCL;$env:MSYS2_ARG_CONV_EXCL="*";$oldPref=$ErrorActionPreference;$ErrorActionPreference="Continue";try{& $openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 1 -subj "/CN=$hostName" -addext "subjectAltName=DNS:$hostName" -keyout $key -out $cert 2>$null}finally{$ErrorActionPreference=$oldPref;if($null-eq $oldArg){Remove-Item Env:MSYS2_ARG_CONV_EXCL -ErrorAction SilentlyContinue}else{$env:MSYS2_ARG_CONV_EXCL=$oldArg}}
if($LASTEXITCODE-ne 0){throw "No se pudo generar TLS efímero."}
[IO.File]::WriteAllText($passwordFile,$adminPassword+"`r`n",[Text.UTF8Encoding]::new($false))
$envText=@"
PGUSER=rsp07f
PGPASSWORD=$pgPassword
PGDATABASE=rsp07f
FASTIFY_SECRET=$fastifySecret
PUBLIC_HOST=$hostName
PUBLIC_ORIGIN=$origin
CORS_ORIGINS=
MAP_STATIC_URL_TEMPLATE=https://maps.googleapis.com/maps/api/staticmap?center={latitud},{longitud}&zoom=17&size=640x400&key={apiKey}
MAP_STATIC_ALLOWED_HOST=maps.googleapis.com
MAP_STATIC_API_KEY=$mapKey
MAP_STATIC_ATTRIBUTION=Google Maps
API_IMAGE_REF=$apiN
FRONT_IMAGE_REF=$frontN
APP_VERSION=rsp07f-n
GIT_SHA=$gitSha
HTTP_BIND_ADDRESS=127.0.0.1
HTTP_PORT=$httpPort
HTTPS_BIND_ADDRESS=127.0.0.1
HTTPS_PORT=$httpsPort
TLS_CERT_FILE=$($cert.Replace('\','/'))
TLS_KEY_FILE=$($key.Replace('\','/'))
BACKUP_DIR=$($backupDir.Replace('\','/'))
HSTS_ENABLED=false
"@
[IO.File]::WriteAllText($envFile,$envText,[Text.UTF8Encoding]::new($false))
. (Join-Path $repo "ops/deployment-state.ps1")
Write-DeploymentStateAtomic $deploymentStateFile $apiN $frontN "rsp07f-n" $gitSha|Out-Null
$compose=@("--project-name",$ProjectName,"--env-file",$envFile,"--env-file",$deploymentStateFile,"-f",$composeFile);$started=$false
function Compose([string[]]$Arguments){& docker compose @compose @Arguments;if($LASTEXITCODE-ne 0){throw "docker compose falló: $($Arguments-join ' ')"}}
function Psql([string]$Sql){$value=(& docker compose @compose exec -T postgres psql --no-psqlrc -U rsp07f -d rsp07f -qAtc $Sql|Out-String).Trim();if($LASTEXITCODE-ne 0){throw "Consulta controlada falló."};return $value}
try{
  $started=$true
  Compose @("config","--quiet");Compose @("build","api","front");Compose @("up","-d","--wait","--wait-timeout","180","postgres");Compose @("--profile","ops","run","--rm","migrate")
  Compose @("--profile","ops","run","--rm","-e","ADMIN_EMAIL=$adminEmail","-e","ADMIN_NAME=Administrador RSP07F","-e","ADMIN_PASSWORD_FILE=/run/secrets/admin-password","-v","${passwordFile}:/run/secrets/admin-password:ro","bootstrap-admin")
  $owner=Psql "INSERT INTO usuario(email,nombre,password,activo,cuenta_acceso) VALUES(NULL,'Propietario RSP07F',NULL,TRUE,FALSE) RETURNING id_usuario";$perf=Psql "INSERT INTO usuario(email,nombre,password,activo,cuenta_acceso) VALUES('perforador-rsp07f@example.test','Perforador RSP07F','hash-no-login',TRUE,TRUE) RETURNING id_usuario"
  Psql "INSERT INTO usuario_rol SELECT $owner,id_rol FROM rol WHERE nombre='propietario'; INSERT INTO usuario_rol SELECT $perf,id_rol FROM rol WHERE nombre='perforador'"|Out-Null
  $site=Psql "INSERT INTO sitio(departamento,localidad,latitud,longitud) VALUES('Salto','Simulacro final',NULL,NULL) RETURNING id_sitio";$admin=Psql "SELECT id_usuario FROM usuario WHERE email='$adminEmail'"
  $well=Psql "INSERT INTO pozo(id_propietario,id_sitio,id_perforador,creado_por,empresa,profundidad_final_m,foto_url) VALUES($owner,$site,$perf,$admin,'Version N',30,'/usuarios/$owner/pozos/1/foto') RETURNING id_pozo";$lit=Psql "SELECT id_litologia FROM catalogo_litologia WHERE codigo='arenisca_fina'"
  Psql "INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material,id_litologia) VALUES($well,0,30,'Arenisca fina',$lit); INSERT INTO intervalo_diametro_perforacion(id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia) VALUES($well,0,30,8,'PVC'); INSERT INTO intervalo_filtro(id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,ranura_mm) VALUES($well,20,25,6,'PVC',0.75); INSERT INTO nivel_aporte(id_pozo,profundidad_m) VALUES($well,18)"|Out-Null
  Compose @("up","-d","--no-deps","--wait","--wait-timeout","180","api","front");$photoScript="import fs from 'node:fs/promises';await fs.writeFile('/var/lib/registro-perforaciones/fotos/pozo-$well.jpg',Buffer.from([0xff,0xd8,0xff,0xd9]),{flag:'wx'});";& docker compose @compose exec -T api node --input-type=module -e $photoScript;if($LASTEXITCODE-ne 0){throw "No se pudo crear la foto representativa."};Compose @("up","-d","--no-deps","--wait","--wait-timeout","180","proxy")
  $smokeN=& (Join-Path $repo "ops/smoke.ps1") -EnvFile $envFile -ProjectName $ProjectName -AdminEmail $adminEmail -AdminPasswordFile $passwordFile;if($smokeN-notcontains 'SMOKE_OK'){throw "Smoke N falló."}
  $photoSha=(& docker compose @compose exec -T api sha256sum "/var/lib/registro-perforaciones/fotos/pozo-$well.jpg"|Out-String).Trim().Split(' ')[0]
  $countsBefore=Psql "SELECT (SELECT count(*) FROM usuario)||','||(SELECT count(*) FROM sitio)||','||(SELECT count(*) FROM pozo)||','||(SELECT count(*) FROM intervalo_litologico)||','||(SELECT count(*) FROM intervalo_filtro)";$migrationsBefore=Psql "SELECT string_agg(version||':'||nombre,',' ORDER BY version) FROM schema_migrations"

  $deploy=& (Join-Path $repo "ops/deploy.ps1") -EnvFile $envFile -DeploymentStateFile $deploymentStateFile -ProjectName $ProjectName -BackupDir $backupDir -StateDir $stateDir -TargetApiImage $apiN1 -TargetFrontImage $frontN1 -TargetVersion "rsp07f-n1" -GitSha $gitSha -SmokeAdminEmail $adminEmail -SmokeAdminPasswordFile $passwordFile -BuildImages
  if($deploy-notcontains 'DEPLOY_OK'){throw "Deploy N+1 no declaró DEPLOY_OK."};$stateFile=Join-Path $stateDir "deploy-$ProjectName.json";$state=Get-Content -Raw $stateFile|ConvertFrom-Json
  if($state.backup_bundle-notmatch '^rsp-backup-'){throw "Deploy no registró backup."}
  $runningVersion=(& docker compose @compose exec -T api node -e "console.log(process.env.APP_VERSION)"|Out-String).Trim();if($runningVersion-ne 'rsp07f-n1'){throw "N+1 no quedó identificada."}

  $persistedN1=Read-DeploymentState $deploymentStateFile;if($persistedN1.ApiImage-ne $apiN1-or $persistedN1.FrontImage-ne $frontN1-or $persistedN1.AppVersion-ne 'rsp07f-n1'){throw "Deploy no persistio N+1."}
  Compose @("up","-d","--no-deps","--force-recreate","--wait","--wait-timeout","180","api","front")
  $cleanApi=(& docker compose @compose ps -q api|Out-String).Trim();$cleanFront=(& docker compose @compose ps -q front|Out-String).Trim();if((& docker inspect --format '{{.Config.Image}}' $cleanApi|Out-String).Trim()-ne $apiN1-or (& docker inspect --format '{{.Config.Image}}' $cleanFront|Out-String).Trim()-ne $frontN1){throw "Compose limpio regreso a referencias N."}
  $oldApi=$env:API_IMAGE_REF;$oldFront=$env:FRONT_IMAGE_REF;$oldVersion=$env:APP_VERSION;$oldSha=$env:GIT_SHA;$oldSecret=$env:FASTIFY_SECRET
  $env:API_IMAGE_REF=$apiN1;$env:FRONT_IMAGE_REF=$frontN1;$env:APP_VERSION='rsp07f-n1';$env:GIT_SHA=$gitSha;$env:FASTIFY_SECRET='fallo-controlado'
  $faultDetected=$false;$oldPref=$ErrorActionPreference;$ErrorActionPreference='Continue';try{& docker compose @compose up -d --no-deps --force-recreate --wait --wait-timeout 30 api;if($LASTEXITCODE-ne 0){$faultDetected=$true}}finally{$ErrorActionPreference=$oldPref;if($null-eq $oldApi){Remove-Item Env:API_IMAGE_REF -ErrorAction SilentlyContinue}else{$env:API_IMAGE_REF=$oldApi};if($null-eq $oldFront){Remove-Item Env:FRONT_IMAGE_REF -ErrorAction SilentlyContinue}else{$env:FRONT_IMAGE_REF=$oldFront};if($null-eq $oldVersion){Remove-Item Env:APP_VERSION -ErrorAction SilentlyContinue}else{$env:APP_VERSION=$oldVersion};if($null-eq $oldSha){Remove-Item Env:GIT_SHA -ErrorAction SilentlyContinue}else{$env:GIT_SHA=$oldSha};if($null-eq $oldSecret){Remove-Item Env:FASTIFY_SECRET -ErrorAction SilentlyContinue}else{$env:FASTIFY_SECRET=$oldSecret}}
  if(-not $faultDetected){throw "El fallo controlado de configuración no fue detectado."}
  $rollbackApp=& (Join-Path $repo "ops/rollback.ps1") -EnvFile $envFile -DeploymentStateFile $deploymentStateFile -ProjectName $ProjectName -StateFile $stateFile -Level Application -Confirm DATABASE_BACKWARD_COMPATIBLE -BackupDir $backupDir -SmokeAdminEmail $adminEmail -SmokeAdminPasswordFile $passwordFile
  if($rollbackApp-notcontains 'ROLLBACK_OK'){throw "Rollback de aplicación no terminó correctamente."}

  $persistedN=Read-DeploymentState $deploymentStateFile;if($persistedN.ApiImage-ne $apiN-or $persistedN.FrontImage-ne $frontN-or $persistedN.AppVersion-ne 'rsp07f-n'){throw "Rollback no persistio N."}
  Compose @("up","-d","--no-deps","--force-recreate","--wait","--wait-timeout","180","api","front")
  $cleanApi=(& docker compose @compose ps -q api|Out-String).Trim();$cleanFront=(& docker compose @compose ps -q front|Out-String).Trim();if((& docker inspect --format '{{.Config.Image}}' $cleanApi|Out-String).Trim()-ne $apiN-or (& docker inspect --format '{{.Config.Image}}' $cleanFront|Out-String).Trim()-ne $frontN){throw "Compose limpio no conservo rollback N."}
  $failedStdout=Join-Path $tempRoot 'failed-deploy.stdout';$oldPref=$ErrorActionPreference;$ErrorActionPreference='Continue';try{& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo "ops/deploy.ps1") -EnvFile $envFile -DeploymentStateFile $deploymentStateFile -ProjectName $ProjectName -BackupDir $backupDir -StateDir $stateDir -TargetApiImage $apiN1 -TargetFrontImage $frontN1 -TargetVersion "rsp07f-n1" -GitSha $gitSha -SmokeAdminEmail $adminEmail -SmokeAdminPasswordFile $passwordFile -BuildImages -TestFailAfterPhase services_incompatible >$failedStdout;$failedDetected=($LASTEXITCODE-ne 0)}finally{$ErrorActionPreference=$oldPref}
  $failedText=[IO.File]::ReadAllText($failedStdout);if(-not $failedDetected-or $failedText-notmatch 'DEPLOY_FAILED'-or $failedText-notmatch [regex]::Escape("ROLLBACK_REQUIRED=$stateFile")){throw "Deploy fallido real no emitio su audit recuperable."}
  $failedState=Get-Content -Raw $stateFile|ConvertFrom-Json;if($failedState.status-ne 'failed'-or $failedState.phase_started-ne 'services'-or $failedState.phase_completed-ne 'services'-or $failedState.database_recovery-ne 'restore_required'){throw "Audit failed no registro fase/evidencia suficiente."}
  $rollbackFull=& (Join-Path $repo "ops/rollback.ps1") -EnvFile $envFile -DeploymentStateFile $deploymentStateFile -ProjectName $ProjectName -StateFile $stateFile -Level Full -Confirm RESTORE_EXISTING_TARGET_FROM_BACKUP -BackupDir $backupDir -SmokeAdminEmail $adminEmail -SmokeAdminPasswordFile $passwordFile
  if($rollbackFull-notcontains 'ROLLBACK_OK'){throw "Rollback no acepto el audit failed exacto."}
  $countsAfter=Psql "SELECT (SELECT count(*) FROM usuario)||','||(SELECT count(*) FROM sitio)||','||(SELECT count(*) FROM pozo)||','||(SELECT count(*) FROM intervalo_litologico)||','||(SELECT count(*) FROM intervalo_filtro)";$migrationsAfter=Psql "SELECT string_agg(version||':'||nombre,',' ORDER BY version) FROM schema_migrations";$company=Psql "SELECT empresa FROM pozo WHERE id_pozo=$well";$photoShaAfter=(& docker compose @compose exec -T api sha256sum "/var/lib/registro-perforaciones/fotos/pozo-$well.jpg"|Out-String).Trim().Split(' ')[0]
  if($countsAfter-ne $countsBefore-or $migrationsAfter-ne $migrationsBefore-or $company-ne 'Version N'-or $photoShaAfter-ne $photoSha){throw "Rollback desde failed audit no recupero datos/foto N."}
  $reconcile=(& docker compose @compose --profile ops run --rm reconcile-fotos|Out-String);if($LASTEXITCODE-ne 0-or $reconcile-notmatch '"referencia_sin_archivo":0' -or $reconcile-notmatch '"archivo_sin_referencia":0' -or $reconcile-notmatch '"trash_total":0'){throw "Reconciliación final no quedó limpia."}
  [pscustomobject]@{project=$ProjectName;version_n='rsp07f-n';version_n1='rsp07f-n1';success_audit_rollback=$true;failed_audit_status=$failedState.status;failed_phase=$failedState.phase_started;rollback_required_exact=$true;restore_full=$true;password_whitespace_crlf=$true;deployment_state_final=(Read-DeploymentState $deploymentStateFile).AppVersion;counts=$countsAfter;migrations_ok=$true;photo_sha256=$photoShaAfter;reconcile_clean=$true}|ConvertTo-Json -Compress
}finally{
  if($started-and $ProjectName-match '^rsp07f-r2-final-[A-Za-z0-9-]+$'){& docker compose @compose --profile ops down --volumes --remove-orphans}
  $cleanupPreference=$ErrorActionPreference;$ErrorActionPreference='SilentlyContinue';try{foreach($image in @($apiN,$frontN,$apiN1,$frontN1)){& docker image rm $image 2>$null|Out-Null}}finally{$ErrorActionPreference=$cleanupPreference}
  $full=[IO.Path]::GetFullPath($tempRoot);$system=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());if($full.StartsWith($system,[StringComparison]::OrdinalIgnoreCase)-and [IO.Path]::GetFileName($full)-like 'rsp07f-r2-final-*'){Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue}
}
