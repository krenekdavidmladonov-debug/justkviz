Set-StrictMode -Version 2.0

$script:EventNightProjectId = 'demo-filmovy-kviz-v2'
$script:EventNightUrl = 'http://localhost:5000/admin/login'
$script:EventNightPorts = [ordered]@{
  'Emulator UI' = 4000
  'Emulator Hub' = 4400
  'Emulator Logging' = 4500
  'Firebase Hosting' = 5000
  'Functions Emulator' = 5001
  'Firestore Emulator' = 8080
  'Authentication Emulator' = 9099
  'Storage Emulator' = 9199
}

function Get-EventNightPaths {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)

  $dataDirectory = Join-Path $RepoRoot '.local-data\event-night'
  return [pscustomobject]@{
    DataDirectory = $dataDirectory
    SnapshotDirectory = Join-Path $dataDirectory 'emulator-data'
    ExportStaging = Join-Path $dataDirectory 'export-staging'
    BackupDirectory = Join-Path $dataDirectory 'backups'
    PromotionJournal = Join-Path $dataDirectory 'promotion-pending.json'
    StatePath = Join-Path $dataDirectory 'run-state.json'
    BuildManifest = Join-Path $dataDirectory 'build-manifest.json'
    HealthPath = Join-Path $dataDirectory 'health.json'
    EmulatorLog = Join-Path $dataDirectory 'emulators.log'
    CandidateManifest = Join-Path $RepoRoot '.local-data\tomorrow-candidate\candidate-manifest.json'
  }
}

function Set-EventNightEmulatorEnvironment {
  param([Parameter(Mandatory = $true)][string]$ProjectId)

  if ($ProjectId -ne $script:EventNightProjectId -or -not $ProjectId.StartsWith('demo-')) {
    Throw-QaError "Nepovolené event-night project ID '$ProjectId'." "Použijte pouze $script:EventNightProjectId."
  }
  $env:GCLOUD_PROJECT = $ProjectId
  $env:GOOGLE_CLOUD_PROJECT = $ProjectId
  $env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
  $env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  $env:FUNCTIONS_EMULATOR_HOST = '127.0.0.1:5001'
  $env:FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
}

function Assert-EventNightPath {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$Path
  )

  $localRoot = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot '.local-data/event-night'))
  $resolved = [System.IO.Path]::GetFullPath($Path)
  $comparison = if ([System.IO.Path]::DirectorySeparatorChar -eq '\') { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
  if ($Path -match '(^|[\\/])\.\.([\\/]|$)' -or
      (-not $resolved.Equals($localRoot, $comparison) -and -not $resolved.StartsWith($localRoot + [System.IO.Path]::DirectorySeparatorChar, $comparison))) {
    Throw-QaError "Event-night cesta opustila povolený lokální adresář: $resolved" 'Nepokračujte a požádejte vývojáře o kontrolu launcheru.'
  }
  Assert-EventNightNoReparse $resolved
}

function Assert-EventNightNoReparse {
  param([Parameter(Mandatory = $true)][string]$Path, [switch]$Recurse)

  $current = [System.IO.Path]::GetFullPath((Get-EventNightLogicalPath $Path))
  while ($null -ne $current) {
    $attributes = $null
    try { $attributes = [System.IO.File]::GetAttributes((Get-EventNightNativePath $current)) }
    catch [System.IO.FileNotFoundException] { }
    catch [System.IO.DirectoryNotFoundException] { }
    if ($null -ne $attributes) {
      if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        Throw-QaError 'Event-night cesta obsahuje junction nebo symbolický odkaz.' 'Nepokračujte; ponechte data beze změny.'
      }
    }
    $current = [System.IO.Path]::GetDirectoryName($current)
    if ([string]::IsNullOrEmpty($current)) { break }
  }
  if ($Recurse -and [System.IO.Directory]::Exists((Get-EventNightNativePath $Path))) {
    foreach ($child in [System.IO.Directory]::EnumerateFileSystemEntries((Get-EventNightNativePath $Path))) {
      Assert-EventNightNoReparse (Get-EventNightLogicalPath $child) -Recurse
    }
  }
}

