$ErrorActionPreference = 'Stop'
$shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'JustKviz Media Companion.lnk'
if (Test-Path -LiteralPath $shortcut -PathType Leaf) { Remove-Item -LiteralPath $shortcut }
Write-Output 'Spouštění po přihlášení odebráno. Běžícího pomocníka tento krok neukončuje.'
