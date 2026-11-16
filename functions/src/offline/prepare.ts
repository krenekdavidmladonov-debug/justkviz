import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { canonicalOfflineJson, countOfflineMedia, offlineEventLimits as limits, parseOfflineManifest, parseQuizAsset, readLocalImageDimensions, validOwnedMedia,
  type OfflineMediaAsset, type OfflineMediaKind, type OfflineIssue, type OfflineEventPreflight, type PrepareOfflineEventResponse } from '@filmovy-kviz/quiz-domain';
import { freshIdentity, authorize } from '../access/authorization.js';
import { assertEventOperational } from '../events/guards.js';
import { assetPath, mediaSignature } from '../media/model.js';
import { mediaBucket } from '../media/storage.js';
import { offlineCors, requireOfflineRuntime } from './activation.js';
import { cloudOfflineSigner, demoOfflineSigner, offlineDigest, offlineSigningSecrets, signOfflineGrant } from './signing.js';
import { assertOfflineExportContext, offlineId, offlineInput, offlinePermissions, offlineRecord, offlineUnavailable, manifestFromSource,
  readOfflineSource, requiredOfflineMedia, storedDigest, type OfflineSource } from './source.js';

const options = { region: 'europe-west1', cors: offlineCors, maxInstances: 2, concurrency: 1, memory: '256MiB' as const, timeoutSeconds: 540 };
const issuanceOptions = { ...options, secrets: offlineSigningSecrets };
export const readOfflineTrust = onCall(issuanceOptions, async request => {
  request.rawRequest.res?.setHeader('Cache-Control', 'no-store');
  const input = offlineInput(request.data, ['eventId', 'preflight', 'expectedActorId']), eventId = offlineId(input.eventId);
  if ('preflight' in input && input.preflight !== true) throw new HttpsError('invalid-argument', 'Neplatný požadavek offline kvízu.');
  const scope = requireOfflineRuntime(eventId, request.rawRequest.get('origin'), 'issue');
  assertExpectedActor(input, request.auth?.uid);
  if (input.preflight === true) return checkOfflineEvent(eventId, request.auth);
  const cloudSigner = cloudOfflineSigner(scope);
  await freshIdentity(request.auth);
  await getFirestore().runTransaction(async tx => {
    await authorize(request.auth, offlinePermissions, { kind: 'event', id: eventId }, tx);
    assertEventOperational((await tx.get(getFirestore().doc('events/' + eventId))).data());
  });
  const { trust } = cloudSigner ?? await demoOfflineSigner(scope);
  await freshIdentity(request.auth);
  await getFirestore().runTransaction(tx => authorize(request.auth, offlinePermissions, { kind: 'event', id: eventId }, tx));
  return trust;
});

export interface PreparedMediaRecord { reference: string; position: number; field: string; record: Record<string, unknown> }
export function pinnedMedia(record: Record<string, unknown>) {
  return { quizId: record.quizId, assetId: record.assetId, kind: record.kind, contentType: record.contentType, size: record.size,
    generation: record.generation, status: record.status, storageBackend: record.storageBackend ?? 'storage', drive: record.drive ?? null };
}
async function locateMedia(item: PreparedMediaRecord) {
  const { record, reference } = item, parsed = parseQuizAsset(reference)!;
  if (!validOwnedMedia(record.kind, record.contentType, record.size) || record.status !== 'ready' || record.quizId !== parsed.quizId || record.assetId !== parsed.assetId
    || record.drive !== undefined || (record.storageBackend !== undefined && record.storageBackend !== 'storage')
    || typeof record.generation !== 'string' || !/^[1-9]\d{0,29}$/u.test(record.generation)) throw offlineUnavailable();
  const size = record.size as number, contentType = record.contentType as OfflineMediaAsset['contentType'];
  if (size > (record.kind === 'image' ? limits.imageBytes : limits.mediaBytes)) throw offlineUnavailable();
  const file = mediaBucket().file(assetPath(parsed.quizId, parsed.assetId), { generation: record.generation });
  const [metadata] = await file.getMetadata();
  if (metadata.generation !== record.generation || metadata.contentType !== contentType || Number(metadata.size) !== size
    || (metadata.contentEncoding !== undefined && metadata.contentEncoding !== '')) throw offlineUnavailable();
  return { file, size, contentType, generation: record.generation, kind: record.kind };
}