function Get-EventNightLogicalPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ([System.IO.Path]::DirectorySeparatorChar -eq '\') {
    if ($Path.StartsWith('\\?\UNC\')) { return '\\' + $Path.Substring(8) }
    if ($Path.StartsWith('\\?\')) { return $Path.Substring(4) }
  }
  return $Path
}

function Get-EventNightNativePath {
  param([Parameter(Mandatory = $true)][string]$Path)
  $nativePath = [System.IO.Path]::GetFullPath((Get-EventNightLogicalPath $Path))
  if ([System.IO.Path]::DirectorySeparatorChar -eq '\') {
    $nativePath = if ($nativePath.StartsWith('\\')) { '\\?\UNC\' + $nativePath.Substring(2) } else { '\\?\' + $nativePath }
  }
  return $nativePath
}

function Get-EventNightFileSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  Assert-EventNightNoReparse $Path
  # WinPS5 Get-FileHash resolves provider paths with the legacy MAX_PATH limit.
  # Hash the already checked literal file with a bounded, disposed .NET stream.
  $nativePath = Get-EventNightNativePath $Path
  if (([System.IO.File]::GetAttributes($nativePath) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    Throw-QaError 'Event-night hash odmítl junction nebo symbolický odkaz.' 'Ponechte snapshot beze změny.'
  }
  $stream = $null
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($nativePath)
    return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
    $algorithm.Dispose()
  }
}

function Copy-EventNightSnapshotDirectory {
  param([string]$RepoRoot, [string]$Source, [string]$Destination)
  Assert-EventNightPath $RepoRoot $Source
  Assert-EventNightPath $RepoRoot $Destination
  Assert-EventNightNoReparse $Source -Recurse
  Assert-EventNightNoReparse $Destination
  $nativeDestination = Get-EventNightNativePath $Destination
  if ([System.IO.Directory]::Exists($nativeDestination) -or [System.IO.File]::Exists($nativeDestination)) {
    Throw-QaError 'Snapshot copy target už existuje.' 'Ponechte všechny snapshoty beze změny.'
  }
  [System.IO.Directory]::CreateDirectory($nativeDestination) | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath (Get-EventNightNativePath $Source) -Force) {
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      Throw-QaError 'Snapshot copy odmítl junction nebo symbolický odkaz.' 'Ponechte snapshot beze změny.'
    }
    $target = Join-Path $Destination $item.Name
    if ($item.PSIsContainer) { Copy-EventNightSnapshotDirectory $RepoRoot (Get-EventNightLogicalPath $item.FullName) $target }
    else {
      Assert-EventNightPath $RepoRoot $target
      [System.IO.File]::Copy((Get-EventNightNativePath $item.FullName), (Get-EventNightNativePath $target), $false)
    }
  }
}

function Get-EventNightFileRecords {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [string[]]$ExcludedNames = @()
  )

  if (-not (Test-Path -LiteralPath (Get-EventNightNativePath $Root) -PathType Container)) { return @() }
  Assert-EventNightNoReparse $Root -Recurse
  $normalizedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $rootPrefix = $normalizedRoot + [System.IO.Path]::DirectorySeparatorChar
  return @(
    Get-ChildItem -LiteralPath (Get-EventNightNativePath $Root) -File -Recurse |
      Where-Object { $_.Name -notin $ExcludedNames } |
      Sort-Object FullName |
      ForEach-Object {
        $fullName = [System.IO.Path]::GetFullPath((Get-EventNightLogicalPath $_.FullName))
        if (-not $fullName.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
          Throw-QaError "Soubor opustil kontrolovaný event-night adresář: $fullName" 'Nepokračujte a požádejte vývojáře o kontrolu launcheru.'
        }
        [ordered]@{
          path = $fullName.Substring($rootPrefix.Length).Replace('\', '/')
          bytes = $_.Length
          sha256 = Get-EventNightFileSha256 $fullName
        }
      }
  )
}

function Get-EventNightGitHead {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$GitTool
  )

  $head = (& $GitTool.Path -C $RepoRoot rev-parse HEAD 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$') {
    Throw-QaError 'Nelze určit release HEAD pro production build.' 'Zkontrolujte Git checkout a spusťte přípravu znovu.'
  }
  return $head
}

