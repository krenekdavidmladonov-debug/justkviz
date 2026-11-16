param(
  [string]$ProjectId = 'demo-filmovy-kviz-v2',
  [switch]$SkipBrowser,
  [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'tools\local-qa\LocalQa.Common.ps1')
. (Join-Path $repoRoot 'tools\event-night\EventNight.Common.ps1')
. (Join-Path $PSScriptRoot 'TonightRepair.Common.ps1')
$Host.UI.RawUI.WindowTitle = 'JustKvíz - opravy na večer'

function Complete-TonightRepairWindow {
  if (-not $NonInteractive) {
    Write-Host ''
    Read-Host 'Stiskněte Enter pro zavření tohoto informačního okna' | Out-Null
  }
}

try {
  Write-Host ''
  Write-Host 'JustKvíz - OPRAVY NA VEČER' -ForegroundColor White
  Write-Host '====================================' -ForegroundColor DarkGray
  Assert-SafeLocalConfiguration $repoRoot $ProjectId
  if ($ProjectId -ne $script:EventNightProjectId) {
    Throw-QaError "Nepovolené project ID '$ProjectId'." "Použijte pouze $script:EventNightProjectId."
  }
  $nodeTool = Resolve-NodeTool $repoRoot
  $javaTool = Resolve-JavaTool $repoRoot
  $pnpmTool = Resolve-PnpmTool $repoRoot $nodeTool
  $gitTool = Resolve-GitTool
  if ($null -eq $gitTool) { Throw-QaError 'Git nebyl nalezen.' 'Nelze ověřit přesný source revision.' }
  Set-SafeChildEnvironment $repoRoot $nodeTool $pnpmTool $javaTool $ProjectId
  Set-EventNightEmulatorEnvironment $ProjectId
  $eventPaths = Get-EventNightPaths $repoRoot
  $repairPaths = Get-TonightRepairPaths $repoRoot
  $state = Get-EventNightState $eventPaths

  if ($null -ne $state) {
    $recordedProcess = Get-Process -Id ([int]$state.emulators.pid) -ErrorAction SilentlyContinue
    if ($null -ne $recordedProcess -and
        -not (Test-EventNightWorker $state.emulators ([string]$state.runToken))) {
      Throw-QaError 'Existuje aktivní proces se zastaralou nebo neověřitelnou event-night identitou.' 'Nic nebylo ukončeno. Požádejte vývojáře o kontrolu run-state.json.'
    }
    if ($null -eq $recordedProcess) {
      Remove-Item -LiteralPath $eventPaths.StatePath -Force
      $state = $null
      Write-QaInfo 'Odstraněn neaktivní run-state po předchozím ukončeném workeru.'
    }
  }

  if ($null -eq $state) {
    Assert-EventNightSnapshot $eventPaths.SnapshotDirectory $eventPaths | Out-Null
    $gitStatus = (& $gitTool.Path -C $repoRoot status --porcelain=v1 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not [string]::IsNullOrWhiteSpace($gitStatus)) {
      Throw-QaError 'Repair launcher vyžaduje čistý checkout.' 'Uložte vývojové změny; obsahové opravy patří pouze do lokálního emulator snapshotu.'
    }
    Write-QaInfo 'Sestavuji production preview pro přesný čistý HEAD...'
    if ((Invoke-PnpmTool $pnpmTool @('build')) -ne 0) {
      Throw-QaError 'Production preview build selhal.' 'Žádná lokální kvízová data nebyla změněna.'
    }
    New-EventNightBuildManifest $repoRoot $gitTool $eventPaths
    Assert-EventNightBuildManifest $repoRoot $gitTool $eventPaths
  }

  Write-QaInfo 'Spouštím ověřený persistentní demo snapshot; launcher před startem vytvoří backup...'
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'tools\event-night\Start-EventNight.ps1') -ProjectId $ProjectId -SkipBrowser -NonInteractive
  if ($LASTEXITCODE -ne 0) { Throw-QaError 'Event-night start selhal.' 'Snapshot zůstal chráněný; zkontrolujte výpis výše.' }

  $health = Invoke-EventNightHealth $repoRoot $nodeTool $eventPaths
  $repair = Invoke-TonightRepairCheck $repoRoot $nodeTool $eventPaths $repairPaths
  $sourceHead = Get-EventNightGitHead $repoRoot $gitTool
  $progress = [ordered]@{
    schemaVersion = 1
    projectId = $script:EventNightProjectId
    checkedAtUtc = [DateTime]::UtcNow.ToString('o')
    sourceRevision = $sourceHead
    candidateQuizId = [string]$repair.candidate.quizId
    initialBlockers = [int]$health.readiness.blockers
    remainingBlockers = [int]$repair.readiness.blockers
    warnings = [int]$repair.readiness.warnings
    backupVerified = $true
    containsPrivateContent = $false
  }
  New-Item -ItemType Directory -Path $repairPaths.Directory -Force | Out-Null
  $progress | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $repairPaths.ProgressReport -Encoding UTF8

  $repairUrl = "$script:TonightRepairBaseUrl/admin/quizzes/$([Uri]::EscapeDataString([string]$repair.candidate.quizId))/readiness/repair"
  Write-Host ''
  Write-QaSuccess 'JustKvíz běží lokálně.'
  Write-Host ''
  Write-Host "Kvíz: $($repair.candidate.title)"
  Write-Host "Zbývající problémy: $($repair.readiness.blockers)"
  Write-Host "Repair URL: $repairUrl"
  Write-Host ''
  Write-Host 'Login:'
  Write-Host 'admin@example.test'
  Write-Host 'LocalQuiz123!'
  Write-Host ''
  Write-Host 'Po opravách použij: tools\legacy\VERIFY_TONIGHT_GO_NO_GO.cmd'
  Write-Host 'Po skončení vždy použij: tools\legacy\STOP_EVENT_NIGHT.cmd'
  if (-not $SkipBrowser) {
    Start-Process $repairUrl
    Write-QaSuccess 'Lokální repair route byla otevřena; heslo nebylo vyplněno automaticky.'
  }
  Complete-TonightRepairWindow
  exit 0
} catch {
  Write-Host ''
  Write-Host '[CHYBA]' -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-QaWarning 'V1 fallback zůstává nedotčený. Žádný deploy nebyl proveden.'
  Complete-TonightRepairWindow
  exit 1
}
