param([string]$ProjectName = "rsp07f-r8-smoke-$PID", [string]$RealJqPath='',[switch]$Validation026Only,[switch]$Validation027Only)

$ErrorActionPreference = "Stop"
if ($ProjectName -notmatch '^rsp07f-r8-smoke-[A-Za-z0-9-]+$') { throw "ProjectName inseguro." }

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "$ProjectName-$([Guid]::NewGuid().ToString('N'))"
$bin = Join-Path $tempRoot "bin"
[IO.Directory]::CreateDirectory($bin) | Out-Null
$envFile = Join-Path $tempRoot "production.env"
$stateFile = Join-Path $tempRoot "deployment.env"
$passwordFile = Join-Path $tempRoot "admin-password"
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($envFile, "PUBLIC_ORIGIN=https://rsp-smoke.test:9443/`nPUBLIC_HOST=rsp-smoke.test`nHTTPS_PORT=8443`n", $utf8)
[IO.File]::WriteAllText($stateFile, "RSP_R8_FIXTURE=1`n", $utf8)
[IO.File]::WriteAllText($passwordFile, "fixture-only", $utf8)
$global:R8SmokeScenario = ""
$global:R8ExpectedConnect='rsp-smoke.test:9443:127.0.0.1:8443'
$global:R8ExpectedOrigin='https://rsp-smoke.test:9443'
$global:R8ConnectOverride=0

function Write-FixtureBody([string]$Path, [byte[]]$Bytes) {
  [IO.File]::WriteAllBytes($Path, $Bytes)
}