function New-EventNightBuildManifest {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$GitTool,
    [Parameter(Mandatory = $true)][psobject]$Paths
  )

  $dist = Join-Path $RepoRoot 'apps\web\dist'
  $records = @(Get-EventNightFileRecords $dist)
  if ($records.Count -eq 0 -or -not (Test-Path -LiteralPath (Join-Path $dist 'index.html'))) {
    Throw-QaError 'Production build je prázdný nebo neobsahuje index.html.' 'Spusťte PREPARE_EVENT_NIGHT.cmd znovu.'
  }
  $manifest = [ordered]@{
    schemaVersion = 1
    projectId = $script:EventNightProjectId
    sourceHead = Get-EventNightGitHead $RepoRoot $GitTool
    createdAtUtc = [DateTime]::UtcNow.ToString('o')
    files = $records
  }
  New-Item -ItemType Directory -Path $Paths.DataDirectory -Force | Out-Null
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Paths.BuildManifest -Encoding UTF8
}

function Assert-EventNightRecords {
  param(
    [Parameter(Mandatory = $true)][object[]]$Expected,
    [Parameter(Mandatory = $true)][object[]]$Actual,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if ($Expected.Count -ne $Actual.Count) {
    Throw-QaError "$Label nesouhlasí: jiný počet souborů." 'Spusťte bezpečnou přípravu znovu; nepoužívejte neověřená data.'
  }
  for ($index = 0; $index -lt $Expected.Count; $index += 1) {
    $left = $Expected[$index]
    $right = $Actual[$index]
    if ([string]$left.path -ne [string]$right.path -or
        [long]$left.bytes -ne [long]$right.bytes -or
        [string]$left.sha256 -ne [string]$right.sha256) {
      Throw-QaError "$Label nesouhlasí u souboru '$($right.path)'." 'Spusťte bezpečnou přípravu znovu; nepoužívejte poškozená data.'
    }
  }
}

function Assert-EventNightBuildManifest {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$GitTool,
    [Parameter(Mandatory = $true)][psobject]$Paths
  )

  if (-not (Test-Path -LiteralPath $Paths.BuildManifest -PathType Leaf)) {
    Throw-QaError 'Chybí manifest production buildu.' 'Nejdřív spusťte PREPARE_EVENT_NIGHT.cmd.'
  }
  $manifest = Get-Content -LiteralPath $Paths.BuildManifest -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([int]$manifest.schemaVersion -ne 1 -or [string]$manifest.projectId -ne $script:EventNightProjectId) {
    Throw-QaError 'Manifest buildu nemá bezpečný event-night formát nebo demo projekt.' 'Spusťte PREPARE_EVENT_NIGHT.cmd znovu.'
  }
  $head = Get-EventNightGitHead $RepoRoot $GitTool
  if ([string]$manifest.sourceHead -ne $head) {
    Throw-QaError 'Production build neodpovídá aktuálnímu release HEAD.' 'Spusťte PREPARE_EVENT_NIGHT.cmd na správném release commitu.'
  }
  $actual = @(Get-EventNightFileRecords (Join-Path $RepoRoot 'apps\web\dist'))
  Assert-EventNightRecords @($manifest.files) $actual 'SHA-256 manifest production buildu'
}

function Get-EventNightCandidate {
  param([Parameter(Mandatory = $true)][psobject]$Paths)

  Assert-EventNightNoReparse $Paths.CandidateManifest
  if (-not (Test-Path -LiteralPath $Paths.CandidateManifest -PathType Leaf)) {
    Throw-QaError 'Chybí lokální manifest vybraného kvízu.' 'Nejdřív spusťte PREPARE_EVENT_NIGHT.cmd.'
  }
  $manifest = Get-Content -LiteralPath $Paths.CandidateManifest -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([int]$manifest.schemaVersion -ne 1 -or
      [string]$manifest.projectId -ne $script:EventNightProjectId -or
      [string]::IsNullOrWhiteSpace([string]$manifest.candidate.quizId)) {
    Throw-QaError 'Candidate manifest není bezpečný nebo je neúplný.' 'Spusťte PREPARE_EVENT_NIGHT.cmd znovu.'
  }
  return $manifest.candidate
}

