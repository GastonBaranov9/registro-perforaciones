param([string]$ProjectName="rsp07f-r1-dev-$PID")
$ErrorActionPreference="Stop"
if($ProjectName-notmatch '^rsp07f-r1-dev-[A-Za-z0-9-]+$'){throw "ProjectName debe comenzar con rsp07f-r1-dev-."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path;$composeFile=Join-Path $repo "docker-compose.development.yaml";$tempRoot=Join-Path ([IO.Path]::GetTempPath()) $ProjectName;$envFile=Join-Path $tempRoot "development.env"
[IO.Directory]::CreateDirectory($tempRoot)|Out-Null
function RandomHex([int]$Bytes){$b=New-Object byte[] $Bytes;$g=[Security.Cryptography.RandomNumberGenerator]::Create();try{$g.GetBytes($b)}finally{$g.Dispose()};return -join($b|ForEach-Object{$_.ToString('x2')})}
function FreePort{$l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$l.Start();try{return ([Net.IPEndPoint]$l.LocalEndpoint).Port}finally{$l.Stop()}}
$image="rsp07f-r1-dev-api:$ProjectName";$password=RandomHex 24;$secret=RandomHex 48;$port=FreePort
$text=@"
PGUSER=rsp07f_dev
PGPASSWORD=$password
PGDATABASE=rsp07f_dev
PGHOST=127.0.0.1
PGPORT=$port
FASTIFY_SECRET=$secret
DEV_API_IMAGE_REF=$image
"@
[IO.File]::WriteAllText($envFile,$text,[Text.UTF8Encoding]::new($false))
$compose=@("--project-name",$ProjectName,"--env-file",$envFile,"-f",$composeFile);$started=$false
function Compose([string[]]$Arguments){& docker compose @compose @Arguments;if($LASTEXITCODE-ne 0){throw "docker compose falló: $($Arguments-join ' ')"}}
function Psql([string]$Sql){$value=(& docker compose @compose exec -T postgres psql --no-psqlrc -U rsp07f_dev -d rsp07f_dev -qAtc $Sql|Out-String).Trim();if($LASTEXITCODE-ne 0){throw "Consulta development falló."};return $value}
function Wait-Migrate{
  $deadline=[DateTime]::UtcNow.AddSeconds(180)
  do{$id=(& docker compose @compose ps --all -q migrate|Out-String).Trim();if($id){$status=(& docker inspect --format '{{.State.Status}}:{{.State.ExitCode}}' $id|Out-String).Trim();if($status-eq 'exited:0'){return}};Start-Sleep -Milliseconds 500}while([DateTime]::UtcNow-lt $deadline)
  throw "migrate no terminó correctamente: $status"
}
try{
  $started=$true
  Compose @("config","--quiet");Compose @("up","-d","--build","--wait","--wait-timeout","180","postgres")
  if((Psql "SELECT count(*) FROM pg_tables WHERE schemaname='public'")-ne '0'){throw "El volumen fresh no comenzó vacío."}
  Compose @("up","-d");Wait-Migrate
  $ledger=Psql "SELECT count(*) FROM schema_migrations";$principales=Psql "SELECT to_regclass('public.usuario') IS NOT NULL AND to_regclass('public.pozo') IS NOT NULL AND to_regclass('public.sitio') IS NOT NULL"
  if($ledger-ne '7'-or $principales-ne 't'){throw "El migrador no preparó el esquema fresh."}
  Psql "INSERT INTO sitio(departamento,localidad) VALUES('Salto','PERSISTE_RSP07F_R1')"|Out-Null
  Compose @("up","-d");Wait-Migrate
  if((Psql "SELECT count(*) FROM schema_migrations")-ne '7'-or (Psql "SELECT count(*) FROM sitio WHERE localidad='PERSISTE_RSP07F_R1'")-ne '1'){throw "El rerun no-op modificó el estado existente."}
  Compose @("--profile","test","up","-d","--wait","--wait-timeout","180","api-check")
  $apiResult=(& docker compose @compose exec -T api-check node -e "Promise.all([fetch('http://127.0.0.1:3000/health'),fetch('http://127.0.0.1:3000/ready'),fetch('http://127.0.0.1:3000/login',{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost:4200'},body:JSON.stringify({email:'inexistente@example.test',password:'control-no-secreto'})})]).then(async r=>{console.log(r.map(x=>x.status).join(','));process.exit(r[0].status===200&&r[1].status===200&&r[2].status!==500?0:1)}).catch(()=>process.exit(1))"|Out-String).Trim()
  if($LASTEXITCODE-ne 0){throw "API equivalente no superó health/ready/ruta DB: $apiResult"}
  $oldPreference=$ErrorActionPreference;$ErrorActionPreference='Continue';try{& docker compose @compose run --rm -e MIGRATIONS_DIR=/ruta-inexistente migrate|Out-Null;$migrationFailure=($LASTEXITCODE-ne 0)}finally{$ErrorActionPreference=$oldPreference}
  if(-not $migrationFailure){throw "Un fallo de migración development no produjo exit distinto de cero."}
  [pscustomobject]@{project=$ProjectName;fresh_tables=$true;migrations=[int]$ledger;rerun_noop=$true;data_preserved=$true;api_status=$apiResult;migration_failure_visible=$true}|ConvertTo-Json -Compress
}finally{
  if($started-and $ProjectName-match '^rsp07f-r1-dev-[A-Za-z0-9-]+$'){& docker compose @compose --profile test down --volumes --remove-orphans}
  $cleanupPreference=$ErrorActionPreference;$ErrorActionPreference='SilentlyContinue';try{& docker image rm $image 2>$null|Out-Null}finally{$ErrorActionPreference=$cleanupPreference}
  $full=[IO.Path]::GetFullPath($tempRoot);$system=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());if($full.StartsWith($system,[StringComparison]::OrdinalIgnoreCase)-and [IO.Path]::GetFileName($full)-like 'rsp07f-r1-dev-*'){Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue}
}
