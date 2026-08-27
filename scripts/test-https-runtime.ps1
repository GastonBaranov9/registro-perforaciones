param([string]$ProjectName = "rsp07d-https-$PID")

$ErrorActionPreference = "Stop"
if ($ProjectName -notmatch '^rsp07d-https-[a-zA-Z0-9-]+$') { throw "ProjectName no es seguro." }

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $repo "docker-compose.production.yaml"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) $ProjectName
$tlsDir = Join-Path $tempRoot "tls"
$backupDir = Join-Path $tempRoot "backups"
$envFile = Join-Path $tempRoot "production.env"
$passwordFile = Join-Path $tempRoot "admin-password"
$cookieJar = Join-Path $tempRoot "cookies.txt"
$copiedCookieJar = Join-Path $tempRoot "cookies-copied.txt"
$headersFile = Join-Path $tempRoot "headers.txt"
$bodyFile = Join-Path $tempRoot "body.bin"
$maxPhoto = Join-Path $tempRoot "max-photo.jpg"
$largePhoto = Join-Path $tempRoot "large-photo.jpg"
$loginBodyFile = Join-Path $tempRoot "login.json"
$ownerBodyFile = Join-Path $tempRoot "owner.json"
$noCsrfBodyFile = Join-Path $tempRoot "no-csrf.json"
$wrongOriginBodyFile = Join-Path $tempRoot "wrong-origin.json"
[IO.Directory]::CreateDirectory($tlsDir) | Out-Null
[IO.Directory]::CreateDirectory($backupDir) | Out-Null

