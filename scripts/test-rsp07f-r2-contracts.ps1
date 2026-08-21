param([string]$ProjectName="rsp07f-r2-contracts-$PID")
$ErrorActionPreference="Stop"
if($ProjectName-notmatch '^rsp07f-r2-contracts-[A-Za-z0-9-]+$'){throw "ProjectName inseguro."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $repo 'ops/deployment-state.ps1');. (Join-Path $repo 'ops/deployment-audit.ps1');. (Join-Path $repo 'ops/secret-file.ps1')
$temp=Join-Path ([IO.Path]::GetTempPath()) "$ProjectName-$([Guid]::NewGuid().ToString('N'))";[IO.Directory]::CreateDirectory($temp)|Out-Null
$statePath=Join-Path $temp 'deployment.env';$auditPath=Join-Path $temp 'audit.json';$secretPath=Join-Path $temp 'secret';$jsonPath=Join-Path $temp 'login.json'
$shaN='a'*40;$shaN1='b'*40;$apiN="example/api:$shaN";$frontN="example/front:$shaN";$apiN1="example/api:$shaN1";$frontN1="example/front:$shaN1"
function New-Audit([string]$Status,[string]$Started,[string]$Completed,[string]$DbRecovery,[string]$Bundle='rsp-backup-20260814T120000Z'){
  [ordered]@{format=3;project=$ProjectName;started_at_utc='2026-08-14T12:00:00.0000000Z';updated_at_utc='2026-08-14T12:01:00.0000000Z';status=$Status;phase_started=$Started;phase_completed=$Completed;database_recovery=$DbRecovery;deployment_state=$statePath;deployment_state_persisted=($Completed-in @('persist_state','complete'));previous_config_hash=(Get-DeploymentConfigHash $apiN $frontN 'n' $shaN);previous_api_ref=$apiN;previous_api_id=('sha256:'+'a'*64);previous_front_ref=$frontN;previous_front_id=('sha256:'+'b'*64);previous_version='n';previous_git_sha=$shaN;target_config_hash=(Get-DeploymentConfigHash $apiN1 $frontN1 'n1' $shaN1);target_api_ref=$apiN1;target_front_ref=$frontN1;target_version='n1';git_sha=$shaN1;backup_bundle=$Bundle}
}
function Assert-Rejected([scriptblock]$Action,[string]$Name){$rejected=$false;try{&$Action|Out-Null}catch{$rejected=$true};if(-not $rejected){throw "No se rechazo $Name."}}
try{
  Write-DeploymentStateAtomic $statePath $apiN $frontN 'n' $shaN|Out-Null
  $success=New-Audit success complete complete operator_assessment_required;Write-DeploymentAuditAtomic $auditPath $success;$read=Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath;if($read.rollback_noop-or $read.rollback_requires_full){throw 'Audit success invalido.'}
  $preflight=New-Audit failed preflight preflight not_required '';Write-DeploymentAuditAtomic $auditPath $preflight;$read=Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath;if(-not $read.rollback_noop){throw 'Preflight failed no fue no-op.'}
  $switched=New-Audit failed services services operator_assessment_required;Write-DeploymentAuditAtomic $auditPath $switched;$read=Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath;if($read.rollback_requires_full){throw 'Switch compatible no permitio evaluacion humana.'}
  $incompatible=New-Audit failed services services restore_required;Write-DeploymentAuditAtomic $auditPath $incompatible;$read=Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath;if(-not $read.rollback_requires_full-or-not $read.backup_completed){throw 'Incompatible no exigio restore.'}
  $persisted=New-Audit failed persist_state persist_state operator_assessment_required;$persisted.deployment_state_persisted=$true;Write-DeploymentAuditAtomic $auditPath $persisted;(Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath)|Out-Null
  $missingBackup=New-Audit failed services services restore_required '';Write-DeploymentAuditAtomic $auditPath $missingBackup;Assert-Rejected {Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath} 'backup requerido ausente'
  [IO.File]::WriteAllText($auditPath,'{"format":3',[Text.UTF8Encoding]::new($false));Assert-Rejected {Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath} 'audit truncado'
  $bad=New-Audit failed services services operator_assessment_required;$bad.previous_config_hash='0'*64;Write-DeploymentAuditAtomic $auditPath $bad;Assert-Rejected {Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath} 'checksum corrupto'
  $bad=New-Audit failed alien backup not_required;Write-DeploymentAuditAtomic $auditPath $bad;Assert-Rejected {Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath} 'fase desconocida'
  $bad=New-Audit failed services services operator_assessment_required;$bad.previous_api_ref='';Write-DeploymentAuditAtomic $auditPath $bad;Assert-Rejected {Read-DeploymentAuditForRollback $auditPath $ProjectName $statePath} 'ref N ausente'

  $cases=@(
    @{name='plain';value='Password123!';suffix=''},@{name='leading';value=' Password123!';suffix=''},@{name='trailing';value='Password123! ';suffix=''},@{name='both';value=' Password123! ';suffix=''},
    @{name='lf';value='Password123! ';suffix="`n"},@{name='crlf';value='Password123! ';suffix="`r`n"},@{name='two-spaces';value='Password123!  ';suffix="`n"},@{name='unicode-tab';value="`tContraseña Segura! ";suffix="`n"},@{name='spaces';value='        ';suffix=''}
  )
  $bash=(Get-Command bash.exe -ErrorAction Stop).Source;$posixScript=(Join-Path $repo 'scripts/test-secret-file-posix.sh').Replace('\','/');$repoUnix=$repo.Replace('\','/');$secretUnix=$secretPath.Replace('\','/');$jsonUnix=$jsonPath.Replace('\','/')
  foreach($case in $cases){[IO.File]::WriteAllText($secretPath,$case.value+$case.suffix,[Text.UTF8Encoding]::new($false));$ps=Read-OpaqueSecretFile $secretPath;if($ps-cne $case.value){throw "PowerShell altero password $($case.name)."};$output=(&$bash $posixScript $repoUnix $secretUnix $jsonUnix|Out-String);if($LASTEXITCODE-ne 0-or $output){throw "POSIX filtro salida para $($case.name)."};$posix=[IO.File]::ReadAllText($jsonPath,[Text.UTF8Encoding]::new($false));if($posix-cne $case.value-or $posix-cne $ps){throw "POSIX altero password $($case.name)."}}
  $restore=[IO.File]::ReadAllText((Join-Path $repo 'ops/restore.sh'));if($restore-notmatch 'DATABASE_SHA256'-or $restore-notmatch 'PHOTOS_SHA256'-or $restore-notmatch 'MIGRATIONS'){throw 'Restore no valida manifest/checksums/migrations.'}
  [pscustomobject]@{success_audit=$true;failed_preflight_noop=$true;failed_switch_application=$true;failed_incompatible_full=$true;failed_persisted_state=$true;invalid_audits_rejected=5;password_cases=$cases.Count;password_output_leak=$false;powershell_posix_exact=$true}|ConvertTo-Json -Compress
}finally{$full=[IO.Path]::GetFullPath($temp);$system=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());if($full.StartsWith($system,[StringComparison]::OrdinalIgnoreCase)-and [IO.Path]::GetFileName($full)-like 'rsp07f-r2-contracts-*'){Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue}}