function New-EventNightSnapshotManifest {
  param(
    [Parameter(Mandatory = $true)][string]$SnapshotDirectory,
    [Parameter(Mandatory = $true)][psobject]$Paths
  )

  if (-not (Test-Path -LiteralPath (Get-EventNightNativePath (Join-Path $SnapshotDirectory 'firebase-export-metadata.json')) -PathType Leaf)) {
    Throw-QaError 'Firebase emulator export neobsahuje metadata.' 'Ponechte poslední known-good snapshot a přípravu nebo backup zopakujte.'
  }
  $candidate = Get-EventNightCandidate $Paths
  $health = if (Test-Path -LiteralPath $Paths.HealthPath -PathType Leaf) {
    Get-Content -LiteralPath $Paths.HealthPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } else { $null }
  $manifest = [ordered]@{
    schemaVersion = 1
    projectId = $script:EventNightProjectId
    createdAtUtc = [DateTime]::UtcNow.ToString('o')
    candidateQuizId = [string]$candidate.quizId
    readiness = if ($null -eq $health) { $null } else { [ordered]@{
      status = [string]$health.readiness.status
      blockers = [int]$health.readiness.blockers
      warnings = [int]$health.readiness.warnings
    } }
    files = @(Get-EventNightFileRecords $SnapshotDirectory @('.event-night-manifest.json'))
  }
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Get-EventNightNativePath (Join-Path $SnapshotDirectory '.event-night-manifest.json')) -Encoding UTF8
}

function Assert-EventNightSnapshot {
  param(
    [Parameter(Mandatory = $true)][string]$SnapshotDirectory,
    [Parameter(Mandatory = $true)][psobject]$Paths
  )

  $manifestPath = Join-Path $SnapshotDirectory '.event-night-manifest.json'
  Assert-EventNightNoReparse $SnapshotDirectory -Recurse
  if (-not (Test-Path -LiteralPath (Get-EventNightNativePath $manifestPath) -PathType Leaf)) {
    Throw-QaError 'Persistentní snapshot nemá event-night manifest.' 'Nejdřív spusťte PREPARE_EVENT_NIGHT.cmd.'
  }
  $manifest = Get-Content -LiteralPath (Get-EventNightNativePath $manifestPath) -Raw -Encoding UTF8 | ConvertFrom-Json
  $candidate = Get-EventNightCandidate $Paths
  if ([int]$manifest.schemaVersion -ne 1 -or
      [string]$manifest.projectId -ne $script:EventNightProjectId -or
      [string]$manifest.candidateQuizId -ne [string]$candidate.quizId) {
    Throw-QaError 'Persistentní snapshot nepatří demo projektu nebo vybranému kvízu.' 'Nepokračujte; vytvořte nový snapshot přes PREPARE_EVENT_NIGHT.cmd.'
  }
  $actual = @(Get-EventNightFileRecords $SnapshotDirectory @('.event-night-manifest.json'))
  Assert-EventNightRecords @($manifest.files) $actual 'SHA-256 manifest persistentního snapshotu'
  return $manifest
}

function Backup-EventNightSnapshot {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$Paths,
    [string]$Reason = 'before-start'
  )

  Assert-EventNightSnapshot $Paths.SnapshotDirectory $Paths | Out-Null
  Assert-EventNightPath $RepoRoot $Paths.BackupDirectory
  New-Item -ItemType Directory -Path $Paths.BackupDirectory -Force | Out-Null
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
  $target = Join-Path $Paths.BackupDirectory "$stamp-$Reason"
  Assert-EventNightPath $RepoRoot $target
  Copy-EventNightSnapshotDirectory $RepoRoot $Paths.SnapshotDirectory $target
  Assert-EventNightSnapshot $target $Paths | Out-Null
  return $target
}

function Test-EventNightWorker {
  param(
    [Parameter(Mandatory = $true)][psobject]$Worker,
    [Parameter(Mandatory = $true)][string]$ExpectedToken
  )

  try {
    $processId = [int]$Worker.pid
    $process = Get-Process -Id $processId -ErrorAction Stop
    $expectedStartUtc = [DateTime]::Parse(
      [string]$Worker.startedAtUtc,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind
    ).ToUniversalTime()
    if ($process.StartTime.ToUniversalTime().Ticks -ne $expectedStartUtc.Ticks) { return $false }
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
    $commandLine = [string]$cim.CommandLine
    return $commandLine -match 'EventNight\.Worker\.ps1' -and $commandLine.Contains($ExpectedToken)
  } catch {
    return $false
  }
}

