import { describe, expect, it } from 'vitest';
import { buildOfflineProjection, offlineProjectionReferences } from '../apps/web/src/features/offline/offlineProjection';
import { initialOfflineState, reduceOfflineCommand, type OfflineCommand, type OfflineEventManifest, type OfflineMediaAsset } from '../packages/quiz-domain/src/offline-event';
import { offlineManifest } from './offline-fixture';

const reference = (index: number) => `quiz-asset:synthetic-quiz/${index.toString(16).padStart(64, '0')}`;
const asset = (index: number): OfflineMediaAsset => ({ reference: reference(index), generation: '1001', kind: 'image',
  contentType: 'image/png', size: 1, sha256: 'a'.repeat(64), etag: '"synthetic"', width: 1, height: 1 });
function manifest(): OfflineEventManifest {
  const base = offlineManifest();
  return { ...base, assets: Array.from({ length: 7 }, (_, index) => asset(index + 1)), slides: base.slides.map((slide, index) => index === 1 ? {
    ...slide, kind: 'image', questionImage: reference(1), answerImage: reference(2),
    design: { backgroundImage: reference(3), logoImage: reference(4), showLogo: true },
    answerDesign: { backgroundImage: reference(5), logoImage: reference(6), showLogo: true },
    media: [{ kind: 'image', role: 'answer', source: reference(2) }],
  } : index === 3 ? { ...slide, kind: 'image', questionImage: reference(7) } : slide) };
}

