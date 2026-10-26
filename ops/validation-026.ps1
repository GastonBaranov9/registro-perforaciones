# Specific, read-only gate for the first RSP upgrade 025 -> 026.
function Invoke-Rsp026Sql([string[]]$ComposeArguments,[string]$Sql) {
  $id=(& docker compose @ComposeArguments ps -q postgres | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or -not $id){throw '026: PostgreSQL no identificado.'}
  $savedEncoding=$OutputEncoding
  try {
    $OutputEncoding=[Text.UTF8Encoding]::new($false)
    $query="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;`n$Sql`nROLLBACK;"
    $result=($query | & docker exec -i --env 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=30000' $id sh -c 'exec psql -XqAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | Out-String).Trim()
    if($LASTEXITCODE -ne 0){throw '026: fallo de consulta READ ONLY.'}
    return ($result | ConvertFrom-Json)
  }finally{$OutputEncoding=$savedEncoding}
}
function Get-Rsp026Ledger([string[]]$ComposeArguments) {
  return @(Invoke-Rsp026Sql $ComposeArguments "SELECT json_agg(x ORDER BY version) FROM (SELECT version,nombre,checksum_sha256 FROM schema_migrations)x;")
}
function Assert-Rsp026Ledger($Ledger,[int]$Last,[string]$MigrationDir) {
  if(($Ledger.version -join ',') -cne ((0..$Last | ForEach-Object {$_.ToString('000')}) -join ',')){throw '026: se requiere exactamente el esquema esperado, sin otras migraciones pendientes.'}
  foreach($m in $Ledger){
    $file=Join-Path $MigrationDir "$($m.version)_$($m.nombre).sql"
    $sql=[IO.File]::ReadAllText($file).Replace("`r`n","`n")
    $sha=[Security.Cryptography.SHA256]::Create()
    try{$hashes=@($sql,$sql.Replace("`n","`r`n")) | ForEach-Object { -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($_)) | ForEach-Object {$_.ToString('x2')}) }}finally{$sha.Dispose()}
    if($m.checksum_sha256.Trim() -cnotin $hashes){throw "026: checksum incompatible en migracion $($m.version)."}
  }
}
function Get-Rsp026Snapshot([string[]]$ComposeArguments) {
  return Invoke-Rsp026Sql $ComposeArguments ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'validation-026.sql')))
}
function Get-Rsp026Policy([string[]]$ComposeArguments) {
  return Invoke-Rsp026Sql $ComposeArguments @'
SELECT json_build_object('revision',revision,'rangos',rangos,'excepciones',excepciones,
 'history',(SELECT count(*) FROM politica_numeracion_historial),
 'protected1',numero_protegido(1),'protected3281',numero_protegido(3281),
 'protected3282',numero_protegido(3282)) FROM politica_numeracion WHERE singleton;
'@
}
function Test-Rsp026Upgrade([string[]]$ComposeArguments,[string]$MigrationDir) {
  $ledger=@(Get-Rsp026Ledger $ComposeArguments)
  if(@($ledger | Where-Object {$_.version -eq '026'}).Count){return $false}
  Assert-Rsp026Ledger $ledger 25 $MigrationDir
  $files=@(Get-ChildItem -LiteralPath $MigrationDir -File | Where-Object {$_.Name -match '^\d{3}_.+\.sql$'} | Sort-Object Name)
  if((($files.Name | ForEach-Object {$_.Substring(0,3)}) -join ',') -cne ((0..26 | ForEach-Object {$_.ToString('000')}) -join ',')){
    throw '026: el despliegue inicial debe tener exclusivamente 026 pendiente.'
  }
  return $true
}
function Assert-Rsp026Chain($Chain) {
  if($Chain.active -ne 0 -or $Chain.reservation -ne 31 -or $Chain.deleted31 -ne 1){throw '026: estado de P-3277 inesperado.'}
  $visited=@(19);$current=19;$used=0
  while($current -ne 31){
    $edges=@($Chain.edges | Where-Object { $_.from -eq $current })
    if($edges.Count -ne 1 -or $edges[0].number -ne 3277 -or $edges[0].to -in $visited){throw '026: cadena auditada de P-3277 incompleta o contradictoria.'}
    $current=$edges[0].to;$visited+=,$current;$used++
  }
  if($used -ne @($Chain.edges).Count){throw '026: ramificacion inesperada en P-3277.'}
  foreach($r in $Chain.references){if($r.number -ne 3277 -or $r.id -notin ($visited | ForEach-Object {[string]$_})){throw '026: referencia historica contradictoria.'}}
  if(@($Chain.references | Where-Object {$_.id -eq '19' -and $_.number -eq '3277'}).Count -ne 1){throw '026: referencia original 19 no conservada.'}
}
function Assert-Rsp026Baseline($Snapshot) {
  Assert-Rsp026Chain $Snapshot.chain
  if(($Snapshot.authorized -join ',') -cne '1' -or $Snapshot.admin1 -ne $true){throw '026: capacidad especial o cuenta administrativa inesperada.'}
  if($null -eq $Snapshot.counter.proximo -or $null -eq $Snapshot.counter.mayor_asignado){throw '026: contador no configurado.'}
}
function Assert-Rsp026Policy($Policy,[switch]$Api) {
  if([string]$Policy.revision -cne '1' -or @($Policy.rangos).Count -ne 1 -or $Policy.rangos[0].desde -ne 1 -or $Policy.rangos[0].hasta -ne 3281 -or $null -eq $Policy.excepciones -or @($Policy.excepciones).Count -ne 0){throw '026: politica inicial o excepciones inesperadas.'}
  if($Api){if($Policy.puede_administrar -ne $true -or $null -eq $Policy.historial -or @($Policy.historial).Count -ne 0){throw '026: contrato API/politica o autorizacion incompatible.'}}
  elseif($Policy.history -ne 0 -or $Policy.protected1 -ne $true -or $Policy.protected3281 -ne $true -or $Policy.protected3282 -ne $false){throw '026: proteccion historica o auditoria inicial incompatible.'}
}
function Assert-Rsp026Conservation($Before,$After) {
  Assert-Rsp026Baseline $After
  foreach($field in @('counter','protected','authorized','admin1','chain')){
    if((ConvertTo-Json -InputObject $Before.$field -Depth 12 -Compress) -cne (ConvertTo-Json -InputObject $After.$field -Depth 12 -Compress)){throw "026: cambio inesperado en $field; reapertura bloqueada."}
  }
  if((ConvertTo-Json -InputObject @($Before.ledger) -Compress) -cne (ConvertTo-Json -InputObject @($After.ledger | Where-Object {$_.version -ne '026'}) -Compress)){throw '026: ledger anterior modificado.'}
}
function Assert-Rsp026Images([string[]]$ComposeArguments,[string]$GitSha,[string]$ApiImage,[string]$FrontImage) {
  foreach($service in @('api','front')){
    $id=(& docker compose @ComposeArguments ps -q $service | Out-String).Trim()
    if($LASTEXITCODE -ne 0 -or -not $id){throw "026: falta $service."}
    $c=(& docker inspect $id | ConvertFrom-Json)[0]
    if($LASTEXITCODE -ne 0){throw '026: no se pudo verificar el contenedor.'}
    $ref=if($service -eq 'api'){$ApiImage}else{$FrontImage}
    $image=(& docker image inspect $ref | ConvertFrom-Json)[0]
    if($LASTEXITCODE -ne 0 -or $c.Image -cne $image.Id -or $image.Config.Labels.'org.opencontainers.image.revision' -cne $GitSha -or $c.State.Health.Status -ne 'healthy'){throw "026: imagen/version/salud incompatible de $service."}
    if($service -eq 'api' -and $c.Config.Env -cnotcontains "GIT_SHA=$GitSha"){throw '026: GIT_SHA de API incompatible.'}
  }
}
