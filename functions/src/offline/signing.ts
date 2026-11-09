import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { canonicalOfflineJson, type OfflineGrant, type OfflineGrantPayload, type OfflineTrust } from '@filmovy-kviz/quiz-domain';

export const offlineEnvironment = 'demo-filmovy-kviz-v2';
export const offlineAudience = 'justkviz-offline-v1';
export const offlineDigest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const unavailable = () => new HttpsError('failed-precondition', 'Podpis offline kvízu není dostupný.');

interface SigningKey { privatePem: string; trust: OfflineTrust }
/** Local emulator keyring only. The caller must pass requireDemoEmulators before any access.
 * This stable server-only key is never returned, logged, exported, or a cloud credential. */
async function signingKey(): Promise<SigningKey> {
  const db = getFirestore(), ref = db.doc('offlineSigningKeys/demo-v1');
  const current = await ref.get();
  if (!current.exists) {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = pair.publicKey.export({ format: 'jwk' });
    const publicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y!, ext: true, key_ops: ['verify'] };
    const trust: OfflineTrust = { schemaVersion: 1, keyId: offlineDigest(canonicalOfflineJson(publicJwk)), publicJwk,
      environment: offlineEnvironment, audience: offlineAudience };
    const privatePem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    await db.runTransaction(async tx => {
      if (!(await tx.get(ref)).exists) tx.create(ref, { privatePem, trust, createdAt: Timestamp.now() });
    });
  }
  const stored = (await ref.get()).data();
  const trust = stored?.trust as OfflineTrust | undefined;
  if (typeof stored?.privatePem !== 'string' || !trust || trust.schemaVersion !== 1 || trust.environment !== offlineEnvironment
    || trust.audience !== offlineAudience || trust.keyId !== offlineDigest(canonicalOfflineJson(trust.publicJwk))) throw unavailable();
  return { privatePem: stored.privatePem, trust };
}

export async function localOfflineTrust(): Promise<OfflineTrust> { return (await signingKey()).trust; }
export async function signOfflineGrant(payload: OfflineGrantPayload): Promise<OfflineGrant> {
  const key = await signingKey(), bytes = Buffer.from(canonicalOfflineJson(payload), 'utf8');
  try {
    return { payload, digest: offlineDigest(bytes), keyId: key.trust.keyId,
      signature: sign('sha256', bytes, { key: createPrivateKey(key.privatePem), dsaEncoding: 'ieee-p1363' }).toString('base64url') };
  } catch { throw unavailable(); }
}
