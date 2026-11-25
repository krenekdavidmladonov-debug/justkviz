import { describe, expect, it } from 'vitest';
import {
  applyOfflineOperation, calculateOfflineResults, canonicalOfflineJson, initialOfflineState, offlineOperationContent,
  parseOfflineManifest, parseOfflineOperation, parseOfflineOperations, reduceOfflineCommand,
  type OfflineCommand, type OfflineMediaAsset, type OfflineOperation, type OfflineState,
} from '../packages/quiz-domain/src/offline-event';
import { offlineManifest } from './offline-fixture';

function operation(command: OfflineCommand): OfflineOperation {
  return { ...command, operationId: 'synthetic-operation', sequence: 1, previousHash: '0'.repeat(64),
    hash: 'a'.repeat(64), observedAtMs: Date.now() };
}

function asset(index: number, size = 25 * 1024 * 1024): OfflineMediaAsset {
  return { reference: `quiz-asset:synthetic-quiz/${index.toString(16).padStart(64, '0')}`,
    generation: '1001', kind: 'video', contentType: 'video/mp4', size,
    sha256: 'b'.repeat(64), etag: '"synthetic-etag"' };
}

describe('offline manifest trust input', () => {
  it('accepts the contact-free two-round ten-team fixture with twenty unscored cells', () => {
    const parsed = parseOfflineManifest(offlineManifest());
    expect(parsed.teams.map(team => team.name)).toEqual(Array.from({ length: 10 }, (_, i) => `QA${String(i + 1).padStart(2, '0')}`));
    expect(parsed.baseScores).toHaveLength(20);
    expect(parsed.baseScores.every(score => score.halfPoints === null)).toBe(true);
  });

  it.each(['customRoundHeading', 'generatedAgendaSlide'])('accepts only boolean values for optional %s', field => {
    const manifest = offlineManifest();
    const withFlag = (value: unknown) => ({ ...manifest, slides: manifest.slides.map(slide => ({ ...slide, [field]: value })) });
    expect(parseOfflineManifest(withFlag(true)).slides[0]).toHaveProperty(field, true);
    expect(() => parseOfflineManifest(withFlag('true'))).toThrow();
  });

  it.each(['title', 'text', 'correctAnswer', 'moderatorNote', 'options'])('rejects nested private data in the nominal %s field', field => {
    const manifest = offlineManifest();
    const injected = { privateContact: 'PRIVATE_CONTACT_MUST_NOT_BE_STRINGIFIED' };
    const slide = { ...manifest.slides[1], [field]: field === 'options' ? [injected] : injected };
    expect(() => parseOfflineManifest({ ...manifest, slides: [manifest.slides[0], slide] })).toThrow();
  });

  it('rejects unknown capability fields, duplicate identities and foreign score coordinates', () => {
    const manifest = offlineManifest();
    for (const input of [
      { ...manifest, authToken: 'SYNTHETIC_TOKEN' },
      { ...manifest, teams: [{ ...manifest.teams[0], contactEmail: 'synthetic@example.test' }] },
      { ...manifest, teams: [manifest.teams[0], manifest.teams[0]] },
      { ...manifest, rounds: [manifest.rounds[0], manifest.rounds[0]] },
      { ...manifest, slides: [manifest.slides[0], manifest.slides[0]] },
      { ...manifest, baseScores: [manifest.baseScores[0], manifest.baseScores[0]] },
      { ...manifest, baseScores: [{ ...manifest.baseScores[0], teamId: 'foreign-team' }] },
      { ...manifest, baseScores: [{ ...manifest.baseScores[0], roundId: 'foreign-round' }] },
    ]) expect(() => parseOfflineManifest(input)).toThrow();
  });

  it('enforces 200 score cells and a maximum 72-hour grant window', () => {
    const manifest = offlineManifest();
    const rounds = Array.from({ length: 20 }, (_, i) => ({ id: `round-${i + 1}`, title: `Kolo ${i + 1}`, position: i + 1 }));
    expect(parseOfflineManifest({ ...manifest, rounds })).toBeDefined();
    expect(() => parseOfflineManifest({ ...manifest, rounds, teams: [...manifest.teams, { id: 'team-11', name: 'QA11', revision: 1 }] })).toThrow();
    expect(parseOfflineManifest({ ...manifest, expiresAtMs: manifest.issuedAtMs + 72 * 60 * 60 * 1000 })).toBeDefined();
    expect(() => parseOfflineManifest({ ...manifest, expiresAtMs: manifest.issuedAtMs + 72 * 60 * 60 * 1000 + 1 })).toThrow();
    expect(() => parseOfflineManifest({ ...manifest, expiresAtMs: manifest.issuedAtMs })).toThrow();
  });

  it('enforces the exact 512 MiB metadata sum, 25 MiB media and 256 unique asset bounds', () => {
    const assets = [...Array.from({ length: 20 }, (_, i) => asset(i + 1)), asset(21, 12 * 1024 * 1024)];
    expect(parseOfflineManifest(offlineManifest({ assets })).assets).toHaveLength(21);
    expect(() => parseOfflineManifest(offlineManifest({ assets: [...assets.slice(0, -1), asset(21, 12 * 1024 * 1024 + 1)] }))).toThrow();
    expect(() => parseOfflineManifest(offlineManifest({ assets: [asset(1, 25 * 1024 * 1024 + 1)] }))).toThrow();
    const many = Array.from({ length: 256 }, (_, i) => asset(i + 1, 1));
    expect(parseOfflineManifest(offlineManifest({ assets: many })).assets).toHaveLength(256);
    expect(() => parseOfflineManifest(offlineManifest({ assets: [...many, asset(257, 1)] }))).toThrow();
    expect(() => parseOfflineManifest(offlineManifest({ assets: [asset(1), asset(1)] }))).toThrow();
  });

  it('rejects unsupported codecs and image size overflow before any media allocation', () => {
    expect(() => parseOfflineManifest(offlineManifest({ assets: [{ ...asset(1), contentType: 'video/webm' } as unknown as OfflineMediaAsset] }))).toThrow();
    const image = { ...asset(1), kind: 'image' as const, contentType: 'image/png' as const, size: 10 * 1024 * 1024 };
    expect(parseOfflineManifest(offlineManifest({ assets: [image] })).assets).toHaveLength(1);
    expect(() => parseOfflineManifest(offlineManifest({ assets: [{ ...image, size: image.size + 1 }] }))).toThrow();
  });
});

