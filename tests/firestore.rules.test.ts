import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { permissions } from '../packages/quiz-domain/src/access';

const projectId = 'demo-filmovy-kviz-v2';
const privateQuizPath = 'quizzes/security-test-quiz';
const privateRoundPath = `${privateQuizPath}/rounds/security-test-round`;
const privateSlidePath = `${privateQuizPath}/slides/security-test-slide`;
const privateQuestionPath = `${privateRoundPath}/questions/security-test-question`;
const privateSessionPath = 'sessions/security-test-session';
const publicSessionPath = 'publicSessions/security-test-session';
const privateEventPath = 'events/security-test-event';
const privateEventChildPath = `${privateEventPath}/future/private-child`;
const privateRegistrationPath = `${privateEventPath}/registrations/security-registration`;
const privateRegistrationNamePath = `${privateEventPath}/registrationNames/private-hash`;
const privateSnapshotPath = 'quizSnapshots/security-test-snapshot';
const privateSnapshotSlidePath = `${privateSnapshotPath}/slides/security-test-slide`;
const publicEventPath = 'publicEvents/security-test-event';

let testEnvironment: RulesTestEnvironment;

test('even a fully authorized owner cannot read or reset server registration limits', async () => {
  const uid = 'limit-owner', path = privateEventPath + '/registrationAbuse/synthetic-hash';
  await testEnvironment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'memberships/' + uid), { uid, role: 'owner', status: 'active', version: 1, sessionValidAfter: 0,
      permissions, quizzes: { mode: 'all', ids: [] }, events: { mode: 'all', ids: [] } });
    await setDoc(doc(context.firestore(), path), { tokens: 0, updatedAtMillis: 1 });
  });
  const db = testEnvironment.authenticatedContext(uid, { role: 'owner', email_verified: true, auth_time: 2000000000 }).firestore();
  await assertSucceeds(getDoc(doc(db, privateEventPath)));
  await assertFails(getDoc(doc(db, path)));
  await assertFails(getDocs(collection(db, privateEventPath + '/registrationAbuse')));
  await assertFails(setDoc(doc(db, path), { tokens: 3 }));
  await assertFails(updateDoc(doc(db, path), { tokens: 3 }));
  await assertFails(deleteDoc(doc(db, path)));
});

