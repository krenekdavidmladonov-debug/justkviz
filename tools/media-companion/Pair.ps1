$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = Join-Path $root 'bin\node.exe'
$client = Join-Path $root 'tools\media-companion\client.mjs'
if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or -not (Test-Path -LiteralPath $client -PathType Leaf)) { throw 'Run Pair.ps1 from the prepared portable package.' }
# The short-lived pairing code enters through stdin, never command arguments,
# PowerShell history, environment variables or an on-disk config file.
$secure = Read-Host 'Vložte jednorázový párovací kód z editoru' -AsSecureString
$pointer = [IntPtr]::Zero
try {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $code = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $node
  $start.Arguments = '"' + $client + '" --pair'
  $start.WorkingDirectory = $root
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $child = New-Object Diagnostics.Process
  $child.StartInfo = $start
  [void]$child.Start()
  $child.StandardInput.Write($code)
  $child.StandardInput.Close()
  $code = $null
  $output = $child.StandardOutput.ReadToEnd()
  $errorOutput = $child.StandardError.ReadToEnd()
  $child.WaitForExit()
  if ($child.ExitCode -ne 0) { throw 'Párování selhalo. Ověřte aktuální kód a že pomocník již neběží.' }
  Write-Output 'Spárováno. Nyní spusťte Start.ps1.'
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $secure.Dispose()
}
