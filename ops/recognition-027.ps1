# Narrow, fail-closed recognition of the initial 027 pre-maintenance incident.
. (Join-Path $PSScriptRoot 'deployment-audit.ps1')
. (Join-Path $PSScriptRoot 'validation-027.ps1')

function Assert-Rsp027PrivatePath([string]$Root,[string]$Path){
  $base=[IO.Path]::GetFullPath($Root).TrimEnd('\')
  $full=[IO.Path]::GetFullPath($Path)
  if($base -notmatch '^[A-Za-z]:\\' -or $full.Substring(2).Contains(':') -or
    ($full -ine $base -and -not $full.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase))){throw '027: evidencia fuera del directorio privado autorizado.'}
  # Reject junctions/symlinks in every existing component, including ancestors.
  $cursor=$full
  while($cursor){
    if(Test-Path -LiteralPath $cursor){
      $item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
      if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw '027: enlaces/reparse points no permitidos en evidencia privada.'}
      if($cursor.Length -ge $base.Length){
        $acl=Get-Acl -LiteralPath $cursor -ErrorAction Stop
        $broad=@('S-1-1-0','S-1-5-11','S-1-5-32-545','S-1-5-32-546','S-1-5-7')
        $write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
        if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -in $broad){throw '027: propietario de evidencia no restringido.'}
        foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
          if($rule.IdentityReference.Value -in $broad -and $rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $write)){throw '027: evidencia permite escritura a grupos no restringidos.'}
        }
      }
    }
    $cursor=[IO.Path]::GetDirectoryName($cursor)
  }
}
function Get-Rsp027FileHash([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()}
function Write-Rsp027NewFile([string]$Path,[byte[]]$Bytes){
  $stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$stream.Write($Bytes,0,$Bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
function Write-Rsp027NewJson([string]$Path,$Value){
  Write-Rsp027NewFile $Path ([Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $Value -Depth 12)))
}
function Get-Rsp027RecognitionPaths([string]$StateDir,[string]$Project){
  if($Project -cne 'rsp-pilot'){throw '027: reconocimiento limitado al proyecto autorizado.'}
  $dir=(Resolve-Path -LiteralPath $StateDir -ErrorAction Stop).Path
  $base=Join-Path $dir "deploy-$Project"
  foreach($path in @($dir,"$base.json","$base.027-claim.json","$base.027-recognition.json","$base.027-consumed.json")){Assert-Rsp027PrivatePath $dir $path}
  return @{directory=$dir;original="$base.json";claim="$base.027-claim.json";record="$base.027-recognition.json";consumed="$base.027-consumed.json"}
}
function Read-Rsp027Json([string]$Path){
  try{$value=[IO.File]::ReadAllText($Path) | ConvertFrom-Json -ErrorAction Stop}catch{throw "027: evidencia ausente o ilegible: $Path"}
  if($null -eq $value -or $value -is [array]){throw '027: evidencia JSON no es un objeto.'}
  return $value
}
function Assert-Rsp027RecordedIncident([string]$AuditPath,[string]$Hash,[string]$Project,[string]$DeploymentStateFile){
  if($Hash -cnotmatch '^[a-f0-9]{64}$' -or (Get-Rsp027FileHash $AuditPath) -cne $Hash){throw '027: hash de incidente incompatible.'}
  $audit=Read-DeploymentAuditForRollback $AuditPath $Project $DeploymentStateFile
  if($audit.status -cne 'failed' -or $audit.validation_027 -cne 'pending' -or
    $audit.validation_026 -eq 'pending' -or $audit.phase_started -cne 'preflight' -or
    $audit.phase_completed -cne 'preflight' -or $audit.database_recovery -cne 'not_required' -or
    $audit.deployment_state_persisted -ne $false -or $audit.backup_bundle -ne '' -or
    -not $audit.rollback_noop -or $audit.backup_completed -or
    $audit.recovery_public_blocked -ne $false -or $audit.recovery_maintenance_verified -ne $false -or
    $null -eq $audit.PSObject.Properties['recovery_errors'] -or @($audit.recovery_errors).Count -ne 0){
    throw '027: incidente no elegible; requiere revision manual de otra fase.'
  }
  $state=Read-DeploymentState $DeploymentStateFile
  foreach($id in @($audit.previous_api_id,$audit.previous_front_id)){
    if($id -cnotmatch '^sha256:[a-f0-9]{64}$'){throw '027: faltan identidades originales verificables.'}
  }
  if([string]::IsNullOrWhiteSpace($audit.failure) -or $audit.recognition_027){throw '027: falta motivo original o ya es un reintento reconocido.'}
  if($state.GitSha -cne $audit.previous_git_sha -or $state.ConfigHash -cne $audit.previous_config_hash){throw '027: deployment state anterior cambio.'}
  return $audit
}
function Assert-Rsp027IncidentEvidence($Audit,[string]$DeploymentStateFile,[string]$PreviousStateFile,[string]$PreviousAuditFile,[string]$LogFile){
  if((Get-Rsp027FileHash $DeploymentStateFile) -cne (Get-Rsp027FileHash $PreviousStateFile)){throw '027: copia del state anterior no coincide.'}
  $prior=Read-DeploymentAuditForRollback $PreviousAuditFile $Audit.project $DeploymentStateFile
  if($prior.status -ne 'success' -or $prior.validation_026 -ne 'passed' -or
    $prior.git_sha -cne $Audit.previous_git_sha -or $prior.target_config_hash -cne $Audit.previous_config_hash){throw '027: falta cierre 026 coherente.'}
  $log=[IO.File]::ReadAllText($LogFile)
  $start=[regex]::Matches($log,'(?m)^\[([^\]]+)\] deploy_start target=(\S+) config=([a-f0-9]{64})\r?$')
  if($start.Count -ne 1 -or $start[0].Groups[2].Value -cne $Audit.target_version -or
    $start[0].Groups[3].Value -cne $Audit.target_config_hash){throw '027: log no corresponde al incidente.'}
  $when=[DateTimeOffset]::Parse($start[0].Groups[1].Value)
  if($when -lt [DateTimeOffset]::Parse($Audit.started_at_utc) -or $when -gt [DateTimeOffset]::Parse($Audit.updated_at_utc)){throw '027: fecha del log incompatible.'}
  if($log -notmatch '(?m)^DEPLOY_FAILED\r?$' -or $log -notmatch '(?m)^ROLLBACK_NOT_REQUIRED=' -or
    $log -notmatch '(?m)^\[[^\]]+\] deploy_start ' -or
    $log -match '(?m)^\[[^\]]+\] (maintenance_start|photo_storage_start|backup_start|migrate_start|services_start)|(?m)^DEPLOY_OK\r?$|(?m)^RECOVERY_PUBLIC_BLOCKED=true'){
    throw '027: log no demuestra un fallo previo al mantenimiento.'
  }
}
function Get-Rsp027RecognitionFacts([string[]]$ComposeArguments,$Audit,[string]$MigrationDir){
  if($Audit.project -cne 'rsp-pilot'){throw '027: proyecto no autorizado.'}
  $other=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {$_.ProcessId -ne $PID -and $_.CommandLine -match '(deploy|backup|restore-full|rollback|acknowledge-027-preflight)\.ps1'})
  if($other.Count){throw '027: otra operacion activa; no reconocer ni consumir.'}
  if(-not (Test-Rsp027Upgrade $ComposeArguments $MigrationDir)){throw '027: ya aplicada.'}
  Assert-Rsp027Services $ComposeArguments
  Assert-Rsp026Images $ComposeArguments $Audit.previous_git_sha $Audit.previous_api_ref $Audit.previous_front_ref
  $containers=@()
  foreach($service in @('api','front','proxy','postgres')){
    $id=(& docker compose @ComposeArguments ps -q $service | Out-String).Trim()
    if($LASTEXITCODE -ne 0 -or -not $id){throw '027: servicio no identificado.'}
    $raw=(& docker inspect $id | Out-String)
    if($LASTEXITCODE -ne 0){throw '027: inspeccion de servicio fallida.'}
    $parsed=@($raw | ConvertFrom-Json -ErrorAction Stop)
    if(-not $raw.Trim().StartsWith('[') -or $parsed.Count -ne 1){throw '027: inspeccion de servicio ambigua.'}
    $c=$parsed[0]
    if($c.Id -cnotmatch '^[a-f0-9]{64}$' -or $c.Image -cnotmatch '^sha256:[a-f0-9]{64}$' -or
      $c.State.Status -cne 'running' -or $c.State.Health.Status -cne 'healthy'){throw '027: identidad/salud no verificable.'}
    if($c.Config.Labels.'com.docker.compose.project' -cne $Audit.project -or
      $c.Config.Labels.'com.docker.compose.service' -cne $service -or
      [DateTimeOffset]::Parse($c.State.StartedAt) -ge [DateTimeOffset]::Parse($Audit.started_at_utc)){
      throw '027: servicio reiniciado o identidad incompatible con incidente.'
    }
    if(($service -eq 'api' -and $c.Image -cne $Audit.previous_api_id) -or
      ($service -eq 'front' -and $c.Image -cne $Audit.previous_front_id)){throw '027: imagen anterior incompatible.'}
    $containers+=@{service=$service;id=$c.Id;image=$c.Image;started=$c.State.StartedAt}
  }
  foreach($service in @('maintenance','smoke-proxy')){
    $ids=(& docker ps -a -q --filter "label=com.docker.compose.project=$($Audit.project)" --filter "label=com.docker.compose.service=$service" | Out-String).Trim()
    if($LASTEXITCODE -ne 0 -or $ids){throw '027: mantenimiento/proxy privado presente o no verificable.'}
  }
  $running=(& docker ps -q --filter "label=com.docker.compose.project=$($Audit.project)" | Out-String).Trim() -split '\s+'
  if($LASTEXITCODE -ne 0 -or @($running | Where-Object {$_}).Count -ne 4){throw '027: servicios u operaciones adicionales presentes.'}
  return @{ledger='000-026';checksums='passed';prefiltro_exists=$false;containers=$containers;checked_at_utc=[DateTime]::UtcNow.ToString('o')}
}
function New-Rsp027Recognition([string]$StateDir,[string]$Project,[string]$DeploymentStateFile,[string[]]$ComposeArguments,[string]$MigrationDir,[string]$IncidentSha256,[string]$Operator,[string]$Reason,[string]$NewGitSha,[string]$Confirm,[string]$PreviousStateFile,[string]$PreviousAuditFile,[string]$LogFile){
  $p=Get-Rsp027RecognitionPaths $StateDir $Project
  if($Confirm -cne 'VERIFIED_NO_PRODUCTIVE_CHANGES' -or [string]::IsNullOrWhiteSpace($Operator) -or [string]::IsNullOrWhiteSpace($Reason)){throw '027: requiere operador, motivo y confirmacion expresa.'}
  Assert-DeploymentGitSha $NewGitSha
  foreach($path in @($p.claim,$p.record,$p.consumed)){if(Test-Path -LiteralPath $path){throw '027: reconocimiento previo/incompleto; revision manual obligatoria.'}}
  $audit=Assert-Rsp027RecordedIncident $p.original $IncidentSha256 $Project $DeploymentStateFile
  if($NewGitSha -in @($audit.git_sha,$audit.previous_git_sha)){throw '027: se requiere un nuevo SHA definitivo.'}
  Assert-Rsp027IncidentEvidence $audit $DeploymentStateFile $PreviousStateFile $PreviousAuditFile $LogFile
  $facts=Get-Rsp027RecognitionFacts $ComposeArguments $audit $MigrationDir
  $id=[Guid]::NewGuid().ToString('N')
  # This durable claim is never removed automatically, even if archival fails.
  Write-Rsp027NewJson $p.claim @{format=1;id=$id;project=$Project;incident_sha256=$IncidentSha256;target_sha=$NewGitSha}
  $archive=Join-Path $p.directory "incident-027-$id"
  if(Test-Path -LiteralPath $archive){throw '027: archivo historico ya existe.'}
  [IO.Directory]::CreateDirectory($archive)|Out-Null
  $files=@()
  foreach($pair in @(@($p.original,'audit.json'),@($PreviousStateFile,'previous-state.env'),@($PreviousAuditFile,'previous-audit.json'),@($LogFile,'incident.log'))){
    $destination=Join-Path $archive $pair[1]
    Assert-Rsp027PrivatePath $p.directory $destination
    $bytes=[IO.File]::ReadAllBytes($pair[0]);Write-Rsp027NewFile $destination $bytes
    $hash=Get-Rsp027FileHash $destination
    if($hash -cne (Get-Rsp027FileHash $pair[0])){throw '027: evidencia cambio durante archivo.'}
    $files+=@{name=$pair[1];path=$destination;sha256=$hash}
  }
  if((Get-Rsp027FileHash $p.original) -cne $IncidentSha256 -or $files[0].sha256 -cne $IncidentSha256){throw '027: incidente alterado durante archivo.'}
  if((Get-Rsp027FileHash $DeploymentStateFile) -cne $files[1].sha256){throw '027: state cambio durante archivo.'}
  $record=@{format=1;kind='initial-027-pre-maintenance';id=$id;project=$Project;incident_path=$p.original;incident_sha256=$IncidentSha256;source_sha=$audit.previous_git_sha;failed_target_sha=$audit.git_sha;target_sha=$NewGitSha;deployment_state=[IO.Path]::GetFullPath($DeploymentStateFile);state_sha256=(Get-Rsp027FileHash $DeploymentStateFile);operator=$Operator;reason=$Reason;confirmed=$Confirm;recognized_at_utc=[DateTime]::UtcNow.ToString('o');files=$files;facts=$facts}
  Write-Rsp027NewJson $p.record $record
  return @{path=$p.record;sha256=(Get-Rsp027FileHash $p.record);archive=$archive}
}
function Read-Rsp027Recognition([string]$StateDir,[string]$Project,[string]$RecordFile,[string]$RecordSha256,[string]$GitSha,[string]$DeploymentStateFile){
  Assert-DeploymentGitSha $GitSha
  $p=Get-Rsp027RecognitionPaths $StateDir $Project
  if([IO.Path]::GetFullPath($RecordFile) -cne $p.record -or $RecordSha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-Rsp027FileHash $RecordFile) -cne $RecordSha256){throw '027: reconocimiento/hash no corresponde.'}
  $r=Read-Rsp027Json $RecordFile;$claim=Read-Rsp027Json $p.claim
  if($r.format -ne 1 -or $r.kind -cne 'initial-027-pre-maintenance' -or $r.id -cnotmatch '^[a-f0-9]{32}$' -or
    $r.project -cne $Project -or $r.target_sha -cne $GitSha -or $r.incident_path -cne $p.original -or
    $claim.id -cne $r.id -or $claim.project -cne $Project -or $claim.incident_sha256 -cne $r.incident_sha256 -or $claim.target_sha -cne $GitSha -or
    $r.deployment_state -cne [IO.Path]::GetFullPath($DeploymentStateFile) -or $r.state_sha256 -cne (Get-Rsp027FileHash $DeploymentStateFile) -or
    $r.confirmed -cne 'VERIFIED_NO_PRODUCTIVE_CHANGES' -or [string]::IsNullOrWhiteSpace($r.operator) -or [string]::IsNullOrWhiteSpace($r.reason)){
    throw '027: reconocimiento incompatible con incidente, proyecto, state o SHA.'
  }
  if(($r.files.name -join ',') -cne 'audit.json,previous-state.env,previous-audit.json,incident.log'){throw '027: inventario de evidencia incompleto.'}
  foreach($f in $r.files){
    $expected=Join-Path (Join-Path $p.directory "incident-027-$($r.id)") $f.name
    Assert-Rsp027PrivatePath $p.directory $expected
    if($f.path -cne $expected -or (Get-Rsp027FileHash $f.path) -cne $f.sha256){throw '027: evidencia archivada alterada.'}
  }
  if($r.files[0].sha256 -cne $r.incident_sha256){throw '027: archivo original no coincide.'}
  return $r
}
function Use-Rsp027Recognition([string]$StateDir,[string]$Project,[string]$RecordFile,[string]$RecordSha256,[string]$GitSha,[string]$DeploymentStateFile,[string[]]$ComposeArguments,[string]$MigrationDir){
  $p=Get-Rsp027RecognitionPaths $StateDir $Project
  if(Test-Path -LiteralPath $p.consumed){throw '027: reconocimiento consumido; revision manual obligatoria.'}
  $r=Read-Rsp027Recognition $StateDir $Project $RecordFile $RecordSha256 $GitSha $DeploymentStateFile
  $audit=Assert-Rsp027RecordedIncident $p.original $r.incident_sha256 $Project $DeploymentStateFile
  if($r.source_sha -cne $audit.previous_git_sha -or $r.failed_target_sha -cne $audit.git_sha -or $GitSha -in @($audit.previous_git_sha,$audit.git_sha)){throw '027: identidades de reconocimiento incompatibles.'}
  Assert-Rsp027IncidentEvidence $audit $DeploymentStateFile $r.files[1].path $r.files[2].path $r.files[3].path
  $facts=Get-Rsp027RecognitionFacts $ComposeArguments $audit $MigrationDir
  # No record is reusable after this CreateNew, including truncated receipts/crashes.
  Read-Rsp027Recognition $StateDir $Project $RecordFile $RecordSha256 $GitSha $DeploymentStateFile | Out-Null
  Assert-Rsp027RecordedIncident $p.original $r.incident_sha256 $Project $DeploymentStateFile | Out-Null
  $attempt=Join-Path $p.directory "deploy-$Project.027-attempt-$($r.id).json"
  Assert-Rsp027PrivatePath $p.directory $attempt
  if(Test-Path -LiteralPath $attempt){throw '027: auditoria de intento ya existe.'}
  $receipt=@{format=1;project=$Project;id=$r.id;record=$p.record;record_sha256=$RecordSha256;incident=$p.original;incident_sha256=$r.incident_sha256;archived_incident=$r.files[0].path;attempt=$attempt;target_sha=$GitSha;consumed_at_utc=[DateTime]::UtcNow.ToString('o');operator=$r.operator;reason=$r.reason;facts=$facts}
  Write-Rsp027NewJson $p.consumed $receipt
  return $receipt
}
function Resolve-Rsp027DeploymentAudit([string]$StateDir,[string]$Project){
  $canonical=Join-Path $StateDir "deploy-$Project.json"
  # Other projects keep the existing audit layout and behavior.
  if($Project -cne 'rsp-pilot'){return $canonical}
  $p=Get-Rsp027RecognitionPaths $StateDir $Project
  if(-not(Test-Path -LiteralPath $p.consumed)){return $canonical}
  $receipt=Read-Rsp027Json $p.consumed
  $expected=Join-Path $p.directory "deploy-$Project.027-attempt-$($receipt.id).json"
  if($receipt.format -ne 1 -or $receipt.project -cne $Project -or $receipt.id -cnotmatch '^[a-f0-9]{32}$' -or
    $receipt.attempt -cne $expected -or -not(Test-Path -LiteralPath $expected) -or
    $receipt.incident -cne $p.original -or (Get-Rsp027FileHash $p.original) -cne $receipt.incident_sha256 -or
    $receipt.record -cne $p.record -or (Get-Rsp027FileHash $p.record) -cne $receipt.record_sha256){throw '027: consumo incompleto/alterado; revision manual obligatoria.'}
  $archive=Join-Path (Join-Path $p.directory "incident-027-$($receipt.id)") 'audit.json'
  Assert-Rsp027PrivatePath $p.directory $archive
  Assert-Rsp027PrivatePath $p.directory $expected
  if($receipt.archived_incident -cne $archive -or (Get-Rsp027FileHash $archive) -cne $receipt.incident_sha256){throw '027: archivo historico alterado.'}
  $next=Read-Rsp027Json $expected
  if($next.recognition_027.record_sha256 -cne $receipt.record_sha256 -or $next.recognition_027.incident_sha256 -cne $receipt.incident_sha256){throw '027: nueva auditoria sin vinculo verificable.'}
  return $expected
}

