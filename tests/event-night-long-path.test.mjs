import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

test('Windows PowerShell 5 hashes actual long snapshot paths', { skip: process.platform !== 'win32' }, () => {
  const base = path.resolve('.local-data/qa/long-path');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(path.join(base, 'owned-'));
  let nested = root;
  while (nested.length < 220) {
    const remaining = 220 - nested.length - 1;
    if (remaining <= 0) break;
    nested = path.join(nested, 'x'.repeat(Math.min(48, remaining)));
  }
  mkdirSync(nested, { recursive: true });
  const file = path.join(nested, 'all_namespaces_'.repeat(4) + 'all_kinds.export_metadata');
  assert(file.length > 280);
  const bytes = Buffer.from('Synthetic long-path snapshot bytes\n');
  writeFileSync(file, bytes);
  const script = path.join(root, 'verify.ps1');
  writeFileSync(script, `param([string]$Common,[string]$Root,[string]$Output)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
function Throw-QaError { param([string]$Message,[string]$Hint) throw "$Message $Hint" }
. $Common
$records=@(Get-EventNightFileRecords $Root @('verify.ps1','result.json'))
if($records.Count -ne 1){throw 'Expected exactly one synthetic snapshot file'}
$records | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Output -Encoding UTF8
`);
  const output = path.join(root, 'result.json');
  const result = spawnSync(path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Common', path.resolve('tools/event-night/EventNight.Common.ps1'), '-Root', root, '-Output', output],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  const records = JSON.parse(readFileSync(output, 'utf8').replace(/^\uFEFF/u, ''));
  assert.equal(records.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(records.bytes, bytes.length);
  const changed = Buffer.from('Changed synthetic snapshot bytes\n');
  writeFileSync(file, changed);
  const again = spawnSync(path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Common', path.resolve('tools/event-night/EventNight.Common.ps1'), '-Root', root, '-Output', output],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(again.status, 0, again.stderr);
  const modified = JSON.parse(readFileSync(output, 'utf8').replace(/^\uFEFF/u, ''));
  assert.notEqual(modified.sha256, records.sha256);
  assert.equal(modified.sha256, createHash('sha256').update(changed).digest('hex'));
  const outside = mkdtempSync(path.join(base, 'outside-'));
  const sentinel = path.join(outside, 'retained.txt');
  writeFileSync(sentinel, bytes);
  symlinkSync(outside, path.join(root, 'escape'), 'junction');
  const escape = spawnSync(path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Common', path.resolve('tools/event-night/EventNight.Common.ps1'), '-Root', root, '-Output', output],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.notEqual(escape.status, 0);
  assert(escape.stderr.includes('Event-night'));
  assert(readFileSync(sentinel).equals(bytes));
});

test('Windows PowerShell 5 performs real promotion and recovery beyond MAX_PATH', { skip: process.platform !== 'win32' }, () => {
  const base = path.resolve('.local-data/qa/rename');
  mkdirSync(base, { recursive: true });
  let isolatedTemp = mkdtempSync(path.join(base, 'r-'));
  while (isolatedTemp.length < 110) {
    const remaining = 110 - isolatedTemp.length - 1;
    if (remaining < 1) break;
    isolatedTemp = path.join(isolatedTemp, 'x'.repeat(Math.min(48, remaining)));
  }
  mkdirSync(isolatedTemp, { recursive: true });
  const caseRoot = path.join(isolatedTemp, 'event-night-recovery-' + 'a'.repeat(32), 'between', '.local-data/event-night');
  const canonical = path.join(caseRoot, 'emulator-data');
  const backup = path.join(caseRoot, 'backups', '20261103T000000000Z-before-export-' + 'a'.repeat(32));
  assert(canonical.length < 260, 'Canonical source must remain below MAX_PATH');
  assert(backup.length > 260, 'Real backup rename destination must exceed MAX_PATH');
  const result = spawnSync(path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/fixtures/event-night-recovery.ps1'),
    '-CommonPath', path.resolve('tools/event-night/EventNight.Common.ps1'),
  ], { encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { ...process.env, TEMP: isolatedTemp, TMP: isolatedTemp, TMPDIR: isolatedTemp } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PASS: event-night recovery/);
});
