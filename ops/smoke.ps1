param(
  [Parameter(Mandatory=$true)][string]$EnvFile,
  [string]$DeploymentStateFile="",
  [Parameter(Mandatory=$true)][string]$ProjectName,
  [Parameter(Mandatory=$true)][string]$AdminEmail,
  [Parameter(Mandatory=$true)][string]$AdminPasswordFile,
  [string]$ComposeFile="docker-compose.production.yaml"
)

$ErrorActionPreference="Stop"
. (Join-Path $PSScriptRoot "secret-file.ps1")
if($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]+$'){throw "ProjectName no es seguro."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envPath=(Resolve-Path $EnvFile).Path
$passwordPath=(Resolve-Path $AdminPasswordFile).Path
$composePath=(Resolve-Path (Join-Path $repo $ComposeFile)).Path

function Get-EnvValue([string]$Name){
  $line=Get-Content -LiteralPath $envPath | Where-Object {$_ -match "^$([regex]::Escape($Name))="}|Select-Object -Last 1
  if(-not $line){throw "Falta $Name en el archivo de entorno."}
  return ($line -split '=',2)[1].Trim()
}

$origin=[Uri](Get-EnvValue "PUBLIC_ORIGIN")
$hostName=Get-EnvValue "PUBLIC_HOST"
if($origin.Scheme -ne "https" -or $origin.Host -ne $hostName){throw "PUBLIC_ORIGIN/PUBLIC_HOST no forman la origin HTTPS canónica."}
$port=$origin.Port
$compose=@("--project-name",$ProjectName,"--env-file",$envPath)
if($DeploymentStateFile){$compose+=@("--env-file",(Resolve-Path $DeploymentStateFile).Path)}
$compose+=@("-f",$composePath)
$tempRoot=Join-Path ([IO.Path]::GetTempPath()) "rsp-smoke-$PID-$([Guid]::NewGuid().ToString('N'))"
[IO.Directory]::CreateDirectory($tempRoot)|Out-Null
$body=Join-Path $tempRoot "body.bin";$headers=Join-Path $tempRoot "headers.txt";$cookies=Join-Path $tempRoot "cookies.txt";$cookiesCopy=Join-Path $tempRoot "cookies-copy.txt";$loginBody=Join-Path $tempRoot "login.json"

function Invoke-Https([string[]]$Arguments){
  $status=(& curl.exe --insecure --silent --show-error --resolve "${hostName}:${port}:127.0.0.1" @Arguments --output $body --write-out "%{http_code}"|Out-String).Trim()
  if($LASTEXITCODE -ne 0){throw "curl falló durante smoke."}
  return $status
}
function Assert-Status([string]$Actual,[string]$Expected,[string]$Paso){if($Actual -ne $Expected){throw "$Paso devolvió $Actual; se esperaba $Expected."}}

