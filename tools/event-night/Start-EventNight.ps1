param(
  [string]$ProjectId = 'demo-filmovy-kviz-v2',
  [switch]$SkipBrowser,
  [switch]$NonInteractive,
  [int]$StartupTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'tools\local-qa\LocalQa.Common.ps1')
. (Join-Path $PSScriptRoot 'EventNight.Common.ps1')
$Host.UI.RawUI.WindowTitle = 'JustKvíz - event night'
$startedWorker = $null
$stateWritten = $false

function Complete-EventNightWindow {
  if (-not $NonInteractive) {
    Write-Host ''
    Read-Host 'Stiskněte Enter pro zavření tohoto informačního okna' | Out-Null
  }
}

try {
  Write-Host ''
  Write-Host 'JustKvíz - EVENT NIGHT' -ForegroundColor White
  Write-Host '================================' -ForegroundColor DarkGray
  Write-QaInfo 'Ověřuji demo-only konfiguraci, production build a persistentní snapshot...'

  Assert-SafeLocalConfiguration $repoRoot $ProjectId
  if ($ProjectId -ne $script:EventNightProjectId) {
    Throw-QaError "Nepovolené project ID '$ProjectId'." "Použijte pouze $script:EventNightProjectId."
  }
  $nodeTool = Resolve-NodeTool $repoRoot
  $javaTool = Resolve-JavaTool $repoRoot
  $pnpmTool = Resolve-PnpmTool $repoRoot $nodeTool
  $gitTool = Resolve-GitTool
  if ($null -eq $gitTool) {
    Throw-QaError 'Git nebyl nalezen; nelze ověřit release HEAD.' 'Nainstalujte Git nebo spusťte launcher z Codex prostředí.'
  }
  Set-SafeChildEnvironment $repoRoot $nodeTool $pnpmTool $javaTool $ProjectId
  Set-EventNightEmulatorEnvironment $ProjectId
  $paths = Get-EventNightPaths $repoRoot
  Assert-EventNightPath $repoRoot $paths.DataDirectory
  New-Item -ItemType Directory -Path $paths.DataDirectory -Force | Out-Null

  $state = Get-EventNightState $paths
  if ($null -ne $state -and
      [string]$state.repositoryRoot -eq $repoRoot -and
      [string]$state.projectId -eq $ProjectId -and
      (Test-EventNightWorker $state.emulators ([string]$state.runToken))) {
    $missing = @($script:EventNightPorts.Values | Where-Object { -not (Test-TcpPort ([int]$_)) })
    if ($missing.Count -eq 0 -and (Test-EventNightPage)) {
      $health = Invoke-EventNightHealth $repoRoot $nodeTool $paths
      Write-EventNightReady $health
      Write-QaInfo 'Správné event-night prostředí již běželo; další proces nebyl spuštěn.'
      if (-not $SkipBrowser) { Start-Process $script:EventNightUrl }
      Complete-EventNightWindow
      exit 0
    }
    Throw-QaError 'Evidované event-night prostředí není kompletní.' 'Spusťte tools\legacy\STOP_EVENT_NIGHT.cmd a potom tools\legacy\START_EVENT_NIGHT.cmd znovu.'
  }
  if ($null -ne $state) {
    $trackedStillExists = $null -ne (Get-Process -Id ([int]$state.emulators.pid) -ErrorAction SilentlyContinue)
    if ($trackedStillExists) {
      Throw-QaError 'Existuje neověřitelný aktivní event-night proces.' 'Nic nebylo ukončeno. Požádejte vývojáře o kontrolu run-state.json.'
    }
    Remove-Item -LiteralPath $paths.StatePath -Force
  }

  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules\.bin\firebase.cmd')) -or
      -not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules\@playwright\test'))) {
    Throw-QaError 'Projektové dependencies nejsou připravené.' 'Spusťte tools\legacy\PREPARE_EVENT_NIGHT.cmd; běžný start záměrně nic nestahuje.'
  }
  Assert-EventNightBuildManifest $repoRoot $gitTool $paths
  Restore-EventNightSnapshot $repoRoot $paths | Out-Null
  Assert-EventNightSnapshot $paths.SnapshotDirectory $paths | Out-Null
  $backup = Backup-EventNightSnapshot $repoRoot $paths 'before-start'
  Write-QaSuccess "Known-good snapshot ověřen a zálohován: $backup"

  foreach ($entry in $script:EventNightPorts.GetEnumerator()) {
    if (Test-TcpPort ([int]$entry.Value)) {
      $owner = Get-PortOwnerText ([int]$entry.Value)
      Throw-QaError "Port $($entry.Value) ($($entry.Key)) používá cizí proces: $owner." 'Ukončete pouze konfliktní aplikaci; neukončujte plošně Node ani Java.'
    }
  }

  $runToken = [Guid]::NewGuid().ToString('N')
  Write-QaInfo 'Spouštím Auth, Firestore, Functions, Storage a production Hosting emulátory z ověřeného snapshotu...'
  $startedWorker = Start-EventNightWorker -Mode 'Import' -RunToken $runToken -RepoRoot $repoRoot -PnpmTool $pnpmTool -NodeTool $nodeTool -JavaTool $javaTool -Paths $paths
  Wait-ForPorts @($script:EventNightPorts.Values) $startedWorker $StartupTimeoutSeconds 'Event-night emulátory'
  Wait-ForEventNightPage $startedWorker $StartupTimeoutSeconds

  Write-QaInfo 'Ověřuji admin účet, candidate dokument a preflight v reálném production buildu...'
  $health = Invoke-EventNightHealth $repoRoot $nodeTool $paths
  $statePayload = [ordered]@{
    schemaVersion = 1
    projectId = $ProjectId
    repositoryRoot = $repoRoot
    runToken = $runToken
    createdAtUtc = [DateTime]::UtcNow.ToString('o')
    emulators = [ordered]@{ pid = $startedWorker.Id; startedAtUtc = Get-ProcessStartUtc $startedWorker }
  }
  $statePayload | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $paths.StatePath -Encoding UTF8
  $stateWritten = $true

  Write-EventNightReady $health
  if (-not $SkipBrowser) {
    Start-Process $script:EventNightUrl
    Write-QaSuccess 'Lokální přihlašovací stránka byla otevřena.'
  }
  Complete-EventNightWindow
  exit 0
} catch {
  Write-Host ''
  Write-Host '[CHYBA]' -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  if (-not $stateWritten -and $null -ne $startedWorker) {
    try {
      $startedWorker.Refresh()
      if (-not $startedWorker.HasExited) {
        & taskkill.exe /PID $startedWorker.Id /T /F | Out-Null
      }
    } catch { Write-QaWarning 'Neúspěšně spuštěný vlastní worker se nepodařilo automaticky uklidit.' }
  }
  Complete-EventNightWindow
  exit 1
}
