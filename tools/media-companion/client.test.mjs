import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompanionClient, acquireLock, endpoint, limits, validateEndpoint, validateJob } from './client.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const now = 1_800_000_000_000;
const job = () => ({ quizId: 'quiz-1', slideId: 'slide-1', field: 'mediaSource', jobId: 'a'.repeat(64),
  leaseId: '92f39b4d-13a4-4d22-99ed-2465bded38cd', expiresAt: now + 900_000,
  source: { type: 'youtube', videoId: 'dQw4w9WgXcQ', kind: 'video', startSeconds: 5, endSeconds: 8 } });
const identity = () => ({ token: 'b'.repeat(64) + '.' + 'c'.repeat(43), deviceId: 'b'.repeat(64), expiresAt: now + 86_400_000, endpoint, pending: null });
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

async function fixture(t, options = {}) {
  await mkdir(path.join(repository, '.local-data'), { recursive: true });
  const directory = await mkdtemp(path.join(repository, '.local-data/media-companion-test-'));
  t.after(() => {
    const parent = path.resolve(repository, '.local-data');
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), parent);
    assert.match(path.basename(target), /^media-companion-test-/u);
    return rm(target, { recursive: true, force: true });
  });
  let state = options.state === null ? null : options.state ?? identity();
  const store = { directory, init: async () => null, load: async () => structuredClone(state),
    save: async next => { state = structuredClone(next); }, clear: async () => { state = null; } };
  const calls = [], reports = [], responses = options.responses ?? [];
  let clips = 0;
  const clip = options.clip ?? (async (source, config) => {
    clips++; assert.deepEqual(source, { videoId: 'dQw4w9WgXcQ', kind: 'video', startSeconds: 5, endSeconds: 8 });
    assert.equal(config.deadlineMs, 420_000);
    const filename = path.join(directory, 'test-output');
    await writeFile(filename, Buffer.from('synthetic-fixed-media'));
    return { path: filename, cleanup: () => rm(filename, { force: true }) };
  });
  const fetchImpl = async (url, request) => {
    calls.push({ url, ...request });
    assert.equal(request.redirect, 'error');
    if (request.headers.Authorization) assert.equal(request.headers.Authorization, 'Bearer ' + identity().token);
    const result = responses.shift();
    if (typeof result === 'function') return result(url, request);
    if (result instanceof Error) throw result;
    if (result === undefined) throw new Error('Unexpected network request');
    return result;
  };
  const client = new CompanionClient({ store, clip, clipConfig: {}, fetchImpl, now: () => now, report: value => reports.push(value) });
  return { client, calls, reports, directory, store, clip, fetchImpl, state: () => state, clips: () => clips };
}

test('live allowlist and explicit loopback demo endpoint fail closed', () => {
  assert.equal(validateEndpoint(), endpoint);
  const demo = 'http://127.0.0.1:5001/demo-companion/europe-west1/driveMediaCompanion';
  assert.equal(validateEndpoint(demo, 'demo-companion'), demo);
  for (const [url, project] of [
    [demo, undefined], [demo, 'filmovy-kviz-v2-staging'], [demo.replace('127.0.0.1', 'localhost'), 'demo-companion'],
    [demo + '?secret=value', 'demo-companion'], [demo + '/', 'demo-companion'],
    [demo.replace('127.0.0.1', '127.0.0.2'), 'demo-companion'], [demo.replace(':5001', ':65536'), 'demo-companion'],
    [endpoint + '?x=1', undefined], [endpoint.replace('https:', 'http:'), undefined], [endpoint, 'demo-companion'],
    ['https://attacker.example/driveMediaCompanion', undefined], [endpoint.replace('.net/', '.net.attacker.example/'), undefined],
  ]) assert.throws(() => validateEndpoint(url, project), { code: 'invalid-endpoint' });
});

