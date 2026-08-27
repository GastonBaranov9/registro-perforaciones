param([string]$ProjectPrefix = "rsp07c-data-$PID")

$ErrorActionPreference = "Stop"
if ($ProjectPrefix -notmatch '^rsp07c-data-[a-zA-Z0-9-]+$') { throw "ProjectPrefix inseguro." }

function New-RandomHex([int]$Bytes) {
  $buffer = New-Object byte[] $Bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

function New-FreePort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $repo "docker-compose.production.yaml"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "$ProjectPrefix-$([Guid]::NewGuid().ToString('N'))"
$backupDir = Join-Path $tempRoot "backups"
$fixtures = Join-Path $tempRoot "fixtures"
$adoptionDir = Join-Path $fixtures "adoption-baseline"
$failureDir = Join-Path $fixtures "failure"
$checksumDir = Join-Path $fixtures "checksum"
$originEnv = Join-Path $tempRoot "origin.env"
$targetEnv = Join-Path $tempRoot "target.env"
$passwordFile = Join-Path $tempRoot "admin-password"
$tlsDir = Join-Path $tempRoot "tls"
[IO.Directory]::CreateDirectory($backupDir) | Out-Null
[IO.Directory]::CreateDirectory($fixtures) | Out-Null
[IO.Directory]::CreateDirectory($adoptionDir) | Out-Null
[IO.Directory]::CreateDirectory($tlsDir) | Out-Null
Get-ChildItem (Join-Path $repo "api/db/migrations") -File |
  Where-Object { $_.Name -match '^00[0-5]_[a-z0-9_]+\.sql$' } |
  Copy-Item -Destination $adoptionDir

$pgUser = "rsp07c_control"
$pgPassword = New-RandomHex 24
$fastifySecret = New-RandomHex 48
$mapKey = New-RandomHex 16
$adminPassword = "RSP07C-$(New-RandomHex 12)"
$adminEmail = "admin-rsp07c@example.test"
$originProject = "$ProjectPrefix-origin"
$targetProject = "$ProjectPrefix-target"
$originDb = "rsp07c_origin"
$targetDb = "rsp07c_target"
$originPort = New-FreePort
$targetPort = New-FreePort
$originHttpsPort = New-FreePort
$targetHttpsPort = New-FreePort
$publicHost = "rsp07c.example.test"
$certFile = Join-Path $tlsDir "ephemeral.crt"
$keyFile = Join-Path $tlsDir "ephemeral.key"
$openssl = (Get-Command openssl.exe -ErrorAction Stop).Source
$oldErrorPreference = $ErrorActionPreference
$oldArgConversion = $env:MSYS2_ARG_CONV_EXCL
$env:MSYS2_ARG_CONV_EXCL = "*"
$ErrorActionPreference = "Continue"
try { & $openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 1 -subj "/CN=$publicHost" -addext "subjectAltName=DNS:$publicHost" -keyout $keyFile -out $certFile 2>$null }
finally { $ErrorActionPreference=$oldErrorPreference; if ($null -eq $oldArgConversion) { Remove-Item Env:MSYS2_ARG_CONV_EXCL -ErrorAction SilentlyContinue } else { $env:MSYS2_ARG_CONV_EXCL=$oldArgConversion } }
if ($LASTEXITCODE -ne 0) { throw "No se pudo crear TLS efímero para el test de datos." }

function Write-ControlEnv([string]$Path, [string]$Database, [int]$Port, [int]$TlsPort) {
  $text = @"
PGUSER=$pgUser
PGPASSWORD=$pgPassword
PGDATABASE=$Database
FASTIFY_SECRET=$fastifySecret
NATIVE_TOKEN_HMAC_SECRET=${fastifySecret}-native-test-only
MIN_NATIVE_ANDROID_BUILD=1
MIN_NATIVE_IOS_BUILD=1
PUBLIC_HOST=$publicHost
PUBLIC_ORIGIN=https://${publicHost}:$TlsPort
CORS_ORIGINS=
MAP_STATIC_URL_TEMPLATE=https://maps.googleapis.com/maps/api/staticmap?center={latitud},{longitud}&zoom=17&size=640x400&key={apiKey}
MAP_STATIC_ALLOWED_HOST=maps.googleapis.com
MAP_STATIC_API_KEY=$mapKey
MAP_STATIC_ATTRIBUTION=Google Maps
API_IMAGE_REF=rsp07c-runtime-api:$ProjectPrefix
FRONT_IMAGE_REF=rsp07c-runtime-front:$ProjectPrefix
HTTP_BIND_ADDRESS=127.0.0.1
HTTP_PORT=$Port
HTTPS_BIND_ADDRESS=127.0.0.1
HTTPS_PORT=$TlsPort
TLS_CERT_FILE=$($certFile.Replace('\','/'))
TLS_KEY_FILE=$($keyFile.Replace('\','/'))
BACKUP_DIR=$backupDir
APP_VERSION=rsp07c-control
"@
  [IO.File]::WriteAllText($Path, $text, [Text.UTF8Encoding]::new($false))
}

Write-ControlEnv $originEnv $originDb $originPort $originHttpsPort
Write-ControlEnv $targetEnv $targetDb $targetPort $targetHttpsPort
[IO.File]::WriteAllText($passwordFile, "$adminPassword`n", [Text.UTF8Encoding]::new($false))

$origin = @("--project-name", $originProject, "--env-file", $originEnv, "-f", $composeFile)
$target = @("--project-name", $targetProject, "--env-file", $targetEnv, "-f", $composeFile)
$originStarted = $false
$targetStarted = $false

function Invoke-Compose {
  param([string[]]$Base, [string[]]$Arguments)
  & docker compose @Base @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose falló: $($Arguments -join ' ')" }
}

function Invoke-ComposeText {
  param([string[]]$Base, [string[]]$Arguments)
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { $output = (& docker compose @Base @Arguments 2>&1 | Out-String).Trim(); $exit = $LASTEXITCODE }
  finally { $ErrorActionPreference = $old }
  if ($exit -ne 0) { throw "docker compose falló: $($Arguments -join ' ')" }
  return $output
}

function Invoke-ExpectedFailure {
  param([string[]]$Base, [string]$Expected, [string[]]$Arguments)
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = (& docker compose @Base @Arguments 2>&1 | Out-String)
    $exit = $LASTEXITCODE
  } finally { $ErrorActionPreference = $old }
  if ($exit -eq 0) { throw "El comando debía fallar: $($Arguments -join ' ')" }
  if ($output.Contains($pgPassword) -or $output.Contains($adminPassword) -or $output.Contains($fastifySecret) -or $output.Contains($mapKey)) {
    throw "Un comando fallido filtró un secreto controlado."
  }
  if ($output -notmatch $Expected) { throw "El fallo no coincidió con el contrato esperado. Salida: $output" }
  return $output
}

function Invoke-Psql([string[]]$Base, [string]$Database, [string]$Sql) {
  $output = (& docker compose @Base exec -T postgres psql --no-psqlrc --quiet -v ON_ERROR_STOP=1 -U $pgUser -d $Database -Atc $Sql | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "psql falló en una base aislada." }
  return $output
}

try {
  $env:BACKUP_DIR = $backupDir
  $originStarted = $true
  Invoke-Compose -Base $origin -Arguments @("up", "-d", "--build", "postgres")
  Invoke-Compose -Base $origin -Arguments @("--profile", "ops", "build", "migrate")
  Invoke-Compose -Base $origin -Arguments @("--profile", "ops", "run", "--rm", "migrate")
  $ledgerFresh = Invoke-Psql $origin $originDb "SELECT count(*) FROM schema_migrations"
  if ($ledgerFresh -ne "9") { throw "Fresh install no registró 000..008." }
  $noop = Invoke-ComposeText -Base $origin -Arguments @("--profile", "ops", "run", "--rm", "migrate")
  if ($noop -notmatch "no hay cambios pendientes" -or (Invoke-Psql $origin $originDb "SELECT count(*) FROM schema_migrations") -ne "9") {
    throw "La segunda ejecución de migraciones no fue no-op."
  }
  $migration006 = [IO.File]::ReadAllText((Join-Path $repo "api/db/migrations/006_roles_base.sql")).Replace("`r`n", "`n").Replace("`r", "`n")
  $legacyCrlfBytes = [Text.UTF8Encoding]::new($false).GetBytes($migration006.Replace("`n", "`r`n"))
  $legacyHasher = [Security.Cryptography.SHA256]::Create()
  try { $legacyCrlfHash = -join ($legacyHasher.ComputeHash($legacyCrlfBytes) | ForEach-Object { $_.ToString('x2') }) }
  finally { $legacyHasher.Dispose() }
  Invoke-Psql $origin $originDb "UPDATE schema_migrations SET checksum_sha256='$legacyCrlfHash' WHERE version='006'" | Out-Null
  $legacyLedger = Invoke-ComposeText -Base $origin -Arguments @("--profile", "ops", "run", "--rm", "migrate")
  if ($legacyLedger -notmatch "no hay cambios pendientes" -or (Invoke-Psql $origin $originDb "SELECT btrim(checksum_sha256)='$legacyCrlfHash' FROM schema_migrations WHERE version='006'") -ne 't') {
    throw "El ledger CRLF legacy exacto no fue reconocido."
  }

  $adoptDb = "rsp07c_adopt"
  Invoke-Psql $origin "postgres" "CREATE DATABASE $adoptDb" | Out-Null
  Invoke-Compose -Base $origin -Arguments @(
    "--profile", "ops", "run", "--rm",
    "-e", "PGDATABASE=$adoptDb",
    "-e", "MIGRATIONS_DIR=/fixtures/adoption-baseline",
    "-v", "${fixtures}:/fixtures:ro",
    "migrate"
  )
  Invoke-Psql $origin $adoptDb "DROP TABLE schema_migrations" | Out-Null
  Invoke-Compose -Base $origin -Arguments @("--profile", "ops", "run", "--rm", "-e", "PGDATABASE=$adoptDb", "migrate", "npm", "run", "db:migrate", "--", "--adopt-current-schema")
  if ((Invoke-Psql $origin $adoptDb "SELECT count(*) FROM schema_migrations") -ne "9") { throw "La adopción compatible no registró el baseline." }

  $badAdoptDb = "rsp07c_bad_adopt"
  Invoke-Psql $origin "postgres" "CREATE DATABASE $badAdoptDb" | Out-Null
  Invoke-Psql $origin $badAdoptDb "CREATE TABLE usuario(id integer)" | Out-Null
  Invoke-ExpectedFailure -Base $origin -Expected "No se puede adoptar el esquema" -Arguments @("--profile", "ops", "run", "--rm", "-e", "PGDATABASE=$badAdoptDb", "migrate", "npm", "run", "db:migrate", "--", "--adopt-current-schema") | Out-Null
  if ((Invoke-Psql $origin $badAdoptDb "SELECT to_regclass('public.schema_migrations') IS NULL") -ne "t") { throw "Adopción incompatible creó un ledger." }

  Copy-Item -LiteralPath (Join-Path $repo "api/db/migrations") -Destination $failureDir -Recurse
  [IO.File]::WriteAllText((Join-Path $failureDir "009_control_failure.sql"), "CREATE TABLE rsp07c_partial(id integer);`nSELECT funcion_inexistente_rsp07c();`n", [Text.UTF8Encoding]::new($false))
  Invoke-ExpectedFailure -Base $origin -Expected "009_control_failure.sql" -Arguments @("--profile", "ops", "run", "--rm", "-e", "MIGRATIONS_DIR=/fixtures", "-v", "${failureDir}:/fixtures:ro", "migrate") | Out-Null
  if ((Invoke-Psql $origin $originDb "SELECT to_regclass('public.rsp07c_partial') IS NULL") -ne "t") { throw "La migración fallida dejó DDL parcial." }
  if ((Invoke-Psql $origin $originDb "SELECT count(*) FROM schema_migrations WHERE version='009'") -ne "0") { throw "La migración fallida alteró el ledger." }

  Copy-Item -LiteralPath (Join-Path $repo "api/db/migrations") -Destination $checksumDir -Recurse
  [IO.File]::AppendAllText((Join-Path $checksumDir "006_roles_base.sql"), "`n-- alteración controlada de checksum`n", [Text.UTF8Encoding]::new($false))
  Invoke-ExpectedFailure -Base $origin -Expected "Checksum diferente" -Arguments @("--profile", "ops", "run", "--rm", "-e", "MIGRATIONS_DIR=/fixtures", "-v", "${checksumDir}:/fixtures:ro", "migrate") | Out-Null

  $concurrencyDb = "rsp07c_concurrency"
  Invoke-Psql $origin "postgres" "CREATE DATABASE $concurrencyDb" | Out-Null
  $concurrentCommand = 'npm run db:migrate >/tmp/m1.log 2>&1 & p1=$!; npm run db:migrate >/tmp/m2.log 2>&1 & p2=$!; wait $p1; a=$?; wait $p2; b=$?; cat /tmp/m1.log; cat /tmp/m2.log; test $a -eq 0 -a $b -eq 0'
  Invoke-Compose -Base $origin -Arguments @("--profile", "ops", "run", "--rm", "-e", "PGDATABASE=$concurrencyDb", "migrate", "sh", "-c", $concurrentCommand)
  if ((Invoke-Psql $origin $concurrencyDb "SELECT count(*) FROM schema_migrations") -ne "9") { throw "El lock no protegió el ledger concurrente." }

  $bootstrap = Invoke-ComposeText -Base $origin -Arguments @("--profile", "ops", "run", "--rm", "-e", "ADMIN_EMAIL=$adminEmail", "-e", "ADMIN_NAME=Administrador control", "-e", "ADMIN_PASSWORD_FILE=/run/secrets/admin-password", "-v", "${passwordFile}:/run/secrets/admin-password:ro", "bootstrap-admin")
  if ($bootstrap -notmatch "Administrador inicial creado" -or $bootstrap.Contains($adminPassword)) { throw "Bootstrap no cumplió salida segura." }
  Invoke-ExpectedFailure -Base $origin -Expected "Ya existe un administrador" -Arguments @("--profile", "ops", "run", "--rm", "-e", "ADMIN_EMAIL=$adminEmail", "-e", "ADMIN_NAME=Intento repetido", "-e", "ADMIN_PASSWORD_FILE=/run/secrets/admin-password", "-v", "${passwordFile}:/run/secrets/admin-password:ro", "bootstrap-admin") | Out-Null
  $adminState = Invoke-Psql $origin $originDb "SELECT u.activo AND u.cuenta_acceso AND u.password LIKE '`$2%' AND r.nombre='administracion' FROM usuario u JOIN usuario_rol ur USING(id_usuario) JOIN rol r USING(id_rol) WHERE u.email='$adminEmail'"
  if ($adminState -ne "t") { throw "El admin bootstrap no quedó activo, hasheado y con rol." }

  Invoke-Compose -Base $origin -Arguments @("up", "-d", "--build", "--wait", "--wait-timeout", "300")
  $loginCheck = (& docker compose @origin exec -T -e "LOGIN_EMAIL=$adminEmail" -e "LOGIN_PASSWORD=$adminPassword" api node -e "fetch('http://127.0.0.1:3000/login',{method:'POST',headers:{'content-type':'application/json',origin:'https://${publicHost}:$originHttpsPort'},body:JSON.stringify({email:process.env.LOGIN_EMAIL,password:process.env.LOGIN_PASSWORD})}).then(r=>{console.log(r.status);process.exit(r.status===200?0:1)})" | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $loginCheck -ne "200") { throw "Login del admin bootstrap falló." }

  $ownerId = Invoke-Psql $origin $originDb "INSERT INTO usuario(email,nombre,password,activo,cuenta_acceso) VALUES(NULL,'Propietario control',NULL,TRUE,FALSE) RETURNING id_usuario"
  $perfId = Invoke-Psql $origin $originDb "INSERT INTO usuario(email,nombre,password,activo,cuenta_acceso) VALUES('perforador-rsp07c@example.test','Perforador control','hash-no-login',TRUE,TRUE) RETURNING id_usuario"
  Invoke-Psql $origin $originDb "INSERT INTO usuario_rol SELECT $ownerId,id_rol FROM rol WHERE nombre='propietario'; INSERT INTO usuario_rol SELECT $perfId,id_rol FROM rol WHERE nombre='perforador'" | Out-Null
  $siteId = Invoke-Psql $origin $originDb "INSERT INTO sitio(departamento,localidad,latitud,longitud) VALUES('Salto','Control restore',NULL,NULL) RETURNING id_sitio"
  $adminId = Invoke-Psql $origin $originDb "SELECT id_usuario FROM usuario WHERE email='$adminEmail'"
  $wellId = Invoke-Psql $origin $originDb "INSERT INTO pozo(id_propietario,id_sitio,id_perforador,creado_por,empresa,profundidad_final_m,foto_url) VALUES($ownerId,$siteId,$perfId,$adminId,'Control RSP-07C',30,'/usuarios/$ownerId/pozos/1/foto') RETURNING id_pozo"
  $litId = Invoke-Psql $origin $originDb "SELECT id_litologia FROM catalogo_litologia WHERE codigo='arenisca_fina'"
  Invoke-Psql $origin $originDb "INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material,id_litologia) VALUES($wellId,0,30,'Arenisca fina',$litId); INSERT INTO intervalo_diametro_perforacion(id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia) VALUES($wellId,0,30,8,'PVC'); INSERT INTO intervalo_filtro(id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,ranura_mm) VALUES($wellId,20,25,6,'PVC',0.75); INSERT INTO nivel_aporte(id_pozo,profundidad_m) VALUES($wellId,18)" | Out-Null
  $writePhoto = @"
import fs from 'node:fs/promises';
import path from 'node:path';
import { validarFotoBuffer } from './dist/services/foto-archivo-service.js';
const foto=validarFotoBuffer(Buffer.from([0xff,0xd8,0xff,0xd9]),'image/jpeg');
await fs.writeFile(path.join(process.env.FOTOS_DIR,'pozo-$wellId.jpg'),foto.buffer,{flag:'wx'});
"@
  $writePhoto | & docker compose @origin exec -T api node --input-type=module -
  if ($LASTEXITCODE -ne 0) { throw "No se pudo crear la foto representativa." }
  $sourcePhotoSha = Invoke-ComposeText -Base $origin -Arguments @("exec", "-T", "api", "sha256sum", "/var/lib/registro-perforaciones/fotos/pozo-$wellId.jpg")

  $backupOutput = (& (Join-Path $repo "ops/backup.ps1") -EnvFile $originEnv -ProjectName $originProject -BackupDir $backupDir | Out-String)
  $bundleMatch = [regex]::Match($backupOutput, 'BACKUP_BUNDLE=(rsp-backup-\d{8}T\d{6}Z)')
  if (-not $bundleMatch.Success) { throw "Backup no informó un bundle completo." }
  $bundle = $bundleMatch.Groups[1].Value
  $manifestText = [IO.File]::ReadAllText((Join-Path (Join-Path $backupDir $bundle) "manifest.txt"))
  foreach ($secret in @($pgPassword,$adminPassword,$fastifySecret,$mapKey)) { if ($manifestText.Contains($secret)) { throw "El manifest filtró un secreto." } }
  $prune = (& (Join-Path $repo "ops/prune-backups.ps1") -BackupDir $backupDir | Out-String)
  if ($prune -notmatch "KEEP $bundle") { throw "La retención no preservó el backup válido más reciente." }

  $targetStarted = $true
  Invoke-Compose -Base $target -Arguments @("up", "-d", "postgres")
  $corruptBundle = "rsp-backup-20990101T000000Z"
  $corruptPath = Join-Path $backupDir $corruptBundle
  Copy-Item -LiteralPath (Join-Path $backupDir $bundle) -Destination $corruptPath -Recurse
  $corruptManifestPath = Join-Path $corruptPath "manifest.txt"
  $corruptManifest = [IO.File]::ReadAllText($corruptManifestPath).Replace("BUNDLE_ID=$bundle", "BUNDLE_ID=$corruptBundle").Replace((Select-String -Path $corruptManifestPath -Pattern '^CREATED_AT_UTC=').Line, "CREATED_AT_UTC=2099-01-01T00:00:00Z")
  [IO.File]::WriteAllText($corruptManifestPath, $corruptManifest, [Text.UTF8Encoding]::new($false))
  $stream = [IO.File]::Open((Join-Path $corruptPath "database.dump"), [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $stream.WriteByte(0) } finally { $stream.Dispose() }
  $env:RESTORE_BUNDLE = $corruptBundle
  $env:RESTORE_CONFIRM = "RESTORE_EMPTY_TARGET"
  Invoke-ExpectedFailure -Base $target -Expected "Checksum" -Arguments @("--profile", "ops", "run", "--rm", "restore") | Out-Null
  if ((Invoke-Psql $target $targetDb "SELECT count(*) FROM pg_tables WHERE schemaname='public'") -ne "0") { throw "Restore corrupto mutó la DB destino." }

  $invalidManifestBundle = "rsp-backup-20990101T000001Z"
  $invalidManifestPath = Join-Path $backupDir $invalidManifestBundle
  Copy-Item -LiteralPath (Join-Path $backupDir $bundle) -Destination $invalidManifestPath -Recurse
  $invalidManifestFile = Join-Path $invalidManifestPath "manifest.txt"
  $invalidManifest = [IO.File]::ReadAllText($invalidManifestFile).Replace("BUNDLE_ID=$bundle", "BUNDLE_ID=$invalidManifestBundle").Replace("STATUS=complete", "STATUS=invalid")
  [IO.File]::WriteAllText($invalidManifestFile, $invalidManifest, [Text.UTF8Encoding]::new($false))
  $env:RESTORE_BUNDLE = $invalidManifestBundle
  Invoke-ExpectedFailure -Base $target -Expected "backup no est" -Arguments @("--profile", "ops", "run", "--rm", "restore") | Out-Null

  $missingDumpBundle = "rsp-backup-20990101T000002Z"
  $missingDumpPath = Join-Path $backupDir $missingDumpBundle
  Copy-Item -LiteralPath (Join-Path $backupDir $bundle) -Destination $missingDumpPath -Recurse
  $missingDumpManifest = Join-Path $missingDumpPath "manifest.txt"
  [IO.File]::WriteAllText($missingDumpManifest,([IO.File]::ReadAllText($missingDumpManifest).Replace("BUNDLE_ID=$bundle", "BUNDLE_ID=$missingDumpBundle")),[Text.UTF8Encoding]::new($false))
  Remove-Item -LiteralPath (Join-Path $missingDumpPath "database.dump") -Force
  $env:RESTORE_BUNDLE = $missingDumpBundle
  Invoke-ExpectedFailure -Base $target -Expected "database.dump" -Arguments @("--profile", "ops", "run", "--rm", "restore") | Out-Null
  if ((Invoke-Psql $target $targetDb "SELECT count(*) FROM pg_tables WHERE schemaname='public'") -ne "0") { throw "Fixtures inválidos mutaron la DB antes de validarse." }

  $env:RESTORE_BUNDLE = $bundle
  $env:RESTORE_CONFIRM = "RESTORE_EMPTY_TARGET"
  Invoke-ExpectedFailure -Base $target -Expected "RESTORE_TEST_FAILURE=after_photo_switch" -Arguments @("--profile", "ops", "run", "--rm", "-e", "RESTORE_TEST_FAIL_AT=after_photo_switch", "restore") | Out-Null
  if ((Invoke-Psql $target $targetDb "SELECT count(*) FROM pg_tables WHERE schemaname='public'") -ne "0") { throw "El fallo de fotos del empty restore mutó la DB." }
  & (Join-Path $repo "ops/restore.ps1") -EnvFile $targetEnv -ProjectName $targetProject -BackupDir $backupDir -Bundle $bundle -Confirm RESTORE_EMPTY_TARGET
  if ($LASTEXITCODE -ne 0) { throw "Restore válido falló." }
  Invoke-Psql $target $targetDb "CREATE TABLE objeto_post_backup_test(id integer PRIMARY KEY); CREATE INDEX objeto_post_backup_idx ON objeto_post_backup_test(id); CREATE VIEW vista_post_backup_test AS SELECT id FROM objeto_post_backup_test; CREATE FUNCTION funcion_post_backup_test() RETURNS integer LANGUAGE SQL AS 'SELECT 1'; CREATE SCHEMA esquema_post_backup_test; CREATE EXTENSION hstore" | Out-Null
  $postBackupObjects = Invoke-Psql $target $targetDb "SELECT to_regclass('public.objeto_post_backup_test') IS NOT NULL AND to_regclass('public.objeto_post_backup_idx') IS NOT NULL AND to_regclass('public.vista_post_backup_test') IS NOT NULL AND to_regprocedure('public.funcion_post_backup_test()') IS NOT NULL AND to_regnamespace('esquema_post_backup_test') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_extension WHERE extname='hstore')"
  if ($postBackupObjects -ne 't') { throw 'No se crearon los objetos post-backup del fixture.' }
  Invoke-Compose -Base $target -Arguments @("exec", "-T", "api", "node", "--input-type=module", "-e", "import fs from 'node:fs';fs.writeFileSync('/var/lib/registro-perforaciones/fotos/pozo-$wellId.jpg',Buffer.from([255,216,0,255,217]))")
  $preReplacePhotoSha = Invoke-ComposeText -Base $target -Arguments @("exec", "-T", "api", "sha256sum", "/var/lib/registro-perforaciones/fotos/pozo-$wellId.jpg")
  $preReplacePhotoHash = [regex]::Match($preReplacePhotoSha, '\b[a-f0-9]{64}\b').Value
  if (-not $preReplacePhotoHash) { throw 'No se pudo medir la foto M previa al full restore.' }

  Invoke-Compose -Base $target -Arguments @("stop", "api")
  $env:RESTORE_BUNDLE = $corruptBundle
  $env:RESTORE_CONFIRM = "RESTORE_EXISTING_TARGET_FROM_BACKUP"
  Invoke-ExpectedFailure -Base $target -Expected "Checksum" -Arguments @("--profile", "ops", "run", "--rm", "restore") | Out-Null
  if ((Invoke-Psql $target $targetDb "SELECT to_regclass('public.objeto_post_backup_test') IS NOT NULL AND (SELECT count(*) FROM pozo)=1") -ne 't') { throw 'El bundle corrupto mutó el destino antes de ser validado.' }

  $env:RESTORE_BUNDLE = $bundle
  $failedRestore = Invoke-ExpectedFailure -Base $target -Expected "RESTORE_FAILED" -Arguments @(
    "--profile", "ops", "run", "--rm", "-e", "RESTORE_TEST_FAIL_AT=db_restore", "restore"
  )
  if ((Invoke-Psql $target $targetDb "SELECT to_regclass('public.objeto_post_backup_test') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_extension WHERE extname='hstore')") -ne 't') { throw 'El fallo en DB staging mutó el destino activo.' }

  foreach ($fault in @('before_current_move','after_current_preserved','before_staged_switch','after_photo_switch','before_db_swap','after_target_preserved')) {
    Invoke-ExpectedFailure -Base $target -Expected "RESTORE_FAILED" -Arguments @("--profile", "ops", "run", "--rm", "-e", "RESTORE_TEST_FAIL_AT=$fault", "restore") | Out-Null
    if ((Invoke-Psql $target $targetDb "SELECT to_regclass('public.objeto_post_backup_test') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_extension WHERE extname='hstore')") -ne 't') { throw "Fault $fault no preservó la DB M." }
    $compensatedPhotoSha = Invoke-ComposeText -Base $target -Arguments @("--profile", "ops", "run", "--rm", "--entrypoint", "sha256sum", "restore", "/data/fotos/pozo-$wellId.jpg")
    $compensatedPhotoHash = [regex]::Match($compensatedPhotoSha, '\b[a-f0-9]{64}\b').Value
    if ($compensatedPhotoHash -ne $preReplacePhotoHash) { throw "Fault $fault no restauró las fotos M." }
  }

  $retryRestore = Invoke-ComposeText -Base $target -Arguments @("--profile", "ops", "run", "--rm", "restore")
  if ($retryRestore -notmatch "RESTORE_OK=$bundle MODE=replace") { throw 'El retry de full restore no terminó correctamente.' }
  $objectsGone = Invoke-Psql $target $targetDb "SELECT to_regclass('public.objeto_post_backup_test') IS NULL AND to_regclass('public.objeto_post_backup_idx') IS NULL AND to_regclass('public.vista_post_backup_test') IS NULL AND to_regprocedure('public.funcion_post_backup_test()') IS NULL AND to_regnamespace('esquema_post_backup_test') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='hstore')"
  if ($objectsGone -ne 't') { throw 'Sobrevivieron objetos creados después del backup.' }
  $cleanupRestore = Invoke-ComposeText -Base $target -Arguments @("--profile", "ops", "run", "--rm", "-e", "RESTORE_TEST_FAIL_AT=cleanup", "restore")
  if ($cleanupRestore -notmatch "RESTORE_CLEANUP_PENDING=$bundle" -or $cleanupRestore -notmatch "RESTORE_OK=$bundle MODE=replace") { throw 'El fallo de cleanup no conservó commit funcional y residuo detectable.' }
  $cleanupRetry = Invoke-ComposeText -Base $target -Arguments @("--profile", "ops", "run", "--rm", "restore")
  if ($cleanupRetry -notmatch "RESTORE_OK=$bundle MODE=replace") { throw 'No se pudo limpiar/reintentar luego del cleanup pendiente.' }
  $migrateAfterRestore = Invoke-ComposeText -Base $target -Arguments @("--profile", "ops", "run", "--rm", "migrate")
  if ($migrateAfterRestore -notmatch 'no hay cambios pendientes' -or (Invoke-Psql $target $targetDb "SELECT count(*)=9 AND max(version)='008' FROM schema_migrations") -ne 't') { throw 'El ledger restaurado no quedó exactamente en N.' }

  Invoke-Compose -Base $target -Arguments @("up", "-d", "--build", "--wait", "--wait-timeout", "300")
  $relations = Invoke-Psql $target $targetDb "SELECT (SELECT count(*) FROM pozo)=1 AND (SELECT count(*) FROM intervalo_litologico)=1 AND (SELECT count(*) FROM intervalo_diametro_perforacion)=1 AND (SELECT count(*) FROM intervalo_filtro WHERE ranura_mm=0.75)=1 AND (SELECT count(*) FROM nivel_aporte)=1 AND (SELECT count(*) FROM schema_migrations)=9"
  if ($relations -ne "t") { throw "Los datos/relaciones restaurados no coinciden." }
  $targetPhotoSha = Invoke-ComposeText -Base $target -Arguments @("exec", "-T", "api", "sha256sum", "/var/lib/registro-perforaciones/fotos/pozo-$wellId.jpg")
  if (($sourcePhotoSha -split '\s+')[0] -ne ($targetPhotoSha -split '\s+')[0]) { throw "La foto restaurada no conserva checksum." }
  $targetLogin = (& docker compose @target exec -T -e "LOGIN_EMAIL=$adminEmail" -e "LOGIN_PASSWORD=$adminPassword" api node -e "fetch('http://127.0.0.1:3000/login',{method:'POST',headers:{'content-type':'application/json',origin:'https://${publicHost}:$targetHttpsPort'},body:JSON.stringify({email:process.env.LOGIN_EMAIL,password:process.env.LOGIN_PASSWORD})}).then(r=>{console.log(r.status);process.exit(r.status===200?0:1)})" | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $targetLogin -ne "200") { throw "Login restaurado falló." }
  $pdfCheck = @"
import assert from 'node:assert/strict';
import { generarPDFBytes } from './dist/pdf/pdf-generate.js';
const r={id_pozo:$wellId,propietario:'Propietario control',empresa:'Control RSP-07C',perforador:'Perforador control',sitio:'Control restore',fecha_inicio:null,fecha_fin:null,profundidad_final_m:30,nivel_estatico_m:null,nivel_dinamico_m:null,caudal_estimado_lh:null,metodo_sedimentario:null,metodo_rocoso:null,cementacion:null,desarrollo:null,introduccion:null,nombre_archivo:null,litologia:[{desde_m:0,hasta_m:30,material:'Arenisca fina'}],foto_url:'protegida',diametros:[],filtros:[{desde_m:20,hasta_m:25,diametro_pulg:6,material_tuberia:'PVC',ranura_mm:0.75}],niveles_aporte:[{profundidad_m:18}]};
const pdf=await generarPDFBytes(r,$wellId);assert.equal(Buffer.from(pdf).subarray(0,4).toString(),'%PDF');console.log(pdf.length);
"@
  $pdfBytes = ($pdfCheck | & docker compose @target exec -T api node --input-type=module - | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or [int]$pdfBytes -le 0) { throw "PDF no pudo leer datos/foto restaurados." }
  $ready = (& docker compose @target exec -T api node -e "fetch('http://127.0.0.1:3000/ready').then(r=>r.json()).then(x=>console.log(x.status))" | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $ready -ne "ok") { throw "Readiness restaurado falló." }

  [pscustomobject]@{
    migrations_fresh = 9; rerun_noop = $true; legacy_crlf_ledger = $true; checksum_rejected = $true; rollback_ok = $true
    concurrent_lock = $true; adoption_ok = $true; adoption_rejected = $true
    bootstrap_login = $true; bootstrap_second_rejected = $true
    backup_bundle = $bundle; corrupt_restore_rejected = $true; invalid_manifest_rejected = $true; missing_dump_rejected = $true; corrupt_replace_preserved_target = $true
    empty_photo_failure_compensated = $true; empty_retry = $true; full_fault_points = 6
    post_backup_objects_removed = $true; failed_restore_detected = $true; restore_retry = $true; cleanup_pending_retry = $true; restored_relations = $true
    restored_photo_sha256 = ($targetPhotoSha -split '\s+')[0]; restored_pdf_bytes = [int]$pdfBytes; ready = $ready
  } | ConvertTo-Json -Compress
}
finally {
  foreach ($entry in @(@{ Started=$originStarted; Project=$originProject; Base=$origin }, @{ Started=$targetStarted; Project=$targetProject; Base=$target })) {
    if ($entry.Started -and $entry.Project -match '^rsp07c-data-[a-zA-Z0-9-]+-(origin|target)$') {
      & docker compose @($entry.Base) down --volumes --remove-orphans
    }
  }
  $cleanupPreference=$ErrorActionPreference;$ErrorActionPreference='SilentlyContinue'
  try { & docker image rm --force "rsp07c-runtime-api:$ProjectPrefix" "rsp07c-runtime-front:$ProjectPrefix" 2>$null | Out-Null }
  finally { $ErrorActionPreference=$cleanupPreference }
  $fullTemp = [IO.Path]::GetFullPath($tempRoot)
  $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($fullTemp.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase) -and ([IO.Path]::GetFileName($fullTemp) -like 'rsp07c-data-*')) {
    Remove-Item -LiteralPath $fullTemp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
