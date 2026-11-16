import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { sanitizedEnvironment } from '../tools/event-night/restart-acceptance.mjs';

test('Playwright Windows shutdown finds taskkill and stops only its owned child', { skip: process.platform !== 'win32' }, async () => {
  const directory = path.resolve('.local-data/qa/owned-cleanup');
  mkdirSync(directory, { recursive: true });
  const env = sanitizedEnvironment(directory, 'demo-owned-cleanup', {
    SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, ComSpec: process.env.ComSpec,
    PATH: path.dirname(process.execPath),
  });
  const sentinel = net.createServer();
  await new Promise(resolve => sentinel.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, ['-e', "process.stdout.write('ready');setInterval(()=>{},1000)"], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'exit');
  try {
    await once(child.stdout, 'data');
    // Same mechanism as Playwright; PID comes only from this test's ChildProcess.
    const result = spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true, env, encoding: 'utf8', windowsHide: true, timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    let timer;
    try { await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned child did not stop')), 5000); })]); }
    finally { clearTimeout(timer); }
    assert.equal(sentinel.listening, true);
    assert.equal(Object.keys(env).filter(k => k.toUpperCase() === 'PATH').length, 1);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await new Promise(resolve => sentinel.close(resolve));
  }
});
