param([switch]$NonInteractive)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'tools\local-qa\LocalQa.Common.ps1')
. (Join-Path $PSScriptRoot 'EventNight.Common.ps1')
$Host.UI.RawUI.WindowTitle = 'JustKvíz - event-night checkpoint'

function Complete-BackupWindow {
  if (-not $NonInteractive) {
    Write-Host ''
    Read-Host 'Stiskněte Enter pro zavření tohoto okna' | Out-Null
  }
}

try {
  Write-Host ''
  Write-Host 'JustKvíz - EVENT NIGHT BACKUP' -ForegroundColor White
  Write-Host '=======================================' -ForegroundColor DarkGray
  $paths = Get-EventNightPaths $repoRoot
  $state = Get-EventNightState $paths
  if ($null -eq $state -or
      [string]$state.repositoryRoot -ne $repoRoot -or
      [string]$state.projectId -ne $script:EventNightProjectId -or
      -not (Test-EventNightWorker $state.emulators ([string]$state.runToken))) {
    Throw-QaError 'Neběží identitou ověřené event-night prostředí.' 'Nejdřív spusťte tools\legacy\START_EVENT_NIGHT.cmd.'
  }

  $nodeTool = Resolve-NodeTool $repoRoot
  $javaTool = Resolve-JavaTool $repoRoot
  $pnpmTool = Resolve-PnpmTool $repoRoot $nodeTool
  Set-SafeChildEnvironment $repoRoot $nodeTool $pnpmTool $javaTool $script:EventNightProjectId
  Set-EventNightEmulatorEnvironment $script:EventNightProjectId
  Remove-Item -LiteralPath $paths.HealthPath -Force -ErrorAction SilentlyContinue
  Write-QaInfo 'Aktualizuji preflight health a vytvářím checkpoint bez zastavení aplikace...'
  Invoke-EventNightHealth $repoRoot $nodeTool $paths | Out-Null
  Export-EventNightSnapshot $repoRoot $pnpmTool $paths -Promote | Out-Null
  Write-QaSuccess 'Checkpoint je uložený a ověřený; předchozí known-good snapshot zůstal v backups.'
  Complete-BackupWindow
  exit 0
} catch {
  Write-Host ''
  Write-Host '[CHYBA]' -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-QaWarning 'Poslední known-good snapshot nebyl nahrazen neověřeným exportem.'
  Complete-BackupWindow
  exit 1
}
