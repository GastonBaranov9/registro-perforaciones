param([string]$Prefix="rsp07f-r3-storage-$PID")
$ErrorActionPreference="Stop"
if($Prefix-notmatch '^rsp07f-r3-storage-[A-Za-z0-9-]+$'){throw "Prefix inseguro."}
$repo=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path;$tempRoot=Join-Path ([IO.Path]::GetTempPath()) "$Prefix-$([Guid]::NewGuid().ToString('N'))";[IO.Directory]::CreateDirectory($tempRoot)|Out-Null
$image="postgres:16.14-alpine3.24";$volumes=New-Object Collections.Generic.List[string]
function New-Volume([string]$Suffix){$name="$Prefix-$Suffix";& docker volume create $name|Out-Null;if($LASTEXITCODE-ne 0){throw "No se pudo crear volumen de prueba."};$volumes.Add($name);return $name}
function New-Source([string]$Name,[hashtable]$Files=@{}){$dir=Join-Path $tempRoot $Name;[IO.Directory]::CreateDirectory($dir)|Out-Null;foreach($entry in $Files.GetEnumerator()){[IO.File]::WriteAllBytes((Join-Path $dir $entry.Key),[byte[]]$entry.Value)};return $dir}
function Invoke-Migrate([string]$Volume,[string]$Source,[string]$Refs,[int]$FailAfter=0,[bool]$ExpectSuccess=$true,[string]$SourceStatus='available'){
  $arguments=@("run","--rm","-e","PGHOST=test","-e","PGPORT=5432","-e","PGUSER=test","-e","PGDATABASE=test","-e","TEST_DB_REFS=$Refs","-e","TEST_DB_LEDGER=present","-e","PHOTO_LEGACY_SOURCE_STATUS=$SourceStatus","-e","PHOTO_STORAGE_PROJECT_NAME=$Prefix","-v","${Volume}:/data","-v","${Source}:/legacy:ro","-v","$($repo.Replace('\','/'))/ops:/ops:ro","-v","$($repo.Replace('\','/'))/scripts/fixtures/photo-storage:/test-bin:ro","--entrypoint","/bin/sh")
  if($FailAfter-gt 0){$arguments+=@("-e","PHOTO_STORAGE_TEST_FAIL_AFTER=$FailAfter")}
  $arguments+=@($image,"-c","cp /test-bin/fake-psql.sh /tmp/psql && chmod 0700 /tmp/psql && PATH=/tmp:`$PATH exec /ops/photo-storage-migrate.sh")
  $old=$ErrorActionPreference;$ErrorActionPreference='Continue';try{$output=(& docker @arguments 2>&1|Out-String);$ok=($LASTEXITCODE-eq 0)}finally{$ErrorActionPreference=$old}
  if($ok-ne $ExpectSuccess){throw "Resultado inesperado del migrador de storage: $output"};return $output
}
function Volume-Text([string]$Volume,[string]$Command){$value=(& docker run --rm -v "${Volume}:/data" --entrypoint /bin/sh $image -c $Command|Out-String).Trim();if($LASTEXITCODE-ne 0){throw "Inspección de volumen falló."};return $value}
$jpegA=[byte[]](0xff,0xd8,0xff,0xdb,0x01,0x02,0xff,0xd9);$jpegB=[byte[]](0xff,0xd8,0xff,0xdb,0x09,0x08,0xff,0xd9);$png=[byte[]](0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x01)
try{
  $empty=New-Source 'empty';$withOne=New-Source 'one' @{'pozo-1.jpg'=$jpegA};$withTwo=New-Source 'two' @{'pozo-1.jpg'=$jpegA;'pozo-2.png'=$png};$conflict=New-Source 'conflict' @{'pozo-1.jpg'=$jpegB}
  $vEmpty=New-Volume 'empty';$emptyOutput=Invoke-Migrate $vEmpty $empty '';if($emptyOutput-notmatch 'MODE=initialized_empty'){throw 'No inicializó instalación sin fotos.'}
  $vPhoto=New-Volume 'photo';$first=Invoke-Migrate $vPhoto $withOne '1';if($first-notmatch 'COPIED=1'){throw 'No copió foto legacy.'};$shaBefore=Volume-Text $vPhoto "sha256sum /data/fotos/pozo-1.jpg | awk '{print `$1}'"
  $second=Invoke-Migrate $vPhoto $withOne '1';$shaAfter=Volume-Text $vPhoto "sha256sum /data/fotos/pozo-1.jpg | awk '{print `$1}'";if($second-notmatch 'COPIED=0'-or $shaAfter-ne $shaBefore){throw 'Segundo intento no fue idempotente.'}
  $vMissing=New-Volume 'missing';[void](Invoke-Migrate $vMissing $empty '1' 0 $false)
  $vUnavailable=New-Volume 'unavailable';[void](Invoke-Migrate $vUnavailable $empty '1' 0 $false 'unavailable')
  [void](Volume-Text $vPhoto 'rm -f /data/.rsp-photo-storage-layout');$partial=Invoke-Migrate $vPhoto $withOne '1';if($partial-notmatch 'IDENTICAL=1'){throw 'Volumen parcial idéntico no fue aceptado.'}
  [void](Invoke-Migrate $vPhoto $conflict '1' 0 $false)
  $vRetry=New-Volume 'retry';[void](Invoke-Migrate $vRetry $withTwo '1,2' 1 $false);$markerAfterFailure=Volume-Text $vRetry "if [ -e /data/.rsp-photo-storage-layout ];then echo yes;else echo no;fi";if($markerAfterFailure-ne 'no'){throw 'Fallo parcial marcó storage como listo.'};$retry=Invoke-Migrate $vRetry $withTwo '1,2';if($retry-notmatch 'DB_REFERENCES=2'){throw 'Retry no completó la migración.'}
  $shaRetry=Volume-Text $vRetry "sha256sum /data/fotos/pozo-1.jpg | awk '{print `$1}'";if($shaRetry-ne $shaBefore){throw 'Retry cambió el hash de la foto.'}
  [pscustomobject]@{empty_initialized=$true;legacy_photo_copied=$true;missing_reference_rejected=$true;legacy_source_unavailable_rejected=$true;already_migrated_noop=$true;partial_identical=$true;conflict_rejected=$true;partial_failure_unmarked=$true;retry_safe=$true;sha256=$shaRetry}|ConvertTo-Json -Compress
}finally{
  foreach($volume in $volumes){$old=$ErrorActionPreference;$ErrorActionPreference='SilentlyContinue';try{& docker volume rm $volume 2>$null|Out-Null}finally{$ErrorActionPreference=$old}}
  $full=[IO.Path]::GetFullPath($tempRoot);$system=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());if($full.StartsWith($system,[StringComparison]::OrdinalIgnoreCase)-and [IO.Path]::GetFileName($full)-like "$Prefix-*"){Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue}
}