describe('transactional registration email privacy', () => {
  test('even a current owner cannot inspect, redirect, inject or delete organizer notification intents', async () => {
    const uid = 'notification-owner', path = `${privateEventPath}/emailIntents/organizer-synthetic`;
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, `memberships/${uid}`), { uid, role: 'owner', status: 'active', version: 1, sessionValidAfter: 0,
        permissions, quizzes: { mode: 'all', ids: [] }, events: { mode: 'all', ids: [] } });
      await setDoc(doc(db, path), { type: 'registration-organizer-notification', ownerUid: uid, recipient: 'owner@example.test',
        recipientPolicy: 'future-public-registration-owner', provenance: 'public-registration-create', status: 'pending' });
    });
    const db = testEnvironment.authenticatedContext(uid, { role: 'owner', email_verified: true, auth_time: 2000000000 }).firestore();
    await assertSucceeds(getDoc(doc(db, privateEventPath)));
    await assertFails(getDoc(doc(db, path)));
    await assertFails(getDocs(collection(db, `${privateEventPath}/emailIntents`)));
    await assertFails(setDoc(doc(db, `${privateEventPath}/emailIntents/organizer-forged`), { recipient: 'attacker@example.test' }));
    await assertFails(updateDoc(doc(db, path), { recipient: 'attacker@example.test', status: 'pending' }));
    await assertFails(deleteDoc(doc(db, path)));
    await assertFails(updateDoc(doc(db, privateRegistrationPath), { emailDelivery: { type: 'registration-organizer-notification', status: 'sent' } }));
  });
  for (const role of [null, 'user', 'moderator', 'admin']) {
    test('only server owns intents, encrypted capabilities and receipts: ' + String(role), async () => {
      const db = role === null ? testEnvironment.unauthenticatedContext().firestore()
        : testEnvironment.authenticatedContext('email-' + role, { role, email_verified: true, auth_time: 2000000000 }).firestore();
      for (const child of ['emailIntents', 'emailSecrets', 'emailCampaigns', 'registrationOperations', 'registrationAbuse']) {
        const path = `${privateEventPath}/${child}/synthetic`;
        await testEnvironment.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), path), { status: 'pending' }); });
        await assertFails(getDoc(doc(db, path)));
        await assertFails(getDocs(collection(db, `${privateEventPath}/${child}`)));
        await assertFails(setDoc(doc(db, `${privateEventPath}/${child}/forged`), { recipient: 'forged@example.test' }));
        await assertFails(updateDoc(doc(db, path), { status: 'sent' }));
        await assertFails(deleteDoc(doc(db, path)));
      }
      await assertFails(updateDoc(doc(db, privateRegistrationPath), { emailDelivery: { status: 'sent' } }));
    });
  }
});

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    // Legacy compatibility cases now prove explicit current memberships, never claims authority.
    for (const role of ['admin', 'moderator']) for (const uid of [`${role}-user`, `email-${role}`, `score-${role}`, `leaderboard-${role}`, `media-${role}`, `ref-${role}`, `migration-${role}`]) {
      await setDoc(doc(context.firestore(), `memberships/${uid}`), { uid, status: 'active', version: 1, sessionValidAfter: 0,
        role: role === 'admin' ? 'manager' : 'moderator', permissions, quizzes: { mode: 'all', ids: [] }, events: { mode: 'all', ids: [] } });
    }
    await setDoc(doc(context.firestore(), privateQuizPath), {
      title: 'Security test quiz',
      status: 'draft',
    });
    await setDoc(doc(context.firestore(), privateRoundPath), {
      title: 'Security test round',
      position: 1,
    });
    await setDoc(doc(context.firestore(), privateSlidePath), {
      position: 1,
      correctAnswer: 'Private slide answer',
    });
    await setDoc(doc(context.firestore(), privateQuestionPath), {
      prompt: 'Private question',
      correctAnswer: 'Private answer',
      position: 1,
    });
    await setDoc(doc(context.firestore(), privateSessionPath), {
      quizId: 'security-test-quiz',
      status: 'active',
      currentSlidePosition: 1,
      answerRevealed: false,
      revision: 1,
    });
    await setDoc(doc(context.firestore(), publicSessionPath), {
      sessionId: 'security-test-session',
      status: 'active',
      slidePosition: 1,
      answerRevealed: false,
      title: 'Public prompt',
    });
    await setDoc(doc(context.firestore(), privateEventPath), {
      title: 'Private event', revision: 1, lifecycleStatus: 'scheduled',
    });
    await setDoc(doc(context.firestore(), 'events/security-test-event/scores/pair'), { halfPoints: 0, revision: 1 });
    await setDoc(doc(context.firestore(), 'events/security-test-event/scores/pair/history/1'), { halfPoints: 0, revision: 1 });
    await setDoc(doc(context.firestore(), privateEventChildPath), { secret: true });
    await setDoc(doc(context.firestore(), privateRegistrationPath), { teamName: 'Synthetic team', contactEmail: 'team@example.test' });
    await setDoc(doc(context.firestore(), privateRegistrationNamePath), { registrationId: 'security-registration' });
    await setDoc(doc(context.firestore(), privateSnapshotPath), {
      quizId: 'security-test-quiz', quizRevision: 1,
    });
    await setDoc(doc(context.firestore(), privateSnapshotSlidePath), {
      correctAnswer: 'Private snapshot answer',
    });
    await setDoc(doc(context.firestore(), publicEventPath), {
      title: 'Public event', registrationStatus: 'scheduled', registrationPublished: true,
    });
  });
});

