function Remove-OneTerminalLineEnding{
  param([AllowEmptyString()][string]$Value)
  if($Value.EndsWith("`r`n")){return $Value.Substring(0,$Value.Length-2)}
  if($Value.EndsWith("`n")){return $Value.Substring(0,$Value.Length-1)}
  return $Value
}

function Read-OpaqueSecretFile{
  param([Parameter(Mandatory=$true)][string]$Path)
  $resolved=(Resolve-Path -LiteralPath $Path).Path;$item=Get-Item -LiteralPath $resolved -Force
  if(-not $item.PSIsContainer-and -not ($item.Attributes-band [IO.FileAttributes]::ReparsePoint)-and $item.Length-le 4096){return Remove-OneTerminalLineEnding ([IO.File]::ReadAllText($resolved,[Text.UTF8Encoding]::new($false)))}
  throw "El archivo secreto no es un archivo regular valido."
}
