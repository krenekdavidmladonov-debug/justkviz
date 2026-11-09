/* global indexedDB, window, IDBDatabase, IDBObjectStore */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { inspectOfflineArchive } from './offline-archive-fixture.mjs';
import { nativeStorageState } from './offline-native-app-fixture.mjs';

const origin = 'http://127.0.0.1:5000';
const directory = path.resolve(process.env.OFFLINE_DURABILITY_RUN_DIR ?? '.local-data/offline-v1/UNCONFIGURED');
const profileRoot = path.resolve(process.env.OFFLINE_DURABILITY_PROFILE_ROOT ?? path.join(directory, 'OWN_PROFILE_REQUIRED'));
assert(directory.startsWith(path.resolve('.local-data/offline-v1') + path.sep));
assert(/^dp-[a-f0-9]{8}$/u.test(path.relative(path.resolve('.local-data'), profileRoot)));
const input = JSON.parse(await readFile(path.join(directory, 'input.json'), 'utf8'));
const password = 'synthetic-complete-offline-password';
const button = (page, name) => page.getByRole('button', { name, exact: true });

async function launch(name, fixedTime) {
  assert(['q', 'a', 'c', 'e', 'm'].includes(name));
  const context = await chromium.launchPersistentContext(path.join(profileRoot, name), {
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    headless: true, offline: true, serviceWorkers: 'allow', acceptDownloads: true,
    viewport: { width: 1366, height: 768 }, args: ['--mute-audio'],
  });
  try {
    const browserVersion = context.browser()?.version();
    if (!process.env.OFFLINE_DURABILITY_BROWSER_VERSION || browserVersion !== process.env.OFFLINE_DURABILITY_BROWSER_VERSION) {
      throw new Error('Durability must use the same Chromium version as the accepted core run.');
    }
    const observations = { browserVersion, externalRequests: 0, successfulNetworkResponses: 0, serviceWorkerResponses: 0, pageErrors: [] };
    context.on('page', page => page.on('pageerror', error => observations.pageErrors.push(error.message)));
    context.on('response', response => {
      if (response.url().startsWith('http') && response.status() < 400) {
        if (response.fromServiceWorker()) observations.serviceWorkerResponses++;
        else observations.successfulNetworkResponses++;
      }
    });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { observations.externalRequests++; return route.abort('blockedbyclient'); }
      return route.continue();
    });
    const page = context.pages()[0] ?? await context.newPage();
    page.on('pageerror', error => observations.pageErrors.push(error.message));
    if (fixedTime !== undefined) await page.clock.setFixedTime(fixedTime);
    await page.goto(origin + '/offline.html');
    const storage = await nativeStorageState(page);
    expect(storage).toEqual({ permission: 'granted', persistedBefore: true, persistResult: null, persistedAfter: true });
    observations.coldPersistedBeforeAnyPersistCall = storage.persistedBefore;
    observations.coldPermission = storage.permission;
    observations.coldSentinelSha256 = await page.evaluate(() => new Promise((resolve, reject) => {
      const opening = indexedDB.open('justkviz-qa-native-consent', 1);
      opening.onupgradeneeded = () => opening.transaction.abort();
      opening.onerror = () => reject(new Error('Cold copy has no original notebook sentinel database.'));
      opening.onsuccess = () => {
        const database = opening.result, transaction = database.transaction('proof'), read = transaction.objectStore('proof').get('sentinel');
        read.onerror = () => reject(new Error('Cannot read the original notebook sentinel.'));
        read.onsuccess = () => {
          if (typeof read.result !== 'string') { reject(new Error('Original notebook sentinel is absent.')); return; }
          void crypto.subtle.digest('SHA-256', new TextEncoder().encode(read.result)).then(digest => {
            resolve(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''));
          }, reject);
        };
        transaction.oncomplete = () => database.close();
      };
    }));
    expect(observations.coldSentinelSha256).toBe(input.notebookSentinelSha256);
    return { context, page, observations };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function checkpoint(page) {
  return page.evaluate(sessionId => new Promise((resolve, reject) => {
    const opening = indexedDB.open('justkviz-offline-v1', 1);
    opening.onerror = () => reject(new Error('Cannot read own durability checkpoint.'));
    opening.onsuccess = () => {
      const db = opening.result, tx = db.transaction('sessions'), request = tx.objectStore('sessions').get(sessionId);
      request.onerror = () => reject(new Error('Cannot inspect own progress.'));
      request.onsuccess = () => {
        const row = request.result;
        if (!row) { resolve(null); return; }
        void crypto.subtle.digest('SHA-256', row.encrypted.bytes).then(bytes => resolve({
          sequence: row.sequence, headHash: row.headHash, complete: row.complete,
          encryptedSha256: Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''),
        }), reject);
      };
      tx.oncomplete = () => db.close();
    };
  }), input.sessionId);
}

