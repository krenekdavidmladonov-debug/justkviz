$ErrorActionPreference = 'Stop'
$start = Join-Path $PSScriptRoot 'Start.ps1'
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'bin\node.exe') -PathType Leaf)) { throw 'Use the prepared portable package.' }
$startup = [Environment]::GetFolderPath('Startup')
$shortcut = Join-Path $startup 'JustKviz Media Companion.lnk'
if (Test-Path -LiteralPath $shortcut) { throw 'Logon shortcut already exists. Remove it explicitly before reinstalling.' }
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$link.Arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $start + '"'
$link.WorkingDirectory = $PSScriptRoot
$link.WindowStyle = 7
$link.Description = 'JustKvíz: lokální příprava médií'
$link.Save()
Write-Output 'Spouštění po přihlášení připraveno pro aktuálního uživatele. Pomocník nebyl spuštěn.'
