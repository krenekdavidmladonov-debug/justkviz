import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProtectedStore } from './client.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));

test('Windows CurrentUser DPAPI roundtrip and user-only ACL with a synthetic token', { skip: process.platform !== 'win32' }, async t => {
  await mkdir(path.join(repository, '.local-data'), { recursive: true });
  const directory = await mkdtemp(path.join(repository, '.local-data/media-companion-dpapi-test-žluťoučký '));
  t.after(() => {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(repository, '.local-data'));
    assert.match(path.basename(target), /^media-companion-dpapi-test-/u);
    return rm(target, { recursive: true, force: true });
  });
  const calls = [];
  const store = createProtectedStore(directory, { spawnProcess: (command, args, options) => {
    calls.push({ command, args, options }); return spawn(command, args, options);
  } });
  const synthetic = { token: 'SYNTHETIC-ONLY-DO-NOT-USE-' + 'a'.repeat(80), deviceId: 'synthetic', expiresAt: 1_900_000_000_000 };
  await store.init(); assert.equal(await store.load(), null);
  await store.save(synthetic); assert.deepEqual(await store.load(), synthetic);
  const ciphertext = await readFile(path.join(directory, 'identity.dpapi'));
  assert.equal(ciphertext.includes(Buffer.from(synthetic.token)), false);
  await store.save({ ...synthetic, deviceId: 'replacement' });
  assert.equal((await store.load()).deviceId, 'replacement');
  for (const call of calls) {
    assert.equal(JSON.stringify(call.args).includes(synthetic.token), false);
    assert.equal(JSON.stringify(call.options.env).includes(synthetic.token), false);
    assert.equal(call.options.windowsHide, true);
  }
  // ACL output contains only booleans/counts, never paths or credentials.
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const check = '[Console]::InputEncoding=New-Object Text.UTF8Encoding($false); $p=[Console]::In.ReadToEnd(); $s=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $a=[IO.Directory]::GetAccessControl($p,[Security.AccessControl.AccessControlSections]::Access); $r=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])); [Console]::Out.Write((@{protected=$a.AreAccessRulesProtected;count=$r.Count;match=($r.Count -eq 1 -and $r[0].IdentityReference.Value -eq $s)} | ConvertTo-Json -Compress))';
  const ok = await new Promise((resolve, reject) => {
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', check], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let text = ''; child.stdout.on('data', chunk => { text += chunk; }); child.stderr.resume();
    child.once('error', reject); child.once('close', code => code === 0 ? resolve(text) : reject(new Error('acl-check-failed')));
    child.stdin.end(directory);
  });
  assert.deepEqual(JSON.parse(ok), { protected: true, count: 1, match: true });
  await store.clear(); assert.equal(await store.load(), null);
});
