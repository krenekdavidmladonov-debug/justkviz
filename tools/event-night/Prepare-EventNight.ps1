param(
  [string]$ProjectId = 'demo-filmovy-kviz-v2',
  [switch]$NonInteractive,
  [int]$StartupTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'tools\local-qa\LocalQa.Common.ps1')
. (Join-Path $PSScriptRoot 'EventNight.Common.ps1')
$Host.UI.RawUI.WindowTitle = 'JustKvíz - první event-night příprava'
$worker = $null

function Complete-PrepareWindow {
  if (-not $NonInteractive) {
    Write-Host ''
    Read-Host 'Stiskněte Enter pro zavření tohoto okna' | Out-Null
  }
}

try {
  Write-Host ''
  Write-Host 'JustKvíz - FIRST PREPARE' -ForegroundColor White
  Write-Host '==================================' -ForegroundColor DarkGray
  Write-QaInfo 'Tato jednorázová akce vytvoří nový production build a první lokální snapshot.'

  Assert-SafeLocalConfiguration $repoRoot $ProjectId
  if ($ProjectId -ne $script:EventNightProjectId) {
    Throw-QaError "Nepovolené project ID '$ProjectId'." "Použijte pouze $script:EventNightProjectId."
  }
  $nodeTool = Resolve-NodeTool $repoRoot
  $javaTool = Resolve-JavaTool $repoRoot
  $pnpmTool = Resolve-PnpmTool $repoRoot $nodeTool
  $gitTool = Resolve-GitTool
  if ($null -eq $gitTool) {
    Throw-QaError 'Git nebyl nalezen; nelze připravit build svázaný s release HEAD.' 'Nainstalujte Git nebo spusťte přípravu z Codex prostředí.'
  }
  Set-SafeChildEnvironment $repoRoot $nodeTool $pnpmTool $javaTool $ProjectId
  Set-EventNightEmulatorEnvironment $ProjectId
  $paths = Get-EventNightPaths $repoRoot
  Assert-EventNightPromotionClear $repoRoot $paths
  New-Item -ItemType Directory -Path $paths.DataDirectory -Force | Out-Null
  if (Test-Path -LiteralPath $paths.SnapshotDirectory) {
    Throw-QaError 'Event-night snapshot už existuje; FIRST PREPARE jej nepřepíše.' 'Použijte tools\legacy\START_EVENT_NIGHT.cmd. Reset musí být samostatné vědomé development rozhodnutí.'
  }
  if (Test-Path -LiteralPath $paths.StatePath) {
    Throw-QaError 'Existuje event-night run-state.' 'Nejdřív bezpečně spusťte tools\legacy\STOP_EVENT_NIGHT.cmd.'
  }
  $gitStatus = (& $gitTool.Path -C $repoRoot status --porcelain=v1 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not [string]::IsNullOrWhiteSpace($gitStatus)) {
    Throw-QaError 'FIRST PREPARE vyžaduje čistý release checkout.' 'Commitněte nebo odložte změny a přípravu spusťte z ověřeného release HEAD.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.local-data\v1-export\library.json') -PathType Leaf)) {
    Throw-QaError 'Chybí lokální read-only V1 export.' 'Doplňte pouze schválený soubor .local-data/v1-export/library.json.'
  }
  foreach ($entry in $script:EventNightPorts.GetEnumerator()) {
    if (Test-TcpPort ([int]$entry.Value)) {
      $owner = Get-PortOwnerText ([int]$entry.Value)
      Throw-QaError "Port $($entry.Value) ($($entry.Key)) používá cizí proces: $owner." 'Ukončete pouze konfliktní aplikaci.'
    }
  }

  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules\.bin\firebase.cmd')) -or
      -not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules\.bin\vitest.cmd'))) {
    Write-QaInfo 'Instaluji přesně lockfile dependencies pomocí Node 22...'
    $installExit = Invoke-PnpmTool $pnpmTool @('install', '--frozen-lockfile')
    if ($installExit -ne 0) { Throw-QaError 'Frozen dependency install selhal.' 'Zkontrolujte připojení a lockfile.' }
  }

  Write-QaInfo 'Vybírám candidate a vytvářím pouze sanitizovaný lokální manifest...'
  if ((Invoke-PnpmTool $pnpmTool @('event-night:candidate')) -ne 0) {
    Throw-QaError 'Candidate preflight/forenzní výběr selhal.' 'Zkontrolujte read-only V1 export a test log.'
  }
  Get-EventNightCandidate $paths | Out-Null

  Write-QaInfo 'Sestavuji production build pro přesný release HEAD...'
  if ((Invoke-PnpmTool $pnpmTool @('build')) -ne 0) {
    Throw-QaError 'Production build selhal.' 'Opravte build bez oslabení validace nebo bezpečnosti.'
  }
  New-EventNightBuildManifest $repoRoot $gitTool $paths
  Assert-EventNightBuildManifest $repoRoot $gitTool $paths
  Write-QaSuccess 'Production build a jeho SHA-256 manifest jsou ověřené.'

  $runToken = [Guid]::NewGuid().ToString('N')
  Write-QaInfo 'Spouštím čisté demo emulátory bez importu...'
  $worker = Start-EventNightWorker -Mode 'Fresh' -RunToken $runToken -RepoRoot $repoRoot -PnpmTool $pnpmTool -NodeTool $nodeTool -JavaTool $javaTool -Paths $paths
  Wait-ForPorts @($script:EventNightPorts.Values) $worker $StartupTimeoutSeconds 'Čisté event-night emulátory'
  Wait-ForEventNightPage $worker $StartupTimeoutSeconds

  Write-QaInfo 'Zakládám pouze demo admin účet...'
  if ((Invoke-PnpmTool $pnpmTool @('seed:auth')) -ne 0) {
    Throw-QaError 'Demo admin seed selhal.' 'Zkontrolujte Auth/Functions emulator log.'
  }
  Write-QaInfo 'Migruji čtyři read-only V1 kvízy pouze do lokálního Firestore Emulatoru...'
  if ((Invoke-PnpmTool $pnpmTool @('migration:v1:emulator')) -ne 0) {
    Throw-QaError 'Lokální V1 migrace selhala.' 'Ponechte zdroj beze změny a zkontrolujte migration report.'
  }
  if ((Invoke-PnpmTool $pnpmTool @('migration:v1:verify-emulator')) -ne 0) {
    Throw-QaError 'Nezávislý migration read-back selhal.' 'Snapshot nebude vytvořen; zkontrolujte integritu migrace.'
  }

  Write-QaInfo 'Ověřuji admin login, candidate dokument a reálný preflight přes production Hosting Emulator...'
  $health = Invoke-EventNightHealth $repoRoot $nodeTool $paths
  Export-EventNightSnapshot $repoRoot $pnpmTool $paths -Promote -Initial | Out-Null
  Assert-EventNightSnapshot $paths.SnapshotDirectory $paths | Out-Null
  Write-QaSuccess 'První persistentní snapshot byl vytvořen a ověřen SHA-256 manifestem.'

  Stop-EventNightWorker ([pscustomobject]@{ pid = $worker.Id; startedAtUtc = Get-ProcessStartUtc $worker }) $runToken
  $worker = $null
  Write-Host ''
  Write-QaSuccess 'FIRST PREPARE dokončen. Žádná produkce nebyla kontaktována.'
  Write-Host "Candidate: $($health.candidateTitle)"
  Write-Host "Připravenost: $($health.readiness.status) — $($health.readiness.blockers) blockerů"
  Write-Host 'Pro běžný start použijte tools\legacy\START_EVENT_NIGHT.cmd.'
  Complete-PrepareWindow
  exit 0
} catch {
  Write-Host ''
  Write-Host '[CHYBA]' -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  if ($null -ne $worker) {
    try {
      $worker.Refresh()
      if (-not $worker.HasExited) { & taskkill.exe /PID $worker.Id /T /F | Out-Null }
    } catch { Write-QaWarning 'Vlastní přípravný worker se nepodařilo automaticky uklidit.' }
  }
  Complete-PrepareWindow
  exit 1
}
