/* global window */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { mediaFixture, syntheticImage } from '../e2e/media-fixture.mjs';
import { localEmulatorEndpoint, requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const projectId = 'demo-filmovy-kviz-v2';
const hosting = 'http://127.0.0.1:5000';
const functions = 'http://127.0.0.1:5001';
const callablePrefix = `/${projectId}/europe-west1/`;
const manifestCallable = 'readLocalEventMediaManifest';
const gatewayPath = `${callablePrefix}readQuizMedia`;
const allowedOrigins = new Set([hosting, functions, 'http://127.0.0.1:8080', 'http://127.0.0.1:9099']);
const privateAnswer = 'Syntetická odpověď pouze pro zálohový test';
const privateNote = 'Syntetická soukromá poznámka pouze pro zálohový test';
const extension = '.justkvizbackup';

function requireBackupEmulators(baseURL) {
  const { projectId: configuredProject, authEndpoint, firestoreEndpoint, functionsEndpoint } =
    requireFullEmulatorEnvironment(process.env, 'Local media backup');
  const storageEndpoint = localEmulatorEndpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Local media backup Storage');
  if (baseURL !== hosting || configuredProject !== projectId || authEndpoint.port !== 9099 ||
    firestoreEndpoint.port !== 8080 || functionsEndpoint.port !== 5001 || storageEndpoint.port !== 9199) {
    throw new Error('Local media backup browser tests require the dedicated demo project and its loopback emulator ports.');
  }
}

async function allowEmulatorsOnly(context) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return allowedOrigins.has(url.origin) ? route.continue() : route.abort('blockedbyclient');
  });
}

function isGateway(url) {
  return url.origin === functions && url.pathname === gatewayPath;
}

function isManifest(url) {
  return url.origin === functions && url.pathname === `${callablePrefix}${manifestCallable}`;
}

async function createBackupFixture() {
  const fixture = await mediaFixture();
  try {
    const promptBytes = syntheticImage();
    const answerPng = new PNG({ width: 7, height: 3 });
    for (let i = 0; i < answerPng.data.length; i += 4) {
      answerPng.data.set([190, 10, 40, 255], i);
    }
    const answerBytes = PNG.sync.write(answerPng);
    const prompt = await fixture.upload('image', promptBytes, 'image/png');
    const answer = await fixture.upload('image', answerBytes, 'image/png');
    await fixture.update('image', {
      questionImage: prompt.reference, answerImage: answer.reference, correctAnswer: privateAnswer, moderatorNote: privateNote,
    });
    const snapshotId = await fixture.lock();
    const stored = (await fixture.db.doc(`quizSnapshots/${snapshotId}/slides/${fixture.ids.image}`).get()).data();
    expect(stored).toMatchObject({ questionImage: prompt.reference, answerImage: answer.reference, correctAnswer: privateAnswer });
    return { fixture, snapshotId, prompt, promptBytes, answer, answerBytes };
  } catch (error) {
    await fixture.dispose();
    throw error;
  }
}

async function openEvent(page, fixture) {
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill(fixture.loginEmail);
  await page.getByLabel('Heslo').fill(fixture.loginPassword);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page).toHaveURL(/\/admin$/u);
  await goToEvent(page, fixture);
}

async function goToEvent(page, fixture) {
  await page.goto(`/admin/events/${fixture.eventId}?backupPilot=1`);
  await expect(page.getByRole('heading', { name: 'Místní zkušební balíček médií', exact: true })).toBeVisible();
}

const status = page => page.locator('[data-local-event-media-status]');
const prepare = page => page.getByRole('button', { name: 'Připravit místní zálohu', exact: true });
const save = page => page.getByRole('button', { name: 'Uložit zkušební balíček', exact: true });
const openFile = page => page.getByLabel('Otevřít zkušební balíček', { exact: true });
const assertStatus = (page, value) => expect(status(page)).toHaveAttribute('data-local-event-media-status', value);