async function unlockExisting(page) {
  await page.getByLabel('Heslo offline souboru', { exact: true }).fill(password);
  await page.locator(`[data-offline-session="${input.sessionId}"]`).getByRole('button', { name: 'Odemknout a pokračovat', exact: true }).click();
}

async function unlock(page) {
  await unlockExisting(page);
  await expect(page.locator('[data-offline-runtime-state]')).toBeVisible();
  await expect(page.locator('[data-offline-runtime-state]')).toContainText('Offline režim aktivní');
}

function offlineProof(observations) {
  expect(observations.browserVersion).toBe(process.env.OFFLINE_DURABILITY_BROWSER_VERSION);
  expect(observations.coldPersistedBeforeAnyPersistCall).toBe(true);
  expect(observations.coldPermission).toBe('granted');
  expect(observations.coldSentinelSha256).toBe(input.notebookSentinelSha256);
  expect(observations.externalRequests).toBe(0);
  expect(observations.successfulNetworkResponses).toBe(0);
  expect(observations.pageErrors).toEqual([]);
}

async function saveProof(name, proof) {
  await writeFile(path.join(directory, name + '-proof.json'), JSON.stringify({ status: 'PASS', ...proof }, null, 2), { flag: 'wx' });
}

async function clearPrivateData(page) {
  // Only the owned clone loses its sessions/records. The real shell and trust stay.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open('justkviz-offline-v1', 1);
    opening.onerror = () => reject(new Error('Cannot prepare owned empty profile.'));
    opening.onsuccess = () => {
      const database = opening.result, transaction = database.transaction(['sessions', 'records'], 'readwrite', { durability: 'strict' });
      transaction.objectStore('sessions').clear();
      transaction.objectStore('records').clear();
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(new Error('Own empty-profile setup did not commit.')); };
    };
  }));
  await page.reload();
  await expect(page.locator('[data-offline-session]')).toHaveCount(0);
}

test('a simulated low storage estimate prevents real package import from claiming READY', async () => {
  const browser = await launch('q');
  try {
    await clearPrivateData(browser.page);
    await browser.page.evaluate(() => {
      const storage = navigator.storage, original = storage.estimate;
      if (Object.hasOwn(storage, 'estimate')) throw new Error('Expected the native prototype storage estimator.');
      const observed = [];
      Object.defineProperty(storage, 'estimate', { configurable: true, async value() {
        const actual = await Reflect.apply(original, storage, []);
        const simulated = { ...actual, quota: actual.usage ?? 0 };
        observed.push({ nativeQuota: actual.quota, nativeUsage: actual.usage, reportedQuota: simulated.quota });
        return simulated;
      } });
      window.__durabilityEstimate = { restore() {
        Reflect.deleteProperty(storage, 'estimate');
        if (storage.estimate !== original) throw new Error('Could not restore the native storage estimator.');
        return observed;
      } };
    });
    await browser.page.getByLabel('Heslo offline souboru', { exact: true }).fill(password);
    await browser.page.getByLabel('Načíst offline kvíz', { exact: true }).setInputFiles(input.bundlePath);
    await expect(browser.page.locator('[data-offline-error]')).toContainText('dostatek volného místa');
    await expect(browser.page.locator('[data-offline-runtime-state]')).toHaveCount(0);
    await expect(browser.page.locator('[data-offline-session]')).toHaveCount(0);
    expect(await checkpoint(browser.page)).toBeNull();
    const observed = await browser.page.evaluate(() => window.__durabilityEstimate.restore());
    expect(observed).toHaveLength(1);
    expect(observed[0].nativeQuota - observed[0].nativeUsage).toBeGreaterThan(16 * 1024 * 1024);
    expect(observed[0].reportedQuota).toBe(observed[0].nativeUsage);
    await browser.page.getByLabel('Načíst offline kvíz', { exact: true }).setInputFiles(input.bundlePath);
    await expect(browser.page.locator('[data-offline-runtime-state]')).toContainText('Připraveno pro hraní bez internetu');
    expect((await checkpoint(browser.page)).sequence).toBe(0);
    offlineProof(browser.observations);
    await saveProof('quota', { simulatedEstimateOnly: true, simulatedAvailableBytes: 0, observed,
      preparedPackageImportDeniedWithoutReady: true, noNewPrivateSessionDuringFailure: true,
      restoredNativeEstimatorThenSamePackageImported: true, observations: browser.observations,
      limitation: 'Explicit fault injection changes only the quota reported by StorageManager.estimate. Actual native quota exhaustion was not reproduced.' });
  } finally {
    await browser.context.close();
  }
});

