[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$runnerPath = Join-Path $PSScriptRoot "run-windows-runtime-hidden.vbs"
$wscriptPath = Join-Path $env:SystemRoot "System32\wscript.exe"

if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
  throw "Hidden runtime launcher not found: $runnerPath"
}

$taskDefinitions = @(
  @{ Name = "NLR L1 API"; Service = "api" },
  @{ Name = "NLR Autonomous Agent"; Service = "autonomy" },
  @{ Name = "NLR Runtime Manager"; Service = "manager" }
)

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -Hidden `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

foreach ($definition in $taskDefinitions) {
  $existing = Get-ScheduledTask -TaskName $definition.Name -ErrorAction SilentlyContinue
  if ($existing -and $existing.State -eq "Running") {
    Stop-ScheduledTask -TaskName $definition.Name
  }

  $arguments = '"{0}" {1}' -f $runnerPath, $definition.Service
  $action = New-ScheduledTaskAction `
    -Execute $wscriptPath `
    -Argument $arguments `
    -WorkingDirectory $projectRoot

  Register-ScheduledTask `
    -TaskName $definition.Name `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Mind runtime service launched without a visible console window." `
    -Force | Out-Null

  Start-ScheduledTask -TaskName $definition.Name
}

Get-ScheduledTask -TaskName ($taskDefinitions.Name) |
  Select-Object TaskName, State, @{Name = "Execute"; Expression = { $_.Actions.Execute } },
    @{Name = "Arguments"; Expression = { $_.Actions.Arguments } }