test('requires scoped export permission and returns only the frozen approved prompt asset', async ({ baseURL }) => {
  requireBackupEmulators(baseURL);
  const { fixture, snapshotId, prompt, promptBytes, answer, answerBytes } = await createBackupFixture();
  try {
    const manifest = await fixture.admin.call(manifestCallable, { eventId: fixture.eventId });
    const { quizRevision } = (await fixture.eventRef.get()).data().quizAssignment;
    const asset = (await fixture.db.doc(`quizzes/${fixture.quizId}/mediaAssets/${prompt.assetId}`).get()).data();
    expect(manifest).toEqual({
      schemaVersion: 1, eventId: fixture.eventId, snapshotId, quizRevision,
      validUntilMs: expect.any(Number), scopeKey: expect.any(String),
      media: {
        role: 'question-image', reference: prompt.reference, generation: asset.generation,
        contentType: 'image/png', size: promptBytes.length,
        sha256: createHash('sha256').update(promptBytes).digest('hex'), etag: expect.any(String),
      },
      missing: 0, excluded: expect.any(Number),
    });
    expect(manifest.validUntilMs).toBeGreaterThan(Date.now());
    expect(manifest.scopeKey.length).toBeGreaterThan(0);
    expect(manifest.excluded).toBeGreaterThan(0);
    const encoded = JSON.stringify(manifest);
    for (const secret of [answer.reference, answerBytes.toString('base64'), privateAnswer, privateNote]) {
      expect(encoded.includes(secret)).toBe(false);
    }

    const reader = await fixture.roleClient('moderator');
    const memberRef = fixture.db.doc(`memberships/${reader.auth.currentUser.uid}`);
    const member = (await memberRef.get()).data();
    await memberRef.update({ permissions: member.permissions.filter(permission => permission !== 'event.export'), version: member.version + 1 });
    const readable = await reader.call('readAccessData', { operation: 'snapshotSlides', snapshotId });
    expect(readable.length).toBeGreaterThan(0);
    await expect(reader.call(manifestCallable, { eventId: fixture.eventId })).rejects.toMatchObject({ code: 'functions/permission-denied' });
    await memberRef.update({ permissions: member.permissions, events: { mode: 'none', ids: [] }, version: member.version + 2 });
    await expect(reader.call(manifestCallable, { eventId: fixture.eventId })).rejects.toMatchObject({ code: 'functions/permission-denied' });
    await expect(fixture.anonymous.call(manifestCallable, { eventId: fixture.eventId })).rejects.toMatchObject({ code: 'functions/unauthenticated' });

    const { startsAt } = (await fixture.eventRef.get()).data();
    await fixture.eventRef.update({ startsAt: new Date(Date.now() - 7 * 60 * 60_000) });
    try {
      await expect(fixture.admin.call(manifestCallable, { eventId: fixture.eventId })).rejects.toMatchObject({ code: 'functions/failed-precondition' });
    } finally {
      await fixture.eventRef.update({ startsAt });
    }

    const updateImage = answerReference => fixture.update('image', {
      questionImage: prompt.reference, answerImage: answerReference, correctAnswer: privateAnswer, moderatorNote: privateNote,
    });
    await updateImage(prompt.reference);
    const sharedSnapshot = await fixture.lock();
    const shared = (await fixture.db.doc(`quizSnapshots/${sharedSnapshot}/slides/${fixture.ids.image}`).get()).data();
    expect(shared).toMatchObject({ questionImage: prompt.reference, answerImage: prompt.reference });
    const noDualUse = await fixture.admin.call(manifestCallable, { eventId: fixture.eventId });
    expect(noDualUse).toMatchObject({ snapshotId: sharedSnapshot, media: null, missing: 1 });
    expect(JSON.stringify(noDualUse).includes(prompt.reference)).toBe(false);

    await updateImage(answer.reference);
    await fixture.lock();
    const sessionId = await fixture.live();
    await fixture.navigate(sessionId, 3);
    const rawPublic = JSON.stringify((await fixture.db.doc(`publicSessions/${sessionId}`).get()).data());
    expect(rawPublic.includes(answer.reference)).toBe(false);
    expect(rawPublic.includes(privateAnswer)).toBe(false);
    const denied = await fixture.read(answer.reference, { sessionId });
    expect(denied.status).toBe(404);
    expect((await denied.arrayBuffer()).byteLength).toBe(0);
  } finally {
    await fixture.dispose();
  }
});

