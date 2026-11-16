import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { Window } from 'happy-dom';

const require = createRequire(import.meta.url);
const cli = createRequire(require.resolve('firebase-tools/package.json'));

test('patched minimatch retains callable and named APIs through actual CLI file filtering; glob honors cancellation', async t => {
  const parent = path.resolve('.local-data');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'dependency-matching-'));
  t.after(async () => { assert.equal(path.dirname(directory), parent); await rm(directory, { recursive: true, force: true }); });
  await mkdir(path.join(directory, 'nested'));
  await writeFile(path.join(directory, 'keep.js'), 'synthetic');
  await writeFile(path.join(directory, 'nested', 'drop.map'), 'synthetic');
  await writeFile(path.join(directory, '.env.synthetic'), 'not-a-secret');
  const mm = cli('minimatch');
  assert.equal(typeof mm, 'function');
  assert.equal(mm('nested/keep.js', '**/*.js'), true);
  assert.equal(mm.minimatch('nested/keep.js', '**/*.map'), false);
  assert.equal(new mm.Minimatch('**/*.js').match('nested/keep.js'), true);
  const files = await cli('./lib/fsAsync').readdirRecursive({ path: directory, ignoreStrings: ['**/*.map', '.env*'], ignoreSymlinks: true });
  assert.deepEqual(files.map(file => path.basename(file.name)).sort(), ['keep.js']);
  const { glob } = cli('glob');
  assert.deepEqual(await glob('**/*.js', { cwd: directory }), ['keep.js']);
  const controller = new AbortController(); controller.abort(new Error('synthetic-abort'));
  await assert.rejects(glob('**/*', { cwd: directory, signal: controller.signal }), /synthetic-abort/);
});

test('UUID keeps the CommonJS v4 SDK contract and rejects the advisory buffer overflow cases', () => {
  const sdk = createRequire(require.resolve('firebase-admin/app', { paths: [path.resolve('functions')] }));
  const firestore = createRequire(sdk.resolve('@google-cloud/firestore'));
  const transport = createRequire(firestore.resolve('google-gax'));
  const uuid = transport('uuid');
  const value = uuid.v4(); assert.equal(uuid.validate(value), true); assert.equal(uuid.version(value), 4);
  const namespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  for (const name of ['v3', 'v5']) assert.throws(() => uuid[name]('synthetic', namespace, new Uint8Array(8), 4), RangeError);
  assert.throws(() => uuid.v6({}, new Uint8Array(8), 4), RangeError);
});

test('PubSub telemetry keeps W3C trace propagation while bounding untrusted baggage entries', () => {
  const pubsub = createRequire(cli.resolve('@google-cloud/pubsub/package.json'));
  const { W3CBaggagePropagator, W3CTraceContextPropagator } = pubsub('@opentelemetry/core');
  const api = pubsub('@opentelemetry/api');
  const carrier = { baggage: Array.from({ length: 1000 }, (_, i) => `key${i}=value`).join(','), traceparent: '00-12345678901234567890123456789012-1234567890123456-01' };
  const getter = { get: (value, key) => value[key], keys: value => Object.keys(value) };
  const context = new W3CBaggagePropagator().extract(api.ROOT_CONTEXT, carrier, getter);
  const entries = api.propagation.getBaggage(context).getAllEntries();
  assert(entries.length > 0 && entries.length <= 180);
  const trace = new W3CTraceContextPropagator().extract(api.ROOT_CONTEXT, carrier, getter);
  assert.equal(api.trace.getSpanContext(trace).traceId, '12345678901234567890123456789012');
  assert.equal(typeof pubsub('./build/src/telemetry-tracing.js').injectSpan, 'function');
});

test('current CLI imports its upstream stream-json3 adapter and CSV7 parser without legacy API shims', async () => {
  const { chain, parser, streamArray } = await cli('./lib/streamJson').loadStreamJson();
  const rows = [];
  for await (const row of chain([Readable.from(['[{"name":"synthetic","n":1}]']), parser(), streamArray()])) rows.push(row.value);
  assert.deepEqual(rows, [{ name: 'synthetic', n: 1 }]);
  const { parse } = cli('csv-parse/sync');
  assert.deepEqual(parse('name,n\nsynthetic,1\n', { columns: true }), [{ name: 'synthetic', n: '1' }]);
});

test('Happy DOM defaults do not fetch iframe or stylesheet URLs when parsing untrusted HTML', async () => {
  let requests = 0;
  const server = http.createServer((_request, response) => { requests++; response.end('synthetic'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const window = new Window({ url: origin });
  try {
    window.document.body.innerHTML = `<iframe src="${origin}/frame"></iframe><link rel="stylesheet" href="${origin}/style"><p>safe text</p>`;
    await window.happyDOM.waitUntilComplete();
    assert.equal(window.document.querySelector('p').textContent, 'safe text');
    assert.equal(requests, 0);
  } finally { await window.happyDOM.close(); server.close(); await once(server, 'close'); }
});
