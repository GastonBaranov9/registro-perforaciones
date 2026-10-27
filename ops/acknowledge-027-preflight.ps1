param(
  [Parameter(Mandatory=$true)][string]$EnvFile,
  [Parameter(Mandatory=$true)][string]$DeploymentStateFile,
  [Parameter(Mandatory=$true)][string]$StateDir,
  [Parameter(Mandatory=$true)][string]$ProjectName,
  [Parameter(Mandatory=$true)][string]$IncidentSha256,
  [Parameter(Mandatory=$true)][string]$Operator,
  [Parameter(Mandatory=$true)][string]$Reason,
  [Parameter(Mandatory=$true)][string]$NewGitSha,
  [Parameter(Mandatory=$true)][string]$Confirm,
  [Parameter(Mandatory=$true)][string]$PreviousStateFile,
  [Parameter(Mandatory=$true)][string]$PreviousAuditFile,
  [Parameter(Mandatory=$true)][string]$LogFile,
  [string]$ComposeFile='docker-compose.production.yaml'
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'recognition-027.ps1')
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$state=(Resolve-Path -LiteralPath $DeploymentStateFile).Path
$compose=@('--project-name',$ProjectName,'--env-file',(Resolve-Path -LiteralPath $EnvFile).Path,'--env-file',$state,'-f',(Resolve-Path (Join-Path $repo $ComposeFile)).Path)
$lock=Open-DeploymentOperationLock $state
try{
  $result=New-Rsp027Recognition $StateDir $ProjectName $state $compose (Join-Path $repo 'api/db/migrations') $IncidentSha256 $Operator $Reason $NewGitSha $Confirm $PreviousStateFile $PreviousAuditFile $LogFile
  $result | ConvertTo-Json
}finally{$lock.Dispose()}
