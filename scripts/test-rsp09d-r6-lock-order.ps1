param([string]$ContainerName="rsp09d-r6-locks-$PID")
$ErrorActionPreference="Stop"
if($ContainerName-notmatch '^rsp09d-r6-locks-[A-Za-z0-9-]+$'){
  throw "ContainerName debe comenzar con rsp09d-r6-locks-."
}

$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$api=Join-Path $repo "api"
$passwordBytes=New-Object byte[] 24
$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
try{$rng.GetBytes($passwordBytes)}finally{$rng.Dispose()}
$password=-join($passwordBytes|ForEach-Object{$_.ToString('x2')})
$secretBytes=New-Object byte[] 48
$secretRng=[Security.Cryptography.RandomNumberGenerator]::Create()
try{$secretRng.GetBytes($secretBytes)}finally{$secretRng.Dispose()}
$nativeSecret=-join($secretBytes|ForEach-Object{$_.ToString('x2')})
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start()
$port=([Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$started=$false
$environmentNames=@(
  'PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','NODE_ENV','FASTIFY_SECRET',
  'NATIVE_TOKEN_HMAC_SECRET','MIN_NATIVE_ANDROID_BUILD','MIN_NATIVE_IOS_BUILD',
  'PG_STATEMENT_TIMEOUT_MS','PG_QUERY_TIMEOUT_MS','PG_IDLE_TRANSACTION_TIMEOUT_MS'
)
$previousEnvironment=@{}
foreach($name in $environmentNames){
  $previousEnvironment[$name]=[Environment]::GetEnvironmentVariable($name,'Process')
}

try{
  & npm.cmd --prefix $api run build
  if($LASTEXITCODE-ne 0){throw "Build API previo a RSP-09D-R6 fallo."}

  $id=(& docker run -d --name $ContainerName -e POSTGRES_USER=rsp09d -e "POSTGRES_PASSWORD=$password" -e POSTGRES_DB=rsp09d -p "127.0.0.1:${port}:5432" postgres:16.14-alpine3.24|Out-String).Trim()
  if($LASTEXITCODE-ne 0-or-not $id){throw "No se pudo iniciar PostgreSQL aislado RSP-09D-R6."}
  $started=$true
  $deadline=[DateTime]::UtcNow.AddSeconds(60)
  do{
    & docker exec $ContainerName pg_isready -U rsp09d -d rsp09d|Out-Null
    if($LASTEXITCODE-eq 0){break}
    Start-Sleep -Milliseconds 300
  }while([DateTime]::UtcNow-lt $deadline)
  if($LASTEXITCODE-ne 0){throw "PostgreSQL RSP-09D-R6 no quedo listo."}

  $env:PGHOST='127.0.0.1'
  $env:PGPORT="$port"
  $env:PGUSER='rsp09d'
  $env:PGPASSWORD=$password
  $env:PGDATABASE='rsp09d'
  $env:NODE_ENV='development'
  $env:FASTIFY_SECRET="fastify-$nativeSecret"
  $env:NATIVE_TOKEN_HMAC_SECRET=$nativeSecret
  $env:MIN_NATIVE_ANDROID_BUILD='10'
  $env:MIN_NATIVE_IOS_BUILD='20'
  $env:PG_STATEMENT_TIMEOUT_MS='7000'
  $env:PG_QUERY_TIMEOUT_MS='8000'
  $env:PG_IDLE_TRANSACTION_TIMEOUT_MS='7000'

  & npm.cmd --prefix $api run db:migrate
  if($LASTEXITCODE-ne 0){throw "Migraciones para RSP-09D-R6 fallaron."}

  & node --test --experimental-strip-types (Join-Path $api "test/native-ws-lock-order-postgres.local.ts")
  if($LASTEXITCODE-ne 0){throw "Concurrencia PostgreSQL RSP-09D-R6 fallo."}

  [pscustomobject]@{
    postgres='16.14'
    migrations='000..008'
    canonical_lock_order='usuario->sesion_nativa'
    arbitrary_sleeps=$false
    real_concurrency=$true
    deadlock_retry=$false
  }|ConvertTo-Json -Compress
}finally{
  foreach($name in $environmentNames){
    $value=$previousEnvironment[$name]
    if($null-eq $value){Remove-Item "Env:$name" -ErrorAction SilentlyContinue}
    else{Set-Item "Env:$name" $value}
  }
  if($started){& docker rm -f $ContainerName|Out-Null}
}
