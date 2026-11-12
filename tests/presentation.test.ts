import { describe, expect, test } from 'vitest';

import {
  isProjectorChannelMessage,
  parseProjectorChannelMessage,
  projectorPresentationAuthority,
  sanitizedChannelState,
  shouldAcceptProjectorFastPath,
} from '../apps/web/src/features/live/projectorChannel';
import type { PublicLiveState } from '../apps/web/src/features/live/types';
import { initialMediaMachineState, reduceMediaMachine } from '../apps/web/src/features/presentation/mediaStateMachine';
import { buildSlideRenderModel, formatPlAnswer, generatedAgendaOptions, projectorMediaPlan, youtubeVideoId } from '../apps/web/src/features/presentation/model';
import { indexSlidesByPosition, recordPlayerLifecycle } from '../apps/web/src/features/presentation/performance';
import type { SlideRenderInput } from '../apps/web/src/features/presentation/types';

function slide(overrides: Partial<SlideRenderInput> = {}): SlideRenderInput {
  return {
    kind: 'question', title: 'Syntetický titulek', text: 'Syntetické zadání',
    options: ['Jedna', 'Dvě', 'Tři', 'Čtyři'], media: [], questionNumber: 2, questionCount: 10,
    ...overrides,
  };
}

function publicState(overrides: Partial<PublicLiveState> = {}): PublicLiveState {
  return {
    sessionId: 'safe-session', quizTitle: 'Syntetický kvíz', status: 'active', slidePosition: 1,
    slideKind: 'question', title: 'Titulek', text: 'Zadání', options: ['A'], media: [], presentation: {},
    presentationMode: 'slide', renderMode: 'question', mediaCommand: 'idle', mediaPlaybackState: 'idle',
    mediaGeneration: 1, introGeneration: 0, answerRevealed: false, revision: 4,
    ...overrides,
  };
}

