param([Parameter(Mandatory=$true)][string]$SnapshotDirectory)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../ops/validation-027.ps1')
$migrationDir=(Resolve-Path (Join-Path $PSScriptRoot '../api/db/migrations')).Path
$passed=0
function Check([string]$Name,[scriptblock]$Body,[bool]$Reject=$false){
  $found=$null;try{& $Body | Out-Null}catch{$found=$_}
  if(($null -ne $found) -ne $Reject){throw "Unexpected $Name result: $found"}
  $script:passed++;Write-Output "PASS 027/$Name"
}
function Read-Snapshot($Name){return [IO.File]::ReadAllText((Join-Path $SnapshotDirectory "$Name.json")) | ConvertFrom-Json}
function Clone($Value){return $Value | ConvertTo-Json -Depth 40 | ConvertFrom-Json}
$before=Read-Snapshot 'before';$after=Read-Snapshot 'after';$smoke=Read-Snapshot 'smoke'
Check 'ledger-before' {Assert-Rsp026Ledger $before.ledger 26 $migrationDir}
Check 'ledger-after' {Assert-Rsp026Ledger $after.ledger 27 $migrationDir}
Check 'baseline-with-configured-policy' {Assert-Rsp027Baseline $before}
Check 'exact-structure' {Assert-Rsp027Structure $after}
Check 'strict-conservation' {Assert-Rsp027Conservation $before $after}
Check 'post-smoke-conservation' {Assert-Rsp027Conservation $before $smoke 1}
Check 'strict-check-rejects-logout-before-smoke' {Assert-Rsp027Conservation $before $smoke} $true
Check 'missing-smoke-identity' {Assert-Rsp027Conservation $before $smoke 99} $true
foreach($name in @('bad-depth','bad-fk','bad-null','invented','changed-legacy','changed-policy','changed-schema')){
  Check $name {Assert-Rsp027Conservation $before (Read-Snapshot $name) 1} $true
}
foreach($field in @('counter','functions','sequences','schema','data')){
  Check "missing-$field" {$a=Clone $after;$a.$field=$null;Assert-Rsp027Conservation $before $a} $true
}
Check 'wrong-checksum' {$a=Clone $after;$a.ledger[27].checksum_sha256='f'*64;Assert-Rsp026Ledger $a.ledger 27 $migrationDir} $true
Check 'missing-ledger-entry' {Assert-Rsp026Ledger @($after.ledger | Where-Object {$_.version -ne '019'}) 27 $migrationDir} $true
Check 'read-detail' {Assert-Rsp027ApiDetail ([pscustomobject]@{prefiltro_constructivo=@()})}
foreach($value in @('{}','{"prefiltro_constructivo":null}','{"prefiltro_constructivo":[{"desde_m":1,"hasta_m":2}]}')){
  Check "invalid-detail-$value" {Assert-Rsp027ApiDetail ($value | ConvertFrom-Json)} $true
}
Check 'read-profile' {Assert-Rsp027ApiProfile ([pscustomobject]@{profundidad_m=30;rangos=@(@{desde_m=0;hasta_m=30});tramos=@();etiquetas=@();prefiltro_constructivo=@()})}
Check 'invalid-profile' {Assert-Rsp027ApiProfile $null} $true
Check 'initial-upgrade' {function Get-Rsp026Ledger{return $before.ledger};function Invoke-Rsp026Sql{return @{table_exists=$false}};if(-not(Test-Rsp027Upgrade @() $migrationDir)){throw 'Skipped'}}
Check 'orphan-table' {function Get-Rsp026Ledger{return $before.ledger};function Invoke-Rsp026Sql{return @{table_exists=$true}};Test-Rsp027Upgrade @() $migrationDir} $true
Check 'already-applied-without-success' {function Get-Rsp026Ledger{return $after.ledger};Test-Rsp027Upgrade @() $migrationDir} $true
Check 'future-deployment' {function Get-Rsp026Ledger{return $after.ledger};if(Test-Rsp027Upgrade @() $migrationDir @{status='success';validation_027='passed';git_sha='fixture'} 'fixture'){throw 'Repeated initial gate'}}
Check '026-gate-not-repeated' {function Get-Rsp026Ledger{return $before.ledger};if(Test-Rsp026Upgrade @() $migrationDir){throw 'Repeated 026'}}
function git {
  $global:LASTEXITCODE=0
  if($args -contains 'rev-parse'){return 'fixture-sha'}
  if($args -contains 'status'){if($script:dirtyBuild){return ' M unexpected'};return}
  throw 'Unexpected Git command'
}
try{
  Check 'clean-build-source' {Assert-Rsp027BuildSource 'mock' 'fixture-sha'}
  Check 'wrong-build-source' {Assert-Rsp027BuildSource 'mock' 'wrong-sha'} $true
  $script:dirtyBuild=$true
  Check 'dirty-build-source' {Assert-Rsp027BuildSource 'mock' 'fixture-sha'} $true
}finally{Remove-Item Function:\git}
$imageSha='a'*40
$mockApiImageId='sha256:'+('1'*64)
$imageMode='correct';$imageFailureRef='api';$inventoryMode='correct'
$imageInspections=[Collections.Generic.List[string]]::new();$imageRuns=0
function docker {
  $global:LASTEXITCODE=0
  if($args[0] -eq 'compose'){return 'mock-postgres'}
  if($args[0] -eq 'image'){
    if($args.Count -ne 3 -or $args[1] -ne 'inspect' -or $args[2] -notin @('api','front')){throw 'Expected JSON inspect of exactly one reference'}
    $script:imageInspections.Add($args[2])
    $im=@{Id=$(if($args[2] -eq 'api'){$mockApiImageId}else{'sha256:'+('2'*64)});Config=@{Labels=@{'org.opencontainers.image.revision'=$imageSha}}}
    if($args[2] -eq $imageFailureRef){
      switch($imageMode){
        'wrong' {$im.Config.Labels.'org.opencontainers.image.revision'='b'*40}
        'missing' {$im.Config.Labels.Remove('org.opencontainers.image.revision')}
        'empty-sha' {$im.Config.Labels.'org.opencontainers.image.revision'=''}
        'invalid-json' {return '{invalid'}
        'docker-error' {$global:LASTEXITCODE=1}
        'empty-response' {return ''}
        'empty-array' {return '[]'}
        'null-image' {return '[null]'}
        'object-response' {return ConvertTo-Json -InputObject $im -Depth 5}
        'ambiguous' {return ConvertTo-Json -InputObject @($im,$im) -Depth 5}
        'invalid-id' {$im.Id='not-an-image-id'}
      }
    }
    return ConvertTo-Json -InputObject @($im) -Depth 5
  }
  if($args[0] -eq 'run'){
    $script:imageRuns++
    if($args -notcontains '--read-only' -or $args -notcontains 'none' -or $args -contains '-v' -or $args -contains '--env' -or $args -notcontains $mockApiImageId -or $args -notcontains '--pull=never' -or $args -notcontains '--rm'){throw 'Unsafe or unpinned image inspection'}
    $ledger=Clone $after.ledger
    switch($inventoryMode){
      'checksum' {$ledger[27].checksum_sha256='f'*64}
      'missing' {$ledger=@($ledger | Where-Object {$_.version -ne '027'})}
      'invalid-json' {return '{invalid'}
      'docker-error' {$global:LASTEXITCODE=1}
    }
    return ConvertTo-Json -InputObject @($ledger) -Depth 5
  }
  if($args[0] -eq 'exec'){
    $query=$input | Out-String
    if($args -contains 'node'){
      if($query -notmatch "const root='/var/lib/registro-perforaciones'"){throw 'Wrong persistence path'}
      return ConvertTo-Json -InputObject @{sha256=$(if($script:badPersistence){'changed'}else{$script:persistenceHash});entries=1}
    }
    if($args -notcontains 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=30000' -or $query -notmatch '^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'){throw 'Missing READ ONLY'}
    if($script:transportFailure){$global:LASTEXITCODE=1;return}
    return '{"safe":true}'
  }
  throw 'Real Docker forbidden'
}
try{
  Check 'target-image-migrations' {Assert-Rsp027TargetMigrations 'api' 'front' $imageSha $migrationDir;if(($imageInspections -join ',') -ne 'api,front' -or $imageRuns -ne 1){throw 'Missing independent inspections/inventory'}}
  Check 'empty-expected-sha' {Assert-Rsp027TargetMigrations 'api' 'front' '' $migrationDir} $true
  foreach($imageFailureRef in @('api','front')){
    foreach($imageMode in @('wrong','missing','empty-sha','invalid-json','docker-error','empty-response','empty-array','null-image','object-response','ambiguous','invalid-id')){
      $runsBefore=$imageRuns
      Check "target-$imageFailureRef-$imageMode" {Assert-Rsp027TargetMigrations 'api' 'front' $imageSha $migrationDir} $true
      if($imageRuns -ne $runsBefore){throw 'Inventory ran despite invalid image inspection'}
    }
  }
  $imageMode='correct'
  foreach($inventoryMode in @('checksum','missing','invalid-json','docker-error')){
    Check "target-inventory-$inventoryMode" {Assert-Rsp027TargetMigrations 'api' 'front' $imageSha $migrationDir} $true
  }
  $inventoryFile=Join-Path $SnapshotDirectory 'persistence.inventory'
  [IO.File]::WriteAllText($inventoryFile,"d 755:1000:1000 .",[Text.UTF8Encoding]::new($false))
  $script:persistenceHash=(Get-FileHash -LiteralPath $inventoryFile -Algorithm SHA256).Hash.ToLowerInvariant()
  Check 'persistence-matches-backup' {Assert-Rsp027Persistence @() $SnapshotDirectory}
  $script:badPersistence=$true
  Check 'persistence-mismatch-fails' {Assert-Rsp027Persistence @() $SnapshotDirectory} $true
  Check 'read-only-transport' {if(-not(Invoke-Rsp026Sql @() 'SELECT 1').safe){throw 'Missing result'}}
  $script:transportFailure=$true
  Check 'sql-error-blocks' {Invoke-Rsp026Sql @() 'SELECT 1'} $true
}finally{Remove-Item Function:\docker}
Write-Output "VALIDATION_027_OK $passed/$passed"
