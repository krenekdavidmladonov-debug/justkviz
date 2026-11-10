/* global window, indexedDB, HTMLVideoElement, location */
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
import { createOfflineMedia, verifyOfflineNativeMedia } from './offline-media-fixture.mjs';
import { detachOfflineFixture, offlineEventFixture, verifyServerOfflineGrant } from './offline-event-fixture.mjs';
import { inspectOfflineArchive } from './offline-archive-fixture.mjs';
import { installNativeOfflineApp, assertColdNativeStorage, uninstallOwnedOfflineApp } from './offline-native-app-fixture.mjs';

const origin = 'http://127.0.0.1:5000';
const phase = process.env.OFFLINE_QA_PHASE;
const directory = path.resolve(process.env.OFFLINE_QA_RUN_DIR ?? '.local-data/offline-v1/browser-unconfigured');
const profileRoot = path.resolve(process.env.OFFLINE_QA_PROFILE_ROOT ?? path.join(directory, 'PROFILE_MAPPING_REQUIRED'));
const producerProfile = path.join(profileRoot, 'p');
const targetProfile = path.join(profileRoot, 't');
const checkpointProfile = path.join(profileRoot, 'checkpoint');
const forkProfile = path.join(profileRoot, 'fork');
const password = 'synthetic-complete-offline-password';
const credentialPath = path.join(directory, 'private-fixture.json');
const bundlePath = path.join(directory, 'prepared.justkvizoffline');
const recoveryPath = path.join(directory, 'recovery.justkvizoffline');
const nativeRecord = name => path.join(directory, `native-app-${name}.json`);
const allowedOrigins = new Set([origin, ...[5001, 8080, 9099, 9199].map(port => `http://127.0.0.1:${port}`)]);
const button = (page, name) => page.getByRole('button', { name, exact: true });

async function stoppedBackends() {
  for (const port of [5000, 5001, 8080, 9099, 9199]) await new Promise((resolve, reject) => {
    const connection = createConnection({ host: '127.0.0.1', port });
    connection.once('connect', () => { connection.destroy(); reject(new Error(`Backend port ${port} is still listening.`)); });
    connection.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
    connection.setTimeout(1000, () => { connection.destroy(); reject(new Error(`Cannot prove backend port ${port} stopped.`)); });
  });
}

async function copyClosedProfile(source, target) {
  const prefix = profileRoot + path.sep;
  assert(source.startsWith(prefix) && target.startsWith(prefix) && source !== target);
  // Copy a real, completely closed browser profile. No application records are rewritten.
  await cp(source, target, { recursive: true, force: false, errorOnExist: true,
    filter: filename => !path.basename(filename).startsWith('Singleton') });
}

async function launch(offline = false, profile = targetProfile) {
  assert(directory.startsWith(path.resolve('.local-data/offline-v1') + path.sep));
  assert(/^op-[a-f0-9]{8}$/u.test(path.relative(path.resolve('.local-data'), profileRoot)), 'Use the controller-created own short profile mapping.');
  assert(profile.startsWith(profileRoot + path.sep));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? (process.platform === 'win32'
      ? 'C:/Projects/filmovy-kviz-v2/.tools/playwright/chromium-1234/chrome-win64/chrome.exe' : chromium.executablePath()),
    headless: true, baseURL: origin, offline, serviceWorkers: 'allow', acceptDownloads: true,
    viewport: { width: 1366, height: 768 }, args: ['--mute-audio'],
  });
  const observations = { pageErrors: [], externalRequests: 0, successfulNetworkResponses: 0, serviceWorkerResponses: 0, nativeOfflineChecks: 0 };
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
    window.__offlineQaPackets = []; window.__offlineQaIdbOpens = [];
    const nativePost = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (data, ...rest) {
      if (data && typeof data === 'object') window.__offlineQaPackets.push({ type: data.type, reference: data.reference,
        byteLength: data.bytes instanceof ArrayBuffer ? data.bytes.byteLength : null,
        state: data.type === 'state' ? JSON.stringify(data.state) : null });
      return Reflect.apply(nativePost, this, [data, ...rest]);
    };
    const nativeOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = function (name, version) { window.__offlineQaIdbOpens.push(name); return version === undefined ? nativeOpen(name) : nativeOpen(name, version); };
  });
  const page = context.pages()[0] ?? await context.newPage();
  page.on('pageerror', error => observations.pageErrors.push(error.message));
  const offlineTarget = offline ? await context.newCDPSession(page) : null;
  if (offline) await context.setOffline(true);
  return { context, page, observations, offlineTarget };
}