test('downloads real bytes, reopens from disk in another browser process and rejects tampering or wrong binding', async ({ baseURL }, testInfo) => {
  test.setTimeout(180_000);
  requireBackupEmulators(baseURL);
  const { fixture, snapshotId, prompt, promptBytes, answer, answerBytes } = await createBackupFixture();
  let otherFixture;
  let browser;
  try {
    const launch = () => chromium.launch(testInfo.project.use.launchOptions);
    browser = await launch();
    let context = await browser.newContext({ baseURL, acceptDownloads: true, serviceWorkers: 'block' });
    await allowEmulatorsOnly(context);
    await context.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
    });
    let page = await context.newPage();
    await openEvent(page, fixture);

    const reads = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && isGateway(url) && url.searchParams.has('snapshotId')) reads.push(url.searchParams.get('reference'));
    });
    const [response] = await Promise.all([
      page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === 'GET' && isGateway(url) && url.searchParams.get('reference') === prompt.reference &&
          url.searchParams.get('snapshotId') === snapshotId;
      }),
      prepare(page).click(),
    ]);
    await assertStatus(page, 'prepared');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.body()).toEqual(promptBytes);
    const requestHeaders = await response.request().allHeaders();
    expect(requestHeaders.authorization?.startsWith('Bearer ')).toBe(true);
    expect(requestHeaders.range).toBeUndefined();
    expect(reads).toEqual([prompt.reference]);

    const [download] = await Promise.all([page.waitForEvent('download'), save(page).click()]);
    expect(download.suggestedFilename()).toMatch(/\.justkvizbackup$/u);
    expect(await download.failure()).toBeNull();
    const diskPath = testInfo.outputPath(`approved-demo${extension}`);
    await download.saveAs(diskPath);
    await assertStatus(page, 'downloaded');
    const archived = await readFile(diskPath);
    expect(archived.subarray(-promptBytes.length)).toEqual(promptBytes);
    for (const secret of [Buffer.from(answer.reference), answerBytes, Buffer.from(privateAnswer), Buffer.from(privateNote)]) {
      expect(archived.includes(secret)).toBe(false);
    }
    await browser.close();
    browser = undefined;

    const tampered = Buffer.from(archived);
    tampered[tampered.length - 1] ^= 1;
    expect(tampered.length).toBe(archived.length);
    const tamperedPath = testInfo.outputPath(`tampered-demo${extension}`);
    await writeFile(tamperedPath, tampered);

    browser = await launch();
    context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
    await allowEmulatorsOnly(context);
    page = await context.newPage();
    await openEvent(page, fixture);
    await assertStatus(page, 'idle');
    let mediaReadsDuringOpen = 0;
    await page.route(isGateway, route => {
      if (route.request().method() === 'GET') mediaReadsDuringOpen++;
      return route.abort('connectionfailed');
    });
    const [freshManifest] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'POST' && isManifest(new URL(response.url()))),
      openFile(page).setInputFiles(diskPath),
    ]);
    expect(freshManifest.ok()).toBe(true);
    await assertStatus(page, 'ready');
    expect(mediaReadsDuringOpen).toBe(0);
    await openFile(page).setInputFiles(tamperedPath);
    await assertStatus(page, 'corrupt');
    expect(mediaReadsDuringOpen).toBe(0);

    const failManifest = route => route.request().method() === 'POST'
      ? route.abort('connectionfailed') : route.fallback();
    await page.route(isManifest, failManifest);
    await Promise.all([
      page.waitForEvent('requestfailed', { predicate: request => request.method() === 'POST' && isManifest(new URL(request.url())) }),
      openFile(page).setInputFiles(diskPath),
    ]);
    await assertStatus(page, 'invalid');
    await page.unroute(isManifest, failManifest);

    const other = await createBackupFixture();
    otherFixture = other.fixture;
    await goToEvent(page, otherFixture);
    await openFile(page).setInputFiles(diskPath);
    await assertStatus(page, 'invalid');

    const replacementSnapshot = await fixture.lock();
    expect(replacementSnapshot).not.toBe(snapshotId);
    await goToEvent(page, fixture);
    await openFile(page).setInputFiles(diskPath);
    await assertStatus(page, 'invalid');
    expect(mediaReadsDuringOpen).toBe(0);
    await testInfo.attach('local-backup-round-trip', {
      body: JSON.stringify({ realGatewayPng: true, realDownloadAndNewBrowserOpen: true, sameLengthTamperRejected: true, failedFreshManifestRejected: true, wrongEventRejected: true, staleSnapshotRejected: true }),
      contentType: 'application/json',
    });
  } finally {
    await browser?.close();
    await otherFixture?.dispose();
    await fixture.dispose();
  }
});

