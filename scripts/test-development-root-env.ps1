param([string]$ProjectName="rsp07f-r4-dev-$PID")
$ErrorActionPreference="Stop"
if($ProjectName-notmatch '^rsp07f-r4-dev-[A-Za-z0-9-]+$'){throw "ProjectName inseguro."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile=Join-Path $repo "docker-compose.development.yaml"
$tempRoot=Join-Path ([IO.Path]::GetTempPath()) "$ProjectName-$([Guid]::NewGuid().ToString('N'))"
$tempRepo=Join-Path $tempRoot "checkout";$tempApi=Join-Path $tempRepo "api";$rootEnv=Join-Path $tempRepo ".env"
$stdout=Join-Path $tempRoot "api.stdout.log";$stderr=Join-Path $tempRoot "api.stderr.log"
[IO.Directory]::CreateDirectory($tempApi)|Out-Null

function New-FreePort{$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start();try{return ([Net.IPEndPoint]$listener.LocalEndpoint).Port}finally{$listener.Stop()}}
function Stop-ProcessTree([int]$RootId){
  $children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId = $RootId" -ErrorAction SilentlyContinue)
  foreach($child in $children){Stop-ProcessTree ([int]$child.ProcessId)}
  Stop-Process -Id $RootId -Force -ErrorAction SilentlyContinue
}

$pgPort=New-FreePort;$apiPort=New-FreePort;$pgUser="rsp07f_r4_dev";$pgDatabase="rsp07f_r4_dev";$pgPassword=[Guid]::NewGuid().ToString('N');$fastifySecret=([Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N'));$devImage="registro-perforaciones-api:$ProjectName"
$envText=@"
PGUSER=$pgUser
PGPASSWORD=$pgPassword
PGHOST=127.0.0.1
PGPORT=$pgPort
PGDATABASE=$pgDatabase
DEV_API_IMAGE_REF=$devImage
NODE_ENV=development
API_PORT=$apiPort
FASTIFY_SECRET=$fastifySecret
FOTOS_DIR=$($tempApi.Replace('\','/'))/public
"@
[IO.File]::WriteAllText($rootEnv,$envText,[Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $repo "api/src") -Destination $tempApi -Recurse
Copy-Item -LiteralPath (Join-Path $repo "api/package.json") -Destination $tempApi
[IO.Directory]::CreateDirectory((Join-Path $tempApi "public"))|Out-Null
$junction=Join-Path $tempApi "node_modules"
New-Item -ItemType Junction -Path $junction -Target (Join-Path $repo "api/node_modules")|Out-Null
$compose=@("--project-name",$ProjectName,"--env-file",$rootEnv,"-f",$composeFile)
$started=$false;$process=$null
try{
  $started=$true
  & docker compose @compose up -d --build postgres migrate database-ready
  if($LASTEXITCODE-ne 0){throw "No se pudo preparar PostgreSQL development."}
  $migrationId=(& docker compose @compose ps --all -q migrate|Out-String).Trim()
  $migrationExit=if($migrationId){(& docker inspect --format '{{.State.Status}}:{{.State.ExitCode}}' $migrationId|Out-String).Trim()}else{''}
  if($LASTEXITCODE-ne 0-or $migrationExit-ne 'exited:0'){throw "El migrador development no terminó en exit 0."}
  if(Test-Path -LiteralPath (Join-Path $tempApi ".env")){throw "El fixture no debe contener api/.env."}
  $npm=(Get-Command npm.cmd -ErrorAction Stop).Source
  $process=Start-Process -FilePath $npm -ArgumentList @("run","dev") -WorkingDirectory $tempApi -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
  $health=$false;$ready=$false
  $deadline=[DateTime]::UtcNow.AddSeconds(60)
  while([DateTime]::UtcNow-lt $deadline-and-not($health-and $ready)){
    if($process.HasExited){throw "npm run dev terminó antes de health/readiness."}
    try{$health=(Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$apiPort/health" -TimeoutSec 2).StatusCode-eq 200}catch{$health=$false}
    try{$ready=(Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$apiPort/ready" -TimeoutSec 2).StatusCode-eq 200}catch{$ready=$false}
    if(-not($health-and $ready)){Start-Sleep -Milliseconds 500}
  }
  if(-not($health-and $ready)){throw "La API host no alcanzó health/readiness."}
  $combined=((Get-Content -Raw -ErrorAction SilentlyContinue $stdout)+(Get-Content -Raw -ErrorAction SilentlyContinue $stderr))
  if($combined-match '\.env: not found'-or $combined.Contains($pgPassword)-or $combined.Contains($fastifySecret)){throw "El inicio development falló por env o filtró un secreto."}
  [pscustomobject]@{root_env=$true;api_env_absent=$true;npm_run_dev=$true;health=$health;ready=$ready;migrator_exit_0=$true}|ConvertTo-Json -Compress
}finally{
  if($process){Stop-ProcessTree $process.Id}
  if($started-and $ProjectName-match '^rsp07f-r4-dev-'){& docker compose @compose down --volumes --remove-orphans}
  $cleanupPreference=$ErrorActionPreference;$ErrorActionPreference='SilentlyContinue';try{if($devImage-match '^registro-perforaciones-api:rsp07f-r4-dev-'){& docker image rm $devImage 2>$null|Out-Null}}finally{$ErrorActionPreference=$cleanupPreference}
  if((Get-Item -LiteralPath $junction -ErrorAction SilentlyContinue).LinkType-eq 'Junction'){[IO.Directory]::Delete($junction)}
  $full=[IO.Path]::GetFullPath($tempRoot);$system=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());if($full.StartsWith($system,[StringComparison]::OrdinalIgnoreCase)-and [IO.Path]::GetFileName($full)-like 'rsp07f-r4-dev-*'){Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue}
}