function Start-EventNightWorker {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('Fresh', 'Import')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$RunToken,
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$PnpmTool,
    [Parameter(Mandatory = $true)][psobject]$NodeTool,
    [Parameter(Mandatory = $true)][psobject]$JavaTool,
    [Parameter(Mandatory = $true)][psobject]$Paths
  )

  $workerScript = Join-Path $PSScriptRoot 'EventNight.Worker.ps1'
  $prefix = [string]::Join('|', @($PnpmTool.PrefixArguments))
  $arguments = @(
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (ConvertTo-QuotedProcessArgument $workerScript),
    '-Mode', $Mode, '-RunToken', $RunToken, '-RepoRoot', (ConvertTo-QuotedProcessArgument $RepoRoot),
    '-PnpmExecutable', (ConvertTo-QuotedProcessArgument $PnpmTool.Path), '-PnpmPrefix', (ConvertTo-QuotedProcessArgument $prefix),
    '-NodeDirectory', (ConvertTo-QuotedProcessArgument (Split-Path -Parent $NodeTool.Path)),
    '-JavaHome', (ConvertTo-QuotedProcessArgument $JavaTool.Home), '-ProjectId', $script:EventNightProjectId,
    '-LogPath', (ConvertTo-QuotedProcessArgument $Paths.EmulatorLog)
  )
  return Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru
}

function Stop-EventNightWorker {
  param(
    [Parameter(Mandatory = $true)][psobject]$Worker,
    [Parameter(Mandatory = $true)][string]$ExpectedToken
  )

  if (-not (Test-EventNightWorker $Worker $ExpectedToken)) {
    if ($null -ne (Get-Process -Id ([int]$Worker.pid) -ErrorAction SilentlyContinue)) {
      Throw-QaError 'Event-night proces nelze bezpečně identifikovat; nebyl ukončen.' 'Neukončujte plošně Node/Java. Požádejte vývojáře o kontrolu.'
    }
    return
  }
  & taskkill.exe /PID ([int]$Worker.pid) /T /F | Out-Null
  if ($LASTEXITCODE -ne 0 -and $null -ne (Get-Process -Id ([int]$Worker.pid) -ErrorAction SilentlyContinue)) {
    Throw-QaError 'Event-night proces se nepodařilo ukončit.' 'Zkuste STOP_EVENT_NIGHT.cmd znovu.'
  }
}

function Test-EventNightPage {
  try {
    $response = Invoke-WebRequest -Uri $script:EventNightUrl -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200 -and $response.Content -match '<div id="root"></div>'
  } catch { return $false }
}

function Wait-ForEventNightPage {
  param(
    [Parameter(Mandatory = $true)][System.Diagnostics.Process]$WorkerProcess,
    [int]$TimeoutSeconds = 180
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $WorkerProcess.Refresh()
    if ($WorkerProcess.HasExited) {
      Throw-QaError 'Event-night emulátory skončily během startu.' 'Zkontrolujte .local-data/event-night/emulators.log.'
    }
    if (Test-EventNightPage) { return }
    Start-Sleep -Milliseconds 400
  }
  Throw-QaError 'Production Hosting Emulator se nepodařilo spustit.' 'Zkontrolujte event-night log a port 5000.'
}

function Resolve-EventNightBrowser {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
  )
  foreach ($candidate in Get-ExistingUniquePaths $candidates) { return $candidate }
  Throw-QaError 'Chrome ani Edge nebyl nalezen pro lokální health check.' 'Nainstalujte Chrome/Edge a spusťte launcher znovu.'
}