test('keeps a prepared backup retryable after quota failure or interruption in the native writer', async ({ context, page, baseURL }, testInfo) => {
  requireBackupEmulators(baseURL);
  const { fixture, snapshotId, prompt, promptBytes } = await createBackupFixture();
  try {
    await allowEmulatorsOnly(context);
    await context.addInitScript(() => {
      const control = { mode: 'quota', calls: [], saved: null, releaseRead: null };
      window.syntheticBackupWriter = control;
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async () => {
          control.calls.push('picker');
          return {
            createWritable: async () => {
              control.calls.push('createWritable');
              const parts = [];
              return {
                write: async data => {
                  control.calls.push('write');
                  if (control.mode === 'quota') throw new DOMException('Synthetic storage quota exceeded.', 'QuotaExceededError');
                  parts.push(data);
                },
                close: async () => {
                  control.calls.push('close');
                  if (control.mode === 'interrupted') throw new DOMException('Synthetic save interruption.', 'AbortError');
                  control.saved = new File(parts, 'synthetic.justkvizbackup', { type: 'application/octet-stream' });
                  control.calls.push('commit');
                },
                abort: async () => { control.calls.push('abort'); parts.length = 0; },
              };
            },
            getFile: async () => {
              control.calls.push('read-back');
              await new Promise(resolve => { control.releaseRead = resolve; });
              return control.saved;
            },
          };
        },
      });
    });
    const calls = () => page.evaluate(() => window.syntheticBackupWriter.calls);
    const mode = value => page.evaluate(next => { window.syntheticBackupWriter.mode = next; }, value);
    await openEvent(page, fixture);

    const matchPrompt = url => isGateway(url) && url.searchParams.get('reference') === prompt.reference &&
      url.searchParams.get('snapshotId') === snapshotId;
    let corruptedResponses = 0;
    const corruptGatewayBody = async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const upstream = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
      try {
        expect(upstream.status()).toBe(200);
        const modified = await upstream.body();
        expect(modified).toEqual(promptBytes);
        modified[modified.length - 1] ^= 1;
        corruptedResponses++;
        await route.fulfill({ response: upstream, body: modified });
      } finally {
        await upstream.dispose();
      }
    };
    await page.route(matchPrompt, corruptGatewayBody);
    await prepare(page).click();
    await assertStatus(page, 'error');
    expect(corruptedResponses).toBe(1);
    await expect(save(page)).toBeDisabled();
    expect(await calls()).toEqual([]);
    await page.unroute(matchPrompt, corruptGatewayBody);

    await prepare(page).click();
    await assertStatus(page, 'prepared');

    await save(page).click();
    await expect.poll(calls).toEqual(['picker', 'createWritable', 'write', 'abort']);
    await assertStatus(page, 'prepared');

    await mode('interrupted');
    await save(page).click();
    await expect.poll(calls).toEqual([
      'picker', 'createWritable', 'write', 'abort',
      'picker', 'createWritable', 'write', 'close', 'abort',
    ]);
    await assertStatus(page, 'prepared');

    await mode('healthy');
    await save(page).click();
    await expect.poll(calls).toEqual([
      'picker', 'createWritable', 'write', 'abort',
      'picker', 'createWritable', 'write', 'close', 'abort',
      'picker', 'createWritable', 'write', 'close', 'commit', 'read-back',
    ]);
    await expect(status(page)).not.toHaveAttribute('data-local-event-media-status', 'ready');
    await page.evaluate(() => { window.syntheticBackupWriter.releaseRead(); });
    await assertStatus(page, 'ready');
    await testInfo.attach('local-backup-writer-failures', {
      body: JSON.stringify({ tamperedGatewayBytesRejected: true, quotaWriteAborted: true, interruptedCloseAborted: true, explicitRetryCommitted: true, readyRequiresReopen: true }),
      contentType: 'application/json',
    });
  } finally {
    await fixture.dispose();
  }
});
