/* global document, window, createImageBitmap */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium, expect, test } from '@playwright/test';
import { updatePassword } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getFirestore, terminate, updateDoc } from 'firebase/firestore';
import { PNG } from 'pngjs';
import { mediaFixture, mediaSlide } from '../e2e/media-fixture.mjs';
import { localEmulatorEndpoint, requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const projectId = 'demo-filmovy-kviz-v2';
const hosting = 'http://127.0.0.1:5000';
const functions = 'http://127.0.0.1:5001';
const prefix = `/${projectId}/europe-west1/`;
const gatewayPath = `${prefix}readQuizMedia`;
const authorityPath = `${prefix}readLocalImageAuthority`;
const allowedOrigins = new Set([hosting, functions, 'http://127.0.0.1:8080', 'http://127.0.0.1:9099']);
const privateAnswer = 'Soukromá odpověď pro víceobrázkovou zálohu';
const privateNote = 'Soukromá poznámka mimo balíček obrázků';
const MiB = 1024 * 1024;
const execFileAsync = promisify(execFile);
const panel = page => page.locator('[data-local-image-backup-status]');
const control = page => page.locator('[data-local-image-control-status]');
const roleImage = (page, role = 'question-image') => page.locator(`img[data-role="${role}"]`);
const localImages = page => page.locator('img[data-local-media-source="local"]');
const prepare = page => page.getByRole('button', { name: 'Připravit zálohu obrázků', exact: true });
const save = page => page.getByRole('button', { name: 'Uložit zálohu obrázků', exact: true });
const open = page => page.getByLabel('Otevřít zálohu obrázků', { exact: true });
const load = page => page.getByLabel('Načíst zálohu obrázků', { exact: true });
const isAuthority = url => url.origin === functions && url.pathname === authorityPath;

function requireEmulators(baseURL) {
  const env = requireFullEmulatorEnvironment(process.env, 'Local image backup');
  const storage = localEmulatorEndpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Local image backup Storage');
  if (baseURL !== hosting || env.projectId !== projectId || env.authEndpoint.port !== 9099 ||
    env.firestoreEndpoint.port !== 8080 || env.functionsEndpoint.port !== 5001 || storage.port !== 9199) {
    throw new Error('Local image backup requires its dedicated demo project and loopback emulator ports.');
  }
}

async function localOnly(context) {
  await context.route('**/*', route => allowedOrigins.has(new URL(route.request().url()).origin)
    ? route.continue() : route.abort('blockedbyclient'));
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
}

function gatewayFor(sessionId, reference) {
  return url => url.origin === functions && url.pathname === gatewayPath &&
    (sessionId === undefined || url.searchParams.get('sessionId') === sessionId) &&
    (reference === undefined || url.searchParams.get('reference') === reference);
}

async function login(page, identity) {
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill(identity.loginEmail);
  await page.getByLabel('Heslo').fill(identity.loginPassword);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/u);
}

async function signOut(page) {
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Odhlásit se', exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/login/u);
}