function New-Rsp027AttemptAudit($Receipt,$Audit,[string]$StateDir,[string]$Project){
  $p=Get-Rsp027RecognitionPaths $StateDir $Project
  $record=Read-Rsp027Json $p.record
  if($record.id -cnotmatch '^[a-f0-9]{32}$'){throw '027: identidad de reconocimiento invalida.'}
  $archived=Join-Path (Join-Path $p.directory "incident-027-$($record.id)") 'audit.json'
  if($Receipt.archived_incident -cne $archived){throw '027: archivo historico incompatible.'}
  Assert-Rsp027PrivatePath $p.directory $archived
  if((Get-Rsp027FileHash $p.record) -cne $Receipt.record_sha256 -or
    (Get-Rsp027FileHash $p.original) -cne $Receipt.incident_sha256 -or
    (Get-Rsp027FileHash $Receipt.archived_incident) -cne $Receipt.incident_sha256){throw '027: evidencia cambio antes de abrir auditoria.'}
  $expected=Join-Path $p.directory "deploy-$Project.027-attempt-$($record.id).json"
  if($Receipt.attempt -cne $expected -or $Audit.git_sha -cne $record.target_sha){throw '027: auditoria nueva incompatible.'}
  Assert-Rsp027PrivatePath $p.directory $expected
  # Unlike subsequent atomic updates, the first publication must never replace a file.
  Write-Rsp027NewJson $expected $Audit
}
