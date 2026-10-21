# Rules from migrations 012/017; 019 keeps the owner constraint unchanged.
function Test-SmokeId($Value) {
  return ($Value -is [ValueType] -and $Value -isnot [bool] -and
    $Value -gt 0 -and $Value -le 9007199254740991 -and [math]::Floor($Value) -eq $Value)
}
function Assert-SmokeWell($Well) {
  if(-not (Test-SmokeId $Well.id_pozo) -or $null -eq $Well.PSObject.Properties['id_propietario']){throw 'Identificador de pozo/propietario invalido o ausente.'}
  $owner=$Well.id_propietario; $provisional=$Well.propietario_provisional
  if($null -ne $owner){
    if(-not (Test-SmokeId $owner) -or $null -ne $provisional){throw 'Propietario real invalido o combinado con provisional.'}
  }elseif($null -ne $provisional){
    if($provisional -isnot [string] -or $provisional.Length -gt 160 -or $provisional.Trim(' ').Length -lt 1){throw 'Propietario provisional invalido.'}
  }elseif($Well.origen -cne 'historico'){throw 'Solo un historico admite propietario desconocido.'}
}
