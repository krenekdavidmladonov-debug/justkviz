import assert from 'node:assert/strict';
import { offlineEventFixture } from '../browser/offline-event-fixture.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

requireFullEmulatorEnvironment(process.env, 'Legacy roster offline regression');
const fixture = await offlineEventFixture();
try {
  const registrations = await fixture.identity.db.collection(`events/${fixture.eventId}/registrations`).get();
  for (const registration of registrations.docs) {
    const { revision, ...legacy } = registration.data();
    assert.equal(revision, 1);
    await registration.ref.set(legacy);
  }
  const before = registrations.docs.map(registration => ({ id: registration.id, ...registration.data() }));
  const result = await fixture.call('readOfflineTrust', { eventId: fixture.eventId, preflight: true });
  assert.equal(result.teamCount, registrations.size);
  assert.deepEqual(result.issues, []);
  const prepared = await fixture.prepare();
  assert.equal(prepared.ok, true);
  assert.equal(prepared.manifest.teams.length, registrations.size);
  assert(prepared.manifest.teams.every(team => team.revision === 0));
  const after = await fixture.identity.db.collection(`events/${fixture.eventId}/registrations`).get();
  assert(after.docs.every(registration => registration.get('revision') === undefined));
  assert.deepEqual(after.docs.map(registration => ({ id: registration.id, ...registration.data() })), before.map(({ revision, ...legacy }) => {
    assert.equal(revision, 1);
    return legacy;
  }));
  console.log('PASS: legacy accepted roster preflight/export, revision zero, no roster backfill');
} finally {
  await fixture.dispose();
}