async function assertNativeOffline(browser) {
  assert(browser.offlineTarget);
  // A cached navigation or temporary frame can reset the renderer's native flag
  // even while context offline transport and all five stopped ports remain in effect.
  // Keep this exact CDP target alive and check the flag after the app's boot checks.
  await browser.offlineTarget.send('Network.overrideNetworkState', { offline: true, latency: 0,
    downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none' });
  await expect.poll(() => browser.page.evaluate(() => navigator.onLine)).toBe(false);
  browser.observations.nativeOfflineChecks++;
}

async function storedHead(page, sessionId) {
  return page.evaluate(sessionId => new Promise((resolve, reject) => {
    const request = indexedDB.open('justkviz-offline-v1', 1);
    request.onerror = () => reject(new Error('Cannot inspect durable test checkpoint.'));
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction('sessions'), read = transaction.objectStore('sessions').get(sessionId);
      read.onsuccess = () => { const value = read.result; resolve(value ? { sequence: value.sequence, headHash: value.headHash,
        complete: value.complete, encryptedBytes: value.encrypted.bytes.byteLength } : null); };
      read.onerror = () => reject(new Error('Cannot inspect checkpoint.'));
      transaction.oncomplete = () => db.close();
    };
  }), sessionId);
}

async function confirmed(page, sessionId, action) {
  const before = await storedHead(page, sessionId); await action();
  await expect.poll(async () => (await storedHead(page, sessionId)).sequence).toBeGreaterThan(before.sequence);
  const head = await storedHead(page, sessionId);
  await expect(page.locator('[data-offline-runtime-state]')).toContainText(`${head.sequence} potvrzených kroků`);
  await expect(page.locator('[data-offline-error]')).toHaveCount(0);
  return head;
}

async function signInOnline(page, { email, password }) {
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill(password);
  await button(page, 'Přihlásit se').click();
  await expect(page).toHaveURL(/\/admin$/u);
}

async function unlock(page, sessionId) {
  await page.goto('/offline.html');
  await assertColdNativeStorage(page, nativeRecord('t'));
  await page.getByLabel('Heslo offline souboru', { exact: true }).fill(password);
  await page.locator(`[data-offline-session="${sessionId}"]`).getByRole('button', { name: 'Odemknout a pokračovat', exact: true }).click();
  await expect(page.locator('[data-offline-runtime-state]')).toBeVisible();
}

async function openProjector(page) {
  const [projector] = await Promise.all([page.waitForEvent('popup'), button(page, 'Otevřít offline projektor').click()]);
  await expect(projector.locator('[data-offline-projector]')).toBeVisible();
  return projector;
}

async function nativeImage(page, role, asset) {
  const image = page.locator(`img[data-role="${role}"]`);
  await expect(image).toHaveCount(1);
  await expect.poll(() => image.evaluate(image => image.complete && image.naturalWidth > 0 ? [image.naturalWidth, image.naturalHeight] : null)).toEqual([asset.width, asset.height]);
}

async function runtimeMedia(operator, output, sessionId, tag) {
  let preloadedMetadata = null;
  if (tag === 'video') {
    // Play advances the offline epoch. Exercise the case where that transition
    // replaces an already prepared native player, not just a cold request.
    const preloaded = output.locator('[data-media-lifecycle="READY"] video');
    await expect(preloaded).toHaveCount(1);
    preloadedMetadata = await preloaded.evaluate(video => ({ readyState: video.readyState, duration: video.duration,
      width: video.videoWidth, height: video.videoHeight, paused: video.paused }));
    expect(preloadedMetadata.readyState).toBeGreaterThanOrEqual(1);
    expect(preloadedMetadata.duration).toBeGreaterThanOrEqual(4.9);
    expect(preloadedMetadata).toMatchObject({ width: 384, height: 216, paused: true });
  }
  await confirmed(operator, sessionId, () => button(operator, 'Přehrát ukázku').click());
  const media = output.locator(tag);
  await expect(media).toHaveCount(1);
  await expect(async () => {
    const manual = output.getByRole('button', { name: /Spustit (video|zvuk) ručně/u });
    if (await manual.isVisible()) await manual.click();
    expect(await media.evaluate(media => !media.paused && media.currentTime > 1.05 && media.duration >= 4.9)).toBe(true);
  }).toPass({ timeout: 15_000 });
  const proof = await media.evaluate(async media => {
    const frame = media instanceof HTMLVideoElement ? await new Promise(resolve => media.requestVideoFrameCallback((_, data) => resolve({ width: data.width, height: data.height }))) : null;
    return { duration: media.duration, currentTime: media.currentTime, frame, playing: !media.paused };
  });
  await confirmed(operator, sessionId, () => button(operator, 'Zastavit ukázku').click());
  await expect.poll(() => media.evaluate(media => media.paused)).toBe(true);
  return { ...proof, ...(preloadedMetadata ? { preloadedMetadata } : {}) };
}

async function preparePhase() {
  const environment = requireFullEmulatorEnvironment(process.env, 'Offline browser preparation');
  await mkdir(directory, { recursive: true });
  let browser = await launch(false, producerProfile), fixture, retained = false;
  const started = performance.now();
  try {
    const assets = await createOfflineMedia(browser.page, path.join(directory, 'generated-media'));
    const native = [];
    for (const asset of assets) native.push({ contentType: asset.contentType, ...await verifyOfflineNativeMedia(browser.page, asset) });
    fixture = await offlineEventFixture({ assets, lockInBrowser: true });
    let page = browser.page;
    await signInOnline(page, fixture.identity);
    await page.goto(`/admin/events/${fixture.eventId}`);
    const assignment = page.getByTestId('event-quiz-assignment');
    const prepareLink = page.getByRole('link', { name: 'Připravit offline kvíz', exact: true });
    await expect(assignment.getByRole('heading', { name: 'Vybrat kvíz', exact: true })).toBeVisible();
    await expect(prepareLink).toHaveCount(0);
    await assignment.getByRole('combobox', { name: 'Kvíz', exact: true }).selectOption(fixture.quizId);
    await assignment.getByRole('button', { name: 'Připravit ke hraní', exact: true }).click();
    await expect(assignment.getByRole('heading', { name: 'Kvíz připraven', exact: true })).toBeVisible();
    await fixture.confirmBrowserLock();
    await prepareLink.click();
    await expect(page).toHaveURL(`/offline.html#/prepare?eventId=${fixture.eventId}`);
    await expect(button(page, 'Pokračovat k balíčku')).toBeVisible();
    // Bootstrap native installation separately, then test the wizard's real download/readback path.
    const preparationUrl = page.url();
    await page.goto('/offline.html');
    await button(page, 'Uložit aplikaci pro offline spuštění').click();
    await expect(page.locator('[data-offline-shell-status]')).toContainText('Aplikace je uložená');
    page = (await installNativeOfflineApp({ context: browser.context, page, profile: producerProfile,
      recordPath: nativeRecord('p'), startUrl: preparationUrl })).page;
    await page.evaluate(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
    await button(page, 'Pokračovat k balíčku').click();
    await page.getByLabel('Heslo offline souboru', { exact: true }).fill(password); await page.getByLabel('Heslo znovu', { exact: true }).fill(password);
    await button(page, 'Vytvořit offline balíček').click();
    await expect(page.getByText('Balíček je vytvořený', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.storage.persisted())).toBe(true);
    const [download] = await Promise.all([page.waitForEvent('download'), button(page, 'Uložit offline soubor').click()]);
    await download.saveAs(bundlePath); expect(await download.failure()).toBeNull();
    await expect(page.locator('[data-offline-wizard-step]')).toHaveAttribute('data-offline-wizard-step', '2');
    await page.getByLabel('Ověřit stažený soubor', { exact: true }).setInputFiles(bundlePath);
    await expect(page.getByText('Offline soubor je uložený a ověřený.', { exact: false })).toBeVisible();
    await expect(page.locator('[data-offline-notebook-state]')).toHaveAttribute('data-offline-notebook-state', 'ready');
    const inspected = await inspectOfflineArchive(bundlePath, password);
    const sessionId = inspected.metadata.manifest.sessionId;
    const trust = await fixture.call('readOfflineTrust', { eventId: fixture.eventId });
    verifyServerOfflineGrant({ ok: true, ...inspected.metadata }, trust);
    expect(inspected.metadata.manifest.event.id).toBe(fixture.eventId);
    expect(inspected.metadata.manifest.snapshot).toMatchObject({ id: fixture.snapshotId, quizId: fixture.quizId });
    expect(inspected.assets).toHaveLength(6); expect(inspected.metadata.operations).toEqual([]);
    expect(new Set(inspected.assets.map(asset => asset.contentType)).size).toBe(6);
    const producerHead = await storedHead(page, sessionId), producerObservations = browser.observations;
    expect(producerHead).toMatchObject({ complete: true, sequence: 0 });
    await browser.context.close();
    browser = await launch(false, producerProfile);
    await browser.page.goto('/offline.html');
    const producerColdStorage = await assertColdNativeStorage(browser.page, nativeRecord('p'));
    expect(await storedHead(browser.page, sessionId)).toEqual(producerHead);
    await browser.context.close();
    browser = await launch(false, targetProfile);
    let target = browser.page;
    await signInOnline(target, fixture.identity);
    await target.goto(`/admin/events/${fixture.eventId}`);
    await target.getByRole('link', { name: 'Připravit offline kvíz', exact: true }).click();
    await target.getByRole('link', { name: 'Už mám soubor z jiného počítače', exact: true }).click();
    await expect(target.getByRole('heading', { name: 'Připravit cílový notebook', exact: true })).toBeVisible();
    const transferUrl = target.url();
    await target.goto('/offline.html');
    await button(target, 'Uložit aplikaci pro offline spuštění').click();
    await expect(target.locator('[data-offline-shell-status]')).toContainText('Aplikace je uložená');
    target = (await installNativeOfflineApp({ context: browser.context, page: target, profile: targetProfile,
      recordPath: nativeRecord('t'), startUrl: transferUrl })).page;
    const installerRequests = { prepare: 0, media: 0, trust: 0 };
    const functionsOrigin = `http://${environment.functionsEndpoint.host}:${environment.functionsEndpoint.port}`;
    // Native PWA.launch can create a target outside Playwright's context request events.
    // Observe this exact target and retain counts only, with no headers or payloads.
    const targetNetwork = await browser.context.newCDPSession(target);
    targetNetwork.on('Network.requestWillBeSent', ({ request }) => {
      const url = new URL(request.url);
      if (url.origin !== functionsOrigin) return;
      if (request.method === 'POST' && url.pathname.endsWith('/prepareOfflineEvent')) installerRequests.prepare++;
      if (url.pathname.endsWith('/readQuizMedia')) installerRequests.media++;
      if (request.method === 'POST' && url.pathname.endsWith('/readOfflineTrust')) installerRequests.trust++;
    });
    try {
      await targetNetwork.send('Network.enable');
      await button(target, 'Připravit JustKvíz pro hraní bez internetu').click();
      await expect(target.locator('[data-offline-notebook-state]')).toHaveAttribute('data-offline-notebook-state', 'ready');
      await expect.poll(() => installerRequests.trust).toBeGreaterThan(0);
    } finally { await targetNetwork.detach(); }
    expect(installerRequests.prepare).toBe(0); expect(installerRequests.media).toBe(0);
    const notebookTrust = await target.evaluate(key => new Promise((resolve, reject) => {
      const opening = indexedDB.open('justkviz-offline-v1', 1);
      opening.onerror = () => reject(new Error('Cannot open the notebook trust store.'));
      opening.onsuccess = () => {
        const database = opening.result, transaction = database.transaction('settings'), read = transaction.objectStore('settings').get(key);
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(new Error('Cannot read the pinned notebook key.'));
        transaction.oncomplete = () => database.close();
      };
    }), `trust:${trust.environment}:${trust.keyId}`);
    expect(notebookTrust).toEqual(trust);
    expect(await target.evaluate(() => navigator.storage.persisted())).toBe(true);
    const transfer = target.getByRole('link', { name: 'Načíst přenesený kvíz', exact: true });
    await expect(transfer).toHaveAttribute('href', `/offline.html#/import?eventId=${fixture.eventId}`);
    await transfer.click();
    await expect(target.getByLabel('Načíst offline kvíz', { exact: true })).toBeVisible();
    await expect(target.locator('[data-offline-session]')).toHaveCount(0);
    expect(await storedHead(target, sessionId)).toBeNull();
    await writeFile(credentialPath, JSON.stringify({ eventId: fixture.eventId, quizId: fixture.quizId, snapshotId: fixture.snapshotId,
      actorUid: fixture.user.uid, email: fixture.identity.email, password: fixture.identity.password, sessionId, trust }), { flag: 'wx' });
    const proof = { status: 'PASS', phase: 'prepare', elapsedMs: Math.round(performance.now() - started), native,
      actualPersisted: true, browserVersion: browser.context.browser()?.version(), assets: 6, packageBytes: inspected.fileBytes,
      packageSha256: inspected.fileSha256, recordCount: inspected.recordCount, producerHead, distinctFreshNotebookProfile: true,
      notebookInstallerRequests: installerRequests, notebookInstallerObserver: 'CDP Network on native launched target',
      notebookPinnedTrustMatchesServer: true, notebookHasNoPrivateSessionBeforeTransfer: true,
      eventLockedInAdminAndOfflinePreparationOpenedFromEventDetail: true, wizardReadBackDiskDownload: true,
      nativeConsentMethod: 'Real PWA.install + PWA.launch + native storage.persist; no permission overrides or preference edits', producerColdStorage,
      producerObservations, notebookObservations: browser.observations };
    await writeFile(path.join(directory, 'prepare-proof.json'), JSON.stringify(proof, null, 2), { flag: 'wx' });
    retained = true;
  } finally {
    await browser.context.close();
    if (fixture) { if (retained) await detachOfflineFixture(fixture); else await fixture.dispose(); }
  }
}

async function offlinePhase() {
  await stoppedBackends();
  const credentials = JSON.parse(await readFile(credentialPath, 'utf8'));
  const inspected = await inspectOfflineArchive(bundlePath, password), manifest = inspected.metadata.manifest;
  let browser = await launch(true); const observations = [], mediaProofs = [], interimPages = [];
  try {
    let page = browser.page;
    await page.goto('/offline.html');
    const notebookColdStorage = await assertColdNativeStorage(page, nativeRecord('t'));
    await expect(page.locator('[data-offline-session]')).toHaveCount(0);
    await assertNativeOffline(browser);
    const differentEvent = 'synthetic-offline-wrong-event';
    assert.notEqual(differentEvent, credentials.eventId);
    await page.goto(`/offline.html#/import?eventId=${differentEvent}`);
    await page.getByLabel('Heslo offline souboru', { exact: true }).fill(password);
    await page.getByLabel('Načíst offline kvíz', { exact: true }).setInputFiles(bundlePath);
    await expect(page.locator('[data-offline-error]')).toContainText('Tento soubor patří jiné akci.');
    await expect(page.locator('[data-offline-runtime-state], [data-offline-session]')).toHaveCount(0);
    expect(await storedHead(page, credentials.sessionId)).toBeNull();
    await page.goto(`/offline.html#/import?eventId=${credentials.eventId}`);
    await page.getByLabel('Heslo offline souboru', { exact: true }).fill(password);
    await page.getByLabel('Načíst offline kvíz', { exact: true }).setInputFiles(bundlePath);
    await expect(page.locator('[data-offline-runtime-state]')).toBeVisible();
    const preparedHead = await storedHead(page, credentials.sessionId);
    expect(preparedHead.sequence).toBe(0);
    await assertNativeOffline(browser);
    expect(await page.evaluate(() => navigator.storage.persisted())).toBe(true);

    // Keep the signed metadata record intact and damage only the last media tag.
    // An existing export must not make this incoming file look verified.
    const original = await readFile(bundlePath), duplicate = Buffer.from(original);
    const magicLength = Buffer.byteLength('JUSTKVIZ-OFFLINE/1\n');
    const metadataStart = magicLength + 4 + original.readUInt32BE(magicLength);
    const duplicateHeader = JSON.parse(original.subarray(magicLength + 4, metadataStart));
    assert(duplicateHeader.recordSizes.length > 1);
    const metadataEnd = metadataStart + duplicateHeader.recordSizes[0];
    assert(metadataEnd < duplicate.length - 1);
    duplicate[duplicate.length - 1] ^= 1;
    assert(duplicate.subarray(0, metadataEnd).equals(original.subarray(0, metadataEnd)));
    const duplicatePath = path.join(directory, 'duplicate-tampered-media.justkvizoffline');
    await writeFile(duplicatePath, duplicate, { flag: 'wx' });
    await button(page, 'Zamknout soukromá data').click();
    await page.getByLabel('Heslo offline souboru', { exact: true }).fill(password);
    await page.getByLabel('Načíst offline kvíz', { exact: true }).setInputFiles(duplicatePath);
    await expect(page.locator('[data-offline-error]')).toContainText('Tento večer už je uložený na tomto počítači.');
    await expect(page.getByText('Soubor byl ověřen a uložen.', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-offline-runtime-state]')).toHaveCount(0);
    expect(await storedHead(page, credentials.sessionId)).toEqual(preparedHead);
    await unlock(page, credentials.sessionId);
    await assertNativeOffline(browser);
    expect(await storedHead(page, credentials.sessionId)).toEqual(preparedHead);
    let projector = await openProjector(page);
    const contender = await browser.context.newPage();
    await contender.goto('/offline.html');
    await contender.getByLabel('Heslo offline souboru', { exact: true }).fill(password);
    await contender.locator(`[data-offline-session="${credentials.sessionId}"]`).getByRole('button', { name: 'Odemknout a pokračovat', exact: true }).click();
    await expect(contender.locator('[data-offline-error]')).toContainText('právě ovládá jiné okno');
    expect((await storedHead(page, credentials.sessionId)).sequence).toBe(0);
    await contender.close();
    await confirmed(page, credentials.sessionId, () => button(page, 'Zahájit offline kvíz').click());
    const imageSlide = manifest.slides.find(slide => slide.kind === 'image');
    const navigate = async slide => confirmed(page, credentials.sessionId, () => page.getByRole('combobox', { name: 'Snímek', exact: true }).selectOption(String(slide.position)));
    await navigate(imageSlide);
    await nativeImage(projector, 'question-image', manifest.assets.find(asset => asset.reference === imageSlide.questionImage));
    const backgroundAsset = manifest.assets.find(asset => asset.reference === imageSlide.backgroundImage);
    const logoAsset = manifest.assets.find(asset => asset.reference === imageSlide.design.logoImage);
    expect(backgroundAsset.contentType).toBe('image/webp'); expect(logoAsset.contentType).toBe('image/webp');
    await nativeImage(projector, 'background-image', backgroundAsset);
    await nativeImage(projector, 'logo-image', logoAsset);
    const packets = await page.evaluate(() => window.__offlineQaPackets);
    expect(packets.filter(packet => packet.type === 'asset').some(packet => packet.reference === imageSlide.answerImage)).toBe(false);
    for (const packet of packets.filter(packet => packet.type === 'state')) {
      expect(packet.state).not.toContain('PRIVATE_OFFLINE_ACTUAL_ANSWER'); expect(packet.state).not.toContain('PRIVATE_OFFLINE_ACTUAL_NOTE');
      expect(packet.state).not.toContain(imageSlide.answerImage);
    }
    expect(await projector.evaluate(() => window.__offlineQaIdbOpens)).not.toContain('justkviz-offline-v1');
    await confirmed(page, credentials.sessionId, () => button(page, 'Odhalit odpověď').click());
    await nativeImage(projector, 'answer-image', manifest.assets.find(asset => asset.reference === imageSlide.answerImage));
    for (const slide of manifest.slides.filter(slide => ['audio', 'video'].includes(slide.kind))) {
      await navigate(slide);
      if (slide.kind === 'audio') {
        expect(await projector.locator('audio').count()).toBe(0);
        mediaProofs.push({ kind: slide.kind, ...await runtimeMedia(page, page, credentials.sessionId, 'audio') });
      } else mediaProofs.push({ kind: slide.kind, ...await runtimeMedia(page, projector, credentials.sessionId, 'video') });
    }
    const recapSlide = manifest.slides.find(slide => slide.kind === 'audio');
    await page.getByRole('combobox', { name: 'Otázka pro rekapitulaci', exact: true }).selectOption(String(recapSlide.position));
    await expect(projector.getByText(recapSlide.correctAnswer, { exact: true })).toHaveCount(0);
    const beforeRecap = await page.evaluate(() => window.__offlineQaPackets);
    expect(beforeRecap.some(packet => packet.reference === recapSlide.mediaSource || packet.state?.includes(recapSlide.correctAnswer))).toBe(false);
    await confirmed(page, credentials.sessionId, () => button(page, 'Odhalit vybranou rekapitulaci').click());
    await expect(projector.getByText(recapSlide.correctAnswer, { exact: true })).toBeVisible();
    await expect(page.locator('audio')).toHaveCount(0);
    mediaProofs.push({ kind: 'audio-recap', ...await runtimeMedia(page, projector, credentials.sessionId, 'audio') });
    const recapHead = await storedHead(page, credentials.sessionId);
    await projector.close(); projector = await openProjector(page);
    await expect(projector.getByText(recapSlide.correctAnswer, { exact: true })).toBeVisible();
    expect(await storedHead(page, credentials.sessionId)).toEqual(recapHead);
    await page.getByRole('combobox', { name: 'Kolo', exact: true }).selectOption(manifest.rounds[0].id);
    for (let team = 1; team <= 10; team++) await page.getByLabel(`Body — QA${String(team).padStart(2, '0')}`, { exact: true }).fill(team === 1 ? '0,5' : String(team));
    await confirmed(page, credentials.sessionId, () => button(page, 'Uložit body kola').click());
    await page.getByLabel('Body — QA01', { exact: true }).fill('1');
    await page.getByLabel('Důvod opravy nebo vymazání', { exact: true }).fill('Oprava zkušebního půlbodu');
    await confirmed(page, credentials.sessionId, () => button(page, 'Uložit body kola').click());
    await page.locator('[data-offline-score-history] summary').click();
    await expect(page.locator('[data-offline-score-history]')).toContainText('QA01 — 1 b. · revize 2 · Oprava zkušebního půlbodu');
    for (const [number, count] of [[1, 6], [2, 4]]) {
      await confirmed(page, credentials.sessionId, () => button(page, `Průběžné výsledky · strana ${number}`).click());
      await expect(projector.locator('.sm-row')).toHaveCount(count);
      const rows = await projector.locator('.sm-row').evaluateAll(rows => rows.map(row => ({
        rank: row.querySelector('.sm-rank').textContent, team: row.querySelector('[role="rowheader"]').textContent,
        points: row.querySelector('.sm-points').textContent,
      })));
      const first = (number - 1) * 6;
      expect(rows).toEqual(Array.from({ length: count }, (_, offset) => ({ rank: `${first + offset + 1}.`,
        team: `QA${String(10 - first - offset).padStart(2, '0')}`, points: String(10 - first - offset) })));
      interimPages.push(rows);
    }
    expect(new Set(interimPages.flat().map(row => row.team)).size).toBe(10);
    await confirmed(page, credentials.sessionId, () => button(page, 'Skrýt odpověď a výsledky').click());
    await expect(projector.locator('.sm-row')).toHaveCount(0);
    await navigate(imageSlide); await confirmed(page, credentials.sessionId, () => button(page, 'Odhalit odpověď').click());
    const checkpoint = await storedHead(page, credentials.sessionId);
    observations.push(browser.observations); await browser.context.close();
    await copyClosedProfile(targetProfile, checkpointProfile);
    await stoppedBackends(); browser = await launch(true); page = browser.page; await unlock(page, credentials.sessionId);
    await assertNativeOffline(browser);
    expect(await storedHead(page, credentials.sessionId)).toEqual(checkpoint);
    expect(await page.getByRole('combobox', { name: 'Snímek', exact: true }).inputValue()).toBe(String(imageSlide.position));
    for (let team = 1; team <= 10; team++) await expect(page.getByLabel(`Body — QA${String(team).padStart(2, '0')}`, { exact: true })).toHaveValue(String(team));
    projector = await openProjector(page); await nativeImage(projector, 'answer-image', manifest.assets.find(asset => asset.reference === imageSlide.answerImage));
    await projector.evaluate(foreign => { location.hash = '#/projector/' + foreign; }, credentials.sessionId + '-foreign');
    await expect(projector.getByText(imageSlide.correctAnswer, { exact: true })).toHaveCount(0);
    await projector.evaluate(sessionId => { location.hash = '#/projector/' + sessionId; }, credentials.sessionId);
    await nativeImage(projector, 'answer-image', manifest.assets.find(asset => asset.reference === imageSlide.answerImage));
    await page.getByRole('combobox', { name: 'Kolo', exact: true }).selectOption(manifest.rounds[1].id);
    for (let team = 1; team <= 10; team++) await page.getByLabel(`Body — QA${String(team).padStart(2, '0')}`, { exact: true }).fill(String(11 - team));
    await confirmed(page, credentials.sessionId, () => button(page, 'Uložit body kola').click());
    await expect(page.locator('[data-offline-ranking] li')).toHaveCount(10);
    for (const row of await page.locator('[data-offline-ranking] li').allTextContents()) expect(row).toMatch(/^1\. QA\d{2} — 11 b\.$/u);
    const shown = [];
    for (const [number, count] of [[1, 6], [2, 4]]) {
      await confirmed(page, credentials.sessionId, () => button(page, `Konečné pořadí · strana ${number}`).click());
      await expect(projector.locator('.sm-row')).toHaveCount(count);
      shown.push(...await projector.locator('.sm-row [role="rowheader"]').allTextContents());
    }
    expect(new Set(shown).size).toBe(10);
    await confirmed(page, credentials.sessionId, () => button(page, 'Ukončit offline kvíz').click());
    await page.getByLabel('Heslo pro nový nouzový soubor', { exact: true }).fill(password);
    const [download] = await Promise.all([page.waitForEvent('download'), button(page, 'Stáhnout nouzovou obnovu').click()]);
    await download.saveAs(recoveryPath); expect(await download.failure()).toBeNull();
    const recovery = await inspectOfflineArchive(recoveryPath, password);
    expect(recovery.state.status).toBe('ended'); expect(recovery.state.scores).toHaveLength(20);
    expect(recovery.state.scores.every(score => score.halfPoints !== null)).toBe(true);
    const finalHead = await storedHead(page, credentials.sessionId);
    expect(recovery.state.headHash).toBe(finalHead.headHash);
    observations.push(browser.observations);
    await browser.context.close();
    await copyClosedProfile(checkpointProfile, forkProfile);
    await stoppedBackends();
    browser = await launch(true, checkpointProfile); page = browser.page;
    await unlock(page, credentials.sessionId);
    await assertNativeOffline(browser);
    expect(await storedHead(page, credentials.sessionId)).toEqual(checkpoint);
    await button(page, 'Zamknout soukromá data').click();
    await page.getByLabel('Heslo offline souboru', { exact: true }).fill(password);
    await page.getByLabel('Obnovit existující večer z novějšího nouzového souboru', { exact: true }).check();
    await page.getByLabel('Načíst offline kvíz', { exact: true }).setInputFiles(recoveryPath);
    await expect(page.locator('[data-offline-runtime-state]')).toBeVisible();
    expect(await storedHead(page, credentials.sessionId)).toMatchObject({ sequence: finalHead.sequence, headHash: finalHead.headHash, complete: true });
    for (const [roundIndex, round] of manifest.rounds.entries()) {
      await page.getByRole('combobox', { name: 'Kolo', exact: true }).selectOption(round.id);
      for (let team = 1; team <= 10; team++) await expect(page.getByLabel(`Body — QA${String(team).padStart(2, '0')}`, { exact: true })).toHaveValue(String(roundIndex === 0 ? team : 11 - team));
    }
    const recoveredHead = await storedHead(page, credentials.sessionId);
    await button(page, 'Zamknout soukromá data').click();
    await page.getByLabel('Heslo offline souboru', { exact: true }).fill(password);
    await page.getByLabel('Obnovit existující večer z novějšího nouzového souboru', { exact: true }).check();
    await page.getByLabel('Načíst offline kvíz', { exact: true }).setInputFiles(bundlePath);
    await expect(page.locator('[data-offline-error]')).toContainText('starší než uložený průběh');
    expect(await storedHead(page, credentials.sessionId)).toEqual(recoveredHead);
    observations.push(browser.observations); await browser.context.close();
    await stoppedBackends();
    browser = await launch(true, forkProfile); page = browser.page;
    await unlock(page, credentials.sessionId);
    await assertNativeOffline(browser);
    await page.getByRole('combobox', { name: 'Kolo', exact: true }).selectOption(manifest.rounds[0].id);
    await page.getByLabel('Body — QA01', { exact: true }).fill('1,5');
    await page.getByLabel('Důvod opravy nebo vymazání', { exact: true }).fill('Synthetic independent recovery branch');
    await confirmed(page, credentials.sessionId, () => button(page, 'Uložit body kola').click());
    const forkHead = await storedHead(page, credentials.sessionId);
    await button(page, 'Zamknout soukromá data').click();
    await page.getByLabel('Heslo offline souboru', { exact: true }).fill(password);
    await page.getByLabel('Obnovit existující večer z novějšího nouzového souboru', { exact: true }).check();
    await page.getByLabel('Načíst offline kvíz', { exact: true }).setInputFiles(recoveryPath);
    await expect(page.locator('[data-offline-error]')).toContainText('jiné větvi historie');
    expect(await storedHead(page, credentials.sessionId)).toEqual(forkHead);
    observations.push(browser.observations);
    for (const observation of observations) { expect(observation.successfulNetworkResponses).toBe(0); expect(observation.externalRequests).toBe(0); expect(observation.pageErrors).toEqual([]); expect(observation.nativeOfflineChecks).toBeGreaterThan(0); }
    await stoppedBackends();
    await writeFile(path.join(directory, 'offline-proof.json'), JSON.stringify({ status: 'PASS', phase: 'offline', allFiveBackendsStopped: true,
      browserOffline: true, nativeNavigatorReassertedAfterAppBootChecks: true, completeChromeRestarts: 2, samePersistentNotebookProfile: true,
      realPortableFileImportedWithAllBackendsStopped: true, installedTrustIndependentFromFile: true,
      signedWrongEventRejectedWithoutLocalSession: true, decodedImageRoles: ['question-image', 'background-image', 'logo-image', 'answer-image'],
      tamperedDuplicate: { metadataPrefixUnchanged: true, lastMediaTagDamaged: true, falseSuccessDenied: true, sameHead: true, explicitExistingUnlock: true },
      actualPersisted: true, notebookColdStorage, checkpoint, finalHead,
      explicitAudioRecapAndProjectorReopenPreservedHead: true,
      mediaProofs, concurrentOperatorWindowDenied: true, earlierCheckpointRecoveredThroughActualImport: true,
      olderFileRollbackDenied: true, divergentJournalImportDenied: true, interimPages,
      allTwentyCells: true, teamCount: 10, points: 11, halfPoints: 22, sharedRank: 1, pageSizes: [6, 4],
      recoveryBytes: recovery.fileBytes, recoverySha256: recovery.fileSha256, operations: recovery.metadata.operations.length,
      observations, hardwareProjector: 'NOT_TESTED', hardwareAudio: 'NOT_TESTED; browser launched muted' }, null, 2), { flag: 'wx' });
  } finally { await browser.context.close(); }
}

async function syncPhase() {
  const environment = requireFullEmulatorEnvironment(process.env, 'Offline browser synchronization');
  const credentials = JSON.parse(await readFile(credentialPath, 'utf8'));
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const sdk = require('firebase-admin/app'), server = sdk.initializeApp({ projectId: environment.projectId }, 'offline-browser-verification');
  const db = require('firebase-admin/firestore').getFirestore(server);
  const browser = await launch();
  try {
    await signInOnline(browser.page, credentials);
    await unlock(browser.page, credentials.sessionId);
    const head = await storedHead(browser.page, credentials.sessionId);
    const offline = JSON.parse(await readFile(path.join(directory, 'offline-proof.json'), 'utf8'));
    expect(head).toEqual(offline.finalHead);
    await button(browser.page, 'Porovnat s online stavem').click();
    await expect(browser.page.locator('[data-offline-sync-preview]')).toBeVisible();
    await expect(browser.page.locator('[data-offline-sync-preview] [role="alert"]')).toHaveCount(0);
    const { metadata: { manifest } } = await inspectOfflineArchive(bundlePath, password);
    const record = db.doc(`events/${credentials.eventId}/offlineExports/${manifest.exportId}`);
    expect((await record.get()).get('status')).toBe('prepared');
    let blockedBeforeDelivery = 0;
    const stopBeforeDelivery = async route => {
      if (route.request().method() !== 'POST') return route.continue();
      blockedBeforeDelivery++;
      await route.abort('failed');
    };
    await browser.context.route('**/commitOfflineSync', stopBeforeDelivery);
    try {
      await button(browser.page, 'Potvrdit synchronizaci výsledků').click();
      await expect(browser.page.locator('[data-offline-error]')).toBeVisible();
      expect(blockedBeforeDelivery).toBe(1);
      await expect(browser.page.locator('[data-offline-sync-receipt]')).toHaveCount(0);
      expect(await storedHead(browser.page, credentials.sessionId)).toEqual(head);
      expect((await record.get()).get('status')).toBe('prepared');
      const scoreRefs = await db.collection(`events/${credentials.eventId}/scores`).listDocuments();
      expect(scoreRefs).toHaveLength(0); // Includes missing parents that still have history subcollections.
      expect((await db.doc(`sessions/${credentials.sessionId}`).get()).exists).toBe(false);
      expect((await db.collection(`sessions/${credentials.sessionId}/finalVersions`).get()).size).toBe(0);
    } finally { await browser.context.unroute('**/commitOfflineSync', stopBeforeDelivery); }
    let dropped = false;
    await browser.context.route('**/commitOfflineSync', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch(); expect(response.status()).toBe(200); dropped = true; await route.abort('failed');
    });
    await expect(browser.page.locator('[data-offline-sync-pending]')).toBeVisible();
    await button(browser.page, 'Znovu ověřit synchronizaci').click();
    await expect.poll(() => dropped).toBe(true); await expect(browser.page.locator('[data-offline-error]')).toBeVisible();
    expect((await record.get()).get('status')).toBe('synchronized');
    expect(await storedHead(browser.page, credentials.sessionId)).toEqual(head);
    await browser.context.unroute('**/commitOfflineSync');
    await unlock(browser.page, credentials.sessionId);
    await expect(browser.page.locator('[data-offline-sync-pending]')).toBeVisible();
    await button(browser.page, 'Znovu ověřit synchronizaci').click();
    await expect(browser.page.locator('[data-offline-sync-receipt]')).toBeVisible();
    const scores = await db.collection(`events/${credentials.eventId}/scores`).get(); expect(scores.size).toBe(20);
    let history = 0, corrected = false;
    for (const score of scores.docs) {
      const entries = await score.ref.collection('history').get();
      history += entries.size;
      if (score.get('revision') === 2) {
        expect(score.get('teamId')).toBe(manifest.teams.find(team => team.name === 'QA01').id);
        expect(score.get('roundId')).toBe(manifest.rounds[0].id);
        expect(score.get('halfPoints')).toBe(2);
        expect(entries.size).toBe(2);
        expect(entries.docs.find(row => row.id === '2').get('reason')).toBe('Oprava zkušebního půlbodu');
        corrected = true;
      }
    }
    expect(corrected).toBe(true);
    expect(history).toBe(21);
    const session = (await db.doc('sessions/' + credentials.sessionId).get()).data(); expect(session.status).toBe('ended'); expect(session.finalReveal.visible).toBe(false);
    const versions = await db.collection(`sessions/${credentials.sessionId}/finalVersions`).get(); expect(versions.size).toBe(1);
    expect(versions.docs[0].get('rows').every(row => row.rank === 1 && row.halfPoints === 22)).toBe(true);
    expect((await db.doc('events/' + credentials.eventId).get()).get('lifecycleStatus')).toBe('completed');
    await browser.page.goto(`/admin/events/${credentials.eventId}`);
    await browser.page.getByRole('link', { name: 'Otevřít konečné výsledky', exact: true }).click();
    const onlineRows = browser.page.getByRole('region', { name: 'Historické konečné pořadí' }).locator('tbody tr');
    await expect(onlineRows).toHaveCount(10);
    const resultRows = await onlineRows.evaluateAll(rows => rows.map(row => Array.from(row.cells, cell => cell.textContent)));
    expect(resultRows.sort((a, b) => a[1].localeCompare(b[1]))).toEqual(Array.from({ length: 10 }, (_, index) => ['1.', `QA${String(index + 1).padStart(2, '0')}`, '11']));
    await writeFile(path.join(directory, 'sync-proof.json'), JSON.stringify({ status: 'PASS', phase: 'sync', actualImportedEmulatorData: true,
      freshOnlineModeratorLogin: true,
      interruptedBeforeDelivery: { requests: blockedBeforeDelivery, sameLocalHead: true, serverExportStillPrepared: true, newScores: 0, newHistory: 0, newFinalVersions: 0 },
      lostAcknowledgementAfterActualServerCommit: true, reopenedAfterDroppedAcknowledgement: true, actualUiRetry: true, scoreCells: scores.size, historyMutations: history,
      finalVersions: versions.size, rows: 10, points: 11, halfPoints: 22, sharedRank: 1, actualOnlineHistoryTable: true }, null, 2), { flag: 'wx' });
  } finally { await browser.context.close(); await sdk.deleteApp(server); }
}

async function cleanupPhase() {
  const results = [];
  // Only the two exact freshly installed profiles. Closed checkpoint/fork copies
  // remain intact for subsequent durability evidence and are never uninstalled.
  for (const [name, profile] of [['p', producerProfile], ['t', targetProfile]]) {
    try { await access(nativeRecord(name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const browser = await launch(false, profile);
    try { results.push(await uninstallOwnedOfflineApp({ context: browser.context, profile, recordPath: nativeRecord(name) })); }
    catch (error) { results.push({ profile, status: 'FAIL', error: error.message }); }
    finally { await browser.context.close(); }
  }
  const status = results.some(result => result.status === 'FAIL') ? 'FAIL' : 'PASS';
  await writeFile(path.join(directory, 'cleanup-proof.json'), JSON.stringify({ status, phase: 'cleanup', results,
    closedCheckpointAndForkProfilesPreserved: true, defaultHandlersChanged: false }, null, 2), { flag: 'wx' });
  assert.equal(status, 'PASS', 'Own native app cleanup must succeed; inspect phase-owned cleanup proof.');
}

test(`complete offline event: ${phase ?? 'EXPLICIT_PHASE_REQUIRED'}`, async () => {
  assert(['prepare', 'offline', 'sync', 'cleanup'].includes(phase), 'Set OFFLINE_QA_PHASE explicitly; orchestration owns emulator lifecycle.');
  if (phase === 'prepare') await preparePhase(); else if (phase === 'offline') await offlinePhase(); else if (phase === 'sync') await syncPhase(); else await cleanupPhase();
});
