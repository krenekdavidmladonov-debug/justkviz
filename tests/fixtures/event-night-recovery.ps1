param([Parameter(Mandatory = $true)][string]$CommonPath)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
function Throw-QaError { param([string]$Message, [string]$Hint) throw "$Message $Hint" }
. $CommonPath
# Select the host's bundled module even when Node inherits a PowerShell 7 module
# search path and launches Windows PowerShell 5.
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')

# All input is synthetic and isolated. Never inspect an operator's persistent data.
$script:FixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('event-night-recovery-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $script:FixtureRoot | Out-Null
$script:Checks = 0
$script:Fault = ''
$script:FaultCanonical = ''
$script:FaultStaging = ''
function Check { param([bool]$Condition, [string]$Label) if (-not $Condition) { throw "Assertion: $Label" }; $script:Checks += 1 }
function Fails {
  param([scriptblock]$Action, [string]$Label)
  $failed = $false
  try { & $Action | Out-Null } catch { $failed = $true; $script:LastFailure = $_.Exception.Message }
  Check $failed $Label
}
function Fingerprint {
  param([string]$Directory)
  Assert-EventNightNoReparse $Directory -Recurse
  $prefix = [System.IO.Path]::GetFullPath($Directory).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  $records = @(Get-ChildItem -LiteralPath (Get-EventNightNativePath $Directory) -File -Recurse -Force | Sort-Object FullName | ForEach-Object {
    [ordered]@{ path = (Get-EventNightLogicalPath $_.FullName).Substring($prefix.Length).Replace('\', '/'); bytes = $_.Length; sha256 = (Get-EventNightFileSha256 $_.FullName) }
  })
  return ($records | ConvertTo-Json -Depth 5 -Compress)
}
function Write-FixtureFile {
  param([string]$Path, [string]$Text)
  [System.IO.File]::WriteAllText((Get-EventNightNativePath $Path), ($Text + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($true)))
}
function Move-FixturePath {
  param([string]$LiteralPath, [string]$Destination)
  $prefix = [System.IO.Path]::GetFullPath($script:FixtureRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  foreach ($path in @($LiteralPath, $Destination)) {
    if (-not [System.IO.Path]::GetFullPath($path).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture move escaped its isolated root' }
    Assert-EventNightNoReparse $path -Recurse
  }
  [System.IO.Directory]::Move((Get-EventNightNativePath $LiteralPath), (Get-EventNightNativePath $Destination))
}
function New-Snapshot {
  param([string]$Directory, [psobject]$Paths, [string]$Payload)
  [System.IO.Directory]::CreateDirectory((Get-EventNightNativePath $Directory)) | Out-Null
  Write-FixtureFile (Join-Path $Directory 'firebase-export-metadata.json') '{"synthetic":true}'
  Write-FixtureFile (Join-Path $Directory 'payload.json') $Payload
  New-EventNightSnapshotManifest $Directory $Paths
  Assert-EventNightSnapshot $Directory $Paths | Out-Null
}
function New-Case {
  param([string]$Name)
  $repo = Join-Path $script:FixtureRoot $Name
  $paths = Get-EventNightPaths $repo
  New-Item -ItemType Directory -Path $paths.DataDirectory -Force | Out-Null
  New-Item -ItemType Directory -Path (Split-Path -Parent $paths.CandidateManifest) -Force | Out-Null
  '{"schemaVersion":1,"projectId":"demo-filmovy-kviz-v2","candidate":{"quizId":"synthetic-quiz"}}' |
    Set-Content -LiteralPath $paths.CandidateManifest -Encoding UTF8
  New-Snapshot $paths.SnapshotDirectory $paths 'previous'
  New-Snapshot $paths.ExportStaging $paths 'next'
  return [pscustomobject]@{ Repo = $repo; Paths = $paths; Previous = (Fingerprint $paths.SnapshotDirectory); Next = (Fingerprint $paths.ExportStaging) }
}

# Faults wrap real filesystem renames, including an interruption immediately after
# canonical -> prior backup. No mocked snapshot, hash, copy, or recovery validation.
$script:RealSnapshotMove = (Get-Command Move-EventNightSnapshotPath -CommandType Function).ScriptBlock
function Move-EventNightSnapshotPath {
  [CmdletBinding()]
  param([string]$RepoRoot, [string]$LiteralPath, [string]$Destination)
  if ($script:Fault -eq 'before-first' -and $LiteralPath -eq $script:FaultCanonical) {
    $script:Fault = ''; throw 'Synthetic interruption before first rename'
  }
  & $script:RealSnapshotMove @PSBoundParameters
  if (($script:Fault -eq 'between' -and $LiteralPath -eq $script:FaultCanonical) -or
      ($script:Fault -eq 'after-new' -and $LiteralPath -eq $script:FaultStaging)) {
    $script:Fault = ''; throw 'Synthetic interruption after real rename'
  }
}
function Interrupt-Promotion {
  param([psobject]$Case, [string]$Fault)
  $script:Fault = $Fault
  $script:FaultCanonical = $Case.Paths.SnapshotDirectory
  $script:FaultStaging = $Case.Paths.ExportStaging
  Fails { Promote-EventNightSnapshot $Case.Repo $Case.Paths } "promotion interrupted: $Fault"
  Check ($script:LastFailure -like 'Synthetic interruption*') "expected real rename fault, received: $script:LastFailure"
  Check (Test-Path -LiteralPath $Case.Paths.PromotionJournal) 'durable journal exists before first rename'
  return Get-EventNightPromotionJournal $Case.Repo $Case.Paths
}
function Prior-Path { param([psobject]$Case, [psobject]$Journal) return Join-Path $Case.Paths.BackupDirectory $Journal.previousBackup }

$case = New-Case 'before-first'
$journal = Interrupt-Promotion $case 'before-first'
Check (-not (Test-Path -LiteralPath (Prior-Path $case $journal))) 'prior has not moved yet'
Restore-EventNightSnapshot $case.Repo $case.Paths | Out-Null
Check ((Fingerprint $case.Paths.SnapshotDirectory) -eq $case.Previous) 'before-first retains canonical bytes'
Check (-not (Test-Path -LiteralPath $case.Paths.PromotionJournal)) 'before-first journal completed'
Restore-EventNightSnapshot $case.Repo $case.Paths | Out-Null
Check ((Fingerprint $case.Paths.SnapshotDirectory) -eq $case.Previous) 'repeat recovery is idempotent'

$case = New-Case 'between'
$journal = Interrupt-Promotion $case 'between'
$prior = Prior-Path $case $journal
Check (-not (Test-Path -LiteralPath $case.Paths.SnapshotDirectory)) 'real first rename removed canonical'
Check ((Fingerprint $prior) -eq $case.Previous) 'prior backup bytes unchanged after rename'
New-Snapshot (Join-Path $case.Paths.BackupDirectory '99991231T235959999Z-unrelated') $case.Paths 'unrelated-newer'
Restore-EventNightSnapshot $case.Repo $case.Paths | Out-Null
Check ((Fingerprint $case.Paths.SnapshotDirectory) -eq $case.Previous) 'uses exact journal prior, not newest backup'
Check ((Fingerprint $prior) -eq $case.Previous) 'copy recovery preserves all prior backup bytes'
Check ((Fingerprint $case.Paths.ExportStaging) -eq $case.Next) 'recovery does not promote interrupted staging'
Check (-not (Test-Path -LiteralPath $case.Paths.PromotionJournal)) 'between journal completed'
Restore-EventNightSnapshot $case.Repo $case.Paths | Out-Null
Check ((Fingerprint $prior) -eq $case.Previous) 'repeat recovery preserves backup'

$case = New-Case 'after-new'
$journal = Interrupt-Promotion $case 'after-new'
Restore-EventNightSnapshot $case.Repo $case.Paths | Out-Null
Check ((Fingerprint $case.Paths.SnapshotDirectory) -eq $case.Next) 'already valid new canonical is retained'
Check ((Fingerprint (Prior-Path $case $journal)) -eq $case.Previous) 'new canonical recovery preserves prior'
Check (-not (Test-Path -LiteralPath $case.Paths.PromotionJournal)) 'after-new journal completed'

$case = New-Case 'normal'
Promote-EventNightSnapshot $case.Repo $case.Paths | Out-Null
Check ((Fingerprint $case.Paths.SnapshotDirectory) -eq $case.Next) 'successful promotion retains next bytes'
Check (-not (Test-Path -LiteralPath $case.Paths.PromotionJournal)) 'successful promotion removes journal'
Restore-EventNightSnapshot $case.Repo $case.Paths | Out-Null
Check ((Fingerprint $case.Paths.SnapshotDirectory) -eq $case.Next) 'valid canonical without journal unchanged'

$case = New-Case 'initial-existing'
Fails { Promote-EventNightSnapshot $case.Repo $case.Paths -Initial } 'initial prepare refuses existing canonical with valid staging'
Check ((Fingerprint $case.Paths.SnapshotDirectory) -eq $case.Previous) 'initial refusal preserves canonical bytes'
Check ((Fingerprint $case.Paths.ExportStaging) -eq $case.Next) 'initial refusal preserves staging bytes'

$case = New-Case 'initial-new'
Move-FixturePath -LiteralPath $case.Paths.SnapshotDirectory -Destination (Join-Path $case.Paths.DataDirectory 'fixture-prior')
Promote-EventNightSnapshot $case.Repo $case.Paths -Initial | Out-Null
Check ((Fingerprint $case.Paths.SnapshotDirectory) -eq $case.Next) 'explicit first prepare promotes valid staging'
Check (-not (Test-Path -LiteralPath $case.Paths.ExportStaging)) 'initial staging renamed to canonical'
Check (-not (Test-Path -LiteralPath $case.Paths.PromotionJournal)) 'initial promotion needs no prior journal'

$case = New-Case 'missing-no-journal'
Move-FixturePath -LiteralPath $case.Paths.SnapshotDirectory -Destination (Join-Path $case.Paths.DataDirectory 'unreferenced-backup')
Fails { Restore-EventNightSnapshot $case.Repo $case.Paths } 'missing canonical without journal fails closed'
Fails { Promote-EventNightSnapshot $case.Repo $case.Paths } 'export does not seed missing canonical'
Check (-not (Test-Path -LiteralPath $case.Paths.SnapshotDirectory)) 'failed operations do not create canonical'

$case = New-Case 'pending'
$journal = Interrupt-Promotion $case 'between'
function Invoke-PnpmTool { throw 'No exporter or seed may run in a pending promotion test' }
Fails { Assert-EventNightPromotionClear $case.Repo $case.Paths } 'prepare refuses pending promotion'
Fails { Export-EventNightSnapshot $case.Repo ([pscustomobject]@{ Path = 'unused' }) $case.Paths -Promote } 'export refuses pending promotion'
Check ((Fingerprint $case.Paths.ExportStaging) -eq $case.Next) 'pending export cannot remove staging'
Check ((Fingerprint (Prior-Path $case $journal)) -eq $case.Previous) 'pending export cannot overwrite backup'

foreach ($kind in @('json', 'oversized', 'project', 'schema', 'traversal', 'hash', 'extra', 'missing-backup', 'corrupt-backup', 'wrong-manifest')) {
  $case = New-Case $kind
  $journal = Interrupt-Promotion $case 'between'
  $prior = Prior-Path $case $journal
  switch ($kind) {
    'json' { '{' | Set-Content -LiteralPath $case.Paths.PromotionJournal -Encoding UTF8 }
    'oversized' { ('x' * 2049) | Set-Content -LiteralPath $case.Paths.PromotionJournal -Encoding UTF8 }
    'project' { $journal.projectId = 'real-project' }
    'schema' { $journal.schemaVersion = 2 }
    'traversal' { $journal.previousBackup = '../outside' }
    'hash' { $journal.previousManifestSha256 = 'not-a-hash' }
    'extra' { $journal | Add-Member -NotePropertyName extra -NotePropertyValue 'unexpected' }
    'missing-backup' { Move-FixturePath -LiteralPath $prior -Destination (Join-Path $case.Paths.DataDirectory 'unreferenced') }
    'corrupt-backup' { Write-FixtureFile (Join-Path $prior 'payload.json') 'corrupt' }
    'wrong-manifest' { $journal.previousManifestSha256 = '0' * 64 }
  }
  if ($kind -in @('project', 'schema', 'traversal', 'hash', 'extra', 'wrong-manifest')) {
    $journal | ConvertTo-Json | Set-Content -LiteralPath $case.Paths.PromotionJournal -Encoding UTF8
  }
  Fails { Restore-EventNightSnapshot $case.Repo $case.Paths } "invalid recovery fails closed: $kind"
  Check (-not (Test-Path -LiteralPath $case.Paths.SnapshotDirectory)) "invalid recovery creates no canonical: $kind"
  Check (Test-Path -LiteralPath $case.Paths.PromotionJournal) "invalid journal retained: $kind"
}

$case = New-Case 'corrupt-canonical'
$journal = Interrupt-Promotion $case 'after-new'
'corrupt' | Set-Content -LiteralPath (Join-Path $case.Paths.SnapshotDirectory 'payload.json') -Encoding UTF8
$corrupt = Fingerprint $case.Paths.SnapshotDirectory
Fails { Restore-EventNightSnapshot $case.Repo $case.Paths } 'corrupt canonical never overwritten'
Check ((Fingerprint $case.Paths.SnapshotDirectory) -eq $corrupt) 'corrupt canonical remains untouched'
Check ((Fingerprint (Prior-Path $case $journal)) -eq $case.Previous) 'corrupt canonical leaves backup unchanged'
Check (Test-Path -LiteralPath $case.Paths.PromotionJournal) 'corrupt canonical retains journal'

$case = New-Case 'valid-canonical-invalid-journal'
'{' | Set-Content -LiteralPath $case.Paths.PromotionJournal -Encoding UTF8
Fails { Restore-EventNightSnapshot $case.Repo $case.Paths } 'valid canonical with malformed journal fails closed'
Check ((Fingerprint $case.Paths.SnapshotDirectory) -eq $case.Previous) 'malformed journal cannot overwrite valid canonical'
Check (Test-Path -LiteralPath $case.Paths.PromotionJournal) 'malformed journal retained for inspection'

$case = New-Case 'path-bounds'
$case.Paths.SnapshotDirectory = Join-Path $case.Paths.DataDirectory '../outside'
Fails { Restore-EventNightSnapshot $case.Repo $case.Paths } 'traversal rejected before mutation'
$case.Paths.SnapshotDirectory = Join-Path $script:FixtureRoot 'outside'
Fails { Promote-EventNightSnapshot $case.Repo $case.Paths } 'outside canonical target rejected before mutation'
Check (-not (Test-Path -LiteralPath $case.Paths.SnapshotDirectory)) 'outside canonical target not created'

# Junctions need no administrator privilege on Windows; CI uses symbolic links.
# Preserve these unique synthetic directories for audit rather than recursively
# deleting link-bearing fixtures. No operator data or existing temp directory used.
$linkType = if ([System.IO.Path]::DirectorySeparatorChar -eq '\') { 'Junction' } else { 'SymbolicLink' }
foreach ($kind in @('backup-link', 'backup-child-link', 'data-ancestor-link')) {
  $case = New-Case $kind
  $journal = Interrupt-Promotion $case 'between'
  $prior = Prior-Path $case $journal
  $outside = Join-Path $script:FixtureRoot ($kind + '-outside')
  if ($kind -eq 'backup-link') {
    Move-FixturePath -LiteralPath $prior -Destination $outside
    New-Item -ItemType $linkType -Path (Get-EventNightNativePath $prior) -Target (Get-EventNightNativePath $outside) | Out-Null
  } elseif ($kind -eq 'data-ancestor-link') {
    Move-FixturePath -LiteralPath $case.Paths.DataDirectory -Destination $outside
    New-Item -ItemType $linkType -Path (Get-EventNightNativePath $case.Paths.DataDirectory) -Target (Get-EventNightNativePath $outside) | Out-Null
  } else {
    New-Item -ItemType Directory -Path $outside | Out-Null
    'synthetic-outside' | Set-Content -LiteralPath (Join-Path $outside 'payload.json') -Encoding UTF8
    New-Item -ItemType $linkType -Path (Get-EventNightNativePath (Join-Path $prior 'child-link')) -Target (Get-EventNightNativePath $outside) | Out-Null
  }
  # Hash outside with the actual native file enumeration (never through the link).
  $outsideBefore = @(Get-ChildItem -LiteralPath (Get-EventNightNativePath $outside) -File -Recurse -Force | ForEach-Object { (Get-EventNightFileSha256 $_.FullName) }) -join ','
  Fails { Restore-EventNightSnapshot $case.Repo $case.Paths } "reparse escape rejected: $kind"
  $outsideAfter = @(Get-ChildItem -LiteralPath (Get-EventNightNativePath $outside) -File -Recurse -Force | ForEach-Object { (Get-EventNightFileSha256 $_.FullName) }) -join ','
  Check ($outsideBefore -eq $outsideAfter) "reparse target bytes unchanged: $kind"
}

# The exposed rename primitive must reject unsafe inputs before any destination mutation.
$case = New-Case 'rename-guards'
Fails { Move-EventNightSnapshotPath $case.Repo $case.Paths.SnapshotDirectory $case.Paths.ExportStaging } 'rename refuses an existing directory target'
Check ((Fingerprint $case.Paths.SnapshotDirectory) -eq $case.Previous) 'overwrite refusal preserves source'
Check ((Fingerprint $case.Paths.ExportStaging) -eq $case.Next) 'overwrite refusal preserves target'
$outside = Join-Path $script:FixtureRoot 'rename-outside'
Fails { Move-EventNightSnapshotPath $case.Repo $case.Paths.SnapshotDirectory $outside } 'rename refuses outside-root destination'
Check (-not [System.IO.Directory]::Exists((Get-EventNightNativePath $outside))) 'outside-root refusal creates no destination'
$missing = Join-Path $case.Paths.DataDirectory 'missing-source'
$destination = Join-Path $case.Paths.DataDirectory 'missing-target'
Fails { Move-EventNightSnapshotPath $case.Repo $missing $destination } 'rename refuses missing source'
Check (-not [System.IO.Directory]::Exists((Get-EventNightNativePath $destination))) 'missing source creates no destination'
$sourceFile = Join-Path $case.Paths.DataDirectory 'source.tmp'
$targetFile = Join-Path $case.Paths.DataDirectory 'target.tmp'
Write-FixtureFile $sourceFile 'source retained'
Write-FixtureFile $targetFile 'target retained'
$sourceHash = Get-EventNightFileSha256 $sourceFile
$targetHash = Get-EventNightFileSha256 $targetFile
Fails { Move-EventNightSnapshotPath $case.Repo $sourceFile $targetFile } 'rename refuses an existing file target'
Check ((Get-EventNightFileSha256 $sourceFile) -eq $sourceHash) 'file overwrite refusal preserves source'
Check ((Get-EventNightFileSha256 $targetFile) -eq $targetHash) 'file overwrite refusal preserves target'
[System.IO.Directory]::CreateDirectory((Get-EventNightNativePath $outside)) | Out-Null
$sentinel = Join-Path $outside 'sentinel.json'
Write-FixtureFile $sentinel 'outside sentinel retained'
$sentinelHash = Get-EventNightFileSha256 $sentinel
$link = Join-Path $case.Paths.DataDirectory 'linked-parent'
New-Item -ItemType $linkType -Path (Get-EventNightNativePath $link) -Target (Get-EventNightNativePath $outside) | Out-Null
Fails { Move-EventNightSnapshotPath $case.Repo $link $destination } 'rename refuses reparse source'
Fails { Move-EventNightSnapshotPath $case.Repo $case.Paths.SnapshotDirectory (Join-Path $link 'escape') } 'rename refuses reparse destination ancestor'
Check (-not [System.IO.Directory]::Exists((Get-EventNightNativePath $destination))) 'reparse source creates no destination'
Check (-not [System.IO.Directory]::Exists((Get-EventNightNativePath (Join-Path $outside 'escape')))) 'reparse ancestor creates no outside destination'
Check ((Get-EventNightFileSha256 $sentinel) -eq $sentinelHash) 'reparse refusals preserve outside sentinel'
Check ((Fingerprint $case.Paths.SnapshotDirectory) -eq $case.Previous) 'reparse refusals preserve canonical bytes'

Write-Output "PASS: event-night recovery ($script:Checks assertions, synthetic fixtures retained for audit)"
