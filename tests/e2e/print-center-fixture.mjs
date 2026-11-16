import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { editorIdentity } from './editor-identity.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

/** Synthetic frozen snapshot and canonical accepted roster, never a mocked PDF. */
export async function printCenterFixture(teamCount = 2, roundCount = 3) {
  requireFullEmulatorEnvironment(process.env, 'Print fixture');
  const identity = await editorIdentity();
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const { Timestamp, FieldValue } = require('firebase-admin/firestore');
  const created = await identity.call('createEvent', { expectedRevision: 0, event: {
    title: 'Filmový večer - Žluťoučký kůň a české filmové příběhy', startsAt: '2031-11-20T18:00:00Z', timeZone: 'Europe/Prague',
    venue: { name: 'Sál JustKvízu', publicLocation: 'Praha' }, teamCapacity: 30, peopleCapacity: 180, teamSizeMin: 2, teamSizeMax: 4,
  } });
  const eventId = created.eventId, snapshotId = 'print-' + randomUUID(), quizId = 'print-library-' + randomUUID();
  const snapshot = identity.db.doc('quizSnapshots/' + snapshotId), event = identity.db.doc('events/' + eventId);
  const batch = identity.db.batch(), now = Date.now();
  batch.set(snapshot, { status: 'ready', eventId, quizId, quizRevision: 0, quizTitle: 'Český film a hudba', roundCount, questionCount: roundCount * 10, slideCount: roundCount * 10,
    printTemplate: { layout: 'comfortable', footer: 'JustKvíz / Prostor pro vaše znalosti', showLogo: true } });
  for (let r = 0; r < roundCount; r++) {
    const roundId = 'round-' + r;
    batch.set(snapshot.collection('rounds').doc(roundId), { position: r + 1, title: r === 1 ? 'České filmové příběhy, známé melodie a vzpomínky na stříbrné plátno' : ['Filmové osobnosti', 'Hudba', 'Závěrečné otázky'][r % 3] });
    for (let q = 0; q < 10; q++) batch.set(snapshot.collection('slides').doc(`q-${r}-${q}`), { position: r * 10 + q + 1, roundId, kind: 'free', isQuestion: true,
      text: 'Soukromé zadání není součástí hráčských archů', correctAnswer: `SOUKROMÁ_ODPOVĚĎ_${r + 1}_${q + 1} s českými znaky ěščřžýáíé`, options: [] });
  }
  for (let i = 0; i < teamCount; i++) batch.set(event.collection('registrations').doc('team-' + String(i).padStart(2, '0')), {
    eventId, teamName: i === teamCount - 1 ? 'Žluťoučcí koně, kteří znají české filmy i ty nejzapomenutější filmové příběhy' : 'Filmový tým ' + (i + 1),
    status: 'accepted', source: 'manual', contactEmail: null, managementTokenHash: null, memberCount: 4, revision: 1, createdAt: Timestamp.fromMillis(now + i), updatedAt: Timestamp.fromMillis(now + i),
  });
  batch.set(event.collection('registrations').doc('cancelled'), { eventId, teamName: 'ZRUŠENÝ TÝM NESMÍ DO PDF', status: 'cancelled', createdAt: Timestamp.fromMillis(now), updatedAt: Timestamp.fromMillis(now) });
  batch.update(event, { lifecycleStatus: 'ready', acceptedTeams: teamCount, acceptedPeople: teamCount * 4,
    quizAssignment: { snapshotId, quizId, quizRevision: 0, quizTitle: 'Český film a hudba', roundCount, questionCount: roundCount * 10, lockedAt: Timestamp.now() } });
  await batch.commit();
  return { ...identity, eventId, snapshotId,
    snapshotData: async () => (await snapshot.get()).data(),
    async unprepare() { await event.update({ quizAssignment: FieldValue.delete(), lifecycleStatus: 'scheduled' }); },
    async dispose() {
      requireFullEmulatorEnvironment(process.env, 'Print fixture cleanup');
      await identity.db.recursiveDelete(snapshot); await identity.db.recursiveDelete(event); await identity.db.doc('publicEvents/' + eventId).delete(); await identity.dispose();
    },
  };
}

export async function printModeratorIdentity() {
  requireFullEmulatorEnvironment(process.env, 'Print moderator fixture');
  return editorIdentity('moderator');
}
