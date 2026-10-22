# Focused preflight functions only; every Docker call is a closed mock.
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../ops/deploy.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Invalid syntax'}
foreach($name in @('ContainerValue','Assert-RuntimeImage')){
  $f=$ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst]-and $_.Name-eq $name}
  if(-not $f){throw "Missing function $name"}
  . ([scriptblock]::Create($f.Extent.Text))
}
$compose=@('--project-name','rsp-identity-mock')
$expectedId='sha256:'+('a'*64);$otherId='sha256:'+('b'*64)
function docker {
  $a=@($args);$global:LASTEXITCODE=0
  if($a[0]-eq 'image'-and $a[1]-eq 'inspect'){
    if($a[-1]-ne ('fixture-'+$service+':'+('c'*40))){throw 'Unexpected reference'}
    switch($case){
      'missing-image' {$global:LASTEXITCODE=1;return}
      'failed-image-with-output' {$global:LASTEXITCODE=1;$expectedId;return}
      'malformed-image' {'sha256:short';return}
    }
    $expectedId;return
  }
  if($a[0]-eq 'compose'-and ($a -join ' ')-eq "compose --project-name rsp-identity-mock ps -q $service"){
    if($case-ne 'missing-container'){"$service-id"};return
  }
  if($a[0]-eq 'inspect'-and $a[2]-eq '{{.Image}}'-and $a[-1]-eq "$service-id"){
    switch($case){
      'different-content' {$otherId;return}
      'inspect-failed' {$global:LASTEXITCODE=1;$expectedId;return}
      'empty-runtime' {return}
    }
    $expectedId;return
  }
  throw 'Forbidden Docker operation (including textual Config.Image comparisons)'
}
$count=0
try{
  foreach($service in @('api','front')){
    foreach($case in @('alias-same-content','different-content','missing-image','failed-image-with-output','malformed-image','missing-container','inspect-failed','empty-runtime')){
      $failed=$false;$actual=$null
      try{$actual=Assert-RuntimeImage $service ('fixture-'+$service+':'+('c'*40))}catch{$failed=$true}
      if($case-eq 'alias-same-content'){if($failed-or $actual-cne $expectedId){throw "Rejected equivalent image: $service"}}
      elseif(-not $failed){throw "Accepted invalid identity: $service/$case"}
      $count++
    }
  }
  "IMAGE_IDENTITY_PS_OK $count/16; no real Docker commands"
}finally{Remove-Item Function:\docker -ErrorAction SilentlyContinue}
