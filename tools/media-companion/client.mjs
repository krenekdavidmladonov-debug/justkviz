import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile, realpath, readdir, rename, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createYouTubeClip, validateClipRequest } from '../media-worker/clip.mjs';
import { verifyPortableRuntime } from './runtime.mjs';

export const endpoint = 'https://europe-west1-filmovy-kviz-v2-staging.cloudfunctions.net/driveMediaCompanion';
export const limits = Object.freeze({ stateBytes: 25 * 1024 * 1024, metadataBytes: 128 * 1024,
  responseBytes: 16 * 1024, requestMs: 120_000, processingMs: 420_000, idleMs: 15_000 });
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const id = /^[A-Za-z0-9_-]{1,150}$/u;
const validId = value => typeof value === 'string' && id.test(value);
const jobId = /^[a-f0-9]{64}$/u;
const leaseId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const ownKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key));
const fail = code => Object.assign(new Error(code), { code });
const timestamp = value => Number.isSafeInteger(value) && value > 0;
const opaqueToken = value => typeof value === 'string' && /^[\x21-\x7E]{32,512}$/u.test(value);
const sleep = (ms, signal) => new Promise(resolve => {
  const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
  const timer = setTimeout(finish, ms);
  if (signal?.aborted) finish(); else signal?.addEventListener('abort', finish, { once: true });
});
const clipSource = ({ kind, videoId, startSeconds, endSeconds }) => ({ kind, videoId, startSeconds, endSeconds });

/** The live endpoint is compiled in. Emulator access needs BOTH explicit demo project and loopback URL. */
export function validateEndpoint(value = endpoint, emulatorProject) {
  if (value === endpoint && emulatorProject === undefined) return value;
  let url;
  try { url = new URL(value); } catch { throw fail('invalid-endpoint'); }
  if (typeof emulatorProject !== 'string' || !/^demo-[a-z0-9-]{1,80}$/u.test(emulatorProject)
    || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^\d{1,5}$/u.test(url.port)
    || Number(url.port) < 1 || Number(url.port) > 65535 || url.username || url.password || url.search || url.hash
    || url.pathname !== '/' + emulatorProject + '/europe-west1/driveMediaCompanion'
    || url.href !== value) throw fail('invalid-endpoint');
  return value;
}

export function validateJob(value, now = Date.now()) {
  if (!ownKeys(value, ['quizId', 'slideId', 'field', 'jobId', 'leaseId', 'expiresAt', 'source'])
    || !validId(value.quizId) || !validId(value.slideId) || value.field !== 'mediaSource'
    || !jobId.test(value.jobId) || !leaseId.test(value.leaseId)
    || !timestamp(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + 3_600_000
    || !ownKeys(value.source, ['type', 'kind', 'videoId', 'startSeconds', 'endSeconds'])
    || value.source.type !== 'youtube') throw fail('invalid-job');
  const source = clipSource(value.source);
  try { validateClipRequest(source); } catch { throw fail('invalid-job'); }
  return structuredClone(value);
}

function validateIdentity(value, expectedEndpoint, now) {
  if (!ownKeys(value, ['token', 'deviceId', 'expiresAt', 'endpoint', 'pending']) || !opaqueToken(value.token)
    || !validId(value.deviceId) || !timestamp(value.expiresAt) || value.expiresAt <= now
    || value.endpoint !== expectedEndpoint) throw fail('pairing-required');
  if (value.pending !== undefined && value.pending !== null) {
    const pending = value.pending;
    if (!ownKeys(pending, ['job', 'sha256', 'bytes', 'failed']) || !pending.job
      || (pending.failed === true ? pending.sha256 !== undefined || pending.bytes !== 0 : !/^[a-f0-9]{64}$/u.test(pending.sha256 ?? ''))
      || !Number.isSafeInteger(pending.bytes) || pending.bytes < 0 || pending.bytes > limits.stateBytes - limits.metadataBytes
      || typeof pending.failed !== 'boolean') throw fail('invalid-state');
    // A valid persisted lease may have expired while the computer was asleep.
    validateJob(pending.job, Math.min(now, pending.job.expiresAt - 1));
  }
  return value;
}

async function jsonResponse(response, requestedUrl) {
  if (response.redirected || response.url && response.url !== requestedUrl || response.status >= 300 && response.status < 400) {
    await response.body?.cancel(); throw fail('invalid-response');
  }
  if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw fail('revoked'); }
  if ([409, 410].includes(response.status)) { await response.body?.cancel(); throw fail('stale'); }
  if (response.status === 429 || response.status >= 500) { await response.body?.cancel(); throw fail('network'); }
  if (!response.ok || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(response.headers.get('content-type') ?? '')
    || response.headers.has('content-length') && (!/^\d+$/u.test(response.headers.get('content-length'))
      || Number(response.headers.get('content-length')) > limits.responseBytes)) {
    await response.body?.cancel(); throw fail('invalid-response');
  }
  if (!response.body) throw fail('invalid-response');
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limits.responseBytes) { await reader.cancel(); throw fail('invalid-response'); }
      chunks.push(Buffer.from(chunk.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error.code === 'invalid-response') throw error;
    throw fail(error instanceof SyntaxError ? 'invalid-response' : 'network');
  }
  finally { reader.releaseLock(); }
}

