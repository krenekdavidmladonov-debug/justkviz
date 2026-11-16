import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, test } from 'vitest';
import { permissions } from '../packages/quiz-domain/src/access';

const projectId = 'demo-filmovy-kviz-v2';
const identities = ['anonymous', 'self', 'legacy-admin', 'active-admin', 'active-owner'] as const;
const statePath = (uid: string) => `driveOAuthStates/${createHash('sha256').update(uid).digest('hex')}`;
let environment: RulesTestEnvironment;

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const endpoint = /^(localhost|127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})$/.exec(host ?? '');
  if (!endpoint || Number(endpoint[2]) > 65_535) {
    throw new Error('Drive privacy tests require a loopback Firestore emulator.');
  }
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8') },
  });
});

beforeEach(async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const identity of identities.filter(value => value !== 'anonymous')) {
      await setDoc(doc(db, `driveConnections/${identity}`), {
        uid: identity,
        refreshTokenEnvelope: { keyId: 'synthetic', ciphertext: 'synthetic-ciphertext' },
      });
      await setDoc(doc(db, statePath(identity)), {
        uid: identity, membershipVersion: 1, expiresAt: 2_000_000_000,
        verifierEnvelope: { keyId: 'synthetic', ciphertext: 'synthetic-ciphertext' },
      });
    }
    for (const role of ['admin', 'owner']) {
      const uid = `active-${role}`;
      await setDoc(doc(db, `memberships/${uid}`), {
        uid, status: 'active', version: 1, sessionValidAfter: 0,
        role: role === 'admin' ? 'manager' : 'owner', permissions,
        quizzes: { mode: 'all', ids: [] }, events: { mode: 'all', ids: [] },
      });
    }
    for (const path of ['driveConnections/self/secrets/synthetic', `${statePath('self')}/secrets/synthetic`]) {
      await setDoc(doc(db, path), { ciphertext: 'synthetic-nested-ciphertext' });
    }
  });
});

afterEach(async () => { await environment?.clearFirestore(); });
afterAll(async () => { await environment?.cleanup(); });

describe('Drive OAuth server-only data', () => {
  for (const identity of identities) {
    test(`denies every client operation, including own connection and nested secrets: ${identity}`, async () => {
      const db = identity === 'anonymous' ? environment.unauthenticatedContext().firestore()
        : environment.authenticatedContext(identity, {
          role: identity === 'legacy-admin' ? 'admin' : 'owner',
          email_verified: true, auth_time: 2_000_000_000,
        }).firestore();

      // Prove the privileged fixtures have readable current memberships; their
      // broad staff grants still confer no direct access to connection secrets.
      if (identity.startsWith('active-')) {
        await assertSucceeds(getDoc(doc(db, `memberships/${identity}`)));
      }

      const ownId = identity === 'anonymous' ? 'self' : identity;
      const paths = [
        `driveConnections/${ownId}`,
        'driveConnections/self',
        statePath(ownId),
        statePath('self'),
        'driveConnections/self/secrets/synthetic',
        `${statePath('self')}/secrets/synthetic`,
      ];
      for (const path of new Set(paths)) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(updateDoc(doc(db, path), { compromised: true }));
        await assertFails(deleteDoc(doc(db, path)));
      }
      for (const path of [
        'driveConnections', 'driveOAuthStates',
        'driveConnections/self/secrets', `${statePath('self')}/secrets`,
      ]) {
        await assertFails(getDocs(collection(db, path)));
        await assertFails(setDoc(doc(db, `${path}/forged`), { uid: ownId, ciphertext: 'forged' }));
      }
      // Even a signed-in user cannot bootstrap their own missing connection.
      await environment.withSecurityRulesDisabled(async context => {
        await deleteDoc(doc(context.firestore(), `driveConnections/${ownId}`));
      });
      await assertFails(setDoc(doc(db, `driveConnections/${ownId}`), { uid: ownId, connected: true }));
    });
  }
});
