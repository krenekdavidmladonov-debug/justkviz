import { countOfflineMedia, offlineEventLimits, type OfflineIssue, type OfflineMediaCounts, type OfflineTrust } from '@filmovy-kviz/quiz-domain';
import { canonicalOfflineJson } from '@filmovy-kviz/quiz-domain';
import { decodeBase64, decryptOfflineValue, deriveOfflineKey, offlineDigest, verifyOfflineGrant } from './offlineCrypto';
import { createOfflineArchive, readOfflineArchiveHeader, unlockOfflineMetadata, writeOfflineArchive, type OfflineArchiveHeader, type OfflineArchiveMetadata, type OfflineRecordReader } from './offlineFile';
import { createStoredOfflineSession, replayOfflineOperations, verifyStoredOfflineMedia, type OfflineRuntime } from './offlineRuntime';
import { commitOfflineSession, deleteOfflineRecords, listOfflineSessions, pinOfflineTrust, prepareOfflineStorage, readOfflineTrusts, readStoredOfflineRecord, readStoredOfflineSession, storeOfflineRecord, withOfflineWriter, type StoredOfflineSession } from './offlineStore';
import { installOfflineShell, testOfflineShellBoot } from './offlineShell';
export type OfflinePreparationProgress = (message: string) => void;
/** Installs only the application and an authenticated server key, never event media. */
export async function installOfflineEvent(eventId: string, progress: OfflinePreparationProgress, actorId?: string, signal?: AbortSignal): Promise<OfflineTrust> {
    progress('Ověřuji aplikaci a místo pro bezpečné uložení…');
    await installOfflineShell();
    await testOfflineShellBoot();
    signal?.throwIfAborted();
    await prepareOfflineStorage(16 * 1024 * 1024);
    const online = await import('./offlineOnline');
    progress('Ověřuji, že notebook smí kvíz otevřít…');
    signal?.throwIfAborted();
    const trust = await online.fetchOfflineTrust(eventId, actorId);
    signal?.throwIfAborted();
    await pinOfflineTrust(trust);
    return trust;
}
export class OfflinePreparationIssues extends Error {
    constructor(readonly issues: readonly OfflineIssue[]) { super('Kvíz vyžaduje opravu před přípravou.'); }
}
export class OfflinePreparationBlocked extends Error {
    constructor(readonly reason: 'played' | 'stale' | 'snapshot-changed' | 'expired') { super(reason); }
}
export interface PreparedOfflineEvent {
    readonly session: StoredOfflineSession;
    readonly expiresAtMs: number;
    readonly mediaCounts: OfflineMediaCounts;
    readonly recordDigests: readonly string[];
    revalidate(): Promise<void>;
}
type MediaProgress = (done: number, total: number) => void;

async function assertEventNotPlayed(eventId: string): Promise<void> {
    if ((await listOfflineSessions()).some(session => session.eventId === eventId && session.sequence > 0)) {
        throw new OfflinePreparationBlocked('played');
    }
}

function preparedEvent(session: StoredOfflineSession, { manifest, grant }: OfflineArchiveMetadata, recordDigests: readonly string[]): PreparedOfflineEvent {
    const { exportId, expiresAtMs, actorId } = manifest;
    const event = { ...manifest.event }, payload = grant.payload;
    const mediaCounts = countOfflineMedia(manifest.assets.map(asset => asset.kind));
    return { session, expiresAtMs, mediaCounts, recordDigests, async revalidate() {
        if (Date.now() >= expiresAtMs) throw new OfflinePreparationBlocked('expired');
        const current = await readStoredOfflineSession(session.sessionId);
        if (!current?.complete || current.archiveId !== session.archiveId || current.sequence !== session.sequence) throw new OfflinePreparationBlocked('stale');
        const { authorizePreparedOfflineEvent } = await import('./offlineOnline');
        await authorizePreparedOfflineEvent({ event, exportId, expiresAtMs, actorId }, { payload });
        if (Date.now() >= expiresAtMs) throw new OfflinePreparationBlocked('expired');
    } };
}

async function verifyForExport(session: StoredOfflineSession, metadata: OfflineArchiveMetadata, password: string, progress: MediaProgress): Promise<PreparedOfflineEvent> {
    const digests: string[] = [];
    await verifyStoredOfflineMedia(session, password, progress, async (index, record) => {
        digests[index] = await offlineDigest(await record.arrayBuffer());
    });
    return preparedEvent(session, metadata, digests);
}