async function assertRecoveryOnly(page, message) {
  await expect(page.locator('[data-offline-readiness-error]')).toContainText(message);
  await expect(page.locator('[data-offline-runtime-state]')).toContainText('Uložený průběh je otevřený pro obnovu');
  await expect(page.getByText('Připraveno pro hraní bez internetu', { exact: false })).toHaveCount(0);
  await expect(button(page, 'Otevřít offline projektor')).toBeDisabled();
  await expect(button(page, 'Přehrát ukázku')).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Snímek', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Body — QA01', { exact: true })).toBeDisabled();
  await expect(page.locator('.offline-preview')).toHaveCount(0);
}

test('expired pending grant opens recovery only after cold restart and cannot start or project', async () => {
  let browser = await launch('e');
  const observations = [];
  try {
    assert(Number.isSafeInteger(input.expiresAtMs) && input.expiresAtMs > Date.now());
    await clearPrivateData(browser.page);
    await browser.page.getByLabel('Heslo offline souboru', { exact: true }).fill(password);
    await browser.page.getByLabel('Načíst offline kvíz', { exact: true }).setInputFiles(input.bundlePath);
    await expect(browser.page.locator('[data-offline-runtime-state]')).toContainText('Připraveno pro hraní bez internetu');
    await expect(button(browser.page, 'Zahájit offline kvíz')).toBeEnabled();
    const before = await checkpoint(browser.page);
    expect(before.sequence).toBe(0);
    observations.push(browser.observations); await browser.context.close();
    // Advance only this fresh page's JS clock past the real signed expiry.
    const fixedTime = input.expiresAtMs + 1;
    browser = await launch('e', fixedTime);
    expect(await browser.page.evaluate(() => Date.now())).toBe(fixedTime);
    await unlockExisting(browser.page);
    await assertRecoveryOnly(browser.page, 'Offline oprávnění k hraní vypršelo.');
    await expect(button(browser.page, 'Zahájit offline kvíz')).toBeDisabled();
    expect(browser.context.pages()).toHaveLength(1);
    expect(await checkpoint(browser.page)).toEqual(before);
    observations.push(browser.observations); observations.forEach(offlineProof);
    await saveProof('expiry', { actualSignedPendingPackageImportedBeforeExpiry: true, coldChromeRestart: true,
      fixedTestPageClockMs: fixedTime, signedExpiryMs: input.expiresAtMs, recoveryOnly: true,
      startAndProjectionBlocked: true, exactOriginalJournalPreserved: true, checkpoint: before, observations,
      limitation: 'Only Playwright page.clock is advanced. The OS clock and signed package are unchanged.' });
  } finally { await browser.context.close(); }
});

test('one missing native media record after restart disables play but retains the existing journal', async () => {
  let browser = await launch('m');
  const observations = [];
  try {
    await unlock(browser.page);
    const before = await checkpoint(browser.page);
    expect(before.sequence).toBeGreaterThan(0);
    await button(browser.page, 'Zamknout soukromá data').click();
    const removed = await browser.page.evaluate(sessionId => new Promise((resolve, reject) => {
      const opening = indexedDB.open('justkviz-offline-v1', 1);
      opening.onerror = () => reject(new Error('Cannot open own missing-media clone.'));
      opening.onsuccess = () => {
        const database = opening.result, transaction = database.transaction(['sessions', 'records'], 'readwrite', { durability: 'strict' });
        const session = transaction.objectStore('sessions').get(sessionId), records = transaction.objectStore('records');
        let proof;
        session.onsuccess = () => {
          const row = session.result, length = row?.header?.recordSizes?.[1];
          if (!Number.isSafeInteger(length) || length < 17) { transaction.abort(); return; }
          const key = `${row.archiveId ?? row.sessionId}:1`, read = records.get(key);
          read.onsuccess = () => {
            if (!(read.result instanceof Blob) || read.result.size !== length) { transaction.abort(); return; }
            records.delete(key);
            proof = { recordIndex: 1, bytes: length };
          };
        };
        transaction.oncomplete = () => { database.close(); resolve(proof); };
        transaction.onabort = () => { database.close(); reject(new Error('Own native media deletion did not commit.')); };
      };
    }), input.sessionId);
    expect(removed.recordIndex).toBe(1);
    expect(await checkpoint(browser.page)).toEqual(before);
    observations.push(browser.observations); await browser.context.close();
    browser = await launch('m');
    await unlockExisting(browser.page);
    await assertRecoveryOnly(browser.page, 'Část místní zálohy chybí nebo byla odstraněna.');
    expect(browser.context.pages()).toHaveLength(1);
    expect(await checkpoint(browser.page)).toEqual(before);
    observations.push(browser.observations); observations.forEach(offlineProof);
    await saveProof('missing-media', { actualNativeStrictRecordDeletion: removed, coldChromeRestart: true, correctPassword: true,
      recoveryOnly: true, projectionAndScoringBlocked: true, exactOriginalJournalPreserved: true, checkpoint: before, observations });
  } finally { await browser.context.close(); }
});

