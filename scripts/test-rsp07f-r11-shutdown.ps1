param([string]$ProjectName = "rsp07f-r11-shutdown-$PID")
$ErrorActionPreference = "Stop"
if ($ProjectName -notmatch '^rsp07f-r11-shutdown-[A-Za-z0-9-]+$') { throw "ProjectName inseguro." }

Add-Type -AssemblyName System.Net.Http
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$fixture = Join-Path $repo "scripts/fixtures/shutdown-graceful/compose.yaml"
$productionCompose = Join-Path $repo "docker-compose.production.yaml"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "$ProjectName-$([Guid]::NewGuid().ToString('N'))"
[IO.Directory]::CreateDirectory($tempRoot) | Out-Null
$testImage = "rsp07f-r11-api:$PID"
$savedEnvironment = @{}
$environmentNames = @('RSP_TEST_API_IMAGE','RSP_TEST_API_PORT','RSP_TEST_STATE_DIR','RSP_TEST_MODE','RSP_TEST_DELAY_MS','RSP_TEST_STATEMENT_TIMEOUT_MS')
foreach ($name in $environmentNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

function Invoke-Compose([string]$CaseProject, [string[]]$Arguments) {
  & docker compose --project-name $CaseProject -f $fixture @Arguments | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "docker compose fallo: $($Arguments -join ' ')" }
}

function Get-FreePort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port }
  finally { $listener.Stop() }
}

function Wait-File([string]$Path, [int]$Seconds = 30) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ([IO.File]::Exists($Path)) { return }
    Start-Sleep -Milliseconds 100
  }
  throw "Timeout esperando $Path"
}

