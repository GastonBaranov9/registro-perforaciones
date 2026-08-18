param([string]$ProjectName="rsp07f-r5-contracts-$PID")
$ErrorActionPreference="Stop"
if($ProjectName-notmatch '^rsp07f-r5-contracts-[A-Za-z0-9-]+$'){throw "ProjectName inseguro."}

$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $repo 'ops/deployment-state.ps1')
. (Join-Path $repo 'ops/deployment-audit.ps1')

$temp=Join-Path ([IO.Path]::GetTempPath()) "$ProjectName-$([Guid]::NewGuid().ToString('N'))"
[IO.Directory]::CreateDirectory($temp)|Out-Null
$statePath=Join-Path $temp 'deployment.env'
$auditPath=Join-Path $temp 'audit.json'
$envPath=Join-Path $temp 'production.env'
$passwordPath=Join-Path $temp 'admin-password'
$backupPath=Join-Path $temp 'backups'
[IO.Directory]::CreateDirectory($backupPath)|Out-Null
[IO.File]::WriteAllText($envPath,"RSP_R5_FIXTURE=1`n",[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($passwordPath,"fixture-only",[Text.UTF8Encoding]::new($false))

$apiN='example/api:n';$frontN='example/front:n';$apiN1='example/api:n1';$frontN1='example/front:n1'
$shaN='abc123';$shaN1='def456';$validBundle='rsp-backup-20260818T120000Z'

function New-Audit{
  param(
    [string]$Status,
    [string]$Started,
    [string]$Completed,
    [string]$DbRecovery,
    [string]$Bundle=$validBundle,
    [bool]$WithIds=$true
  )
  [ordered]@{
    format=3;project=$ProjectName;started_at_utc='2026-08-18T12:00:00.0000000Z';updated_at_utc='2026-08-18T12:01:00.0000000Z'
    status=$Status;phase_started=$Started;phase_completed=$Completed;database_recovery=$DbRecovery;deployment_state=$statePath
    deployment_state_persisted=($Completed-in @('persist_state','complete'));previous_config_hash=(Get-DeploymentConfigHash $apiN $frontN 'n' $shaN)
    previous_api_ref=$apiN;previous_api_id=$(if($WithIds){'sha256:'+'a'*64}else{''});previous_front_ref=$frontN
    previous_front_id=$(if($WithIds){'sha256:'+'b'*64}else{''});previous_version='n';previous_git_sha=$shaN
    target_config_hash=(Get-DeploymentConfigHash $apiN1 $frontN1 'n1' $shaN1);target_api_ref=$apiN1;target_front_ref=$frontN1
    target_version='n1';git_sha=$shaN1;backup_bundle=$Bundle
  }
}

function Assert-Rejected([scriptblock]$Action,[string]$Name){
  $rejected=$false
  try{&$Action|Out-Null}catch{$rejected=$true}
  if(-not $rejected){throw "No se rechazo $Name."}
}

try{
  Write-DeploymentStateAtomic $statePath $apiN $frontN 'n' $shaN|Out-Null

  $preflight=New-Audit failed preflight none not_required '' $false
  Write-DeploymentAuditAtomic $auditPath $preflight
  $read=Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath
  if(-not $read.rollback_noop-or $read.rollback_requires_full-or $read.backup_completed){throw 'Preflight sin IDs no fue clasificado como no-op.'}

  $invalidPhase=New-Audit failed alien none not_required '' $false
  Write-DeploymentAuditAtomic $auditPath $invalidPhase
  Assert-Rejected {Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath} 'fase desconocida'

  $applicationWithoutIds=New-Audit failed services services operator_assessment_required $validBundle $false
  Write-DeploymentAuditAtomic $auditPath $applicationWithoutIds
  Assert-Rejected {Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath} 'rollback de aplicacion sin IDs'

  $application=New-Audit failed services services operator_assessment_required
  Write-DeploymentAuditAtomic $auditPath $application
  $read=Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath
  if($read.rollback_noop-or $read.rollback_requires_full-or-not $read.backup_completed){throw 'Rollback de aplicacion valido fue mal clasificado.'}

  $restoreWithoutBackup=New-Audit failed services services restore_required ''
  Write-DeploymentAuditAtomic $auditPath $restoreWithoutBackup
  Assert-Rejected {Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath} 'restore requerido sin backup'

  $restore=New-Audit failed services services restore_required
  Write-DeploymentAuditAtomic $auditPath $restore
  $read=Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath
  if(-not $read.rollback_requires_full-or-not $read.backup_completed){throw 'Restore completo valido fue mal clasificado.'}

  $success=New-Audit success complete complete operator_assessment_required
  Write-DeploymentAuditAtomic $auditPath $success
  $read=Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath
  if($read.rollback_noop-or $read.rollback_requires_full-or-not $read.backup_completed){throw 'Audit success cambio de comportamiento.'}

  $invalidNoOp=New-Audit failed preflight none not_required '' $false
  $invalidNoOp.previous_api_ref=''
  Write-DeploymentAuditAtomic $auditPath $invalidNoOp
  Assert-Rejected {Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath} 'no-op sin referencia previa'

  $preflight=New-Audit failed preflight none not_required '' $false
  Write-DeploymentAuditAtomic $auditPath $preflight
  function docker{throw 'El rollback no-op intento invocar Docker.'}
  try{
    $rollback=& (Join-Path $repo 'ops/rollback.ps1') -EnvFile $envPath -DeploymentStateFile $statePath -ProjectName $ProjectName -StateFile $auditPath -Level Application -Confirm DATABASE_BACKWARD_COMPATIBLE -BackupDir $backupPath -SmokeAdminEmail 'fixture@example.test' -SmokeAdminPasswordFile $passwordPath
  }finally{Remove-Item function:docker -ErrorAction SilentlyContinue}
  if($rollback-notcontains 'ROLLBACK_NOT_REQUIRED'){throw 'Rollback PowerShell no devolvio ROLLBACK_NOT_REQUIRED.'}

  $bash=(Get-Command bash.exe -ErrorAction Stop).Source
  $posixScript=(Join-Path $repo 'scripts/test-rsp07f-r5-posix.sh').Replace('\','/')
  $repoUnix=$repo.Replace('\','/')
  $posix=(&$bash $posixScript $repoUnix|Out-String).Trim()
  if($LASTEXITCODE-ne 0-or $posix-notmatch 'RSP07F_R5_POSIX_OK'){throw "Contratos POSIX R5 fallaron: $posix"}

  [pscustomobject]@{
    launcher_repo_root=$true;launcher_subdirectory=$true;launcher_external_cwd=$true;launcher_args_exact=$true
    preflight_empty_ids_noop=$true;unknown_phase_rejected=$true;application_ids_required=$true
    restore_backup_required=$true;success_preserved=$true;rollback_noop_without_docker=$true
    powershell_posix_equivalent=$true
  }|ConvertTo-Json -Compress
}finally{
  $full=[IO.Path]::GetFullPath($temp);$system=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if($full.StartsWith($system,[StringComparison]::OrdinalIgnoreCase)-and [IO.Path]::GetFileName($full)-like 'rsp07f-r5-contracts-*'){
    Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue
  }
}