/** Only this fixed local script receives secrets, over stdin. Neither argv nor logs contain credentials. */
export function createProtectedStore(directory, { spawnProcess = spawn, platform = process.platform } = {}) {
  if (platform !== 'win32' || !path.isAbsolute(directory)) throw fail('windows-required');
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot || !path.isAbsolute(systemRoot)) throw fail('windows-required');
  const powershell = path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const execute = (action, state) => new Promise((resolve, reject) => {
    const input = JSON.stringify({ action, directory, ...(state === undefined ? {} : { state }) });
    if (Buffer.byteLength(input) > 64 * 1024) { reject(fail('state-too-large')); return; }
    const child = spawnProcess(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'protected-store.ps1')],
      { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: Object.fromEntries(
        ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]])) });
    let output = '', stderrBytes = 0, failed = false, diagnostic = '';
    const timer = setTimeout(() => { failed = true; child.kill(); }, 20_000);
    child.stdout.on('data', chunk => { output += chunk.toString('utf8'); if (Buffer.byteLength(output) > 128 * 1024) { failed = true; child.kill(); } });
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes <= 4096) diagnostic += chunk.toString('utf8'); else { failed = true; child.kill(); } });
    child.once('error', () => { clearTimeout(timer); reject(fail('protected-store-failed')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (failed || code !== 0) {
        const error = fail('protected-store-failed');
        const match = /^protected-store-failed:(input|directory|acl|acl-rule|acl-write|state|decrypt|encrypt|write|replace)\s*$/u.exec(diagnostic);
        if (match) error.diagnosticCode = match[1];
        reject(error); return;
      }
      try { resolve(JSON.parse(output)); } catch { reject(fail('protected-store-failed')); }
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
  return { directory, init: () => execute('init'), load: () => execute('load'), save: state => execute('save', state), clear: () => execute('clear') };
}

async function checkedFile(filename, maximum) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum || info.size <= 0) throw fail('invalid-state');
  return info;
}
async function erase(filename) { await unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; }); }

