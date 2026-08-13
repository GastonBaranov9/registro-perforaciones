param(
  [string]$ProjectName = "rsp07b-runtime-$PID"
)

$ErrorActionPreference = "Stop"
if ($ProjectName -notmatch '^rsp07b-runtime-[a-zA-Z0-9-]+$') {
  throw "El project name debe comenzar con rsp07b-runtime- y contener solo caracteres seguros."
}

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $repo "docker-compose.production.yaml"
$tempEnv = Join-Path ([IO.Path]::GetTempPath()) "$ProjectName.env"
$tempBackup = Join-Path ([IO.Path]::GetTempPath()) "$ProjectName-backups"
[IO.Directory]::CreateDirectory($tempBackup) | Out-Null

function New-RandomHex {
  param([Parameter(Mandatory = $true)][int]$Bytes)

  $buffer = New-Object byte[] $Bytes
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($buffer)
  }
  finally {
    $generator.Dispose()
  }

  return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

$randomPassword = New-RandomHex 24
$randomSecret = New-RandomHex 48
$randomMapKey = New-RandomHex 16
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$httpPort = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

$envText = @"
PGUSER=rsp07b_runtime
PGPASSWORD=$randomPassword
PGDATABASE=rsp07b_runtime
FASTIFY_SECRET=$randomSecret
CORS_ORIGINS=
MAP_STATIC_URL_TEMPLATE=https://maps.googleapis.com/maps/api/staticmap?center={latitud},{longitud}&zoom=17&size=640x400&key={apiKey}
MAP_STATIC_ALLOWED_HOST=maps.googleapis.com
MAP_STATIC_API_KEY=$randomMapKey
MAP_STATIC_ATTRIBUTION=Google Maps
API_IMAGE_REF=rsp07b-runtime-api:$ProjectName
FRONT_IMAGE_REF=rsp07b-runtime-front:$ProjectName
HTTP_BIND_ADDRESS=127.0.0.1
HTTP_PORT=$httpPort
BACKUP_DIR=$tempBackup
APP_VERSION=$ProjectName
"@

[IO.File]::WriteAllText($tempEnv, $envText, [Text.UTF8Encoding]::new($false))
$compose = @("--project-name", $ProjectName, "--env-file", $tempEnv, "-f", $composeFile)
$started = $false

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & docker compose @compose @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose falló: $($Arguments -join ' ')" }
}

try {
  $started = $true
  Invoke-Compose up -d --build --wait --wait-timeout 300

  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$httpPort/api/health" -TimeoutSec 10
  $ready = Invoke-RestMethod -Uri "http://127.0.0.1:$httpPort/api/ready" -TimeoutSec 10
  if ($health.status -ne "ok" -or $ready.status -ne "ok") { throw "Health/readiness inesperados." }

  $postgresId = (& docker compose @compose ps -q postgres | Out-String).Trim()
  if (-not $postgresId) { throw "No se encontró el contenedor PostgreSQL para inspeccionar sus puertos." }
  $postgresPorts = ((& docker inspect --format '{{json .NetworkSettings.Ports}}' $postgresId) | Out-String).Trim() | ConvertFrom-Json
  if ($null -ne $postgresPorts.'5432/tcp') { throw "PostgreSQL quedó publicado al host." }

  $uid = (& docker compose @compose exec -T api id -u | Out-String).Trim()
  $gid = (& docker compose @compose exec -T api id -g | Out-String).Trim()
  if ($uid -ne "1000" -or $gid -ne "1000") { throw "API no ejecuta como UID/GID 1000:1000." }

  $write = @'
import fs from "node:fs/promises";
import path from "node:path";
import { validarFotoBuffer } from "./dist/services/foto-archivo-service.js";
const foto=validarFotoBuffer(Buffer.from([0xff,0xd8,0xff,0xd9]),"image/jpeg");
await fs.writeFile(path.join(process.env.FOTOS_DIR,"pozo-707007.jpg"),foto.buffer,{flag:"wx"});
'@
  $write | & docker compose @compose exec -T api node --input-type=module -
  if ($LASTEXITCODE -ne 0) { throw "No se pudo escribir la fotografía controlada." }

  Invoke-Compose up -d --no-deps --force-recreate --wait --wait-timeout 180 api

  $verify = @'
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { generarPDFBytes } from "./dist/pdf/pdf-generate.js";
const id=707007;
const foto=await fs.readFile(path.join(process.env.FOTOS_DIR,`pozo-${id}.jpg`));
assert.deepEqual([...foto],[0xff,0xd8,0xff,0xd9]);
const reporte={id_pozo:id,propietario:"Prueba controlada",empresa:"",perforador:"Prueba",sitio:"Prueba",fecha_inicio:null,fecha_fin:null,profundidad_final_m:null,nivel_estatico_m:null,nivel_dinamico_m:null,caudal_estimado_lh:null,metodo_sedimentario:null,metodo_rocoso:null,cementacion:null,desarrollo:null,introduccion:null,nombre_archivo:null,litologia:[],foto_url:"protegida",diametros:[],filtros:[],niveles_aporte:[]};
const pdf=await generarPDFBytes(reporte,id);
assert.equal(Buffer.from(pdf).subarray(0,4).toString(),"%PDF");
await fs.rm(path.join(process.env.FOTOS_DIR,`pozo-${id}.jpg`));
console.log(JSON.stringify({fotoPersistente:true,pdfLeeVolumen:true,pdfBytes:pdf.length}));
'@
  $durability = ($verify | & docker compose @compose exec -T api node --input-type=module - | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Falló la verificación posterior a recrear API." }

  [pscustomobject]@{
    project = $ProjectName
    http_port = $httpPort
    postgres_publicado = $false
    api_uid = $uid
    api_gid = $gid
    health = $health.status
    ready = $ready.status
    durabilidad = $durability
  } | ConvertTo-Json -Compress
}
finally {
  if ($started) {
    & docker compose @compose down --volumes --remove-orphans
  }
  if ([IO.File]::Exists($tempEnv)) { [IO.File]::Delete($tempEnv) }
  if ([IO.Directory]::Exists($tempBackup)) { [IO.Directory]::Delete($tempBackup, $true) }
}
