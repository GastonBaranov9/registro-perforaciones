$script:DeploymentStateKeys = @(
  "DEPLOYMENT_STATE_FORMAT",
  "API_IMAGE_REF",
  "FRONT_IMAGE_REF",
  "APP_VERSION",
  "GIT_SHA",
  "DEPLOY_CONFIG_SHA256"
)

function Assert-DeploymentImageRef {
  param([Parameter(Mandatory = $true)][string]$Value)
  if ($Value -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._/@:-]*$' -or ([regex]::Matches($Value, '@').Count -gt 1)) {
    throw "Las imagenes del estado deben usar tag/digest explicito y nunca latest."
  }

  $repository = $Value
  $hasDigest = $false
  $at = $Value.IndexOf('@')
  if ($at -ge 0) {
    $repository = $Value.Substring(0, $at)
    $digest = $Value.Substring($at + 1)
    $hasDigest = $true
    if (-not $repository -or $digest -cnotmatch '^sha256:[a-f0-9]{64}$') {
      throw "La imagen debe usar un digest sha256 completo en minusculas."
    }
  }

  $slash = $repository.LastIndexOf('/')
  $finalComponent = $repository.Substring($slash + 1)
  if (-not $finalComponent) { throw "La referencia de imagen no contiene repositorio." }
  $colon = $finalComponent.LastIndexOf(':')
  $tag = $null
  if ($colon -ge 0) {
    $imageName = $finalComponent.Substring(0, $colon)
    $tag = $finalComponent.Substring($colon + 1)
    if (-not $imageName -or $tag -cnotmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') {
      throw "El tag explicito de la imagen no es valido."
    }
    if ($tag.Equals('latest', [StringComparison]::OrdinalIgnoreCase)) {
      throw "El tag latest no es reproducible."
    }
  }

  if (-not $tag -and -not $hasDigest) {
    throw "La imagen debe incluir tag explicito o digest sha256."
  }
}

function Assert-DeploymentIdentifier {
  param([Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][string]$Value)
  if ($Value -notmatch '^[A-Za-z0-9._-]+$') { throw "$Name no es seguro." }
}

function Get-DeploymentCanonicalText {
  param(
    [Parameter(Mandatory = $true)][string]$ApiImage,
    [Parameter(Mandatory = $true)][string]$FrontImage,
    [Parameter(Mandatory = $true)][string]$AppVersion,
    [Parameter(Mandatory = $true)][string]$GitSha
  )
  Assert-DeploymentImageRef $ApiImage
  Assert-DeploymentImageRef $FrontImage
  Assert-DeploymentIdentifier "APP_VERSION" $AppVersion
  Assert-DeploymentIdentifier "GIT_SHA" $GitSha
  return "DEPLOYMENT_STATE_FORMAT=1`nAPI_IMAGE_REF=$ApiImage`nFRONT_IMAGE_REF=$FrontImage`nAPP_VERSION=$AppVersion`nGIT_SHA=$GitSha`n"
}

function Get-DeploymentConfigHash {
  param(
    [Parameter(Mandatory = $true)][string]$ApiImage,
    [Parameter(Mandatory = $true)][string]$FrontImage,
    [Parameter(Mandatory = $true)][string]$AppVersion,
    [Parameter(Mandatory = $true)][string]$GitSha
  )
  $canonical = Get-DeploymentCanonicalText $ApiImage $FrontImage $AppVersion $GitSha
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($canonical)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) }
  finally { $sha.Dispose() }
}

function Get-DeploymentStateText {
  param(
    [Parameter(Mandatory = $true)][string]$ApiImage,
    [Parameter(Mandatory = $true)][string]$FrontImage,
    [Parameter(Mandatory = $true)][string]$AppVersion,
    [Parameter(Mandatory = $true)][string]$GitSha
  )
  $canonical = Get-DeploymentCanonicalText $ApiImage $FrontImage $AppVersion $GitSha
  $hash = Get-DeploymentConfigHash $ApiImage $FrontImage $AppVersion $GitSha
  return "${canonical}DEPLOY_CONFIG_SHA256=$hash`n"
}

function Read-DeploymentState {
  param([Parameter(Mandatory = $true)][string]$Path)
  $resolved = (Resolve-Path -LiteralPath $Path).Path
  $values = @{}
  foreach ($raw in [IO.File]::ReadAllLines($resolved)) {
    $line = $raw.Trim()
    if (-not $line -or $line.StartsWith('#')) { continue }
    if ($line -notmatch '^([A-Z0-9_]+)=(.*)$') { throw "Linea invalida en deployment state." }
    $key = $Matches[1]; $value = $Matches[2]
    if ($script:DeploymentStateKeys -notcontains $key) { throw "Clave no permitida en deployment state: $key" }
    if ($values.ContainsKey($key)) { throw "Clave duplicada en deployment state: $key" }
    if (-not $value) { throw "Valor vacio en deployment state: $key" }
    $values[$key] = $value
  }
  foreach ($key in $script:DeploymentStateKeys) {
    if (-not $values.ContainsKey($key)) { throw "Falta $key en deployment state." }
  }
  if ($values.DEPLOYMENT_STATE_FORMAT -ne '1') { throw "Formato de deployment state no soportado." }
  $expected = Get-DeploymentConfigHash $values.API_IMAGE_REF $values.FRONT_IMAGE_REF $values.APP_VERSION $values.GIT_SHA
  if ($values.DEPLOY_CONFIG_SHA256 -notmatch '^[a-f0-9]{64}$' -or $values.DEPLOY_CONFIG_SHA256 -cne $expected) {
    throw "Checksum invalido en deployment state."
  }
  return [pscustomobject]@{
    Path = $resolved
    ApiImage = $values.API_IMAGE_REF
    FrontImage = $values.FRONT_IMAGE_REF
    AppVersion = $values.APP_VERSION
    GitSha = $values.GIT_SHA
    ConfigHash = $values.DEPLOY_CONFIG_SHA256
  }
}

function Write-DeploymentStateAtomic {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ApiImage,
    [Parameter(Mandatory = $true)][string]$FrontImage,
    [Parameter(Mandatory = $true)][string]$AppVersion,
    [Parameter(Mandatory = $true)][string]$GitSha
  )
  $fullPath = [IO.Path]::GetFullPath($Path)
  $parent = [IO.Path]::GetDirectoryName($fullPath)
  if (-not [IO.Directory]::Exists($parent)) { throw "El directorio del deployment state no existe." }
  $temp = Join-Path $parent (".{0}.{1}.tmp" -f [IO.Path]::GetFileName($fullPath), [Guid]::NewGuid().ToString('N'))
  $backup = Join-Path $parent (".{0}.{1}.bak" -f [IO.Path]::GetFileName($fullPath), [Guid]::NewGuid().ToString('N'))
  try {
    [IO.File]::WriteAllText($temp, (Get-DeploymentStateText $ApiImage $FrontImage $AppVersion $GitSha), [Text.UTF8Encoding]::new($false))
    Read-DeploymentState $temp | Out-Null
    if ([IO.File]::Exists($fullPath)) { [IO.File]::Replace($temp, $fullPath, $backup) }
    else { [IO.File]::Move($temp, $fullPath) }
    return Read-DeploymentState $fullPath
  }
  finally {
    if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) }
    if ([IO.File]::Exists($backup)) { [IO.File]::Delete($backup) }
  }
}
