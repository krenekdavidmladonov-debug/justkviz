/* global indexedDB, matchMedia */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const sentinelDatabase = 'justkviz-qa-native-consent';
const hash = value => createHash('sha256').update(value).digest('hex');
const readRecord = async filename => JSON.parse(await readFile(filename, 'utf8'));
const save = (filename, record, create = false) => writeFile(filename, JSON.stringify(record, null, 2), create ? { flag: 'wx' } : undefined);

function ownProfile(profile) {
  assert(/^(?:op|cp)-[a-f0-9]{8}[\\/](?:p|t|r)$/u.test(path.relative(path.resolve('.local-data'), path.resolve(profile))),
    'Only exact run-owned op-/cp- short profiles p/t/r may install or uninstall this demo app.');
}

export async function nativeStorageState(page, request = false) {
  return page.evaluate(async request => ({
    permission: (await navigator.permissions.query({ name: 'persistent-storage' })).state,
    persistedBefore: await navigator.storage.persisted(),
    persistResult: request ? await navigator.storage.persist() : null,
    persistedAfter: await navigator.storage.persisted(),
  }), request);
}

async function sentinel(page, value) {
  return page.evaluate(({ database, value }) => new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('proof');
    request.onerror = () => reject(new Error('Native consent sentinel open failed.'));
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('proof', value === null ? 'readonly' : 'readwrite', { durability: 'strict' });
      const operation = value === null ? transaction.objectStore('proof').get('sentinel') : transaction.objectStore('proof').put(value, 'sentinel');
      let result;
      operation.onsuccess = () => { result = value === null ? operation.result : value; };
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onabort = () => { db.close(); reject(new Error('Native consent sentinel transaction aborted.')); };
    };
  }), { database: sentinelDatabase, value });
}

// Real browser installation/launch, not a permission override or a storage API stub.
// The create-only record authorizes cleanup of this newly installed app alone.
export async function installNativeOfflineApp({ context, page, profile, recordPath, startUrl }) {
  const url = new URL(startUrl), manifestId = url.origin + '/offline.html';
  assert.equal(url.origin, 'http://127.0.0.1:5000');
  assert.equal(url.pathname, '/offline.html');
  ownProfile(profile);
  const cdp = await context.browser().newBrowserCDPSession();
  try {
    let unknown = false;
    try { await cdp.send('PWA.getOsAppState', { manifestId }); }
    catch (error) { if (/Unknown web-app manifest id/u.test(String(error))) unknown = true; else throw error; }
    assert(unknown, 'Refuse to reuse or later uninstall an app that already existed in this profile.');
    const before = await nativeStorageState(page);
    assert.equal(before.persistedBefore, false, 'This installation requires a fresh profile negative control.');
    const record = { schemaVersion: 1, profile: path.resolve(profile), manifestId, startUrl, previouslyUnknown: true,
      permissionOverrideUsed: false, preferencesEdited: false, before, installStarted: true, installed: false, uninstalled: false };
    await save(recordPath, record, true);
    await cdp.send('PWA.install', { manifestId, installUrlOrBundleUrl: manifestId });
    record.installed = true; record.osState = await cdp.send('PWA.getOsAppState', { manifestId });
    await save(recordPath, record);
    const newPage = context.waitForEvent('page', { timeout: 20_000 });
    const launched = await cdp.send('PWA.launch', { manifestId, url: startUrl });
    const appPage = await newPage;
    await appPage.waitForLoadState('domcontentloaded');
    assert.equal(new URL(appPage.url()).origin, url.origin);
    const storage = await nativeStorageState(appPage, true);
    assert.equal(storage.persistResult, true); assert.equal(storage.persistedAfter, true);
    record.launch = { targetId: launched.targetId, standalone: await appPage.evaluate(() => matchMedia('(display-mode: standalone)').matches), storage };
    const value = 'owned-native-consent-' + randomUUID();
    assert.equal(await sentinel(appPage, value), value);
    record.sentinelSha256 = hash(value);
    await save(recordPath, record);
    await cdp.detach();
    record.afterProtocolDetach = await nativeStorageState(appPage);
    assert.equal(record.afterProtocolDetach.permission, 'granted');
    assert.equal(record.afterProtocolDetach.persistedBefore, true);
    await save(recordPath, record);
    return { page: appPage, record };
  } finally { await cdp.detach().catch(() => {}); }
}

// Call immediately after navigation on a cold browser, before any product persist().
// A copied closed profile uses its original notebook install record/sentinel.
export async function assertColdNativeStorage(page, recordPath) {
  const record = await readRecord(recordPath), storage = await nativeStorageState(page);
  assert(record.previouslyUnknown && record.installed && !record.uninstalled);
  assert.equal(storage.persistResult, null);
  assert.equal(storage.permission, 'granted'); assert.equal(storage.persistedBefore, true);
  const value = await sentinel(page, null);
  assert.equal(typeof value, 'string'); assert.equal(hash(value), record.sentinelSha256);
  return { ...storage, sentinelSha256: hash(value), permissionOverrideUsed: false };
}

export async function uninstallOwnedOfflineApp({ context, profile, recordPath }) {
  ownProfile(profile);
  const record = await readRecord(recordPath);
  assert.equal(record.profile, path.resolve(profile));
  assert.equal(record.manifestId, 'http://127.0.0.1:5000/offline.html');
  assert.equal(record.previouslyUnknown, true); assert.equal(record.installStarted, true);
  assert.equal(record.uninstalled, false);
  const cdp = await context.browser().newBrowserCDPSession();
  try {
    try {
      await cdp.send('PWA.getOsAppState', { manifestId: record.manifestId });
      await cdp.send('PWA.uninstall', { manifestId: record.manifestId });
      record.cleanup = 'Own newly installed application uninstalled';
    } catch (error) {
      if (!record.installed && /Unknown web-app manifest id/u.test(String(error))) record.cleanup = 'Install failed before app creation; no uninstall needed';
      else throw error;
    }
    let unknown = false;
    try { await cdp.send('PWA.getOsAppState', { manifestId: record.manifestId }); }
    catch (error) { if (/Unknown web-app manifest id/u.test(String(error))) unknown = true; else throw error; }
    assert(unknown, 'Own application must be absent after cleanup.');
    record.uninstalled = true; await save(recordPath, record);
    return { profile: record.profile, manifestId: record.manifestId, previouslyUnknown: true, cleanup: record.cleanup, absentAfterCleanup: true };
  } finally { await cdp.detach(); }
}
