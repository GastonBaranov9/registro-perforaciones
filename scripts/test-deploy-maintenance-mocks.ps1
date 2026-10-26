# Executes only temporary copies with fail-closed Docker and smoke mocks.
param([switch]$BackupOnly,[switch]$Validation026Only)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$root=Join-Path ([IO.Path]::GetTempPath()) ('rsp-deploy-mocks-'+[guid]::NewGuid().ToString('N'))
$ops=Join-Path $root 'ops'
[IO.Directory]::CreateDirectory($ops)|Out-Null
$utf8=[Text.UTF8Encoding]::new($false)
foreach($name in @('deploy.ps1','deployment-state.ps1','deployment-audit.ps1','smoke-proxy.compose.yaml','validation-026.ps1')){Copy-Item -LiteralPath (Join-Path $repo "ops/$name") -Destination $ops}
if($Validation026Only){
  # Only the temporary copy recognizes the fictitious project as RSP production.
  $deployCopy=Join-Path $ops 'deploy.ps1'
  [IO.File]::WriteAllText($deployCopy,[IO.File]::ReadAllText($deployCopy).Replace("if(`$ProjectName -eq 'rsp-pilot')","if(`$ProjectName -eq 'rsp07f-r3-mock')"),$utf8)
  # Mock I/O, retaining the actual conservation, chain and policy assertions.
  [IO.File]::AppendAllText((Join-Path $ops 'validation-026.ps1'),@'

function Test-Rsp026Upgrade { return $true }
function Assert-Rsp026Ledger { }
function Get-Rsp026Snapshot {
  if(-not $global:DeployMockMaintenance){throw '026 snapshot outside maintenance'}
  $s=$global:DeployMockSnapshot | ConvertTo-Json -Depth 12 | ConvertFrom-Json
  if($global:DeployMockCriticalPassed){
    $global:DeployMockEvents.Add('026-after-smoke')
    $s.ledger+=,[pscustomobject]@{version='026'}
    switch($global:DeployMockFailure){
      '026-counter' {$s.counter.proximo=3283}
      '026-max' {$s.counter.mayor_asignado=3282}
      '026-reserves' {$s.protected.reservas='changed'}
      '026-permission' {$s.authorized=@()}
      '026-chain' {$s.chain.reservation=19}
    }
  }else{
    if($global:DeployMockStates['api-id'] -ne 'exited'){throw '026 baseline while API is running'}
    $global:DeployMockEvents.Add('026-baseline')
  }
  return $s
}
function Get-Rsp026Policy {
  $p=[pscustomobject]@{revision=1;rangos=@(@{desde=1;hasta=3281});excepciones=@();history=0;protected1=$true;protected3281=$true;protected3282=$false}
  if($global:DeployMockFailure -eq '026-policy'){$p.rangos[0].hasta=3280}
  if($global:DeployMockFailure -eq '026-exception'){$p.excepciones=@(300)}
  return $p
}
function Assert-Rsp026Images {
  if($global:DeployMockFailure -eq '026-images'){throw '026 image incompatible'}
  $global:DeployMock026Passed=$true
  $global:DeployMockEvents.Add('026-complete')
}
'@,$utf8)
  $global:DeployMockSnapshot=[pscustomobject]@{
    ledger=@([pscustomobject]@{version='025'});counter=@{proximo=3282;mayor_asignado=3281}
    authorized=@(1);admin1=$true;protected=@{reservas='unchanged';historicos='unchanged'}
    chain=@{active=0;reservation=31;deleted31=1;edges=@(@{from=19;to=29;number=3277},@{from=29;to=31;number=3277});references=@(@{id='19';number='3277'},@{id='29';number='3277'},@{id='31';number='3277'})}
  }
}
$auditCopy=Join-Path $ops 'deployment-audit.ps1'
$auditSource=[IO.File]::ReadAllText($auditCopy).Replace('function Write-DeploymentAuditAtomic{','function Write-MockUnderlyingAudit{')
$auditSource+=@'

function Write-DeploymentAuditAtomic($Path,$Audit){
  $global:DeployMockEvents.Add("audit/$($Audit.status)/$($Audit.phase_started)")
  if($global:DeployMockFailure -eq 'public-audit' -and $Audit.status -eq 'failed'){throw [IO.IOException]::new('Mock disk full during recovery audit')}
  if($Audit.phase_started -eq 'complete'){
    if($global:DeployMockFailure -eq 'audit-space'){throw [IO.IOException]::new('Mock disk full')}
    if($global:DeployMockFailure -eq 'audit-permission'){throw [UnauthorizedAccessException]::new('Mock access denied')}
  }
  Write-MockUnderlyingAudit $Path $Audit
}
'@
[IO.File]::WriteAllText($auditCopy,$auditSource,$utf8)
foreach($name in @('production.env','docker-compose.production.yaml','password')){[IO.File]::WriteAllText((Join-Path $root $name),'fixture-only',$utf8)}
[IO.File]::WriteAllText((Join-Path $ops 'prepare-photo-storage.ps1'),"'PHOTO_STORAGE_READY DB_LEDGER=present'",$utf8)
[IO.File]::WriteAllText((Join-Path $ops 'backup.ps1'),@'
if(-not $global:DeployMockMaintenance -or $global:DeployMockStates['api-id'] -ne 'exited'){throw 'Backup without paused writes'}
$global:DeployMockEvents.Add('backup-verified')
if($global:DeployMockFailure -in @('backup-dump','backup-copy','backup-integrity','backup-missing')){throw "Backup failure: $global:DeployMockFailure"}
'BACKUP_BUNDLE=rsp-backup-20261021T000000Z'
if($global:DeployMockFailure -ne 'backup-unverified'){'BACKUP_VERIFIED_FULL=rsp-backup-20261021T000000Z'}
'@,$utf8)
[IO.File]::WriteAllText((Join-Path $ops 'smoke.ps1'),@'
param($EnvFile,$DeploymentStateFile,$ProjectName,$AdminEmail,$AdminPasswordFile,$ComposeFile,$ConnectPort,$TlsCaFile,[switch]$PublicOnly,[switch]$Validate026)
if($PublicOnly){
  $global:DeployMockEvents.Add('public-smoke')
  if(-not $global:DeployMockCriticalPassed){throw 'Opened before internal checks'}
  if($global:DeployMockFailure -like 'public*'){throw 'Public failure'}
  'PUBLIC_SMOKE_OK'
}else{
  $global:DeployMockEvents.Add('internal-smoke')
  if(-not $global:DeployMockMaintenance -or $ConnectPort -ne 18443){throw 'Internal isolation missing'}
  if($global:DeployMockFailure -eq 'smoke'){throw 'Critical smoke failure'}
  $global:DeployMockCriticalPassed=$true
  'SMOKE_OK'
  if($Validate026 -and $global:DeployMockFailure -ne '026-api-missing'){'SMOKE_026_API_OK'}
}
'@,$utf8)
. (Join-Path $ops 'deployment-state.ps1')
$oldSha='a'*40;$newSha='b'*40
$state=Join-Path $root 'deployment.env'
function docker {
  $a=@($args|ForEach-Object{[string]$_});$line=$a -join ' '
  $global:LASTEXITCODE=0
  $global:DeployMockEvents.Add($line)
  if($a[0] -eq 'image' -and $a[1] -eq 'inspect'){'sha256:'+('c'*64);return}
  if($a[0] -eq 'inspect'){
    $target=$a[-1]
    if($line.Contains('.State.Status')){
      if($global:DeployMockFailure -eq 'public-unverified' -and $target -eq 'proxy-id'){$global:LASTEXITCODE=1;'Mock inspect unavailable';return}
      $s=$global:DeployMockStates[$target]
      if($line.Contains('.State.Health')){"$s/healthy"}else{$s}
      return
    }
    if($line.Contains('.Config.Image')){if($target -eq 'api-id'){"fixture-api:$oldSha"}else{"fixture-front:$oldSha"};return}
    if($line.Contains('.Config.Env')){'APP_VERSION=old';return}
    if($line.Contains('.Image')){'sha256:'+('c'*64);return}
    throw "Unknown inspect: $line"
  }
  if($a[0] -eq 'ps'){
    if($line -notmatch 'label=com.docker.compose.project=rsp07f-r3-mock'){throw 'Wrong recovery project'}
    ($a[-1].Replace('label=com.docker.compose.service=','')+'-id');return
  }
  if($a[0] -eq 'stop'){
    if($a[-1] -eq 'proxy-id' -and ($global:DeployMockFailure -eq 'public-stop-all' -or ($global:DeployMockFailure -eq 'public-first-stop' -and $a -contains '10'))){$global:LASTEXITCODE=1;'Mock stop failed';return}
    if($global:DeployMockFailure -eq 'public-unverified' -and $a[-1] -eq 'proxy-id'){return} # False-positive stop result.
    $global:DeployMockStates[$a[-1]]='exited';return
  }
  if($a[0] -ne 'compose'){throw "Forbidden Docker command: $line"}
  if($line -match 'config --format json'){
    $ds=Read-DeploymentState $state
    @{services=@{api=@{image=$ds.ApiImage;environment=@{APP_VERSION=$ds.AppVersion;GIT_SHA=$ds.GitSha}};front=@{image=$ds.FrontImage}}}|ConvertTo-Json -Depth 5 -Compress
    return
  }
  if($a -contains 'ps'){($a[-1]+'-id');return}
  if($a -contains 'stop'){
    $global:DeployMockStates[($a[-1]+'-id')]='exited'
    if($a[-1] -eq 'maintenance'){
      if(-not $global:DeployMockCriticalPassed){throw 'Premature maintenance removal'}
      if($Validation026Only -and -not $global:DeployMock026Passed){throw 'Premature reopening before 026'}
      $global:DeployMockMaintenance=$false
    }
    return
  }
  if($a -contains 'up'){
    if($a[-1] -eq 'maintenance'){
      if($a -contains '--no-recreate' -and $global:DeployMockFailure -eq 'public-maintenance-fail'){$global:LASTEXITCODE=1;'Mock maintenance start failed';return}
      $global:DeployMockMaintenance=$true;$global:DeployMockStates['maintenance-id']='running';return
    }
    if($a[-1] -eq 'front' -and $global:DeployMockFailure -eq 'services'){throw 'Services failure'}
    if($a[-1] -eq 'smoke-proxy' -and $global:DeployMockFailure -eq 'private-proxy'){throw 'Private proxy failure'}
    if($a[-1] -eq 'proxy' -and -not $global:DeployMockCriticalPassed){throw 'Premature public start'}
    if($a[-1] -eq 'proxy' -and $Validation026Only -and -not $global:DeployMock026Passed){throw 'Public start before 026'}
    $global:DeployMockStates[($a[-1]+'-id')]='running'
    return
  }
  if($a -contains 'run'){
    if(-not $global:DeployMockMaintenance){throw 'Migration without maintenance'}
    if($global:DeployMockFailure -eq 'migrate'){throw 'Migration failure'}
    return
  }
  if(($a -contains 'config') -or ($a -contains 'build') -or ($a -contains 'rm')){return}
  throw "Unexpected Docker command: $line"
}
try{
  $cases=@('success','maintenance','photo_storage','backup','images','migrate','services','private-proxy','health','smoke','persist_state','public',
    'public-audit','audit-space','audit-permission','public-first-stop','public-stop-all','public-unverified','public-maintenance-fail')
  $backupCases=@('backup-dump','backup-copy','backup-integrity','backup-missing','backup-unverified')
  if($BackupOnly){$cases=@('success')+$backupCases}else{$cases+=$backupCases}
  if($Validation026Only){$cases=@('success','026-counter','026-max','026-reserves','026-permission','026-chain','026-policy','026-exception','026-images','026-api-missing')}
  foreach($case in $cases){
    $mockAudit=Join-Path $root 'state/deploy-rsp07f-r3-mock.json'
    if(Test-Path -LiteralPath $mockAudit){Remove-Item -LiteralPath $mockAudit}
    Write-DeploymentStateAtomic $state "fixture-api:$oldSha" "fixture-front:$oldSha" old $oldSha|Out-Null
    $global:DeployMockEvents=[Collections.Generic.List[string]]::new()
    $global:DeployMockMaintenance=$false;$global:DeployMockCriticalPassed=$false;$global:DeployMockFailure=$case
    $global:DeployMock026Passed=$false
    $global:DeployMockStates=@{'proxy-id'='running';'api-id'='running';'front-id'='running';'maintenance-id'='exited';'smoke-proxy-id'='exited'}
    $phase=if($case -in @('maintenance','photo_storage','backup','images','health','persist_state')){$case}else{''}
    $failed=$false;$failure=$null;$output=[Collections.Generic.List[string]]::new()
    $deployArguments=@{EnvFile=(Join-Path $root 'production.env');DeploymentStateFile=$state;ProjectName='rsp07f-r3-mock';BackupDir=(Join-Path $root 'backup');StateDir=(Join-Path $root 'state');TargetApiImage="fixture-api:$newSha";TargetFrontImage="fixture-front:$newSha";TargetVersion='new';GitSha=$newSha;SmokeAdminEmail='fixture@example.test';SmokeAdminPasswordFile=(Join-Path $root 'password');BuildImages=$true;TestFailAfterPhase=$phase}
    try{
      & (Join-Path $ops 'deploy.ps1') @deployArguments 3>&1 | ForEach-Object {$output.Add([string]$_)}
    }catch{$failed=$true;$failure=$_}
    if($failed -ne ($case -ne 'success')){throw "Unexpected result: $case; $failure"}
    if($case -notin @('success','public-maintenance-fail') -and -not $global:DeployMockMaintenance){throw "Maintenance not attempted: $case"}
    . (Join-Path $ops 'deployment-audit.ps1')
    $audit=Read-DeploymentAuditForRollback (Join-Path $root 'state/deploy-rsp07f-r3-mock.json') 'rsp07f-r3-mock' $state
    if($audit.rollback_noop){throw "Recovery incorrectly classified as no-op: $case"}
    $events=$global:DeployMockEvents -join "`n"
    if($Validation026Only){
      if($events.IndexOf('026-baseline') -lt $events.IndexOf('backup-verified')){throw 'Baseline before verified backup'}
      if($events.IndexOf('run --rm migrate') -lt $events.IndexOf('026-baseline')){throw 'Migration before baseline'}
      if($case -eq 'success'){
        if($events.IndexOf('026-after-smoke') -lt $events.IndexOf('internal-smoke') -or $events.IndexOf('stop maintenance') -lt $events.IndexOf('026-complete')){throw 'Incorrect 026 gate ordering'}
        if($audit.validation_026 -ne 'passed'){throw '026 validation not recorded'}
      }else{
        if($audit.validation_026 -ne 'pending'){throw 'Failed 026 validation recorded as passed'}
        $eventCount=$global:DeployMockEvents.Count;$retryError=$null
        try{& (Join-Path $ops 'deploy.ps1') @deployArguments | Out-Null}catch{$retryError=$_}
        if(-not $retryError -or $retryError.Exception.Message -notmatch 'validacion anterior pendiente' -or $global:DeployMockEvents.Count -ne $eventCount){throw 'Retry bypassed pending 026 evidence'}
      }
    }
    if($case -in $backupCases -and ($events -match 'run --rm migrate' -or $global:DeployMockStates['api-id'] -ne 'exited')){throw "Backup failure allowed migration/writes: $case"}
    if($case -notlike 'public*' -and $case -notin @('success','audit-space','audit-permission') -and $events -match 'stop maintenance|up .*180 proxy'){throw "Premature reopening: $case"}
    if($case -eq 'success' -and ($global:DeployMockMaintenance -or $events -notmatch 'public-smoke')){throw 'Success did not complete'}
    if($case -in @('smoke','health','persist_state') -and $events -notmatch 'stop --time 10 smoke-proxy-id'){throw 'Private proxy not stopped'}
    if($failed){
      $text=$output -join "`n"
      if($text -match 'DEPLOY_OK'){throw 'Failure declared success'}
      $unsafe=$case -in @('public-stop-all','public-unverified')
      if($failure.Exception.Data['UrgentManualIntervention'] -ne $unsafe){throw "Wrong urgent status: $case"}
      if($unsafe -and ($text -notmatch 'RECOVERY_CRITICAL' -or $text -match 'RECOVERY_PUBLIC_BLOCKED=true' -or $global:DeployMockStates['api-id'] -ne 'exited')){throw 'Unsafe state not reported/contained'}
      if(-not $unsafe -and $text -notmatch 'RECOVERY_PUBLIC_BLOCKED=true'){throw "Missing verified closure: $case"}
      $recoveryStart=$events.IndexOf('ps -a -q --filter')
      $recoveryEvents=$events.Substring($recoveryStart)
      if($recoveryEvents -match 'stop maintenance|up .*180 proxy'){throw 'Recovery reopened public access'}
      if($events.LastIndexOf('audit/failed') -lt $events.LastIndexOf('inspect --format {{.State.Status}} proxy-id')){throw 'Audit preceded containment verification'}
      if($case -like 'public*' -and $failure.Exception.Message -ne 'Public failure'){throw 'Original error lost'}
      if($case -eq 'public-audit' -and ($failure.Exception.Data['RecoveryErrors'] -join ' ') -notmatch 'audit:.*disk full'){throw 'Secondary error lost'}
      if($case -in @('audit-space','audit-permission') -and $failure.Exception.Message -notmatch 'Mock (disk full|access denied)'){throw 'Original audit failure lost'}
      if($case -eq 'public-first-stop' -and ($recoveryEvents -notmatch 'stop --time 0 proxy-id' -or $recoveryEvents -notmatch 'up .*maintenance')){throw 'Fallback actions missing'}
      if($case -eq 'smoke' -and $recoveryEvents -match 'up .*maintenance|stop --time \d+ proxy-id'){throw 'Already safe maintenance was unnecessarily changed'}
    }
    Write-Output "PASS maintenance/$case"
  }
  Write-Output "DEPLOY_MOCKS_OK $($cases.Count)/$($cases.Count); no real Docker commands"
}finally{
  Remove-Item Function:\docker -ErrorAction SilentlyContinue
  $full=[IO.Path]::GetFullPath($root);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if($full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($full) -like 'rsp-deploy-mocks-*'){Remove-Item -LiteralPath $full -Recurse -Force}
}
