import { describe, expect, it } from 'vitest';
import { offlineRecapChoices } from '../apps/web/src/features/offline/offlineRecap';
import { buildOfflineProjection, offlineProjectionReferences } from '../apps/web/src/features/offline/offlineProjection';
import { parsePublicLiveState } from '../apps/web/src/features/live/projectorChannel';
import { recapQuestionChoices } from '../apps/web/src/features/live/livePresentation';
import { initialOfflineState, reduceOfflineCommand } from '../packages/quiz-domain/src/offline-event';
import { offlineManifest } from './offline-fixture';

describe('offline round recap identity', () => {
  it('selects exactly the online round questions and labels local numbers independently of global positions', () => {
    const manifest = offlineManifest();
    const choices = offlineRecapChoices(manifest, 5);
    const onlineSlides = manifest.slides.map(slide => ({ id: slide.id, position: slide.position, kind: slide.kind, isQuestion: slide.isQuestion,
      roundId: slide.roundId, title: slide.title, text: slide.text, options: slide.options, media: slide.media, presentation: {} }));
    expect(choices.map(choice => choice.slide.id)).toEqual(recapQuestionChoices(onlineSlides[4]!, onlineSlides).map(choice => choice.slide.id));
    expect(choices.map(choice => choice.roundNumber + '.' + choice.questionNumber)).toEqual(['2.1']);
    expect(choices[0]!.identity).toBe(JSON.stringify(['round-2', 'slide-4']));
    expect(offlineRecapChoices(manifest, 4)).toEqual([]);
    let state = reduceOfflineCommand(manifest, initialOfflineState(manifest), { type: 'start', payload: {} });
    state = reduceOfflineCommand(manifest, state, { type: 'navigate', payload: { position: 5 } });
    const landing = buildOfflineProjection(manifest, state);
    expect(landing).toMatchObject({ presentationMode: 'recap', renderMode: 'recap', answerRevealed: false });
    expect(parsePublicLiveState(landing)).toBeDefined();
    state = reduceOfflineCommand(manifest, state, { type: 'recap', payload: { position: choices[0]!.slide.position } });
    const projection = buildOfflineProjection(manifest, state);
    expect(projection.revealedAnswer).toBe('PRIVATE_OFFLINE_ANSWER_TWO');
    expect(parsePublicLiveState(projection)).toBeDefined();
    expect(JSON.stringify(projection)).not.toContain('PRIVATE_OFFLINE_ANSWER_ONE');
  });

  it('shows interim results while the moderator stays on a recap slide', () => {
    const manifest = offlineManifest();
    const started = reduceOfflineCommand(manifest, initialOfflineState(manifest), { type: 'start', payload: {} });
    const recap = reduceOfflineCommand(manifest, started, { type: 'navigate', payload: { position: 5 } });
    const scored = { ...recap, scores: recap.scores.map(score => ({ ...score, halfPoints: 2 })) };
    const results = reduceOfflineCommand(manifest, scored, { type: 'results', payload: { throughRoundId: 'round-1', page: 0, final: false } });
    const projected = parsePublicLiveState(buildOfflineProjection(manifest, results));
    expect(projected?.interimResults?.rows).toHaveLength(6);
    expect(projected?.revealedAnswer).toBeUndefined();
  });

  it('clears a previous cross-round journal reveal before it reaches the projector', () => {
    const original = offlineManifest();
    const manifest = { ...original, slides: original.slides.map(slide => slide.position === 2 ? {
      ...slide, kind: 'audio' as const, answerImage: 'quiz-asset:synthetic-quiz/' + '1'.repeat(64),
      answerExplanation: 'PRIVATE_EXPLANATION', answerDesign: { backgroundImage: 'quiz-asset:synthetic-quiz/' + '2'.repeat(64) },
      mediaSource: 'quiz-asset:synthetic-quiz/' + '3'.repeat(64),
    } : slide) };
    let state = reduceOfflineCommand(manifest, initialOfflineState(manifest), { type: 'start', payload: {} });
    state = reduceOfflineCommand(manifest, state, { type: 'navigate', payload: { position: 5 } });
    state = reduceOfflineCommand(manifest, state, { type: 'recap', payload: { position: 2 } });
    const projection = buildOfflineProjection(manifest, state);
    expect(projection).toMatchObject({ presentationMode: 'slide', renderMode: 'question', answerRevealed: false, mediaCommand: 'idle', mediaPlaybackState: 'idle' });
    expect(offlineProjectionReferences(projection)).toEqual([]);
    expect(parsePublicLiveState(projection)).toBeDefined();
    for (const key of ['revealedAnswer', 'answerImage', 'answerExplanation', 'design', 'mediaSource', 'recapQuestionPosition']) expect(projection).not.toHaveProperty(key);
    expect(JSON.stringify(projection)).not.toContain('PRIVATE_');
    expect(state.revealPosition).toBe(2);
  });

  it('derives safe round boundaries and stable identity for old packages without roundId or questionNumber', () => {
    const original = offlineManifest();
    const manifest = { ...original, slides: original.slides.map(slide => {
      const { roundId: _round, questionNumber: _number, ...legacy } = slide;
      void _round; void _number;
      return { ...legacy, title: 'Stejný titulek' };
    }) };
    const choices = offlineRecapChoices(manifest, 5);
    expect(choices.map(choice => choice.slide.id)).toEqual(['slide-4']);
    expect(choices[0]).toMatchObject({ roundNumber: 2, questionNumber: 1, identity: JSON.stringify(['legacy:slide-5', 'slide-4']) });
    let state = reduceOfflineCommand(manifest, initialOfflineState(manifest), { type: 'start', payload: {} });
    state = reduceOfflineCommand(manifest, state, { type: 'navigate', payload: { position: 5 } });
    const good = buildOfflineProjection(manifest, reduceOfflineCommand(manifest, state, { type: 'recap', payload: { position: 4 } }));
    expect(good.revealedAnswer).toBe('PRIVATE_OFFLINE_ANSWER_TWO');
    const wrong = buildOfflineProjection(manifest, reduceOfflineCommand(manifest, state, { type: 'recap', payload: { position: 2 } }));
    expect(wrong.revealedAnswer).toBeUndefined();
  });

  it('fails closed when a legacy segment contains conflicting round identities', () => {
    const original = offlineManifest();
    const manifest = { ...original, slides: original.slides.filter(slide => slide.position !== 3).map(slide => {
      if (slide.position !== 5) return slide;
      const { roundId, ...anchor } = slide; void roundId;
      return anchor;
    }) };
    expect(offlineRecapChoices(manifest, 5)).toEqual([]);
  });

  it('rejects conflicting header and recap identities when legacy questions omit roundId', () => {
    const original = offlineManifest();
    const manifest = { ...original, slides: original.slides.map(slide => {
      if (slide.position === 3) return { ...slide, kind: 'round' as const, roundId: 'round-1' };
      if (slide.position !== 4) return slide;
      const { roundId, ...question } = slide; void roundId;
      return question;
    }) };
    expect(offlineRecapChoices(manifest, 5)).toEqual([]);
  });
});
