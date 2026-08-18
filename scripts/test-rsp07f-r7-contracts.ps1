param([string]$ProjectName = "rsp07f-r7-posix-$PID")

$ErrorActionPreference = "Stop"
if ($ProjectName -notmatch '^rsp07f-r7-posix-[a-zA-Z0-9-]+$') { throw "ProjectName no es seguro." }

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$executables = @(
  "scripts/deploy.sh",
  "ops/deploy.sh",
  "ops/rollback.sh",
  "ops/prepare-photo-storage.sh",
  "ops/smoke.sh"
)
$sourced = @("ops/deployment-state.sh", "ops/deployment-audit.sh", "ops/secret-file.sh")
$explicitShell = @("ops/backup.sh", "ops/restore.sh", "ops/photo-storage-migrate.sh", "proxy/start.sh")

function Get-GitMode([string]$Path) {
  $entry = (& git -C $repo ls-files -s -- $Path | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $entry -notmatch '^(\d{6})\s') { throw "No se pudo leer el modo Git de $Path." }
  return $Matches[1]
}

foreach ($script in $executables) {
  if ((Get-GitMode $script) -ne "100755") { throw "$script no esta registrado como 100755." }
  if ((Get-Content -LiteralPath (Join-Path $repo $script) -TotalCount 1) -ne "#!/bin/sh") {
    throw "$script no conserva shebang POSIX."
  }
}
foreach ($script in @($sourced + $explicitShell)) {
  if ((Get-GitMode $script) -ne "100644") { throw "$script recibio un modo ejecutable innecesario." }
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) $ProjectName
$archive = Join-Path $tempRoot "checkout.tar"
if ([IO.Directory]::Exists($tempRoot)) { throw "El temporal ya existe: $tempRoot" }
[IO.Directory]::CreateDirectory($tempRoot) | Out-Null

try {
  & git -C $repo archive --format=tar --output=$archive HEAD
  if ($LASTEXITCODE -ne 0) { throw "git archive fallo." }
  $mount = $archive.Replace('\', '/')
  & docker run --rm -v "${mount}:/tmp/checkout.tar:ro" postgres:16.14-alpine3.24 sh -c @'
set -eu
mkdir -p "/tmp/checkout con espacios"
tar -xf /tmp/checkout.tar -C "/tmp/checkout con espacios"
repo="/tmp/checkout con espacios"
for script in scripts/deploy.sh ops/deploy.sh ops/rollback.sh ops/prepare-photo-storage.sh ops/smoke.sh; do
  [ -x "$repo/$script" ] || { echo "$script no es ejecutable en checkout Linux" >&2; exit 1; }
  sh -n "$repo/$script"
done
for script in ops/deployment-state.sh ops/deployment-audit.sh ops/secret-file.sh; do
  [ ! -x "$repo/$script" ] || { echo "$script sourced no debe ser ejecutable" >&2; exit 1; }
  sh -n "$repo/$script"
done
cd /tmp
sh "$repo/scripts/test-rsp07f-r5-posix.sh" "$repo"
echo RSP07F_R7_LINUX_CHECKOUT_OK
'@
  if ($LASTEXITCODE -ne 0) { throw "La validacion del checkout Linux fallo." }
} finally {
  $fullTemp = [IO.Path]::GetFullPath($tempRoot)
  $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($fullTemp.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase) -and
      [IO.Path]::GetFileName($fullTemp) -eq $ProjectName) {
    Remove-Item -LiteralPath $fullTemp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
