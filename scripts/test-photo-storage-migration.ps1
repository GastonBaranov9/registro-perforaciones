param([string]$Prefix="rsp07f-r3-storage-$PID")
$ErrorActionPreference="Stop"
if($Prefix-notmatch '^rsp07f-r3-storage-[A-Za-z0-9-]+$'){throw "Prefix inseguro."}

$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$tempRoot=Join-Path ([IO.Path]::GetTempPath()) "$Prefix-$([Guid]::NewGuid().ToString('N'))"
[IO.Directory]::CreateDirectory($tempRoot)|Out-Null
$image="postgres:16.14-alpine3.24"
$volumes=New-Object Collections.Generic.List[string]

function New-Volume([string]$Suffix){$name="$Prefix-$Suffix";& docker volume create $name|Out-Null;if($LASTEXITCODE-ne 0){throw "No se pudo crear volumen de prueba."};$volumes.Add($name);return $name}
function New-Source([string]$Name,[hashtable]$Files=@{}){$dir=Join-Path $tempRoot $Name;[IO.Directory]::CreateDirectory($dir)|Out-Null;foreach($entry in $Files.GetEnumerator()){[IO.File]::WriteAllBytes((Join-Path $dir $entry.Key),[byte[]]$entry.Value)};return $dir}
function Invoke-Migrate{
  param([string]$Volume,[string]$Source,[string]$Refs,[int]$FailAfter=0,[bool]$ExpectSuccess=$true,[string]$SourceStatus='available',[string]$FailAt='')
  $arguments=@("run","--rm","-e","PGHOST=test","-e","PGPORT=5432","-e","PGUSER=test","-e","PGDATABASE=test","-e","TEST_DB_REFS=$Refs","-e","TEST_DB_LEDGER=present","-e","PHOTO_LEGACY_SOURCE_STATUS=$SourceStatus","-e","PHOTO_STORAGE_PROJECT_NAME=$Prefix","-v","${Volume}:/data","-v","${Source}:/legacy:ro","-v","$($repo.Replace('\','/'))/ops:/ops:ro","-v","$($repo.Replace('\','/'))/scripts/fixtures/photo-storage:/test-bin:ro","--entrypoint","/bin/sh")
  if($FailAfter-gt 0){$arguments+=@("-e","PHOTO_STORAGE_TEST_FAIL_AFTER=$FailAfter")}
  if($FailAt){$arguments+=@("-e","PHOTO_STORAGE_TEST_FAIL_AT=$FailAt")}
  $arguments+=@($image,"-c","cp /test-bin/fake-psql.sh /tmp/psql && chmod 0700 /tmp/psql && PATH=/tmp:`$PATH exec /ops/photo-storage-migrate.sh")
  $old=$ErrorActionPreference;$ErrorActionPreference='Continue';try{$output=(& docker @arguments 2>&1|Out-String);$ok=($LASTEXITCODE-eq 0)}finally{$ErrorActionPreference=$old}
  if($ok-ne $ExpectSuccess){throw "Resultado inesperado del migrador de storage: $output"};return $output
}
function Volume-Text([string]$Volume,[string]$Command){$value=(& docker run --rm -v "${Volume}:/data" --entrypoint /bin/sh $image -c $Command|Out-String).Trim();if($LASTEXITCODE-ne 0){throw "Inspeccion de volumen fallo."};return $value}
function Assert-VolumeMatches([string]$Volume,[string]$Source){
  $expected=@(Get-ChildItem -LiteralPath $Source -File|Sort-Object Name|ForEach-Object{$_.Name})
  $actual=@((Volume-Text $Volume "find /data/fotos -maxdepth 1 -type f -exec basename {} ';' | sort")-split "`r?`n"|Where-Object{$_})
  if(($expected-join '|')-cne ($actual-join '|')){throw "Paths de volumen no coinciden con snapshot: $($actual-join ',')"}
  foreach($name in $expected){$expectedSha=(Get-FileHash (Join-Path $Source $name) -Algorithm SHA256).Hash.ToLowerInvariant();$actualSha=Volume-Text $Volume "sha256sum /data/fotos/$name | awk '{print `$1}'";if($actualSha-cne $expectedSha){throw "SHA distinto para $name"}}
}

