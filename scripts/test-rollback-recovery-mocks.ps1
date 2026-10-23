# Execute the actual rollback body/functions with closed mocks; never call Docker.
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'ops/rollback.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Rollback syntax invalid'}
$root=Join-Path ([IO.Path]::GetTempPath()) ('rsp-rollback-mocks-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root)|Out-Null
$utf8=[Text.UTF8Encoding]::new($false)
# Extract without executing preflight or importing external operational scripts.
$functions=$ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst]}
$body=$ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.TryStatementAst]}|Select-Object -Last 1
$source=($functions.Extent.Text -join "`n")+"`n"+$body.Extent.Text
[IO.File]::WriteAllText((Join-Path $root 'rollback-body.ps1'),$source,$utf8)
[IO.File]::WriteAllText((Join-Path $root 'smoke.ps1'),@'
$global:Events.Add('smoke')
if($global:Case -notin @('success','audit-space','audit-permission','state-write','log-fail')){throw 'Original smoke failure'}
'SMOKE_OK'
'@,$utf8)
function Write-DeploymentStateAtomic {
  $global:Events.Add('persist')
  if($global:Case -eq 'state-write'){throw 'Original state write failure'}
  [pscustomobject]@{ApiImage='old-api';FrontImage='old-front';AppVersion='old';GitSha='old-sha';ConfigHash='old-hash'}
}
function Write-DeploymentAuditAtomic($Path,$Audit){
  $global:Events.Add('audit/'+$Audit.rollback_status)
  if($global:Case -in @('audit-space','smoke-audit')){throw [IO.IOException]::new('Mock disk full')}
  if($global:Case -eq 'audit-permission'){throw [UnauthorizedAccessException]::new('Mock access denied')}
}
function docker {
  $a=@($args|ForEach-Object{[string]$_});$line=$a -join ' '
  $global:LASTEXITCODE=0;$global:Events.Add($line)
  if($a[0] -eq 'ps'){
    if($line -notmatch 'label=com.docker.compose.project=rsp-rollback-mock '){throw 'Wrong project'}
    $global:Recovering=$true
    if($global:Case -eq 'list-fail' -and $a[-1] -like '*=proxy'){$global:LASTEXITCODE=9;'Mock list unavailable';return}
    $a[-1].Replace('label=com.docker.compose.service=','')+'-id';return
  }
  if($a[0] -eq 'inspect'){
    if($global:Case -eq 'unverified' -and $a[-1] -eq 'proxy-id'){$global:LASTEXITCODE=9;'Mock inspect unavailable';return}
    $s=$global:States[$a[-1]]
    if($line.Contains('.State.Health')){"$s/healthy"}else{$s};return
  }
  if($a[0] -eq 'stop'){
    if($a[-1] -eq 'proxy-id' -and ($global:Case -eq 'stop-all' -or ($global:Case -eq 'first-stop' -and $a -contains '10'))){$global:LASTEXITCODE=9;'Mock stop failed';return}
    if($global:Case -eq 'unverified' -and $a[-1] -eq 'proxy-id'){return}
    $global:States[$a[-1]]='exited';return
  }
  if($a[0] -ne 'compose' -or $line -notmatch '--project-name rsp-rollback-mock '){throw "Forbidden mock command: $line"}
  if($line -match 'config --format json'){
    @{services=@{api=@{image='old-api';environment=@{APP_VERSION='old';GIT_SHA='old-sha'}};front=@{image='old-front'}}}|ConvertTo-Json -Depth 5 -Compress;return
  }
  if($a -contains 'stop'){$global:States[($a[-1]+'-id')]='exited';return}
  if($a -contains 'up'){
    if($global:Case -eq 'maintenance-fail' -and $a -contains '--no-recreate'){$global:LASTEXITCODE=9;'Mock maintenance unavailable';return}
    if($global:Case -eq 'already-safe' -and $a[-1] -eq 'front'){throw 'Original services failure'}
    $global:States[($a[-1]+'-id')]='running';return
  }
  if($a -contains 'config' -or $a -contains 'rm'){return}
  throw "Unexpected/forbidden Docker command: $line"
}
try{
  $cases=@('success','smoke','smoke-audit','audit-space','audit-permission','first-stop','stop-all','unverified','list-fail','maintenance-fail','already-safe','state-write','log-fail')
  foreach($case in $cases){
    $global:Case=$case;$global:Events=[Collections.Generic.List[string]]::new();$global:Recovering=$false
    $global:States=@{'proxy-id'='running';'api-id'='running';'maintenance-id'='exited'}
    $ProjectName='rsp-rollback-mock';$compose=@('--project-name',$ProjectName)
    $state=[pscustomobject]@{previous_version='old';previous_api_ref='old-api';previous_front_ref='old-front';previous_git_sha='old-sha'}
    $savedEnvironment=@{};$Level='Application';$resolvedState='mock';$deploymentPath='mock';$originalError=$null
    $output=[Collections.Generic.List[string]]::new();$failure=$null
    # A failing log sink is injected only into the disposable body.
    $testSource=$source
    if($case -eq 'log-fail'){$testSource=$source.Replace('Log "deployment_state_ok"','throw ''Original logging failure'';Log "deployment_state_ok"')}
    [IO.File]::WriteAllText((Join-Path $root 'rollback-body.ps1'),$testSource,$utf8)
    try{& (Join-Path $root 'rollback-body.ps1') 3>&1 | ForEach-Object {$output.Add([string]$_)}}catch{$failure=$_}
    $events=$global:Events -join "`n";$text=$output -join "`n"
    if($case -eq 'success'){
      if($failure -or $text -notmatch 'ROLLBACK_OK' -or $events -notmatch 'audit/success' -or $global:Recovering){throw 'Normal rollback failed'}
    }else{
      if(-not $failure -or $text -match 'ROLLBACK_OK'){throw "Failure declared success: $case"}
      $unsafe=$case -in @('stop-all','unverified','list-fail')
      if($failure.Exception.Data['UrgentManualIntervention'] -ne $unsafe){throw "Wrong urgent status: $case"}
      if($unsafe -and ($text -notmatch 'RECOVERY_CRITICAL' -or $text -notmatch 'RECOVERY_PUBLIC_BLOCKED=false' -or $global:States['api-id'] -ne 'exited')){throw 'Missing urgent fallback'}
      if(-not $unsafe -and $text -notmatch 'RECOVERY_PUBLIC_BLOCKED=true'){throw "Unverified closure: $case"}
      $recovery=$events.Substring($events.IndexOf('ps -a -q --filter'))
      if($recovery -match 'up .*proxy|stop maintenance|force-recreate|restore|persist'){throw 'Recovery performed forbidden action'}
      if($recovery.LastIndexOf('audit/failed') -lt $recovery.LastIndexOf('label=com.docker.compose.service=proxy')){throw 'Audit preceded verification'}
      if($case -in @('smoke','smoke-audit','first-stop','stop-all','unverified','list-fail','maintenance-fail') -and $failure.Exception.Message -ne 'Original smoke failure'){throw 'Original failure lost'}
      if($case -eq 'smoke-audit' -and ($failure.Exception.Data['RecoveryErrors'] -join ' ') -notmatch 'audit:.*disk full'){throw 'Secondary failure lost'}
      if($case -in @('audit-space','audit-permission') -and $failure.Exception.Message -notmatch 'Mock (disk full|access denied)'){throw 'Audit origin lost'}
      if($case -eq 'first-stop' -and ($recovery -notmatch 'stop --time 0 proxy-id' -or $recovery -notmatch 'up .*maintenance')){throw 'Missing alternatives'}
      if($case -eq 'maintenance-fail' -and ($text -notmatch 'RECOVERY_MAINTENANCE_VERIFIED=false' -or ($failure.Exception.Data['RecoveryErrors'] -join ' ') -notmatch 'start/maintenance')){throw 'False maintenance success'}
      if($case -eq 'already-safe' -and $recovery -match 'up .*maintenance|stop --time'){throw 'Unnecessary containment changes'}
    }
    "PASS rollback/$case"
  }
  "ROLLBACK_MOCKS_OK $($cases.Count)/$($cases.Count); no real Docker commands"
}finally{
  Remove-Item Function:\docker -ErrorAction SilentlyContinue
  $full=[IO.Path]::GetFullPath($root);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if($full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($full) -like 'rsp-rollback-mocks-*'){Remove-Item -LiteralPath $full -Recurse -Force}
}
