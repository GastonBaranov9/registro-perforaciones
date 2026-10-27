# Initial 026 -> 027 gate. No policy defaults or company record IDs are enforced.
. (Join-Path $PSScriptRoot 'validation-026.ps1')
function Write-Rsp027Evidence([string]$Path,$Evidence) {
  # Write-through errors must prevent the success mark and reopening.
  [IO.File]::WriteAllText($Path,(ConvertTo-Json -InputObject $Evidence -Depth 40),[Text.UTF8Encoding]::new($false))
}
function Assert-Rsp027Persistence([string[]]$ComposeArguments,[string]$BundlePath) {
  $expected=(Get-FileHash -LiteralPath (Join-Path $BundlePath 'persistence.inventory') -Algorithm SHA256).Hash.ToLowerInvariant()
  $id=(& docker compose @ComposeArguments ps -q api | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or -not $id){throw '027: API no identificada para verificar persistencia.'}
  $savedEncoding=$OutputEncoding
  try{
    $OutputEncoding=[Text.UTF8Encoding]::new($false)
    $result=([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'validation-027-persistence.mjs')) | & docker exec -i $id node --input-type=module | Out-String)
    if($LASTEXITCODE -ne 0){throw '027: fallo al inventariar persistencia READ ONLY.'}
    $inventory=$result | ConvertFrom-Json
    if($inventory.sha256 -cne $expected -or $inventory.entries -lt 1){throw '027: persistencia no coincide con respaldo verificado.'}
    return $inventory
  }finally{$OutputEncoding=$savedEncoding}
}
function Get-Rsp027Snapshot([string[]]$ComposeArguments) {
  return Invoke-Rsp026Sql $ComposeArguments ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'validation-027.sql')))
}
function Assert-Rsp027BuildSource([string]$Repo,[string]$GitSha) {
  $head=(& git -C $Repo rev-parse HEAD | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $head -cne $GitSha){throw '027: HEAD no coincide con el SHA a construir.'}
  $dirty=(& git -C $Repo status --porcelain=v1 | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $dirty){throw '027: construir requiere checkout limpio del SHA autorizado.'}
}
function Assert-Rsp027TargetMigrations([string]$ApiImage,[string]$FrontImage,[string]$GitSha,[string]$MigrationDir) {
  foreach($ref in @($ApiImage,$FrontImage)){
    $label=(& docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' $ref | Out-String).Trim()
    if($LASTEXITCODE -ne 0 -or $label -cne $GitSha){throw '027: etiqueta SHA de imagen objetivo incompatible.'}
  }
  # Never start the application, attach networks/volumes, or supply DB secrets.
  $js="const f=require('fs'),c=require('crypto');console.log(JSON.stringify(f.readdirSync('/api/db/migrations').filter(n=>/^\d{3}_.+\.sql$/.test(n)).sort().map(n=>({version:n.slice(0,3),nombre:n.slice(4,-4),checksum_sha256:c.createHash('sha256').update(f.readFileSync('/api/db/migrations/'+n,'utf8').replace(/\r\n/g,'\n')).digest('hex')}))));"
  $json=(& docker run --rm --pull=never --network none --read-only --entrypoint node $ApiImage -e $js | Out-String)
  if($LASTEXITCODE -ne 0){throw '027: no se pudo inspeccionar el inventario de migraciones de la imagen.'}
  $imageLedger=$json | ConvertFrom-Json
  Assert-Rsp026Ledger $imageLedger 27 $MigrationDir
}
function Assert-Rsp027Equal($Before,$After,[string]$Field) {
  if($null -eq $Before -or $null -eq $After -or
    (ConvertTo-Json -InputObject $Before -Depth 30 -Compress) -cne (ConvertTo-Json -InputObject $After -Depth 30 -Compress)){
    throw "027: cambio o evidencia ausente en $Field; reapertura bloqueada."
  }
}
function Test-Rsp027Upgrade([string[]]$ComposeArguments,[string]$MigrationDir,$PriorAudit=$null,[string]$PreviousSha='') {
  $ledger=@(Get-Rsp026Ledger $ComposeArguments)
  if(@($ledger | Where-Object {$_.version -eq '027'}).Count){
    if($null -eq $PriorAudit -or $PriorAudit.status -ne 'success' -or $PriorAudit.validation_027 -notin @('passed','not_required') -or $PriorAudit.git_sha -cne $PreviousSha){throw '027: esquema ya aplicado sin cierre coherente; revisar recuperacion manual.'}
    return $false
  }
  Assert-Rsp026Ledger $ledger 26 $MigrationDir
  $versions=@(Get-ChildItem -LiteralPath $MigrationDir -File | Where-Object {$_.Name -match '^\d{3}_.+\.sql$'} | Sort-Object Name | ForEach-Object {$_.Name.Substring(0,3)})
  if(($versions -join ',') -cne ((0..27 | ForEach-Object {$_.ToString('000')}) -join ',')){throw '027: debe ser la unica migracion pendiente.'}
  $state=Invoke-Rsp026Sql $ComposeArguments "SELECT json_build_object('table_exists',to_regclass('public.prefiltro_pozo') IS NOT NULL);"
  if($null -eq $state -or $state.table_exists -ne $false){throw '027: tabla anticipada o estado incompleto; requiere revision del operador.'}
  return $true
}
function Assert-Rsp027Baseline($Snapshot) {
  foreach($field in @('ledger','counter','data','schema','functions','sequences','sessions')){
    if($null -eq $Snapshot.$field){throw "027: baseline incompleta ($field)."}
  }
  if($null -ne $Snapshot.prefiltro -or $null -ne $Snapshot.prefiltro_rows){throw '027: baseline ya contiene prefiltro; no es una actualizacion inicial.'}
  foreach($name in @('pozo','usuario','usuario_rol','rol','permiso','rol_permiso','politica_numeracion','politica_numeracion_historial','numeracion_perforacion','numero_perforacion_reservado','sello_sanitario_pozo','intervalo_filtro','intervalo_litologico','documento','informe','creacion_offline','creacion_historica','reingreso_historico','administracion_eliminacion')){
    if($null -eq $Snapshot.data.$name -or $Snapshot.data.$name.hash -cnotmatch '^[a-f0-9]{64}$'){throw "027: falta huella de $name."}
  }
}
function Assert-Rsp027Structure($Snapshot) {
  $s=$Snapshot.prefiltro
  if($null -eq $s -or $null -eq $Snapshot.prefiltro_rows -or $Snapshot.prefiltro_rows -ne 0){throw '027: tabla ausente o filas inventadas.'}
  if($s.rls -ne $false -or $s.force_rls -ne $false -or @($s.triggers).Count -ne 0){throw '027: RLS/triggers inesperados.'}
  $columns=@($s.columns)
  if(($columns.name -join ',') -cne 'id_pozo,desde_m,hasta_m' -or ($columns.type -join ',') -cne 'bigint,numeric,numeric'){throw '027: columnas incompatibles.'}
  foreach($c in $columns){if($c.notnull -ne $true -or $c.identity -ne '' -or $null -ne $c.default){throw '027: nulabilidad/default inesperado.'}}
  $expected=@(
    'PRIMARY KEY (id_pozo, desde_m)',
    'FOREIGN KEY (id_pozo) REFERENCES pozo(id_pozo) ON DELETE CASCADE',
    'CHECK (((desde_m >= (0)::numeric) AND (desde_m < hasta_m)))',
    "CHECK ((desde_m <> ALL (ARRAY['NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric])))",
    "CHECK ((hasta_m <> ALL (ARRAY['NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric])))"
  ) | Sort-Object
  # PostgreSQL 18 also exposes NOT NULL in pg_constraint; attnotnull above is
  # authoritative on both the production PostgreSQL 16 and the local 18 lab.
  Assert-Rsp027Equal @($expected) @($s.constraints | Where-Object {$_.type -ne 'n'} | ForEach-Object {$_.def} | Sort-Object) 'constraints prefiltro'
  foreach($c in $s.constraints){if($c.validated -ne $true -or $c.deferred -ne $false){throw '027: constraint no validada o diferible.'}}
  if(@($s.indexes).Count -ne 1 -or $s.indexes[0].valid -ne $true -or $s.indexes[0].ready -ne $true -or
    $s.indexes[0].def -cne 'CREATE UNIQUE INDEX prefiltro_pozo_pkey ON public.prefiltro_pozo USING btree (id_pozo, desde_m)'){throw '027: indice incompatible.'}
}
function Assert-Rsp027Conservation($Before,$After,[long]$SmokeUser=0) {
  Assert-Rsp027Baseline $Before
  Assert-Rsp027Structure $After
  foreach($field in @('counter','schema','functions','sequences')){Assert-Rsp027Equal $Before.$field $After.$field $field}
  Assert-Rsp027Equal @($Before.ledger) @($After.ledger | Where-Object {$_.version -ne '027'}) 'ledger previo'
  if($SmokeUser -eq 0){Assert-Rsp027Equal $Before.data $After.data 'datos completos';Assert-Rsp027Equal $Before.sessions $After.sessions 'sesiones';return}
  # The existing smoke logs out, incrementing only its user's version_sesion.
  # Native session janitor can clean technical session/ticket rows after API starts.
  Assert-Rsp027Equal @($Before.data.PSObject.Properties.Name) @($After.data.PSObject.Properties.Name) 'inventario de tablas'
  foreach($p in $Before.data.PSObject.Properties){
    if($p.Name -in @('sesion_nativa','ticket_ws_nativo')){continue}
    if($p.Name -eq 'usuario'){
      Assert-Rsp027Equal $p.Value.business $After.data.usuario.business 'usuarios/roles sin version de sesion'
      Assert-Rsp027Equal $p.Value.count $After.data.usuario.count 'cantidad de usuarios'
    }else{Assert-Rsp027Equal $p.Value $After.data.($p.Name) $p.Name}
  }
  if(@($Before.sessions | Where-Object {$_.id -eq $SmokeUser}).Count -ne 1){throw '027: usuario smoke no pertenece al baseline.'}
  $expected=@($Before.sessions | ForEach-Object {[pscustomobject]@{id=$_.id;version=([long]$_.version + $(if($_.id -eq $SmokeUser){1}else{0}))}})
  Assert-Rsp027Equal $expected @($After.sessions) 'versiones de sesion tras logout smoke'
}
function Assert-Rsp027Services([string[]]$ComposeArguments) {
  foreach($service in @('postgres','api','front','proxy')){
    $id=(& docker compose @ComposeArguments ps -q $service | Out-String).Trim()
    if($LASTEXITCODE -ne 0 -or -not $id){throw "027: falta servicio $service."}
    $state=(& docker inspect --format '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' $id | Out-String).Trim()
    if($LASTEXITCODE -ne 0 -or $state -ne 'running/healthy'){throw "027: $service no saludable."}
  }
}
function Assert-Rsp027ApiDetail($Detail) {
  if($null -eq $Detail -or $null -eq $Detail.PSObject.Properties['prefiltro_constructivo'] -or
    $Detail.prefiltro_constructivo -isnot [array] -or $Detail.prefiltro_constructivo.Count -ne 0){throw '027: detalle legado sin contrato de prefiltro vacio.'}
}
function Assert-Rsp027ApiProfile($Profile) {
  if($null -eq $Profile -or $Profile.prefiltro_constructivo -isnot [array] -or $Profile.prefiltro_constructivo.Count -ne 0 -or
    $Profile.profundidad_m -le 0 -or $Profile.rangos -isnot [array] -or $Profile.rangos.Count -eq 0 -or
    $Profile.tramos -isnot [array] -or $Profile.etiquetas -isnot [array]){throw '027: perfil legado ilegible o incompatible.'}
}
