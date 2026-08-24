param([string]$ProjectName="rsp07f-r3-main-$PID")
$ErrorActionPreference="Stop"
if($ProjectName-notmatch '^rsp07f-r3-main-[A-Za-z0-9-]+$'){throw "ProjectName inseguro."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path;$tempRoot=Join-Path ([IO.Path]::GetTempPath()) "$ProjectName-$([Guid]::NewGuid().ToString('N'))";$legacyRoot=Join-Path $tempRoot 'main';$backupDir=Join-Path $tempRoot 'backups';$stateDir=Join-Path $tempRoot 'state';$tlsDir=Join-Path $tempRoot 'tls';$envFile=Join-Path $tempRoot 'production.env';$deploymentFile=Join-Path $tempRoot 'deployment.env';$passwordFile=Join-Path $tempRoot 'admin-password';$legacyCompose=Join-Path $legacyRoot 'docker-compose.legacy-test.yaml';$archive=Join-Path $tempRoot 'main.tar';$tarExe=Join-Path $env:SystemRoot 'System32/tar.exe'
foreach($dir in @($tempRoot,$legacyRoot,$backupDir,$stateDir,$tlsDir)){[IO.Directory]::CreateDirectory($dir)|Out-Null}
function RandomHex([int]$Bytes){$b=New-Object byte[] $Bytes;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($b)}finally{$rng.Dispose()};return -join($b|ForEach-Object{$_.ToString('x2')})}
function FreePort{$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start();try{return ([Net.IPEndPoint]$listener.LocalEndpoint).Port}finally{$listener.Stop()}}
& git archive --format=tar --output=$archive main;if($LASTEXITCODE-ne 0){throw 'No se pudo archivar main.'};& $tarExe -xf $archive -C $legacyRoot;if($LASTEXITCODE-ne 0){throw 'No se pudo extraer main.'};[IO.Directory]::CreateDirectory((Join-Path $legacyRoot 'api/public'))|Out-Null
$pgPassword=RandomHex 24;$fastifySecret=RandomHex 48;$mapKey=RandomHex 16;$adminPassword="RSP07F-R3-$(RandomHex 12)!";$adminEmail="admin-$ProjectName@example.test";$hostName='rsp07f-r3.example.test';$httpPort=FreePort;$httpsPort=FreePort;$origin="https://${hostName}:$httpsPort";$gitSha=(& git rev-parse HEAD|Out-String).Trim();$imageNamespace=$ProjectName.ToLowerInvariant();$apiLegacy="rsp07f-r3-api-${imageNamespace}-main:$gitSha";$frontLegacy="rsp07f-r3-front-${imageNamespace}-main:$gitSha";$apiTarget="rsp07f-r3-api-${imageNamespace}-target:$gitSha";$frontTarget="rsp07f-r3-front-${imageNamespace}-target:$gitSha"
$cert=Join-Path $tlsDir 'ephemeral.crt';$key=Join-Path $tlsDir 'ephemeral.key';$openssl=(Get-Command openssl.exe -ErrorAction Stop).Source;$oldArg=$env:MSYS2_ARG_CONV_EXCL;$env:MSYS2_ARG_CONV_EXCL='*';$oldPref=$ErrorActionPreference;$ErrorActionPreference='Continue';try{& $openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 1 -subj "/CN=$hostName" -addext "subjectAltName=DNS:$hostName" -keyout $key -out $cert 2>$null}finally{$ErrorActionPreference=$oldPref;if($null-eq $oldArg){Remove-Item Env:MSYS2_ARG_CONV_EXCL -ErrorAction SilentlyContinue}else{$env:MSYS2_ARG_CONV_EXCL=$oldArg}};if($LASTEXITCODE-ne 0){throw 'No se pudo crear TLS efímero.'}
[IO.File]::WriteAllText($passwordFile,$adminPassword+"`n",[Text.UTF8Encoding]::new($false))
$envText=@"
PGUSER=rsp07f
PGPASSWORD=$pgPassword
PGDATABASE=rsp07f
PGPORT=5432
FASTIFY_SECRET=$fastifySecret
PUBLIC_HOST=$hostName
PUBLIC_ORIGIN=$origin
CORS_ORIGINS=
MAP_STATIC_URL_TEMPLATE=https://maps.googleapis.com/maps/api/staticmap?center={latitud},{longitud}&zoom=17&size=640x400&key={apiKey}
MAP_STATIC_ALLOWED_HOST=maps.googleapis.com
MAP_STATIC_API_KEY=$mapKey
MAP_STATIC_ATTRIBUTION=Google Maps
PDF_MAP_STATIC_URL_TEMPLATE=https://maps.googleapis.com/maps/api/staticmap?center={latitud},{longitud}&zoom=17&size=640x400&key={apiKey}
PDF_MAP_ALLOWED_HOST=maps.googleapis.com
PDF_MAP_STATIC_API_KEY=$mapKey
PDF_MAP_ATTRIBUTION=Google Maps
API_IMAGE_REF=$apiLegacy
FRONT_IMAGE_REF=$frontLegacy
APP_VERSION=unknown
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
$legacyYaml=@"
services:
  postgres:
    image: postgres:16.14-alpine3.24
    environment:
      POSTGRES_USER: `${PGUSER}
      POSTGRES_PASSWORD: `${PGPASSWORD}
      POSTGRES_DB: `${PGDATABASE}
    volumes:
      - raul_silva_db:/var/lib/postgresql/data
      - ./api/db:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U `$`$POSTGRES_USER -d `$`$POSTGRES_DB"]
      interval: 3s
      timeout: 3s
      retries: 30
    networks: [backend]
  api:
    image: `${API_IMAGE_REF}
    build: { context: ./api, target: production }
    environment:
      NODE_ENV: production
      FASTIFY_SECRET: `${FASTIFY_SECRET}
      PGHOST: postgres
      PGPORT: "5432"
      PGUSER: `${PGUSER}
      PGPASSWORD: `${PGPASSWORD}
      PGDATABASE: `${PGDATABASE}
      MAP_STATIC_URL_TEMPLATE: `${MAP_STATIC_URL_TEMPLATE}
      MAP_STATIC_ALLOWED_HOST: `${MAP_STATIC_ALLOWED_HOST}
      MAP_STATIC_API_KEY: `${MAP_STATIC_API_KEY}
      MAP_STATIC_ATTRIBUTION: `${MAP_STATIC_ATTRIBUTION}
    depends_on:
      postgres: { condition: service_healthy }
    networks: [backend]
  front:
    image: `${FRONT_IMAGE_REF}
    build: { context: ./front, target: production }
    networks: [edge]
  proxy:
    image: nginx:1.30.4-alpine3.24
    command: ["nginx", "-g", "daemon off;"]
    networks: [edge]
volumes:
  raul_silva_db:
networks:
  edge:
  backend: { internal: true }
"@
[IO.File]::WriteAllText($legacyCompose,$legacyYaml,[Text.UTF8Encoding]::new($false))
. (Join-Path $repo 'ops/deployment-state.ps1');Write-DeploymentStateAtomic $deploymentFile $apiLegacy $frontLegacy 'unknown' $gitSha|Out-Null
$currentCompose=Join-Path $repo 'docker-compose.production.yaml';$legacyArgs=@('--project-name',$ProjectName,'--env-file',$envFile,'-f',$legacyCompose);$currentArgs=@('--project-name',$ProjectName,'--env-file',$envFile,'--env-file',$deploymentFile,'-f',$currentCompose);$started=$false
function Legacy([string[]]$Arguments){& docker compose @legacyArgs @Arguments;if($LASTEXITCODE-ne 0){throw "Legacy Compose falló: $($Arguments-join ' ')"}}
function Current([string[]]$Arguments){& docker compose @currentArgs @Arguments;if($LASTEXITCODE-ne 0){throw "Current Compose falló: $($Arguments-join ' ')"}}
function Psql([string]$Sql){$value=(& docker compose @currentArgs exec -T postgres psql --no-psqlrc -U rsp07f -d rsp07f -qAtc $Sql|Out-String).Trim();if($LASTEXITCODE-ne 0){throw 'Consulta controlada falló.'};return $value}
try{
  $started=$true;Legacy @('build','api','front');Legacy @('up','-d','--wait','--wait-timeout','180','postgres','api','front','proxy')
  $photoVolume="${ProjectName}_raul_silva_fotos";$old=$ErrorActionPreference;$ErrorActionPreference='Continue';try{& docker volume inspect $photoVolume 2>$null|Out-Null;$volumeAbsent=($LASTEXITCODE-ne 0)}finally{$ErrorActionPreference=$old};if(-not $volumeAbsent){throw 'El volumen RSP-07 existía antes del primer upgrade.'}
  Legacy @('stop','api');$emptyPrepare=& (Join-Path $repo 'ops/prepare-photo-storage.ps1') -EnvFile $envFile -DeploymentStateFile $deploymentFile -ProjectName $ProjectName;if($emptyPrepare-notmatch 'MODE=initialized_empty'-or $emptyPrepare-notmatch 'DB_REFERENCES=0'){throw 'Instalación legacy sin fotos no inicializó vacía.'};$emptyBackup=& (Join-Path $repo 'ops/backup.ps1') -EnvFile $envFile -DeploymentStateFile $deploymentFile -ProjectName $ProjectName -BackupDir $backupDir;if($emptyBackup-notmatch 'BACKUP_BUNDLE=(rsp-backup-\d{8}T\d{6}Z)'){throw 'Backup vacío de primer upgrade falló.'};$emptyBundle=$matches[1];Remove-Item -LiteralPath (Join-Path $backupDir $emptyBundle) -Recurse -Force;& docker volume rm $photoVolume|Out-Null;if($LASTEXITCODE-ne 0){throw 'No se pudo limpiar el fixture vacío.'};Legacy @('start','api')
  $apiId=(& docker compose @legacyArgs ps -q api|Out-String).Trim();$postgresId=(& docker compose @legacyArgs ps -q postgres|Out-String).Trim();if(-not $apiId-or-not $postgresId){throw 'Stack main incompleto.'}
  & docker cp $passwordFile "${apiId}:/tmp/admin-password";if($LASTEXITCODE-ne 0){throw 'No se pudo entregar password de prueba.'}
  $hash=(& docker exec $apiId node --input-type=module -e "import fs from 'node:fs';import bcrypt from 'bcryptjs';const p=fs.readFileSync('/tmp/admin-password','utf8').replace(/\r?\n`$/,'');console.log(await bcrypt.hash(p,12));"|Out-String).Trim();$hashOk=($LASTEXITCODE-eq 0);& docker exec -u 0 $apiId rm -f /tmp/admin-password;if(-not $hashOk-or $hash-notmatch '^\$2'){throw 'No se pudo generar hash de prueba.'}
  $seed=Join-Path $tempRoot 'seed.sql';$seedSql=@"