describe('offline public projection allowlist', () => {
  it('publishes only current prompt/design references before explicit reveal, never private metadata or future assets', () => {
    const source = manifest();
    const state = reduceOfflineCommand(source, initialOfflineState(source), { type: 'start', payload: {} });
    const current = reduceOfflineCommand(source, state, { type: 'navigate', payload: { position: 2 } });
    const publication = buildOfflineProjection(source, current), serialized = JSON.stringify(publication);
    expect(offlineProjectionReferences(publication)).toEqual(expect.arrayContaining([reference(1), reference(3), reference(4)]));
    expect(offlineProjectionReferences(publication)).toHaveLength(3);
    for (const secret of ['PRIVATE_OFFLINE_ANSWER', 'PRIVATE_OFFLINE_NOTE', reference(2), reference(5), reference(6), reference(7),
      source.actorId, source.exportId, source.snapshot.id, source.event.id, 'membershipVersion', 'baseScores', 'grant', 'assets']) expect(serialized).not.toContain(secret);
    expect(publication.media).toEqual([]); expect(publication.answerRevealed).toBe(false);
  });

  it('reveals only the selected question answer/design and removes them on navigation and END', () => {
    const source = manifest();
    let state = reduceOfflineCommand(source, initialOfflineState(source), { type: 'start', payload: {} });
    state = reduceOfflineCommand(source, state, { type: 'navigate', payload: { position: 2 } });
    state = reduceOfflineCommand(source, state, { type: 'reveal', payload: { position: 2 } });
    const revealed = buildOfflineProjection(source, state);
    expect(revealed.revealedAnswer).toBe('PRIVATE_OFFLINE_ANSWER_ONE'); expect(revealed.answerImage).toBe(reference(2));
    expect(offlineProjectionReferences(revealed)).toEqual(expect.arrayContaining([reference(2), reference(5), reference(6)]));
    expect(JSON.stringify(revealed)).not.toContain('PRIVATE_OFFLINE_ANSWER_TWO');
    expect(JSON.stringify(revealed)).not.toContain('PRIVATE_OFFLINE_NOTE');
    const clearing: readonly OfflineCommand[] = [{ type: 'navigate', payload: { position: 4 } }, { type: 'end', payload: {} }];
    for (const command of clearing) {
      const next = buildOfflineProjection(source, reduceOfflineCommand(source, state, command));
      expect(next.revealedAnswer).toBeUndefined(); expect(next.answerImage).toBeUndefined();
      expect(offlineProjectionReferences(next)).not.toContain(reference(2));
      expect(offlineProjectionReferences(next)).not.toContain(reference(5));
    }
  });

  it('sends only the current six/four rows of ten shared winners, with no future page rows or team IDs', () => {
    const source = manifest();
    let state = reduceOfflineCommand(source, initialOfflineState(source), { type: 'start', payload: {} });
    const scores = source.baseScores.map(score => ({ ...score, halfPoints: 11, revision: 1 }));
    state = { ...state, scores };
    const seen: string[] = [];
    for (const [page, count] of [[0, 6], [1, 4]]) {
      const result = reduceOfflineCommand(source, state, { type: 'results', payload: { throughRoundId: 'round-2', final: true, page: page! } });
      const projection = buildOfflineProjection(source, result), rows = projection.finalReveal!.rows;
      expect(rows).toHaveLength(count!); expect(rows.every(row => row.rank === 1 && row.halfPoints === 22)).toBe(true);
      for (const row of rows) expect(Object.keys(row).sort()).toEqual(['halfPoints', 'rank', 'teamName']);
      seen.push(...rows.map(row => row.teamName));
      const absent = source.teams.filter(team => !rows.some(row => row.teamName === team.name));
      for (const team of absent) expect(JSON.stringify(projection)).not.toContain(team.name);
      for (const team of source.teams) expect(JSON.stringify(projection)).not.toContain(team.id);
      expect(offlineProjectionReferences(projection)).toEqual([]);
    }
    expect(new Set(seen).size).toBe(10);
    expect(() => reduceOfflineCommand(source, state, { type: 'results', payload: { throughRoundId: 'round-2', final: true, page: 2 } })).toThrow();
  });

  it('withholds ordinary audio source from projector while explicit answer recap permits only the selected audio', () => {
    const source = manifest(), audio = { ...asset(8), kind: 'audio' as const, contentType: 'audio/wav' as const };
    const withAudio: OfflineEventManifest = { ...source, assets: [...source.assets, audio], slides: source.slides.map((slide, index) => index === 1 ? {
      ...slide, kind: 'audio' as const, mediaSource: audio.reference, questionImage: '', media: [], clipStartSeconds: 1, clipEndSeconds: 3,
    } : slide) };
    let state = reduceOfflineCommand(withAudio, initialOfflineState(withAudio), { type: 'start', payload: {} });
    state = reduceOfflineCommand(withAudio, state, { type: 'navigate', payload: { position: 2 } });
    expect(buildOfflineProjection(withAudio, state).mediaSource).toBeUndefined();
    state = reduceOfflineCommand(withAudio, state, { type: 'reveal', payload: { position: 2 } });
    expect(buildOfflineProjection(withAudio, state).mediaSource).toBeUndefined();
    expect(buildOfflineProjection(withAudio, state)).toMatchObject({ clipStartSeconds: 1, clipEndSeconds: 3 });
    state = reduceOfflineCommand(withAudio, state, { type: 'navigate', payload: { position: 3 } });
    state = reduceOfflineCommand(withAudio, state, { type: 'recap', payload: { position: 2 } });
    expect(buildOfflineProjection(withAudio, state).mediaSource).toBe(audio.reference);
    expect(buildOfflineProjection(withAudio, state)).toMatchObject({ clipStartSeconds: 1, clipEndSeconds: 3 });
  });

  it('publishes only the selected result template and its public owned images, never answer aliases or external media', () => {
    const source: OfflineEventManifest = { ...manifest(), resultTemplates: {
      interim: { title: 'Průběžný nadpis', subtitle: 'Průběžný text', design: { backgroundImage: reference(3), logoImage: reference(4), showLogo: true } },
      final: { title: 'Konečný nadpis', subtitle: 'Konečný text', design: { backgroundImage: reference(7), logoImage: reference(4), showLogo: true } },
    } };
    const active = reduceOfflineCommand(source, initialOfflineState(source), { type: 'start', payload: {} });
    const scored = { ...active, scores: source.baseScores.map(score => ({ ...score, halfPoints: 11, revision: 1 })) };
    for (const final of [false, true]) {
      const results = reduceOfflineCommand(source, scored, { type: 'results', payload: { throughRoundId: final ? 'round-2' : 'round-1', final, page: 0 } });
      const published = buildOfflineProjection(source, results);
      expect(published.title).toBe(final ? 'Konečný nadpis' : 'Průběžný nadpis');
      expect(published.subtitle).toBe(final ? 'Konečný text' : 'Průběžný text');
      expect(offlineProjectionReferences(published)).toEqual(expect.arrayContaining([final ? reference(7) : reference(3), reference(4)]));
      expect(offlineProjectionReferences(published)).toHaveLength(2);
      expect(JSON.stringify(published)).not.toContain(final ? 'Průběžný nadpis' : 'Konečný nadpis');
      expect(published.showCue).toBeUndefined();
      const privateAlias: OfflineEventManifest = { ...source, resultTemplates: {
        [final ? 'final' : 'interim']: { design: { backgroundImage: reference(5), logoImage: reference(2), showLogo: true } },
      } };
      expect(offlineProjectionReferences(buildOfflineProjection(privateAlias, results))).toEqual([]);
      const external: OfflineEventManifest = { ...source, resultTemplates: {
        [final ? 'final' : 'interim']: { design: { backgroundImage: 'https://example.invalid/background.png', logoImage: 'https://example.invalid/logo.png' } },
      } };
      expect(offlineProjectionReferences(buildOfflineProjection(external, results))).toEqual([]);
    }
  });
});

it('uses the frozen round position for its projector number and omits missing legacy metadata', () => {
  const original = offlineManifest();
  const source = { ...original, slides: original.slides.map(slide => ({ ...slide, position: slide.position, ...(slide.position === 1 ? { roundId: 'round-2', kind: 'round' as const } : {}) })) };
  const active = reduceOfflineCommand(source, initialOfflineState(source), { type: 'start', payload: {} });
  expect(buildOfflineProjection(source, active).roundNumber).toBe(2);
  const legacy = { ...source, rounds: [] };
  expect(buildOfflineProjection(legacy, active)).not.toHaveProperty('roundNumber');
});
