import type { OfflineTrust } from '@filmovy-kviz/quiz-domain';
import type { EncryptedOfflineValue } from './offlineCrypto';
import type { OfflineArchiveHeader } from './offlineFile';
export interface StoredOfflineSession {
    readonly sessionId: string;
    readonly exportId: string;
    readonly eventId: string;
    readonly title: string;
    readonly header: OfflineArchiveHeader;
    readonly sequence: number;
    readonly headHash: string;
    readonly archiveId?: string;
    readonly encrypted: EncryptedOfflineValue;
    readonly complete: boolean;
    readonly syncedReceipt?: unknown;
}
const databaseName = 'justkviz-offline-v1';
function request<T>(input: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        input.onsuccess = () => resolve(input.result);
        input.onerror = () => reject(new Error('Místní data nelze přečíst.'));
    });
}
function done(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(new Error('Zápis nebyl potvrzen. Zkontrolujte volné místo; původní data zůstala zachována.'));
    });
}
async function database(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
        throw new Error('Tento prohlížeč nepodporuje bezpečné místní uložení.');
    }
    const open = indexedDB.open(databaseName, 1);
    open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('sessions', { keyPath: 'sessionId' });
        db.createObjectStore('records');
        db.createObjectStore('settings');
    };
    return request(open);
}
function strict(db: IDBDatabase, stores: string | string[]): IDBTransaction {
    const transaction = db.transaction(stores, 'readwrite', { durability: 'strict' });
    if (transaction.durability !== 'strict') {
        transaction.abort();
        throw new Error('Prohlížeč nepotvrzuje odolné zápisy. Použijte podporovaný Chrome.');
    }
    return transaction;
}
export async function storeOfflineRecord(sessionId: string, index: number, blob: Blob): Promise<void> {
    const db = await database();
    try {
        const tx = strict(db, 'records');
        const commit = done(tx);
        tx.objectStore('records').put(blob, `${sessionId}:${index}`);
        await commit;
    }
    finally {
        db.close();
    }
}
export async function readStoredOfflineRecord(sessionId: string, index: number): Promise<Blob> {
    const db = await database();
    try {
        const value = await request(db.transaction('records').objectStore('records').get(`${sessionId}:${index}`) as IDBRequest<unknown>);
        if (!(value instanceof Blob)) {
            throw new Error('Část místní zálohy chybí nebo byla odstraněna.');
        }
        return value;
    }
    finally {
        db.close();
    }
}
/** Removes only a completed staging archive; callers retain the current session pointer. */
export async function deleteOfflineRecords(archiveId: string): Promise<void> {
    const db = await database();
    try {
        const transaction = strict(db, 'records');
        const committed = done(transaction);
        const range = IDBKeyRange.bound(`${archiveId}:`, `${archiveId}:\uffff`);
        transaction.objectStore('records').delete(range);
        await committed;
    }
    finally {
        db.close();
    }
}
export async function readStoredOfflineSession(sessionId: string): Promise<StoredOfflineSession | undefined> {
    const db = await database();
    try {
        return await request(db.transaction('sessions').objectStore('sessions').get(sessionId) as IDBRequest<StoredOfflineSession | undefined>);
    }
    finally {
        db.close();
    }
}
export async function listOfflineSessions(): Promise<StoredOfflineSession[]> {
    const db = await database();
    try {
        return (await request(db.transaction('sessions').objectStore('sessions').getAll() as IDBRequest<StoredOfflineSession[]>)).filter(session => session.complete);
    }
    finally {
        db.close();
    }
}
export async function commitOfflineSession(value: StoredOfflineSession, expectedSequence: number | null): Promise<void> {
    const db = await database();
    try {
        const tx = strict(db, 'sessions'), commit = done(tx), store = tx.objectStore('sessions');
        const read = store.get(value.sessionId) as IDBRequest<StoredOfflineSession | undefined>;
        read.onsuccess = () => {
            const current = read.result;
            if ((expectedSequence === null && current !== undefined) || (expectedSequence !== null && (!current || current.sequence !== expectedSequence || current.exportId !== value.exportId))) {
                tx.abort();
                return;
            }
            store.put(value);
        };
        await commit;
    }
    finally {
        db.close();
    }
}
export async function pinOfflineTrust(trust: OfflineTrust): Promise<void> {
    const db = await database();
    try {
        const tx = strict(db, 'settings'), commit = done(tx);
        tx.objectStore('settings').put(trust, `trust:${trust.environment}:${trust.keyId}`);
        await commit;
    }
    finally {
        db.close();
    }
}
export async function readOfflineTrusts(): Promise<OfflineTrust[]> {
    const db = await database();
    try {
        const tx = db.transaction('settings'), keys = await request(tx.objectStore('settings').getAllKeys());
        const values: OfflineTrust[] = [];
        for (const key of keys) {
            if (typeof key === 'string' && key.startsWith('trust:')) {
                values.push(await request(db.transaction('settings').objectStore('settings').get(key) as IDBRequest<OfflineTrust>));
            }
        }
        return values;
    }
    finally {
        db.close();
    }
}
export async function prepareOfflineStorage(requiredBytes: number): Promise<void> {
    if (!window.isSecureContext || !navigator.storage?.persist || !navigator.locks) {
        throw new Error('Offline hraní vyžaduje podporovaný Chrome na bezpečné adrese.');
    }
    if (!await navigator.storage.persist()) {
        throw new Error('Prohlížeč nepovolil trvalé úložiště. Nainstalujte aplikaci a potvrďte uchování dat.');
    }
    await verifyOfflineStorageWrite(requiredBytes);
}

export async function verifyStoredOfflineStorage(): Promise<void> {
    if (!window.isSecureContext || !navigator.storage?.persisted || !navigator.locks) {
        throw new Error('Offline hraní vyžaduje podporovaný Chrome na bezpečné adrese.');
    }
    if (!await navigator.storage.persisted()) {
        throw new Error('Prohlížeč nepotvrdil trvalé úložiště. Připravte offline aplikaci znovu.');
    }
    await verifyOfflineStorageWrite(0);
}

async function verifyOfflineStorageWrite(requiredBytes: number): Promise<void> {
    const estimate = await navigator.storage.estimate();
    if (estimate.quota === undefined || estimate.quota - (estimate.usage ?? 0) < requiredBytes + 16 * 1024 * 1024) {
        throw new Error('Pro offline soubor není dostatek volného místa.');
    }
    const db = await database();
    try {
        const tx = strict(db, 'settings'), commit = done(tx);
        tx.objectStore('settings').put(crypto.randomUUID(), 'write-probe');
        await commit;
    }
    finally {
        db.close();
    }
}
export async function withOfflineWriter<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    if (!navigator.locks) {
        throw new Error('Prohlížeč nepodporuje ochranu souběžných oken.');
    }
    return navigator.locks.request(`justkviz-offline-writer:${sessionId}`, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock) {
            throw new Error('Tento offline kvíz právě ovládá jiné okno.');
        }
        return work();
    });
}
export async function acquireOfflineWriter(sessionId: string): Promise<() => void> {
    if (!navigator.locks) {
        throw new Error('Prohlížeč nepodporuje ochranu souběžných oken.');
    }
    return new Promise((resolve, reject) => {
        void navigator.locks.request(`justkviz-offline-writer:${sessionId}`, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
            if (!lock) {
                reject(new Error('Tento offline kvíz právě ovládá jiné okno.'));
                return;
            }
            await new Promise<void>(release => {
                resolve(release);
            });
        }).catch(reject);
    });
}