function Invoke-R8FakeCurl {
  $items = @($args | ForEach-Object { [string]$_ })
  if($items -contains '--insecure' -or $items -notcontains '--connect-to' -or $items -notcontains $global:R8ExpectedConnect){throw 'Transporte TLS/Host/puerto incorrecto'}
  foreach($item in $items){if($item -like 'Origin:*' -and $item -ne "Origin: $global:R8ExpectedOrigin"){throw 'Origin incorrecta'}}
  $outPath = ""; $headersPath = ""; $cookieJar = ""; $cookie = ""; $method = "GET"; $url = ""; $csrf = $false
  for ($index = 0; $index -lt $items.Count; $index++) {
    switch ($items[$index]) {
      { $_ -in @("-o", "--output") } { $outPath = $items[++$index]; break }
      { $_ -in @("-D", "--dump-header") } { $headersPath = $items[++$index]; break }
      { $_ -in @("-c", "--cookie-jar") } { $cookieJar = $items[++$index]; break }
      { $_ -in @("-b", "--cookie") } { $cookie = $items[++$index]; break }
      { $_ -in @("-X", "--request") } { $method = $items[++$index]; break }
      { $_ -in @("-H", "--header") } { if ($items[++$index] -like "X-CSRF-Token:*") { $csrf = $true }; break }
      { $_ -in @("--connect-to", "--noproxy", "--cacert", "--resolve", "--data-binary", "-w", "--write-out", "--max-time") } { $index++; break }
      { $_ -match '^https?://' } { $url = $_; break }
    }
  }
  if (-not $url) { throw "fixture curl: URL ausente" }
  if($Validation027Only -and ($method -ne 'GET') -and $url -notmatch '/api/(login|logout)$'){throw '027 smoke attempted business write'}
  if ($headersPath) { [IO.File]::WriteAllText($headersPath, "", $utf8) }
  if ($url.EndsWith('/ws')) {
    $global:LASTEXITCODE = 0
    Write-Output "HTTP/1.1 101 Switching Protocols`r`nUpgrade: websocket`r`nConnection: Upgrade`r`n"
    return
  }

  $status = "404"; $bodyText = "not found"; $bodyBytes = $null; $headerText = ""
  if ($url -match '/api/(health|ready)$') { $status = "200"; $bodyText = '{"status":"ok"}' }
  elseif ($url.EndsWith('/api/docs')) { $status = "404" }
  elseif ($url.EndsWith('/api/login')) {
    if ($method -eq "POST") {
      $status = "200"; $bodyText = '{"authenticated":true}'
      if ($cookieJar) {
        [IO.File]::WriteAllText($cookieJar, "127.0.0.1`tFALSE`t/`tTRUE`t0`trsp_session`tfixture-session`n127.0.0.1`tFALSE`t/`tTRUE`t0`trsp_csrf`tfixture-csrf`n", $utf8)
      }
      $headerText = "HTTP/1.1 200 OK`r`nSet-Cookie: rsp_session=fixture-session; HttpOnly; Secure; SameSite=Lax`r`nSet-Cookie: rsp_csrf=fixture-csrf; Secure; SameSite=Lax`r`n`r`n"
    } else {
      $status = if ($cookie -match 'old-cookies|cookies-copy') { "401" } else { "200" }
      $bodyText = '{"authenticated":true}'
      if($Validation027Only){$bodyText='{"id_usuario":1,"roles":[{"nombre":"administracion"}]}'}
    }
  }
  elseif ($url.EndsWith('/api/logout')) { $status = if ($csrf) { "204" } else { "403" }; $bodyText = "" }
  elseif ($url.EndsWith('/api/pozos/numeracion/politica')) {
    if($method -ne 'GET' -or -not $cookie){throw '026 must use authenticated GET only'}
    $status='200';$policy=@{revision='1';rangos=@(@{desde=1;hasta=3281});excepciones=@();historial=@();puede_administrar=$true}
    switch($global:R8SmokeScenario){
      '026_forbidden' {$status='403'}
      '026_absent' {$status='404'}
      '026_permission' {$policy.puede_administrar=$false}
      '026_exception' {$policy.excepciones=@(300)}
      '026_range' {$policy.rangos[0].hasta=3280}
    }
    $bodyText=$policy | ConvertTo-Json -Depth 5 -Compress
  }
  elseif ($url.EndsWith('/api/usuarios/0/pozos')) {
    $ownerCases=Get-Content (Join-Path $repo 'scripts/fixtures/smoke/owner-cases.json') -Raw | ConvertFrom-Json
    if($ownerCases.PSObject.Properties[$global:R8SmokeScenario]){$status='200';$bodyText=ConvertTo-Json -InputObject @($ownerCases.($global:R8SmokeScenario)) -Compress}
    else {switch ($global:R8SmokeScenario) {
      {$_ -eq 'empty' -or $_ -like '026_*'} { $status = "200"; $bodyText = '[]' }
      {$_ -like '027_*'} { $status='200';$bodyText=if($_ -eq '027_empty'){'[]'}else{'[{"id_pozo":1,"id_propietario":2,"foto_url":null}]'} }
      "no_photo" { $status = "200"; $bodyText = '[{"id_pozo":1,"id_propietario":2,"foto_url":null}]' }
      { $_ -in @("valid_photo", "missing_photo") } { $status = "200"; $bodyText = '[{"id_pozo":1,"id_propietario":2,"foto_url":"/api/usuarios/2/pozos/1/foto"}]' }
      "second_photo" { $status = "200"; $bodyText = '[{"id_pozo":1,"id_propietario":2,"foto_url":null},{"id_pozo":3,"id_propietario":4,"foto_url":"/api/usuarios/4/pozos/3/foto"}]' }
      "api_500" { $status = "500"; $bodyText = '{"error":"fixture"}' }
      "malformed_json" { $status = "200"; $bodyText = '[{"id_pozo":' }
      default { throw "Escenario fixture desconocido: $global:R8SmokeScenario" }
    }
  }
  }
  elseif ($url -match '/api/usuarios/\d+/pozos/\d+/foto$') {
    if (-not $cookie) { $status = "401"; $bodyText = '{"error":"auth"}' }
    elseif ($global:R8SmokeScenario -eq "missing_photo") { $status = "404"; $bodyText = '{"error":"missing"}' }
    else {
      $status = "200"; $bodyBytes = [byte[]](0xff, 0xd8, 0xff, 0xd9)
      $headerText = "HTTP/1.1 200 OK`r`nContent-Type: image/jpeg`r`n`r`n"
    }
  }
  elseif ($url -match '/api/usuarios/\d+/pozos/\d+/informe-pdf$') { $status = "200"; $bodyText = if($global:R8SmokeScenario -eq '027_bad_pdf'){'invalid'}else{"%PDF-fixture"} }
  elseif ($url -match '/api/usuarios/\d+/pozos/\d+/perfil-litologico$') {
    if($method -ne 'GET' -or -not $cookie){throw '027 profile must be authenticated GET'}
    $status=if($global:R8SmokeScenario -eq '027_profile_500'){'500'}else{'200'}
    $bodyText=if($global:R8SmokeScenario -eq '027_bad_profile'){'null'}else{'{"profundidad_m":30,"rangos":[{"desde_m":0,"hasta_m":30}],"tramos":[],"etiquetas":[],"prefiltro_constructivo":[]}'}
  }
  elseif ($url -match '/api/usuarios/\d+/pozos/\d+$') {
    $status = "200"; $bodyText = '{"id_pozo":1,"id_propietario":2}'
    if($Validation027Only){
      $d=@{id_pozo=1;id_propietario=2;profundidad_final_m=30;prefiltro_constructivo=@()}
      switch($global:R8SmokeScenario){
        '027_missing' {$d.Remove('prefiltro_constructivo')}
        '027_null' {$d.prefiltro_constructivo=$null}
        '027_invented' {$d.prefiltro_constructivo=@(@{desde_m=12;hasta_m=15})}
        '027_no_depth' {$d.profundidad_final_m=$null}
      }
      $bodyText=ConvertTo-Json -InputObject $d -Depth 5 -Compress
    }
  }
  elseif ($url.EndsWith('/pozos-detail/1')) { $status = "200"; $bodyText = '<app-root></app-root>' }
  elseif ($url.EndsWith('/')) {
    $status = "200"; $bodyText = '<app-root></app-root>'
    $headerText = "HTTP/1.1 200 OK`r`nX-Content-Type-Options: nosniff`r`nReferrer-Policy: same-origin`r`nX-Frame-Options: DENY`r`nPermissions-Policy: geolocation=()`r`nContent-Security-Policy: default-src self`r`n`r`n"
  }
  if ($headersPath) { [IO.File]::WriteAllText($headersPath, $headerText, $utf8) }
  if ($outPath) {
    if ($null -ne $bodyBytes) { Write-FixtureBody $outPath $bodyBytes }
    else { [IO.File]::WriteAllText($outPath, $bodyText, $utf8) }
  }
  $global:LASTEXITCODE = 0
  Write-Output $status
}

