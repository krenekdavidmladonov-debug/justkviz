import { mapEditorSlide } from '../packages/quiz-domain/src/mappers';
import { canonicalOfflineJson, type OfflineEventManifest, type OfflineGrant, type OfflineTrust } from '../packages/quiz-domain/src/offline-event';
import { createHash } from 'node:crypto';

/** A contact-free, two-round synthetic event shared by the offline unit tests. */
export function offlineManifest(patch: Partial<OfflineEventManifest> = {}): OfflineEventManifest {
  const issuedAtMs = Date.now();
  const rounds = [1, 2].map(position => ({ id: `round-${position}`, title: `Kolo ${position}`, position }));
  const teams = Array.from({ length: 10 }, (_, index) => ({
    id: `team-${index + 1}`, name: `QA${String(index + 1).padStart(2, '0')}`, revision: 1,
  }));
  const slides = [
    { kind: 'intro', title: 'Syntetický úvod' },
    { kind: 'classic', roundId: rounds[0]!.id, text: 'První syntetická otázka', isQuestion: true,
      correctAnswer: 'PRIVATE_OFFLINE_ANSWER_ONE', moderatorNote: 'PRIVATE_OFFLINE_NOTE_ONE' },
    { kind: 'recap', roundId: rounds[0]!.id, title: 'Rekapitulace prvního kola' },
    { kind: 'classic', roundId: rounds[1]!.id, text: 'Druhá syntetická otázka', isQuestion: true,
      correctAnswer: 'PRIVATE_OFFLINE_ANSWER_TWO', moderatorNote: 'PRIVATE_OFFLINE_NOTE_TWO' },
    { kind: 'recap', roundId: rounds[1]!.id, title: 'Rekapitulace druhého kola' },
    { kind: 'end', title: 'Syntetický závěr' },
  ].map((slide, index) => mapEditorSlide(`slide-${index + 1}`, { ...slide, position: index + 1 }));
  return {
    schemaVersion: 1, exportId: 'synthetic-offline-export', sessionId: 'synthetic-offline-session',
    environment: 'demo-filmovy-kviz-v2', audience: 'justkviz-offline-v1',
    event: { id: 'synthetic-offline-event', title: 'Syntetický offline večer', startsAtMs: Date.UTC(2031, 10, 20, 18), revision: 1 },
    snapshot: { id: 'synthetic-offline-snapshot', quizId: 'synthetic-offline-quiz', quizRevision: 1 },
    actorId: 'synthetic-offline-actor', membershipVersion: 3, issuedAtMs, expiresAtMs: issuedAtMs + 3_600_000,
    rounds, teams, slides, assets: [], scoring: { unitScale: 2, rankingMode: 'dense' },
    baseScores: rounds.flatMap(round => teams.map(team => ({ teamId: team.id, roundId: round.id, revision: 0, halfPoints: null }))),
    ...patch,
  };
}

/** A test-owned signer, independent of application hashing and grant-verification code. */
export async function signedOfflineFixture(manifest = offlineManifest()) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const hash = (value: unknown) => createHash('sha256').update(canonicalOfflineJson(value)).digest('hex');
  const payload = { schemaVersion: 1 as const, exportId: manifest.exportId, sessionId: manifest.sessionId,
    eventId: manifest.event.id, snapshotId: manifest.snapshot.id, manifestDigest: hash(manifest),
    issuedAtMs: manifest.issuedAtMs, expiresAtMs: manifest.expiresAtMs, audience: manifest.audience, environment: manifest.environment };
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(canonicalOfflineJson(payload)));
  const grant: OfflineGrant = { payload, digest: hash(payload), signature: Buffer.from(signature).toString('base64url'), keyId: 'synthetic-p256-key' };
  const trust: OfflineTrust = { schemaVersion: 1, keyId: grant.keyId, publicJwk: { ...await crypto.subtle.exportKey('jwk', pair.publicKey) },
    audience: manifest.audience, environment: manifest.environment };
  return { manifest, grant, trust };
}