async function readImageOrMedia(item: PreparedMediaRecord): Promise<OfflineMediaAsset> {
  const { reference } = item;
  const { file, size, contentType, generation, kind } = await locateMedia(item);
  const bytes = Buffer.alloc(size), stream = file.createReadStream({ start: 0, end: size, decompress: false });
  let offset = 0;
  try {
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk) || offset + chunk.length > size) throw offlineUnavailable();
      chunk.copy(bytes, offset); offset += chunk.length;
    }
  } finally { stream.destroy(); }
  if (offset !== size || !mediaSignature(bytes, contentType)) throw offlineUnavailable();
  const dimensions = kind === 'image' ? readLocalImageDimensions(bytes, contentType as 'image/png' | 'image/jpeg' | 'image/webp') : {};
  return { reference, generation, kind, contentType, size,
    sha256: offlineDigest(bytes), etag: '"' + offlineDigest(JSON.stringify([reference, generation, contentType, size])) + '"', ...dimensions };
}

async function readPreparationMedia(tx: Transaction, source: OfflineSource) {
  const db = getFirestore(), inventory = requiredOfflineMedia(source);
  if (source.activeOnline) inventory.issues.push({ slidePosition: 0, field: 'session', message: 'Nejprve ukončete online projekci. Potom připravte samostatný offline večer.' });
  const media: PreparedMediaRecord[] = [];
  if (inventory.required.size > limits.assets) return { media, total: 0, issues: inventory.issues };
  for (const [reference, use] of inventory.required) {
    const parsed = parseQuizAsset(reference)!;
    const record = (await tx.get(db.doc('quizzes/' + parsed.quizId + '/mediaAssets/' + parsed.assetId))).data();
    if (!record || record.kind !== use.kind) inventory.issues.push({ slidePosition: use.position, field: use.field, message: 'Vlastní médium chybí nebo má jiný typ. Nahrajte je znovu a uzamkněte opravený kvíz.' });
    else media.push({ reference, position: use.position, field: use.field, record });
  }
  const total = media.reduce((sum, item) => sum + (typeof item.record.size === 'number' ? item.record.size : limits.payloadBytes + 1), 0);
  if (total > limits.payloadBytes) inventory.issues.push({ slidePosition: 0, field: 'media', message: 'Média jsou pro offline soubor příliš velká. Nahraďte největší soubory menšími.' });
  return { media, total, issues: inventory.issues };
}

function grantExpiry(source: OfflineSource, issuedAtMs: number): number {
  return Math.min(issuedAtMs + limits.ttlMs, (source.event.startsAt as Timestamp).toMillis() + 12 * 60 * 60_000);
}

function assertExpectedActor(input: Record<string, unknown>, uid: string | undefined): void {
  if ('expectedActorId' in input && (!uid || input.expectedActorId !== uid)) throw new HttpsError('unauthenticated', 'Přihlášený uživatel se změnil.');
}

async function checkOfflineEvent(eventId: string, auth: Parameters<typeof readOfflineSource>[2]): Promise<OfflineEventPreflight> {
  await freshIdentity(auth);
  const db = getFirestore();
  const { source, media, total, issues } = await db.runTransaction(async tx => {
    const source = await readOfflineSource(tx, eventId, auth);
    return { source, ...await readPreparationMedia(tx, source) };
  });
  const expiresAtMs = grantExpiry(source, Date.now());
  const verifiedKinds: OfflineMediaKind[] = [];
  if (expiresAtMs <= Date.now()) issues.push({ slidePosition: 0, field: 'expiry', message: 'Platnost offline oprávnění už vypršela. Zkontrolujte datum a čas konání akce.' });
  if (media.length <= limits.assets && total <= limits.payloadBytes && expiresAtMs > Date.now()) {
    // Probe the exact object versions without fetching private media bytes or issuing an export.
    for (let offset = 0; offset < media.length; offset += 8) {
      const results = await Promise.all(media.slice(offset, offset + 8).map(async item => {
        try { return { kind: (await locateMedia(item)).kind }; }
        catch { return { issue: { slidePosition: item.position, field: item.field, message: 'Vlastní soubor chybí nebo ho nelze ověřit. Zkuste kontrolu znovu, případně soubor nahraďte.' } }; }
      }));
      for (const result of results) {
        if (result.issue) issues.push(result.issue);
        else verifiedKinds.push(result.kind);
      }
    }
  }
  await freshIdentity(auth);
  await db.runTransaction(async tx => {
    const current = await authorize(auth, offlinePermissions, { kind: 'event', id: eventId }, tx);
    const event = (await tx.get(source.eventRef)).data();
    assertEventOperational(event);
    if (current.version !== source.member.version || event.revision !== source.event.revision) throw new HttpsError('aborted', 'Akce se změnila. Spusťte kontrolu znovu.');
  });
  return { snapshotId: source.snapshotId, teamCount: source.teams.length, mediaCount: media.length,
    mediaCounts: countOfflineMedia(verifiedKinds), mediaBytes: total, expiresAtMs, issues };
}

