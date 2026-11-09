/* global window, indexedDB, document */
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { createOfflineMedia } from './offline-media-fixture.mjs';
import { verifyServerOfflineGrant } from './offline-event-fixture.mjs';
import { installNativeOfflineApp, assertColdNativeStorage, uninstallOwnedOfflineApp } from './offline-native-app-fixture.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
import { capacityEventFixture, capacityPayloadBytes, createCapacityMedia, inspectCapacityArchive } from './offline-capacity-fixture.mjs';
import { capacitySnapshot, observeCapacityMemory, summarizeCapacityDurations } from './offline-capacity-metrics.mjs';

const origin = 'http://127.0.0.1:5000';
const phase = process.env.OFFLINE_CAPACITY_PHASE;
const overflow = process.env.OFFLINE_CAPACITY_OVERFLOW === '1';
const directory = path.resolve(process.env.OFFLINE_CAPACITY_RUN_DIR ?? '.local-data/offline-v1/unconfigured-capacity');
assert(directory.startsWith(path.resolve('.local-data/offline-v1') + path.sep));
const profileRoot = path.resolve(process.env.OFFLINE_CAPACITY_PROFILE_ROOT ?? path.join(directory, 'SHORT_PROFILE_MAPPING_REQUIRED'));
assert(/^cp-[a-f0-9]{8}$/u.test(path.relative(path.resolve('.local-data'), profileRoot)));
assert(/^\d+\.\d+\.\d+\.\d+$/u.test(process.env.OFFLINE_CAPACITY_BROWSER_VERSION ?? ''));
const password = 'synthetic-capacity-512-offline-password';
const bundlePath = path.join(directory, 'capacity.justkvizoffline');
const recoveryPath = path.join(directory, 'capacity-recovery.justkvizoffline');
const privateFixture = path.join(directory, 'private-fixture.json');
const allowedOrigins = new Set([origin, ...[5001, 8080, 9099, 9199].map(port => `http://127.0.0.1:${port}`)]);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const nativeRecord = name => path.join(directory, `native-app-${name}.json`);

async function stoppedBackends() {
  for (const port of [5000, 5001, 8080, 9099, 9199]) await new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); reject(new Error(`Backend ${port} is still listening.`)); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
    socket.setTimeout(1000, () => { socket.destroy(); reject(new Error(`Backend ${port} could not be proven stopped.`)); });
  });
}

async function launch(profileName, offline = false) {
  assert(['p', 't', 'r'].includes(profileName));
  const context = await chromium.launchPersistentContext(path.join(profileRoot, profileName), {
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    headless: true, offline, serviceWorkers: 'allow', acceptDownloads: true,
    viewport: { width: 1366, height: 768 }, args: ['--mute-audio'],
  });
  try {
    assert.equal(context.browser()?.version(), process.env.OFFLINE_CAPACITY_BROWSER_VERSION);
  } catch (error) {
    await context.close();
    throw error;
  }
  const observations = { externalRequests: 0, successfulNetworkResponses: 0, serviceWorkerResponses: 0, nativeOfflineChecks: 0, pageErrors: [] };
  context.on('page', page => page.on('pageerror', error => observations.pageErrors.push(error.message)));
  context.on('response', response => {
    if (response.url().startsWith('http') && response.status() < 400) {
      if (response.fromServiceWorker()) observations.serviceWorkerResponses++;
      else observations.successfulNetworkResponses++;
    }
  });
  await context.route('**/*', route => {
    if (!allowedOrigins.has(new URL(route.request().url()).origin)) { observations.externalRequests++; return route.abort('blockedbyclient'); }
    return route.continue();
  });
  await context.addInitScript(() => {
    window.__capacityPackets = [];
    window.__capacityEncryptions = [];
    if (typeof SubtleCrypto === 'function') {
      const encrypt = SubtleCrypto.prototype.encrypt;
      SubtleCrypto.prototype.encrypt = function (...args) {
        const started = performance.now();
        const observed = args[0] === 'AES-GCM' || args[0]?.name === 'AES-GCM';
        return Reflect.apply(encrypt, this, args).then(result => {
          if (observed) window.__capacityEncryptions.push({ durationMs: performance.now() - started, success: true });
          return result;
        }, error => {
          if (observed) window.__capacityEncryptions.push({ durationMs: performance.now() - started, success: false });
          throw error;
        });
      };
    }
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (data, ...rest) {
      if (data?.type === 'asset' && data.bytes instanceof ArrayBuffer) {
        window.__capacityPackets.push({ reference: data.reference, byteLength: data.bytes.byteLength, generation: data.mediaGeneration });
        if (window.__capacityPackets.length > 2000) window.__capacityPackets.shift();
      }
      return Reflect.apply(post, this, [data, ...rest]);
    };
  });
  const page = context.pages()[0] ?? await context.newPage();
  page.on('pageerror', error => observations.pageErrors.push(error.message));
  const offlineTarget = offline ? await context.newCDPSession(page) : null;
  if (offline) await context.setOffline(true);
  return { context, page, observations, offlineTarget };
}