describe('offline journal command validation', () => {
  it('canonicalizes nested key order while preserving list order and rejecting nonfinite values', () => {
    expect(canonicalOfflineJson({ z: [2, 1], a: { y: true, b: null } })).toBe('{"a":{"b":null,"y":true},"z":[2,1]}');
    expect(canonicalOfflineJson({ z: 1, a: 2 })).toBe(canonicalOfflineJson({ a: 2, z: 1 }));
    for (const value of [NaN, Infinity, -Infinity, [undefined], { value: 1n }]) expect(() => canonicalOfflineJson(value)).toThrow();
  });

  it('includes sequence, previous hash, command, timestamp and operation ID in signed operation content', () => {
    const { hash: _hash, ...content } = operation({ type: 'navigate', payload: { position: 2 } });
    void _hash;
    const original = offlineOperationContent(content);
    for (const patch of [
      { operationId: 'other-operation' }, { sequence: 2 }, { previousHash: 'f'.repeat(64) },
      { observedAtMs: content.observedAtMs + 1 }, { payload: { position: 4 } },
    ]) expect(offlineOperationContent({ ...content, ...patch })).not.toBe(original);
  });

  it('rejects malformed or oversized operation envelopes and extra payload fields', () => {
    const valid = operation({ type: 'navigate', payload: { position: 2 } });
    expect(parseOfflineOperation(valid)).toEqual(valid);
    for (const patch of [
      { sequence: 0 }, { sequence: 2001 }, { previousHash: 'invalid' }, { hash: 'A'.repeat(64) },
      { operationId: '../foreign' }, { observedAtMs: NaN }, { unexpected: true },
      { type: 'reveal-all' }, { payload: { position: 2, correctAnswer: 'PRIVATE' } },
    ]) expect(() => parseOfflineOperation({ ...valid, ...patch })).toThrow();
    expect(parseOfflineOperation({ ...valid, sequence: 2000 })).toBeDefined();
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '2'])('rejects invalid half-point input %s at the journal boundary', halfPoints => {
    expect(() => parseOfflineOperation(operation({ type: 'round-scores', payload: { roundId: 'round-1',
      changes: [{ teamId: 'team-1', expectedRevision: 0, halfPoints: halfPoints as number, reason: '' }] } }))).toThrow();
  });

  it('bounds the complete journal by both 2000 operations and 512 KiB and rejects duplicate IDs', () => {
    const operations = Array.from({ length: 2000 }, (_, index) => ({
      ...operation({ type: 'hide', payload: {} }), operationId: `operation-${index + 1}`, sequence: index + 1, observedAtMs: 0,
    }));
    expect(parseOfflineOperations(operations)).toHaveLength(2000);
    expect(() => parseOfflineOperations([...operations, { ...operations[0], operationId: 'operation-2001' }])).toThrow();
    expect(() => parseOfflineOperations([operations[0], operations[0]])).toThrow();
    const large = operations.slice(0, 1000).map(op => ({ ...op, type: 'round-scores', payload: { roundId: 'round-1', changes: [
      { teamId: 'team-1', expectedRevision: 0, halfPoints: 2, reason: 'x'.repeat(300) },
    ] } }));
    expect(new TextEncoder().encode(canonicalOfflineJson(large)).byteLength).toBeGreaterThan(512 * 1024);
    expect(() => parseOfflineOperations(large)).toThrow();
  });

  it('rejects replay, missing sequence and foreign predecessor without altering the accepted journal state', () => {
    const manifest = offlineManifest(), initial = initialOfflineState(manifest);
    const first = operation({ type: 'start', payload: {} });
    const accepted = applyOfflineOperation(manifest, initial, first);
    expect(accepted).toMatchObject({ sequence: 1, headHash: first.hash, status: 'active' });
    for (const next of [first, { ...first, sequence: 3 }, { ...first, sequence: 2, previousHash: 'f'.repeat(64) }]) {
      expect(() => applyOfflineOperation(manifest, accepted, next)).toThrow();
    }
    expect(initial).toMatchObject({ sequence: 0, headHash: '0'.repeat(64), status: 'waiting' });
    expect(accepted.sequence).toBe(1);
  });
});

