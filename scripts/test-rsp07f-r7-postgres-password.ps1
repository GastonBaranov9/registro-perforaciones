param([string]$ProjectName = "rsp07f-r7-password-$PID")

$ErrorActionPreference = "Stop"
if ($ProjectName -notmatch '^rsp07f-r7-password-[a-zA-Z0-9-]+$') { throw "ProjectName no es seguro." }

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$container = "$ProjectName-postgres"
$network = "$ProjectName-network"
$password = " `tcontraseña-r7-密碼 `t"
$dbUser = "rsp07f_r7"
$dbName = "rsp07f_r7"
$operationsProbe = Join-Path $repo "api/.rsp07f-r7-operations-$PID.mjs"
$runtimeProbe = Join-Path $repo "api/.rsp07f-r7-runtime-$PID.mjs"
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
try { $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
$createdNetwork = $false
$createdContainer = $false
$envNames = @(
  "NODE_ENV", "API_PORT", "FOTOS_DIR", "FASTIFY_SECRET", "PGUSER", "PGPASSWORD", "PGHOST", "PGPORT", "PGDATABASE",
  "PUBLIC_HOST", "PUBLIC_ORIGIN", "MAP_STATIC_URL_TEMPLATE", "MAP_STATIC_ALLOWED_HOST", "MAP_STATIC_API_KEY", "MAP_STATIC_ATTRIBUTION"
)
$previousEnv = @{}
foreach ($name in $envNames) { $previousEnv[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }

try {
  & docker network create $network | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "No se pudo crear la red temporal." }
  $createdNetwork = $true
  & docker run -d --name $container --network $network -p "127.0.0.1:${port}:5432" `
    -e "POSTGRES_USER=$dbUser" -e "POSTGRES_PASSWORD=$password" -e "POSTGRES_DB=$dbName" `
    postgres:16.14-alpine3.24 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "No se pudo iniciar PostgreSQL temporal." }
  $createdContainer = $true

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker exec $container pg_isready -U $dbUser -d $dbName | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "PostgreSQL temporal no quedo listo." }

  $env:NODE_ENV = "production"
  $env:API_PORT = "3000"
  $env:FOTOS_DIR = (Join-Path ([IO.Path]::GetTempPath()) $ProjectName)
  $env:FASTIFY_SECRET = "fixture-runtime-secret-with-enough-length-123456"
  $env:PGUSER = $dbUser
  $env:PGPASSWORD = $password
  $env:PGHOST = "127.0.0.1"
  $env:PGPORT = [string]$port
  $env:PGDATABASE = $dbName
  $env:PUBLIC_HOST = "fixture.example.test"
  $env:PUBLIC_ORIGIN = "https://fixture.example.test"
  $env:MAP_STATIC_URL_TEMPLATE = "https://maps.googleapis.com/maps/api/staticmap?center={latitud},{longitud}&key={apiKey}"
  $env:MAP_STATIC_ALLOWED_HOST = "maps.googleapis.com"
  $env:MAP_STATIC_API_KEY = "fixture-map-key"
  $env:MAP_STATIC_ATTRIBUTION = "Google Maps"

  Push-Location (Join-Path $repo "api")
  try {
    & npm.cmd run build | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "El build API fallo." }
    [IO.File]::WriteAllText($operationsProbe, @'
import { Pool } from "pg";
import { cargarConfigDbOperaciones } from "./dist/db/operaciones-config.js";
const pool = new Pool(cargarConfigDbOperaciones());
try {
  const result = await pool.query("SELECT current_user AS usuario");
  if (result.rows[0]?.usuario !== process.env.PGUSER) process.exitCode = 2;
} finally { await pool.end(); }
'@, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($runtimeProbe, @'
import { myPool } from "./dist/db/pool.js";
try {
  const result = await myPool.query("SELECT current_user AS usuario");
  if (result.rows[0]?.usuario !== process.env.PGUSER) process.exitCode = 2;
} finally { await myPool.end(); }
'@, [Text.UTF8Encoding]::new($false))
    & node $operationsProbe
    if ($LASTEXITCODE -ne 0) { throw "El cliente de operaciones no autentico con PGPASSWORD exacta." }
    & node $runtimeProbe
    if ($LASTEXITCODE -ne 0) { throw "El pool runtime no autentico con PGPASSWORD exacta." }
  } finally { Pop-Location }

  Write-Output "RSP07F_R7_PASSWORD_EXACT_OK"
} finally {
  foreach ($name in $envNames) {
    [Environment]::SetEnvironmentVariable($name, $previousEnv[$name], "Process")
  }
  foreach ($probe in @($operationsProbe, $runtimeProbe)) {
    if ([IO.File]::Exists($probe) -and [IO.Path]::GetFileName($probe) -match '^\.rsp07f-r7-(operations|runtime)-\d+\.mjs$') {
      Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
    }
  }
  if ($createdContainer -and $container -match '^rsp07f-r7-password-[a-zA-Z0-9-]+-postgres$') {
    & docker rm -f $container | Out-Null
  }
  if ($createdNetwork -and $network -match '^rsp07f-r7-password-[a-zA-Z0-9-]+-network$') {
    & docker network rm $network | Out-Null
  }
}