afterEach(async () => {
  await testEnvironment.clearFirestore();
});

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe('anonymous user', () => {
  test('cannot read private data', async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, privateQuizPath)));
    await assertFails(getDoc(doc(db, privateSlidePath)));
    await assertFails(getDoc(doc(db, privateQuestionPath)));
    await assertFails(getDoc(doc(db, privateSessionPath)));
    await assertFails(getDoc(doc(db, privateEventPath)));
    await assertFails(getDoc(doc(db, privateRegistrationPath)));
    await assertFails(getDocs(collection(db, `${privateEventPath}/registrations`)));
    await assertFails(getDoc(doc(db, privateSnapshotPath)));
    await assertFails(getDoc(doc(db, privateSnapshotSlidePath)));
  });

  test('cannot write private data', async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'quizzes/anonymous-write'), { title: 'Denied' }));
    await assertFails(setDoc(doc(db, privateSessionPath), { status: 'ended' }));
  });

  test('can get one public session but cannot list or write public sessions', async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, publicSessionPath)));
    await assertFails(getDocs(collection(db, 'publicSessions')));
    await assertFails(setDoc(doc(db, publicSessionPath), { answerRevealed: true }));
  });

  test('can read and query public events but cannot write them', async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, publicEventPath)));
    await assertSucceeds(getDocs(query(collection(db, 'publicEvents'), where('registrationPublished', '==', true))));
    await assertFails(getDocs(collection(db, 'publicEvents')));
    await assertFails(setDoc(doc(db, publicEventPath), { title: 'Forged' }));
  });

  test('unpublished ready events are denied by direct reads and list queries, including after hiding', async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();
    const hiddenPath = 'publicEvents/hidden-ready';
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), hiddenPath), { title: 'Ready but hidden', lifecycleStatus: 'ready', registrationPublished: false });
      await setDoc(doc(context.firestore(), 'publicEvents/legacy-hidden'), { title: 'No explicit publication flag' });
    });
    await assertFails(getDoc(doc(db, hiddenPath)));
    await assertFails(getDoc(doc(db, 'publicEvents/legacy-hidden')));
    await assertFails(getDocs(query(collection(db, 'publicEvents'), where('registrationPublished', '==', false))));
    const visible = await assertSucceeds(getDocs(query(collection(db, 'publicEvents'), where('registrationPublished', '==', true))));
    expect(visible.docs.map(item => item.id)).toEqual(['security-test-event']);
    await testEnvironment.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), publicEventPath), { registrationPublished: false }));
    await assertFails(getDoc(doc(db, publicEventPath)));
    expect((await assertSucceeds(getDocs(query(collection(db, 'publicEvents'), where('registrationPublished', '==', true))))).empty).toBe(true);
    // A staff identity never gains an alternate public read path to hidden projections.
    await assertFails(getDoc(doc(testEnvironment.authenticatedContext('admin-user', { email_verified: true, auth_time: 2000000000 }).firestore(), hiddenPath)));
  });

  test('cannot read unknown private event subpaths', async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, privateEventChildPath)));
  });
});

describe('authenticated user without a role', () => {
  test('cannot read private data', async () => {
    const db = testEnvironment.authenticatedContext('regular-user').firestore();
    await assertFails(getDoc(doc(db, privateQuizPath)));
    await assertFails(getDoc(doc(db, privateSlidePath)));
    await assertFails(getDoc(doc(db, privateSessionPath)));
    await assertFails(getDoc(doc(db, privateEventPath)));
    await assertFails(getDoc(doc(db, privateRegistrationPath)));
    await assertFails(getDoc(doc(db, privateSnapshotPath)));
  });

  test('cannot write private data', async () => {
    const db = testEnvironment.authenticatedContext('regular-user').firestore();
    await assertFails(setDoc(doc(db, 'quizzes/user-write'), { title: 'Denied' }));
    await assertFails(setDoc(doc(db, privateSessionPath), { revision: 99 }));
    await assertFails(setDoc(doc(db, publicSessionPath), { answerRevealed: true }));
  });
});

describe('moderator', () => {
  test('can read a quiz document', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator', email_verified: true, auth_time: 2000000000 })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateQuizPath)));
  });

  test('can read a round document', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator', email_verified: true, auth_time: 2000000000 })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateRoundPath)));
  });

  test('can read a private question document', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator', email_verified: true, auth_time: 2000000000 })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateQuestionPath)));
  });

  test('can read a private source slide document', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator', email_verified: true, auth_time: 2000000000 })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateSlidePath)));
  });

  test('can read but cannot directly write private live sessions', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator', email_verified: true, auth_time: 2000000000 })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateSessionPath)));
    await assertFails(setDoc(doc(db, privateSessionPath), { status: 'ended' }));
  });

  test('cannot write a quiz', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator', email_verified: true, auth_time: 2000000000 })
      .firestore();
    await assertFails(setDoc(doc(db, 'quizzes/moderator-write'), { title: 'Denied' }));
  });

  test('can read event registrations but not uniqueness state or write registration data', async () => {
    const db = testEnvironment
      .authenticatedContext('moderator-user', { role: 'moderator', email_verified: true, auth_time: 2000000000 })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateEventPath)));
    await assertSucceeds(getDoc(doc(db, privateRegistrationPath)));
    await assertSucceeds(getDocs(collection(db, `${privateEventPath}/registrations`)));
    await assertFails(getDoc(doc(db, privateRegistrationNamePath)));
    await assertFails(setDoc(doc(db, privateRegistrationPath), { teamName: 'Bypass' }));
    await assertFails(getDoc(doc(db, privateSnapshotPath)));
    await assertFails(getDoc(doc(db, privateSnapshotSlidePath)));
    await assertFails(setDoc(doc(db, privateEventPath), { title: 'Denied' }));
    await assertFails(setDoc(doc(db, privateSnapshotPath), { quizId: 'forged' }));
    await assertFails(getDoc(doc(db, privateEventChildPath)));
  });
});

