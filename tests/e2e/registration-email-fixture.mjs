import { seedEmulatorMembership } from '../../functions/lib/dev/seed-membership.js';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
import { FakeGmailProvider } from '../../functions/lib/dev/fake-gmail.js';
import { processEmailTask } from '../../functions/lib/email/task.js';
import { CaptureEmailTransport } from '../../functions/lib/dev/capture-email.js';
import { emulatorTokenVault } from '../../functions/lib/email/token-vault.js';
import { deliverRegistrationEmail } from '../../functions/lib/email/delivery.js';

export async function emailFixture({ gmail = false } = {}) {
  const env = requireFullEmulatorEnvironment(process.env, 'Registration email fixture');
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const adminSdk = require('firebase-admin/app');
  const app = adminSdk.initializeApp({ projectId: env.projectId }, 'email-' + randomUUID());
  const auth = require('firebase-admin/auth').getAuth(app);
  const db = require('firebase-admin/firestore').getFirestore(app);
  const loginEmail = 'email-' + randomUUID() + '@example.test', loginPassword = randomUUID();
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
  const admin = client(), anonymous = client();
  await signInWithEmailAndPassword(admin.auth, loginEmail, loginPassword);
  const { eventId } = await admin.call('createEvent', { expectedRevision: 0, event: {
    title: 'Syntetický emailový večer', startsAt: '2031-11-20T18:00:00Z', timeZone: 'Europe/Prague',
    venue: { name: 'Syntetický sál', publicLocation: 'Praha' }, teamCapacity: 30, peopleCapacity: 120, teamSizeMin: 2, teamSizeMax: 4,
  } });
  await admin.call('configureEventRegistration', { eventId, expectedRevision: 1, published: true,
    registrationOpensAt: '2020-01-01T00:00:00Z', registrationClosesAt: '2030-01-01T00:00:00Z' });
  const eventRef = db.collection('events').doc(eventId);
  const capture = gmail ? new FakeGmailProvider() : new CaptureEmailTransport();
  let clockMillis = Date.now();
  const clock = () => clockMillis;
  const vault = emulatorTokenVault();
  return {
    db, eventId, eventRef, loginEmail, loginPassword, capture,
    setAdminRole: async role => { await auth.setCustomUserClaims(user.uid, { role }); await seedEmulatorMembership(user.uid, role); },
    async roleCall(role) {
      const email = 'role-' + randomUUID() + '@example.test', password = randomUUID();
      const person = await auth.createUser({ email, password }); extraUsers.push(person.uid);
      if (role) { await auth.setCustomUserClaims(person.uid, { role }); await seedEmulatorMembership(person.uid, role); }
      const session = client(); await signInWithEmailAndPassword(session.auth, email, password);
      return session.call;
    },
    advance: (millis = 600001) => { clockMillis += millis; },
    clock, vault,
    publicCall: anonymous.call, adminCall: admin.call,
    intents: async registrationId => (await eventRef.collection('emailIntents').where('registrationId', '==', registrationId).get()).docs,
    deliver: (ref, origin = 'http://127.0.0.1:5196', transport = capture) => deliverRegistrationEmail(db, ref, transport, vault, origin, clock),
    deliverTask: (ref, origin = 'http://127.0.0.1:5196') => processEmailTask({ eventId, intentId: ref.id }, { db, transport: capture, vault, origin, clock }),
    async dispose() {
      // This random fixture event and user exist only behind the strict demo/local guard.
      requireFullEmulatorEnvironment(process.env, 'Registration email cleanup');
      await db.recursiveDelete(eventRef);
      await db.collection('publicEvents').doc(eventId).delete();
      await auth.deleteUser(user.uid);
      await Promise.all(extraUsers.map(uid => auth.deleteUser(uid)));
      await Promise.all(clients.map(app => deleteApp(app)));
      await adminSdk.deleteApp(app);
    },
  };
}