function Invoke-EventNightHealth {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$NodeTool,
    [Parameter(Mandatory = $true)][psobject]$Paths
  )

  $env:EVENT_NIGHT_BASE_URL = 'http://localhost:5000'
  $env:EVENT_NIGHT_CANDIDATE_MANIFEST = $Paths.CandidateManifest
  $env:EVENT_NIGHT_HEALTH_OUTPUT = $Paths.HealthPath
  $env:PLAYWRIGHT_EXECUTABLE_PATH = Resolve-EventNightBrowser
  $scriptPath = Join-Path $RepoRoot 'tools\event-night\health-check.mjs'
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $NodeTool.Path $scriptPath 2>&1 | ForEach-Object { Write-Host "$_" }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  if ($exitCode -ne 0 -or -not (Test-Path -LiteralPath $Paths.HealthPath -PathType Leaf)) {
    Throw-QaError 'Event-night browser health check selhal.' 'Zkontrolujte lokální emulátory a .local-data/event-night logy.'
  }
  return Get-Content -LiteralPath $Paths.HealthPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Export-EventNightSnapshot {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$PnpmTool,
    [Parameter(Mandatory = $true)][psobject]$Paths,
    [switch]$Promote,
    [switch]$Initial
  )

  Assert-EventNightPromotionClear $RepoRoot $Paths
  Assert-EventNightPath $RepoRoot $Paths.ExportStaging
  if (Test-Path -LiteralPath $Paths.ExportStaging) {
    Assert-EventNightNoReparse $Paths.ExportStaging -Recurse
    Remove-Item -LiteralPath $Paths.ExportStaging -Recurse -Force
  }
  $exportExit = Invoke-PnpmTool $PnpmTool @('event-night:export')
  if ($exportExit -ne 0) {
    Throw-QaError 'Graceful Firebase emulator export selhal.' 'Běžící data nebyla nahrazena; zkontrolujte log a export zopakujte.'
  }
  New-EventNightSnapshotManifest $Paths.ExportStaging $Paths
  Assert-EventNightSnapshot $Paths.ExportStaging $Paths | Out-Null
  if (-not $Promote) { return $Paths.ExportStaging }

  Promote-EventNightSnapshot $RepoRoot $Paths -Initial:$Initial | Out-Null
  return $Paths.SnapshotDirectory
}

function Assert-EventNightPromotionClear {
  param([Parameter(Mandatory = $true)][string]$RepoRoot, [Parameter(Mandatory = $true)][psobject]$Paths)
  foreach ($target in @($Paths.PromotionJournal, $Paths.SnapshotDirectory, $Paths.ExportStaging, $Paths.BackupDirectory)) {
    Assert-EventNightPath $RepoRoot $target
  }
  if (Test-Path -LiteralPath $Paths.PromotionJournal) {
    Throw-QaError 'Nedokončená promotion snapshotu; další export ani FIRST PREPARE nejsou povolené.' 'Spusťte START_EVENT_NIGHT.cmd pro ověřenou obnovu, nikoli nový seed.'
  }
}

function Get-EventNightPromotionJournal {
  param([Parameter(Mandatory = $true)][string]$RepoRoot, [Parameter(Mandatory = $true)][psobject]$Paths)
  Assert-EventNightPath $RepoRoot $Paths.PromotionJournal
  if (-not (Test-Path -LiteralPath $Paths.PromotionJournal -PathType Leaf) -or (Get-Item -LiteralPath $Paths.PromotionJournal).Length -gt 2048) {
    Throw-QaError 'Recovery journal chybí nebo není platný soubor.' 'Ponechte všechny snapshoty beze změny.'
  }
  $journal = Get-Content -LiteralPath $Paths.PromotionJournal -Raw -Encoding UTF8 | ConvertFrom-Json
  $fields = @($journal.PSObject.Properties.Name | Sort-Object)
  if ([string]::Join(',', $fields) -ne 'previousBackup,previousManifestSha256,projectId,schemaVersion' -or
      [int]$journal.schemaVersion -ne 1 -or [string]$journal.projectId -ne $script:EventNightProjectId -or
      [string]$journal.previousBackup -cnotmatch '^\d{8}T\d{9}Z-before-export-[a-f0-9]{32}$' -or
      [string]$journal.previousManifestSha256 -cnotmatch '^[a-f0-9]{64}$') {
    Throw-QaError 'Recovery journal nemá bezpečný demo formát nebo přesný backup.' 'Ponechte všechny snapshoty beze změny.'
  }
  Assert-EventNightPath $RepoRoot (Join-Path $Paths.BackupDirectory $journal.previousBackup)
  return $journal
}