export const prepareOfflineEvent = onCall(issuanceOptions, async (request): Promise<PrepareOfflineEventResponse> => {
  request.rawRequest.res?.setHeader('Cache-Control', 'no-store');
  const input = offlineInput(request.data, ['eventId', 'requestId', 'expectedSnapshotId', 'expectedActorId']), eventId = offlineId(input.eventId), requestId = offlineId(input.requestId);
  const expectedSnapshotId = 'expectedSnapshotId' in input ? offlineId(input.expectedSnapshotId) : undefined;
  const scope = requireOfflineRuntime(eventId, request.rawRequest.get('origin'), 'issue');
  assertExpectedActor(input, request.auth?.uid);
  const cloudSigner = cloudOfflineSigner(scope);
  await freshIdentity(request.auth);
  const db = getFirestore(), exportId = offlineDigest(JSON.stringify([request.auth!.uid, eventId, requestId, 'offline-v1']));
  const exportRef = db.doc('events/' + eventId + '/offlineExports/' + exportId);
  const initial = await db.runTransaction(async tx => {
    const source = await readOfflineSource(tx, eventId, request.auth);
    if (expectedSnapshotId !== undefined && source.snapshotId !== expectedSnapshotId) {
      throw new HttpsError('aborted', 'Uzamčený kvíz se změnil. Spusťte kontrolu znovu.', { offlineCheck: 'snapshot-changed' });
    }
    const previous = (await tx.get(exportRef)).data();
    if (previous) assertOfflineExportContext(previous, scope, eventId);
    return { source, previous, ...await readPreparationMedia(tx, source) };
  });
  if (initial.issues.length) return { ok: false, issues: initial.issues };
  const issuedAtMs = initial.previous ? Number(initial.previous.issuedAtMs) : Date.now();
  const expiresAtMs = initial.previous ? Number(initial.previous.expiresAtMs) : grantExpiry(initial.source, issuedAtMs);
  if (!Number.isSafeInteger(issuedAtMs) || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= Date.now() || expiresAtMs <= issuedAtMs) throw offlineUnavailable();
  const assets: OfflineMediaAsset[] = [], issues: OfflineIssue[] = [];
  for (const media of initial.media) {
    try { assets.push(await readImageOrMedia(media)); }
    catch { issues.push({ slidePosition: media.position, field: media.field, message: 'Obsah vlastního média se nepodařilo ověřit. Nahraďte soubor a připravte kvíz znovu.' }); }
  }
  if (issues.length) return { ok: false, issues };
  const header = { exportId, sessionId: 'offline-' + exportId.slice(0, 40), issuedAtMs, expiresAtMs };
  // Callable encoding converts own undefined values to null. Sign only the canonical wire value.
  const manifest = parseOfflineManifest(JSON.parse(canonicalOfflineJson(manifestFromSource(initial.source, header, assets, scope))) as unknown);
  const manifestDigest = offlineDigest(canonicalOfflineJson(manifest));
  const signer = cloudSigner ?? await demoOfflineSigner(scope);
  const grant = signOfflineGrant({ schemaVersion: 1, exportId, sessionId: header.sessionId, eventId, snapshotId: manifest.snapshot.id,
    manifestDigest, issuedAtMs, expiresAtMs, ...scope }, signer);
  await freshIdentity(request.auth);
  await db.runTransaction(async tx => {
    const current = await readOfflineSource(tx, eventId, request.auth), previous = (await tx.get(exportRef)).data();
    if (current.baselineDigest !== initial.source.baselineDigest || current.member.uid !== manifest.actorId || current.member.version !== manifest.membershipVersion || current.activeOnline)
      throw new HttpsError('aborted', 'Akce nebo oprávnění se během přípravy změnily. Připravte nový offline soubor.');
    for (const item of initial.media) {
      const parsed = parseQuizAsset(item.reference)!;
      const now = (await tx.get(db.doc('quizzes/' + parsed.quizId + '/mediaAssets/' + parsed.assetId))).data();
      if (!now || storedDigest(pinnedMedia(item.record)) !== storedDigest(pinnedMedia(now))) throw new HttpsError('aborted', 'Médium se během přípravy změnilo.');
    }
    if (previous) {
      assertOfflineExportContext(previous, scope, eventId);
      if (previous.actorId !== request.auth!.uid || previous.manifestDigest !== manifestDigest || previous.baselineDigest !== current.baselineDigest
        || offlineRecord(previous.grant).keyId !== grant.keyId) throw new HttpsError('already-exists', 'Původní příprava má jiný obsah nebo podpisový klíč. Zahajte novou přípravu.');
      return;
    }
    // Store only bounded descriptors and authority. Full private slides remain in the immutable snapshot.
    const { slides: privateSlides, assets: descriptors, ...manifestSeed } = manifest; void privateSlides; void descriptors;
    tx.create(exportRef, { schemaVersion: 1, ...header, actorId: request.auth!.uid, membershipVersion: current.member.version, manifestSeed,
      baselineDigest: current.baselineDigest, structuralDigest: current.structuralDigest, manifestDigest, grant, assets, mediaPins: initial.media.map(item => ({ reference: item.reference, pin: pinnedMedia(item.record) })),
      snapshotId: current.snapshotId, createdAt: Timestamp.now(), status: 'prepared' });
  });
  await freshIdentity(request.auth);
  return { ok: true, manifest, grant };
});