function Invoke-ShutdownCase {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][ValidateSet('success','error','timeout')][string]$Mode,
    [Parameter(Mandatory = $true)][int]$DelayMs,
    [Parameter(Mandatory = $true)][int]$ExpectedStatus,
    [Parameter(Mandatory = $true)][bool]$ExpectPhoto,
    [Parameter(Mandatory = $true)][bool]$ExpectOverOldGrace,
    [Parameter(Mandatory = $true)][bool]$Build
  )
  $caseProject = "$ProjectName-$Name"
  $stateDir = Join-Path $tempRoot $Name
  [IO.Directory]::CreateDirectory($stateDir) | Out-Null
  $env:RSP_TEST_API_IMAGE = $testImage
  $env:RSP_TEST_API_PORT = [string](Get-FreePort)
  $env:RSP_TEST_STATE_DIR = $stateDir.Replace('\','/')
  $env:RSP_TEST_MODE = $Mode
  $env:RSP_TEST_DELAY_MS = [string]$DelayMs
  $env:RSP_TEST_STATEMENT_TIMEOUT_MS = '3000'
  try {
    $up = @('up','-d')
    if ($Build) { $up += '--build' }
    $up += @('postgres','api')
    Invoke-Compose $caseProject $up
    Wait-File (Join-Path $stateDir 'ready') 60

    $http = [Net.Http.HttpClient]::new()
    try {
      $requestTask = $http.PostAsync("http://127.0.0.1:$($env:RSP_TEST_API_PORT)/mutate", [Net.Http.StringContent]::new(''))
      Wait-File (Join-Path $stateDir 'photo-isolated') 20
      $timer = [Diagnostics.Stopwatch]::StartNew()
      Invoke-Compose $caseProject @('stop','api')
      $timer.Stop()
      $response = $requestTask.GetAwaiter().GetResult()
      try { $status = [int]$response.StatusCode } finally { $response.Dispose() }
    } finally { $http.Dispose() }

    if ($status -ne $ExpectedStatus) { throw "$Name devolvio HTTP $status; esperado $ExpectedStatus." }
    if ($ExpectOverOldGrace -and $timer.Elapsed.TotalSeconds -lt 10.5) { throw "$Name no supero de forma demostrable el grace viejo de 10 s." }
    if (-not $ExpectOverOldGrace -and $timer.Elapsed.TotalSeconds -ge 10) { throw "$Name no fue acotado por statement_timeout." }
    Wait-File (Join-Path $stateDir 'sigterm')
    Wait-File (Join-Path $stateDir 'clean-exit')

    $containerId = (& docker compose --project-name $caseProject -f $fixture ps -a -q api | Out-String).Trim()
    $containerState = (& docker inspect --format '{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.State.Error}}' $containerId | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $containerState -ne '0|false|') { throw "$Name no termino limpiamente: $containerState" }

    $dbPath = (& docker compose --project-name $caseProject -f $fixture exec -T postgres psql -U rsp_test -d rsp_test -At -c 'SELECT COALESCE(path, '''') FROM shutdown_photo_state WHERE id=1' | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "No se pudo verificar PostgreSQL en $Name." }
    $expectedDbPath = $(if ($ExpectPhoto) { 'fixture-photo.jpg' } else { '' })
    if ($dbPath -ne $expectedDbPath) { throw "$Name dejo DB path='$dbPath', esperado '$expectedDbPath'." }

    $expectedSha = (Get-Content -Raw (Join-Path $stateDir 'ready')).Trim()
    $probe = $(if ($ExpectPhoto) {
      "test -f /var/lib/registro-perforaciones/fotos/fixture-photo.jpg && test ! -e /var/lib/registro-perforaciones/fotos/.trash/fixture-photo.jpg.pending && sha256sum /var/lib/registro-perforaciones/fotos/fixture-photo.jpg | cut -d' ' -f1"
    } else {
      "test ! -e /var/lib/registro-perforaciones/fotos/fixture-photo.jpg && test ! -e /var/lib/registro-perforaciones/fotos/.trash/fixture-photo.jpg.pending && printf absent"
    })
    $photoState = (& docker compose --project-name $caseProject -f $fixture run --rm --no-deps --entrypoint sh api -c $probe | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "$Name dejo el filesystem en estado invalido." }
    if ($ExpectPhoto -and $photoState -ne $expectedSha) { throw "$Name restauro una foto con SHA incorrecto." }
    if (-not $ExpectPhoto -and $photoState -ne 'absent') { throw "$Name no confirmo la eliminacion de foto." }

    return [pscustomobject]@{name=$Name;elapsed_seconds=[Math]::Round($timer.Elapsed.TotalSeconds,2);http_status=$status;clean_exit=$true;db_photo_consistent=$true;photo_sha_verified=$true}
  } finally {
    $savedPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & docker compose --project-name $caseProject -f $fixture down --volumes --remove-orphans 2>&1 | Out-Null }
    finally { $ErrorActionPreference = $savedPreference }
  }
}

try {
  $envPath = Join-Path $tempRoot 'production.env'
  $fakeBackup = (Join-Path $tempRoot 'backups').Replace('\','/')
  $fakeTls = (Join-Path $tempRoot 'fixture.pem').Replace('\','/')
  $envText = @"
API_IMAGE_REF=example/api:r11
FRONT_IMAGE_REF=example/front:r11
PGUSER=rsp_test
PGPASSWORD=fixture-only-not-a-secret
PGDATABASE=rsp_test
FASTIFY_SECRET=fixture-only-not-a-secret-32-bytes
PUBLIC_HOST=r11.example.test
PUBLIC_ORIGIN=https://r11.example.test
MAP_STATIC_URL_TEMPLATE=https://maps.example.test/static?lat={latitud}&lon={longitud}&key={apiKey}
MAP_STATIC_ALLOWED_HOST=maps.example.test
MAP_STATIC_API_KEY=fixture-only
MAP_STATIC_ATTRIBUTION=Fixture
TLS_CERT_FILE=$fakeTls
TLS_KEY_FILE=$fakeTls
BACKUP_DIR=$fakeBackup
"@
  [IO.File]::WriteAllText($envPath, $envText, [Text.UTF8Encoding]::new($false))
  $rendered = (& docker compose --env-file $envPath -f $productionCompose config --format json | Out-String)
  if ($LASTEXITCODE -ne 0) { throw 'docker compose config fallo para produccion.' }
  $config = $rendered | ConvertFrom-Json
  $grace = [string]$config.services.api.stop_grace_period
  if ($grace -notin @('480000000000','480s','8m0s')) { throw "Compose no aplico stop_grace_period=480s (valor: $grace)." }

  $opsStopOverrides = Get-ChildItem (Join-Path $repo 'ops') -File | Where-Object { $_.Extension -in @('.sh','.ps1') } | Select-String -CaseSensitive -Pattern 'docker\s+kill|docker\s+stop|(?:^|[\s,"''])-t(?:[\s,"''=]|$)|(?:^|[\s,"''])--(?:time|timeout)(?:[\s,"''=]|$)'
  if ($opsStopOverrides) { throw "Un flujo ops sobreescribe el grace: $($opsStopOverrides.Path -join ', ')" }

  $results = @()
  $results += Invoke-ShutdownCase -Name 'long-success' -Mode success -DelayMs 12000 -ExpectedStatus 204 -ExpectPhoto $false -ExpectOverOldGrace $true -Build $true
  $results += Invoke-ShutdownCase -Name 'long-error' -Mode error -DelayMs 12000 -ExpectedStatus 500 -ExpectPhoto $true -ExpectOverOldGrace $true -Build $false
  $results += Invoke-ShutdownCase -Name 'bounded-timeout' -Mode timeout -DelayMs 20000 -ExpectedStatus 500 -ExpectPhoto $true -ExpectOverOldGrace $false -Build $false
  [pscustomobject]@{production_stop_grace_period_seconds=480;compose_stop_honored=$true;no_ops_timeout_override=$true;cases=$results} | ConvertTo-Json -Depth 5 -Compress
} finally {
  foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
  $savedPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & docker image rm $testImage 2>&1 | Out-Null } finally { $ErrorActionPreference = $savedPreference }
  $full = [IO.Path]::GetFullPath($tempRoot); $system = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($full.StartsWith($system, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($full) -like 'rsp07f-r11-shutdown-*') {
    Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue
  }
}
