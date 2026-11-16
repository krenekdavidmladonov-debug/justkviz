import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  decodeBase64, deriveOfflineKey, encryptOfflineValue, decryptOfflineValue,
  encodeBase64, offlineDigest, verifyOfflineGrant,
} from '../apps/web/src/features/offline/offlineCrypto';
import { canonicalOfflineJson, type OfflineGrant, type OfflineTrust } from '../packages/quiz-domain/src/offline-event';
import { offlineManifest } from './offline-fixture';

const manifest = offlineManifest();
const password = 'synthetic-offline-passphrase';
let key: CryptoKey, otherKey: CryptoKey, grant: OfflineGrant, trust: OfflineTrust;

beforeAll(async () => {
  key = await deriveOfflineKey(password, new Uint8Array(16).fill(1));
  otherKey = await deriveOfflineKey('another-synthetic-password', new Uint8Array(16).fill(1));
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const payload = { schemaVersion: 1 as const, exportId: manifest.exportId, sessionId: manifest.sessionId,
    eventId: manifest.event.id, snapshotId: manifest.snapshot.id, manifestDigest: await offlineDigest(canonicalOfflineJson(manifest)),
    issuedAtMs: manifest.issuedAtMs, expiresAtMs: manifest.expiresAtMs, audience: manifest.audience, environment: manifest.environment };
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(canonicalOfflineJson(payload)));
  grant = { payload, digest: await offlineDigest(canonicalOfflineJson(payload)), signature: encodeBase64(new Uint8Array(signature)), keyId: 'synthetic-p256-key' };
  trust = { schemaVersion: 1, keyId: grant.keyId, publicJwk: { ...await crypto.subtle.exportKey('jwk', pair.publicKey) },
    audience: manifest.audience, environment: manifest.environment };
});
afterEach(() => vi.restoreAllMocks());

describe('offline encryption and scoped signed grant', () => {
  it('round-trips an authenticated encrypted value and never stores plaintext private sentinels', async () => {
    const value = { secret: 'PRIVATE_OFFLINE_ANSWER_SENTINEL', journal: [{ sequence: 1, type: 'start' }] };
    const first = await encryptOfflineValue(key, value, 'synthetic-export:journal:1');
    const second = await encryptOfflineValue(key, value, 'synthetic-export:journal:1');
    expect(first.iv).not.toBe(second.iv);
    expect(new TextDecoder().decode(first.bytes)).not.toContain(value.secret);
    expect(await decryptOfflineValue(key, first, 'synthetic-export:journal:1')).toEqual(value);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('rejects wrong password, cross-export associated data and same-length ciphertext tampering', async () => {
    const sealed = await encryptOfflineValue(key, { value: 'PRIVATE' }, 'export-A:journal:1');
    await expect(decryptOfflineValue(otherKey, sealed, 'export-A:journal:1')).rejects.toThrow();
    await expect(decryptOfflineValue(key, sealed, 'export-B:journal:1')).rejects.toThrow();
    const damaged = new Uint8Array(sealed.bytes.slice(0)); damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 1;
    await expect(decryptOfflineValue(key, { ...sealed, bytes: damaged.buffer }, 'export-A:journal:1')).rejects.toThrow();
    const iv = decodeBase64(sealed.iv); iv[0] = iv[0]! ^ 1;
    await expect(decryptOfflineValue(key, { ...sealed, iv: encodeBase64(iv) }, 'export-A:journal:1')).rejects.toThrow();
  });

  it('rejects hostile KDF work factors and malformed base64url before cryptographic work', async () => {
    const salt = new Uint8Array(16);
    for (const [text, bytes, iterations] of [
      ['short', salt, 310_000], [password, new Uint8Array(15), 310_000],
      [password, salt, 99_999], [password, salt, 500_001],
    ] as const) await expect(deriveOfflineKey(text, bytes, iterations)).rejects.toThrow();
    for (const value of ['YWJj=', 'YW Jj', '../secret', '+///', 'a'.repeat(10001)]) expect(() => decodeBase64(value)).toThrow();
  });

  it('verifies an actual P-256 grant from the separately installed trust key', async () => {
    expect(decodeBase64(grant.signature)).toHaveLength(64);
    await expect(verifyOfflineGrant(manifest, grant, trust)).resolves.toBeUndefined();
  });

  it('rejects changes to manifest actor/version, snapshot, event, session, generation or asset digest', async () => {
    for (const changed of [
      { ...manifest, actorId: 'foreign-actor' }, { ...manifest, membershipVersion: manifest.membershipVersion + 1 },
      { ...manifest, snapshot: { ...manifest.snapshot, id: 'foreign-snapshot' } },
      { ...manifest, event: { ...manifest.event, id: 'foreign-event' } }, { ...manifest, sessionId: 'foreign-session' },
      { ...manifest, assets: [{ reference: 'quiz-asset:synthetic/' + 'a'.repeat(64), generation: 'changed',
        kind: 'image' as const, contentType: 'image/png' as const, size: 1, sha256: 'f'.repeat(64), etag: '"changed"' }] },
    ]) await expect(verifyOfflineGrant(changed, grant, trust)).rejects.toThrow();
  });

  it('rejects a self-selected signer, different audience/environment, signature corruption and digest substitution', async () => {
    const signature = decodeBase64(grant.signature); signature[0] = signature[0]! ^ 1;
    for (const changed of [
      { ...grant, keyId: 'foreign-key' }, { ...grant, signature: encodeBase64(signature) },
      { ...grant, digest: '0'.repeat(64) }, { ...grant, payload: { ...grant.payload, manifestDigest: '0'.repeat(64) } },
    ]) await expect(verifyOfflineGrant(manifest, changed, trust)).rejects.toThrow();
    for (const changed of [
      { ...trust, keyId: 'foreign-key' }, { ...trust, audience: 'foreign-audience' },
      { ...trust, environment: 'foreign-environment' }, { ...trust, publicJwk: {} },
    ]) await expect(verifyOfflineGrant(manifest, grant, changed)).rejects.toThrow();
  });
});