test('reject remote paths, commands, future lease, malformed IDs, fields and timing before spawning', () => {
  assert.deepEqual(validateJob(job(), now), job());
  for (const change of [
    { quizId: undefined }, { slideId: '../file' }, { field: 'answerImage' }, { jobId: 'x' }, { leaseId: '../path' },
    { expiresAt: now }, { expiresAt: now + 3_600_001 }, { command: 'anything' },
    { source: { ...job().source, url: 'https://attacker.example' } }, { source: { ...job().source, startSeconds: -1 } },
    { source: { ...job().source, endSeconds: 300 } }, { source: { ...job().source, videoId: '--exec' } },
    { source: { ...job().source, type: 'file' } },
  ]) assert.throws(() => validateJob({ ...job(), ...change }, now), { code: 'invalid-job' });
});

test('pair consumes a canonical single-use code through JSON and persists only through protected store', async t => {
  const f = await fixture(t, { state: null, responses: [json({ token: identity().token, deviceId: identity().deviceId, expiresAt: identity().expiresAt })] });
  const code = Buffer.alloc(32, 7).toString('base64url');
  await f.client.pair(code);
  assert.deepEqual(JSON.parse(f.calls[0].body), { action: 'pair', code });
  assert.equal(f.calls[0].headers.Authorization, undefined);
  assert.equal(f.state().token, identity().token);
  assert.deepEqual(f.reports, ['paired']);
  await assert.rejects(() => f.client.pair(code + '='), { code: 'invalid-pair-code' });
});

test('serial successful job uploads raw verified bytes and discards private pending state', async t => {
  const f = await fixture(t, { responses: [json({ job: job() }), json({ jobId: job().jobId, status: 'ready', execution: 'local', reference: { private: true } })] });
  await f.client.tick();
  assert.equal(f.clips(), 1);
  assert.deepEqual(JSON.parse(f.calls[0].body), { action: 'claim' });
  assert.equal(f.calls[1].headers['Content-Type'], 'application/octet-stream');
  const url = new URL(f.calls[1].url);
  assert.deepEqual(Object.fromEntries(url.searchParams), { action: 'complete', jobId: job().jobId, leaseId: job().leaseId });
  assert.equal(f.calls[1].body.toString(), 'synthetic-fixed-media');
  assert.equal(f.state().pending, null);
  await assert.rejects(readFile(path.join(f.directory, 'pending.clip')), { code: 'ENOENT' });
  assert.deepEqual(f.reports, ['ready']);
});

test('ambiguous complete response survives restart and retries identical bytes without claiming or redownloading', async t => {
  const responses = [json({ job: job() }), new Error('private network details'), json({ jobId: job().jobId, status: 'ready', execution: 'local' })];
  const f = await fixture(t, { responses });
  await assert.rejects(() => f.client.tick(), { code: 'network' });
  assert.equal(f.state().pending.failed, false);
  const firstBytes = Buffer.from(f.calls[1].body);
  assert.equal(f.state().pending.sha256, createHash('sha256').update(firstBytes).digest('hex'));
  const restarted = new CompanionClient({ store: f.store, clip: () => assert.fail('must not redownload'), fetchImpl: f.fetchImpl, now: () => now });
  await restarted.tick();
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls[2].body, firstBytes);
  assert.equal(f.clips(), 1);
  assert.equal(f.state().pending, null);
});

test('malformed/ambiguous success keeps bytes until a definite receipt', async t => {
  const f = await fixture(t, { responses: [json({ job: job() }), json({ jobId: 'c'.repeat(64), status: 'ready' })] });
  await assert.rejects(() => f.client.tick(), { code: 'invalid-response' });
  assert.equal(f.state().pending.failed, false);
  assert.equal((await readFile(f.client.clipFile)).length, f.state().pending.bytes);
});

test('a processing failure sends only the fixed safe code and can retry failure after restart', async t => {
  const f = await fixture(t, { clip: async () => { throw new Error('provider private title and URL'); },
    responses: [json({ job: job() }), new Error('offline'), json({ jobId: job().jobId, status: 'failed', errorCode: 'processing-failed' })] });
  await assert.rejects(() => f.client.tick(), { code: 'network' });
  assert.deepEqual(JSON.parse(f.calls[1].body), { action: 'fail', jobId: job().jobId, leaseId: job().leaseId, code: 'processing-failed' });
  await f.client.tick();
  assert.equal(f.state().pending, null);
  assert.deepEqual(f.reports, ['failed']);
});

