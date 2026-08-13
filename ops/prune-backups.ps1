param(
  [Parameter(Mandatory = $true)][string]$BackupDir,
  [switch]$Apply
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path $BackupDir).Path

function Read-Manifest {
  param([string]$Directory)
  $manifestPath = Join-Path $Directory "manifest.txt"
  if (-not [IO.File]::Exists($manifestPath)) { return $null }
  $values = @{}
  foreach ($line in [IO.File]::ReadAllLines($manifestPath)) {
    $separator = $line.IndexOf('=')
    if ($separator -lt 1) { return $null }
    $key = $line.Substring(0, $separator)
    if ($values.ContainsKey($key)) { return $null }
    $values[$key] = $line.Substring($separator + 1)
  }
  return $values
}

$valid = @()
foreach ($directory in Get-ChildItem -LiteralPath $root -Directory) {
  if ($directory.Name -notmatch '^rsp-backup-\d{8}T\d{6}Z$') { continue }
  $manifest = Read-Manifest $directory.FullName
  if ($null -eq $manifest -or $manifest.RSP_BACKUP_FORMAT -ne '1' -or $manifest.STATUS -ne 'complete' -or $manifest.BUNDLE_ID -ne $directory.Name) { continue }
  if ($manifest.DATABASE_FILE -ne 'database.dump' -or $manifest.PHOTOS_FILE -ne 'photos.tar.gz') { continue }
  $db = Join-Path $directory.FullName $manifest.DATABASE_FILE
  $photos = Join-Path $directory.FullName $manifest.PHOTOS_FILE
  if (-not [IO.File]::Exists($db) -or -not [IO.File]::Exists($photos)) { continue }
  if ((Get-FileHash -LiteralPath $db -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.DATABASE_SHA256) { continue }
  if ((Get-FileHash -LiteralPath $photos -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.PHOTOS_SHA256) { continue }
  $created = [DateTime]::MinValue
  if (-not [DateTime]::TryParseExact($manifest.CREATED_AT_UTC, 'yyyy-MM-ddTHH:mm:ssZ', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal, [ref]$created)) { continue }
  $valid += [pscustomobject]@{ Name=$directory.Name; Path=$directory.FullName; Created=$created }
}

$ordered = @($valid | Sort-Object Created -Descending)
if ($ordered.Count -eq 0) { Write-Output "No hay bundles válidos reconocidos."; exit 0 }
$keep = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
[void]$keep.Add($ordered[0].Path)

$daily = [Collections.Generic.HashSet[string]]::new()
$weekly = [Collections.Generic.HashSet[string]]::new()
$monthly = [Collections.Generic.HashSet[string]]::new()
foreach ($item in $ordered) {
  $dayKey = $item.Created.ToString('yyyy-MM-dd')
  if ($daily.Count -lt 14 -and $daily.Add($dayKey)) { [void]$keep.Add($item.Path) }

  $monday = $item.Created.Date.AddDays(-(([int]$item.Created.DayOfWeek + 6) % 7))
  $weekKey = $monday.ToString('yyyy-MM-dd')
  if ($weekly.Count -lt 8 -and $weekly.Add($weekKey)) { [void]$keep.Add($item.Path) }

  $monthKey = $item.Created.ToString('yyyy-MM')
  if ($monthly.Count -lt 6 -and $monthly.Add($monthKey)) { [void]$keep.Add($item.Path) }
}

foreach ($item in $ordered) {
  if ($keep.Contains($item.Path)) { Write-Output "KEEP $($item.Name)"; continue }
  if (-not $Apply) { Write-Output "DRY-RUN PRUNE $($item.Name)"; continue }
  $resolved = [IO.Path]::GetFullPath($item.Path)
  if ([IO.Directory]::GetParent($resolved).FullName -ne $root -or ([IO.Path]::GetFileName($resolved) -notmatch '^rsp-backup-\d{8}T\d{6}Z$')) {
    throw "Ruta de prune fuera del directorio permitido."
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
  Write-Output "PRUNED $($item.Name)"
}
