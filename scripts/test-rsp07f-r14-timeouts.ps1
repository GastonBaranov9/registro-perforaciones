param([string]$ProjectName = "rsp07f-r14-timeouts-$PID")

$ErrorActionPreference = "Stop"
if ($ProjectName -notmatch '^rsp07f-r14-timeouts-[A-Za-z0-9-]+$') { throw "ProjectName inseguro." }

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "$ProjectName-$([Guid]::NewGuid().ToString('N'))"
[IO.Directory]::CreateDirectory($tempRoot) | Out-Null

try {
  $cert = Join-Path $tempRoot "fixture.crt"
  $key = Join-Path $tempRoot "fixture.key"
  $rendered = Join-Path $tempRoot "default.conf"
  $envFile = Join-Path $tempRoot "production.env"
  $openssl = (Get-Command openssl.exe -ErrorAction Stop).Source
  $oldArgConversion = $env:MSYS2_ARG_CONV_EXCL
  $oldPreference = $ErrorActionPreference
  $env:MSYS2_ARG_CONV_EXCL = "*"
  $ErrorActionPreference = "Continue"
  try {
    & $openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 1 -subj "/CN=r14.example.test" -keyout $key -out $cert 2>$null
    if ($LASTEXITCODE -ne 0) { throw "No se pudo crear TLS efimero." }
  } finally {
    $ErrorActionPreference = $oldPreference
    if ($null -eq $oldArgConversion) { Remove-Item Env:MSYS2_ARG_CONV_EXCL -ErrorAction SilentlyContinue }
    else { $env:MSYS2_ARG_CONV_EXCL = $oldArgConversion }
  }

  $template = [IO.File]::ReadAllText((Join-Path $repo "proxy/https.conf.template"))
  $nginxConfig = $template.Replace('${PUBLIC_HOST}', 'r14.example.test').Replace('${PUBLIC_ORIGIN}', 'https://r14.example.test').Replace('${HSTS_HEADER}', '')
  $nginxConfig = $nginxConfig.Replace('http://api:3000', 'http://127.0.0.1:9').Replace('http://front:80', 'http://127.0.0.1:9')
  [IO.File]::WriteAllText($rendered, $nginxConfig, [Text.UTF8Encoding]::new($false))

  $image = "nginx:1.30.4-alpine3.24@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46"
  $renderedMount = $rendered.Replace('\','/')
  $certMount = $cert.Replace('\','/')
  $keyMount = $key.Replace('\','/')
  & docker run --rm -v "${renderedMount}:/etc/nginx/conf.d/default.conf:ro" -v "${certMount}:/etc/nginx/tls/tls.crt:ro" -v "${keyMount}:/etc/nginx/tls/tls.key:ro" $image nginx -t
  if ($LASTEXITCODE -ne 0) { throw "nginx -t rechazo la configuracion renderizada." }

  $sha = 'a' * 40
  $backup = (Join-Path $tempRoot 'backups').Replace('\','/')
  $certCompose = $cert.Replace('\','/')
  $keyCompose = $key.Replace('\','/')
  $envText = @"
API_IMAGE_REF=example/api:$sha
FRONT_IMAGE_REF=example/front:$sha
APP_VERSION=r14
GIT_SHA=$sha
PGUSER=fixture
PGPASSWORD=fixture-only-not-real
PGDATABASE=fixture
FASTIFY_SECRET=fixture-only-not-real-32-bytes
PUBLIC_HOST=r14.example.test
PUBLIC_ORIGIN=https://r14.example.test
MAP_STATIC_URL_TEMPLATE=https://maps.example.test/static?lat={latitud}&lon={longitud}&key={apiKey}
MAP_STATIC_ALLOWED_HOST=maps.example.test
MAP_STATIC_API_KEY=fixture-only
MAP_STATIC_ATTRIBUTION=Fixture
TLS_CERT_FILE=$certCompose
TLS_KEY_FILE=$keyCompose
BACKUP_DIR=$backup
"@
  [IO.File]::WriteAllText($envFile, $envText, [Text.UTF8Encoding]::new($false))
  $json = (& docker compose --env-file $envFile -f (Join-Path $repo "docker-compose.production.yaml") config --format json | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "docker compose config fallo." }
  $compose = $json | ConvertFrom-Json
  $grace = [string]$compose.services.api.stop_grace_period
  if ($grace -notin @('480000000000','480s','8m0s')) { throw "stop_grace_period renderizado no equivale a 480s: $grace" }
  if ($nginxConfig -notmatch 'location /api/[\s\S]+proxy_read_timeout 450s' -or $nginxConfig -notmatch 'location = /ws[\s\S]+proxy_read_timeout 180s') {
    throw "Los timeouts renderizados no conservan el contrato HTTP/WS."
  }

  [pscustomobject]@{
    nginx_config_valid = $true
    compose_config_valid = $true
    api_proxy_read_timeout_seconds = 450
    websocket_proxy_read_timeout_seconds = 180
    stop_grace_period_seconds = 480
  } | ConvertTo-Json -Compress
} finally {
  $full = [IO.Path]::GetFullPath($tempRoot)
  $system = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($full.StartsWith($system, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($full) -like 'rsp07f-r14-timeouts-*') {
    Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue
  }
}