try{
  Assert-Status (Invoke-Https @("--dump-header",$headers,"$($origin.AbsoluteUri)")) "200" "frontend raíz"
  if([IO.File]::ReadAllText($body)-notmatch '<app-root'){throw "La raíz no devolvió Angular."}
  $security=[IO.File]::ReadAllText($headers)
  foreach($header in @("X-Content-Type-Options: nosniff","Referrer-Policy: same-origin","X-Frame-Options: DENY","Permissions-Policy:","Content-Security-Policy:")){if($security-notmatch [regex]::Escape($header)){throw "Falta header de seguridad $header"}}
  Assert-Status (Invoke-Https @("$($origin.AbsoluteUri)pozos-detail/1")) "200" "ruta Angular profunda"
  Assert-Status (Invoke-Https @("$($origin.AbsoluteUri)api/health")) "200" "health"
  Assert-Status (Invoke-Https @("$($origin.AbsoluteUri)api/ready")) "200" "readiness"
  Assert-Status (Invoke-Https @("$($origin.AbsoluteUri)api/docs")) "404" "Swagger production off"

  $login=@{email=$AdminEmail;password=(Read-OpaqueSecretFile $passwordPath)}|ConvertTo-Json -Compress
  [IO.File]::WriteAllText($loginBody,$login,[Text.UTF8Encoding]::new($false))
  Assert-Status (Invoke-Https @("--request","POST","--header","Origin: $($origin.AbsoluteUri.TrimEnd('/'))","--header","Content-Type: application/json","--data-binary","@$loginBody","--cookie-jar",$cookies,"--dump-header",$headers,"$($origin.AbsoluteUri)api/login")) "200" "login"
  $cookieHeaders=[IO.File]::ReadAllText($headers)
  if($cookieHeaders-notmatch '(?im)^set-cookie: rsp_session=.*; HttpOnly; Secure; SameSite=Lax'){throw "La cookie de sesión no conserva Secure/HttpOnly/Lax."}
  if($cookieHeaders-notmatch '(?im)^set-cookie: rsp_csrf=.*; Secure; SameSite=Lax'){throw "La cookie CSRF no conserva Secure/Lax."}
  $csrfLine=Get-Content $cookies|Where-Object{$_ -notmatch '^#' -and ($_ -split "`t").Count-ge 7 -and ($_ -split "`t")[5]-eq 'rsp_csrf'}|Select-Object -First 1
  if(-not $csrfLine){throw "No se obtuvo cookie CSRF."};$csrf=($csrfLine-split "`t")[6]
  Copy-Item -LiteralPath $cookies -Destination $cookiesCopy
  Assert-Status (Invoke-Https @("--cookie",$cookies,"$($origin.AbsoluteUri)api/login")) "200" "request autenticada"
  Assert-Status (Invoke-Https @("--request","POST","--cookie",$cookies,"--header","Origin: $($origin.AbsoluteUri.TrimEnd('/'))","$($origin.AbsoluteUri)api/logout")) "403" "CSRF ausente"

  Assert-Status (Invoke-Https @("--cookie",$cookies,"$($origin.AbsoluteUri)api/usuarios/0/pozos")) "200" "lista de pozos"
  $pozos=@([IO.File]::ReadAllText($body)|ConvertFrom-Json);if($pozos.Count-eq 0){throw "El smoke requiere al menos un pozo representativo."}
  $pozo=$pozos[0];$wellId=[int]$pozo.id_pozo;$ownerId=[int]$pozo.id_propietario
  Assert-Status (Invoke-Https @("--cookie",$cookies,"$($origin.AbsoluteUri)api/usuarios/$ownerId/pozos/$wellId")) "200" "detalle de pozo"
  Assert-Status (Invoke-Https @("$($origin.AbsoluteUri)api/usuarios/$ownerId/pozos/$wellId/foto")) "401" "foto protegida sin sesión"
  Assert-Status (Invoke-Https @("--cookie",$cookies,"$($origin.AbsoluteUri)api/usuarios/$ownerId/pozos/$wellId/foto")) "200" "foto protegida"
  if((Get-Item $body).Length-le 0){throw "La foto protegida está vacía."}
  Assert-Status (Invoke-Https @("--cookie",$cookies,"$($origin.AbsoluteUri)api/usuarios/$ownerId/pozos/$wellId/informe-pdf")) "200" "PDF"
  if((Get-Item $body).Length-lt 4 -or [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($body),0,4)-ne '%PDF'){throw "PDF inválido."}

  $oldPreference=$ErrorActionPreference;$ErrorActionPreference="Continue"
  try{$ws=(& curl.exe --insecure --silent --show-error --include --max-time 2 --resolve "${hostName}:${port}:127.0.0.1" --cookie $cookies --header "Origin: $($origin.AbsoluteUri.TrimEnd('/'))" --header "Connection: Upgrade" --header "Upgrade: websocket" --header "Sec-WebSocket-Version: 13" --header "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" "$($origin.AbsoluteUri)ws" 2>&1|Out-String);$wsExit=$LASTEXITCODE}finally{$ErrorActionPreference=$oldPreference}
  if($wsExit-notin @(0,28)-or $ws-notmatch 'HTTP/1\.1 101'){throw "WebSocket no devolvió 101."}
  foreach($service in @("api","front","postgres")){$id=(& docker compose @compose ps -q $service|Out-String).Trim();if(-not $id){throw "Falta servicio $service."};$bindings=(& docker inspect --format '{{json .HostConfig.PortBindings}}' $id|Out-String).Trim();if($bindings-ne '{}'){throw "$service tiene puertos publicados."}}

  Assert-Status (Invoke-Https @("--request","POST","--cookie",$cookies,"--header","Origin: $($origin.AbsoluteUri.TrimEnd('/'))","--header","X-CSRF-Token: $csrf","--dump-header",$headers,"$($origin.AbsoluteUri)api/logout")) "204" "logout"
  Assert-Status (Invoke-Https @("--cookie",$cookiesCopy,"$($origin.AbsoluteUri)api/login")) "401" "revocación logout"
  Write-Output "SMOKE_OK"
  [pscustomobject]@{health="ok";ready="ok";login=$true;csrf=403;pozo=$wellId;foto=$true;pdf=$true;websocket=101;swagger=404;internal_ports=$true;logout_revocado=$true}|ConvertTo-Json -Compress
}finally{
  if([IO.Directory]::Exists($tempRoot)){[IO.Directory]::Delete($tempRoot,$true)}
}
