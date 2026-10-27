# Synthetic evidence only. Never accepts the production project or private paths.
function New-Recognition027Fixture([string]$Root,[string]$Project,[string]$State,[string]$OldSha,[string]$FailedSha){
  $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $full=[IO.Path]::GetFullPath($Root)
  if(-not $full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or $Project -notmatch '^rsp07f-r3-(recognition|mock)$' -or
    -not ([IO.Path]::GetFullPath($State)).StartsWith($temp,[StringComparison]::OrdinalIgnoreCase)){throw 'Synthetic fixture only'}
  [IO.Directory]::CreateDirectory($full)|Out-Null
  Write-DeploymentStateAtomic $State "fixture-api:$OldSha" "fixture-front:$OldSha" old $OldSha | Out-Null
  $before=Read-DeploymentState $State
  $audit=[ordered]@{format=3;project=$Project;started_at_utc='2026-10-20T10:00:00Z';updated_at_utc='2026-10-20T10:01:00Z';status='failed';phase_started='preflight';phase_completed='preflight';database_recovery='not_required';deployment_state=$State;deployment_state_persisted=$false;previous_config_hash=$before.ConfigHash;previous_api_ref=$before.ApiImage;previous_api_id=('sha256:'+('c'*64));previous_front_ref=$before.FrontImage;previous_front_id=('sha256:'+('c'*64));previous_version='old';previous_git_sha=$OldSha;target_config_hash=(Get-DeploymentConfigHash "fixture-api:$FailedSha" "fixture-front:$FailedSha" failed $FailedSha);target_api_ref="fixture-api:$FailedSha";target_front_ref="fixture-front:$FailedSha";target_version='failed';git_sha=$FailedSha;backup_bundle='';validation_026='not_required';validation_027='pending';failure='027: etiqueta SHA de imagen objetivo incompatible.';recovery_public_blocked=$false;recovery_maintenance_verified=$false}
  $prior=$audit | ConvertTo-Json -Depth 10 | ConvertFrom-Json
  $audit.recovery_errors=@()
  $prior.status='success';$prior.phase_started='complete';$prior.phase_completed='complete';$prior.validation_026='passed';$prior.validation_027='not_required';$prior.deployment_state_persisted=$true
  $prior.git_sha=$OldSha;$prior.target_api_ref=$before.ApiImage;$prior.target_front_ref=$before.FrontImage;$prior.target_version='old';$prior.target_config_hash=$before.ConfigHash;$prior.backup_bundle='rsp-backup-20261019T100000Z'
  $paths=@{audit=(Join-Path $full "deploy-$Project.json");previous=(Join-Path $full 'previous-audit.json');state=(Join-Path $full 'previous-state.env');log=(Join-Path $full 'incident.log')}
  [IO.File]::WriteAllText($paths.audit,($audit | ConvertTo-Json -Depth 10))
  [IO.File]::WriteAllText($paths.previous,($prior | ConvertTo-Json -Depth 10))
  [IO.File]::WriteAllBytes($paths.state,[IO.File]::ReadAllBytes($State))
  [IO.File]::WriteAllText($paths.log,"[2026-10-20T10:00:01Z] deploy_start target=failed config=$($audit.target_config_hash)`nDEPLOY_FAILED`nROLLBACK_NOT_REQUIRED=$($paths.audit)`n")
  return $paths
}
