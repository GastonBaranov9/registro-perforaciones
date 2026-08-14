if(-not (Get-Command Assert-DeploymentImageRef -ErrorAction SilentlyContinue)){
  . (Join-Path $PSScriptRoot "deployment-state.ps1")
}

$script:DeploymentAuditPhases=[ordered]@{none=0;preflight=1;maintenance=2;backup=3;images=4;migrate=5;services=6;health=7;smoke=8;persist_state=9;complete=10}

function Write-DeploymentAuditAtomic{
  param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)]$Audit)
  $full=[IO.Path]::GetFullPath($Path);$parent=[IO.Path]::GetDirectoryName($full)
  if(-not [IO.Directory]::Exists($parent)){throw "El directorio del audit no existe."}
  $temp=Join-Path $parent (".{0}.{1}.tmp"-f [IO.Path]::GetFileName($full),[Guid]::NewGuid().ToString('N'))
  $backup=Join-Path $parent (".{0}.{1}.bak"-f [IO.Path]::GetFileName($full),[Guid]::NewGuid().ToString('N'))
  try{
    $Audit.updated_at_utc=[DateTime]::UtcNow.ToString('o')
    [IO.File]::WriteAllText($temp,($Audit|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    Get-Content -Raw -LiteralPath $temp|ConvertFrom-Json|Out-Null
    if([IO.File]::Exists($full)){[IO.File]::Replace($temp,$full,$backup)}else{[IO.File]::Move($temp,$full)}
  }finally{if([IO.File]::Exists($temp)){[IO.File]::Delete($temp)};if([IO.File]::Exists($backup)){[IO.File]::Delete($backup)}}
}

function Start-DeploymentAuditPhase{
  param([Parameter(Mandatory=$true)]$Audit,[Parameter(Mandatory=$true)][string]$Phase,[Parameter(Mandatory=$true)][string]$Path)
  if(-not $script:DeploymentAuditPhases.Contains($Phase)-or $Phase-eq 'none'){throw "Fase de deploy desconocida."}
  $Audit.phase_started=$Phase;Write-DeploymentAuditAtomic $Path $Audit
}

function Complete-DeploymentAuditPhase{
  param([Parameter(Mandatory=$true)]$Audit,[Parameter(Mandatory=$true)][string]$Phase,[Parameter(Mandatory=$true)][string]$Path)
  if($Audit.phase_started-ne $Phase){throw "No se puede completar una fase no iniciada."}
  $Audit.phase_completed=$Phase;Write-DeploymentAuditAtomic $Path $Audit
}

function Read-DeploymentAuditForRollback{
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$ProjectName,
    [Parameter(Mandatory=$true)][string]$DeploymentStateFile
  )
  $resolved=(Resolve-Path -LiteralPath $Path).Path
  try{$audit=Get-Content -Raw -LiteralPath $resolved|ConvertFrom-Json}catch{throw "Audit de deploy malformado o truncado."}
  foreach($name in @('format','project','started_at_utc','updated_at_utc','status','phase_started','phase_completed','database_recovery','deployment_state','previous_config_hash','previous_api_ref','previous_api_id','previous_front_ref','previous_front_id','previous_version','previous_git_sha','target_config_hash','target_api_ref','target_front_ref','target_version','git_sha','backup_bundle','deployment_state_persisted')){
    if($null-eq $audit.PSObject.Properties[$name]){throw "Audit incompleto: falta $name."}
  }
  if($audit.format-ne 3-or $audit.project-ne $ProjectName){throw "Audit no corresponde al formato/proyecto esperado."}
  if([string]$audit.status-notin @('started','failed','success')){throw "Estado de audit no reconocido."}
  if([string]$audit.database_recovery-notin @('not_required','operator_assessment_required','restore_required')){throw "Clasificacion DB del audit no reconocida."}
  $started=[string]$audit.phase_started;$completed=[string]$audit.phase_completed
  if(-not $script:DeploymentAuditPhases.Contains($started)-or-not $script:DeploymentAuditPhases.Contains($completed)-or $script:DeploymentAuditPhases[$completed]-gt $script:DeploymentAuditPhases[$started]){throw "Fases del audit invalidas."}
  try{[DateTimeOffset]::Parse([string]$audit.started_at_utc)|Out-Null;[DateTimeOffset]::Parse([string]$audit.updated_at_utc)|Out-Null}catch{throw "Timestamps del audit invalidos."}
  if([IO.Path]::GetFullPath([string]$audit.deployment_state)-ne [IO.Path]::GetFullPath($DeploymentStateFile)){throw "El deployment state del audit no coincide con el indicado."}
  Assert-DeploymentImageRef ([string]$audit.previous_api_ref);Assert-DeploymentImageRef ([string]$audit.previous_front_ref);Assert-DeploymentImageRef ([string]$audit.target_api_ref);Assert-DeploymentImageRef ([string]$audit.target_front_ref)
  Assert-DeploymentIdentifier 'APP_VERSION' ([string]$audit.previous_version);Assert-DeploymentIdentifier 'GIT_SHA' ([string]$audit.previous_git_sha);Assert-DeploymentIdentifier 'TARGET_VERSION' ([string]$audit.target_version);Assert-DeploymentIdentifier 'TARGET_GIT_SHA' ([string]$audit.git_sha)
  foreach($id in @([string]$audit.previous_api_id,[string]$audit.previous_front_id)){if($id-notmatch '^sha256:[a-f0-9]{64}$'){throw "Audit sin image ID previo valido."}}
  $previousHash=Get-DeploymentConfigHash $audit.previous_api_ref $audit.previous_front_ref $audit.previous_version $audit.previous_git_sha
  $targetHash=Get-DeploymentConfigHash $audit.target_api_ref $audit.target_front_ref $audit.target_version $audit.git_sha
  if($audit.previous_config_hash-cne $previousHash-or $audit.target_config_hash-cne $targetHash){throw "Checksum de configuracion corrupto en audit."}
  if($audit.deployment_state_persisted-isnot [bool]){throw "Indicador de persistencia invalido."}
  $backupCompleted=$script:DeploymentAuditPhases[$completed]-ge $script:DeploymentAuditPhases.backup
  if($backupCompleted-and [string]$audit.backup_bundle-notmatch '^rsp-backup-\d{8}T\d{6}Z$'){throw "Audit completo de backup sin bundle valido."}
  $noOp=([string]$audit.status-ne 'success'-and $script:DeploymentAuditPhases[$started]-le $script:DeploymentAuditPhases.preflight)
  $requiresFull=([string]$audit.database_recovery-eq 'restore_required')
  $audit|Add-Member -Force NoteProperty rollback_noop $noOp
  $audit|Add-Member -Force NoteProperty rollback_requires_full $requiresFull
  $audit|Add-Member -Force NoteProperty backup_completed $backupCompleted
  return $audit
}