test('a persisted expired lease is discarded locally without uploading or claiming', async t => {
  const expired = { ...job(), expiresAt: now - 1 };
  const f = await fixture(t, { state: { ...identity(), pending: { job: expired, failed: true, bytes: 0 } } });
  await f.client.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.state().pending, null);
});

test('server stale lease clears retained bytes', async t => {
  const f = await fixture(t, { responses: [json({ job: job() }), json({}, 409)] });
  await f.client.tick();
  assert.equal(f.state().pending, null);
  assert.deepEqual(f.reports, ['stale']);
});

test('tampered retained media never uploads', async t => {
  const f = await fixture(t, { responses: [json({ job: job() }), new Error('offline')] });
  await assert.rejects(() => f.client.tick(), { code: 'network' });
  await writeFile(f.client.clipFile, 'tampered');
  await assert.rejects(() => f.client.tick(), { code: 'invalid-state' });
  assert.equal(f.calls.length, 2);
});

test('revoke stops polling, does not log token, URLs or arbitrary server text', async t => {
  const f = await fixture(t, { responses: [json({ error: 'private text' }, 403)] });
  await f.client.run();
  assert.equal(f.calls.length, 1);
  assert.equal(f.client.stopped, true);
  assert.deepEqual(f.reports, ['pairing-required']);
});

test('network retries back off and idle polling stays at 15 seconds', async t => {
  const f = await fixture(t, { responses: [json({}, 503), json({ job: null }), json({}, 401)] });
  const waits = []; f.client.wait = async ms => { waits.push(ms); };
  await f.client.run();
  assert.deepEqual(waits, [30_000, 15_000]);
  assert.deepEqual(f.reports, ['offline', 'pairing-required']);
});

test('reject HTTP redirects, content types and oversized declared/streamed JSON', async t => {
  for (const response of [
    new Response('', { status: 302, headers: { Location: 'https://attacker.example' } }),
    new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
    json({}, 200, { 'Content-Length': String(limits.responseBytes + 1) }),
    json({ job: 'x'.repeat(limits.responseBytes + 1) }),
  ]) {
    const f = await fixture(t, { responses: [response] });
    await assert.rejects(() => f.client.tick(), { code: 'invalid-response' });
    assert.equal(f.clips(), 0);
  }
});

test('overlapping ticks cannot create concurrent leases', async t => {
  let release;
  const f = await fixture(t, { responses: [async () => new Promise(resolve => { release = () => resolve(json({ job: null })); })] });
  const first = f.client.tick();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(() => f.client.tick(), { code: 'already-running' });
  release(); await first;
  assert.equal(f.calls.length, 1);
});

test('process lock excludes a second helper and releases cleanly', async t => {
  const f = await fixture(t);
  const release = await acquireLock(f.directory);
  await assert.rejects(() => acquireLock(f.directory), { code: 'already-running' });
  await release();
  const releaseAgain = await acquireLock(f.directory); await releaseAgain();
});

test('abort ends idle wait promptly and does not issue another claim', async t => {
  const controller = new AbortController();
  const f = await fixture(t, { responses: [async () => { setTimeout(() => controller.abort(), 5); return json({ job: null }); }] });
  await f.client.run(controller.signal);
  assert.equal(f.calls.length, 1);
});

test('abort during a bounded clip retains successful bytes without uploading after stop', async t => {
  const controller = new AbortController();
  let directory;
  const f = await fixture(t, { responses: [json({ job: job() })], clip: async () => {
    const filename = path.join(directory, 'test-output'); await writeFile(filename, 'synthetic-finished');
    controller.abort(); return { path: filename, cleanup: () => rm(filename, { force: true }) };
  } });
  directory = f.directory;
  await f.client.run(controller.signal);
  assert.equal(f.calls.length, 1);
  assert.equal(f.state().pending.failed, false);
  assert.equal((await readFile(f.client.clipFile)).toString(), 'synthetic-finished');
});