describe('unified slide render model', () => {
  test('QUESTION keeps options, explicit numbering, background, and overlay without an answer field', () => {
    const model = buildSlideRenderModel(slide({ backgroundImage: 'https://example.test/bg.jpg', backgroundOverlay: 65 }));
    expect(model).toMatchObject({ contentKind: 'question', renderMode: 'question', questionNumber: 2, questionCount: 10, backgroundOverlay: 65 });
    expect(model.options).toHaveLength(4);
    expect(model).not.toHaveProperty('revealedAnswer');
  });

  test('FREE suppresses no data in the model but is explicitly open-answer and background-capable', () => {
    const model = buildSlideRenderModel(slide({ kind: 'free', options: [], backgroundImage: 'https://example.test/free.jpg' }));
    expect(model).toMatchObject({ contentKind: 'free', isQuestionLike: true, backgroundImage: 'https://example.test/free.jpg' });
    expect(model.options).toEqual([]);
  });

  test('IMAGE keeps question image separate from background and answer image', () => {
    const model = buildSlideRenderModel(slide({
      kind: 'image', questionImage: 'https://example.test/question.jpg',
      backgroundImage: 'https://example.test/background.jpg', answerImage: 'https://example.test/answer.jpg',
      backgroundOverlay: 45,
    }));
    expect(model).toMatchObject({
      contentKind: 'image', questionImage: 'https://example.test/question.jpg',
      backgroundImage: 'https://example.test/background.jpg', answerImage: 'https://example.test/answer.jpg', backgroundOverlay: 45,
    });
    expect(model.options).toHaveLength(4);
  });

  test('AUDIO projector never mounts a player, retains the question, and mirrors playback in vinyl state', () => {
    const model = buildSlideRenderModel(slide({ kind: 'audio', mediaSource: 'abcdefghijk', clipStartSeconds: 5, clipEndSeconds: 20 }));
    expect(projectorMediaPlan(model, 'idle')).toMatchObject({ mountPlayer: false, showQuestion: true, vinylPlaying: false });
    expect(projectorMediaPlan(model, 'play', 'preparing')).toMatchObject({ mountPlayer: false, showQuestion: true, vinylPlaying: false, startSeconds: 5, endSeconds: 20 });
    expect(projectorMediaPlan(model, 'play', 'playing')).toMatchObject({ vinylPlaying: true });
    expect(projectorMediaPlan(model, 'play', 'error')).toMatchObject({ vinylPlaying: false });
    expect(projectorMediaPlan(model, 'finished', 'finished', true)).toMatchObject({ mountPlayer: false, showQuestion: true, vinylPlaying: false });
    expect(projectorMediaPlan(model, 'replay', 'playing')).toMatchObject({ startSeconds: 5, vinylPlaying: true });
  });

  test('VIDEO shows the question before play, uses one player while playing, and returns after stop or finish', () => {
    const model = buildSlideRenderModel(slide({ kind: 'video', mediaSource: 'abcdefghijk', clipStartSeconds: 7, clipEndSeconds: 24 }));
    expect(projectorMediaPlan(model, 'idle')).toMatchObject({ mountPlayer: true, showQuestion: true });
    expect(projectorMediaPlan(model, 'play')).toMatchObject({ mountPlayer: true, showQuestion: false, startSeconds: 7, endSeconds: 24 });
    expect(projectorMediaPlan(model, 'stop')).toMatchObject({ mountPlayer: true, showQuestion: true });
    expect(projectorMediaPlan(model, 'replay')).toMatchObject({ mountPlayer: true, startSeconds: 7 });
    expect(projectorMediaPlan(model, 'play', 'finished', true)).toMatchObject({ mountPlayer: true, showQuestion: true });
  });

  test('RECAP publishes a selected answer and preserves clip timing until original is explicitly selected', () => {
    const model = buildSlideRenderModel(slide({
      kind: 'audio', mediaSource: 'abcdefghijk', clipStartSeconds: 12, clipEndSeconds: 30,
      answerImage: 'https://example.test/answer.jpg', revealedAnswer: 'Sanitizovaná odpověď',
    }), 'recap');
    expect(model).toMatchObject({ renderMode: 'recap', revealedAnswer: 'Sanitizovaná odpověď', answerImage: 'https://example.test/answer.jpg' });
    expect(projectorMediaPlan(model, 'idle')).toEqual({ mountPlayer: true, showQuestion: true, vinylPlaying: false, startSeconds: 12, endSeconds: 30 });
  });

  test('PL remains a legacy-only render kind with Czech truth labels', () => {
    expect(buildSlideRenderModel(slide({ kind: 'pl' })).isLegacyPl).toBe(true);
    expect(formatPlAnswer('true')).toBe('PRAVDA');
    expect(formatPlAnswer('false')).toBe('LEŽ');
    expect(formatPlAnswer('jiná legacy hodnota')).toBe('jiná legacy hodnota');
  });

  test('new agenda content is deterministically generated from round order and names', () => {
    expect(generatedAgendaOptions([{ title: 'První téma' }, { title: '  Druhé téma  ' }, { title: '' }])).toEqual([
      '1. KOLO – První téma', '2. KOLO – Druhé téma', '3. KOLO',
    ]);
  });

  test('legacy timing accepts zero start, rejects a non-increasing end, and parses supported YouTube sources', () => {
    expect(buildSlideRenderModel(slide({ kind: 'video', presentation: { videoStart: 0, videoEnd: 0 } }))).toMatchObject({ clipStartSeconds: 0 });
    expect(buildSlideRenderModel(slide({ kind: 'video', presentation: { videoStart: 9, videoEnd: 4 } }))).not.toHaveProperty('clipEndSeconds');
    expect(youtubeVideoId('https://youtu.be/abcdefghijk?t=1')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://www.youtube.com/watch?v=abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://example.test/video')).toBeUndefined();
  });
});

describe('media race and performance invariants', () => {
  test('ignores stale player callbacks by generation', () => {
    const preparing = reduceMediaMachine(initialMediaMachineState, { type: 'prepare', generation: 8 });
    const playing = reduceMediaMachine(preparing, { type: 'playing', generation: 8 });
    expect(reduceMediaMachine(playing, { type: 'finished', generation: 7 })).toEqual(playing);
    expect(reduceMediaMachine(playing, { type: 'stop', generation: 9 })).toMatchObject({ lifecycle: 'STOPPING', generation: 9 });
  });

  test('315 real-scale positions have constant one-entry lookup cost including deep positions', () => {
    const slides = Array.from({ length: 315 }, (_, index) => ({ position: index + 1, id: `slide-${index + 1}` }));
    const index = indexSlidesByPosition(slides);
    expect(index.size).toBe(315);
    expect(index.inspectedPerLookup).toBe(1);
    for (const position of [1, 25, 50, 100, 150, 200, 250, 315]) {
      expect(index.get(position)?.position).toBe(position);
      expect(index.inspectedPerLookup).toBe(1);
    }
  });

  test('heavy-player instrumentation rejects a second concurrent player', () => {
    const diagnostics = { activePlayers: 1, peakPlayers: 1, createdPlayers: 1, destroyedPlayers: 0 };
    expect(() => recordPlayerLifecycle(diagnostics, 1)).toThrow('budget exceeded');
  });
});

describe('same-device public channel security', () => {
  test('rebuilds an allowlisted payload and drops private answer and legacy sentinels', () => {
    const state = publicState();
    const unsafe = { ...state, correctAnswer: 'SENTINEL-CORRECT', correct: 'SENTINEL-LEGACY', legacy: { raw: 'SENTINEL-RAW' } };
    const sanitized = sanitizedChannelState(unsafe);
    expect(JSON.stringify(sanitized)).not.toContain('SENTINEL');
    expect(sanitized).not.toHaveProperty('correctAnswer');
    expect(sanitized).not.toHaveProperty('legacy');
  });

  test('rejects a malformed public state instead of trusting sessionId and revision', () => {
    expect(isProjectorChannelMessage({
      type: 'public-state',
      state: { sessionId: 'safe-session', revision: 999 },
    })).toBe(false);
  });

  test('rejects a QUESTION payload carrying an answer before reveal', () => {
    const unsafe = publicState({ revealedAnswer: 'SENTINEL-ANSWER' });
    expect(() => sanitizedChannelState(unsafe)).toThrow();
  });

  test('accepts only a single selected RECAP answer with explicit selection', () => {
    const recap = publicState({
      slidePosition: 7, presentationMode: 'recap', renderMode: 'recap', recapQuestionPosition: 6,
      answerRevealed: true, revealedAnswer: 'Sanitizovaná odpověď', revision: 5,
    });
    expect(parseProjectorChannelMessage({ type: 'public-state', state: recap })).toEqual({ type: 'public-state', state: recap });
    expect(parseProjectorChannelMessage({ type: 'public-state', state: { ...recap, answers: ['A', 'B'] } })).toBeUndefined();
  });

  test('accepts authoritative direct reveal recap while refusing channel fast-path authority', () => {
    const direct = publicState({ renderMode: 'recap', answerRevealed: true, revealedAnswer: 'Explicit revealed answer', answerImage: 'https://example.test/answer.png', revision: 5 });
    expect(sanitizedChannelState(direct)).toEqual(direct);
    expect(parseProjectorChannelMessage({ type: 'public-state', state: direct })).toEqual({ type: 'public-state', state: direct });
    expect(projectorPresentationAuthority(direct)).toBe('authoritative-only');
    expect(shouldAcceptProjectorFastPath('safe-session', 4, 4, direct)).toBe(false);
    for (const invalid of [{ ...direct, answerRevealed: false }, { ...direct, revealedAnswer: undefined }, { ...direct, status: 'waiting' }, { ...direct, status: 'ended' }, { ...direct, slidePosition: 0 }, { ...direct, recapQuestionPosition: 1 }, { ...direct, correctAnswer: 'private' }]) expect(parseProjectorChannelMessage({ type: 'public-state', state: invalid })).toBeUndefined();
    expect(parseProjectorChannelMessage({ type: 'public-state', state: publicState({ renderMode: 'recap' }) })).toBeUndefined();
    expect(parseProjectorChannelMessage({ type: 'public-state', state: { ...direct, slideKind: 'audio', mediaSource: 'https://example.test/private.mp3' } })).toBeUndefined();
  });

  test('rejects private extras, unknown message types, and malformed playback reports', () => {
    expect(parseProjectorChannelMessage({ type: 'public-state', state: { ...publicState(), correctAnswer: 'SENTINEL' } })).toBeUndefined();
    expect(parseProjectorChannelMessage({ type: 'unknown', state: publicState() })).toBeUndefined();
    expect(parseProjectorChannelMessage({
      type: 'playback-state', sessionId: 'safe-session', mediaGeneration: 1, playbackState: 'PLAYING', extra: true,
    })).toBeUndefined();
  });

  test('fast path rejects stale, future, equal, and wrong-session revisions', () => {
    expect(shouldAcceptProjectorFastPath('safe-session', 4, 4, publicState({ revision: 5 }))).toBe(true);
    expect(shouldAcceptProjectorFastPath('safe-session', 4, 4, publicState({ revision: 3 }))).toBe(false);
    expect(shouldAcceptProjectorFastPath('safe-session', 4, 4, publicState({ revision: 99 }))).toBe(false);
    expect(shouldAcceptProjectorFastPath('safe-session', 4, 4, publicState({ revision: 4 }))).toBe(false);
    expect(shouldAcceptProjectorFastPath('safe-session', 4, 4, publicState({ sessionId: 'wrong-session', revision: 5 }))).toBe(false);
  });

  test('fast path never accepts an answer-bearing recap revision', () => {
    const recapAnswer = publicState({
      slidePosition: 7, presentationMode: 'recap', renderMode: 'recap', recapQuestionPosition: 6,
      answerRevealed: true, revealedAnswer: 'Syntetická odpověď', revision: 5,
    });
    expect(projectorPresentationAuthority(recapAnswer)).toBe('authoritative-only');
    expect(shouldAcceptProjectorFastPath('safe-session', 4, 4, recapAnswer)).toBe(false);
    expect(projectorPresentationAuthority({ ...recapAnswer, answerImage: 'https://example.test/answer.jpg' })).toBe('authoritative-only');
    expect(projectorPresentationAuthority(publicState({
      answerRevealed: true, revealedAnswer: 'Kompatibilní odpověď', revision: 5,
    }))).toBe('authoritative-only');
  });

  test('classifies non-answer state as fast-path-safe and rejects impossible recap selection', () => {
    expect(projectorPresentationAuthority(publicState({ revision: 5 }))).toBe('fast-path-safe');
    expect(parseProjectorChannelMessage({
      type: 'public-state',
      state: publicState({
        slidePosition: 7, presentationMode: 'recap', renderMode: 'recap', recapQuestionPosition: 99,
        answerRevealed: true, revealedAnswer: 'Syntetická odpověď', revision: 5,
      }),
    })).toBeUndefined();
  });
});