INSERT INTO rol(id_rol,nombre,descr) VALUES (1,'administracion','Administración'),(2,'perforador','Perforación'),(3,'propietario','Propiedad');
INSERT INTO usuario(id_usuario,email,nombre,password,activo,cuenta_acceso,version_sesion) VALUES
 (1,'$adminEmail','Administrador R3','$hash',TRUE,TRUE,1),
 (2,NULL,'Propietario R3',NULL,TRUE,FALSE,1),
 (3,'perforador-r3@example.test','Perforador R3','$hash',TRUE,TRUE,1);
INSERT INTO usuario_rol(id_usuario,id_rol) VALUES (1,1),(2,3),(3,2);
INSERT INTO sitio(id_sitio,departamento,localidad,latitud,longitud) VALUES(1,'Salto','Legacy main',NULL,NULL);
INSERT INTO pozo(id_pozo,id_propietario,id_sitio,id_perforador,creado_por,empresa,profundidad_final_m,foto_url) VALUES
 (1,2,1,3,1,'Legacy replace',30,'/usuarios/2/pozos/1/foto'),
 (2,2,1,3,1,'Legacy delete',30,'/usuarios/2/pozos/2/foto'),
 (4,2,1,3,1,'Legacy unchanged',30,'/usuarios/2/pozos/4/foto');
INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material,id_litologia) SELECT 1,0,30,'Arenisca fina',id_litologia FROM catalogo_litologia WHERE codigo='arenisca_fina';
INSERT INTO intervalo_diametro_perforacion(id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia) VALUES(1,0,30,8,'PVC');
INSERT INTO intervalo_filtro(id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,ranura_mm) VALUES(1,20,25,6,'PVC',0.75);
INSERT INTO nivel_aporte(id_pozo,profundidad_m) VALUES(1,18);
"@;[IO.File]::WriteAllText($seed,$seedSql,[Text.UTF8Encoding]::new($false));& docker cp $seed "${postgresId}:/tmp/seed.sql";if($LASTEXITCODE-ne 0){throw 'No se pudo entregar seed.'};& docker exec $postgresId psql --no-psqlrc -v ON_ERROR_STOP=1 -U rsp07f -d rsp07f -f /tmp/seed.sql|Out-Null;$seedOk=($LASTEXITCODE-eq 0);& docker exec -u 0 $postgresId rm -f /tmp/seed.sql;if(-not $seedOk){throw 'No se pudo cargar seed legacy.'}
  $photoSourceA=Join-Path $repo 'front/public/assets/branding/background.jpeg';foreach($id in @(1,2,4)){& docker cp $photoSourceA "${apiId}:/api/public/pozo-$id.jpg";if($LASTEXITCODE-ne 0){throw "No se pudo crear foto legacy $id."}};$legacyShaA=(& docker exec $apiId sha256sum /api/public/pozo-1.jpg|Out-String).Trim().Split(' ')[0]
  $failedOutput=Join-Path $tempRoot 'post-photo-storage-failure.stdout';$old=$ErrorActionPreference;$ErrorActionPreference='Continue';try{& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'ops/deploy.ps1') -EnvFile $envFile -DeploymentStateFile $deploymentFile -ProjectName $ProjectName -BackupDir $backupDir -StateDir $stateDir -TargetApiImage $apiTarget -TargetFrontImage $frontTarget -TargetVersion 'rsp07f-r3' -GitSha $gitSha -SmokeAdminEmail $adminEmail -SmokeAdminPasswordFile $passwordFile -BuildImages -TestFailAfterPhase photo_storage >$failedOutput;$postPhotoFailureDetected=($LASTEXITCODE-ne 0)}finally{$ErrorActionPreference=$old};$failedText=[IO.File]::ReadAllText($failedOutput);$sameApi=(& docker compose @legacyArgs ps -q api|Out-String).Trim();$apiRunning=(& docker inspect --format '{{.State.Running}}' $apiId|Out-String).Trim();$bundles=@(Get-ChildItem $backupDir -Directory -Filter 'rsp-backup-*' -ErrorAction SilentlyContinue);if(-not $postPhotoFailureDetected-or $failedText-notmatch 'DEPLOY_FAILED'-or $failedText-notmatch 'ROLLBACK_NOT_REQUIRED'-or $sameApi-ne $apiId-or $apiRunning-ne 'true'-or $bundles.Count-ne 0){throw 'Fallo post-photo_storage no abortó antes de backup o no restauró el API legacy.'}
  $firstAttemptSha=(& docker run --rm -v "${photoVolume}:/data:ro" --entrypoint /bin/sh postgres:16.14-alpine3.24 -c "sha256sum /data/fotos/pozo-1.jpg | awk '{print `$1}'"|Out-String).Trim();if($LASTEXITCODE-ne 0-or $firstAttemptSha-ne $legacyShaA){throw 'Primer intento no dejó snapshot A verificable.'}
  $photoSourceB=Join-Path $repo 'front/public/assets/branding/logo.png';& docker cp $photoSourceB "${apiId}:/api/public/pozo-1.png";if($LASTEXITCODE-ne 0){throw 'No se pudo reemplazar foto 1.'};& docker exec -u 0 $apiId rm -f /api/public/pozo-1.jpg /api/public/pozo-2.jpg;if($LASTEXITCODE-ne 0){throw 'No se pudieron retirar fotos legacy reemplazada/eliminada.'};& docker cp $photoSourceB "${apiId}:/api/public/pozo-3.png";if($LASTEXITCODE-ne 0){throw 'No se pudo agregar foto 3.'};[void](Psql "UPDATE pozo SET foto_url=NULL WHERE id_pozo=2; INSERT INTO pozo(id_pozo,id_propietario,id_sitio,id_perforador,creado_por,empresa,profundidad_final_m,foto_url) VALUES(3,2,1,3,1,'Legacy added',30,'/usuarios/2/pozos/3/foto');");$legacyShaB=(& docker exec $apiId sha256sum /api/public/pozo-1.png|Out-String).Trim().Split(' ')[0]
  $deploy=& (Join-Path $repo 'ops/deploy.ps1') -EnvFile $envFile -DeploymentStateFile $deploymentFile -ProjectName $ProjectName -BackupDir $backupDir -StateDir $stateDir -TargetApiImage $apiTarget -TargetFrontImage $frontTarget -TargetVersion 'rsp07f-r3' -GitSha $gitSha -SmokeAdminEmail $adminEmail -SmokeAdminPasswordFile $passwordFile -BuildImages
  if($deploy-notcontains 'DEPLOY_OK'){throw 'Primer upgrade no terminó en DEPLOY_OK.'};$audit=Get-Content -Raw (Join-Path $stateDir "deploy-$ProjectName.json")|ConvertFrom-Json;if(-not $audit.legacy_schema_without_ledger-or $audit.phase_completed-ne 'complete'){throw 'Audit no registró transición legacy completa.'}
  $volumeSha=(& docker compose @currentArgs exec -T api sha256sum /var/lib/registro-perforaciones/fotos/pozo-1.png|Out-String).Trim().Split(' ')[0];$volumePaths=(& docker compose @currentArgs exec -T api sh -c "find /var/lib/registro-perforaciones/fotos -maxdepth 1 -type f -exec basename {} ';' | sort"|Out-String).Trim();$expectedPaths="pozo-1.png`npozo-3.png`npozo-4.jpg";if($volumeSha-ne $legacyShaB-or $volumePaths.Replace("`r",'')-ne $expectedPaths){throw "Retry no reflejó reemplazo/delete/add/unchanged: $volumePaths"};if((Psql "SELECT count(*) FROM schema_migrations")-ne '8'){throw 'El esquema legacy no fue adoptado/migrado.'}
  $bundle=$audit.backup_bundle;$bundlePath=Join-Path $backupDir $bundle;$extract=Join-Path $tempRoot 'backup-extract';[IO.Directory]::CreateDirectory($extract)|Out-Null;& $tarExe -xzf (Join-Path $bundlePath 'photos.tar.gz') -C $extract;if($LASTEXITCODE-ne 0){throw 'No se pudo inspeccionar backup de fotos.'};$backupSha=(Get-FileHash (Join-Path $extract 'fotos/pozo-1.png') -Algorithm SHA256).Hash.ToLowerInvariant();$backupPaths=@(Get-ChildItem (Join-Path $extract 'fotos') -File|Sort-Object Name|ForEach-Object{$_.Name});if($backupSha-ne $legacyShaB-or ($backupPaths-join '|')-ne 'pozo-1.png|pozo-3.png|pozo-4.jpg'){throw 'Backup no capturó el snapshot legacy refrescado.'};$manifest=[IO.File]::ReadAllText((Join-Path $bundlePath 'manifest.txt'));if($manifest-notmatch 'SCHEMA_STATE=legacy-unmanaged'-or $manifest-notmatch 'MIGRATIONS=legacy-unmanaged'){throw 'Backup no identificó esquema legacy.'}
  $currentApiId=(& docker compose @currentArgs ps -q api|Out-String).Trim();& docker cp $photoSourceA "${currentApiId}:/api/public/pozo-1.jpg";if($LASTEXITCODE-ne 0){throw 'No se pudo alterar fixture legacy post-cutover.'};Current @('stop','api');$secondPrepare=& (Join-Path $repo 'ops/prepare-photo-storage.ps1') -EnvFile $envFile -DeploymentStateFile $deploymentFile -ProjectName $ProjectName;if($secondPrepare-notmatch 'MODE=existing'-or $secondPrepare-notmatch 'COPIED=0'){throw 'Segundo prepare no fue no-op.'};$postCutoverPaths=(& docker run --rm -v "${photoVolume}:/data:ro" --entrypoint /bin/sh postgres:16.14-alpine3.24 -c "find /data/fotos -maxdepth 1 -type f -exec basename {} ';' | sort"|Out-String).Trim();if($postCutoverPaths.Replace("`r",'')-ne $expectedPaths){throw 'Prepare post-cutover reimportó fixture legacy.'};Current @('up','-d','--no-deps','--wait','--wait-timeout','180','api')
  $env:BACKUP_DIR=$backupDir;$env:RESTORE_BUNDLE=$bundle;$env:RESTORE_CONFIRM='RESTORE_EXISTING_TARGET_FROM_BACKUP';try{Current @('stop','api');Current @('--profile','ops','run','--rm','restore')}finally{Remove-Item Env:RESTORE_BUNDLE,Env:RESTORE_CONFIRM -ErrorAction SilentlyContinue};Current @('--profile','ops','run','--rm','migrate','npm','run','db:migrate','--','--adopt-current-schema');Current @('up','-d','--no-deps','--wait','--wait-timeout','180','api','front','proxy')
  $restoredSha=(& docker compose @currentArgs exec -T api sha256sum /var/lib/registro-perforaciones/fotos/pozo-1.png|Out-String).Trim().Split(' ')[0];if($restoredSha-ne $legacyShaB-or (Psql "SELECT count(*) FROM schema_migrations")-ne '8'){throw 'Restore/migrate no recuperó foto o DB.'};$smoke=& (Join-Path $repo 'ops/smoke.ps1') -EnvFile $envFile -DeploymentStateFile $deploymentFile -ProjectName $ProjectName -AdminEmail $adminEmail -AdminPasswordFile $passwordFile;if($smoke-notcontains 'SMOKE_OK'){throw 'Smoke posterior al restore falló.'}
  $curl=(Get-Command curl.exe -ErrorAction Stop).Source;foreach($asset in @(@('/assets/branding/background.jpeg','image/jpeg'),@('/assets/branding/logo.png','image/png'))){$headers=Join-Path $tempRoot ((Split-Path $asset[0] -Leaf)+'.headers');& $curl --silent --show-error --fail --resolve "${hostName}:$httpsPort`:127.0.0.1" --cacert $cert --dump-header $headers --output NUL "$origin$($asset[0])";if($LASTEXITCODE-ne 0-or [IO.File]::ReadAllText($headers)-notmatch [regex]::Escape("Content-Type: $($asset[1])")){throw "Asset local no disponible con MIME $($asset[1])."}}
  [pscustomobject]@{project=$ProjectName;main_archive=$true;photo_volume_absent_before=$true;legacy_empty_initialized=$true;legacy_empty_backup=$true;legacy_source='/api/public';post_photo_storage_failure_before_backup=$true;legacy_container_preserved=$true;retry_replaced=$true;retry_deleted=$true;retry_added=$true;retry_unchanged=$true;photo_storage_phase=$true;legacy_schema_adopted=$true;backup_refreshed_snapshot=$true;backup_schema='legacy-unmanaged';post_cutover_not_reimported=$true;restore_ok=$true;smoke_ok=$true;assets_https=$true;photo_sha256=$restoredSha}|ConvertTo-Json -Compress
}finally{
  if($started){$old=$ErrorActionPreference;$ErrorActionPreference='SilentlyContinue';try{& docker compose @currentArgs --profile ops down --volumes --remove-orphans|Out-Null}finally{$ErrorActionPreference=$old}}
  $old=$ErrorActionPreference;$ErrorActionPreference='SilentlyContinue';try{foreach($image in @($apiLegacy,$frontLegacy,$apiTarget,$frontTarget)){& docker image rm $image 2>$null|Out-Null}}finally{$ErrorActionPreference=$old}
  $full=[IO.Path]::GetFullPath($tempRoot);$system=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());if($full.StartsWith($system,[StringComparison]::OrdinalIgnoreCase)-and [IO.Path]::GetFileName($full)-like "$ProjectName-*"){Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue}
}
