import { offlineEventLimits, type OfflineTrust } from '@filmovy-kviz/quiz-domain';
import { canonicalOfflineJson } from '@filmovy-kviz/quiz-domain';
import { decodeBase64, decryptOfflineValue, deriveOfflineKey, verifyOfflineGrant } from './offlineCrypto';
import { createOfflineArchive, readOfflineArchiveHeader, unlockOfflineMetadata, writeOfflineArchive, type OfflineArchiveHeader, type OfflineRecordReader } from './offlineFile';
import { createStoredOfflineSession, replayOfflineOperations, verifyStoredOfflineMedia, type OfflineRuntime } from './offlineRuntime';
import { commitOfflineSession, deleteOfflineRecords, pinOfflineTrust, prepareOfflineStorage, readOfflineTrusts, readStoredOfflineRecord, readStoredOfflineSession, storeOfflineRecord, withOfflineWriter, type StoredOfflineSession } from './offlineStore';
import { installOfflineShell, testOfflineShellBoot } from './offlineShell';
export type OfflinePreparationProgress = (message: string) => void;
/** Installs only the application and an authenticated server key, never event media. */
export async function installOfflineEvent(eventId: string, progress: OfflinePreparationProgress): Promise<OfflineTrust> {
    progress('Ověřuji instalaci aplikace a trvalé úložiště…');
    await installOfflineShell();
    await testOfflineShellBoot();
    await prepareOfflineStorage(16 * 1024 * 1024);
    const online = await import('./offlineOnline');
    progress('Ověřuji podpisový klíč akce pro tento notebook…');
    const trust = await online.fetchOfflineTrust(eventId);
    await pinOfflineTrust(trust);
    return trust;
}
export async function prepareOfflineEvent(eventId: string, password: string, progress: OfflinePreparationProgress): Promise<StoredOfflineSession> {
    const trust = await installOfflineEvent(eventId, progress);
    const online = await import('./offlineOnline');
    progress('Připravuji neměnnou kopii kvízu a oprávnění…');
    const result = await online.prepareOnlineOfflineEvent(eventId, crypto.randomUUID());
    if (!result.ok) {
        throw new Error(result.issues.map(issue => `${issue.slidePosition ? `Snímek ${issue.slidePosition}: ` : ''}${issue.field} — ${issue.message}`).join('\n'));
    }
    const { manifest, grant } = result;
    await verifyOfflineGrant(manifest, grant, trust);
    await prepareOfflineStorage(manifest.assets.reduce((sum, asset) => sum + asset.size, 0) + offlineEventLimits.manifestBytes);
    const metadata = { manifest, grant, operations: [] };
    const archiveId = crypto.randomUUID();
    try {
        const { header, key } = await createOfflineArchive(metadata, password, asset => online.fetchOfflineAsset(manifest, asset), (index, blob) => storeOfflineRecord(archiveId, index, blob), (index, total) => progress(`Stahuji a ověřuji média: ${index} / ${total}`));
        const stored = await createStoredOfflineSession(metadata, header, key, archiveId);
        progress('Ověřuji uložený soubor a skutečné dekódování všech médií…');
        await verifyStoredOfflineMedia(stored, password, (index, total) => progress(`Ověřuji místní média: ${index} / ${total}`));
        await online.authorizePreparedOfflineEvent(manifest, grant);
        await withOfflineWriter(stored.sessionId, () => commitOfflineSession(stored, null));
        return stored;
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
            };
            const oldState = await replayOfflineOperations(metadata.manifest, saved.operations);
            if (oldState.sequence !== existing.sequence || oldState.headHash !== existing.headHash || canonicalOfflineJson(oldState) !== canonicalOfflineJson(saved.state)) {
                throw new Error('Původní historie je poškozená. Soubor nebyl přepsán.');
            }
            if (saved.syncedReceipt) {
                throw new Error('Tento večer již má potvrzení synchronizace. Obnova jej nesmí vrátit zpět.');
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
    createWritable(): Promise<{
        write(blob: Blob): Promise<void>;
        close(): Promise<void>;
        abort(): Promise<void>;
    }>;
}
async function chooseArchiveFile(name: string): Promise<OfflineFileHandle | null> {
    const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<OfflineFileHandle> }).showSaveFilePicker;
    return picker ? picker({ suggestedName: name, types: [{ description: 'Šifrovaný offline kvíz', accept: { 'application/octet-stream': ['.justkvizoffline'] } }] }) : null;
}
async function saveArchive(name: string, header: OfflineArchiveHeader, readRecord: OfflineRecordReader, selected?: OfflineFileHandle | null): Promise<void> {
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
            await writer.abort();
            throw error;
        }
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
