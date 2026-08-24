param([string]$ContainerName="rsp08a-migrations-$PID")
$ErrorActionPreference="Stop"
if($ContainerName-notmatch '^rsp08a-migrations-[A-Za-z0-9-]+$'){throw "ContainerName debe comenzar con rsp08a-migrations-."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$api=Join-Path $repo "api"
$fixture=Join-Path ([IO.Path]::GetTempPath()) "$ContainerName-fixture"
$passwordBytes=New-Object byte[] 24;$passwordRng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$passwordRng.GetBytes($passwordBytes)}finally{$passwordRng.Dispose()};$password=-join($passwordBytes|ForEach-Object{$_.ToString('x2')})
$portListener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$portListener.Start();$port=([Net.IPEndPoint]$portListener.LocalEndpoint).Port;$portListener.Stop()
$started=$false
function Psql([string]$Database,[string]$Sql){
  $value=(& docker exec -e "PGPASSWORD=$password" $ContainerName psql --no-psqlrc -U rsp08a -d $Database -qAtc $Sql|Out-String).Trim()
  if($LASTEXITCODE-ne 0){throw "Consulta PostgreSQL de validación falló."};return $value
}
function Migrate([string]$Database,[string]$MigrationsDir){
  $previous=@{PGHOST=$env:PGHOST;PGPORT=$env:PGPORT;PGUSER=$env:PGUSER;PGPASSWORD=$env:PGPASSWORD;PGDATABASE=$env:PGDATABASE;MIGRATIONS_DIR=$env:MIGRATIONS_DIR}
  try{$env:PGHOST='127.0.0.1';$env:PGPORT="$port";$env:PGUSER='rsp08a';$env:PGPASSWORD=$password;$env:PGDATABASE=$Database;$env:MIGRATIONS_DIR=$MigrationsDir
    $output=(& npm.cmd --prefix $api run db:migrate|Out-String);if($LASTEXITCODE-ne 0){throw "Migrador RSP-08A falló."};return $output
  }finally{foreach($key in $previous.Keys){Set-Item -Path "Env:$key" -Value $previous[$key] -ErrorAction SilentlyContinue;if($null-eq $previous[$key]){Remove-Item "Env:$key" -ErrorAction SilentlyContinue}}}
}
try{
  [IO.Directory]::CreateDirectory($fixture)|Out-Null
  Get-ChildItem (Join-Path $api "db/migrations") -File|Where-Object{$_.Name-match '^00[0-6]_[a-z0-9_]+\.sql$'}|Copy-Item -Destination $fixture
  $id=(& docker run -d --name $ContainerName -e POSTGRES_USER=rsp08a -e "POSTGRES_PASSWORD=$password" -e POSTGRES_DB=fresh -p "127.0.0.1:${port}:5432" postgres:16.14-alpine3.24|Out-String).Trim()
  if($LASTEXITCODE-ne 0-or-not $id){throw "No se pudo iniciar PostgreSQL aislado."};$started=$true
  $deadline=[DateTime]::UtcNow.AddSeconds(60);do{& docker exec $ContainerName pg_isready -U rsp08a -d fresh|Out-Null;if($LASTEXITCODE-eq 0){break};Start-Sleep -Milliseconds 300}while([DateTime]::UtcNow-lt $deadline)
  if($LASTEXITCODE-ne 0){throw "PostgreSQL aislado no quedó listo."}

  Migrate "fresh" (Join-Path $api "db/migrations")|Out-Null
  if((Psql fresh "SELECT count(*)=8 AND max(version)='007' FROM schema_migrations")-ne 't'){throw "Fresh DB no aplicó exactamente 000..007."}
  if((Psql fresh "SELECT documento_rut IS NULL AND propietario_email IS NULL FROM usuario LIMIT 1")-notin @('','t')){throw "Fresh DB inventó datos de propietario."}
  $noop=Migrate "fresh" (Join-Path $api "db/migrations")
  if($noop-notmatch 'no hay cambios pendientes'){throw "Rerun del migrador no fue no-op."}

  Psql postgres "CREATE DATABASE upgrade"|Out-Null
  Migrate "upgrade" $fixture|Out-Null
  Psql upgrade "INSERT INTO usuario(email,nombre,password,activo,cuenta_acceso) VALUES(NULL,'Histórico',NULL,TRUE,FALSE); INSERT INTO sitio(departamento,localidad) VALUES('Salto','Histórica');"|Out-Null
  $prefix=Psql upgrade "SELECT string_agg(version||':'||nombre||':'||btrim(checksum_sha256),',' ORDER BY version) FROM schema_migrations"
  if((Psql upgrade "SELECT count(*)=7 AND max(version)='006' FROM schema_migrations")-ne 't'){throw "Fixture no quedó en 000..006."}
  Migrate "upgrade" (Join-Path $api "db/migrations")|Out-Null
  if((Psql upgrade "SELECT count(*)=8 AND max(version)='007' FROM schema_migrations")-ne 't'){throw "Upgrade no aplicó sólo 007."}
  if((Psql upgrade "SELECT nombre='Histórico' AND documento_rut IS NULL AND propietario_email IS NULL FROM usuario WHERE nombre='Histórico'")-ne 't'){throw "Upgrade alteró propietario histórico."}
  if((Psql upgrade "SELECT padron IS NULL FROM sitio WHERE localidad='Histórica'")-ne 't'){throw "Upgrade inventó padrón histórico."}
  $prefixAfter=Psql upgrade "SELECT string_agg(version||':'||nombre||':'||btrim(checksum_sha256),',' ORDER BY version) FROM schema_migrations WHERE version<='006'"
  if($prefixAfter-ne $prefix){throw "007 alteró el ledger exacto 000..006."}
  [pscustomobject]@{fresh_migrations=8;upgrade_from='006';applied='007';rerun_noop=$true;historical_nulls=$true;prefix_unchanged=$true}|ConvertTo-Json -Compress
}finally{
  if($started){& docker rm -f $ContainerName|Out-Null}
  $full=[IO.Path]::GetFullPath($fixture);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());if($full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase)-and [IO.Path]::GetFileName($full)-like 'rsp08a-migrations-*-fixture'){Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue}
}