export class CompanionClient {
  constructor({ url = endpoint, emulatorProject, store, clip = createYouTubeClip, clipConfig, fetchImpl = fetch,
    now = Date.now, wait = sleep, report = () => undefined } = {}) {
    this.url = validateEndpoint(url, emulatorProject);
    if (!store || !path.isAbsolute(store.directory)) throw fail('invalid-store');
    Object.assign(this, { store, clip, clipConfig, fetchImpl, now, wait, report });
    this.clipFile = path.join(store.directory, 'pending.clip');
    this.state = undefined; this.stopped = false; this.busy = false;
  }
  async request(payload, bytes) {
    if (this.signal?.aborted) throw fail('stopped');
    let url = this.url;
    if (bytes) {
      const target = new URL(url); target.search = new URLSearchParams({ action: 'complete', jobId: payload.jobId, leaseId: payload.leaseId }).toString(); url = target.href;
    }
    let response;
    try {
      const deadline = AbortSignal.timeout(limits.requestMs);
      response = await this.fetchImpl(url, { method: 'POST', redirect: 'error', signal: this.signal ? AbortSignal.any([deadline, this.signal]) : deadline,
        headers: { 'Content-Type': bytes ? 'application/octet-stream' : 'application/json',
          ...(this.state ? { Authorization: 'Bearer ' + this.state.token } : {}) }, body: bytes ?? JSON.stringify(payload) });
    } catch { throw fail(this.signal?.aborted ? 'stopped' : 'network'); }
    return jsonResponse(response, url);
  }
  async pair(code) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(code) || Buffer.from(code, 'base64url').toString('base64url') !== code) throw fail('invalid-pair-code');
    await this.store.init();
    this.state = undefined;
    const result = await this.request({ action: 'pair', code });
    if (!ownKeys(result, ['token', 'deviceId', 'expiresAt'])) throw fail('invalid-response');
    this.state = validateIdentity({ ...result, endpoint: this.url, pending: null }, this.url, this.now());
    await erase(this.clipFile); await erase(this.clipFile + '.part');
    await this.store.save(this.state); this.report('paired');
  }
  async load() {
    await this.store.init();
    this.state = validateIdentity(await this.store.load(), this.url, this.now());
    // An interrupted atomic rename can leave only one small temporary artifact.
    await erase(this.clipFile + '.part');
    if (!this.state.pending || this.state.pending.failed) await erase(this.clipFile);
  }
  async dropPending() {
    this.state.pending = null; await this.store.save(this.state); await erase(this.clipFile); await erase(this.clipFile + '.part');
  }
  async sendPending() {
    const pending = this.state.pending;
    if (pending.job.expiresAt <= this.now()) { await this.dropPending(); this.report('lease-expired'); return; }
    const payload = { jobId: pending.job.jobId, leaseId: pending.job.leaseId };
    try {
      let result;
      if (pending.failed) result = await this.request({ action: 'fail', ...payload, code: 'processing-failed' });
      else {
        await checkedFile(this.clipFile, limits.stateBytes - limits.metadataBytes);
        const bytes = await readFile(this.clipFile);
        if (bytes.length !== pending.bytes || createHash('sha256').update(bytes).digest('hex') !== pending.sha256) throw fail('invalid-state');
        result = await this.request(payload, bytes);
      }
      if (!ownKeys(result, ['jobId', 'status', 'reference', 'execution', 'errorCode']) || result.jobId !== payload.jobId
        || !['ready', 'failed', 'stale', 'processing'].includes(result.status)) throw fail('invalid-response');
      if (['ready', 'failed', 'stale'].includes(result.status)) { await this.dropPending(); this.report(result.status); }
    } catch (error) {
      if (error.code === 'stale') { await this.dropPending(); this.report('stale'); }
      else throw error;
    }
  }
  async tick() {
    if (this.busy || this.stopped) throw fail('already-running');
    this.busy = true;
    try {
      if (!this.state) await this.load();
      if (this.state.expiresAt <= this.now()) throw fail('revoked');
      if (this.state.pending) { await this.sendPending(); return; }
      const result = await this.request({ action: 'claim' });
      if (!ownKeys(result, ['job']) || !Object.hasOwn(result, 'job')) throw fail('invalid-response');
      if (result.job === null) return;
      const job = validateJob(result.job, this.now());
      // Persist the lease before local work. A process interruption is reported as
      // failure after restart instead of downloading the same lease twice.
      this.state.pending = { job, bytes: 0, failed: true };
      await this.store.save(this.state);
      let artifact;
      try {
        const source = clipSource(job.source);
        artifact = await this.clip(source, { ...this.clipConfig, deadlineMs: Math.min(limits.processingMs, job.expiresAt - this.now()) });
        const info = await checkedFile(artifact.path, limits.stateBytes - limits.metadataBytes);
        if (job.expiresAt <= this.now()) { await this.dropPending(); return; }
        const bytes = await readFile(artifact.path);
        await copyFile(artifact.path, this.clipFile + '.part', constants.COPYFILE_EXCL);
        await rename(this.clipFile + '.part', this.clipFile);
        this.state.pending = { job, bytes: info.size, sha256: createHash('sha256').update(bytes).digest('hex'), failed: false };
        await this.store.save(this.state);
      } catch {
        // Only fixed failure codes cross the boundary; tool output and URLs stay private.
        this.state.pending = { job, bytes: 0, failed: true };
        await this.store.save(this.state); await erase(this.clipFile); await erase(this.clipFile + '.part');
      } finally { await artifact?.cleanup(); }
      if (!this.signal?.aborted) await this.sendPending();
    } finally { this.busy = false; }
  }
  async run(signal) {
    this.signal = signal;
    let failures = 0;
    while (!signal?.aborted && !this.stopped) {
      try { await this.tick(); failures = 0; }
      catch (error) {
        if (signal?.aborted) return;
        if (['revoked', 'pairing-required'].includes(error.code)) { this.stopped = true; this.report('pairing-required'); return; }
        if (error.code !== 'network') { this.stopped = true; this.report('stopped'); return; }
        failures = Math.min(failures + 1, 5); this.report('offline');
      }
      if (!signal?.aborted && !this.stopped) {
        let abort;
        const aborted = new Promise(resolve => {
          abort = resolve; signal?.addEventListener('abort', abort, { once: true });
        });
        try { await Promise.race([this.wait(Math.min(300_000, limits.idleMs * 2 ** failures), signal), aborted]); }
        finally { signal?.removeEventListener('abort', abort); }
      }
    }
  }
}