test('abort one actual native sessions transaction: no ACK, exact restart state, one legitimate retry', async () => {
  let browser = await launch('a');
  const observations = [];
  try {
    await unlock(browser.page);
    await browser.page.getByRole('combobox', { name: 'Kolo', exact: true }).selectOption(input.firstRoundId);
    const before = await checkpoint(browser.page);
    const points = browser.page.getByLabel('Body — QA01', { exact: true });
    const oldValue = await points.inputValue();
    assert(/^\d+(?:[.,][05])?$/u.test(oldValue));
    const newHalfPoints = Number(oldValue.replace(',', '.')) * 2 + 1;
    assert(Number.isSafeInteger(newHalfPoints));
    const newValue = String(newHalfPoints / 2).replace('.', ',');
    const injection = await browser.page.evaluate(() => {
      const transaction = IDBDatabase.prototype.transaction, put = IDBObjectStore.prototype.put;
      let target = null, armed = true;
      const state = window.__durabilityFault = { abortCount: 0, putSucceededBeforeAbort: false };
      IDBDatabase.prototype.transaction = function (...args) {
        const tx = Reflect.apply(transaction, this, args);
        if (armed && this.name === 'justkviz-offline-v1' && args[1] === 'readwrite'
          && Array.from(tx.objectStoreNames).includes('sessions')) { target = tx; armed = false; }
        return tx;
      };
      IDBObjectStore.prototype.put = function (...args) {
        const request = Reflect.apply(put, this, args);
        if (this.name === 'sessions' && this.transaction === target) {
          request.addEventListener('success', () => {
            state.putSucceededBeforeAbort = true;
            target.abort(); state.abortCount++;
            IDBDatabase.prototype.transaction = transaction; IDBObjectStore.prototype.put = put;
          }, { once: true });
        }
        return request;
      };
      return { armedForOnlyOneSessionsTransaction: true };
    });
    await points.fill(newValue);
    await browser.page.getByLabel('Důvod opravy nebo vymazání', { exact: true }).fill('Synthetic native transaction abort probe');
    await button(browser.page, 'Uložit body kola').click();
    await expect(browser.page.locator('[data-offline-error]')).toContainText('Zápis nebyl potvrzen');
    const fault = await browser.page.evaluate(() => window.__durabilityFault);
    expect(fault).toEqual({ abortCount: 1, putSucceededBeforeAbort: true });
    expect(await checkpoint(browser.page)).toEqual(before);
    await expect(browser.page.getByText('Body jsou odolně uložené na tomto počítači.', { exact: true })).toHaveCount(0);
    observations.push(browser.observations); await browser.context.close();
    browser = await launch('a'); await unlock(browser.page);
    await browser.page.getByRole('combobox', { name: 'Kolo', exact: true }).selectOption(input.firstRoundId);
    expect(await checkpoint(browser.page)).toEqual(before);
    await expect(browser.page.getByLabel('Body — QA01', { exact: true })).toHaveValue(oldValue);
    await browser.page.getByLabel('Body — QA01', { exact: true }).fill(newValue);
    await browser.page.getByLabel('Důvod opravy nebo vymazání', { exact: true }).fill('Synthetic single legitimate retry after aborted native transaction');
    await button(browser.page, 'Uložit body kola').click();
    await expect.poll(async () => (await checkpoint(browser.page)).sequence).toBe(before.sequence + 1);
    await expect(browser.page.locator('[data-offline-error]')).toHaveCount(0);
    const after = await checkpoint(browser.page);
    await browser.page.getByLabel('Heslo pro nový nouzový soubor', { exact: true }).fill(password);
    const [download] = await Promise.all([browser.page.waitForEvent('download'), button(browser.page, 'Stáhnout nouzovou obnovu').click()]);
    const filename = path.join(directory, 'single-retry.justkvizoffline');
    await download.saveAs(filename); expect(await download.failure()).toBeNull();
    const archive = await inspectOfflineArchive(filename, password);
    const last = archive.metadata.operations.at(-1);
    expect(last.sequence).toBe(before.sequence + 1); expect(last.previousHash).toBe(before.headHash);
    expect(last.type).toBe('round-scores'); expect(last.payload.changes).toHaveLength(1);
    expect(last.payload.changes[0].halfPoints).toBe(newHalfPoints);
    expect(archive.state.headHash).toBe(after.headHash);
    observations.push(browser.observations); await browser.context.close();
    browser = await launch('a'); await unlock(browser.page);
    await browser.page.getByRole('combobox', { name: 'Kolo', exact: true }).selectOption(input.firstRoundId);
    expect(await checkpoint(browser.page)).toEqual(after);
    await expect(browser.page.getByLabel('Body — QA01', { exact: true })).toHaveValue(newValue);
    observations.push(browser.observations); observations.forEach(offlineProof);
    await saveProof('abort', { faultInjection: injection, actualNativeAbort: fault, before, after,
      exactRestartPreservedOriginalPoints: true, legitimateRetryExactlyOneOperation: true,
      independentEncryptedRecoveryReplayVerified: true, oldValue, newValue, observations,
      limitation: 'An explicit native transaction.abort after put success simulates interrupted commit; it is not a physical power-cut test.' });
  } finally {
    await browser.context.close();
  }
});

