# No production operations: temporary helper copies, synthetic evidence and fail-closed Docker mocks.
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$root=Join-Path ([IO.Path]::GetTempPath()) ('rsp-recognition027-'+[Guid]::NewGuid().ToString('N'))
$ops=Join-Path $root 'ops';[IO.Directory]::CreateDirectory($ops)|Out-Null
$utf8=[Text.UTF8Encoding]::new($false)
$project='rsp07f-r3-recognition';$old='a'*40;$failedSha='b'*40;$target='d'*40
foreach($name in @('recognition-027.ps1','deployment-audit.ps1','deployment-state.ps1','validation-026.ps1','validation-027.ps1')){
  $text=[IO.File]::ReadAllText((Join-Path $repo "ops/$name")).Replace("'rsp-pilot'","'$project'")
  [IO.File]::WriteAllText((Join-Path $ops $name),$text,$utf8)
}
. (Join-Path $ops 'recognition-027.ps1')
. (Join-Path $PSScriptRoot 'fixtures/recognition-027.ps1')
$realFacts=${function:Get-Rsp027RecognitionFacts};$realWrite=${function:Write-Rsp027NewFile}
function docker { throw 'Forbidden real Docker access in recognition tests' }
function Get-Rsp027RecognitionFacts { if($script:factsFail){throw 'Synthetic live-state discrepancy'};return @{ledger='000-026';checksums='passed';prefiltro_exists=$false} }
function Check([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Reject([scriptblock]$Action){$caught=$false;try{& $Action | Out-Null}catch{$caught=$true};Check $caught 'Expected rejection'}
function Fixture {
  $script:dir=Join-Path $root ([Guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($script:dir)|Out-Null
  $script:state=Join-Path $script:dir 'deployment.env'
  $script:f=New-Recognition027Fixture $script:dir $project $script:state $old $failedSha
  $script:p=Get-Rsp027RecognitionPaths $script:dir $project
  $script:hash=Get-Rsp027FileHash $script:f.audit
  $script:params=@{StateDir=$script:dir;Project=$project;DeploymentStateFile=$script:state;ComposeArguments=@('synthetic');MigrationDir='synthetic';IncidentSha256=$script:hash;Operator='fixture operator';Reason='synthetic pre-maintenance incident';NewGitSha=$target;Confirm='VERIFIED_NO_PRODUCTIVE_CHANGES';PreviousStateFile=$script:f.state;PreviousAuditFile=$script:f.previous;LogFile=$script:f.log}
  $script:factsFail=$false
}
function Recognize { $script:issued=New-Rsp027Recognition @script:params }
function Consume { Use-Rsp027Recognition $script:dir $project $script:issued.path $script:issued.sha256 $target $script:state @('synthetic') synthetic }
function ChangeAudit([scriptblock]$Change){$a=Read-Rsp027Json $script:f.audit;& $Change $a;[IO.File]::WriteAllText($script:f.audit,($a|ConvertTo-Json -Depth 10));$script:params.IncidentSha256=Get-Rsp027FileHash $script:f.audit}
$passed=0
function Case([string]$Name,[scriptblock]$Body){Fixture;& $Body;$script:passed++;Write-Output "PASS recognition/$Name"}
try{
  Case 'valid-archive-byte-identical-no-change-to-original' {
    Recognize;$r=Read-Rsp027Json $issued.path
    Check ((Get-Rsp027FileHash $f.audit) -ceq $hash) 'Original overwritten'
    Check ((Get-Rsp027FileHash $r.files[0].path) -ceq $hash) 'Archive differs'
    Check ($r.operator -ceq $params.Operator -and $r.target_sha -ceq $target -and $r.source_sha -ceq $old) 'Metadata missing'
    Check ((Read-Rsp027Json $f.audit).validation_027 -eq 'pending') 'Recognition fabricated success'
  }
  Case 'wrong-hash' {$params.IncidentSha256='0'*64;Reject {Recognize}}
  Case 'altered-incident' {[IO.File]::AppendAllText($f.audit,' ');Reject {Recognize}}
  Case 'missing-audit' {[IO.File]::Move($f.audit,$f.audit+'.saved');Reject {Recognize}}
  Case 'malformed-audit' {[IO.File]::WriteAllText($f.audit,'{');$params.IncidentSha256=Get-Rsp027FileHash $f.audit;Reject {Recognize}}
  foreach($phase in @('maintenance','backup','migrate','services','complete')){
    Case "reject-phase-$phase" {ChangeAudit {param($a) $a.phase_started=$phase};Reject {Recognize}}
  }
  Case 'not-failed' {ChangeAudit {param($a) $a.status='success'};Reject {Recognize}}
  Case 'not-pending' {ChangeAudit {param($a) $a.validation_027='passed'};Reject {Recognize}}
  Case 'state-persisted' {ChangeAudit {param($a) $a.deployment_state_persisted=$true};Reject {Recognize}}
  Case 'restore-required' {ChangeAudit {param($a) $a.database_recovery='restore_required'};Reject {Recognize}}
  Case 'backup-present' {ChangeAudit {param($a) $a.backup_bundle='rsp-backup-20261020T100000Z'};Reject {Recognize}}
  Case 'maintenance-observed' {ChangeAudit {param($a) $a.recovery_maintenance_verified=$true};Reject {Recognize}}
  Case 'missing-maintenance-evidence' {ChangeAudit {param($a) $a.PSObject.Properties.Remove('recovery_maintenance_verified')};Reject {Recognize}}
  Case 'recovery-errors' {ChangeAudit {param($a) $a.recovery_errors=@('unknown containment state')};Reject {Recognize}}
  Case 'log-maintenance' {[IO.File]::AppendAllText($f.log,"[2026-10-20T10:00:02Z] maintenance_start`n");Reject {Recognize}}
  Case 'log-wrong-incident' {[IO.File]::WriteAllText($f.log,([IO.File]::ReadAllText($f.log).Replace('target=failed','target=another')));Reject {Recognize}}
  Case 'changed-state' {[IO.File]::AppendAllText($state,"`n# changed`n");Reject {Recognize}}
  Case 'missing-previous-success' {[IO.File]::WriteAllText($f.previous,'{}');Reject {Recognize}}
  Case 'missing-original-image-id' {ChangeAudit {param($a) $a.previous_api_id=''};Reject {Recognize}}
  Case 'another-project' {$params.Project='rsp-other';Reject {Recognize}}
  Case 'production-project-forbidden-in-fixture' {Reject {New-Recognition027Fixture $dir 'rsp-pilot' $state $old $failedSha}}
  Case 'old-target-rejected' {$params.NewGitSha=$failedSha;Reject {Recognize}}
  Case 'explicit-confirmation-required' {$params.Confirm='';Reject {Recognize}}
  Case 'live-discrepancy' {$script:factsFail=$true;Reject {Recognize};Check (-not(Test-Path $p.claim)) 'Claim on failed checks'}
  Case 'absent-recognition' {Reject {Use-Rsp027Recognition $dir $project $p.record ('0'*64) $target $state @() synthetic}}
  Case 'different-sha' {Recognize;Reject {Use-Rsp027Recognition $dir $project $issued.path $issued.sha256 ('e'*40) $state @() synthetic}}
  Case 'changed-state-after-recognition' {Recognize;[IO.File]::AppendAllText($state,' ');Reject {Consume}}
  Case 'live-revalidation' {Recognize;$script:factsFail=$true;Reject {Consume};Check (-not(Test-Path $p.consumed)) 'Consumed despite failed live check'}
  Case 'changed-incident-after-recognition' {Recognize;[IO.File]::AppendAllText($f.audit,' ');Reject {Consume}}
  Case 'changed-archive' {Recognize;$r=Read-Rsp027Json $issued.path;[IO.File]::AppendAllText($r.files[0].path,' ');Reject {Consume}}
  Case 'changed-record' {Recognize;[IO.File]::AppendAllText($issued.path,' ');Reject {Consume}}
  Case 'single-use-before-new-audit' {Recognize;$receipt=Consume;Reject {Consume};Reject {Resolve-Rsp027DeploymentAudit $dir $project};Check ((Get-Rsp027FileHash $f.audit) -ceq $hash) 'Incident overwritten'}
  Case 'linked-audit-and-rollback-reader' {
    Recognize;$receipt=Consume;$a=Read-Rsp027Json $f.audit
    $a | Add-Member NoteProperty recognition_027 @{record_sha256=$receipt.record_sha256;incident_sha256=$receipt.incident_sha256}
    Write-DeploymentAuditAtomic $receipt.attempt $a
    Check ((Resolve-Rsp027DeploymentAudit $dir $project) -ceq $receipt.attempt) 'Link unresolved'
    Check ((Read-DeploymentAuditForRollback $receipt.attempt $project $state).rollback_noop) 'Rollback compatibility broken'
    Check ((Get-Rsp027FileHash $f.audit) -ceq $hash) 'Original changed'
    $a.recognition_027.incident_sha256='0'*64;Write-DeploymentAuditAtomic $receipt.attempt $a
    Reject {Resolve-Rsp027DeploymentAudit $dir $project}
  }
  Case 'crash-before-archive' {
    function Write-Rsp027NewFile([string]$Path,[byte[]]$Bytes){if($Path.EndsWith('audit.json')){throw 'Crash before archive'};& $realWrite $Path $Bytes}
    Reject {Recognize};Check (Test-Path $p.claim) 'No durable claim';Check (-not(Test-Path $p.record)) 'Incomplete record published';Reject {Recognize}
  }
  Case 'crash-after-archive' {
    function Write-Rsp027NewFile([string]$Path,[byte[]]$Bytes){if($Path.EndsWith('.027-recognition.json')){throw 'Crash before recognition publish'};& $realWrite $Path $Bytes}
    Reject {Recognize};$claim=Read-Rsp027Json $p.claim
    Check ((Get-Rsp027FileHash (Join-Path $dir "incident-027-$($claim.id)/audit.json")) -ceq $hash) 'Archive lost'
    Reject {Recognize}
  }
  Case 'truncated-consumption-blocks' {Recognize;[IO.File]::WriteAllText($p.consumed,'{');Reject {Consume};Reject {Resolve-Rsp027DeploymentAudit $dir $project}}
  Case 'operation-lock-exclusive' {$l=Open-DeploymentOperationLock $state;try{Reject {Open-DeploymentOperationLock $state}}finally{$l.Dispose()};$l=Open-DeploymentOperationLock $state;$l.Dispose()}
  Case 'path-traversal-rejected' {Reject {Assert-Rsp027PrivatePath $dir (Join-Path $dir '../outside.json')}}
  Case 'alternate-stream-rejected' {Reject {Assert-Rsp027PrivatePath $dir ($f.audit+':alternate')}}
  Case 'junction-root-rejected' {
    $link=Join-Path $root ('link-'+[Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Junction -Path $link -Target $dir | Out-Null
    try{Reject {Assert-Rsp027PrivatePath $link (Join-Path $link 'audit.json')}}finally{[IO.Directory]::Delete($link)}
  }
  Case 'junction-archive-rejected' {
    Recognize;$archive=$issued.archive;$moved=$archive+'-original'
    [IO.Directory]::Move($archive,$moved)
    New-Item -ItemType Junction -Path $archive -Target $moved | Out-Null
    try{Reject {Consume}}finally{[IO.Directory]::Delete($archive)}
  }
  Case 'broad-write-acl-rejected' {
    $original=Get-Acl -LiteralPath $dir;$unsafe=Get-Acl -LiteralPath $dir
    $sid=[Security.Principal.SecurityIdentifier]::new('S-1-1-0')
    $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::Write,[Security.AccessControl.AccessControlType]::Allow)
    $unsafe.AddAccessRule($rule);Set-Acl -LiteralPath $dir -AclObject $unsafe
    try{Reject {Recognize}}finally{Set-Acl -LiteralPath $dir -AclObject $original}
  }
  Case 'first-audit-created-once' {
    Recognize;$receipt=Consume;$a=Read-Rsp027Json $f.audit;$a.git_sha=$target
    New-Rsp027AttemptAudit $receipt $a $dir $project
    $created=Get-Rsp027FileHash $receipt.attempt
    Reject {New-Rsp027AttemptAudit $receipt $a $dir $project}
    Check ((Get-Rsp027FileHash $receipt.attempt) -ceq $created) 'Attempt overwritten'
  }
  Case 'existing-attempt-not-overwritten' {
    Recognize;$receipt=Consume;$a=Read-Rsp027Json $f.audit;$a.git_sha=$target
    [IO.File]::WriteAllText($receipt.attempt,'unexpected file');$created=Get-Rsp027FileHash $receipt.attempt
    Reject {New-Rsp027AttemptAudit $receipt $a $dir $project}
    Check ((Get-Rsp027FileHash $receipt.attempt) -ceq $created) 'Existing attempt overwritten'
  }
  Case 'evidence-changed-before-first-audit' {
    Recognize;$receipt=Consume;$a=Read-Rsp027Json $f.audit;$a.git_sha=$target
    [IO.File]::AppendAllText($receipt.archived_incident,' ')
    Reject {New-Rsp027AttemptAudit $receipt $a $dir $project}
    Check (-not(Test-Path $receipt.attempt)) 'Audit created from changed evidence'
  }
  Case 'two-consumers-one-durable-winner' {
    Recognize
    $child=Join-Path $dir 'consumer.ps1'
    $body=@'
param($Helper,$Dir,$Project,$Record,$Hash,$Sha,$State)
$ErrorActionPreference='Stop'
. $Helper
function docker {throw 'Real Docker forbidden'}
function Get-Rsp027RecognitionFacts {Start-Sleep -Milliseconds 300;return @{ledger='000-026'}}
try {Use-Rsp027Recognition $Dir $Project $Record $Hash $Sha $State @() synthetic | Out-Null;exit 0}catch{exit 7}
'@
    [IO.File]::WriteAllText($child,$body,$utf8)
    $argsText='-NoProfile -ExecutionPolicy Bypass -File "'+$child+'" "'+(Join-Path $ops 'recognition-027.ps1')+'" "'+$dir+'" '+$project+' "'+$issued.path+'" '+$issued.sha256+' '+$target+' "'+$state+'"'
    $si=[Diagnostics.ProcessStartInfo]::new('powershell.exe',$argsText);$si.UseShellExecute=$false;$si.CreateNoWindow=$true
    $one=[Diagnostics.Process]::Start($si);$two=[Diagnostics.Process]::Start($si)
    try{Check ($one.WaitForExit(15000) -and $two.WaitForExit(15000)) 'Consumer timeout';Check ((@($one.ExitCode,$two.ExitCode)|Sort-Object) -join ',' -eq '0,7') 'Consumption not exclusive'}finally{$one.Dispose();$two.Dispose()}
    Reject {Consume}
  }
  # Exercise real live-state control flow against JSON/ledger/health mocks; no Docker executable.
  function Test-Rsp027Upgrade {if($script:liveCase -eq 'applied'){throw '027 already applied'};if($script:liveCase -eq 'ledger'){throw 'Bad ledger checksum'};return $true}
  function Assert-Rsp027Services {if($script:liveCase -eq 'unhealthy'){throw 'Unhealthy'}}
  function Assert-Rsp026Images {if($script:liveCase -eq 'sha'){throw 'Wrong SHA'}}
  function Get-CimInstance {if($script:liveCase -eq 'concurrent'){return @{ProcessId=0;CommandLine='powershell deploy.ps1'}}}
  function docker {
    $a=@($args);$global:LASTEXITCODE=0
    if($a[0] -eq 'compose' -and $a -contains 'ps'){return $a[-1]}
    if($a[0] -eq 'inspect'){
      $service=$a[-1];$id='1'*64;$image='sha256:'+('c'*64);$start='2026-10-19T10:00:00Z'
      if($script:liveCase -eq 'image'){$image='sha256:'+('f'*64)}
      if($script:liveCase -eq 'restarted'){$start='2026-10-20T11:00:00Z'}
      $obj=@{Id=$id;Image=$image;Config=@{Labels=@{'com.docker.compose.project'=$project;'com.docker.compose.service'=$service}};State=@{Status='running';Health=@{Status='healthy'};StartedAt=$start}}
      if($script:liveCase -eq 'json'){return '{'}
      if($script:liveCase -eq 'ambiguous'){return ConvertTo-Json -InputObject @($obj,$obj) -Depth 8}
      if($script:liveCase -eq 'docker-error'){$global:LASTEXITCODE=1;return ''}
      return ConvertTo-Json -InputObject @($obj) -Depth 8
    }
    if($a[0] -eq 'ps'){
      if(($a -join ' ') -match 'service=') {if($script:liveCase -eq 'maintenance'){return 'container'};return}
      if($script:liveCase -eq 'extra'){return '1 2 3 4 5'};return '1 2 3 4'
    }
    throw 'Unexpected Docker command'
  }
  foreach($script:liveCase in @('valid','applied','ledger','unhealthy','sha','concurrent','image','restarted','json','ambiguous','docker-error','maintenance','extra')){
    Case "live-$script:liveCase" {$a=Read-Rsp027Json $f.audit;if($script:liveCase -eq 'valid'){& $realFacts @('synthetic') $a synthetic|Out-Null}else{Reject {& $realFacts @('synthetic') $a synthetic}}}
  }
  Write-Output "RECOGNITION_027_OK $passed/$passed; synthetic files only; no production access"
}finally{
  if(([IO.Path]::GetFullPath($root)).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($root) -like 'rsp-recognition027-*'){Remove-Item -LiteralPath $root -Recurse -Force}
}