describe('offline authority and scoring state machine', () => {
  const manifest = offlineManifest();
  const apply = (state: OfflineState, command: OfflineCommand) => reduceOfflineCommand(manifest, state, command);
  const active = () => apply(initialOfflineState(manifest), { type: 'start', payload: {} });
  const scoreRound = (state: OfflineState, round: number) => apply(state, { type: 'round-scores', payload: {
    roundId: `round-${round}`, changes: manifest.teams.map((team, index) => ({ teamId: team.id,
      expectedRevision: 0, halfPoints: 2 * (round === 1 ? index + 1 : 10 - index), reason: '' })),
  } });

  it('ten teams score 1..10 and 10..1 for eleven points and shared dense rank one', () => {
    const state = scoreRound(scoreRound(active(), 1), 2);
    const result = calculateOfflineResults(manifest, state.scores, 'round-2');
    expect(result.complete).toBe(true); expect(result.missing).toEqual([]);
    expect(result.rows).toEqual(manifest.teams.map(team => ({ rank: 1, teamName: team.name, halfPoints: 22 })));
    expect(state.scoreMutations).toBe(20);
    expect(initialOfflineState(manifest).scores.every(score => score.halfPoints === null)).toBe(true);
  });

  it('distinguishes zero from missing and blocks incomplete published results', () => {
    const state = active();
    expect(calculateOfflineResults(manifest, state.scores, 'round-1').missing).toHaveLength(10);
    expect(() => apply(state, { type: 'results', payload: { throughRoundId: 'round-1', final: false, page: 0 } })).toThrow();
    const zeros = state.scores.map(score => ({ ...score, halfPoints: 0 }));
    expect(calculateOfflineResults(manifest, zeros, 'round-2')).toMatchObject({ complete: true, missing: [] });
    expect(calculateOfflineResults(manifest, zeros, 'round-2').rows.every(row => row.rank === 1 && row.halfPoints === 0)).toBe(true);
  });

  it('keeps a failed multi-team scoring batch atomic and requires a reason for corrections or clearing', () => {
    const state = scoreRound(active(), 1), before = structuredClone(state);
    const change = { teamId: 'team-1', expectedRevision: 1, halfPoints: 3, reason: 'Synthetic half-point correction' };
    for (const changes of [
      [change, { ...change, teamId: 'foreign-team' }], [change, change],
      [{ ...change, expectedRevision: 0 }], [{ ...change, reason: '' }],
      [{ ...change, halfPoints: null, reason: '' }], [{ ...change, halfPoints: 2 }],
    ]) expect(() => apply(state, { type: 'round-scores', payload: { roundId: 'round-1', changes } })).toThrow();
    expect(state).toEqual(before);
    const corrected = apply(state, { type: 'round-scores', payload: { roundId: 'round-1', changes: [change] } });
    expect(corrected.scores.find(score => score.teamId === 'team-1' && score.roundId === 'round-1')).toMatchObject({ halfPoints: 3, revision: 2 });
  });

  it('bounds score mutations at 250 and leaves an existing result version stable across later corrections', () => {
    const scored = scoreRound(scoreRound(active(), 1), 2);
    const published = apply(scored, { type: 'results', payload: { throughRoundId: 'round-2', final: true, page: 0 } });
    const correction: OfflineCommand = { type: 'round-scores', payload: { roundId: 'round-1', changes: [
      { teamId: 'team-1', expectedRevision: 1, halfPoints: 3, reason: 'Synthetic correction' },
    ] } };
    const allowed = apply({ ...published, scoreMutations: 249 }, correction);
    expect(allowed.scoreMutations).toBe(250);
    expect(allowed.results).toEqual(published.results);
    expect(() => apply({ ...published, scoreMutations: 250 }, correction)).toThrow();
  });

  it('reveal is bound to the current question and navigation/hide/end invalidate prior presentation generation', () => {
    const started = active();
    expect(() => apply(started, { type: 'reveal', payload: { position: 4 } })).toThrow();
    const question = apply(started, { type: 'navigate', payload: { position: 2 } });
    const revealed = apply(question, { type: 'reveal', payload: { position: 2 } });
    expect(revealed.revealPosition).toBe(2);
    const clearing: readonly OfflineCommand[] = [
      { type: 'navigate', payload: { position: 4 } }, { type: 'hide', payload: {} }, { type: 'end', payload: {} },
    ];
    for (const command of clearing) {
      const next = apply(revealed, command);
      expect(next.revealPosition).toBeNull(); expect(next.mediaCommand).toBe('idle');
      expect(next.mediaGeneration).toBeGreaterThan(revealed.mediaGeneration);
    }
    const ended = apply(revealed, { type: 'end', payload: {} });
    expect(() => apply(ended, { type: 'start', payload: {} })).toThrow();
    expect(() => apply(ended, { type: 'navigate', payload: { position: 2 } })).toThrow();
  });
});