$jpegA=[byte[]](0xff,0xd8,0xff,0xdb,0x01,0x02,0xff,0xd9)
$jpegB=[byte[]](0xff,0xd8,0xff,0xdb,0x09,0x08,0xff,0xd9)
$png=[byte[]](0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x01)
try{
  $empty=New-Source 'empty'
  $withOne=New-Source 'one' @{'pozo-1.jpg'=$jpegA}
  $withTwo=New-Source 'two' @{'pozo-1.jpg'=$jpegA;'pozo-2.png'=$png}
  $replacement=New-Source 'replacement' @{'pozo-1.jpg'=$jpegB}
  $extension=New-Source 'extension' @{'pozo-1.png'=$png}
  $multipleOld=New-Source 'multiple-old' @{'pozo-1.jpg'=$jpegA;'pozo-2.png'=$png;'pozo-4.jpg'=$jpegA}
  $multipleNew=New-Source 'multiple-new' @{'pozo-1.jpg'=$jpegB;'pozo-3.png'=$png;'pozo-4.jpg'=$jpegA}

  $vEmpty=New-Volume 'empty';$emptyOutput=Invoke-Migrate -Volume $vEmpty -Source $empty -Refs '';if($emptyOutput-notmatch 'MODE=initialized_empty'){throw 'No inicializo instalacion sin fotos.'}
  $vPhoto=New-Volume 'photo';$first=Invoke-Migrate -Volume $vPhoto -Source $withOne -Refs '1';if($first-notmatch 'COPIED=1'){throw 'No copio foto legacy.'};$shaA=Volume-Text $vPhoto "sha256sum /data/fotos/pozo-1.jpg | awk '{print `$1}'"
  $second=Invoke-Migrate -Volume $vPhoto -Source $withOne -Refs '1';if($second-notmatch 'MODE=existing'-or $second-notmatch 'UNCHANGED=1'-or (Volume-Text $vPhoto "sha256sum /data/fotos/pozo-1.jpg | awk '{print `$1}'")-ne $shaA){throw 'Segundo intento no fue idempotente.'}
  $vMissing=New-Volume 'missing';[void](Invoke-Migrate -Volume $vMissing -Source $empty -Refs '1' -ExpectSuccess $false)
  $vUnavailable=New-Volume 'unavailable';[void](Invoke-Migrate -Volume $vUnavailable -Source $empty -Refs '' -ExpectSuccess $false -SourceStatus 'unavailable')

  $replaced=Invoke-Migrate -Volume $vPhoto -Source $replacement -Refs '1';if($replaced-notmatch 'UPDATED=1'){throw 'Reemplazo no fue clasificado.'};Assert-VolumeMatches $vPhoto $replacement
  $changedExtension=Invoke-Migrate -Volume $vPhoto -Source $extension -Refs '1';if($changedExtension-notmatch 'COPIED=1'-or $changedExtension-notmatch 'REMOVED=1'){throw 'Cambio JPG a PNG no fue clasificado.'};Assert-VolumeMatches $vPhoto $extension
  $deleted=Invoke-Migrate -Volume $vPhoto -Source $empty -Refs '';if($deleted-notmatch 'REMOVED=1'){throw 'Delete no fue clasificado.'};Assert-VolumeMatches $vPhoto $empty
  $added=Invoke-Migrate -Volume $vPhoto -Source $withOne -Refs '1';if($added-notmatch 'COPIED=1'){throw 'Add no fue clasificado.'};Assert-VolumeMatches $vPhoto $withOne

  $vMultiple=New-Volume 'multiple';[void](Invoke-Migrate -Volume $vMultiple -Source $multipleOld -Refs '1,2,4');$multi=Invoke-Migrate -Volume $vMultiple -Source $multipleNew -Refs '1,3,4';if($multi-notmatch 'COPIED=1'-or $multi-notmatch 'UPDATED=1'-or $multi-notmatch 'REMOVED=1'-or $multi-notmatch 'UNCHANGED=1'){throw 'Mirror multiple no clasifico todos los cambios.'};Assert-VolumeMatches $vMultiple $multipleNew

  foreach($failAt in @('staging','promotion','post_verify')){$vFault=New-Volume "fault-$failAt";[void](Invoke-Migrate -Volume $vFault -Source $withOne -Refs '1');[void](Invoke-Migrate -Volume $vFault -Source $replacement -Refs '1' -ExpectSuccess $false -FailAt $failAt);Assert-VolumeMatches $vFault $withOne;$residue=Volume-Text $vFault "find /data -maxdepth 1 -name '.rsp-photo-stage-*' -o -name '.rsp-photo-previous-*' -o -name '.rsp-photo-failed-*' | wc -l | tr -d ' '";if($residue-ne '0'){throw "Fallo $failAt dejo staging."};if((Volume-Text $vFault 'test ! -e /data/.rsp-photo-storage-layout && echo ok')-ne 'ok'){throw "Fallo $failAt dejo marker listo."}}

  $vRetry=New-Volume 'retry';[void](Invoke-Migrate -Volume $vRetry -Source $withTwo -Refs '1,2' -FailAfter 1 -ExpectSuccess $false);if((Volume-Text $vRetry 'test ! -e /data/.rsp-photo-storage-layout && echo ok')-ne 'ok'){throw 'Fallo parcial marco storage.'};$retry=Invoke-Migrate -Volume $vRetry -Source $withTwo -Refs '1,2';if($retry-notmatch 'DB_REFERENCES=2'){throw 'Retry no completo mirror.'};Assert-VolumeMatches $vRetry $withTwo

  $beforeCutover=Volume-Text $vMultiple "sha256sum /data/fotos/pozo-1.jpg | awk '{print `$1}'";$postCutover=Invoke-Migrate -Volume $vMultiple -Source $withOne -Refs '1,3,4' -SourceStatus 'not_applicable';$afterCutover=Volume-Text $vMultiple "sha256sum /data/fotos/pozo-1.jpg | awk '{print `$1}'";if($postCutover-notmatch 'MODE=existing'-or $beforeCutover-ne $afterCutover){throw 'Storage persistente post-cutover fue reimportado.'};Assert-VolumeMatches $vMultiple $multipleNew

  [pscustomobject]@{first_migration=$true;idempotent_retry=$true;replacement_refreshed=$true;extension_mirrored=$true;delete_mirrored=$true;add_mirrored=$true;multiple_changes=$true;staging_failure_recovered=$true;promotion_failure_recovered=$true;post_verify_failure_recovered=$true;source_unavailable_rejected=$true;missing_reference_rejected=$true;post_cutover_not_reimported=$true;snapshot_sha256=(Volume-Text $vMultiple "sha256sum /data/.rsp-photo-storage-layout | awk '{print `$1}'")}|ConvertTo-Json -Compress
}finally{
  foreach($volume in $volumes){$old=$ErrorActionPreference;$ErrorActionPreference='SilentlyContinue';try{& docker volume rm $volume 2>$null|Out-Null}finally{$ErrorActionPreference=$old}}
  $full=[IO.Path]::GetFullPath($tempRoot);$system=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());if($full.StartsWith($system,[StringComparison]::OrdinalIgnoreCase)-and [IO.Path]::GetFileName($full)-like "$Prefix-*"){Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue}
}
