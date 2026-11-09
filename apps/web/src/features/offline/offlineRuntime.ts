import { applyOfflineOperation, canonicalOfflineJson, initialOfflineState, offlineEventLimits, offlineOperationContent, parseOfflineOperations, type OfflineCommand, type OfflineEventManifest, type OfflineOperation, type OfflineState } from '@filmovy-kviz/quiz-domain';
import { decryptOfflineValue, encryptOfflineValue, offlineDigest } from './offlineCrypto';
import { offlineAssetClips, offlineMediaFailure, readOfflineAsset, unlockOfflineMetadata, verifyOfflineMedia, type OfflineArchiveHeader, type OfflineArchiveMetadata, type OfflineRecordReader } from './offlineFile';
import { acquireOfflineWriter, commitOfflineSession, readOfflineTrusts, readStoredOfflineRecord, readStoredOfflineSession, type StoredOfflineSession } from './offlineStore';
interface DurableProgress {
    readonly state: OfflineState;
    readonly operations: readonly OfflineOperation[];
    readonly maxSeenMs: number;
    readonly syncedReceipt?: unknown;
}
const progressBinding = (session: StoredOfflineSession) => `offline-state:${session.sessionId}:${session.sequence}:${session.headHash}`;
export async function replayOfflineOperations(manifest: OfflineEventManifest, values: unknown): Promise<OfflineState> {
    const operations = parseOfflineOperations(values);
    let state = initialOfflineState(manifest), lastTime = manifest.issuedAtMs;
    for (const operation of operations) {
        const { hash, ...content } = operation;
        if (operation.observedAtMs < lastTime || operation.observedAtMs < manifest.issuedAtMs || operation.observedAtMs > manifest.expiresAtMs || await offlineDigest(offlineOperationContent(content)) !== hash) {
            throw new Error('Historie offline kvízu je poškozená.');
        }
        state = applyOfflineOperation(manifest, state, operation);
        lastTime = operation.observedAtMs;
    }
    return state;
}
export async function createStoredOfflineSession(metadata: OfflineArchiveMetadata, header: StoredOfflineSession['header'], key: CryptoKey, archiveId = metadata.manifest.sessionId, previousMaxSeenMs = 0): Promise<StoredOfflineSession> {
    const state = await replayOfflineOperations(metadata.manifest, metadata.operations);
    const base = { sessionId: metadata.manifest.sessionId, exportId: metadata.manifest.exportId, eventId: metadata.manifest.event.id, title: metadata.manifest.event.title, header, sequence: state.sequence, headHash: state.headHash, complete: true };
    const encrypted = await encryptOfflineValue(key, { state, operations: metadata.operations, maxSeenMs: Math.max(Date.now(), metadata.manifest.issuedAtMs, metadata.operations.at(-1)?.observedAtMs ?? 0, previousMaxSeenMs) }, progressBinding(base as StoredOfflineSession));
    return { ...base, encrypted, archiveId };
}
export interface OfflineRuntime {
    readonly manifest: OfflineEventManifest;
    readonly metadata: OfflineArchiveMetadata;
    readonly state: OfflineState;
    readonly operations: readonly OfflineOperation[];
    readonly syncedReceipt?: unknown;
    readonly playBlock: string | null;
    append(command: OfflineCommand): Promise<void>;
    asset(reference: string): Promise<Blob>;
    close(): void;
    markSynced(receipt: unknown): Promise<void>;
}

interface OfflineReadinessCheck {
    readonly verifyEnvironment: () => Promise<void>;
    readonly verifiedArchiveId?: string | undefined;
    readonly progress: (index: number, total: number) => void;
    readonly signal: AbortSignal;
}