function docker {
  $items = @($args | ForEach-Object { [string]$_ })
  if ($items[0] -eq "inspect") { Write-Output '{}'; return }
  $service = $items[$items.Count - 1]
  if ($service -notin @("api", "front", "postgres")) { throw "docker fixture inesperado" }
  Write-Output "$service-id"
}

function Assert-ScenarioResult([string]$Platform, [string]$Scenario, [bool]$ShouldPass, [string]$Output) {
  $passed = $Output -match '(?m)^SMOKE_OK\r?$'
  if ($passed -ne $ShouldPass) { throw "$Platform/$Scenario obtuvo resultado inesperado:`n$Output" }
  if ($ShouldPass -and $Scenario -eq "empty" -and $Output -notmatch 'SKIP well-detail: no wells available' ) { throw "$Platform no informó skip de dataset vacío." }
  if ($ShouldPass -and $Scenario -eq "no_photo" -and $Output -notmatch 'SKIP photo: no photo available') { throw "$Platform no informó skip de foto opcional." }
  if ($ShouldPass -and $Scenario -in @("valid_photo", "second_photo") -and $Output -notmatch '(?m)^PASS photo\r?$') { throw "$Platform no verificó la foto disponible." }
}

function Invoke-PowerShellScenario([string]$Scenario, [bool]$ShouldPass) {
  $global:R8SmokeScenario = $Scenario
  $captured = @(); $failed = $false
  try {
    $captured = @(& (Join-Path $repo 'ops/smoke.ps1') -EnvFile $envFile -DeploymentStateFile $stateFile -ProjectName $ProjectName -AdminEmail 'fixture@example.test' -AdminPasswordFile $passwordFile -ConnectPort $global:R8ConnectOverride -Validate026:$Validation026Only -Validate027:$Validation027Only 2>&1)
  } catch {
    $failed = $true; $captured += $_.Exception.Message
  }
  $output = ($captured | ForEach-Object { [string]$_ }) -join "`n"
  if ($failed -eq $ShouldPass) { throw "PowerShell/$Scenario no respetó exit esperado:`n$output" }
  Assert-ScenarioResult "PowerShell" $Scenario $ShouldPass $output
  if($Validation026Only -and (($output -match '(?m)^SMOKE_026_API_OK\r?$') -ne $ShouldPass)){throw '026 smoke sentinel incorrect'}
  if($Validation027Only -and (($output -match '(?m)^SMOKE_027_API_OK\r?$') -ne $ShouldPass)){throw '027 smoke sentinel incorrect'}
}