function Move-EventNightSnapshotPath {
  param([string]$RepoRoot, [string]$LiteralPath, [string]$Destination)
  Assert-EventNightPath $RepoRoot $LiteralPath
  Assert-EventNightPath $RepoRoot $Destination
  Assert-EventNightNoReparse $LiteralPath -Recurse
  $source = [System.IO.Path]::GetFullPath($LiteralPath)
  $target = [System.IO.Path]::GetFullPath($Destination)
  $comparison = if ([System.IO.Path]::DirectorySeparatorChar -eq '\') { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
  if (-not [System.IO.Path]::GetPathRoot($source).Equals([System.IO.Path]::GetPathRoot($target), $comparison)) {
    Throw-QaError 'Snapshot rename must stay on the same volume.' 'Leave all snapshots unchanged.'
  }
  $nativeSource = Get-EventNightNativePath $source
  $nativeTarget = Get-EventNightNativePath $target
  if ([System.IO.File]::Exists($nativeTarget) -or [System.IO.Directory]::Exists($nativeTarget)) {
    Throw-QaError 'Snapshot rename target already exists.' 'Leave all snapshots unchanged.'
  }
  # Native non-overwriting renames retain durable journal ordering beyond PS5 MAX_PATH.
  if (([System.IO.File]::GetAttributes($nativeSource) -band [System.IO.FileAttributes]::Directory) -ne 0) {
    [System.IO.Directory]::Move($nativeSource, $nativeTarget)
  } else {
    if (-not [System.IO.Path]::GetDirectoryName($source).Equals([System.IO.Path]::GetDirectoryName($target), $comparison)) {
      Throw-QaError 'Journal rename must stay in the same directory.' 'Leave all snapshots unchanged.'
    }
    [System.IO.File]::Move($nativeSource, $nativeTarget)
  }
}

function Promote-EventNightSnapshot {
  param([Parameter(Mandatory = $true)][string]$RepoRoot, [Parameter(Mandatory = $true)][psobject]$Paths, [switch]$Initial)
  Assert-EventNightPromotionClear $RepoRoot $Paths
  Assert-EventNightSnapshot $Paths.ExportStaging $Paths | Out-Null
  if (-not (Test-Path -LiteralPath (Get-EventNightNativePath $Paths.SnapshotDirectory))) {
    if (-not $Initial) { Throw-QaError 'Chybí canonical snapshot; export jej nesmí nově založit.' 'Použijte ověřenou recovery, nikdy nový seed.' }
    Move-EventNightSnapshotPath $RepoRoot $Paths.ExportStaging $Paths.SnapshotDirectory
    Assert-EventNightSnapshot $Paths.SnapshotDirectory $Paths | Out-Null
    return $Paths.SnapshotDirectory
  }
  if ($Initial) { Throw-QaError 'FIRST PREPARE nesmí přepsat existující snapshot.' 'Použijte běžný start.' }
  Assert-EventNightSnapshot $Paths.SnapshotDirectory $Paths | Out-Null
  $name = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-before-export-' + [Guid]::NewGuid().ToString('N')
  $previous = Join-Path $Paths.BackupDirectory $name
  $temporaryJournal = Join-Path $Paths.DataDirectory ('promotion-journal-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  Assert-EventNightPath $RepoRoot $previous
  Assert-EventNightPath $RepoRoot $temporaryJournal
  if (Test-Path -LiteralPath (Get-EventNightNativePath $previous)) { Throw-QaError 'Backup target už existuje.' 'Ponechte snapshoty beze změny.' }
  $journal = [ordered]@{ schemaVersion = 1; projectId = $script:EventNightProjectId; previousBackup = $name;
    previousManifestSha256 = Get-EventNightFileSha256 (Join-Path $Paths.SnapshotDirectory '.event-night-manifest.json') }
  New-Item -ItemType Directory -Path $Paths.BackupDirectory -Force | Out-Null
  $encoding = New-Object System.Text.UTF8Encoding($true)
  $bytes = $encoding.GetPreamble() + $encoding.GetBytes(($journal | ConvertTo-Json -Depth 3))
  $stream = [System.IO.File]::Open((Get-EventNightNativePath $temporaryJournal), [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
  Move-EventNightSnapshotPath $RepoRoot $temporaryJournal $Paths.PromotionJournal
  # The journal is durable before either rename. An interruption leaves recovery evidence.
  Move-EventNightSnapshotPath $RepoRoot $Paths.SnapshotDirectory $previous
  Move-EventNightSnapshotPath $RepoRoot $Paths.ExportStaging $Paths.SnapshotDirectory
  Assert-EventNightSnapshot $Paths.SnapshotDirectory $Paths | Out-Null
  Remove-Item -LiteralPath $Paths.PromotionJournal
  return $Paths.SnapshotDirectory
}

function Restore-EventNightSnapshot {
  param([Parameter(Mandatory = $true)][string]$RepoRoot, [Parameter(Mandatory = $true)][psobject]$Paths)
  foreach ($target in @($Paths.SnapshotDirectory, $Paths.PromotionJournal, $Paths.BackupDirectory)) { Assert-EventNightPath $RepoRoot $target }
  $canonicalExists = Test-Path -LiteralPath (Get-EventNightNativePath $Paths.SnapshotDirectory)
  if ($canonicalExists) { Assert-EventNightSnapshot $Paths.SnapshotDirectory $Paths | Out-Null }
  if (-not (Test-Path -LiteralPath $Paths.PromotionJournal)) {
    if (-not $canonicalExists) { Throw-QaError 'Chybí snapshot i přesný recovery journal.' 'Ponechte zálohy beze změny; nelze vybírat nejnovější ani seedovat.' }
    return $Paths.SnapshotDirectory
  }
  $journal = Get-EventNightPromotionJournal $RepoRoot $Paths
  $previous = Join-Path $Paths.BackupDirectory $journal.previousBackup
  if (Test-Path -LiteralPath (Get-EventNightNativePath $previous)) {
    Assert-EventNightSnapshot $previous $Paths | Out-Null
    $priorHash = Get-EventNightFileSha256 (Join-Path $previous '.event-night-manifest.json')
    if ($priorHash -ne $journal.previousManifestSha256) { Throw-QaError 'Backup manifest nesouhlasí s recovery journalem.' 'Ponechte snapshoty beze změny.' }
  } elseif ($canonicalExists -and
      (Get-EventNightFileSha256 (Join-Path $Paths.SnapshotDirectory '.event-night-manifest.json')) -eq $journal.previousManifestSha256) {
    # Interrupted before the first rename: the exact prior is still canonical.
  } else { Throw-QaError 'Přesný backup z recovery journalu chybí.' 'Ponechte snapshoty beze změny.' }
  if (-not $canonicalExists) {
    $temporary = Join-Path $Paths.DataDirectory ('recovery-' + [Guid]::NewGuid().ToString('N'))
    Assert-EventNightPath $RepoRoot $temporary
    if (Test-Path -LiteralPath (Get-EventNightNativePath $temporary)) { Throw-QaError 'Recovery target už existuje.' 'Ponechte snapshoty beze změny.' }
    Copy-EventNightSnapshotDirectory $RepoRoot $previous $temporary
    Assert-EventNightSnapshot $temporary $Paths | Out-Null
    Assert-EventNightPath $RepoRoot $Paths.SnapshotDirectory
    if (Test-Path -LiteralPath (Get-EventNightNativePath $Paths.SnapshotDirectory)) { Throw-QaError 'Canonical snapshot vznikl během recovery.' 'Nepřepisujte jej; zopakujte bezpečný start.' }
    Move-EventNightSnapshotPath $RepoRoot $temporary $Paths.SnapshotDirectory
    Assert-EventNightSnapshot $Paths.SnapshotDirectory $Paths | Out-Null
  }
  Remove-Item -LiteralPath $Paths.PromotionJournal
  return $Paths.SnapshotDirectory
}

function Get-EventNightState {
  param([Parameter(Mandatory = $true)][psobject]$Paths)
  if (-not (Test-Path -LiteralPath $Paths.StatePath -PathType Leaf)) { return $null }
  try { return Get-Content -LiteralPath $Paths.StatePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
}

function Write-EventNightReady {
  param([Parameter(Mandatory = $true)][psobject]$Health)

  Write-Host ''
  Write-QaSuccess 'JustKvíz běží lokálně.'
  Write-Host ''
  Write-Host "Kvíz: $($Health.candidateTitle)"
  $readiness = if ([int]$Health.readiness.blockers -eq 0) { 'READY' } else { "BLOCKED — $($Health.readiness.blockers) problémů" }
  Write-Host "Připravenost: $readiness"
  Write-Host "URL: $script:EventNightUrl"
  Write-Host ''
  Write-Host 'Login:'
  Write-Host 'admin@example.test'
  Write-Host 'LocalQuiz123!'
  Write-Host ''
  Write-Host 'Po skončení vždy spusťte STOP_EVENT_NIGHT.cmd.'
}
