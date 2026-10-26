# Pure gate tests. Docker is always mocked; no database or HTTP access.
param([string]$SnapshotDirectory='')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../ops/validation-026.ps1')
$migrationDir=(Resolve-Path (Join-Path $PSScriptRoot '../api/db/migrations')).Path
$passed=0
function Check([string]$Name,[scriptblock]$Body,[bool]$Reject=$false){
  $errorFound=$null
  try{& $Body}catch{$errorFound=$_}
  if(($null -ne $errorFound) -ne $Reject){throw "Unexpected $Name result: $errorFound"}
  $script:passed++;Write-Output "PASS 026/$Name"
}
function Clone($Value){return ($Value | ConvertTo-Json -Depth 14 | ConvertFrom-Json)}
$chain=[pscustomobject]@{active=0;reservation=31;deleted31=1;edges=@(@{from=19;to=29;number=3277},@{from=29;to=31;number=3277});references=@(@{id='19';number='3277'},@{id='29';number='3277'},@{id='31';number='3277'})}
$before=[pscustomobject]@{counter=@{proximo=3282;mayor_asignado=3281};authorized=@(1);admin1=$true;chain=$chain;protected=@{reservas='hash';historicos='hash';offline='hash';capacidades='hash'};ledger=@()}
foreach($file in Get-ChildItem -LiteralPath $migrationDir -Filter '*.sql' | Sort-Object Name){
  $version=$file.Name.Substring(0,3);if($version -gt '025'){continue}
  $sha=[Security.Cryptography.SHA256]::Create()
  try{$hash=-join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.File]::ReadAllText($file.FullName).Replace("`r`n","`n"))) | ForEach-Object {$_.ToString('x2')})}finally{$sha.Dispose()}
  $before.ledger+=,[pscustomobject]@{version=$version;nombre=$file.BaseName.Substring(4);checksum_sha256=$hash}
}
$policy=[pscustomobject]@{revision=1;rangos=@(@{desde=1;hasta=3281});excepciones=@();history=0;protected1=$true;protected3281=$true;protected3282=$false;puede_administrar=$true;historial=@()}
Check 'audited-chain-19-29-31' {Assert-Rsp026Chain $chain}
Check 'direct-audited-chain-also-valid' {$c=Clone $chain;$c.edges=@(@{from=19;to=31;number=3277});$c.references=@($c.references | Where-Object {$_.id -ne '29'});Assert-Rsp026Chain $c}
foreach($field in @('active','reservation','deleted31')){Check "invalid-$field" {$c=Clone $chain;$c.$field=999;Assert-Rsp026Chain $c} $true}
Check 'missing-original-reference' {$c=Clone $chain;$c.references=@($c.references | Where-Object {$_.id -ne '19'});Assert-Rsp026Chain $c} $true
Check 'contradictory-reference' {$c=Clone $chain;$c.references[0].number='3278';Assert-Rsp026Chain $c} $true
Check 'missing-link' {$c=Clone $chain;$c.edges=@($c.edges[0]);Assert-Rsp026Chain $c} $true
Check 'fork' {$c=Clone $chain;$c.edges+=@{from=19;to=50;number=3277};Assert-Rsp026Chain $c} $true
Check 'cycle' {$c=Clone $chain;$c.edges[1].to=19;Assert-Rsp026Chain $c} $true
Check 'baseline' {Assert-Rsp026Baseline $before}
Check 'conservation' {$s=Clone $before;$s.ledger+=,[pscustomobject]@{version='026'};Assert-Rsp026Conservation $before $s}
foreach($field in @('proximo','mayor_asignado')){Check "changed-$field" {$s=Clone $before;$s.counter.$field++;Assert-Rsp026Conservation $before $s} $true}
foreach($field in @('reservas','historicos','offline','capacidades')){Check "changed-$field" {$s=Clone $before;$s.protected.$field='changed';Assert-Rsp026Conservation $before $s} $true}
Check 'additional-privilege' {$s=Clone $before;$s.authorized+=2;Assert-Rsp026Baseline $s} $true
Check 'disabled-admin' {$s=Clone $before;$s.admin1=$false;Assert-Rsp026Baseline $s} $true
Check 'ledger' {Assert-Rsp026Ledger $before.ledger 25 $migrationDir}
Check 'missing-migration' {Assert-Rsp026Ledger @($before.ledger | Where-Object {$_.version -ne '018'}) 25 $migrationDir} $true
Check 'wrong-checksum' {$s=Clone $before;$s.ledger[0].checksum_sha256='f'*64;Assert-Rsp026Ledger $s.ledger 25 $migrationDir} $true
Check 'policy-db' {Assert-Rsp026Policy $policy}
Check 'policy-api' {Assert-Rsp026Policy $policy -Api}
foreach($field in @('revision','history','protected1','protected3281','protected3282')){Check "invalid-policy-$field" {$p=Clone $policy;if($field -like 'protected*'){$p.$field=-not $p.$field}else{$p.$field=9};Assert-Rsp026Policy $p} $true}
Check 'unexpected-exception' {$p=Clone $policy;$p.excepciones=@(300);Assert-Rsp026Policy $p} $true
Check 'missing-exceptions-field' {$p=Clone $policy;$p.PSObject.Properties.Remove('excepciones');Assert-Rsp026Policy $p} $true
Check 'wrong-range' {$p=Clone $policy;$p.rangos[0].hasta=3280;Assert-Rsp026Policy $p} $true
Check 'api-permission' {$p=Clone $policy;$p.puede_administrar=$false;Assert-Rsp026Policy $p -Api} $true
Check 'api-history' {$p=Clone $policy;$p.historial=@(@{id=1});Assert-Rsp026Policy $p -Api} $true
Check 'automatic-initial-upgrade' {function Get-Rsp026Ledger{return $before.ledger};if(-not(Test-Rsp026Upgrade @('mock') $migrationDir)){throw 'Gate skipped'}}
Check 'future-deployment-preserves-configured-policy' {function Get-Rsp026Ledger{return @([pscustomobject]@{version='026'})};if(Test-Rsp026Upgrade @('mock') $migrationDir){throw 'Initial gate repeated'}}
Check 'other-pending-migration-blocked' {function Get-Rsp026Ledger{return @($before.ledger | Where-Object {$_.version -ne '025'})};Test-Rsp026Upgrade @('mock') $migrationDir} $true