function New-RandomHex([int]$Bytes) {
  $buffer = New-Object byte[] $Bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

function New-LoopbackPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Assert-Status([string]$Actual, [string]$Expected, [string]$Context) {
  if ($Actual.Trim() -ne $Expected) {
    $body = if ([IO.File]::Exists($bodyFile)) { [IO.File]::ReadAllText($bodyFile) } else { "" }
    throw "$Context devolvió $Actual en vez de $Expected. Body: $body"
  }
}

function Invoke-Compose([string[]]$Arguments) {
  & docker compose @compose @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose falló: $($Arguments -join ' ')" }
}

function Invoke-Psql([string]$Sql) {
  $result = (& docker compose @compose exec -T postgres psql --no-psqlrc --quiet -v ON_ERROR_STOP=1 -U $dbUser -d $dbName -Atc $Sql | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "psql controlado falló." }
  return $result
}

function Invoke-Https([string[]]$Arguments) {
  $status = (& curl.exe --insecure --silent --show-error --resolve "${publicHost}:${httpsPort}:127.0.0.1" @Arguments --output $bodyFile --write-out "%{http_code}" | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "curl HTTPS falló: $($Arguments -join ' ')" }
  return $status
}

$publicHost = "rsp07d.example.test"
$httpPort = New-LoopbackPort
$httpsPort = New-LoopbackPort
$publicOrigin = "https://${publicHost}:${httpsPort}"
$dbUser = "rsp07d_https"
$dbName = "rsp07d_https"
$dbPassword = New-RandomHex 24
$fastifySecret = New-RandomHex 48
$mapKey = New-RandomHex 20
$adminEmail = "admin-rsp07d@example.test"
$adminPassword = "RSP07d-$(New-RandomHex 12)!"
$certFile = Join-Path $tlsDir "ephemeral.crt"
$keyFile = Join-Path $tlsDir "ephemeral.key"
$started = $false

try {
  $openssl = (Get-Command openssl.exe -ErrorAction Stop).Source
  $oldArgConversion = $env:MSYS2_ARG_CONV_EXCL
  $oldErrorPreference = $ErrorActionPreference
  $env:MSYS2_ARG_CONV_EXCL = "*"
  $ErrorActionPreference = "Continue"
  try {
    & $openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 1 -subj "/CN=$publicHost" -addext "subjectAltName=DNS:$publicHost" -keyout $keyFile -out $certFile 2>$null
    if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el certificado TLS efímero." }
  } finally {
    $ErrorActionPreference = $oldErrorPreference
    if ($null -eq $oldArgConversion) { Remove-Item Env:MSYS2_ARG_CONV_EXCL -ErrorAction SilentlyContinue }
    else { $env:MSYS2_ARG_CONV_EXCL = $oldArgConversion }
  }

  [IO.File]::WriteAllText($passwordFile, $adminPassword, [Text.UTF8Encoding]::new($false))
  $certCompose = $certFile.Replace('\','/')
  $keyCompose = $keyFile.Replace('\','/')
  $backupCompose = $backupDir.Replace('\','/')
  $envText = @"
PGUSER=$dbUser
PGPASSWORD=$dbPassword
PGDATABASE=$dbName
FASTIFY_SECRET=$fastifySecret
NATIVE_TOKEN_HMAC_SECRET=${fastifySecret}-native-test-only
MIN_NATIVE_ANDROID_BUILD=1
MIN_NATIVE_IOS_BUILD=1
PUBLIC_HOST=$publicHost
PUBLIC_ORIGIN=$publicOrigin
CORS_ORIGINS=
MAP_STATIC_URL_TEMPLATE=https://maps.googleapis.com/maps/api/staticmap?center={latitud},{longitud}&zoom=17&size=640x400&key={apiKey}
MAP_STATIC_ALLOWED_HOST=maps.googleapis.com
MAP_STATIC_API_KEY=$mapKey
MAP_STATIC_ATTRIBUTION=Google Maps
API_IMAGE_REF=rsp07d-runtime-api:$ProjectName
FRONT_IMAGE_REF=rsp07d-runtime-front:$ProjectName
HTTP_BIND_ADDRESS=127.0.0.1
HTTP_PORT=$httpPort
HTTPS_BIND_ADDRESS=127.0.0.1
HTTPS_PORT=$httpsPort
TLS_CERT_FILE=$certCompose
TLS_KEY_FILE=$keyCompose
HSTS_ENABLED=false
RATE_LIMIT_PDF_MAX=100
PDF_MAX_CONCURRENT=1
PDF_MAX_QUEUE=0
BACKUP_DIR=$backupCompose
APP_VERSION=$ProjectName
"@
  [IO.File]::WriteAllText($envFile, $envText, [Text.UTF8Encoding]::new($false))
  $compose = @("--project-name", $ProjectName, "--env-file", $envFile, "-f", $composeFile)
  $started = $true

  Invoke-Compose -Arguments @("build", "api", "front")
  Invoke-Compose -Arguments @("up", "-d", "postgres")
  try {
    Invoke-Compose -Arguments @("--profile", "ops", "run", "--rm", "migrate")
  } catch {
    Start-Sleep -Seconds 2
    Invoke-Compose -Arguments @("--profile", "ops", "run", "--rm", "migrate")
  }
  Invoke-Compose -Arguments @("--profile", "ops", "run", "--rm", "-e", "ADMIN_EMAIL=$adminEmail", "-e", "ADMIN_NAME=Administrador HTTPS", "-e", "ADMIN_PASSWORD_FILE=/run/secrets/admin-password", "-v", "${passwordFile}:/run/secrets/admin-password:ro", "bootstrap-admin")

  $ownerId = Invoke-Psql "INSERT INTO usuario(email,nombre,password,activo,cuenta_acceso) VALUES(NULL,'Propietario TLS',NULL,TRUE,FALSE) RETURNING id_usuario"
  $perfId = Invoke-Psql "INSERT INTO usuario(email,nombre,password,activo,cuenta_acceso) VALUES('perforador-rsp07d@example.test','Perforador TLS','hash-controlado',TRUE,TRUE) RETURNING id_usuario"
  Invoke-Psql "INSERT INTO usuario_rol SELECT $ownerId,id_rol FROM rol WHERE nombre='propietario'; INSERT INTO usuario_rol SELECT $perfId,id_rol FROM rol WHERE nombre='perforador'" | Out-Null
  $siteId = Invoke-Psql "INSERT INTO sitio(departamento,localidad,latitud,longitud) VALUES('Salto','HTTPS local',NULL,NULL) RETURNING id_sitio"
  $adminId = Invoke-Psql "SELECT id_usuario FROM usuario WHERE email='$adminEmail'"
  $wellId = Invoke-Psql "INSERT INTO pozo(id_propietario,id_sitio,id_perforador,creado_por,empresa,profundidad_final_m) VALUES($ownerId,$siteId,$perfId,$adminId,'RSP-07D',30) RETURNING id_pozo"
  $litId = Invoke-Psql "SELECT id_litologia FROM catalogo_litologia WHERE codigo='arenisca_fina'"
  Invoke-Psql "INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material,id_litologia) VALUES($wellId,0,30,'Arenisca fina',$litId); INSERT INTO intervalo_diametro_perforacion(id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia) VALUES($wellId,0,30,8,'PVC'); INSERT INTO intervalo_filtro(id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,ranura_mm) VALUES($wellId,20,25,6,'PVC',0.75)" | Out-Null

  Invoke-Compose -Arguments @("up", "-d", "--build", "--wait", "--wait-timeout", "300")

  $httpHeaders = Join-Path $tempRoot "http-headers.txt"
  $httpStatus = (& curl.exe --silent --show-error --resolve "${publicHost}:${httpPort}:127.0.0.1" --dump-header $httpHeaders --output $bodyFile --write-out "%{http_code}" "http://${publicHost}:${httpPort}/pozos/123?x=1" | Out-String).Trim()
  Assert-Status $httpStatus "308" "redirect HTTP"
  if (([IO.File]::ReadAllText($httpHeaders)) -notmatch [regex]::Escape("Location: $publicOrigin/pozos/123?x=1")) { throw "El redirect no preservó path/query." }

  Assert-Status (Invoke-Https @("--dump-header", $headersFile, "$publicOrigin/")) "200" "frontend raíz"
  $index = [IO.File]::ReadAllText($bodyFile)
  if ($index -notmatch '<app-root') { throw "GET / no devolvió Angular." }
  $securityHeaders = [IO.File]::ReadAllText($headersFile)
  foreach ($header in @("X-Content-Type-Options: nosniff", "Referrer-Policy: same-origin", "X-Frame-Options: DENY", "Permissions-Policy: geolocation=(self), camera=()", "Content-Security-Policy: default-src 'self'")) {
    if ($securityHeaders -notmatch [regex]::Escape($header)) { throw "Falta header HTTPS: $header" }
  }
  if ($securityHeaders -match "Strict-Transport-Security") { throw "HSTS no debe activarse en el certificado local." }
  Assert-Status (Invoke-Https @("--header", "Host: evil.example.test", "$publicOrigin/")) "421" "Host no canónico"

  Assert-Status (Invoke-Https @("$publicOrigin/pozos/123")) "200" "fallback SPA"
  if (([IO.File]::ReadAllText($bodyFile)) -notmatch '<app-root') { throw "La ruta profunda no devolvió index.html." }
  Assert-Status (Invoke-Https @("$publicOrigin/api/health")) "200" "health público"
  Assert-Status (Invoke-Https @("$publicOrigin/api/ready")) "200" "readiness público"
  Assert-Status (Invoke-Https @("$publicOrigin/api/ruta-inexistente")) "404" "404 API"
  Assert-Status (Invoke-Https @("$publicOrigin/api/docs")) "404" "Swagger disabled"
  if (([IO.File]::ReadAllText($bodyFile)) -match '<app-root') { throw "El 404 API cayó en el fallback SPA." }

  $loginJson = @{ email=$adminEmail; password=$adminPassword } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($loginBodyFile, $loginJson, [Text.UTF8Encoding]::new($false))
  $loginStatus = Invoke-Https @("--request", "POST", "--header", "Origin: $publicOrigin", "--header", "Content-Type: application/json", "--data-binary", "@$loginBodyFile", "--cookie-jar", $cookieJar, "--dump-header", $headersFile, "$publicOrigin/api/login")
  Assert-Status $loginStatus "200" "login HTTPS"
  $cookieHeaders = [IO.File]::ReadAllText($headersFile)
  if ($cookieHeaders -notmatch '(?im)^set-cookie: rsp_session=.*; HttpOnly; Secure; SameSite=Lax') { throw "Cookie de sesión no conserva HttpOnly/Secure/Lax." }
  if ($cookieHeaders -notmatch '(?im)^set-cookie: rsp_csrf=.*; Secure; SameSite=Lax') { throw "Cookie CSRF no conserva Secure/Lax." }
  $csrfLine = Get-Content $cookieJar | Where-Object { $_ -notmatch '^#' -and ($_ -split "`t").Count -ge 7 -and ($_ -split "`t")[5] -eq 'rsp_csrf' } | Select-Object -First 1
  if (-not $csrfLine) { throw "curl no almacenó rsp_csrf." }
  $csrf = ($csrfLine -split "`t")[6]
  Copy-Item -LiteralPath $cookieJar -Destination $copiedCookieJar
  Assert-Status (Invoke-Https @("--cookie", $cookieJar, "$publicOrigin/api/login")) "200" "GET autenticado"

  [IO.File]::WriteAllText($ownerBodyFile, '{"nombre":"Propietario creado por HTTPS"}', [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($noCsrfBodyFile, '{"nombre":"Sin CSRF"}', [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($wrongOriginBodyFile, '{"nombre":"Origin incorrecto"}', [Text.UTF8Encoding]::new($false))
  Assert-Status (Invoke-Https @("--request", "POST", "--cookie", $cookieJar, "--header", "Origin: $publicOrigin", "--header", "X-CSRF-Token: $csrf", "--header", "Content-Type: application/json", "--data-binary", "@$ownerBodyFile", "$publicOrigin/api/pozos/propietarios")) "201" "mutación con CSRF"
  Assert-Status (Invoke-Https @("--request", "POST", "--cookie", $cookieJar, "--header", "Origin: $publicOrigin", "--header", "Content-Type: application/json", "--data-binary", "@$noCsrfBodyFile", "$publicOrigin/api/pozos/propietarios")) "403" "mutación sin CSRF"
  Assert-Status (Invoke-Https @("--request", "POST", "--cookie", $cookieJar, "--header", "Origin: https://evil.example.test", "--header", "X-CSRF-Token: $csrf", "--header", "Content-Type: application/json", "--data-binary", "@$wrongOriginBodyFile", "$publicOrigin/api/pozos/propietarios")) "403" "Origin no autorizado"

  foreach ($entry in @(@{Path=$maxPhoto;Size=5000000}, @{Path=$largePhoto;Size=5000001})) {
    $stream = [IO.File]::Open($entry.Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.SetLength($entry.Size); $stream.Position=0; $stream.Write([byte[]](0xff,0xd8,0xff,0xd9),0,4) } finally { $stream.Dispose() }
  }
  Assert-Status (Invoke-Https @("--request", "POST", "--cookie", $cookieJar, "--header", "Origin: $publicOrigin", "--header", "X-CSRF-Token: $csrf", "--form", "foto=@$maxPhoto;type=image/jpeg", "$publicOrigin/api/usuarios/$ownerId/pozos/$wellId/foto")) "200" "upload de 5.000.000 bytes"
  Assert-Status (Invoke-Https @("--request", "POST", "--cookie", $cookieJar, "--header", "Origin: $publicOrigin", "--header", "X-CSRF-Token: $csrf", "--form", "foto=@$largePhoto;type=image/jpeg", "$publicOrigin/api/usuarios/$ownerId/pozos/$wellId/foto")) "413" "upload sobre límite"
  Assert-Status (Invoke-Https @("$publicOrigin/api/usuarios/$ownerId/pozos/$wellId/foto")) "401" "foto sin autorización"
  Assert-Status (Invoke-Https @("--cookie", $cookieJar, "$publicOrigin/api/usuarios/$ownerId/pozos/$wellId/foto")) "200" "foto autorizada"
  if ((Get-Item $bodyFile).Length -ne 5000000) { throw "La foto protegida no conserva el tamaño." }
  Assert-Status (Invoke-Https @("--cookie", $cookieJar, "$publicOrigin/api/usuarios/$ownerId/pozos/$wellId/informe-pdf")) "200" "PDF HTTPS"
  $pdfBytes = (Get-Item $bodyFile).Length
  if ($pdfBytes -le 0 -or -not ([Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($bodyFile),0,4) -eq '%PDF')) { throw "PDF HTTPS invalid." }
  $pdfJobs = @()
  try {
    for ($pdfAttempt = 0; $pdfAttempt -lt 12; $pdfAttempt++) {
      $pdfOutput = Join-Path $tempRoot "pdf-concurrent-$pdfAttempt.bin"
      $pdfJobs += Start-Job -ScriptBlock {
        param($HostName, $Port, $Origin, $Jar, $Output, $Owner, $Well)
        (& curl.exe --insecure --silent --show-error --resolve "${HostName}:${Port}:127.0.0.1" --cookie $Jar --output $Output --write-out "%{http_code}" "$Origin/api/usuarios/$Owner/pozos/$Well/informe-pdf" | Out-String).Trim()
      } -ArgumentList $publicHost,$httpsPort,$publicOrigin,$cookieJar,$pdfOutput,$ownerId,$wellId
    }
    Assert-Status (Invoke-Https @("$publicOrigin/api/health")) "200" "health during PDF load"
    $pdfConcurrentStatuses = @($pdfJobs | Wait-Job | Receive-Job)
    if ($pdfConcurrentStatuses -notcontains "503") { throw "PDF capacity test did not observe 503: $($pdfConcurrentStatuses -join ',')" }
    if (@($pdfConcurrentStatuses | Where-Object { $_ -notin @("200", "503") }).Count -gt 0) { throw "Unexpected PDF concurrency status: $($pdfConcurrentStatuses -join ',')" }
  } finally {
    $pdfJobs | Remove-Job -Force -ErrorAction SilentlyContinue
  }
  foreach ($candidate in Get-ChildItem -LiteralPath $tempRoot -Filter 'pdf-concurrent-*.bin') {
    if ($candidate.Length -ge 4 -and [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($candidate.FullName),0,4) -eq '%PDF') {
      Copy-Item -LiteralPath $candidate.FullName -Destination $bodyFile -Force
      break
    }
  }
  if ($pdfBytes -le 0 -or -not ([Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($bodyFile),0,4) -eq '%PDF')) { throw "El PDF HTTPS no es válido." }
  Assert-Status (Invoke-Https @("--cookie", $cookieJar, "$publicOrigin/api/mapas/estado")) "200" "estado Maps"
  if (([IO.File]::ReadAllText($bodyFile)).Contains($mapKey)) { throw "La API expuso MAP_STATIC_API_KEY." }

  Assert-Status (Invoke-Https @("--request", "POST", "--cookie", $cookieJar, "--header", "Origin: $publicOrigin", "--header", "X-CSRF-Token: $csrf", "--dump-header", $headersFile, "$publicOrigin/api/logout")) "204" "logout"
  $logoutHeaders = [IO.File]::ReadAllText($headersFile)
  if ($logoutHeaders -notmatch '(?im)^set-cookie: rsp_session=.*Max-Age=0') { throw "Logout did not clear the session cookie." }
  Assert-Status (Invoke-Https @("--cookie", $copiedCookieJar, "$publicOrigin/api/login")) "401" "copied token revoked"
  Assert-Status (Invoke-Https @("--request", "POST", "--header", "Origin: $publicOrigin", "--header", "Content-Type: application/json", "--data-binary", "@$loginBodyFile", "--cookie-jar", $cookieJar, "$publicOrigin/api/login")) "200" "login after logout"

  $rateStatuses = @()
  for ($attempt = 0; $attempt -lt 11; $attempt++) {
    $rateStatuses += Invoke-Https @("--request", "POST", "--header", "Origin: $publicOrigin", "--header", "Content-Type: application/json", "--data-binary", "@$loginBodyFile", "$publicOrigin/api/login")
  }
  if ($rateStatuses[-1] -ne "429") { throw "Login rate limit did not return 429: $($rateStatuses -join ',')" }
  $rateHeadersStatus = Invoke-Https @("--request", "POST", "--header", "Origin: $publicOrigin", "--header", "Content-Type: application/json", "--data-binary", "@$loginBodyFile", "--dump-header", $headersFile, "$publicOrigin/api/login")
  Assert-Status $rateHeadersStatus "429" "login rate limit"
  if (([IO.File]::ReadAllText($headersFile)) -notmatch '(?im)^retry-after: [1-9][0-9]*') { throw "Rate limit did not send Retry-After." }

  $oldErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $wsOutput = (& curl.exe --insecure --silent --show-error --include --max-time 2 --resolve "${publicHost}:${httpsPort}:127.0.0.1" --cookie $cookieJar --header "Origin: $publicOrigin" --header "Connection: Upgrade" --header "Upgrade: websocket" --header "Sec-WebSocket-Version: 13" --header "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" "$publicOrigin/ws" 2>&1 | Out-String)
    $wsExit = $LASTEXITCODE
  } finally { $ErrorActionPreference = $oldErrorPreference }
  if ($wsExit -notin @(0,28) -or $wsOutput -notmatch 'HTTP/1\.1 101') { throw "WebSocket no realizó upgrade a través de /ws." }

  foreach ($service in @("api", "front", "postgres")) {
    $id = (& docker compose @compose ps -q $service | Out-String).Trim()
    $bindings = (& docker inspect --format '{{json .HostConfig.PortBindings}}' $id | Out-String).Trim()
    if ($bindings -ne "{}") { throw "$service quedó publicado al host: $bindings" }
  }
  $frontSecrets = (& docker compose @compose exec -T front sh -c "grep -R -E 'localhost:3000|localhost:4200|$mapKey' /usr/share/nginx/html >/dev/null; test `$? -ne 0" 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "El build frontend contiene localhost o la key de Maps." }

  [pscustomobject]@{
    project=$ProjectName; http_redirect=308; https=$true; canonical_host=421; spa=$true; health="ok"; ready="ok"
    login=$true; secure_cookie=$true; csrf_valid=201; csrf_missing=403; wrong_origin=403; swagger=404
    logout_revokes=$true; login_rate_limit=429; security_headers=$true; hsts_local=$false
    websocket=101; upload_valid=5000000; upload_rejected=5000001; photo_protected=$true
    pdf_bytes=$pdfBytes; pdf_capacity_rejected=503; health_during_pdf_load=200; api_public=$false; postgres_public=$false; front_public=$false; map_key_exposed=$false
  } | ConvertTo-Json -Compress
}
finally {
  if ($started -and $ProjectName -match '^rsp07d-https-[a-zA-Z0-9-]+$') {
    & docker compose @compose down --volumes --remove-orphans
  }
  $fullTemp = [IO.Path]::GetFullPath($tempRoot)
  $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($fullTemp.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase) -and ([IO.Path]::GetFileName($fullTemp) -like 'rsp07d-https-*')) {
    Remove-Item -LiteralPath $fullTemp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
