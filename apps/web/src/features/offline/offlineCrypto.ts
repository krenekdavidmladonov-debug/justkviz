import { canonicalOfflineJson, type OfflineEventManifest, type OfflineGrant, type OfflineTrust } from '@filmovy-kviz/quiz-domain';
export const offlineKdfIterations = 310000;
export function encodeBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function decodeBase64(value: string, maximum = 10000): Uint8Array<ArrayBuffer> {
    if (typeof value !== 'string' || value.length > maximum || !/^[A-Za-z0-9_-]*$/u.test(value)) {
        throw new Error('Neplatné šifrování souboru.');
    }
    const decoded = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(decoded, char => char.charCodeAt(0));
}
export async function offlineDigest(value: BufferSource | string): Promise<string> {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function deriveOfflineKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations = offlineKdfIterations): Promise<CryptoKey> {
    if (password.length < 10 || password.length > 200 || salt.length !== 16 || iterations < 100000 || iterations > 500000) {
        throw new Error('Použijte heslo alespoň o 10 znacích.');
    }
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export interface EncryptedOfflineValue {
    readonly iv: string;
    readonly bytes: ArrayBuffer;
}
export async function encryptOfflineValue(key: CryptoKey, value: unknown, binding: string): Promise<EncryptedOfflineValue> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return { iv: encodeBase64(iv), bytes: await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(binding) }, key, new TextEncoder().encode(canonicalOfflineJson(value))) };
}
export async function decryptOfflineValue(key: CryptoKey, value: EncryptedOfflineValue, binding: string): Promise<unknown> {
    try {
        const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(value.iv), additionalData: new TextEncoder().encode(binding) }, key, value.bytes);
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    }
    catch {
        throw new Error('Nesprávné heslo nebo poškozená uložená data.');
    }
}
export async function verifyOfflineGrant(manifest: OfflineEventManifest, grant: OfflineGrant, trust: OfflineTrust): Promise<void> {
    const payload = grant.payload;
    if (!payload || payload.schemaVersion !== 1 || grant.keyId !== trust.keyId || trust.environment !== manifest.environment || trust.audience !== manifest.audience
        || payload.environment !== trust.environment || payload.audience !== trust.audience || payload.exportId !== manifest.exportId || payload.sessionId !== manifest.sessionId
        || payload.eventId !== manifest.event.id || payload.snapshotId !== manifest.snapshot.id || payload.issuedAtMs !== manifest.issuedAtMs || payload.expiresAtMs !== manifest.expiresAtMs
        || payload.manifestDigest !== await offlineDigest(canonicalOfflineJson(manifest)) || grant.digest !== await offlineDigest(canonicalOfflineJson(payload))) {
        throw new Error('Podpis kvízu neodpovídá důvěryhodné přípravě.');
    }
    try {
        const key = await crypto.subtle.importKey('jwk', trust.publicJwk as JsonWebKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decodeBase64(grant.signature, 1000), new TextEncoder().encode(canonicalOfflineJson(payload)))) {
            throw new Error();
        }
    }
    catch {
        throw new Error('Podpis offline kvízu není platný.');
    }
}
