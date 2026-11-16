import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { editorIdentity } from './editor-identity.mjs';
import { printRedesignData } from './print-redesign-data.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

export async function printRedesignFixture() {
  requireFullEmulatorEnvironment(process.env, 'Print redesign fixture');
  const identity = await editorIdentity();
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const { Timestamp } = require('firebase-admin/firestore');
  const data = printRedesignData('long');
  const created = await identity.call('createEvent', { expectedRevision: 0, event: { title: data.event.title, startsAt: '2031-11-20T18:00:00Z', timeZone: 'Europe/Prague', venue: { name: 'Syntetický sál', publicLocation: 'Praha' }, teamCapacity: 30, peopleCapacity: 180, teamSizeMin: 2, teamSizeMax: 4 } });
  const eventId = created.eventId, snapshotId = 'print-redesign-' + randomUUID(), quizId = 'print-redesign-' + randomUUID();
  const event = identity.db.doc('events/' + eventId), snapshot = identity.db.doc('quizSnapshots/' + snapshotId), quiz = identity.db.doc('quizzes/' + quizId);
  const batch = identity.db.batch();
  batch.set(snapshot, { ...data.snapshot, eventId, quizId, quizRevision: 0 });
  for (const round of data.rounds) batch.set(snapshot.collection('rounds').doc(round.id), round.data);
  for (const slide of data.slides) batch.set(snapshot.collection('slides').doc(slide.id), slide.data);
  batch.set(quiz, { title: 'NOVĚJŠÍ NEPUBLIKOVANÁ VERZE', revision: 9, printTemplate: { title: 'NEPUBLIKOVANÝ NADPIS NESMÍ DO PDF' } });
  for (const [index, team] of data.teams.entries()) batch.set(event.collection('registrations').doc(team.id), { eventId, teamName: team.name, status: 'accepted', source: 'manual', contactEmail: 'PRIVATE_CONTACT@example.test', managementTokenHash: null, memberCount: 4, revision: 1, createdAt: Timestamp.fromMillis(Date.now() + index), updatedAt: Timestamp.now() });
  batch.set(event.collection('registrations').doc('cancelled'), { eventId, teamName: 'ZRUŠENÝ TÝM', status: 'cancelled', createdAt: Timestamp.now() });
  batch.update(event, { lifecycleStatus: 'ready', acceptedTeams: 2, acceptedPeople: 8, quizAssignment: { snapshotId, quizId, quizRevision: 0, quizTitle: data.snapshot.quizTitle, roundCount: 6, questionCount: 67, lockedAt: Timestamp.now() } });
  await batch.commit();
  return { ...identity, eventId, snapshotId,
    snapshotData: async () => (await snapshot.get()).data(),
    async dispose() { requireFullEmulatorEnvironment(process.env, 'Print redesign cleanup'); await identity.db.recursiveDelete(snapshot); await identity.db.recursiveDelete(event); await identity.db.recursiveDelete(quiz); await identity.db.doc('publicEvents/' + eventId).delete(); await identity.dispose(); } };
}
