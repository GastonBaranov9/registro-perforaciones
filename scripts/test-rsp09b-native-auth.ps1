param([string]$ContainerName="rsp09b-native-auth-$PID")
$ErrorActionPreference="Stop"
if($ContainerName-notmatch '^rsp09b-native-auth-[A-Za-z0-9-]+$'){
  throw "ContainerName debe comenzar con rsp09b-native-auth-."
}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$api=Join-Path $repo "api"
$fixture=Join-Path ([IO.Path]::GetTempPath()) "$ContainerName-migrations-007"
$passwordBytes=New-Object byte[] 24
$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
try{$rng.GetBytes($passwordBytes)}finally{$rng.Dispose()}
$password=-join($passwordBytes|ForEach-Object{$_.ToString('x2')})
$secretBytes=New-Object byte[] 48
$secretRng=[Security.Cryptography.RandomNumberGenerator]::Create()
try{$secretRng.GetBytes($secretBytes)}finally{$secretRng.Dispose()}
$nativeSecret=-join($secretBytes|ForEach-Object{$_.ToString('x2')})
$fastifySecret="fastify-$nativeSecret"
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start()
$port=([Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$started=$false

function Psql([string]$Database,[string]$Sql){
  $result=(& docker exec -e "PGPASSWORD=$password" $ContainerName psql --no-psqlrc -U rsp09b -d $Database -qAtc $Sql|Out-String).Trim()
  if($LASTEXITCODE-ne 0){throw "Consulta PostgreSQL RSP-09B falló."}
  return $result
}

function With-DatabaseEnvironment([string]$Database,[scriptblock]$Action){
  $names=@(
    'PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','MIGRATIONS_DIR',
    'NODE_ENV','FASTIFY_SECRET','NATIVE_TOKEN_HMAC_SECRET',
    'MIN_NATIVE_ANDROID_BUILD','MIN_NATIVE_IOS_BUILD',
    'RATE_LIMIT_NATIVE_WS_TICKET_MAX'
  )
  $previous=@{}
  foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
  try{
    $env:PGHOST='127.0.0.1'
    $env:PGPORT="$port"
    $env:PGUSER='rsp09b'
    $env:PGPASSWORD=$password
    $env:PGDATABASE=$Database
    $env:NODE_ENV='development'
    $env:FASTIFY_SECRET=$fastifySecret
    $env:NATIVE_TOKEN_HMAC_SECRET=$nativeSecret
    $env:MIN_NATIVE_ANDROID_BUILD='10'
    $env:MIN_NATIVE_IOS_BUILD='20'
    $env:RATE_LIMIT_NATIVE_WS_TICKET_MAX='2'
    & $Action
  }finally{
    foreach($name in $names){
      $value=$previous[$name]
      if($null-eq $value){Remove-Item "Env:$name" -ErrorAction SilentlyContinue}
      else{Set-Item "Env:$name" $value}
    }
  }
}

function Migrate([string]$Database,[string]$Directory){
  With-DatabaseEnvironment $Database {
    $env:MIGRATIONS_DIR=$Directory
    $output=(& npm.cmd --prefix $api run db:migrate|Out-String)
    if($LASTEXITCODE-ne 0){throw "Migrador RSP-09B falló."}
    return $output
  }
}

try{
  [IO.Directory]::CreateDirectory($fixture)|Out-Null
  Get-ChildItem (Join-Path $api "db/migrations") -File |
    Where-Object{$_.Name-match '^00[0-7]_[a-z0-9_]+\.sql$'} |
    Copy-Item -Destination $fixture

  & npm.cmd --prefix $api run build
  if($LASTEXITCODE-ne 0){throw "Build API previo a integración falló."}

  $id=(& docker run -d --name $ContainerName -e POSTGRES_USER=rsp09b -e "POSTGRES_PASSWORD=$password" -e POSTGRES_DB=fresh -p "127.0.0.1:${port}:5432" postgres:16.14-alpine3.24|Out-String).Trim()
  if($LASTEXITCODE-ne 0-or-not $id){throw "No se pudo iniciar PostgreSQL aislado RSP-09B."}
  $started=$true
  $deadline=[DateTime]::UtcNow.AddSeconds(60)
  do{
    & docker exec $ContainerName pg_isready -U rsp09b -d fresh|Out-Null
    if($LASTEXITCODE-eq 0){break}
    Start-Sleep -Milliseconds 300
  }while([DateTime]::UtcNow-lt $deadline)
  if($LASTEXITCODE-ne 0){throw "PostgreSQL RSP-09B no quedó listo."}

  Migrate fresh (Join-Path $api "db/migrations")|Out-Null
  if((Psql fresh "SELECT count(*)=9 AND max(version)='008' FROM schema_migrations")-ne 't'){
    throw "Fresh DB no aplicó exactamente 000..008."
  }
  $noop=Migrate fresh (Join-Path $api "db/migrations")
  if($noop-notmatch 'no hay cambios pendientes'){throw "Rerun 000..008 no fue no-op."}
  if((Psql fresh "SELECT to_regclass('sesion_nativa') IS NOT NULL AND to_regclass('ticket_ws_nativo') IS NOT NULL")-ne 't'){
    throw "008 no creó ambas tablas native."
  }
  if((Psql fresh "SELECT count(*)>=6 FROM pg_indexes WHERE schemaname='public' AND (tablename='sesion_nativa' OR tablename='ticket_ws_nativo')")-ne 't'){
    throw "008 no creó los índices native esperados."
  }

  Psql postgres "CREATE DATABASE upgrade"|Out-Null
  Migrate upgrade $fixture|Out-Null
  $prefix=Psql upgrade "SELECT string_agg(version||':'||nombre||':'||btrim(checksum_sha256),',' ORDER BY version) FROM schema_migrations"
  if((Psql upgrade "SELECT count(*)=8 AND max(version)='007' FROM schema_migrations")-ne 't'){
    throw "Fixture upgrade no quedó exactamente en 007."
  }
  Psql upgrade "INSERT INTO usuario(email,nombre,password,activo,cuenta_acceso) VALUES(NULL,'Propietario histórico',NULL,TRUE,FALSE)"|Out-Null
  Migrate upgrade (Join-Path $api "db/migrations")|Out-Null
  if((Psql upgrade "SELECT count(*)=9 AND max(version)='008' FROM schema_migrations")-ne 't'){
    throw "Upgrade 007 a 008 no aplicó exactamente una migración."
  }
  $prefixAfter=Psql upgrade "SELECT string_agg(version||':'||nombre||':'||btrim(checksum_sha256),',' ORDER BY version) FROM schema_migrations WHERE version<='007'"
  if($prefixAfter-ne $prefix){throw "008 alteró checksums/ledger 000..007."}
  if((Psql upgrade "SELECT nombre='Propietario histórico' AND email IS NULL AND password IS NULL AND cuenta_acceso=FALSE FROM usuario WHERE nombre='Propietario histórico'")-ne 't'){
    throw "008 alteró una identidad operativa histórica."
  }

  With-DatabaseEnvironment fresh {
    & node --test --experimental-strip-types (Join-Path $api "test/native-auth-postgres.local.ts")
    if($LASTEXITCODE-ne 0){throw "Integración/concurrencia native RSP-09B falló."}
  }

  [pscustomobject]@{
    fresh_migrations=9
    upgrade_from='007'
    applied='008'
    rerun_noop=$true
    prior_checksums_unchanged=$true
    postgres_native_auth=$true
    concurrency=$true
  }|ConvertTo-Json -Compress
}finally{
  if($started){& docker rm -f $ContainerName|Out-Null}
  $full=[IO.Path]::GetFullPath($fixture)
  $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if(
    $full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -and
    [IO.Path]::GetFileName($full)-like 'rsp09b-native-auth-*-migrations-007'
  ){
    Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue
  }
}