function Quote-Bash([string]$Value) {
  if ($Value.Contains("'")) { throw "El fixture no admite comillas simples en paths." }
  return "'$Value'"
}
function Convert-GitBashPath([string]$Value) {
  $normalized = [IO.Path]::GetFullPath($Value).Replace('\', '/')
  if ($normalized -notmatch '^([A-Za-z]):/(.*)$') { throw "Path Windows inesperado: $Value" }
  return "/$($Matches[1].ToLowerInvariant())/$($Matches[2])"
}

function Invoke-PosixScenario([string]$Scenario, [bool]$ShouldPass) {
  $env:RSP_EXPECTED_CONNECT=$global:R8ExpectedConnect
  $env:RSP_EXPECTED_ORIGIN=$global:R8ExpectedOrigin
  $bash = (Get-Command bash.exe -ErrorAction Stop).Source
  $repoUnix = Convert-GitBashPath $repo
  $tempUnix = Convert-GitBashPath $tempRoot
  $smoke = "$repoUnix/ops/smoke.sh"
  $command = "chmod +x $(Quote-Bash "$tempUnix/bin/curl") $(Quote-Bash "$tempUnix/bin/docker") $(Quote-Bash "$tempUnix/bin/jq") && PATH=$(Quote-Bash "$tempUnix/bin"):`$PATH RSP_SMOKE_SCENARIO=$(Quote-Bash $Scenario) RSP_R8_JQ_JS=$(Quote-Bash "$repoUnix/scripts/fixtures/smoke/fake-jq.js") ENV_FILE=$(Quote-Bash (Convert-GitBashPath $envFile)) DEPLOYMENT_STATE_FILE=$(Quote-Bash (Convert-GitBashPath $stateFile)) PROJECT_NAME=$(Quote-Bash $ProjectName) ADMIN_EMAIL=fixture@example.test ADMIN_PASSWORD_FILE=$(Quote-Bash (Convert-GitBashPath $passwordFile)) COMPOSE_FILE=$(Quote-Bash "$repoUnix/docker-compose.production.yaml") $(Quote-Bash $smoke)"
  $oldPreference = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try { $captured = (& $bash -c $command 2>&1 | Out-String); $exitCode = $LASTEXITCODE } finally { $ErrorActionPreference = $oldPreference }
  if (($exitCode -eq 0) -ne $ShouldPass) { throw "POSIX/$Scenario no respetó exit esperado ($exitCode):`n$captured" }
  Assert-ScenarioResult "POSIX" $Scenario $ShouldPass $captured
}

try {
  Set-Alias -Name 'curl.exe' -Value Invoke-R8FakeCurl -Scope Global
  if($Validation027Only){
    foreach($case in @('027_ok','027_missing','027_null','027_invented','027_no_depth','027_empty','027_profile_500','027_bad_profile','027_bad_pdf')){
      Invoke-PowerShellScenario $case ($case -eq '027_ok')
      Write-Output "PASS smoke/$case"
    }
    Write-Output 'SMOKE_027_MOCKS_OK 9/9; no real HTTP or Docker commands'
    return
  }
  if($Validation026Only){
    foreach($case in @('026_ok','026_forbidden','026_absent','026_permission','026_exception','026_range')){
      Invoke-PowerShellScenario $case ($case -eq '026_ok')
      Write-Output "PASS smoke/$case"
    }
    Write-Output 'SMOKE_026_MOCKS_OK 6/6; no real HTTP or Docker commands'
    return
  }
  foreach ($fixture in @('fake-curl.sh', 'fake-docker.sh')) {
    $source = Join-Path $repo "scripts/fixtures/smoke/$fixture"
    $target = Join-Path $bin ($(if ($fixture -eq 'fake-curl.sh') { 'curl' } else { 'docker' }))
    [IO.File]::WriteAllText($target, ([IO.File]::ReadAllText($source).Replace("`r`n", "`n")), $utf8)
  }
  $jqWrapper = "#!/bin/sh`nexec node `"`$RSP_R8_JQ_JS`" `"`$@`"`n"
  if($RealJqPath){$jqWrapper="#!/bin/sh`nexec $(Quote-Bash (Convert-GitBashPath (Resolve-Path -LiteralPath $RealJqPath).Path)) `"`$@`"`n"}
  [IO.File]::WriteAllText((Join-Path $bin 'jq'), $jqWrapper, $utf8)

  $ownerCases=Get-Content (Join-Path $repo 'scripts/fixtures/smoke/owner-cases.json') -Raw | ConvertFrom-Json
  foreach($property in $ownerCases.PSObject.Properties){
    $caseFile=Join-Path $tempRoot 'owner-case.json'
    [IO.File]::WriteAllText($caseFile,(ConvertTo-Json -InputObject @($property.Value) -Compress),$utf8)
    $env:RSP_SMOKE_WELLS_FILE=$caseFile
    Invoke-PowerShellScenario $property.Name (-not $property.Name.StartsWith('invalid'))
    Invoke-PosixScenario $property.Name (-not $property.Name.StartsWith('invalid'))
  }
  Remove-Item Env:\RSP_SMOKE_WELLS_FILE
  foreach ($case in @(
    @{ Name = 'empty'; Pass = $true },
    @{ Name = 'no_photo'; Pass = $true },
    @{ Name = 'valid_photo'; Pass = $true },
    @{ Name = 'second_photo'; Pass = $true },
    @{ Name = 'missing_photo'; Pass = $false },
    @{ Name = 'api_500'; Pass = $false },
    @{ Name = 'malformed_json'; Pass = $false }
  )) {
    Invoke-PowerShellScenario $case.Name $case.Pass
    Invoke-PosixScenario $case.Name $case.Pass
  }

  foreach($transportCase in @(
    @{Origin='https://rsp-smoke.test';Logical=443;Configured=8443;Override=0;Actual=8443},
    @{Origin='https://rsp-smoke.test';Logical=443;Configured=$null;Override=0;Actual=443},
    @{Origin='https://rsp-smoke.test';Logical=443;Configured=8443;Override=18443;Actual=18443}
  )){
    $text="PUBLIC_ORIGIN=$($transportCase.Origin)`nPUBLIC_HOST=rsp-smoke.test`n"
    if($transportCase.Configured){$text+="HTTPS_PORT=$($transportCase.Configured)`n"}
    [IO.File]::WriteAllText($envFile,$text,$utf8)
    $global:R8ExpectedOrigin=$transportCase.Origin
    $global:R8ExpectedConnect="rsp-smoke.test:$($transportCase.Logical):127.0.0.1:$($transportCase.Actual)"
    $global:R8ConnectOverride=$transportCase.Override
    if($transportCase.Override){$env:SMOKE_CONNECT_PORT=[string]$transportCase.Override}else{Remove-Item Env:\SMOKE_CONNECT_PORT -ErrorAction SilentlyContinue}
    Invoke-PowerShellScenario 'no_photo' $true
    Invoke-PosixScenario 'no_photo' $true
  }
  Remove-Item Env:\SMOKE_CONNECT_PORT -ErrorAction SilentlyContinue
  $deploySh = [IO.File]::ReadAllText((Join-Path $repo 'ops/deploy.sh'))
  $rollbackSh = [IO.File]::ReadAllText((Join-Path $repo 'ops/rollback.sh'))
  $deployPs = [IO.File]::ReadAllText((Join-Path $repo 'ops/deploy.ps1'))
  $rollbackPs = [IO.File]::ReadAllText((Join-Path $repo 'ops/rollback.ps1'))
  if ($deploySh -notmatch 'grep -qx SMOKE_OK' -or $rollbackSh -notmatch 'grep -qx SMOKE_OK') { throw 'Deploy/rollback POSIX no consumen SMOKE_OK por línea.' }
  if ($deployPs -notmatch '-notcontains' -or $deployPs -notmatch 'SMOKE_OK' -or $rollbackPs -notmatch '-notcontains' -or $rollbackPs -notmatch 'SMOKE_OK') { throw 'Deploy/rollback PowerShell no consumen SMOKE_OK entre PASS/SKIP.' }

  [pscustomobject]@{
    owner_cases_per_platform = 13; transport_checks = '4 variants per platform: 9443/8443, 443/8443, 443/443, 443/18443; Host/SNI/Origin preserved, TLS enforced'
    empty_dataset = 'pass_with_skips'; well_without_photo = 'pass_with_photo_skip'
    valid_photo = 'verified'; photo_not_on_first_well = 'verified'; missing_referenced_photo = 'rejected'
    wells_api_500 = 'rejected'; malformed_wells_json = 'rejected'
    powershell_posix_equivalent = $true; deploy_consumes_smoke_ok = $true; rollback_consumes_smoke_ok = $true
  } | ConvertTo-Json -Compress
} finally {
  Remove-Item Alias:\curl.exe -ErrorAction SilentlyContinue
  Remove-Item Function:\docker -ErrorAction SilentlyContinue
  Remove-Variable R8SmokeScenario -Scope Global -ErrorAction SilentlyContinue
  $full = [IO.Path]::GetFullPath($tempRoot); $system = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($full.StartsWith($system, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($full) -like 'rsp07f-r8-smoke-*') {
    Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue
  }
}
