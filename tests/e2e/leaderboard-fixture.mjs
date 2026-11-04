import { seedEmulatorMembership } from '../../functions/lib/dev/seed-membership.js';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
export async function leaderboardFixture(count = 4) {
    const env = requireFullEmulatorEnvironment(process.env, 'Leaderboard fixtures');
    const require = createRequire(new URL('../../functions/package.json', import.meta.url));
    const adminSdk = require('firebase-admin/app'), a = adminSdk.initializeApp({ projectId: env.projectId }, 'leaderboard-' + randomUUID());
    const db = require('firebase-admin/firestore').getFirestore(a), authAdmin = require('firebase-admin/auth').getAuth(a), apps = [], users = [];
    function client() { const app = initializeApp({ apiKey: 'demo-api-key', projectId: env.projectId }, randomUUID()); apps.push(app); const auth = getAuth(app); connectAuthEmulator(auth, `http://${env.authEndpoint.host}:${env.authEndpoint.port}`, { disableWarnings: true }); const f = getFunctions(app, 'europe-west1'); connectFunctionsEmulator(f, env.functionsEndpoint.host, env.functionsEndpoint.port); const store = getFirestore(app); connectFirestoreEmulator(store, env.firestoreEndpoint.host, env.firestoreEndpoint.port); return { auth, store, call: async (name, data) => (await httpsCallable(f, name)(data)).data }; }
    async function staff(role) { const c = client(), login = { email: randomUUID() + '@example.test', password: randomUUID() }; const u = await authAdmin.createUser(login); users.push(u.uid); await authAdmin.setCustomUserClaims(u.uid, { role }); await seedEmulatorMembership(u.uid, role); await signInWithEmailAndPassword(c.auth, login.email, login.password); return { ...c, login, uid: u.uid }; }
    const admin = await staff('admin'), moderator = await staff('moderator'), anonymous = client();
    const created = await admin.call('createEvent', { expectedRevision: 0, event: { title: 'Synthetic interim results', startsAt: '2031-11-20T18:00:00Z', timeZone: 'Europe/Prague', venue: { name: 'Synthetic', publicLocation: 'Synthetic' }, teamCapacity: 100, peopleCapacity: 200, teamSizeMin: 2, teamSizeMax: 4 } });
    const eventId = created.eventId, snapshotId = 'leaderboard-snapshot-' + randomUUID(), roundIds = ['r1', 'r2', 'r3'];
    await db.doc('events/' + eventId).set({ schemaVersion: 1, title: 'Synthetic interim results', lifecycleStatus: 'ready', registrationStatus: 'closed', revision: 1, scoring: { unitScale: 2, rankingMode: 'dense', started: true }, quizAssignment: { snapshotId, quizId: 'synthetic-library', quizRevision: 0, quizTitle: 'Synthetic immutable quiz', roundCount: 3, questionCount: 4, lockedAt: require('firebase-admin/firestore').Timestamp.now() }, acceptedTeams: count, acceptedPeople: count * 2, teamCapacity: 100, peopleCapacity: 200, teamSizeMin: 2, teamSizeMax: 4 }, { merge: true });
    await db.doc('quizSnapshots/' + snapshotId).set({ eventId, quizId: 'synthetic-library', slideCount: 4, roundCount: 3, title: 'Synthetic immutable quiz' });
    for (let i = 0; i < 3; i++)
        await db.doc(`quizSnapshots/${snapshotId}/rounds/${roundIds[i]}`).set({ title: 'Kolo ' + (i + 1), position: i + 1 });
    for (let i = 1; i <= 4; i++)
        await db.doc(`quizSnapshots/${snapshotId}/slides/s${i}`).set({ position: i, kind: i === 2 ? 'audio' : 'classic', isQuestion: true, title: 'Synthetic question ' + i, text: 'Synthetic prompt', roundId: roundIds[Math.min(i - 1, 2)], correctAnswer: 'PRIVATE ANSWER SENTINEL', options: [], media: [], ...(i === 2 ? { mediaSource: 'https://www.youtube.com/watch?v=synthetic00' } : {}) });
    const teamIds = [];
    const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
    for (let i = 0; i < count; i++) {
        const id = 'team-' + String(i).padStart(3, '0');
        teamIds.push(id);
        await db.doc(`events/${eventId}/registrations/${id}`).set({ eventId, teamName: ['Alfa', 'Beta', 'Gama', 'Delta'][i] ?? ('Tým ' + String(i + 1).padStart(2, '0')), status: 'accepted', source: i % 2 ? 'online' : 'manual', contactEmail: 'PRIVATE CONTACT', managementTokenHash: 'PRIVATE MANAGEMENT', revision: 1, memberCount: 2 });
        for (let r = 0; r < 3; r++) {
            const halfPoints = r === 2 ? 999 : i >= 4 ? 0 : r === 0 ? 20 : [20, 15, 15, 10][i];
            await db.doc(`events/${eventId}/scores/${hash([id, roundIds[r]])}`).set({ teamId: id, roundId: roundIds[r], snapshotId, halfPoints, revision: 1 });
        }
    }
    await db.doc(`events/${eventId}/registrations/cancelled`).set({ eventId, teamName: 'Cancelled must be absent', status: 'cancelled', revision: 1 });
    const { sessionId } = await moderator.call('createEventLiveSession', { eventId, expectedRevision: 1 });
    await moderator.call('nextSlide', { sessionId, expectedRevision: 0 });
    const fixture = { db, admin, moderator, anonymous, authAdmin, eventId, snapshotId, sessionId, roundIds, teamIds, login: moderator.login,
        call: moderator.call,
        referee: async () => { const g = await admin.call('issueRefereeAccess', { eventId, requestId: randomUUID(), label: 'Synthetic referee', expiresAt: new Date(Date.now() + 86400000).toISOString() }); return { eventId, accessId: g.accessId, key: g.key }; },
        publicState: async () => (await db.doc('publicSessions/' + sessionId).get()).data(),
        session: async () => (await db.doc('sessions/' + sessionId).get()).data(),
        preview: async (round = 'r2') => moderator.call('previewInterimResults', { eventId, sessionId, throughRoundId: round }),
        score: async (i, r, value) => { const ref = db.doc(`events/${eventId}/scores/${hash([teamIds[i], roundIds[r]])}`), s = (await ref.get()).data(); return admin.call('saveEventScore', { eventId, snapshotId, teamId: teamIds[i], roundId: roundIds[r], expectedRevision: s.revision, halfPoints: value, reason: 'Synthetic correction', requestId: randomUUID() }); },
        close: async () => { for (const app of apps)
            await deleteApp(app); for (const uid of users)
            await authAdmin.deleteUser(uid); await adminSdk.deleteApp(a); },
    };
    return fixture;
}
