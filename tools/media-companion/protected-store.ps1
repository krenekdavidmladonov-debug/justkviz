$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$stage = 'input'
try {
  Add-Type -AssemblyName System.Security
  $inputText = [Console]::In.ReadToEnd()
  if ([Text.Encoding]::UTF8.GetByteCount($inputText) -gt 65536) { throw 'Invalid input' }
  $request = ConvertFrom-Json -InputObject $inputText
  if ($request.action -notin @('init', 'load', 'save', 'clear')) { throw 'Invalid action' }
  $directory = [IO.Path]::GetFullPath([string]$request.directory)
  if (-not [IO.Path]::IsPathRooted([string]$request.directory) -or $directory -ne [string]$request.directory) { throw 'Invalid directory' }
  # Inspect every existing ancestor: neither junctions nor symbolic links may
  # redirect credential or artifact storage outside this user's private folder.
  $cursor = $directory
  while ($cursor) {
    if ([IO.Directory]::Exists($cursor) -or [IO.File]::Exists($cursor)) {
      if (([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point' }
    }
    $parent = [IO.Directory]::GetParent($cursor)
    if ($null -eq $parent) { break }
    $cursor = $parent.FullName
  }
  $stage = 'directory'
  [IO.Directory]::CreateDirectory($directory) | Out-Null
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $stage = 'acl'
  # Request only the DACL. Get-Acl / a whole new descriptor can mark audit
  # metadata for writing and require SeSecurityPrivilege, even without admin.
  $sections = [Security.AccessControl.AccessControlSections]::Access
  $acl = [IO.Directory]::GetAccessControl($directory, $sections)
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  $correct = $acl.AreAccessRulesProtected -and $rules.Count -eq 1 -and $rules[0].IdentityReference.Value -eq $sid.Value -and $rules[0].AccessControlType -eq 'Allow' -and $rules[0].FileSystemRights -eq 'FullControl' -and $rules[0].InheritanceFlags -eq 'ContainerInherit, ObjectInherit'
  if (-not $correct) {
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existing in @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))) { $acl.RemoveAccessRuleSpecific($existing) }
    $stage = 'acl-rule'
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    $stage = 'acl-write'
    [IO.Directory]::SetAccessControl($directory, $acl)
  }
  $stage = 'state'
  $filename = [IO.Path]::Combine($directory, 'identity.dpapi')
  if ([IO.File]::Exists($filename) -and (([IO.File]::GetAttributes($filename) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Reparse point' }
  $entropy = [Text.Encoding]::UTF8.GetBytes('JustKvizMediaCompanion/v1')
  $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
  switch ($request.action) {
    'init' { [Console]::Out.Write('null') }
    'load' {
      $stage = 'decrypt'
      if (-not [IO.File]::Exists($filename)) { [Console]::Out.Write('null'); break }
      if ((New-Object IO.FileInfo($filename)).Length -gt 131072) { throw 'Oversized state' }
      $protected = [IO.File]::ReadAllBytes($filename)
      $bytes = [Security.Cryptography.ProtectedData]::Unprotect($protected, $entropy, $scope)
      if ($bytes.Length -gt 65536) { throw 'Oversized state' }
      [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
      [Array]::Clear($bytes, 0, $bytes.Length)
    }
    'save' {
      $stage = 'encrypt'
      $text = ConvertTo-Json -InputObject $request.state -Depth 12 -Compress
      $bytes = [Text.Encoding]::UTF8.GetBytes($text)
      if ($bytes.Length -gt 65536) { throw 'Oversized state' }
      $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope)
      [Array]::Clear($bytes, 0, $bytes.Length)
      $stage = 'write'
      $temporary = [IO.Path]::Combine($directory, 'identity-' + [Guid]::NewGuid().ToString('N') + '.tmp')
      try {
        $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($protected, 0, $protected.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        $stage = 'replace'
        if ([IO.File]::Exists($filename)) { [IO.File]::Replace($temporary, $filename, [NullString]::Value) }
        else { [IO.File]::Move($temporary, $filename) }
      } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
      [Console]::Out.Write('null')
    }
    'clear' { if ([IO.File]::Exists($filename)) { [IO.File]::Delete($filename) }; [Console]::Out.Write('null') }
  }
  exit 0
} catch {
  # Never print PowerShell exceptions: they may contain an input or a path.
  [Console]::Error.WriteLine('protected-store-failed:' + $stage)
  exit 1
}
