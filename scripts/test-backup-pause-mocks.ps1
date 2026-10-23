# No Docker daemon access: exercise the actual PowerShell backup wrapper.
$ErrorActionPreference='Stop'
$root=Join-Path ([IO.Path]::GetTempPath()) ('rsp-backup-mocks-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory((Join-Path $root 'ops'))|Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../ops/backup.ps1') -Destination (Join-Path $root 'ops')
foreach($name in @('fixture.env','docker-compose.production.yaml')){[IO.File]::WriteAllText((Join-Path $root $name),'fixture')}
function docker {
  $global:LASTEXITCODE=0
  $line=$args -join ' ';$global:BackupPauseEvents.Add($line)
  if($line -match 'ps --status running -q api'){
    if($global:BackupPauseCase -eq 'status-error'){$global:LASTEXITCODE=1;return}
    if($global:BackupPauseCase -eq 'initially-running'){'fixture-api'}
    return
  }
  if($line -match 'ps -a -q api'){'fixture-api';return}
  if($line -match '^inspect'){
    if($global:BackupPauseCase -eq 'inspect-error'){$global:LASTEXITCODE=1;return}
    if($global:BackupPauseCase -eq 'not-stopped'){'true'}else{'false'}
    return
  }
  if($line -match 'run --rm backup'){
    if($global:BackupPauseCase -eq 'backup-error'){$global:LASTEXITCODE=23;return}
    'BACKUP_VERIFIED_FULL=fixture';return
  }
  if($line -match 'stop api|up -d --wait --wait-timeout 180 api'){return}
  throw "Unexpected mocked command: $line"
}
try {
  foreach($global:BackupPauseCase in @('stopped','initially-running','status-error','inspect-error','not-stopped','backup-error')){
    $global:BackupPauseEvents=[Collections.Generic.List[string]]::new();$failed=$false
    try{& (Join-Path $root 'ops/backup.ps1') -EnvFile (Join-Path $root 'fixture.env') -ProjectName rsp-backup-mock -BackupDir (Join-Path $root 'backup')|Out-Null}catch{$failed=$true}
    if($failed -ne ($global:BackupPauseCase -notin @('stopped','initially-running'))){throw "Wrong result: $global:BackupPauseCase"}
    $log=$global:BackupPauseEvents -join "`n"
    if($global:BackupPauseCase -in @('status-error','inspect-error','not-stopped') -and $log -match 'run --rm backup'){throw 'Backup without confirmed pause'}
    if($global:BackupPauseCase -ne 'initially-running' -and $log -match 'up -d'){throw 'Wrapper reopened deploy pause'}
    if($global:BackupPauseCase -eq 'initially-running' -and ($log -notmatch 'stop api' -or $log -notmatch 'up -d')){throw 'Standalone pause not restored'}
    "PASS backup-pause/$global:BackupPauseCase"
  }
  'BACKUP_PAUSE_MOCKS_OK 6/6'
}finally{
  Remove-Item Function:\docker -ErrorAction SilentlyContinue
  $full=[IO.Path]::GetFullPath($root);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if($full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($full) -like 'rsp-backup-mocks-*'){Remove-Item -LiteralPath $full -Recurse -Force}
}
