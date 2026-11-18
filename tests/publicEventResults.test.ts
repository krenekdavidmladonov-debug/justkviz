import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Timestamp } from 'firebase/firestore';
import { publicResultsProjection } from '../functions/src/events/public-results';
import { mapPublicEventResults } from '../apps/web/src/features/events/publicEventResults';
const { Timestamp:AdminTimestamp } = createRequire(new URL('../functions/package.json', import.meta.url))('firebase-admin/firestore') as { Timestamp:typeof Timestamp };
const versionId = 'a'.repeat(64);
function fixture() {
  const event = { title:'Dokončená akce', startsAt:AdminTimestamp.fromMillis(1000), timeZone:'Europe/Prague', venue:{ name:'Sál', publicLocation:'Město' }, lifecycleStatus:'completed', disposition:'active', liveSessionId:'session', quizAssignment:{ snapshotId:'snapshot' }, privateNote:'PRIVATE_NOTE' };
  const session = { sessionId:'session', eventId:'event', snapshotId:'snapshot', status:'ended', finalReveal:{ versionId, rank:3, page:0, visible:false }, answer:'PRIVATE_ANSWER' };
  const version = { versionId, eventId:'event', sessionId:'session', snapshotId:'snapshot', createdAt:AdminTimestamp.fromMillis(500), sourceFingerprint:'b'.repeat(64), rows:[{ rank:1, teamName:'Alfa', halfPoints:21, registrationId:'PRIVATE_ID' }, { rank:1, teamName:'Beta', halfPoints:21 }, { rank:2, teamName:'Gama', halfPoints:18 }], rowTeamIds:['PRIVATE_ID'], actorUid:'PRIVATE_ACTOR', contactEmail:'PRIVATE_CONTACT' };
  return { event, session, version };
}
describe('public final result allowlist', () => {
  it('publishes the whole confirmed immutable order with shared first place, independent of the revealed page', () => {
    const { event, session, version } = fixture(), result = publicResultsProjection('event', event, session, version);
    expect(result.rows).toEqual([{ rank:1, teamName:'Alfa', halfPoints:21 }, { rank:1, teamName:'Beta', halfPoints:21 }, { rank:2, teamName:'Gama', halfPoints:18 }]);
    expect(Object.keys(result).sort()).toEqual(['eventId', 'title', 'startsAt', 'timeZone', 'venueName', 'publicLocation', 'lifecycleStatus', 'rows'].sort());
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  });
  it.each(['not-completed', 'archived', 'trash', 'deleting', 'active-session', 'other-event', 'other-session', 'other-snapshot', 'other-version', 'no-confirmation', 'empty', 'unsorted', 'invented-rank', 'negative', 'invalid-name'])('rejects %s instead of inventing a winner', scenario => {
    const { event, session, version } = fixture();
    if (scenario === 'not-completed') event.lifecycleStatus = 'finalizing';
    if (['archived', 'trash', 'deleting'].includes(scenario)) event.disposition = scenario;
    if (scenario === 'active-session') session.status = 'active';
    if (scenario === 'other-event') version.eventId = 'another';
    if (scenario === 'other-session') version.sessionId = 'another';
    if (scenario === 'other-snapshot') version.snapshotId = 'another';
    if (scenario === 'other-version') version.versionId = 'c'.repeat(64);
    if (scenario === 'no-confirmation') session.finalReveal.versionId = '';
    if (scenario === 'empty') version.rows = [];
    if (scenario === 'unsorted') version.rows[2]!.halfPoints = 100;
    if (scenario === 'invented-rank') version.rows[2]!.rank = 3;
    if (scenario === 'negative') version.rows[2]!.halfPoints = -1;
    if (scenario === 'invalid-name') version.rows[0]!.teamName = 'A\nB';
    expect(() => publicResultsProjection('event', event, session, version)).toThrow();
  });
  it('public client mapping retains only safe rows and fails closed on invalid ranks', () => {
    const { event, session, version } = fixture(), result = publicResultsProjection('event', event, session, version);
    const wire = { ...result, startsAt:Timestamp.fromMillis(1000), contactEmail:'PRIVATE_CONTACT', rows:version.rows };
    expect(JSON.stringify(mapPublicEventResults('event', wire))).not.toContain('PRIVATE_');
    expect(() => mapPublicEventResults('another', wire)).toThrow();
    expect(() => mapPublicEventResults('event', { ...wire, rows:[{ rank:1, teamName:'Wrong', halfPoints:-1 }] })).toThrow();
  });
});
