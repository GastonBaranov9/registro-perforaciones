$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$utf8 = [Text.UTF8Encoding]::new($false)

function Assert-LfOnly([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  for ($i = 0; $i -lt $bytes.Length - 1; $i++) {
    if ($bytes[$i] -eq 13 -and $bytes[$i + 1] -eq 10) { throw "CRLF detectado en $Path" }
  }
}

$shellFiles = @(& git -C $repo ls-files "*.sh")
$migrationFiles = @(& git -C $repo ls-files "api/db/migrations/*.sql")
if (-not $shellFiles.Count -or -not $migrationFiles.Count) { throw "No se encontraron archivos operacionales para auditar." }
foreach ($relative in @($shellFiles + $migrationFiles)) {
  $attribute = (& git -C $repo check-attr eol -- $relative | Out-String).Trim()
  if ($attribute -notmatch ': eol: lf$') { throw "Git no fija eol=lf para $relative" }
  Assert-LfOnly (Join-Path $repo $relative)
}

$expectedExecutable = @("scripts/deploy.sh", "ops/deploy.sh", "ops/rollback.sh", "ops/prepare-photo-storage.sh", "ops/smoke.sh")
foreach ($relative in $expectedExecutable) {
  $stage = (& git -C $repo ls-files --stage -- $relative | Out-String).Trim()
  if ($stage -notmatch '^100755 ') { throw "Se perdió modo 100755 en $relative" }
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ("rsp07f-r10-lf-" + [Guid]::NewGuid().ToString("N"))
$checkout = "$fixture-checkout"
try {
  [IO.Directory]::CreateDirectory((Join-Path $fixture "api/db/migrations")) | Out-Null
  [IO.File]::WriteAllText((Join-Path $fixture ".gitattributes"), "*.sh text eol=lf`napi/db/migrations/*.sql text eol=lf`n", $utf8)
  [IO.File]::WriteAllText((Join-Path $fixture "run.sh"), "#!/bin/sh`nset -eu`nprintf 'LF_OK\n'`n", $utf8)
  [IO.File]::WriteAllText((Join-Path $fixture "api/db/migrations/000_fixture.sql"), "-- fixture`nSELECT 1;`n", $utf8)
  & git -C $fixture init --quiet
  & git -C $fixture config core.autocrlf true
  & git -C $fixture add .
  [IO.Directory]::CreateDirectory($checkout) | Out-Null
  $prefix = $checkout.Replace('\','/') + '/'
  & git -C $fixture checkout-index --all --force "--prefix=$prefix"
  if ($LASTEXITCODE -ne 0) { throw "No se pudo crear checkout aislado." }
  Assert-LfOnly (Join-Path $checkout "run.sh")
  Assert-LfOnly (Join-Path $checkout "api/db/migrations/000_fixture.sql")
  $dockerPath = $checkout.Replace('\','/')
  $output = (& docker run --rm -v "${dockerPath}:/fixture:ro" postgres:16.14-alpine3.24 /bin/sh /fixture/run.sh | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $output -ne "LF_OK") { throw "El shell LF no ejecutó correctamente en Linux." }
}
finally {
  if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
  if (Test-Path -LiteralPath $checkout) { Remove-Item -LiteralPath $checkout -Recurse -Force }
}

[pscustomobject]@{
  autocrlf_checkout = "lf"
  shell_linux = "ok"
  shell_files = $shellFiles.Count
  migration_files = $migrationFiles.Count
  executable_modes = "preserved"
} | ConvertTo-Json -Compress