describe('admin', () => {
  test('can read a quiz document', async () => {
    const db = testEnvironment
      .authenticatedContext('admin-user', { role: 'admin', email_verified: true, auth_time: 2000000000 })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateQuizPath)));
  });

  test('can read but cannot directly write a private live session', async () => {
    const db = testEnvironment
      .authenticatedContext('admin-user', { role: 'admin', email_verified: true, auth_time: 2000000000 })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateSessionPath)));
    await assertFails(setDoc(doc(db, privateSessionPath), { status: 'ended' }));
  });

  test('cannot bypass trusted editor Functions with a direct quiz write', async () => {
    const db = testEnvironment
      .authenticatedContext('admin-user', { role: 'admin', email_verified: true, auth_time: 2000000000 })
      .firestore();
    await assertFails(setDoc(doc(db, 'quizzes/admin-write'), { title: 'Denied' }));
  });

  test('can read event and snapshot data but cannot directly mutate authoritative event paths', async () => {
    const db = testEnvironment
      .authenticatedContext('admin-user', { role: 'admin', email_verified: true, auth_time: 2000000000 })
      .firestore();
    await assertSucceeds(getDoc(doc(db, privateEventPath)));
    await assertSucceeds(getDoc(doc(db, privateRegistrationPath)));
    await assertSucceeds(getDocs(collection(db, `${privateEventPath}/registrations`)));
    await assertFails(getDoc(doc(db, privateRegistrationNamePath)));
    await assertFails(getDoc(doc(db, privateSnapshotPath)));
    await assertFails(getDoc(doc(db, privateSnapshotSlidePath)));
    await assertFails(setDoc(doc(db, privateEventPath), { title: 'Bypass' }));
    await assertFails(setDoc(doc(db, privateEventChildPath), { secret: false }));
    await assertFails(setDoc(doc(db, privateRegistrationPath), { contactEmail: 'forged@example.test' }));
    await assertFails(setDoc(doc(db, privateSnapshotSlidePath), { correctAnswer: 'Bypass' }));
    await assertFails(setDoc(doc(db, publicEventPath), { title: 'Bypass' }));
  });
});

test('an unknown path remains denied even for an admin', async () => {
  const db = testEnvironment
    .authenticatedContext('admin-user', { role: 'admin', email_verified: true, auth_time: 2000000000 })
    .firestore();
  await assertFails(getDoc(doc(db, 'unknown/private-document')));
});

test('Drive pairing, device capabilities and import jobs remain server-only even for the active owner', async () => {
  const uid = 'companion-owner';
  const names = ['driveMediaCompanions', 'driveMediaPairings', 'driveMediaJobs'];
  await testEnvironment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'memberships/' + uid), { uid, status: 'active', version: 1, sessionValidAfter: 0,
      role: 'owner', permissions, quizzes: { mode: 'all', ids: [] }, events: { mode: 'all', ids: [] } });
    for (const name of names) await setDoc(doc(db, name + '/synthetic'), { ownerUid: uid, tokenHash: 'synthetic-verifier' });
  });
  for (const db of [testEnvironment.unauthenticatedContext().firestore(),
    testEnvironment.authenticatedContext(uid, { email_verified: true, auth_time: 2000000000 }).firestore()]) {
    for (const name of names) {
      await assertFails(getDoc(doc(db, name + '/synthetic')));
      await assertFails(getDocs(collection(db, name)));
      await assertFails(setDoc(doc(db, name + '/forged'), { ownerUid: uid }));
      await assertFails(updateDoc(doc(db, name + '/synthetic'), { revoked: false }));
      await assertFails(deleteDoc(doc(db, name + '/synthetic')));
    }
  }
});

