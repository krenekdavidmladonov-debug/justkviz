$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = Join-Path $root 'bin\node.exe'
$client = Join-Path $root 'tools\media-companion\client.mjs'
if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or -not (Test-Path -LiteralPath $client -PathType Leaf)) { throw 'Run Start.ps1 from the prepared portable package.' }
$child = Start-Process -FilePath $node -ArgumentList @('"' + $client + '"') -WorkingDirectory $root -WindowStyle Hidden -PassThru
Write-Output ('Pomocník spuštěn. PID: ' + $child.Id)