test('one real ciphertext bit flip is refused on unlock and never silently overwritten', async () => {
  let browser = await launch('c');
  const observations = [];
  try {
    await unlock(browser.page);
    const before = await checkpoint(browser.page);
    await button(browser.page, 'Zamknout soukromá data').click();
    const injection = await browser.page.evaluate(sessionId => new Promise((resolve, reject) => {
      const opening = indexedDB.open('justkviz-offline-v1', 1);
      opening.onerror = () => reject(new Error('Cannot open owned corruption profile.'));
      opening.onsuccess = () => {
        const db = opening.result, tx = db.transaction('sessions', 'readwrite', { durability: 'strict' });
        const store = tx.objectStore('sessions'), get = store.get(sessionId);
        let changed = null;
        get.onsuccess = () => {
          const row = get.result;
          if (!row?.encrypted?.bytes || row.encrypted.bytes.byteLength < 17) { tx.abort(); return; }
          const bytes = new Uint8Array(row.encrypted.bytes.slice(0));
          const offset = Math.floor(bytes.length / 2);
          bytes[offset] ^= 1;
          store.put({ ...row, encrypted: { ...row.encrypted, bytes: bytes.buffer } });
          changed = { offset, ciphertextBytes: bytes.length, flippedBits: 1 };
        };
        tx.oncomplete = () => { db.close(); resolve(changed); };
        tx.onabort = () => { db.close(); reject(new Error('Ciphertext fault injection did not commit.')); };
      };
    }), input.sessionId);
    expect(injection.flippedBits).toBe(1);
    const corrupted = await checkpoint(browser.page);
    expect(corrupted.sequence).toBe(before.sequence); expect(corrupted.headHash).toBe(before.headHash);
    expect(corrupted.encryptedSha256).not.toBe(before.encryptedSha256);
    observations.push(browser.observations); await browser.context.close();
    browser = await launch('c');
    await browser.page.getByLabel('Heslo offline souboru', { exact: true }).fill(password);
    await browser.page.locator(`[data-offline-session="${input.sessionId}"]`).getByRole('button', { name: 'Odemknout a pokračovat', exact: true }).click();
    await expect(browser.page.locator('[data-offline-error]')).toContainText('poškozená');
    await expect(browser.page.locator('[data-offline-runtime-state]')).toHaveCount(0);
    await expect(browser.page.locator('[data-offline-private]')).toHaveCount(0);
    expect(await checkpoint(browser.page)).toEqual(corrupted);
    observations.push(browser.observations); observations.forEach(offlineProof);
    await saveProof('corruption', { actualCommittedCiphertextBitFlip: injection, before, corrupted,
      correctPasswordValidatedBeforeCorruption: true, actualChromeRestart: true,
      unlockRejectedWithoutPrivateRuntime: true, corruptedCiphertextRetainedWithoutOverwrite: true, observations });
  } finally {
    await browser.context.close();
  }
});
