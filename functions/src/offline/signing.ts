import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError } from 'firebase-functions/v2/https';
import { canonicalOfflineJson, type OfflineGrant, type OfflineGrantPayload, type OfflineTrust } from '@filmovy-kviz/quiz-domain';
import { offlineCloudActivation, offlineDemoProject, type OfflineScope } from './activation.js';

export const offlineDigest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const unavailable = () => new HttpsError('failed-precondition', 'Podpis offline kvízu není dostupný.');
const signingSecret = offlineCloudActivation()?.mode === 'enabled' ? defineSecret('JUSTKVIZ_OFFLINE_SIGNING_KEY') : undefined;
export const offlineSigningSecrets: ReturnType<typeof defineSecret>[] = signingSecret ? [signingSecret] : [];

interface SigningKey { privateKey: KeyObject; trust: OfflineTrust }

function signingKey(privatePem: string, scope: OfflineScope): SigningKey {
  try {
    if (privatePem.length > 4096 || !/^-----BEGIN PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END PRIVATE KEY-----\r?\n?$/u.test(privatePem))
      throw unavailable();
    const privateKey = createPrivateKey(privatePem);
    if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw unavailable();
    const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
    if (!jwk.x || !jwk.y) throw unavailable();
    const publicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true, key_ops: ['verify'] };
    return { privateKey, trust: { schemaVersion: 1, keyId: offlineDigest(canonicalOfflineJson(publicJwk)), publicJwk, ...scope } };
  } catch { throw unavailable(); }
}

/** Resolve a cloud key before the first privileged request operation. Demo never reads it. */
export function cloudOfflineSigner(scope: OfflineScope): SigningKey | undefined {
  if (scope.environment === offlineDemoProject) return undefined;
  try {
    if (!signingSecret) throw unavailable();
    return signingKey(signingSecret.value(), scope);
  } catch { throw unavailable(); }
}

/** The stable emulator keyring is server-only and kept separate from cloud issuance. */
export async function demoOfflineSigner(scope: OfflineScope): Promise<SigningKey> {
  if (scope.environment !== offlineDemoProject) throw unavailable();
  const db = getFirestore(), ref = db.doc('offlineSigningKeys/demo-v1');
  const current = await ref.get();
  if (!current.exists) {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const privatePem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const { trust } = signingKey(privatePem, scope);
    await db.runTransaction(async tx => {
      if (!(await tx.get(ref)).exists) tx.create(ref, { privatePem, trust, createdAt: Timestamp.now() });
    });
  }
  const stored = (await ref.get()).data();
  if (typeof stored?.privatePem !== 'string' || !stored.trust) throw unavailable();
  const key = signingKey(stored.privatePem, scope);
  if (canonicalOfflineJson(stored.trust) !== canonicalOfflineJson(key.trust)) throw unavailable();
  return key;
}

export function signOfflineGrant(payload: OfflineGrantPayload, key: SigningKey): OfflineGrant {
  if (payload.environment !== key.trust.environment || payload.audience !== key.trust.audience) throw unavailable();
  const bytes = Buffer.from(canonicalOfflineJson(payload), 'utf8');
  try {
    return { payload, digest: offlineDigest(bytes), keyId: key.trust.keyId,
      signature: sign('sha256', bytes, { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
  } catch { throw unavailable(); }
}
