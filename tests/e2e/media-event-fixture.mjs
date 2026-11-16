import { seedEmulatorMembership } from '../../functions/lib/dev/seed-membership.js';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

export async function mediaEventFixture() {
  const env = requireFullEmulatorEnvironment(process.env, 'Media event fixture');
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const adminSdk = require('firebase-admin/app');
  const app = adminSdk.initializeApp({ projectId: env.projectId }, 'media-' + randomUUID());
  const auth = require('firebase-admin/auth').getAuth(app);
  const db = require('firebase-admin/firestore').getFirestore(app);
  const loginEmail = 'media-' + randomUUID() + '@example.test', loginPassword = randomUUID();
  const user = await auth.createUser({ email: loginEmail, password: loginPassword });
  await auth.setCustomUserClaims(user.uid, { role: 'admin' }); await seedEmulatorMembership(user.uid, 'admin');
  const clients = [], extraUsers = [];
  const client = () => {
    const app = initializeApp({ projectId: env.projectId, apiKey: 'demo-api-key' }, randomUUID());
    clients.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${env.authEndpoint.host}:${env.authEndpoint.port}`, { disableWarnings: true });
    const functions = getFunctions(app, 'europe-west1');
    connectFunctionsEmulator(functions, env.functionsEndpoint.host, env.functionsEndpoint.port);
    return { auth, call: async (name, data) => (await httpsCallable(functions, name)(data)).data };
  };
  const admin = client();
  await signInWithEmailAndPassword(admin.auth, loginEmail, loginPassword);
  const { eventId } = await admin.call('createEvent', { expectedRevision: 0, event: {
    title: 'Syntetický mediální večer', startsAt: '2031-11-20T18:00:00Z', timeZone: 'Europe/Prague',
    venue: { name: 'Syntetický sál', publicLocation: 'Praha' }, teamCapacity: 30, peopleCapacity: 120, teamSizeMin: 2, teamSizeMax: 4,
  } });
  await admin.call('configureEventRegistration', { eventId, expectedRevision: 1, published: true,
    registrationOpensAt: '2020-01-01T00:00:00Z', registrationClosesAt: '2030-01-01T00:00:00Z' });
  const eventRef = db.collection('events').doc(eventId);
  return { db, eventId, eventRef, loginEmail, loginPassword,
    async dispose() {
      // This random fixture event and user exist only behind the strict demo/local guard.
      requireFullEmulatorEnvironment(process.env, 'Media event cleanup');
      await db.recursiveDelete(eventRef);
      await db.collection('publicEvents').doc(eventId).delete();
      await auth.deleteUser(user.uid);
      await Promise.all(extraUsers.map(uid => auth.deleteUser(uid)));
      await Promise.all(clients.map(app => deleteApp(app)));
      await adminSdk.deleteApp(app);
    },
  };
}