describe('internal event scoring', () => {
  for (const role of [null, 'user', 'admin', 'moderator']) {
    test('score/history access for ' + String(role), async () => {
      const db = role === null ? testEnvironment.unauthenticatedContext().firestore()
        : testEnvironment.authenticatedContext('score-' + role, { role, email_verified: true, auth_time: 2000000000, managementToken: 'not-scoring-authority' }).firestore();
      const staff = role === 'admin' || role === 'moderator';
      for (const path of ['events/security-test-event/scores/pair', 'events/security-test-event/scores/pair/history/1']) {
        await (staff ? assertSucceeds : assertFails)(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { halfPoints: 20, revision: 1 }));
        await assertFails(updateDoc(doc(db, path), { halfPoints: 30 }));
        await assertFails(deleteDoc(doc(db, path)));
      }
      await (staff ? assertSucceeds : assertFails)(getDocs(collection(db, 'events/security-test-event/scores')));
      await (staff ? assertSucceeds : assertFails)(getDocs(collection(db, 'events/security-test-event/scores/pair/history')));
      await assertFails(getDoc(doc(db, 'events/security-test-event/scoreOperations/key')));
      await assertFails(setDoc(doc(db, 'events/security-test-event/scoreOperations/key'), { response: {} }));
    });
  }
});

describe('referee grants are server-only, capabilities do not grant Firestore roles', () => {
  for (const role of [null, 'referee', 'moderator', 'admin']) test('deny grant and limiter paths for ' + String(role), async () => {
    const db = role === null ? testEnvironment.unauthenticatedContext().firestore() : testEnvironment.authenticatedContext('ref-' + role, { role, email_verified: true, auth_time: 2000000000, refereeAccessId: 'fake', eventId: 'security-test-event' }).firestore();
    for (const path of ['events/security-test-event/refereeAccess/access', 'refereeRateLimits/ip']) {
      await assertFails(getDoc(doc(db, path))); await assertFails(setDoc(doc(db, path), { keyHash: 'forged' }));
      await assertFails(updateDoc(doc(db, path), { revoked: false })); await assertFails(deleteDoc(doc(db, path)));
    }
    if (role === 'referee') for (const path of ['events/security-test-event/scores/pair','events/security-test-event/scores/pair/history/1',privateSnapshotPath,privateRegistrationPath]) {
      await assertFails(getDoc(doc(db,path))); await assertFails(setDoc(doc(db,path),{forged:true}));
    }
  });
});

describe('interim result versions and publication authority', () => {
  for (const role of [null, 'user', 'referee', 'moderator', 'admin']) {
    test('private versions and read-only publication for ' + String(role), async () => {
      const db = role === null ? testEnvironment.unauthenticatedContext().firestore()
        : testEnvironment.authenticatedContext('leaderboard-' + role, { role, email_verified: true, auth_time: 2000000000, managementToken: 'not-staff', refereeAccessId: 'not-staff' }).firestore();
      const staff = role === 'admin' || role === 'moderator';
      for (const child of ['interimVersions', 'interimOperations', 'finalVersions', 'finalOperations']) {
        const path = `${privateSessionPath}/${child}/version`;
        await testEnvironment.withSecurityRulesDisabled(async context => {
          await setDoc(doc(context.firestore(), path), { rows: [{ teamName: 'Private' }], actorUid: 'staff', eventId: 'security-test-event' });
        });
        // Idempotency operation records remain server-only; only display versions are readable.
        const readable = staff && child.endsWith('Versions');
        await (readable ? assertSucceeds : assertFails)(getDoc(doc(db, path)));
        await (readable ? assertSucceeds : assertFails)(getDocs(collection(db, `${privateSessionPath}/${child}`)));
        await assertFails(setDoc(doc(db, path), { rows: [] }));
        await assertFails(updateDoc(doc(db, path), { rows: [] }));
        await assertFails(deleteDoc(doc(db, path)));
      }
      await assertSucceeds(getDoc(doc(db, publicSessionPath)));
      await assertFails(getDocs(collection(db, 'publicSessions')));
      await assertFails(setDoc(doc(db, publicSessionPath), { interimResults: { rows: [] } }));
      await assertFails(getDoc(doc(db, `${publicSessionPath}/interimVersions/version`)));
    });
  }
});