export async function reusePreparedOfflineEvent(session: StoredOfflineSession, snapshotId: string, password: string, mediaProgress: MediaProgress): Promise<PreparedOfflineEvent> {
    return withOfflineWriter(`event:${session.eventId}`, async () => {
        await assertEventNotPlayed(session.eventId);
        const read = (index: number) => readStoredOfflineRecord(session.archiveId ?? session.sessionId, index);
        const { metadata } = await unlockOfflineMetadata(session.header, read, password, await readOfflineTrusts());
        if (metadata.manifest.sessionId !== session.sessionId || metadata.operations.length !== 0) {
            throw new OfflinePreparationBlocked('stale');
        }
        if (metadata.manifest.snapshot.id !== snapshotId) throw new OfflinePreparationBlocked('snapshot-changed');
        const online = await import('./offlineOnline');
        if (Date.now() >= metadata.manifest.expiresAtMs) throw new OfflinePreparationBlocked('expired');
        await online.authorizePreparedOfflineEvent(metadata.manifest, metadata.grant);
        const prepared = await verifyForExport(session, metadata, password, mediaProgress);
        await prepared.revalidate();
        return prepared;
    });
}

export async function prepareOfflineEvent(eventId: string, snapshotId: string, requestId: string, password: string, progress: OfflinePreparationProgress, mediaProgress: MediaProgress, signal: AbortSignal): Promise<PreparedOfflineEvent> {
    const { currentOfflineActor } = await import('./offlineOnline');
    const actorId = await currentOfflineActor();
    signal.throwIfAborted();
    return withOfflineWriter(`event:${eventId}`, () => buildOfflineEvent(eventId, snapshotId, requestId, actorId, password, progress, mediaProgress, signal));
}