$imageSha='a'*40;$imageId='sha256:'+('b'*64)
function docker {
  $a=@($args);$global:LASTEXITCODE=0
  if($a[0] -eq 'compose' -and ($a -join ' ') -match '^compose mock ps -q (api|front|postgres)$'){return "$($a[-1])-id"}
  if($a[0] -eq 'exec'){
    if($a -notcontains 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=30000'){throw 'Missing read-only connection guard'}
    $query=$input | Out-String
    if($query -notmatch '^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;' -or $query -notmatch 'ROLLBACK;\s*$'){throw 'Missing read-only transaction'}
    return '{"readOnly":true}'
  }
  if($a[0] -eq 'inspect'){
    if($imageCase -eq 'inspect-failure'){$global:LASTEXITCODE=1;return}
    $id=if($imageCase -eq 'image-mismatch'){'sha256:wrong'}else{$imageId}
    $health=if($imageCase -eq 'unhealthy'){'unhealthy'}else{'healthy'}
    $sha=if($imageCase -eq 'runtime-sha'){'wrong'}else{$imageSha}
    return (@{Image=$id;State=@{Health=@{Status=$health}};Config=@{Env=@("GIT_SHA=$sha")}} | ConvertTo-Json -Depth 6 -Compress)
  }
  if($a[0] -eq 'image' -and $a[1] -eq 'inspect'){
    $sha=if($imageCase -eq 'label-sha'){'wrong'}else{$imageSha}
    return (@{Id=$imageId;Config=@{Labels=@{'org.opencontainers.image.revision'=$sha}}} | ConvertTo-Json -Depth 6 -Compress)
  }
  throw 'Unexpected Docker operation; real Docker is forbidden'
}
try{
  Check 'read-only-sql-transport' {if(-not (Invoke-Rsp026Sql @('mock') 'SELECT 1;').readOnly){throw 'No result'}}
  foreach($imageCase in @('success','image-mismatch','unhealthy','runtime-sha','label-sha','inspect-failure')){
    Check "images-$imageCase" {Assert-Rsp026Images @('mock') $imageSha 'fixture-api' 'fixture-front'} ($imageCase -ne 'success')
  }
}finally{Remove-Item Function:\docker}

if($SnapshotDirectory){
  $b=[IO.File]::ReadAllText((Join-Path $SnapshotDirectory 'before.json')) | ConvertFrom-Json
  $a=[IO.File]::ReadAllText((Join-Path $SnapshotDirectory 'after.json')) | ConvertFrom-Json
  $p=[IO.File]::ReadAllText((Join-Path $SnapshotDirectory 'policy.json')) | ConvertFrom-Json
  Check 'isolated-postgresql-baseline' {Assert-Rsp026Baseline $b;Assert-Rsp026Ledger $b.ledger 25 $migrationDir}
  Check 'isolated-postgresql-conservation' {Assert-Rsp026Conservation $b $a;Assert-Rsp026Ledger $a.ledger 26 $migrationDir}
  Check 'isolated-postgresql-policy' {Assert-Rsp026Policy $p}
}
Write-Output "VALIDATION_026_OK $passed/$passed; no real Docker or HTTP commands"