describe('completed event history with event.read only', () => {
  const eventId = 'history-event', sessionPath = 'sessions/history-session', versionPath = `${sessionPath}/finalVersions/confirmed`;
  async function historyFixture() {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, `events/${eventId}`), { lifecycleStatus: 'completed', createdBy: 'other' });
      await setDoc(doc(db, sessionPath), { eventId, status: 'ended', finalReveal: { versionId: 'confirmed' } });
      await setDoc(doc(db, versionPath), { rows: [{ rank: 1, teamName: 'Historical team', halfPoints: 19 }] });
      await setDoc(doc(db, 'memberships/history-reader'), { uid: 'history-reader', status: 'active', version: 1, sessionValidAfter: 0,
        permissions: ['event.read'], events: { mode: 'selected', ids: [eventId] }, quizzes: { mode: 'none', ids: [] } });
    });
    return testEnvironment.authenticatedContext('history-reader', { email_verified: true, auth_time: 2000000000 }).firestore();
  }
  test('scoped event reader can read completed history but cannot mutate or publish it', async () => {
    const db = await historyFixture();
    await assertSucceeds(getDoc(doc(db, sessionPath)));
    await assertSucceeds(getDoc(doc(db, versionPath)));
    for (const path of [sessionPath, versionPath, `${sessionPath}/finalOperations/forged`, `publicSessions/history-session`, `events/${eventId}/scores/forged`]) {
      await assertFails(setDoc(doc(db, path), { forged: true }));
      await assertFails(deleteDoc(doc(db, path)));
    }
    await assertFails(getDoc(doc(db, `${sessionPath}/finalOperations/receipt`)));
    await assertFails(getDoc(doc(db, privateQuizPath)));
  });
  test.each(['other-scope', 'missing-permission', 'revoked', 'trash'])('history is denied for %s', async scenario => {
    const db = await historyFixture();
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const store = context.firestore();
      if (scenario === 'other-scope') await updateDoc(doc(store, 'memberships/history-reader'), { events: { mode: 'selected', ids: ['other'] } });
      if (scenario === 'missing-permission') await updateDoc(doc(store, 'memberships/history-reader'), { permissions: [] });
      if (scenario === 'revoked') await updateDoc(doc(store, 'memberships/history-reader'), { status: 'revoked' });
      if (scenario === 'trash') await updateDoc(doc(store, `events/${eventId}`), { disposition: 'trash' });
    });
    await assertFails(getDoc(doc(db, versionPath)));
  });
  test('anonymous and unprivileged identities cannot read a known historical version', async () => {
    await historyFixture();
    await assertFails(getDoc(doc(testEnvironment.unauthenticatedContext().firestore(), versionPath)));
    await assertFails(getDoc(doc(testEnvironment.authenticatedContext('unknown', { email_verified: true, auth_time: 2000000000 }).firestore(), versionPath)));
  });
});

describe('owned quiz asset metadata', () => {
  for (const role of [null, 'user', 'moderator', 'admin']) {
    test('server-only immutable metadata and staff-only reads: ' + String(role), async () => {
      const db = role === null ? testEnvironment.unauthenticatedContext().firestore() : testEnvironment.authenticatedContext('media-' + role, {role, email_verified: true, auth_time: 2000000000}).firestore();
      const path=privateQuizPath+'/mediaAssets/synthetic';
      await testEnvironment.withSecurityRulesDisabled(async context => {await setDoc(doc(context.firestore(),path),{status:'ready',generation:'1'});});
      if(role==='admin'||role==='moderator') await assertSucceeds(getDoc(doc(db,path))); else await assertFails(getDoc(doc(db,path)));
      await assertFails(setDoc(doc(db,path),{status:'ready',generation:'forged'}));
      await assertFails(updateDoc(doc(db,path),{generation:'forged'}));
      await assertFails(deleteDoc(doc(db,path)));
    });
  }
});

for (const role of [null, 'user', 'moderator', 'admin']) {
  test('migration journals stay server-only: ' + String(role), async () => {
    const db = role === null ? testEnvironment.unauthenticatedContext().firestore()
      : testEnvironment.authenticatedContext('migration-' + role, { role, email_verified: true, auth_time: 2000000000 }).firestore();
    for (const suffix of ['', '/state/complete']) {
      const ref = doc(db, 'migrationV1Imports/synthetic' + suffix);
      await assertFails(getDoc(ref));
      await assertFails(setDoc(ref, { state: 'complete' }));
    }
  });
}
