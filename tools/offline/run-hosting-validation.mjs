import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { STAGING_APP, STAGING_PROJECT } from '../staging/guard.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const web = path.join(root, 'apps/web');
const host = 'justkviz-v2.web.app';
const origin = 'https://' + host;
const date = new Date().toISOString().replace(/[^0-9]/gu, '').slice(0, 17);
const output = path.join(root, '.local-data', 'offline-hosting', date);
const sha = bytes => createHash('sha256').update(bytes);
const artifacts = ['offline.html', 'offline.webmanifest', 'offline-sw.js'];
const readyButton = 'Uložit aplikaci pro offline spuštění';

function der(tag, ...parts) {
  const body = Buffer.concat(parts);
  const length = body.length < 128 ? [body.length] : body.length < 256 ? [129, body.length] : [130, body.length >> 8, body.length & 255];
  return Buffer.concat([Buffer.from([tag, ...length]), body]);
}

/** An ephemeral local test certificate. Its only trusted SPKI is passed to this test's Chromium. */
function loopbackTls() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const hex = value => Buffer.from(value, 'hex');
  const utf8 = value => Buffer.from(value);
  const time = offset => new Date(Date.now() + offset).toISOString().slice(2, 19).replace(/\D/gu, '') + 'Z';
  const algorithm = der(0x30, hex('06082a8648ce3d040302'));
  const name = der(0x30, der(0x31, der(0x30, hex('0603550403'), der(0x0c, utf8(host)))));
  const validity = der(0x30, der(0x17, utf8(time(-86400000))), der(0x17, utf8(time(86400000))));
  const san = der(0xa3, der(0x30, der(0x30, hex('0603551d11'), der(0x04, der(0x30, der(0x82, utf8(host)))))));
  const subject = der(0x30, hex('a003020102020101'), algorithm, name, validity, name, spki, san);
  const certificate = der(0x30, subject, algorithm, der(0x03, Buffer.of(0), sign('sha256', subject, privateKey)));
  return {
    key: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    cert: '-----BEGIN CERTIFICATE-----\n' + certificate.toString('base64').match(/.{1,64}/gu).join('\n') + '\n-----END CERTIFICATE-----\n',
    pin: sha(spki).digest('base64'),
  };
}

const modes = { disabled: '', armed: 'true', recovery: 'recovery' };
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output);
for (const [name, flag] of Object.entries(modes)) {
  const env = {
    ...process.env,
    VITE_FIREBASE_PROJECT_ID: STAGING_PROJECT, VITE_FIREBASE_APP_ID: STAGING_APP,
    VITE_FIREBASE_AUTH_DOMAIN: STAGING_PROJECT + '.firebaseapp.com',
    VITE_FIREBASE_STORAGE_BUCKET: STAGING_PROJECT + '.firebasestorage.app',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '177615774316', VITE_FIREBASE_API_KEY: 'synthetic-offline-hosting-artifact-only',
    VITE_FIREBASE_USE_EMULATORS: 'false', VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT: 'true',
    VITE_APP_ENV: 'staging', VITE_JUSTKVIZ_OFFLINE: flag,
  };
  const log = execFileSync(process.execPath, [path.join(web, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'staging', '--outDir', path.join(output, name)],
    { cwd: web, env, encoding: 'utf8', windowsHide: true });
  await writeFile(path.join(output, name + '-build.log'), log, { flag: 'wx' });
}
for (const name of artifacts) await assert.rejects(stat(path.join(output, 'disabled', name)), { code: 'ENOENT' });
const reports = {};
for (const mode of ['armed', 'recovery']) {
  const dir = path.join(output, mode);
  const worker = await readFile(path.join(dir, 'offline-sw.js'), 'utf8');
  const files = JSON.parse(/const FILES=(\[[^\n]*?\]);/u.exec(worker)[1]);
  const integrity = JSON.parse(/const INTEGRITY=(\{[^\n]*?\});/u.exec(worker)[1]);
  const version = /const VERSION="([^"]+)"/u.exec(worker)[1];
  assert(files.includes('/offline.html') && files.includes('/offline.webmanifest'));
  assert.deepEqual(Object.keys(integrity), files);
  const checksums = {};
  for (const url of files) {
    const relative = decodeURIComponent(url.slice(1));
    assert(url.startsWith('/') && !relative.split('/').some(part => part === '..' || part === '.'));
    assert(!/^\/(?:index\.html|admin|api|offline-sw\.js)(?:$|\/)/u.test(url));
    const bytes = await readFile(path.join(dir, relative));
    assert.equal(integrity[url], 'sha256-' + sha(bytes).digest('base64'));
    checksums[url] = sha(bytes).digest('hex');
  }
  const manifest = JSON.parse(await readFile(path.join(dir, 'offline.webmanifest'), 'utf8'));
  assert.equal(manifest.id, '/offline.html');
  assert.equal(manifest.scope, '/offline.html');
  assert.equal(manifest.start_url, '/offline.html');
  assert.equal(manifest.display, 'standalone');
  reports[mode] = { version, inventoryFiles: files.length, workerSha256: sha(worker).digest('hex'), checksums };
}
assert.notEqual(reports.armed.version, reports.recovery.version);