async function assertNativeOffline(browser) {
  assert(browser.offlineTarget);
  // Cached boot frames can change the renderer flag while context transport remains offline.
  await browser.offlineTarget.send('Network.overrideNetworkState', { offline: true, latency: 0,
    downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none' });
  await expect.poll(() => browser.page.evaluate(() => navigator.onLine)).toBe(false);
  browser.observations.nativeOfflineChecks++;
}

async function login(browser, identity) {
  await browser.page.goto(origin + '/admin/login');
  await browser.page.getByLabel('E-mail').fill(identity.email);
  await browser.page.getByLabel('Heslo').fill(identity.password);
  await button(browser.page, 'Přihlásit se').click();
  await expect(browser.page).toHaveURL(/\/admin$/u);
}

async function head(page, sessionId) {
  return page.evaluate(sessionId => new Promise((resolve, reject) => {
    const request = indexedDB.open('justkviz-offline-v1', 1);
    request.onerror = () => reject(new Error('Cannot inspect durable checkpoint.'));
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction('sessions');
      const read = transaction.objectStore('sessions').get(sessionId);
      read.onsuccess = () => resolve(read.result ? { sequence: read.result.sequence, headHash: read.result.headHash, complete: read.result.complete } : null);
      read.onerror = () => reject(new Error('Cannot read durable checkpoint.'));
      transaction.oncomplete = () => db.close();
    };
  }), sessionId);
}

async function confirmed(page, sessionId, action) {
  const before = await head(page, sessionId);
  await action();
  await expect.poll(async () => (await head(page, sessionId)).sequence).toBeGreaterThan(before.sequence);
  await expect(page.locator('[data-offline-error]')).toHaveCount(0);
  return head(page, sessionId);
}

async function assertPlayable(page, status) {
  await expect(page.locator('[data-offline-runtime-state]')).toContainText(status);
  await expect(page.locator('[data-offline-readiness-error]')).toHaveCount(0);
  await expect(page.locator('[data-offline-error]')).toHaveCount(0);
}

async function unlock(browser, sessionId, nativeProfile) {
  const { page } = browser;
  await page.goto(origin + '/offline.html');
  const coldNativeStorage = await assertColdNativeStorage(page, nativeRecord(nativeProfile));
  await page.getByLabel('Heslo offline souboru', { exact: true }).fill(password);
  await page.locator(`[data-offline-session="${sessionId}"]`).getByRole('button', { name: 'Odemknout a pokračovat', exact: true }).click();
  await assertPlayable(page, 'Offline režim aktivní');
  await assertNativeOffline(browser);
  return coldNativeStorage;
}

async function importFile(browser, filename, nativeProfile, status) {
  const { page } = browser;
  await page.goto(origin + '/offline.html');
  const coldNativeStorage = await assertColdNativeStorage(page, nativeRecord(nativeProfile));
  await assertNativeOffline(browser);
  await page.getByLabel('Heslo offline souboru', { exact: true }).fill(password);
  const started = performance.now();
  await page.getByLabel('Načíst offline kvíz', { exact: true }).setInputFiles(filename);
  await assertPlayable(page, status);
  const durationMs = performance.now() - started;
  await assertNativeOffline(browser);
  return { durationMs, coldNativeStorage };
}

async function prepare() {
  const environment = requireFullEmulatorEnvironment(process.env, 'Offline capacity prepare');
  await mkdir(directory, { recursive: true });
  let browser = await launch('p'), fixture, observer;
  const snapshots = [], started = performance.now();
  try {
    const seeds = await createOfflineMedia(browser.page, path.join(directory, 'seed-media'));
    const assets = await createCapacityMedia(seeds, path.join(directory, 'capacity-media'), browser.page, overflow);
    fixture = await capacityEventFixture(assets);
    await login(browser, fixture.identity);
    await browser.page.goto(`${origin}/offline.html#/prepare?eventId=${fixture.eventId}`);
    await button(browser.page, 'Uložit aplikaci pro offline spuštění').click();
    await expect(browser.page.locator('[data-offline-shell-status]')).toContainText('Aplikace je uložená');
    browser.page = (await installNativeOfflineApp({ context: browser.context, page: browser.page,
      profile: path.join(profileRoot, 'p'), recordPath: nativeRecord('p'), startUrl: `${origin}/offline.html#/prepare?eventId=${fixture.eventId}` })).page;
    observer = await observeCapacityMemory(browser.context.browser());
    observer.phase('before-prepare'); snapshots.push(await capacitySnapshot(browser.context, browser.page, 'before-prepare'));
    await browser.page.getByLabel('Heslo offline souboru', { exact: true }).fill(password);
    await browser.page.getByLabel('Heslo znovu', { exact: true }).fill(password);
    observer.phase('manifest-fetch-download-hash-encrypt-IDB-and-native-decode');
    const cryptoStart = await browser.page.evaluate(() => window.__capacityEncryptions.length);
    const preparationStarted = performance.now();
    await button(browser.page, 'Připravit celý offline kvíz').click();
    if (overflow) {
      await expect(browser.page.locator('[data-offline-error]')).toContainText('512 MiB');
      await expect(browser.page.locator('[data-offline-runtime-state]')).toHaveCount(0);
      await expect(browser.page.locator('[data-offline-session]')).toHaveCount(0);
      await writeFile(path.join(directory, 'overflow-proof.json'), JSON.stringify({ status: 'PASS', actualPayloadBytes: capacityPayloadBytes + 1,
        allAssetsAtMost25MiB: true, actualOwnFiles: assets.length, noReady: true, noPrivateSession: true,
        observations: browser.observations, memory: await observer.finish() }, null, 2), { flag: 'wx' });
      observer = null;
      return;
    }
    await assertPlayable(browser.page, 'Offline kvíz připraven');
    const preparationDurationMs = performance.now() - preparationStarted;
    const encrypted = await browser.page.evaluate(start => window.__capacityEncryptions.slice(start), cryptoStart);
    expect(encrypted.length).toBeGreaterThan(0); expect(encrypted.every(record => record.success)).toBe(true);
    snapshots.push(await capacitySnapshot(browser.context, browser.page, 'after-full-native-verification'));
    await button(browser.page, 'Zamknout soukromá data').click();
    const row = browser.page.locator('[data-offline-session]');
    await expect(row).toHaveCount(1);
    const sessionId = await row.getAttribute('data-offline-session');
    observer.phase('real-browser-download-512MiB');
    const exportStarted = performance.now();
    const [download] = await Promise.all([browser.page.waitForEvent('download'), row.getByRole('button', { name: 'Stáhnout původní offline soubor', exact: true }).click()]);
    await download.saveAs(bundlePath); expect(await download.failure()).toBeNull();
    const exportDurationMs = performance.now() - exportStarted;
    observer.phase('after-download-streaming-independent-inspection');
    const inspected = await inspectCapacityArchive(bundlePath, password);
    const trust = await fixture.call('readOfflineTrust', { eventId: fixture.eventId });
    verifyServerOfflineGrant({ ok: true, ...inspected.metadata }, trust);
    expect(inspected.checkedAssets).toHaveLength(256);
    expect(inspected.checkedAssets.reduce((sum, asset) => sum + asset.size, 0)).toBe(capacityPayloadBytes);
    expect(inspected.metadata.manifest.slides.filter(slide => slide.kind === 'video')).toHaveLength(21);
    expect(inspected.metadata.manifest.assets.filter(asset => asset.kind === 'video')).toHaveLength(21);
    expect(inspected.metadata.manifest.assets.filter(asset => asset.kind === 'image')).toHaveLength(233);
    expect(new Set(inspected.metadata.manifest.assets.map(asset => asset.contentType)).size).toBe(6);
    snapshots.push(await capacitySnapshot(browser.context, browser.page, 'after-download'));
    const producerMemory = await observer.finish(); observer = null;
    expect(producerMemory.status).toBe('MEASURED'); expect(producerMemory.failedSamples).toBe(0);
    const producerObservations = browser.observations;
    await browser.context.close();
    browser = await launch('p'); await browser.page.goto(origin + '/offline.html');
    const producerColdStorage = await assertColdNativeStorage(browser.page, nativeRecord('p'));
    await browser.context.close();
    const targets = [];
    for (const profile of ['t', 'r']) {
      browser = await launch(profile); await login(browser, fixture.identity);
      const requests = { trust: 0, prepare: 0, media: 0 };
      await browser.page.goto(`${origin}/offline.html#/prepare?eventId=${fixture.eventId}`);
      await button(browser.page, 'Uložit aplikaci pro offline spuštění').click();
      await expect(browser.page.locator('[data-offline-shell-status]')).toContainText('Aplikace je uložená');
      browser.page = (await installNativeOfflineApp({ context: browser.context, page: browser.page, profile: path.join(profileRoot, profile),
        recordPath: nativeRecord(profile), startUrl: `${origin}/offline.html#/prepare?eventId=${fixture.eventId}` })).page;
      const functionsOrigin = `http://${environment.functionsEndpoint.host}:${environment.functionsEndpoint.port}`;
      const targetNetwork = await browser.context.newCDPSession(browser.page);
      targetNetwork.on('Network.requestWillBeSent', ({ request }) => {
        const url = new URL(request.url);
        if (url.origin !== functionsOrigin) return;
        if (request.method === 'POST' && url.pathname.endsWith('/readOfflineTrust')) requests.trust++;
        if (request.method === 'POST' && url.pathname.endsWith('/prepareOfflineEvent')) requests.prepare++;
        if (url.pathname.endsWith('/readQuizMedia')) requests.media++;
      });
      try {
        await targetNetwork.send('Network.enable');
        await button(browser.page, 'Připravit notebook pro přenesený kvíz').click();
        await expect(browser.page.locator('[data-offline-shell-status]')).toContainText('Aplikace je uložená');
        await expect(browser.page.locator('[data-offline-status]')).toContainText('ověřený klíč akce');
        await expect.poll(() => requests.trust).toBeGreaterThan(0);
      } finally { await targetNetwork.detach(); }
      expect(requests.prepare).toBe(0); expect(requests.media).toBe(0);
      const pinnedTrust = await browser.page.evaluate(key => new Promise((resolve, reject) => {
        const opening = indexedDB.open('justkviz-offline-v1', 1);
        opening.onerror = () => reject(new Error('Cannot open the capacity notebook trust store.'));
        opening.onsuccess = () => {
          const database = opening.result, transaction = database.transaction('settings');
          const read = transaction.objectStore('settings').get(key);
          read.onsuccess = () => resolve(read.result);
          read.onerror = () => reject(new Error('Cannot read the pinned capacity notebook key.'));
          transaction.oncomplete = () => database.close();
        };
      }), `trust:${trust.environment}:${trust.keyId}`);
      expect(pinnedTrust).toEqual(trust);
      expect(await browser.page.evaluate(() => navigator.storage.persisted())).toBe(true);
      await expect(browser.page.locator('[data-offline-session]')).toHaveCount(0);
      targets.push({ profile, requests, requestObserver: 'CDP Network on native launched target', pinnedTrustMatchesServer: true,
        snapshot: await capacitySnapshot(browser.context, browser.page, 'installer-only') });
      await browser.context.close();
    }
    const imageOracles = fixture.media.filter(asset => asset.expectedPixel).map(asset => ({ reference: asset.reference, pixel: asset.expectedPixel }));
    await writeFile(privateFixture, JSON.stringify({ sessionId, trust, imageOracles }), { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(directory, 'prepare-proof.json'), JSON.stringify({ status: 'PASS', phase: 'prepare',
      elapsedMs: Math.round(performance.now() - started), assets: 256, actualPayloadBytes: capacityPayloadBytes,
      actualPaddedOwnVideos: 21, allReferencedBeforeLock: true, authoring: fixture.authoringProof, fileBytes: inspected.fileBytes,
      fileSha256: inspected.fileSha256, recordCount: inspected.recordCount, largestIndependentRead: inspected.largestRead,
      snapshots, producerMemory, producerObservations, targets,
      browserVersion: process.env.OFFLINE_CAPACITY_BROWSER_VERSION,
      nativeConsentMethod: 'Shared QA helper: real PWA.install/launch, native persist, no permission override or preference edits', producerColdStorage,
      timings: { preparation: summarizeCapacityDurations([preparationDurationMs]), originalExport: summarizeCapacityDurations([exportDurationMs]),
        nativeAesGcmEncryptCalls: summarizeCapacityDurations(encrypted.map(record => record.durationMs), encrypted.filter(record => !record.success).length),
        nativeAesGcmAwaitedTotalMs: encrypted.reduce((sum, record) => sum + record.durationMs, 0),
        scope: 'Node monotonic UI start-to-confirmed-READY/export-completed durations include automation waits. WebCrypto AES-GCM calls use browser monotonic time, no keys or input/output bytes are logged. Encryption call time excludes PBKDF2, hashing, file copy and durable IDB commit.' },
      limitation: 'Free boxes stress real transfer/hash/encryption/storage bytes; they do not simulate 512 MiB of complex decoded video or 4K hardware.' }, null, 2), { flag: 'wx' });
    await fixture.detach(); fixture = null;
  } finally {
    try { if (observer) await observer.finish(); }
    finally {
      try { await browser.context.close(); }
      finally { if (fixture) await fixture.dispose(); }
    }
  }
}

async function playVideo(operator, projector, sessionId, expectedAsset, transitionStarted) {
  const packetStart = await operator.evaluate(() => window.__capacityPackets.length);
  let playStarted;
  await confirmed(operator, sessionId, () => { playStarted = performance.now(); return button(operator, 'Přehrát ukázku').click(); });
  const media = projector.locator('video');
  await expect(media).toHaveCount(1);
  await expect(async () => {
    const manual = projector.getByRole('button', { name: 'Spustit video ručně', exact: true });
    if (await manual.isVisible()) await manual.click();
    expect(await media.evaluate(video => !video.paused && video.currentTime > 1.05 && video.currentTime < 3 && video.duration >= 4.9)).toBe(true);
  }).toPass({ timeout: 15_000 });
  const proof = await media.evaluate(video => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native video frame missing.')), 5000);
    video.requestVideoFrameCallback((_, data) => { clearTimeout(timer); resolve({ width: data.width, height: data.height, mediaTime: data.mediaTime, currentTime: video.currentTime, objectUrl: video.currentSrc }); });
  }));
  const nativeFrameObservedAt = performance.now();
  expect(proof.width).toBe(384); expect(proof.height).toBe(216);
  const packets = await operator.evaluate(start => window.__capacityPackets.slice(start), packetStart);
  const packet = packets.find(packet => packet.reference === expectedAsset.reference && packet.byteLength === expectedAsset.size);
  expect(packet, 'Native playback must receive the exact current asset reference and byte length.').toBeTruthy();
  expect(proof.objectUrl.startsWith('blob:')).toBe(true);
  const transitionDurationMs = performance.now() - transitionStarted;
  await confirmed(operator, sessionId, () => button(operator, 'Zastavit ukázku').click());
  await expect.poll(() => media.evaluate(video => video.paused)).toBe(true);
  return { ...proof, ipc: { exactCurrentReference: true, byteLength: packet.byteLength, generation: packet.generation },
    playToObservedNativeFrameMs: nativeFrameObservedAt - playStarted, transitionDurationMs };
}

