param([switch]$NonInteractive)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'tools\local-qa\LocalQa.Common.ps1')
. (Join-Path $repoRoot 'tools\event-night\EventNight.Common.ps1')
. (Join-Path $PSScriptRoot 'TonightRepair.Common.ps1')
$Host.UI.RawUI.WindowTitle = 'JustKvíz - tonight go/no-go'

function Complete-GoNoGoWindow {
  if (-not $NonInteractive) {
    Write-Host ''
    Read-Host 'Stiskněte Enter pro zavření tohoto okna' | Out-Null
  }
}

try {
  Write-Host ''
  Write-Host 'JustKvíz - TONIGHT GO/NO-GO' -ForegroundColor White
  Write-Host '=====================================' -ForegroundColor DarkGray
  $eventPaths = Get-EventNightPaths $repoRoot
  $repairPaths = Get-TonightRepairPaths $repoRoot
  $state = Get-EventNightState $eventPaths
  if ($null -eq $state -or
      [string]$state.repositoryRoot -ne $repoRoot -or
      [string]$state.projectId -ne $script:EventNightProjectId -or
      -not (Test-EventNightWorker $state.emulators ([string]$state.runToken))) {
    Throw-QaError 'Neběží identitou ověřené event-night prostředí.' 'Nejdřív spusťte tools\legacy\START_TONIGHT_REPAIR.cmd.'
  }

  Assert-SafeLocalConfiguration $repoRoot $script:EventNightProjectId
  $nodeTool = Resolve-NodeTool $repoRoot
  $javaTool = Resolve-JavaTool $repoRoot
  $pnpmTool = Resolve-PnpmTool $repoRoot $nodeTool
  $gitTool = Resolve-GitTool
  if ($null -eq $gitTool) { Throw-QaError 'Git nebyl nalezen.' 'Nelze ověřit source revision buildu.' }
  Set-SafeChildEnvironment $repoRoot $nodeTool $pnpmTool $javaTool $script:EventNightProjectId
  Set-EventNightEmulatorEnvironment $script:EventNightProjectId
  Assert-EventNightBuildManifest $repoRoot $gitTool $eventPaths
  Assert-EventNightSnapshot $eventPaths.SnapshotDirectory $eventPaths | Out-Null
  Write-QaSuccess 'Demo-only prostředí, production preview a snapshot checksum jsou ověřené.'

  Invoke-EventNightHealth $repoRoot $nodeTool $eventPaths | Out-Null
  $repair = Invoke-TonightRepairCheck $repoRoot $nodeTool $eventPaths $repairPaths
  $report = Invoke-TonightGoNoGo $repoRoot $nodeTool $eventPaths $repairPaths
  Write-Host ''
  if ([int]$repair.readiness.blockers -eq 0 -and [string]$report.verdict -eq 'V2_OBSAHOVE_PRIPRAVENA') {
    Write-Host 'GO — V2 SOFTWARE READY FOR PHYSICAL CHECK' -ForegroundColor Green
    Write-Host ''
    Write-Host 'Zbývá:'
    Write-Host '- fyzický HDMI test;'
    Write-Host '- fyzický zvuk;'
    Write-Host '- fullscreen;'
    Write-Host '- jedno skutečné AUDIO;'
    Write-Host '- jedno skutečné VIDEO;'
    Write-Host '- jeden RECAP.'
  } else {
    Write-Host 'NO-GO — USE V1' -ForegroundColor Yellow
    Write-Host ''
    Write-Host "Zbývá $($repair.readiness.blockers) problémů."
    Write-Host 'Použijte tools\legacy\START_TONIGHT_REPAIR.cmd.'
  }
  Write-Host ''
  Write-Host 'Sanitizovaný lokální report: .local-data\tonight-repair\go-no-go-report.json'
  Complete-GoNoGoWindow
  exit 0
} catch {
  Write-Host ''
  Write-Host 'NO-GO — USE V1' -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-QaWarning 'Verifier preflight neobešel a žádný deploy neprovedl.'
  Complete-GoNoGoWindow
  exit 1
}