async function buildOfflineEvent(eventId: string, snapshotId: string, requestId: string, actorId: string, password: string, progress: OfflinePreparationProgress, mediaProgress: MediaProgress, signal: AbortSignal): Promise<PreparedOfflineEvent> {
    await assertEventNotPlayed(eventId);
    signal.throwIfAborted();
    const trust = await installOfflineEvent(eventId, progress, actorId, signal);
    const online = await import('./offlineOnline');
    progress('Připravuji kopii uzamčeného kvízu…');
    signal.throwIfAborted();
    const result = await online.prepareOnlineOfflineEvent(eventId, requestId, snapshotId, actorId);
    signal.throwIfAborted();
    if (!result.ok) {
        throw new OfflinePreparationIssues(result.issues);
    }
    const { manifest, grant } = result;
    await verifyOfflineGrant(manifest, grant, trust);
    if (manifest.actorId !== actorId || manifest.snapshot.id !== snapshotId) throw new OfflinePreparationBlocked('stale');
    await prepareOfflineStorage(manifest.assets.reduce((sum, asset) => sum + asset.size, 0) + offlineEventLimits.manifestBytes);
    const metadata = { manifest, grant, operations: [] };
    const archiveId = crypto.randomUUID();
    try {
        progress('Stahuji a ověřuji média.');
        mediaProgress(0, manifest.assets.length);
        const { header, key } = await createOfflineArchive(metadata, password, asset => online.fetchOfflineAsset(manifest, asset), (index, blob) => {
            signal.throwIfAborted();
            return storeOfflineRecord(archiveId, index, blob);
        }, mediaProgress);
        const stored = await createStoredOfflineSession(metadata, header, key, archiveId);
        progress('Ověřuji, že uložené obrázky a ukázky lze přehrát…');
        mediaProgress(0, manifest.assets.length);
        const prepared = await verifyForExport(stored, metadata, password, mediaProgress);
        await online.authorizePreparedOfflineEvent(manifest, grant);
        await assertEventNotPlayed(eventId);
        await withOfflineWriter(stored.sessionId, () => {
            signal.throwIfAborted();
            if (Date.now() >= manifest.expiresAtMs) throw new OfflinePreparationBlocked('expired');
            return commitOfflineSession(stored, null);
        });
        return prepared;
    }
    catch (error) {
        await deleteOfflineRecords(archiveId).catch(() => {
        });
        throw error;
    }
}
export async function importOfflineEvent(file: File, password: string, progress: OfflinePreparationProgress, restore = false, previousPassword = password, expectedEventId?: string): Promise<StoredOfflineSession> {
    progress('Ověřuji podpis a heslo souboru…');
    const { header, readRecord } = await readOfflineArchiveHeader(file);
    const { metadata, key } = await unlockOfflineMetadata(header, readRecord, password, await readOfflineTrusts());
    if (expectedEventId && metadata.manifest.event.id !== expectedEventId) {
        throw new Error('Tento soubor patří jiné akci. Otevřete jej z obecného offline rozhraní nebo vyberte soubor této akce.');
    }
    const incoming = await replayOfflineOperations(metadata.manifest, metadata.operations);
    return withOfflineWriter(metadata.manifest.sessionId, async () => {
        const existing = await readStoredOfflineSession(metadata.manifest.sessionId);
        let previousMaxSeenMs = 0;
        if (existing) {
            if (existing.exportId !== metadata.manifest.exportId) {
                throw new Error('Identita místního večera nesouhlasí.');
            }
            if (!restore) {
                if (incoming.sequence > existing.sequence) {
                    throw new Error('Soubor obsahuje novější průběh. Pro jeho obnovu výslovně zvolte obnovu existujícího večera.');
                }
                throw new Error('Tento večer už je uložený na tomto počítači. Pro pokračování jej odemkněte v seznamu uložených večerů.');
            }
            // Authenticate the existing journal even when its media records are missing.
            // Recovery is permitted only along the same verified history, never a fork.
            const oldKey = await deriveOfflineKey(previousPassword, decodeBase64(existing.header.salt), existing.header.iterations);
            const saved = await decryptOfflineValue(oldKey, existing.encrypted, `offline-state:${existing.sessionId}:${existing.sequence}:${existing.headHash}`) as {
                operations: unknown;
                state: unknown;
                maxSeenMs: number;
                syncedReceipt?: unknown;
                pendingSynchronization?: unknown;
            };
            const oldState = await replayOfflineOperations(metadata.manifest, saved.operations);
            if (oldState.sequence !== existing.sequence || oldState.headHash !== existing.headHash || canonicalOfflineJson(oldState) !== canonicalOfflineJson(saved.state)) {
                throw new Error('Původní historie je poškozená. Soubor nebyl přepsán.');
            }
            if (saved.syncedReceipt) {
                throw new Error('Tento večer již má potvrzení synchronizace. Obnova jej nesmí vrátit zpět.');
            }
            if (saved.pendingSynchronization !== undefined) {
                throw new Error('Předchozí synchronizace čeká na potvrzení. Nejprve večer odemkněte a znovu ověřte stejnou synchronizaci. Původní průběh nebyl přepsán.');
            }
            if (incoming.sequence < oldState.sequence) {
                throw new Error('Nouzový soubor je starší než uložený průběh.');
            }
            const prefixHash = oldState.sequence === 0 ? '0'.repeat(64) : metadata.operations[oldState.sequence - 1]?.hash;
            if (prefixHash !== oldState.headHash) {
                throw new Error('Nouzový soubor patří jiné větvi historie. Původní průběh zůstal zachován.');
            }
            if (!Number.isSafeInteger(saved.maxSeenMs) || saved.maxSeenMs < (oldState.sequence ? (saved.operations as {
                observedAtMs: number;
            }[]).at(-1)!.observedAtMs : metadata.manifest.issuedAtMs)) {
                throw new Error('Původní čas historie je poškozený.');
            }
            previousMaxSeenMs = saved.maxSeenMs;
        }
        await testOfflineShellBoot();
        await prepareOfflineStorage(header.recordSizes.reduce((sum, size) => sum + size, 0));
        const archiveId = crypto.randomUUID();
        try {
            for (let index = 0; index < header.recordSizes.length; index++) {
                await storeOfflineRecord(archiveId, index, await readRecord(index));
                progress(`Načítám šifrované části: ${index + 1} / ${header.recordSizes.length}`);
            }
            const stored = await createStoredOfflineSession(metadata, header, key, archiveId, previousMaxSeenMs);
            await verifyStoredOfflineMedia(stored, password, (index, total) => progress(`Ověřuji místní média: ${index} / ${total}`));
            await commitOfflineSession(stored, existing?.sequence ?? null);
            if (existing) {
                await deleteOfflineRecords(existing.archiveId ?? existing.sessionId).catch(() => {
                });
            }
            return stored;
        }
        catch (error) {
            await deleteOfflineRecords(archiveId).catch(() => {
            });
            throw error;
        }
    });
}
interface OfflineFileHandle {
    getFile(): Promise<File>;
    createWritable(): Promise<{
        write(blob: Blob): Promise<void>;
        close(): Promise<void>;
        abort(): Promise<void>;
    }>;
}
async function chooseArchiveFile(name: string): Promise<OfflineFileHandle | null> {
    const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<OfflineFileHandle> }).showSaveFilePicker;
    return picker ? picker.call(window, { suggestedName: name, types: [{ description: 'Šifrovaný offline kvíz', accept: { 'application/octet-stream': ['.justkvizoffline'] } }] }) : null;
}
async function saveArchive(name: string, header: OfflineArchiveHeader, readRecord: OfflineRecordReader, selected?: OfflineFileHandle | null, verify?: (file: File) => Promise<void>): Promise<void> {
    // Chrome streams encrypted records directly to the selected file. Other browsers
    // use bounded Blob parts, never one concatenated plaintext ArrayBuffer.
    const handle = selected === undefined ? await chooseArchiveFile(name) : selected;
    if (handle) {
        const writer = await handle.createWritable();
        try {
            await writeOfflineArchive(header, readRecord, blob => writer.write(blob));
            await writer.close();
        }
        catch (error) {
            await writer.abort().catch(() => {});
            throw error;
        }
        if (verify) await verify(await handle.getFile());
        return;
    }
    const parts: Blob[] = [];
    await writeOfflineArchive(header, readRecord, blob => {
        parts.push(blob);
        return Promise.resolve();
    });
    const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function exportStoredOfflineEvent(session: StoredOfflineSession, download = false): Promise<void> {
    await saveArchive(`${session.eventId}.justkvizoffline`, session.header, index => readStoredOfflineRecord(session.archiveId ?? session.sessionId, index), download ? null : undefined);
}
function storedArchiveRecord(session: StoredOfflineSession): OfflineRecordReader {
    return index => readStoredOfflineRecord(session.archiveId ?? session.sessionId, index);
}

/** Confirm that the user can read the exact encrypted bytes that passed preparation. No import or journal writes. */
export async function verifySavedOfflineEvent({ session, recordDigests }: PreparedOfflineEvent, file: File): Promise<void> {
    const { header, readRecord } = await readOfflineArchiveHeader(file);
    if (canonicalOfflineJson(header) !== canonicalOfflineJson(session.header)) throw damagedArchive();
    const verifiedRead = verifyRecords(readRecord, recordDigests);
    for (let index = 0; index < header.recordSizes.length; index++) {
        await verifiedRead(index);
    }
}

const damagedArchive = () => new Error('Uložený soubor není úplný nebo neodpovídá připravenému kvízu. Uložte jej znovu.');
function verifyRecords(readRecord: OfflineRecordReader, recordDigests: readonly string[]): OfflineRecordReader {
    return async index => {
        const record = await readRecord(index);
        if (await offlineDigest(await record.arrayBuffer()) !== recordDigests[index]) throw damagedArchive();
        return record;
    };
}

export async function savePreparedOfflineEvent(prepared: PreparedOfflineEvent, download = false): Promise<boolean> {
    const { session } = prepared;
    const title = [...session.title.replace(/[^\p{L}\p{N} _-]+/gu, '-').trim()].slice(0, 48).join('').trim();
    const name = `JustKviz-${title || 'offline'}.justkvizoffline`;
    // The picker must be opened in the click before any asynchronous online authorization.
    const selected = download ? null : await chooseArchiveFile(name);
    await prepared.revalidate();
    await saveArchive(name, session.header, verifyRecords(storedArchiveRecord(session), prepared.recordDigests), selected, file => verifySavedOfflineEvent(prepared, file));
    if (selected) await prepared.revalidate();
    return selected !== null;
}
export async function exportOfflineRecovery(runtime: OfflineRuntime, password: string, progress: OfflinePreparationProgress, download = false): Promise<void> {
    const name = `${runtime.manifest.event.id}-obnova.justkvizoffline`;
    // Ask while the user's click is still active, before encryption/decode awaits.
    const selected = download ? null : await chooseArchiveFile(name);
    const archiveId = crypto.randomUUID();
    try {
        const { header } = await createOfflineArchive({ ...runtime.metadata, operations: runtime.operations }, password, asset => runtime.asset(asset.reference), (index, blob) => storeOfflineRecord(archiveId, index, blob), (index, total) => progress(`Ověřuji nouzový export: ${index} / ${total}`));
        await saveArchive(name, header, index => readStoredOfflineRecord(archiveId, index), selected);
    }
    finally {
        await deleteOfflineRecords(archiveId).catch(() => {
        });
    }
}