async function offline() {
  await stoppedBackends();
  const credentials = JSON.parse(await readFile(privateFixture, 'utf8'));
  const inspected = await inspectCapacityArchive(bundlePath, password), manifest = inspected.metadata.manifest;
  let browser = await launch('t', true), observer;
  const snapshots = [], observations = [], videos = [], repeatedVideos = [], imageDurations = [], started = performance.now();
  try {
    await browser.page.goto(origin + '/offline.html');
    observer = await observeCapacityMemory(browser.context.browser());
    snapshots.push(await capacitySnapshot(browser.context, browser.page, 'cold-before-import'));
    observer.phase('offline-disk-import-decrypt-hash-all-native-decode');
    const coldImport = await importFile(browser, bundlePath, 't', 'Offline kvíz připraven');
    expect((await head(browser.page, credentials.sessionId)).sequence).toBe(0);
    snapshots.push(await capacitySnapshot(browser.context, browser.page, 'after-offline-import'));
    const [projector] = await Promise.all([browser.page.waitForEvent('popup'), button(browser.page, 'Otevřít offline projektor').click()]);
    await expect(projector.locator('[data-offline-projector]')).toBeVisible();
    await confirmed(browser.page, credentials.sessionId, () => button(browser.page, 'Zahájit offline kvíz').click());
    await assertPlayable(browser.page, 'Offline režim aktivní');
    const navigate = (slide, beginning) => confirmed(browser.page, credentials.sessionId,
      () => { beginning?.(performance.now()); return browser.page.getByRole('combobox', { name: 'Snímek', exact: true }).selectOption(String(slide.position)); });
    const videoSlides = manifest.slides.filter(slide => slide.kind === 'video');
    observer.phase('all-21-native-product-video-play-frame-stop');
    for (const slide of videoSlides) {
      let transitionStarted;
      await navigate(slide, now => { transitionStarted = now; });
      const expectedAsset = manifest.assets.find(asset => asset.reference === slide.mediaSource);
      const proof = await playVideo(browser.page, projector, credentials.sessionId, expectedAsset, transitionStarted);
      expect(videos.some(previous => previous.objectUrl === proof.objectUrl)).toBe(false);
      videos.push({ position: slide.position, ...proof });
    }
    observer.phase('repeat-first-last-three-cycles-no-forced-GC');
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const slide of [videoSlides[0], videoSlides.at(-1)]) {
        let transitionStarted;
        await navigate(slide, now => { transitionStarted = now; });
        repeatedVideos.push(await playVideo(browser.page, projector, credentials.sessionId, manifest.assets.find(asset => asset.reference === slide.mediaSource), transitionStarted));
      }
    }
    snapshots.push(await capacitySnapshot(browser.context, browser.page, 'after-27-product-video-cycles'));
    observer.phase('all-230-additional-native-PNG-current-reference-loads');
    const imageProofs = [];
    const additionalImageSlides = manifest.slides.filter(slide => slide.kind === 'image').slice(1);
    expect(additionalImageSlides).toHaveLength(115);
    const seenImageReferences = new Set();
    for (const slide of additionalImageSlides) {
      const packetStart = await browser.page.evaluate(() => window.__capacityPackets.length);
      let transitionStarted;
      await navigate(slide, now => { transitionStarted = now; });
      const roles = [['question-image', slide.questionImage], ['background-image', slide.design?.backgroundImage || slide.backgroundImage]];
      const observed = await Promise.all(roles.map(async ([role, reference]) => {
        const asset = manifest.assets.find(item => item.reference === reference);
        const oracle = credentials.imageOracles.find(item => item.reference === reference);
        assert(asset && oracle && !seenImageReferences.has(reference));
        seenImageReferences.add(reference);
        const image = projector.locator(`img[data-role="${role}"]`);
        await expect(image).toHaveCount(1);
        await expect.poll(() => image.evaluate(image => {
          if (!image.complete || image.naturalWidth <= 0) return null;
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0);
          return { width: image.naturalWidth, height: image.naturalHeight, pixel: Array.from(context.getImageData(0, 0, 1, 1).data) };
        })).toEqual({ width: asset.width, height: asset.height, pixel: oracle.pixel });
        const packets = await browser.page.evaluate(start => window.__capacityPackets.slice(start), packetStart);
        const packet = packets.find(item => item.reference === reference && item.byteLength === asset.size);
        expect(packet).toBeTruthy();
        return { position: slide.position, role, width: asset.width, height: asset.height, pixel: oracle.pixel,
          durationMs: performance.now() - transitionStarted,
          ipc: { exactCurrentReference: true, byteLength: packet.byteLength, generation: packet.generation } };
      }));
      imageProofs.push(...observed);
      imageDurations.push(...observed.map(item => item.durationMs));
    }
    expect(seenImageReferences.size).toBe(230);
    snapshots.push(await capacitySnapshot(browser.context, browser.page, 'after-230-native-current-image-loads'));
    observer.phase('real-512MiB-emergency-export-download');
    await browser.page.getByLabel('Heslo pro nový nouzový soubor', { exact: true }).fill(password);
    const cryptoStart = await browser.page.evaluate(() => window.__capacityEncryptions.length);
    const recoveryExportStarted = performance.now();
    const [download] = await Promise.all([browser.page.waitForEvent('download'), button(browser.page, 'Stáhnout nouzovou obnovu').click()]);
    await download.saveAs(recoveryPath); expect(await download.failure()).toBeNull();
    const recoveryExportDurationMs = performance.now() - recoveryExportStarted;
    const recoveryEncryption = await browser.page.evaluate(start => window.__capacityEncryptions.slice(start), cryptoStart);
    expect(recoveryEncryption.length).toBeGreaterThan(0); expect(recoveryEncryption.every(record => record.success)).toBe(true);
    const recovery = await inspectCapacityArchive(recoveryPath, password);
    const finalHead = await head(browser.page, credentials.sessionId);
    expect(recovery.state.headHash).toBe(finalHead.headHash);
    expect(recovery.checkedAssets.reduce((sum, asset) => sum + asset.size, 0)).toBe(capacityPayloadBytes);
    snapshots.push(await capacitySnapshot(browser.context, browser.page, 'after-emergency-export'));
    observer.phase('retained-after-idle-15s-no-forced-GC');
    await browser.page.waitForTimeout(15000);
    const mainMemory = await observer.finish(); observer = null;
    await assertNativeOffline(browser);
    observations.push(browser.observations); await browser.context.close();
    await stoppedBackends();
    browser = await launch('t', true);
    const coldRestartStorage = await unlock(browser, credentials.sessionId, 't');
    expect(await head(browser.page, credentials.sessionId)).toEqual(finalHead);
    observations.push(browser.observations); await browser.context.close();
    await stoppedBackends();
    browser = await launch('r', true);
    observer = await observeCapacityMemory(browser.context.browser()); observer.phase('fresh-profile-recovery-file-import');
    const coldRecoveryImport = await importFile(browser, recoveryPath, 'r', 'Offline režim aktivní');
    expect(await head(browser.page, credentials.sessionId)).toEqual(finalHead);
    snapshots.push(await capacitySnapshot(browser.context, browser.page, 'fresh-recovery-profile-restored'));
    const recoveryMemory = await observer.finish(); observer = null;
    expect(recoveryMemory.status).toBe('MEASURED'); expect(recoveryMemory.failedSamples).toBe(0);
    observations.push(browser.observations);
    for (const observation of observations) {
      expect(observation.externalRequests).toBe(0); expect(observation.successfulNetworkResponses).toBe(0); expect(observation.pageErrors).toEqual([]);
      expect(observation.nativeOfflineChecks).toBeGreaterThan(0);
    }
    expect(mainMemory.status).toBe('MEASURED'); expect(mainMemory.failedSamples).toBe(0);
    await stoppedBackends();
    await writeFile(path.join(directory, 'offline-proof.json'), JSON.stringify({ status: 'PASS', phase: 'offline',
      elapsedMs: Math.round(performance.now() - started), actualPayloadBytes: capacityPayloadBytes,
      coldPortableImport: true, allFiveBackendsStopped: true, actualBrowserOffline: true,
      nativeProductVideoFrames: videos.map(({ objectUrl, ...proof }) => { assert.equal(typeof objectUrl, 'string'); return proof; }), repeatedFirstLastCycles: 3,
      unchangedCheckpointAcrossChromeRestart: finalHead,
      nativeAdditionalImageLoads: imageProofs, pairedImageNavigationCount: additionalImageSlides.length, exactAssetCount: 256,
      coldImportStorage: coldImport.coldNativeStorage, coldRestartStorage, coldRecoveryStorage: coldRecoveryImport.coldNativeStorage,
      timings: { coldPortableImport: summarizeCapacityDurations([coldImport.durationMs]), coldRecoveryImport: summarizeCapacityDurations([coldRecoveryImport.durationMs]),
        recoveryExport: summarizeCapacityDurations([recoveryExportDurationMs]),
        recoveryNativeAesGcmEncryptCalls: summarizeCapacityDurations(recoveryEncryption.map(record => record.durationMs), recoveryEncryption.filter(record => !record.success).length),
        recoveryNativeAesGcmAwaitedTotalMs: recoveryEncryption.reduce((sum, record) => sum + record.durationMs, 0),
        imageCurrentIpcAndNativePixel: summarizeCapacityDurations(imageDurations),
        videoCurrentIpcAndNativeFrame: summarizeCapacityDurations([...videos, ...repeatedVideos].map(record => record.transitionDurationMs)),
        videoPlayToObservedNativeFrame: summarizeCapacityDurations([...videos, ...repeatedVideos].map(record => record.playToObservedNativeFrameMs)),
        scope: 'Node performance.now from actual UI select/Play invocation to observed current IPC+native frame/pixel. Each of 115 image selections has a question and background sample. Includes Playwright scheduling, assertion polling and manual-autoplay fallback where needed. These are observed automation workflow durations, not physical projector latency, precise first compositor frames, or instrumentation-free product benchmarks.' },
      independentFreshProfileRecovery: true, recoveryFileBytes: recovery.fileBytes,
      recoverySha256: recovery.fileSha256, largestIndependentRead: recovery.largestRead,
      snapshots, mainMemory, recoveryMemory, observations,
      limitations: ['Windows/Chrome process restart only, not an operating-system restart.',
        'Muted browser native playback; physical projector/audio NOT TESTED.',
        'Free padding is real transferred/encrypted/hashed data, not additional codec complexity.',
        'Sampled process memory is reported, not a universal RAM cap or target-laptop guarantee.'] }, null, 2), { flag: 'wx' });
  } finally {
    try { if (observer) await observer.finish(); }
    finally { await browser.context.close(); }
  }
}

async function cleanup() {
  const results = [];
  for (const name of ['p', 't', 'r']) {
    try { await access(nativeRecord(name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const browser = await launch(name, true);
    try { results.push(await uninstallOwnedOfflineApp({ context: browser.context, profile: path.join(profileRoot, name), recordPath: nativeRecord(name) })); }
    catch (error) { results.push({ profile: name, status: 'FAIL', error: error.message }); }
    finally { await browser.context.close(); }
  }
  const status = results.some(result => result.status === 'FAIL') ? 'FAIL' : 'PASS';
  await writeFile(path.join(directory, 'cleanup-proof.json'), JSON.stringify({ status, results, foreignAppsTouched: false }, null, 2), { flag: 'wx' });
  assert.equal(status, 'PASS');
}

test(`offline 512 MiB capacity: ${phase ?? 'EXPLICIT_PHASE_REQUIRED'}`, async () => {
  assert(['prepare', 'offline', 'cleanup'].includes(phase));
  if (phase === 'prepare') await prepare(); else if (phase === 'offline') await offline(); else await cleanup();
});