const tls = loopbackTls();
let served = 'armed', tamper = false;
const requests = [];
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = createServer({ key: tls.key, cert: tls.cert }, async (request, response) => {
  let uri, relative;
  try {
    uri = new URL(request.url, origin);
    relative = decodeURIComponent(uri.pathname.slice(1));
    if (request.headers.host !== host || !uri.pathname.startsWith('/') || /[\\:]/u.test(relative) || relative.includes('\0')
      || relative.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Invalid fixture request.');
  } catch { response.writeHead(400).end(); return; }
  if (!(uri.pathname in reports[served].checksums) && !['/offline-sw.js', '/justkviz-connection-check.txt'].includes(uri.pathname)) {
    response.writeHead(404).end(); return;
  }
  requests.push(uri.pathname);
  try {
    const data = await readFile(path.join(output, served, relative));
    response.writeHead(200, { 'Content-Type': types[path.extname(relative)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(tamper && relative === 'brand/justkviz-icon.svg' ? Buffer.concat([data, Buffer.from('\n<!-- invalid fixture -->')]) : data);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
const external = [];
const pageErrors = [];
const prepare = origin + '/offline.html#/prepare?eventId=synthetic-hosting';
async function newPage(context) {
  const page = await context.newPage();
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) external.push(url.origin);
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  return page;
}
async function install(page) {
  await page.getByRole('button', { name: readyButton, exact: true }).click();
  await page.locator('[data-offline-status]').filter({ hasText: 'Aplikace se úspěšně spustila' }).waitFor();
}
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: [
    '--no-proxy-server', '--disable-background-networking',
    '--host-resolver-rules=MAP ' + host + ' 127.0.0.1:' + server.address().port + ', MAP * ~NOTFOUND',
    '--ignore-certificate-errors-spki-list=' + tls.pin,
  ] });
  const corruptedContext = await browser.newContext();
  const corrupted = await newPage(corruptedContext);
  await corrupted.goto(prepare);
  await corrupted.getByRole('heading', { name: 'Připravit offline kvíz' }).waitFor();
  tamper = true;
  const beforeTamper = requests.length;
  await corrupted.getByRole('button', { name: readyButton, exact: true }).click();
  await corrupted.locator('[data-offline-error]').filter({ hasText: 'nepodařilo uložit' }).waitFor();
  assert(requests.slice(beforeTamper).includes('/brand/justkviz-icon.svg'));
  assert.equal(await corrupted.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active)), false);
  await corruptedContext.close();
  tamper = false;

  const context = await browser.newContext();
  const first = await newPage(context);
  await first.goto(prepare);
  assert.equal(await first.evaluate(() => globalThis.isSecureContext), true);
  await install(first);
  const previous = reports.armed.version;
  assert.equal(await first.evaluate(version => globalThis.caches.has(version), previous), true);
  served = 'recovery';
  await first.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await expect.poll(() => first.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
  await first.getByRole('heading', { name: 'Připravit offline kvíz' }).waitFor();
  const oldFile = Object.keys(reports.armed.checksums).find(url => url.endsWith('.js') && !(url in reports.recovery.checksums));
  assert(oldFile);
  const beforeOldChunk = requests.length;
  assert.equal(await first.evaluate(async url => {
    const bytes = await (await fetch(url)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  }, oldFile), reports.armed.checksums[oldFile]);
  assert(!requests.slice(beforeOldChunk).includes(oldFile));
  await first.close();

  const recovered = await newPage(context);
  await recovered.goto(origin + '/justkviz-connection-check.txt');
  await expect.poll(() => recovered.evaluate(async expected => {
    const registration = await navigator.serviceWorker.getRegistration('/offline.html');
    if (registration?.active?.state !== 'activated' || registration.waiting || registration.installing) return false;
    return new Promise(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 250);
      channel.port1.onmessage = ({ data }) => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(data?.version === expected && data.ready === true);
      };
      registration.active.postMessage({ type: 'VERIFY_OFFLINE_SHELL' }, [channel.port2]);
    });
  }, reports.recovery.version)).toBe(true);
  const updatedEntry = await recovered.goto(prepare);
  assert.equal(sha(await updatedEntry.body()).digest('hex'), reports.recovery.checksums['/offline.html']);
  await recovered.getByRole('heading', { name: 'Spustit offline kvíz' }).waitFor().catch(async error => {
    throw new Error('Updated shell rendered unexpected headings: ' + JSON.stringify(await recovered.locator('h1').allTextContents()), { cause: error });
  });
  await recovered.getByRole('button', { name: 'Připravit notebook pro přenesený kvíz' }).waitFor({ state: 'detached' });
  await install(recovered);
  const beforeOffline = requests.length;
  await context.setOffline(true);
  await recovered.reload();
  await recovered.getByRole('heading', { name: 'Spustit offline kvíz' }).waitFor();
  assert.equal(requests.length, beforeOffline);
  assert.deepEqual(external, []);
  assert.deepEqual(pageErrors, []);
  await writeFile(path.join(output, 'hosting-proof.json'), JSON.stringify({
    status: 'PASS', browser: browser.version(), targetOrigin: origin, syntheticConfig: true, localTlsOnly: true,
    disabledArtifactAbsent: true, tamperedPrecacheRejected: true, oldClientKeptItsCachedChunk: true,
    recoveryOnlyActivatedAfterOldClientClosed: true, offlineReloadUsedNoServerRequests: true, reports,
  }, null, 2) + '\n', { flag: 'wx' });
  console.log('OFFLINE_HOSTING_VALIDATION_PASS ' + path.relative(root, output));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