async function browserImages(page, count = 3, dimensions) {
  const generated = await page.evaluate(async ({ length, dimensions }) => {
    const images = [];
    for (let index = 0; index < length; index++) {
      const contentType = ['image/png', 'image/jpeg', 'image/webp'][index % 3];
      const canvas = document.createElement('canvas');
      canvas.width = dimensions?.width ?? 16 + index; canvas.height = dimensions?.height ?? 12 + index % 7;
      const context = canvas.getContext('2d');
      context.fillStyle = `hsl(${index * 47 % 360} 70% 45%)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#173a65'; context.fillRect(1, 1, 3, 3);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, contentType, 0.9));
      if (!blob || blob.type !== contentType) throw new Error('Synthetic image encoder is unavailable.');
      const decoded = await createImageBitmap(blob);
      images.push({ contentType, width: decoded.width, height: decoded.height, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
      decoded.close();
    }
    return images;
  }, { length: count, dimensions });
  return generated.map((image, index) => {
    const bytes = Buffer.from(image.bytes);
    if (index !== 1 || image.contentType !== 'image/jpeg') return { ...image, bytes };
    // A real APP1 Exif orientation=6 keeps the raw SOF dimensions but transposes native browser output.
    const exif = Buffer.alloc(36);
    exif.set([255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73]);
    exif.writeUInt16LE(42, 12); exif.writeUInt32LE(8, 14); exif.writeUInt16LE(1, 18);
    exif.writeUInt16LE(0x0112, 20); exif.writeUInt16LE(3, 22); exif.writeUInt32LE(1, 24); exif.writeUInt16LE(6, 28);
    return { ...image, bytes: Buffer.concat([bytes.subarray(0, 2), exif, bytes.subarray(2)]),
      displayWidth: image.height, displayHeight: image.width, exifOrientation: 6 };
  });
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}

/** A legal private ancillary PNG chunk gives an exact byte boundary without huge decoded pixels. */
function exactSizePng(size) {
  const png = new PNG({ width: 8, height: 4 });
  for (let index = 0; index < png.data.length; index += 4) png.data.set([45, 170, 100, 255], index);
  const original = PNG.sync.write(png);
  const padding = size - original.length - 12;
  if (padding < 0) throw new Error('Synthetic PNG boundary is too small.');
  const chunk = Buffer.alloc(padding + 12);
  chunk.writeUInt32BE(padding); chunk.write('npAD', 4, 'ascii');
  chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)), chunk.length - 4);
  const bytes = Buffer.concat([original.subarray(0, original.length - 12), chunk, original.subarray(-12)]);
  expect(bytes.length).toBe(size);
  return { bytes, width: 8, height: 4, contentType: 'image/png' };
}

/** Read-only OS observations of this test browser family; no process enumeration outside CDP-owned IDs. */
async function observeBrowserMemory(browser) {
  const samples = [];
  let session, interval, pending = Promise.resolve(), busy = false, stopped = false, failedSamples = 0;
  let phase = 'baseline-after-fixture-before-login';
  const started = performance.now();
  const sample = async () => {
    busy = true;
    try {
      const info = await session.send('SystemInfo.getProcessInfo');
      const ids = [...new Set(info.processInfo.map(process => process.id))];
      if (!ids.length || ids.length > 128 || !ids.every(id => Number.isSafeInteger(id) && id > 0 && id <= 0xffffffff)) throw new Error('Invalid owned process IDs.');
      // Only validated numeric IDs enter this native PowerShell command. Output contains no IDs or process names.
      const command = `$qaBrowserMemory = Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Measure-Object -Property WorkingSet64 -Sum; [pscustomobject]@{ count = [int]$qaBrowserMemory.Count; workingSetBytes = [double]$qaBrowserMemory.Sum } | ConvertTo-Json -Compress`;
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024,
      });
      const result = JSON.parse(stdout.trim());
      if (!Number.isSafeInteger(result.count) || result.count < 1 || result.count > ids.length || !Number.isSafeInteger(result.workingSetBytes) || result.workingSetBytes <= 0) throw new Error('Invalid memory observation.');
      samples.push({ elapsedMs: Math.round(performance.now() - started), phase, processCount: result.count, workingSetBytes: result.workingSetBytes });
    } catch { failedSamples++; }
    finally { busy = false; }
  };
  try {
    session = await browser.newBrowserCDPSession();
    await sample();
    if (samples.length) interval = setInterval(() => {
      if (!busy && !stopped) pending = sample();
    }, 1000);
  } catch { failedSamples++; }
  return {
    phase(value) { phase = value; },
    async finish() {
      stopped = true; clearInterval(interval); await pending;
      phase = 'final-after-image-cycles';
      if (session) { await sample(); await session.detach().catch(() => {}); }
      const baseline = samples[0], final = samples.at(-1);
      const peak = samples.length ? Math.max(...samples.map(sample => sample.workingSetBytes)) : null;
      const mib = bytes => bytes == null ? null : Math.round(bytes / MiB * 10) / 10;
      return { status: samples.length >= 2 ? 'measured' : 'NOT_MEASURED', requestedSampleIntervalMs: 1000, failedSamples,
        sampleCount: samples.length, baselineMiB: mib(baseline?.workingSetBytes), peakObservedMiB: mib(peak), finalMiB: mib(final?.workingSetBytes),
        peakIncreaseMiB: baseline && peak !== null ? mib(peak - baseline.workingSetBytes) : null,
        scope: 'Only the Playwright-launched Chromium process family identified by CDP. Sum of native per-process WorkingSet64; shared pages can be counted more than once. Excludes Node and Firebase emulators. Sampled peak is not an instantaneous maximum or a memory-limit assertion. Profiling adds overhead and is confined to the 64 MiB case, outside the 40-sample latency benchmark.',
        samples };
    },
  };
}

async function createImagesFixture(images, { roles = false, sharedPublicRoles = false } = {}) {
  const fixture = await mediaFixture();
  try {
    const assets = [];
    for (const image of images) {
      const uploaded = await fixture.upload('image', image.bytes, image.contentType);
      assets.push({ ...image, ...uploaded, sha256: createHash('sha256').update(image.bytes).digest('hex') });
    }
    await fixture.update('image', {
      questionImage: assets[0].reference, correctAnswer: privateAnswer, moderatorNote: privateNote,
      ...(roles ? { backgroundImage: assets[sharedPublicRoles ? 0 : 1].reference,
        design: { logoImage: assets[sharedPublicRoles ? 0 : 2].reference, showLogo: true }, answerImage: assets[3].reference } : {}),
    });
    assets[0].position = 3;
    if (!roles) {
      for (const asset of assets.slice(1)) {
        const quiz = (await fixture.quizRef.get()).data();
        const position = quiz.slideCount - 1;
        await fixture.admin.call('createQuizSlide', {
          quizId: fixture.quizId, expectedRevision: quiz.revision, position,
          slide: mediaSlide('image', { questionImage: asset.reference, correctAnswer: privateAnswer, moderatorNote: privateNote }),
        });
        asset.position = position;
      }
    }
    const snapshotId = await fixture.lock();
    return { fixture, assets, snapshotId };
  } catch (error) { await fixture.dispose(); throw error; }
}

async function eventPage(page, fixture) {
  await page.goto(`/admin/events/${fixture.eventId}`);
  await expect(panel(page)).toBeVisible();
}

async function prepareAndSave(page, fixture, testInfo, count, filename = 'multi-image.justkvizbackup') {
  await eventPage(page, fixture);
  const preparationStarted = performance.now();
  await prepare(page).click();
  await expect(panel(page)).toHaveAttribute('data-local-image-backup-status', 'prepared', { timeout: 180_000 });
  await expect(panel(page).locator('[data-local-image-status="verified"]')).toHaveCount(count);
  const preparationObservedMs = Math.round(performance.now() - preparationStarted), saveStarted = performance.now();
  const [download] = await Promise.all([page.waitForEvent('download'), save(page).click()]);
  const path = testInfo.outputPath(filename);
  await download.saveAs(path); expect(await download.failure()).toBeNull();
  const saveObservedMs = Math.round(performance.now() - saveStarted);
  await expect(panel(page)).toHaveAttribute('data-local-image-backup-status', 'downloaded');
  const reopenStarted = performance.now(); await open(page).setInputFiles(path);
  await expect(panel(page)).toHaveAttribute('data-local-image-backup-status', 'ready', { timeout: 180_000 });
  const bytes = await readFile(path);
  for (const secret of [privateAnswer, privateNote]) expect(bytes.includes(Buffer.from(secret))).toBe(false);
  const timingsPath = testInfo.outputPath(`${filename}.timings.json`);
  await writeFile(timingsPath, JSON.stringify({ assets: count, preparationObservedMs, saveObservedMs,
    reopenObservedMs: Math.round(performance.now() - reopenStarted), fileBytes: bytes.length,
    measurement: 'Node monotonic clock through Playwright state observations; includes server validation, hashing, every-image browser decode and UI polling. Memory usage was not measured.' }, null, 2));
  await testInfo.attach('image-backup-preparation-timings', { path: timingsPath, contentType: 'application/json' });
  return path;
}

async function livePopup(page, fixture, backupPath) {
  const sessionId = await fixture.live();
  await page.goto(`/admin/live/${sessionId}`);
  if (backupPath) {
    await load(page).setInputFiles(backupPath);
    await expect(control(page)).toHaveAttribute('data-local-image-control-status', 'ready', { timeout: 180_000 });
  }
  const [projector] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Otevřít projektor', exact: true }).click()]);
  await expect(projector.getByText('Čekáme na první slide', { exact: true })).toBeVisible();
  return { sessionId, projector };
}

async function decoded(projector, asset, source = 'local', role = 'question-image') {
  await expect(roleImage(projector, role)).toHaveJSProperty('naturalWidth', asset.displayWidth ?? asset.width);
  await expect(roleImage(projector, role)).toHaveJSProperty('naturalHeight', asset.displayHeight ?? asset.height);
  await expect(roleImage(projector, role)).toHaveAttribute('data-local-media-source', source);
  await expect(projector.getByText(privateAnswer, { exact: true })).toHaveCount(0);
  await expect(projector.getByText(privateNote, { exact: true })).toHaveCount(0);
}

test('prepares, saves and actually decodes all 64 owned PNG JPEG and WebP images in the projector', async ({ context, page, baseURL }, testInfo) => {
  test.setTimeout(900_000); requireEmulators(baseURL); await localOnly(context);
  const images = await browserImages(page, 64);
  const { fixture, assets } = await createImagesFixture(images);
  try {
    await login(page, fixture);
    const path = await prepareAndSave(page, fixture, testInfo, 64);
    const manifest = await fixture.admin.call('readLocalImageManifest', { eventId: fixture.eventId });
    expect(manifest.schemaVersion).toBe(3); expect(manifest.assets).toHaveLength(64);
    for (const asset of assets) expect(manifest.assets.find(value => value.reference === asset.reference))
      .toMatchObject({ contentType: asset.contentType, size: asset.bytes.length, sha256: asset.sha256, width: asset.width, height: asset.height });
    const { sessionId, projector } = await livePopup(page, fixture, path);
    await projector.route(gatewayFor(sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
    const decodedAssets = [];
    for (const asset of assets) {
      await fixture.navigate(sessionId, asset.position);
      await decoded(projector, asset);
      decodedAssets.push({ contentType: asset.contentType, rawWidth: asset.width, rawHeight: asset.height,
        displayWidth: asset.displayWidth ?? asset.width, displayHeight: asset.displayHeight ?? asset.height,
        ...(asset.exifOrientation ? { exifOrientation: asset.exifOrientation } : {}), source: 'local' });
    }
    expect(decodedAssets).toHaveLength(64);
    await testInfo.attach('all-64-browser-decodes', { body: JSON.stringify({ count: decodedAssets.length, formats: [...new Set(assets.map(asset => asset.contentType))], actualProjectorImgDecodes: decodedAssets, physicalProjector: 'not run' }), contentType: 'application/json' });
  } finally { await fixture.dispose(); }
});

test('round-trips an actual 64 MiB payload with 10 MiB individual PNGs and small decoded dimensions', async ({ browser, context, page, baseURL }, testInfo) => {
  test.setTimeout(900_000); requireEmulators(baseURL); await localOnly(context);
  const large = exactSizePng(10 * MiB), remainder = exactSizePng(4 * MiB);
  const { fixture, assets } = await createImagesFixture([...Array(6).fill(large), remainder]);
  const memory = await observeBrowserMemory(browser);
  try {
    await login(page, fixture);
    memory.phase('prepare-save-open-64-mib');
    const path = await prepareAndSave(page, fixture, testInfo, 7, '64-mib.justkvizbackup');
    const bytes = await readFile(path);
    expect(assets.reduce((sum, asset) => sum + asset.bytes.length, 0)).toBe(64 * MiB);
    expect(bytes.length).toBeGreaterThan(64 * MiB);
    expect(bytes.length).toBeLessThanOrEqual(64 * MiB + 256 * 1024 + Buffer.byteLength('JUSTKVIZ-IMAGE-BACKUP/3\n') + 4);
    const { sessionId, projector } = await livePopup(page, fixture, path);
    memory.phase('projector-10-mib-transfer-and-renewals');
    await projector.route(gatewayFor(sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
    await page.evaluate(() => {
      window.syntheticImageRenewals = [];
      window.addEventListener('message', event => {
        if (event.data?.type === 'justkviz-local-image-request-v3') window.syntheticImageRenewals.push({ mode: event.data.mode, role: event.data.authority?.media?.role });
      });
    });
    await fixture.navigate(sessionId, assets[0].position); await decoded(projector, assets[0]);
    const originalSource = await roleImage(projector).getAttribute('src');
    await expect.poll(() => page.evaluate(() => window.syntheticImageRenewals.filter(request => request.mode === 'renew').length), { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
    expect(await page.evaluate(() => window.syntheticImageRenewals.filter(request => request.mode === 'bytes').length)).toBe(1);
    await decoded(projector, assets[0]); await expect(roleImage(projector)).toHaveAttribute('src', originalSource);
    memory.phase('projector-remaining-image-cycles');
    for (const asset of assets.slice(1)) {
      const previousSource = await roleImage(projector).getAttribute('src');
      await fixture.navigate(sessionId, asset.position);
      await expect(roleImage(projector)).not.toHaveAttribute('src', previousSource);
      await decoded(projector, asset);
    }
    await testInfo.attach('payload-boundary', { body: JSON.stringify({ payloadBytes: 64 * MiB, maximumIndividualBytes: 10 * MiB, assets: 7, actualSavedBytes: bytes.length, eachActuallyDecoded: true, largeImageInitialTransfers: 1, metadataOnlyRenewalsAtLeast: 3 }), contentType: 'application/json' });
  } finally {
    const report = await memory.finish(), memoryPath = testInfo.outputPath('browser-memory-observations.json');
    await writeFile(memoryPath, JSON.stringify(report, null, 2));
    await testInfo.attach('owned-browser-working-set', { path: memoryPath, contentType: 'application/json' });
    const { samples, scope, ...summary } = report;
    console.log(`Owned Chromium working-set observations: ${JSON.stringify({ ...summary, scope, samplesRecorded: samples.length })}`);
    await fixture.dispose();
  }
});

test('counts three roles of the same valid 8 MP image against the 16 MP frame budget', async ({ context, page, baseURL }, testInfo) => {
  test.setTimeout(300_000); requireEmulators(baseURL); await localOnly(context);
  const images = await browserImages(page, 4, { width: 4096, height: 2048 });
  const { fixture, assets } = await createImagesFixture(images, { roles: true, sharedPublicRoles: true });
  try {
    await login(page, fixture);
    const path = await prepareAndSave(page, fixture, testInfo, 2, 'individually-bounded-frame-overflow.justkvizbackup');
    const { sessionId, projector } = await livePopup(page, fixture, path);
    await projector.route(gatewayFor(sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
    await fixture.navigate(sessionId, 3);
    await expect(projector.locator('button').filter({ hasText: 'Zkusit načíst znovu' })).toHaveCount(3);
    await expect(localImages(projector)).toHaveCount(0);
    const current = (await fixture.db.doc(`publicSessions/${sessionId}`).get()).data();
    await expect(fixture.anonymous.call('readLocalImageAuthority', { sessionId, revision: current.revision,
      slidePosition: current.slidePosition, mediaGeneration: current.mediaGeneration,
      reference: assets[0].reference, role: 'question-image' })).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    await testInfo.attach('current-frame-pixel-budget', { body: JSON.stringify({ individuallyDecodedPixels: 8_388_608, uniquePublicAssets: 1, publicRoleInstances: 3, framePixels: 25_165_824, frameLimit: 16_777_216, fallbackDenied: true }), contentType: 'application/json' });
  } finally { await fixture.dispose(); }
});

test('withholds private answer bytes while concurrently decoding current question background and logo', async ({ context, page, baseURL }, testInfo) => {
  requireEmulators(baseURL); await localOnly(context);
  const { fixture, assets } = await createImagesFixture(await browserImages(page, 4), { roles: true });
  const diagnostics = [];
  const started = performance.now();
  try {
    await login(page, fixture);
    const path = await prepareAndSave(page, fixture, testInfo, 4);
    const { sessionId, projector } = await livePopup(page, fixture, path);
    await expect(control(page).locator('[data-local-image-status="verified"]')).toHaveCount(4);
    const corrupt = Buffer.from(await readFile(path)); corrupt[corrupt.length - 1] ^= 1;
    const corruptPath = testInfo.outputPath('corrupt-live-control-last-image.justkvizbackup');
    await writeFile(corruptPath, corrupt);
    await load(page).setInputFiles(corruptPath);
    await expect(control(page)).toHaveAttribute('data-local-image-control-status', 'invalid');
    await expect(control(page).locator('[data-local-image-status="verified"]')).toHaveCount(3);
    await expect(control(page).locator('[data-local-image-status="invalid"]')).toHaveCount(1);
    await expect(control(page).locator('[data-local-image-verified-count]')).toHaveAttribute('data-local-image-verified-count', '3');
    await expect(control(page).locator('[data-local-image-error-count]')).toHaveAttribute('data-local-image-error-count', '1');
    await load(page).setInputFiles(path);
    await expect(control(page)).toHaveAttribute('data-local-image-control-status', 'ready');
    await expect(control(page).locator('[data-local-image-status="verified"]')).toHaveCount(4);
    await expect(control(page).locator('[data-local-image-status="invalid"]')).toHaveCount(0);
    await expect(control(page).locator('[data-local-image-error-count]')).toHaveAttribute('data-local-image-error-count', '0');
    await page.evaluate(() => {
      window.syntheticImagePackets = [];
      const post = window.MessagePort.prototype.postMessage;
      window.MessagePort.prototype.postMessage = function (...arguments_) {
        const value = arguments_[0];
        if (value && typeof value === 'object' && typeof value.nonce === 'string' && typeof value.key === 'string') {
          let reference = null;
          try { reference = JSON.parse(value.key).media?.reference ?? null; } catch { /* Record an invalid key without its contents. */ }
          window.syntheticImagePackets.push({ reference, keys: Object.keys(value).sort(),
            byteLength: value.bytes instanceof ArrayBuffer ? value.bytes.byteLength : value.bytes instanceof Blob ? value.bytes.size : null });
        }
        return Reflect.apply(post, this, arguments_);
      };
    });
    for (const [device, target] of [['moderator', page], ['projector', projector]]) {
      target.on('response', response => {
        const url = new URL(response.url());
        const operation = isAuthority(url) ? 'public-authority' : url.origin === functions && url.pathname === `${prefix}authorizeLocalImageBackup` ? 'operator-authorization' : null;
        if (!operation || response.request().method() !== 'POST') return;
        void response.json().then(body => {
          const grant = body.result;
          diagnostics.push({ device, operation, elapsedMs: Math.round(performance.now() - started), status: response.status(),
            errorCode: body.error?.status ?? null,
            ...(grant?.media ? { role: grant.media.role, width: grant.media.width, height: grant.media.height, size: grant.media.size, contentType: grant.media.contentType } : {}) });
        }).catch(() => { diagnostics.push({ device, operation, status: response.status(), unreadableBody: true }); });
      });
    }
    let earlyAnswerRequests = 0, watching = true;
    projector.on('request', request => {
      const url = new URL(request.url());
      if (watching && (gatewayFor(sessionId, assets[3].reference)(url) ||
        isAuthority(url) && request.postDataJSON()?.data?.reference === assets[3].reference)) earlyAnswerRequests++;
    });
    await projector.route(gatewayFor(sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
    await fixture.navigate(sessionId, 3);
    const initialPublic = (await fixture.db.doc(`publicSessions/${sessionId}`).get()).data();
    diagnostics.push({ device: 'fixture', operation: 'public-shape', slideKind: initialPublic.slideKind,
      renderMode: initialPublic.renderMode, presentationMode: initialPublic.presentationMode, answerRevealed: initialPublic.answerRevealed,
      questionImageMatches: initialPublic.questionImage === assets[0].reference,
      backgroundImageMatches: initialPublic.backgroundImage === assets[1].reference,
      logoImageMatches: initialPublic.design?.logoImage === assets[2].reference,
      logoShown: initialPublic.design?.showLogo,
    });
    for (const [role, asset] of [['question-image', assets[0]], ['background-image', assets[1]], ['logo-image', assets[2]]]) {
      try {
        const grant = await fixture.anonymous.call('readLocalImageAuthority', { sessionId, revision: initialPublic.revision,
          slidePosition: initialPublic.slidePosition, mediaGeneration: initialPublic.mediaGeneration, reference: asset.reference, role });
        diagnostics.push({ device: 'fixture', operation: 'direct-public-authority', role, accepted: true,
          width: grant.media.width, height: grant.media.height, size: grant.media.size, contentType: grant.media.contentType });
      } catch (error) { diagnostics.push({ device: 'fixture', operation: 'direct-public-authority', role, accepted: false, errorCode: error.code }); }
    }
    await Promise.all([decoded(projector, assets[0]), decoded(projector, assets[1], 'local', 'background-image'), decoded(projector, assets[2], 'local', 'logo-image')]);
    await expect(roleImage(projector, 'answer-image')).toHaveCount(0);
    const beforeRevealPackets = await page.evaluate(() => window.syntheticImagePackets);
    const publicBytePackets = beforeRevealPackets.filter(packet => packet.keys.includes('bytes'));
    expect(publicBytePackets).toHaveLength(3);
    for (const packet of beforeRevealPackets) expect(packet.keys).toEqual(packet.keys.includes('bytes') ? ['bytes', 'key', 'nonce'] : ['key', 'nonce']);
    for (const packet of publicBytePackets) {
      const asset = assets.slice(0, 3).find(asset => asset.reference === packet.reference);
      expect(asset).toBeDefined(); expect(packet.byteLength).toBe(asset.bytes.length);
    }
    expect(beforeRevealPackets.some(packet => packet.reference === assets[3].reference)).toBe(false);
    const current = (await fixture.db.doc(`publicSessions/${sessionId}`).get()).data();
    expect(JSON.stringify(current)).not.toContain(assets[3].reference);
    await expect(fixture.anonymous.call('readLocalImageAuthority', {
      sessionId, revision: current.revision, slidePosition: current.slidePosition, mediaGeneration: current.mediaGeneration,
      reference: assets[3].reference, role: 'answer-image',
    })).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    expect(earlyAnswerRequests).toBe(0); watching = false;
    await page.getByRole('button', { name: 'Odhalit odpověď', exact: true }).click();
    await expect(roleImage(projector, 'answer-image')).toHaveJSProperty('naturalWidth', assets[3].width);
    await expect(roleImage(projector, 'answer-image')).toHaveAttribute('data-local-media-source', 'local');
    const answerPackets = (await page.evaluate(() => window.syntheticImagePackets)).filter(packet => packet.reference === assets[3].reference && packet.keys.includes('bytes'));
    expect(answerPackets).toHaveLength(1); expect(answerPackets[0].byteLength).toBe(assets[3].bytes.length);
    await page.getByRole('button', { name: 'Skrýt odpověď', exact: true }).click();
    await expect(roleImage(projector, 'answer-image')).toHaveCount(0);
    const hidden = (await fixture.db.doc(`publicSessions/${sessionId}`).get()).data();
    await expect(fixture.anonymous.call('readLocalImageAuthority', {
      sessionId, revision: hidden.revision, slidePosition: hidden.slidePosition, mediaGeneration: hidden.mediaGeneration,
      reference: assets[3].reference, role: 'answer-image',
    })).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    await testInfo.attach('current-role-reveal', { body: JSON.stringify({ publicRolesDecodedConcurrently: 3, publicImageBytePacketsBeforeReveal: publicBytePackets.length, earlyPrivateAnswerRequests: 0,
      earlyPrivateAnswerPackets: 0, wholePackagePackets: 0, answerBytePacketsAfterServerReveal: answerPackets.length,
      answerOnlyAfterServerReveal: true, hiddenAnswerRevoked: true, privateAnswerTextAbsentFromArchive: true,
      liveControlInvalidFileVerifiedCount: 3, liveControlInvalidFileErrorCount: 1, liveControlOriginalReloadVerifiedCount: 4 }), contentType: 'application/json' });
  } finally {
    const path = testInfo.outputPath('current-role-diagnostics.json'); await writeFile(path, JSON.stringify(diagnostics, null, 2));
    await testInfo.attach('current-role-diagnostics', { path, contentType: 'application/json' });
    await fixture.dispose();
  }
});

test('reopens a real file in another browser process and rejects same-length tampering', async ({ browser, context, page, baseURL }, testInfo) => {
  test.setTimeout(240_000); requireEmulators(baseURL); await localOnly(context);
  const { fixture, assets } = await createImagesFixture(await browserImages(page));
  let restarted;
  try {
    await login(page, fixture);
    const path = await prepareAndSave(page, fixture, testInfo, assets.length);
    const archived = await readFile(path);
    const changed = Buffer.from(archived); changed[changed.length - 1] ^= 1;
    const corruptPath = testInfo.outputPath('same-length-tamper.justkvizbackup'); await writeFile(corruptPath, changed);
    const magicLength = Buffer.byteLength('JUSTKVIZ-IMAGE-BACKUP/3\n'), prefixSize = magicLength + 4;
    const headerSize = archived.readUInt32BE(magicLength), payloadStart = prefixSize + headerSize;
    const forgedHeader = JSON.parse(archived.subarray(prefixSize, payloadStart).toString('utf8'));
    const removed = forgedHeader.assets.shift();
    const newHeader = Buffer.from(JSON.stringify(forgedHeader));
    const newPrefix = Buffer.from(archived.subarray(0, prefixSize)); newPrefix.writeUInt32BE(newHeader.length, magicLength);
    // The remaining images and their SHA-256 are intact, but the original manifest ID no longer covers this index.
    const forgedPath = testInfo.outputPath('dropped-index-retained-id.justkvizbackup');
    await writeFile(forgedPath, Buffer.concat([newPrefix, newHeader, archived.subarray(payloadStart + removed.size)]));
    const versionBefore = browser.version();
    restarted = await chromium.launch(testInfo.project.use.launchOptions);
    expect(restarted.version()).toBe(versionBefore);
    const nextContext = await restarted.newContext({ baseURL, serviceWorkers: 'block' }); await localOnly(nextContext);
    const nextPage = await nextContext.newPage(); await login(nextPage, fixture); await eventPage(nextPage, fixture);
    await open(nextPage).setInputFiles(corruptPath);
    await expect(panel(nextPage)).toHaveAttribute('data-local-image-backup-status', 'invalid');
    await open(nextPage).setInputFiles(forgedPath);
    await expect(panel(nextPage)).toHaveAttribute('data-local-image-backup-status', 'invalid');
    await open(nextPage).setInputFiles(path);
    await expect(panel(nextPage)).toHaveAttribute('data-local-image-backup-status', 'ready', { timeout: 60_000 });
    const { sessionId, projector } = await livePopup(nextPage, fixture, path);
    await projector.route(gatewayFor(sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
    for (const asset of assets) { await fixture.navigate(sessionId, asset.position); await decoded(projector, asset); }
    await testInfo.attach('multi-image-real-disk-restart', { body: JSON.stringify({ realDiskDownload: true, differentBrowserProcess: true, sameLengthTamperRejected: true, droppedIndexRetainingValidManifestIdRejected: true, eachFormatDecodedAfterRestart: true }), contentType: 'application/json' });
  } finally { await restarted?.close(); await fixture.dispose(); }
});

test('invalidates the same file for another actor, changed member version, replacement snapshot and ended event', async ({ context, page, baseURL }, testInfo) => {
  test.setTimeout(240_000); requireEmulators(baseURL); await localOnly(context);
  const { fixture, assets } = await createImagesFixture(await browserImages(page));
  try {
    await login(page, fixture);
    const path = await prepareAndSave(page, fixture, testInfo, assets.length);
    const alternate = await fixture.roleClient('admin');
    const alternatePassword = 'SyntheticImageBackup-Only-4317!';
    await updatePassword(alternate.auth.currentUser, alternatePassword);
    await signOut(page);
    await login(page, { loginEmail: alternate.auth.currentUser.email, loginPassword: alternatePassword });
    await eventPage(page, fixture); await open(page).setInputFiles(path);
    await expect(panel(page)).toHaveAttribute('data-local-image-backup-status', 'invalid');
    await signOut(page); await login(page, fixture); await eventPage(page, fixture);
    const member = fixture.db.doc(`memberships/${fixture.admin.auth.currentUser.uid}`);
    const original = (await member.get()).data(); await member.update({ version: original.version + 1 });
    await eventPage(page, fixture); await open(page).setInputFiles(path);
    await expect(panel(page)).toHaveAttribute('data-local-image-backup-status', 'invalid');
    const versionCurrentPath = await prepareAndSave(page, fixture, testInfo, assets.length, 'current-member-version.justkvizbackup');
    const replacement = await fixture.lock(); await eventPage(page, fixture); await open(page).setInputFiles(versionCurrentPath);
    await expect(panel(page)).toHaveAttribute('data-local-image-backup-status', 'invalid');
    expect(replacement).not.toBeUndefined();
    const currentStart = (await fixture.eventRef.get()).data().startsAt;
    await fixture.eventRef.update({ startsAt: new Date(Date.now() - 7 * 60 * 60_000) });
    const response = await fixture.admin.call('readLocalImageManifest', { eventId: fixture.eventId }).then(() => 'accepted', error => error.code);
    expect(response).toBe('functions/failed-precondition');
    await fixture.eventRef.update({ startsAt: currentStart, lifecycleStatus: 'completed' });
    await expect(fixture.admin.call('readLocalImageManifest', { eventId: fixture.eventId })).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    await testInfo.attach('multi-image-invalid-bindings', { body: JSON.stringify({ otherActorRejected: true, changedMemberVersionRejected: true, replacedSnapshotRejected: true, expiredEventRejected: true, completedEventRejected: true }), contentType: 'application/json' });
  } finally { await fixture.dispose(); }
});

test('omits answer identities without concrete answer-export permission and excludes public-answer aliasing', async ({ page, baseURL }) => {
  requireEmulators(baseURL);
  const { fixture, assets } = await createImagesFixture(await browserImages(page, 4), { roles: true });
  try {
    const moderator = await fixture.roleClient('moderator');
    const member = (await fixture.db.doc(`memberships/${moderator.auth.currentUser.uid}`).get()).data();
    expect(member.permissions).not.toContain('event.answers.export');
    const limited = await moderator.call('readLocalImageManifest', { eventId: fixture.eventId });
    expect(limited.assets).toHaveLength(3);
    for (const secret of [assets[3].reference, assets[3].sha256, privateAnswer, privateNote]) expect(JSON.stringify(limited)).not.toContain(secret);
    const complete = await fixture.admin.call('readLocalImageManifest', { eventId: fixture.eventId });
    expect(complete.assets.find(asset => asset.reference === assets[3].reference)).toMatchObject({ visibility: 'answer' });
    await fixture.update('image', { questionImage: assets[3].reference, answerImage: assets[3].reference,
      backgroundImage: assets[1].reference, design: { logoImage: assets[2].reference, showLogo: true } });
    await fixture.lock();
    const aliased = await fixture.admin.call('readLocalImageManifest', { eventId: fixture.eventId });
    expect(aliased.assets.some(asset => asset.reference === assets[3].reference)).toBe(false);
    expect(JSON.stringify(aliased)).not.toContain(assets[3].reference);
  } finally { await fixture.dispose(); }
});

test('denies client writes to derived image integrity and refuses a conflicting same-generation cache', async ({ page, baseURL }, testInfo) => {
  requireEmulators(baseURL);
  const { fixture, assets } = await createImagesFixture(await browserImages(page, 1));
  const clientDb = getFirestore(fixture.admin.auth.app);
  connectFirestoreEmulator(clientDb, '127.0.0.1', 8080);
  try {
    const asset = assets[0], assetRef = fixture.db.doc(`quizzes/${fixture.quizId}/mediaAssets/${asset.assetId}`);
    const initial = (await assetRef.get()).data();
    expect(initial.localImageIntegrityV3).toBeUndefined();
    expect(initial.assetId).toMatch(/^[a-f0-9]{64}$/u); expect(initial.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    // Even the actual SHA is untrusted when placed in a generic metadata property.
    await assetRef.update({ sha256: asset.sha256 });
    const sessionId = await fixture.live(); await fixture.navigate(sessionId, asset.position);
    const current = (await fixture.db.doc(`publicSessions/${sessionId}`).get()).data();
    await expect(fixture.anonymous.call('readLocalImageAuthority', { sessionId, revision: current.revision,
      slidePosition: current.slidePosition, mediaGeneration: current.mediaGeneration, reference: asset.reference,
      role: 'question-image' })).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    const manifest = await fixture.admin.call('readLocalImageManifest', { eventId: fixture.eventId });
    expect(manifest.assets[0]).toMatchObject({ sha256: asset.sha256 });
    const cached = (await assetRef.get()).data().localImageIntegrityV3;
    expect(cached).toMatchObject({ sha256: asset.sha256, generation: initial.generation });
    const changed = { ...cached, sha256: cached.sha256 === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64) };
    await expect(updateDoc(doc(clientDb, assetRef.path), { localImageIntegrityV3: changed })).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await assetRef.get()).data().localImageIntegrityV3).toEqual(cached);
    await assetRef.update({ localImageIntegrityV3: changed });
    await expect(fixture.admin.call('readLocalImageManifest', { eventId: fixture.eventId })).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    expect((await assetRef.get()).data().localImageIntegrityV3).toEqual(changed);
    await testInfo.attach('derived-integrity-boundary', { body: JSON.stringify({ rawAssetIdFingerprintAndShaCannotAuthorize: true, actualPinnedBytesCreatedDescriptor: true,
      authenticatedClientDerivedCacheWriteDeniedByRules: true, sameGenerationConflictingShaRejected: true, conflictingCacheWasNotSilentlyRewritten: true }), contentType: 'application/json' });
  } finally { await terminate(clientDb); await fixture.dispose(); }
});

test('never reports a partially committed native file as ready after an interrupted close', async ({ context, page, baseURL }, testInfo) => {
  requireEmulators(baseURL); await localOnly(context);
  await context.addInitScript(() => {
    const state = { mode: 'interrupted', calls: [], saved: null };
    window.syntheticMultiImageWriter = state;
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => ({
      createWritable: async () => {
        const parts = [];
        return {
          write: async value => { state.calls.push('write'); parts.push(value); },
          close: async () => {
            state.calls.push('close');
            if (state.mode === 'interrupted') throw new DOMException('Synthetic interrupted multi-image save.', 'AbortError');
            state.saved = new File(parts, 'synthetic-multi-image.justkvizbackup'); state.calls.push('commit');
          },
          abort: async () => { state.calls.push('abort'); parts.length = 0; },
        };
      },
      getFile: async () => { state.calls.push('read-back'); return state.saved; },
    }) });
  });
  const { fixture, assets } = await createImagesFixture(await browserImages(page));
  try {
    await login(page, fixture); await eventPage(page, fixture); await prepare(page).click();
    await expect(panel(page)).toHaveAttribute('data-local-image-backup-status', 'prepared');
    await save(page).click(); await expect(panel(page)).toHaveAttribute('data-local-image-backup-status', 'error');
    expect(await page.evaluate(() => window.syntheticMultiImageWriter.calls)).toEqual(['write', 'close', 'abort']);
    await page.evaluate(() => { window.syntheticMultiImageWriter.mode = 'healthy'; });
    await prepare(page).click(); await expect(panel(page)).toHaveAttribute('data-local-image-backup-status', 'prepared');
    await save(page).click(); await expect(panel(page)).toHaveAttribute('data-local-image-backup-status', 'ready');
    await expect(panel(page).locator('[data-local-image-status="verified"]')).toHaveCount(assets.length);
    expect(await page.evaluate(() => window.syntheticMultiImageWriter.calls)).toEqual(['write', 'close', 'abort', 'write', 'close', 'commit', 'read-back']);
    await testInfo.attach('multi-image-native-interruption', { body: JSON.stringify({ injectedCloseInterruption: true, abortedPartialWrite: true, readyOnlyAfterSuccessfulCommitAndReopen: true, actualNativeFilePicker: 'not exercised' }), contentType: 'application/json' });
  } finally { await fixture.dispose(); }
});

test('does not claim offline quiz operation when the entire browser loses connectivity', async ({ context, page, baseURL }, testInfo) => {
  requireEmulators(baseURL); await localOnly(context);
  const { fixture, assets } = await createImagesFixture(await browserImages(page));
  try {
    await login(page, fixture);
    const path = await prepareAndSave(page, fixture, testInfo, assets.length);
    const { sessionId, projector } = await livePopup(page, fixture, path);
    await projector.route(gatewayFor(sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
    await fixture.navigate(sessionId, assets[0].position); await decoded(projector, assets[0]);
    await context.setOffline(true);
    await expect(projector.getByRole('heading', { name: 'Projektor není připojen', exact: true })).toBeVisible();
    await expect(localImages(projector)).toHaveCount(0);
    await expect(projector.getByText('Syntetický obrázek', { exact: true })).toHaveCount(0);
    expect(await projector.evaluate(() => navigator.onLine)).toBe(false);
    await fixture.navigate(sessionId, assets[1].position);
    await expect(roleImage(projector)).toHaveCount(0);
    await context.setOffline(false);
    await expect(projector.getByText('Syntetický obrázek', { exact: true })).toBeVisible({ timeout: 30_000 });
    await testInfo.attach('multi-image-full-connectivity-loss', { body: JSON.stringify({ fullBrowserOfflineClearsProjection: true, navigationDoesNotWorkOffline: true, serverAuthorityRequiredAfterReconnect: true, venueInternet: 'not tested', physicalProjector: 'not tested' }), contentType: 'application/json' });
  } finally { await context.setOffline(false); await fixture.dispose(); }
});

for (const reason of ['member-version', 'logout', 'session-end']) {
  test(`revokes active v3 local images after ${reason}`, async ({ context, page, baseURL }, testInfo) => {
    requireEmulators(baseURL); await localOnly(context);
    const { fixture, assets } = await createImagesFixture(await browserImages(page));
    try {
      await login(page, fixture);
      const path = await prepareAndSave(page, fixture, testInfo, assets.length);
      const { sessionId, projector } = await livePopup(page, fixture, path);
      await projector.route(gatewayFor(sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
      await fixture.navigate(sessionId, assets[0].position); await decoded(projector, assets[0]);
      const changedAt = performance.now();
      if (reason === 'member-version') {
        const memberRef = fixture.db.doc(`memberships/${fixture.admin.auth.currentUser.uid}`), member = (await memberRef.get()).data();
        await memberRef.update({ permissions: member.permissions.filter(permission => permission !== 'event.export'), version: member.version + 1 });
        await expect(control(page)).toHaveCount(0);
      } else if (reason === 'logout') {
        const account = await context.newPage(); await signOut(account);
        await expect(page).toHaveURL(/\/admin\/login/u);
      } else {
        const current = (await fixture.db.doc(`sessions/${sessionId}`).get()).data();
        await fixture.admin.call('endLiveSession', { sessionId, expectedRevision: current.revision });
        await expect(projector.getByText('Kvíz skončil', { exact: true })).toBeVisible();
      }
      await expect(localImages(projector)).toHaveCount(0, { timeout: 6500 });
      const clearedMs = Math.round(performance.now() - changedAt);
      await testInfo.attach(`v3-revocation-${reason}`, { body: JSON.stringify({ reason, clearedMs, retainedFileStillOnDisk: (await readFile(path)).length > 0 }), contentType: 'application/json' });
    } finally { await fixture.dispose(); }
  });
}

function summarize(samples) {
  return Object.fromEntries([...new Set(samples.map(sample => sample.profile))].map(profile => {
    const attempts = samples.filter(sample => sample.profile === profile);
    const values = attempts.filter(sample => sample.status === 'decoded').map(sample => sample.decodeMs).sort((a, b) => a - b);
    const count = values.length;
    return [profile, { attempts: attempts.length, decoded: count, failures: attempts.filter(sample => sample.status === 'failed').length,
      medianMs: count ? (values[Math.floor((count - 1) / 2)] + values[Math.floor(count / 2)]) / 2 : null,
      p95Ms: values[Math.ceil(count * 0.95) - 1] ?? null, maxMs: values.at(-1) ?? null }];
  }));
}

test('measures 40 real mixed-format image observations with and without a backup under a 3500 ms gateway delay', async ({ context, page, baseURL, browser }, testInfo) => {
  test.setTimeout(600_000); requireEmulators(baseURL); await localOnly(context);
  const samples = [], images = await browserImages(page);
  let active;
  try {
    for (const withBackup of [false, true]) {
      active = await createImagesFixture(images);
      const { fixture, assets } = active;
      await login(page, fixture);
      const path = withBackup ? await prepareAndSave(page, fixture, testInfo, assets.length) : undefined;
      const { sessionId, projector } = await livePopup(page, fixture, path);
      let delayed = false;
      const events = [];
      for (const [device, target] of [['moderator', page], ['projector', projector]]) {
        const record = (event, request, status) => {
          const url = new URL(request.url());
          if (url.origin !== functions || !['GET', 'POST'].includes(request.method())) return;
          const operation = new Map([[gatewayPath, 'gateway'], [authorityPath, 'public-authority'], [`${prefix}authorizeLocalImageBackup`, 'operator-authorization']]).get(url.pathname);
          if (operation) events.push({ device, operation, event, atMs: performance.now(), ...(status === undefined ? {} : { status }) });
        };
        target.on('request', request => record('request', request));
        target.on('response', response => record('response', response.request(), response.status()));
      }
      await projector.route(gatewayFor(sessionId), async route => {
        if (route.request().method() !== 'GET') return route.fallback();
        if (delayed) await wait(3500);
        return route.continue();
      });
      for (const slow of [false, true]) {
        delayed = slow;
        for (let pass = 0; pass < 10; pass++) {
          const asset = assets[pass % assets.length];
          await fixture.navigate(sessionId, 2); await expect(roleImage(projector)).toHaveCount(0);
          const profile = `${slow ? 'delayed' : 'healthy'}-${withBackup ? 'backup' : 'no-backup'}`;
          const sample = { profile, pass, contentType: asset.contentType, size: asset.bytes.length,
            ...(asset.exifOrientation ? { exifOrientation: asset.exifOrientation } : {}), status: 'pending', source: null, decodeMs: null };
          samples.push(sample);
          const started = performance.now(), firstEvent = events.length;
          try {
            await fixture.navigate(sessionId, asset.position);
            const expected = slow && withBackup ? 'local' : 'online';
            await decoded(projector, asset, expected);
            sample.status = 'decoded'; sample.source = expected; sample.decodeMs = Math.round(performance.now() - started);
            if (expected === 'local') {
              const source = await roleImage(projector).getAttribute('src');
              await wait(Math.max(0, 3750 - sample.decodeMs));
              await expect(roleImage(projector)).toHaveAttribute('src', source);
              await expect(roleImage(projector)).toHaveAttribute('data-local-media-source', 'local');
            }
          } catch (error) {
            sample.status = 'failed'; sample.source = await roleImage(projector).getAttribute('data-local-media-source').catch(() => null); throw error;
          } finally {
            sample.timeline = events.slice(firstEvent).map(({ atMs, ...event }) => ({ ...event, elapsedMs: Math.round(atMs - started) }));
          }
        }
      }
      await projector.close(); await signOut(page); await fixture.dispose(); active = undefined;
    }
  } finally {
    const report = { browser: browser.version(), projectId, injectedGatewayDelayMs: 3500, fallbackDeadlineMs: 1500,
      measurement: 'Node monotonic time before real navigation through Playwright observation of decoded IMG. First samples retained. Same emulator workers across profiles, routing disables HTTP cache. No physical projector or cloud measurement.',
      distribution: summarize(samples), samples };
    const path = testInfo.outputPath('local-image-backup-benchmark.json'); await writeFile(path, JSON.stringify(report, null, 2));
    await testInfo.attach('local-image-backup-benchmark', { path, contentType: 'application/json' });
    console.log(`Local image backup benchmark: ${JSON.stringify(report.distribution)}`);
    await active?.fixture.dispose();
  }
});

test('discards delayed authority from the previous image and keeps preparation failures visible per item', async ({ context, page, baseURL }, testInfo) => {
  requireEmulators(baseURL); await localOnly(context);
  const { fixture, assets } = await createImagesFixture(await browserImages(page));
  let release = () => {};
  const held = new Promise(resolve => { release = resolve; });
  try {
    await login(page, fixture); await eventPage(page, fixture);
    const brokenMatch = gatewayFor(undefined, assets[1].reference);
    const brokenDownload = route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback();
    await page.route(brokenMatch, brokenDownload);
    await prepare(page).click();
    await expect(panel(page)).toHaveAttribute('data-local-image-backup-status', 'error');
    await expect(panel(page).locator('[data-local-image-status="invalid"]')).toHaveCount(1);
    await expect(save(page)).toBeDisabled();
    await page.unroute(brokenMatch, brokenDownload);
    const path = await prepareAndSave(page, fixture, testInfo, assets.length);
    const { sessionId, projector } = await livePopup(page, fixture, path);
    await projector.route(gatewayFor(sessionId), route => route.request().method() === 'GET' ? route.abort('connectionfailed') : route.fallback());
    let captured = false;
    await projector.route(isAuthority, async route => {
      if (route.request().method() !== 'POST' || route.request().postDataJSON()?.data?.reference !== assets[0].reference) return route.fallback();
      const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
      try { expect(response.ok()).toBe(true); captured = true; await held; await route.fulfill({ response }); }
      finally { await response.dispose(); }
    });
    await fixture.navigate(sessionId, assets[0].position); await expect.poll(() => captured).toBe(true);
    await fixture.navigate(sessionId, assets[1].position); await decoded(projector, assets[1]);
    const currentSrc = await roleImage(projector).getAttribute('src'); release(); await wait(500);
    await expect(roleImage(projector)).toHaveAttribute('src', currentSrc); await decoded(projector, assets[1]);
  } finally { release(); await fixture.dispose(); }
});