export async function openOfflineRuntime(sessionId: string, password: string, onChange: () => void, readiness?: OfflineReadinessCheck): Promise<OfflineRuntime> {
    const release = await acquireOfflineWriter(sessionId);
    let closed = false;
    try {
        let stored = await readStoredOfflineSession(sessionId);
        if (!stored?.complete) {
            throw new Error('Offline data nejsou kompletní. Znovu načtěte původní soubor.');
        }
        const readRecord = (index: number) => readStoredOfflineRecord(stored!.archiveId ?? sessionId, index);
        const { key, metadata } = await unlockOfflineMetadata(stored.header, readRecord, password, await readOfflineTrusts());
        const value = await decryptOfflineValue(key, stored.encrypted, progressBinding(stored)) as DurableProgress;
        const operations = parseOfflineOperations(value.operations);
        let state = await replayOfflineOperations(metadata.manifest, operations);
        if (stored.sequence !== state.sequence || stored.headHash !== state.headHash || canonicalOfflineJson(state) !== canonicalOfflineJson(value.state) || !Number.isSafeInteger(value.maxSeenMs) || value.maxSeenMs < (operations.at(-1)?.observedAtMs ?? metadata.manifest.issuedAtMs)) {
            throw new Error('Uložený průběh byl poškozen. Obnovte nouzový soubor.');
        }
        let maxSeenMs = Math.max(value.maxSeenMs, Date.now()), busy = false, syncedReceipt = value.syncedReceipt;
        let readinessFailure: string | null = null;
        const clockBlock = (now: number) => {
            const previousTime = maxSeenMs;
            maxSeenMs = Math.max(now, previousTime);
            if (maxSeenMs > metadata.manifest.expiresAtMs) return 'Offline oprávnění k hraní vypršelo.';
            if (now < metadata.manifest.issuedAtMs || now + 300000 < previousTime) return 'Čas počítače nesouhlasí s ověřenou historií. Zkontrolujte čas a večer znovu odemkněte.';
            return null;
        };
        if (readiness) {
            readiness.signal.throwIfAborted();
            readinessFailure = clockBlock(Date.now());
            if (!readinessFailure) {
                try {
                    await readiness.verifyEnvironment();
                    readiness.signal.throwIfAborted();
                    // A just-written archive was verified before committing this exact pointer.
                    if (!stored.archiveId || stored.archiveId !== readiness.verifiedArchiveId) {
                        await verifyArchiveMedia(stored.header, readRecord, key, metadata.manifest, readiness.progress, readiness.signal);
                    }
                } catch (error) {
                    readiness.signal.throwIfAborted();
                    readinessFailure = error instanceof Error && !(error instanceof DOMException) && !(error instanceof TypeError)
                        ? error.message : 'Nepodařilo se ověřit aplikaci, trvalé úložiště nebo místní média.';
                }
            }
        }
        return {
            manifest: metadata.manifest, metadata,
            get state() {
                return state;
            }, get operations() {
                return operations;
            },
            get syncedReceipt() {
                return syncedReceipt;
            },
            get playBlock() {
                if (closed) return 'Offline relace je zamčená.';
                return readinessFailure ?? clockBlock(Date.now());
            },
            async append(command) {
                if (closed || busy) {
                    throw new Error('Předchozí změna se ještě ukládá.');
                }
                if (syncedReceipt) {
                    throw new Error('Výsledky byly synchronizovány. Další změny provádějte online.');
                }
                const now = Date.now();
                const observedAtMs = Math.max(now, maxSeenMs);
                const playBlock = readinessFailure ?? clockBlock(now);
                if (playBlock) throw new Error(playBlock);
                busy = true;
                try {
                    if (operations.length >= offlineEventLimits.operations) {
                        throw new Error('Byl dosažen limit historie offline kvízu.');
                    }
                    const content = { ...command, operationId: crypto.randomUUID(), sequence: state.sequence + 1, previousHash: state.headHash, observedAtMs };
                    const operation = { ...content, hash: await offlineDigest(offlineOperationContent(content)) } as OfflineOperation;
                    const next = applyOfflineOperation(metadata.manifest, state, operation);
                    parseOfflineOperations([...operations, operation]);
                    maxSeenMs = Math.max(maxSeenMs, observedAtMs, Date.now());
                    const nextStored = { ...stored!, sequence: next.sequence, headHash: next.headHash, encrypted: await encryptOfflineValue(key, { state: next, operations: [...operations, operation], maxSeenMs }, progressBinding({ ...stored!, sequence: next.sequence, headHash: next.headHash })) };
                    await commitOfflineSession(nextStored, state.sequence);
                    stored = nextStored;
                    operations.push(operation);
                    state = next;
                    onChange();
                }
                finally {
                    busy = false;
                    if (closed) {
                        release();
                    }
                }
            },
            async asset(reference) {
                if (closed) {
                    throw new Error('Offline relace je zamčená.');
                }
                try {
                    return await readOfflineAsset(stored!.header, readRecord, key, metadata.manifest, reference);
                } catch (error) {
                    const failure = offlineMediaFailure(metadata.manifest, reference, error);
                    if (!closed && !readinessFailure) {
                        readinessFailure = failure.message;
                        onChange();
                    }
                    throw failure;
                }
            },
            close() {
                if (!closed) {
                    closed = true;
                    if (!busy) {
                        release();
                    }
                }
            },
            async markSynced(receipt) {
                if (closed || busy) {
                    throw new Error('Počkejte na dokončení ukládání.');
                }
                const confirmation = receipt as Record<string, unknown> | null;
                if (!confirmation || typeof confirmation !== 'object' || confirmation.exportId !== metadata.manifest.exportId
                    || confirmation.sessionId !== metadata.manifest.sessionId || confirmation.headHash !== state.headHash
                    || confirmation.operationCount !== operations.length || typeof confirmation.receiptId !== 'string'
                    || !confirmation.receiptId || typeof confirmation.replayed !== 'boolean' || !Array.isArray(confirmation.rows)
                    || confirmation.rows.length > metadata.manifest.teams.length
                    || confirmation.rows.some((value: unknown) => {
                        if (!value || typeof value !== 'object') return true;
                        const row = value as Record<string, unknown>;
                        return !Number.isSafeInteger(row.rank) || (row.rank as number) < 1 || typeof row.teamName !== 'string'
                            || !Number.isSafeInteger(row.halfPoints) || (row.halfPoints as number) < 0;
                    })) {
                    throw new Error('Serverové potvrzení neodpovídá tomuto uloženému večeru. Zkuste synchronizaci znovu.');
                }
                busy = true;
                try {
                    const next = { ...stored!, encrypted: await encryptOfflineValue(key, { state, operations, maxSeenMs, syncedReceipt: receipt }, progressBinding(stored!)) };
                    await commitOfflineSession(next, state.sequence);
                    stored = next;
                    syncedReceipt = receipt;
                    onChange();
                }
                finally {
                    busy = false;
                    if (closed) {
                        release();
                    }
                }
            },
        };
    }
    catch (error) {
        closed = true;
        release();
        throw error;
    }
}
export async function verifyStoredOfflineMedia(session: StoredOfflineSession, password: string, progress: (index: number, total: number) => void): Promise<void> {
    const read = (index: number) => readStoredOfflineRecord(session.archiveId ?? session.sessionId, index);
    const { key, metadata } = await unlockOfflineMetadata(session.header, read, password, await readOfflineTrusts());
    await verifyArchiveMedia(session.header, read, key, metadata.manifest, progress);
}

async function verifyArchiveMedia(header: OfflineArchiveHeader, read: OfflineRecordReader, key: CryptoKey, manifest: OfflineEventManifest, progress: (index: number, total: number) => void, signal?: AbortSignal): Promise<void> {
    for (const [index, asset] of manifest.assets.entries()) {
        signal?.throwIfAborted();
        try {
            const blob = await readOfflineAsset(header, read, key, manifest, asset.reference);
            await verifyOfflineMedia(blob, asset, offlineAssetClips(manifest, asset.reference));
        } catch (error) {
            throw offlineMediaFailure(manifest, asset.reference, error);
        }
        signal?.throwIfAborted();
        progress(index + 1, manifest.assets.length);
    }
}