export function exportHeader(record: Record<string, unknown>) {
  return { exportId: offlineId(record.exportId), sessionId: offlineId(record.sessionId), issuedAtMs: Number(record.issuedAtMs), expiresAtMs: Number(record.expiresAtMs) };
}
export function exportAssets(record: Record<string, unknown>): OfflineMediaAsset[] {
  const assets = record.assets;
  if (!Array.isArray(assets) || assets.length > limits.assets) throw offlineUnavailable();
  return assets.map(asset => offlineRecord(asset) as unknown as OfflineMediaAsset);
}

/** Server-only descriptors are stored as objects: Firestore forbids arrays of arrays. */
export function exportMediaPins(record: Record<string, unknown>): { reference: string; pin: Record<string, unknown> }[] {
  const assets = exportAssets(record), pins = record.mediaPins;
  const byReference = new Map(assets.map(asset => [asset.reference, asset]));
  if (byReference.size !== assets.length || !Array.isArray(pins) || pins.length !== assets.length) throw offlineUnavailable();
  const seen = new Set<string>();
  return pins.map(value => {
    const entry = offlineRecord(value);
    if (Object.keys(entry).length !== 2 || typeof entry.reference !== 'string') throw offlineUnavailable();
    const reference = entry.reference, parsed = parseQuizAsset(reference), asset = byReference.get(reference), pin = offlineRecord(entry.pin);
    if (!parsed || !asset || seen.has(reference) || pin.quizId !== parsed.quizId || pin.assetId !== parsed.assetId
      || pin.generation !== asset.generation || pin.kind !== asset.kind || pin.contentType !== asset.contentType || pin.size !== asset.size
      || pin.status !== 'ready' || pin.storageBackend !== 'storage' || pin.drive !== null
      || storedDigest(pin) !== storedDigest(pinnedMedia(pin))) throw offlineUnavailable();
    seen.add(reference);
    return { reference, pin };
  });
}

export const authorizeOfflineEvent = onCall(options, async request => {
  request.rawRequest.res?.setHeader('Cache-Control', 'no-store');
  const input = offlineInput(request.data, ['eventId', 'exportId', 'manifestDigest']), eventId = offlineId(input.eventId), exportId = offlineId(input.exportId);
  const scope = requireOfflineRuntime(eventId, request.rawRequest.get('origin'), 'authorize');
  if (typeof input.manifestDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(input.manifestDigest)) throw offlineUnavailable();
  await freshIdentity(request.auth);
  const result = await getFirestore().runTransaction(async tx => {
    const source = await readOfflineSource(tx, eventId, request.auth);
    const record = (await tx.get(getFirestore().doc('events/' + eventId + '/offlineExports/' + exportId))).data();
    if (!record || record.actorId !== source.member.uid || record.membershipVersion !== source.member.version
      || record.baselineDigest !== source.baselineDigest || record.manifestDigest !== input.manifestDigest
      || !Number.isSafeInteger(record.expiresAtMs) || Number(record.expiresAtMs) <= Date.now() || source.activeOnline) throw offlineUnavailable();
    assertOfflineExportContext(record, scope, eventId);
    for (const { reference, pin } of exportMediaPins(record)) {
      const parsed = parseQuizAsset(reference)!;
      const current = (await tx.get(getFirestore().doc('quizzes/' + parsed.quizId + '/mediaAssets/' + parsed.assetId))).data();
      if (!current || storedDigest(pinnedMedia(current)) !== storedDigest(pin))
        throw new HttpsError('failed-precondition', 'Médium se od přípravy změnilo. Připravte nový offline soubor.');
    }
    return { exportId, manifestDigest: String(record.manifestDigest), expiresAtMs: Number(record.expiresAtMs) };
  });
  await freshIdentity(request.auth); return result;
});