/** A private lock prevents a manual start and a logon start from creating two helpers. */
export async function acquireLock(directory) {
  const filename = path.join(directory, 'helper.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const descriptor = await open(filename, 'wx', 0o600);
      await descriptor.writeFile(String(process.pid)); await descriptor.close();
      return () => erase(filename);
    } catch (error) {
      if (error.code !== 'EEXIST') throw fail('lock-failed');
      await checkedFile(filename, 32);
      const pid = Number(await readFile(filename, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw fail('already-running');
      try { process.kill(pid, 0); throw fail('already-running'); }
      catch (cause) { if (cause.code !== 'ESRCH') throw fail('already-running'); }
      await erase(filename);
    }
  }
  throw fail('already-running');
}

async function main() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA || !path.isAbsolute(process.env.LOCALAPPDATA)) throw fail('windows-required');
  const args = process.argv.slice(2), pairing = args[0] === '--pair';
  let url = endpoint, emulatorProject;
  const tail = args.slice(pairing ? 1 : 0);
  if (tail.length) {
    if (tail.length !== 4 || tail[0] !== '--emulator-project' || tail[2] !== '--emulator-port'
      || !/^\d{1,5}$/u.test(tail[3])) throw fail('invalid-options');
    emulatorProject = tail[1]; url = `http://127.0.0.1:${tail[3]}/${emulatorProject}/europe-west1/driveMediaCompanion`;
  }
  validateEndpoint(url, emulatorProject);
  await verifyPortableRuntime(root);
  const store = createProtectedStore(path.join(process.env.LOCALAPPDATA, emulatorProject ? 'JustKvizMediaCompanion-' + emulatorProject : 'JustKvizMediaCompanion'));
  await store.init(); const release = await acquireLock(store.directory);
  try {
    const scratch = path.join(store.directory, 'scratch'); await mkdir(scratch, { recursive: true });
    if ((await lstat(scratch)).isSymbolicLink() || await realpath(scratch) !== scratch) throw fail('invalid-store');
    // Remove only this helper's verified scratch directories left by an abrupt
    // process termination. A junction or unknown entry stops cleanup closed.
    for (const name of await readdir(scratch)) {
      const target = path.resolve(scratch, name), info = await lstat(target);
      if (!/^clip-[A-Za-z0-9]{6}$/u.test(name) || path.dirname(target) !== scratch
        || !info.isDirectory() || info.isSymbolicLink() || await realpath(target) !== target) throw fail('scratch-cleanup-required');
      await rm(target, { recursive: true });
    }
    const clipConfig = { ytDlpPath: path.join(root, 'bin/yt-dlp.exe'), ffmpegPath: path.join(root, 'bin/ffmpeg.exe'),
      ffprobePath: path.join(root, 'bin/ffprobe.exe'), nodePath: path.join(root, 'bin/node.exe'), tempRoot: scratch };
    const client = new CompanionClient({ url, emulatorProject, store, clipConfig,
      report: message => process.stdout.write(message + '\n') });
    if (pairing) {
      let input = ''; for await (const chunk of process.stdin) { input += chunk.toString('utf8'); if (input.length > 256) throw fail('invalid-pair-code'); }
      await client.pair(input.trim()); input = ''; return;
    }
    const controller = new AbortController();
    process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
    await client.run(controller.signal);
  } finally { await release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) {
    const known = ['windows-required', 'already-running', 'pairing-required', 'invalid-pair-code', 'invalid-options', 'invalid-endpoint', 'scratch-cleanup-required'];
    process.stderr.write((known.includes(error.code) ? error.code : 'companion-failed') + '\n'); process.exitCode = 1;
  }
}
