import { describe, expect, test } from 'vitest';

import { LiveSessionError } from '../functions/src/live/errors';
import { buildPublicSessionState, displayAnswer, publicResultTemplate } from '../functions/src/live/publication';
import { applyLiveSessionAction, applyMediaPlaybackReport } from '../functions/src/live/session-machine';
import type { PrivateLiveSession, PrivateSlide } from '../functions/src/live/types';
import { mapEditorSlide, originalYoutubeSource } from '../packages/quiz-domain/src';
import { slideView } from '../functions/src/access/slide-view';
import { mapPublicLiveState } from '../apps/web/src/features/live/liveMappers';
import { parsePublicLiveState, sanitizedChannelState } from '../apps/web/src/features/live/projectorChannel';
import { createHash } from 'node:crypto';
import { verifiedOriginalYoutubeSource } from '../functions/src/media/original-source';
import { captureInterimReturn, parseInterimReturn, restoreInterimReturn, staticInterimBackdrop } from '../functions/src/live/show-mode';
import { closeSessions } from '../functions/src/live/event-lifecycle';
import { adjacentVisibleSlidePosition, requestedNavigationDirection } from '../functions/src/live/navigation';

const now = new Date('2026-09-01T10:00:00.000Z');

describe('server-authoritative adjacent navigation', () => {
  function navigationStore(slides: readonly Record<string, unknown>[]) {
    const reads: Array<{ cursor: number; limit: number; fields: readonly string[] }> = [];
    let cursor = 0, ascending = true, limit = 0, fields: string[] = [];
    const query = {
      where: (_field: string, _operator: string, value: number) => { cursor = value; return query; },
      orderBy: (_field: string, order: string) => { ascending = order === 'asc'; return query; },
      select: (...value: string[]) => { fields = value; return query; },
      limit: (value: number) => { limit = value; return query; },
    };
    const root = { collection: () => query } as unknown as Parameters<typeof adjacentVisibleSlidePosition>[1];
    const transaction = { get: () => {
      reads.push({ cursor, limit, fields });
      const candidates = slides.filter(slide => ascending ? Number(slide.position) > cursor : Number(slide.position) < cursor)
        .sort((a, b) => (Number(a.position) - Number(b.position)) * (ascending ? 1 : -1)).slice(0, limit);
      return Promise.resolve({ docs: candidates.map(slide => ({ data: () => slide })), size: candidates.length });
    } } as unknown as Parameters<typeof adjacentVisibleSlidePosition>[0];
    return { reads, transaction, root };
  }

  test.each([1, -1] as const)('batches a long hidden run in direction %s and returns the nearest visible slide', async direction => {
    const slides = Array.from({ length: 100 }, (_, index) => ({ position: index + 1, kind: 'intro', isQuestion: false, hidden: true }));
    const target = direction === 1 ? 99 : 2;
    slides[target - 1] = { ...slides[target - 1]!, hidden: false };
    const store = navigationStore(slides);
    expect(await adjacentVisibleSlidePosition(store.transaction, store.root, direction === 1 ? 0 : 101, direction)).toBe(target);
    expect(store.reads).toHaveLength(5);
    expect(store.reads[0]!.limit).toBe(1);
    expect(store.reads.slice(1).every(read => read.limit === 32)).toBe(true);
    expect(store.reads[0]!.fields).toEqual(['position', 'kind', 'isQuestion', 'roundId', 'hidden']);
  });

  test.each([1, -1] as const)('ordinary navigation reads only the adjacent candidate in direction %s', async direction => {
    const store = navigationStore(Array.from({ length: 100 }, (_, index) => ({ position: index + 1, kind: 'question', isQuestion: true })));
    expect(await adjacentVisibleSlidePosition(store.transaction, store.root, 50, direction)).toBe(50 + direction);
    expect(store.reads).toHaveLength(1);
    expect(store.reads[0]!.limit).toBe(1);
  });

  test('cannot skip a question or round header through a hidden flag', async () => {
    for (const protectedSlide of [{ kind: 'question', isQuestion: true }, { kind: 'intro', isQuestion: false, roundId: 'round-1' }]) {
      const store = navigationStore([{ position: 1, hidden: true, ...protectedSlide }]);
      expect(await adjacentVisibleSlidePosition(store.transaction, store.root, 0, 1)).toBe(1);
      expect(store.reads).toHaveLength(1);
    }
  });

  test('keeps the 400-slide scan bound and stops on an exhausted direction', async () => {
    const slides = Array.from({ length: 401 }, (_, index) => ({ position: index + 1, kind: 'intro', isQuestion: false, hidden: index !== 400 }));
    const store = navigationStore(slides);
    expect(await adjacentVisibleSlidePosition(store.transaction, store.root, 0, 1)).toBeUndefined();
    expect(store.reads).toHaveLength(14);
    expect(store.reads.at(-1)!.limit).toBe(15);
    const empty = navigationStore([]);
    expect(await adjacentVisibleSlidePosition(empty.transaction, empty.root, 0, -1)).toBeUndefined();
    expect(empty.reads).toHaveLength(1);
  });

  test('shared navigation callable accepts only an explicit direction or the legacy position payload', () => {
    expect(requestedNavigationDirection({ direction: 1 })).toBe(1);
    expect(requestedNavigationDirection({ direction: -1 })).toBe(-1);
    expect(requestedNavigationDirection({ position: 5 })).toBeUndefined();
    for (const direction of [0, 2, '1', null, true]) expect(() => requestedNavigationDirection({ direction })).toThrow(LiveSessionError);
    expect(() => requestedNavigationDirection({ direction: 1, position: 5 })).toThrow(LiveSessionError);
  });
});

const originalUrl = 'https://www.youtube.com/watch?v=abcdefghijk';
const clipSource = `quiz-asset:safe-quiz/${'a'.repeat(64)}`;
function originalVideo(): PrivateSlide {
  return { ...questionSlide(), kind: 'video', mediaSource: clipSource, clipStartSeconds: 0, clipEndSeconds: 12,
    originalMediaSource: originalUrl };
}

function session(overrides: Partial<PrivateLiveSession> = {}): PrivateLiveSession {
  return {
    sessionId: 'safe-session',
    quizId: 'safe-quiz',
    quizTitle: 'Syntetický kvíz',
    slideCount: 3,
    status: 'active',
    currentSlidePosition: 1,
    currentSlideId: 'slide-001',
    answerRevealed: false,
    presentationMode: 'slide',
    mediaCommand: 'idle',
    mediaPlaybackState: 'idle',
    mediaGeneration: 0,
    introGeneration: 0,
    revision: 1,
    createdBy: 'staff-1',
    updatedBy: 'staff-1',
    createdAt: now,
    startedAt: now,
    endedAt: null,
    updatedAt: now,
    ...overrides,
  };
}

function questionSlide(position = 1): PrivateSlide {
  return {
    id: `slide-${String(position).padStart(3, '0')}`,
    position,
    kind: 'question',
    isQuestion: true,
    title: 'Syntetická otázka',
    text: 'Veřejně zobrazitelný prompt',
    options: ['A', 'B', 'C'],
    media: [
      { role: 'prompt', kind: 'image', value: 'https://example.test/prompt.jpg' },
      { role: 'answer', kind: 'image', value: 'https://example.test/answer.jpg' },
      { role: 'unknown', kind: 'unknown', value: 'private-media' },
    ],
    presentation: { backgroundOverlay: 60, videoStart: 4, recapOverrides: [{ private: true }] },
    correctAnswer: 'SENTINEL-REVEALED-ANSWER',
    moderatorNote: 'SENTINEL-MODERATOR-NOTE',
    legacy: { raw: { correct: 'SENTINEL-LEGACY-ANSWER', privateField: 'SENTINEL-PRIVATE' } },
  };
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...allKeys(nested)]);
}

function expectNoPrivateFields(value: unknown): void {
  expect(allKeys(value)).not.toEqual(expect.arrayContaining([
    'correctAnswer',
    'correct',
    'moderatorNote',
    'legacy',
    'raw',
    'privateField',
    'recapOverrides',
  ]));
}

describe('live-session publication security', () => {
  test('publishes resolved safe visuals and reveal-only overrides without private design extensions', () => {
    const slide = { ...questionSlide(), defaultDesign: { textColor: '#fff', fontScale: 1 }, roundDesign: { accentColor: '#abc' }, design: { layout: 'centered', correctAnswer: 'SENTINEL-NESTED', logoImage: 'javascript:SENTINEL' }, answerDesign: { textColor: '#000', logoImage: 'https://example.test/SENTINEL-ANSWER.png' } };
    const hidden = buildPublicSessionState(session(), slide);
    expect(hidden.design).toEqual({ textColor: '#fff', fontScale: 1, accentColor: '#abc', layout: 'centered' });
    expect(JSON.stringify(hidden)).not.toContain('SENTINEL');
    expect(hidden).not.toHaveProperty('answerDesign');
    expect(buildPublicSessionState(session({ answerRevealed: true }), slide).design).toMatchObject({ textColor: '#000', logoImage: 'https://example.test/SENTINEL-ANSWER.png' });
    expect(buildPublicSessionState(session({ presentationMode: 'recap', recapQuestionPosition: 1 }), slide).design).toMatchObject({ textColor: '#000' });
    expect(buildPublicSessionState(session({ status: 'ended' }), slide)).not.toHaveProperty('design');
  });
  test('result template allowlist never carries injected scores, contacts or answer values', () => {
    expect(publicResultTemplate({ defaultDesign: { textColor: '#fff', answer: 'SENTINEL' }, resultTemplates: { interim: { title: 'Round results', subtitle: 'Totals', rows: ['SENTINEL'], contacts: 'SENTINEL', design: { textColor: '#abc', raw: 'SENTINEL' } } } }, 'interim')).toEqual({ title: 'Round results', subtitle: 'Totals', design: { textColor: '#abc' } });
  });
  test('publication fails closed for hidden information but never suppresses game records', () => {
    expect(() => buildPublicSessionState(session(), { ...questionSlide(), kind: 'info', isQuestion: false, hidden: true })).toThrow();
    expect(buildPublicSessionState(session(), { ...questionSlide(), hidden: true })).toMatchObject({ slideKind: 'question' });
  });
  test('publishes an explicit allowlist before reveal without answer or private nested fields', () => {
    const publicState = buildPublicSessionState(session(), questionSlide());
    expect(publicState).toMatchObject({
      status: 'active',
      slidePosition: 1,
      answerRevealed: false,
      title: 'Syntetická otázka',
      options: ['A', 'B', 'C'],
      presentation: { backgroundOverlay: 60 },
      clipStartSeconds: 4,
    });
    expect(publicState).not.toHaveProperty('revealedAnswer');
    expect(publicState).not.toHaveProperty('answerImage');
    expect(publicState.media).toEqual([
      { role: 'prompt', kind: 'image', source: 'https://example.test/prompt.jpg' },
    ]);
    expect(JSON.stringify(publicState)).not.toContain('SENTINEL-');
    expectNoPrivateFields(publicState);
  });

  test('after reveal publishes only display answer and explicitly allowed answer image', () => {
    const publicState = buildPublicSessionState(session({ answerRevealed: true }), questionSlide());
    expect(publicState).toMatchObject({
      answerRevealed: true,
      renderMode: 'recap',
      revealedAnswer: 'SENTINEL-REVEALED-ANSWER',
      answerImage: 'https://example.test/answer.jpg',
    });
    expect(JSON.stringify(publicState)).not.toContain('SENTINEL-MODERATOR-NOTE');
    expect(JSON.stringify(publicState)).not.toContain('SENTINEL-LEGACY-ANSWER');
    expect(JSON.stringify(publicState)).not.toContain('SENTINEL-PRIVATE');
    expectNoPrivateFields(publicState);
  });

  test('rejects blank and non-finite display answers consistently', () => {
    for (const value of ['', '   ', [], [Number.NaN], [Number.POSITIVE_INFINITY]]) {
      expect(displayAnswer(value)).toBeUndefined();
    }
    expect(displayAnswer([0, false, 'A'])).toBe('0, false, A');
  });

  test('moving after reveal resets the answer and removes stale answer fields', () => {
    const revealed = session({ answerRevealed: true, revision: 5 });
    const nextSlide = questionSlide(2);
    const moved = applyLiveSessionAction(
      revealed,
      { type: 'next-slide', slideId: nextSlide.id },
      5,
      'staff-2',
      now,
      nextSlide,
    );
    const publicState = buildPublicSessionState(moved, nextSlide);
    expect(moved).toMatchObject({ currentSlidePosition: 2, answerRevealed: false, revision: 6 });
    expect(publicState.answerRevealed).toBe(false);
    expect(publicState.renderMode).toBe('question');
    expect(publicState).not.toHaveProperty('revealedAnswer');
    expect(publicState).not.toHaveProperty('answerImage');
    expectNoPrivateFields(publicState);
  });

  test('waiting and ended snapshots contain no stale slide payload', () => {
    const waiting = buildPublicSessionState(session({
      status: 'waiting',
      currentSlidePosition: 0,
      currentSlideId: undefined,
    }), questionSlide());
    const ended = buildPublicSessionState(session({ status: 'ended', answerRevealed: true }), questionSlide());
    for (const state of [waiting, ended]) {
      expect(state.answerRevealed).toBe(false);
      expect(state).not.toHaveProperty('title');
      expect(state).not.toHaveProperty('revealedAnswer');
      expectNoPrivateFields(state);
    }
  });

  test('legacy pl is rendered through safe public fallback without raw metadata', () => {
    const legacy = { ...questionSlide(), kind: 'pl', legacy: { raw: { correct: 'private' } } };
    const publicState = buildPublicSessionState(session(), legacy);
    expect(publicState.slideKind).toBe('pl');
    expectNoPrivateFields(publicState);
  });

  test('normal audio never publishes its source while recap publishes only the selected answer and media', () => {
    const audio: PrivateSlide = {
      ...questionSlide(2), id: 'slide-002', kind: 'audio', mediaSource: 'abcdefghijk',
      questionNumber: 2, questionCount: 10,
    };
    const normal = buildPublicSessionState(session({ currentSlidePosition: 2, currentSlideId: 'slide-002' }), audio);
    expect(normal).not.toHaveProperty('mediaSource');
    expect(normal).not.toHaveProperty('revealedAnswer');
    expectNoPrivateFields(normal);

    const recapState = buildPublicSessionState(session({
      currentSlidePosition: 3,
      currentSlideId: 'slide-003',
      presentationMode: 'recap',
      recapQuestionPosition: 2,
      recapQuestionId: 'slide-002',
      answerRevealed: true,
    }), audio);
    expect(recapState).toMatchObject({ renderMode: 'recap', mediaSource: 'abcdefghijk', revealedAnswer: 'SENTINEL-REVEALED-ANSWER' });
    expectNoPrivateFields(recapState);
  });
});

describe('live-session state machine', () => {
  test('direct reveal and hide stop active timed media and invalidate its callbacks', () => {
    const playing = session({ mediaCommand: 'play', mediaPlaybackState: 'playing', mediaGeneration: 8 });
    const video = { ...questionSlide(), kind: 'video', mediaSource: 'abcdefghijk', clipStartSeconds: 20, clipEndSeconds: 30 };
    const revealed = applyLiveSessionAction(playing, { type: 'reveal-answer' }, playing.revision, 'moderator', now, video);
    expect(revealed).toMatchObject({ answerRevealed: true, mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 9 });
    expect(buildPublicSessionState(revealed, video)).toMatchObject({ renderMode: 'recap', mediaCommand: 'idle', mediaGeneration: 9 });
    expect(applyLiveSessionAction(revealed, { type: 'hide-answer' }, revealed.revision, 'moderator', now, video)).toMatchObject({ answerRevealed: false, mediaGeneration: 10, mediaCommand: 'idle' });
  });
  test('1,000 alternating slide transitions remain bounded and never retain an answer', () => {
    let current = session({ slideCount: 2, answerRevealed: true });
    const durations: number[] = [];
    for (let index = 0; index < 1_000; index += 1) {
      const target = current.currentSlidePosition === 1 ? questionSlide(2) : questionSlide(1);
      const action = current.currentSlidePosition === 1
        ? { type: 'next-slide' as const, slideId: target.id }
        : { type: 'previous-slide' as const, slideId: target.id };
      const started = performance.now();
      current = applyLiveSessionAction(current, action, current.revision, 'moderator', now, target);
      durations.push(performance.now() - started);
      const publicState = buildPublicSessionState(current, target);
      expect(publicState.answerRevealed).toBe(false);
      expect(publicState).not.toHaveProperty('revealedAnswer');
      expectNoPrivateFields(publicState);
    }
    const mean = (values: readonly number[]) => values.reduce((total, value) => total + value, 0) / values.length;
    expect(current.revision).toBe(1_001);
    expect(mean(durations.slice(500))).toBeLessThan(mean(durations.slice(0, 500)) * 10 + 0.1);
  });

  test('starts at position zero, then moves next and previous with monotonic revisions', () => {
    const waiting = session({
      status: 'waiting',
      currentSlidePosition: 0,
      currentSlideId: undefined,
      revision: 0,
      startedAt: null,
    });
    const first = questionSlide(1);
    const active = applyLiveSessionAction(
      waiting,
      { type: 'next-slide', slideId: first.id },
      0,
      'moderator',
      now,
      first,
    );
    expect(active).toMatchObject({ status: 'active', currentSlidePosition: 1, revision: 1 });

    const second = questionSlide(2);
    const advanced = applyLiveSessionAction(active, { type: 'next-slide', slideId: second.id }, 1, 'moderator', now, second);
    const returned = applyLiveSessionAction(advanced, { type: 'previous-slide', slideId: first.id }, 2, 'moderator', now, first);
    expect(returned).toMatchObject({ currentSlidePosition: 1, revision: 3 });
  });

  test('reveals and hides an answer only on an active question', () => {
    const slide = questionSlide();
    const revealed = applyLiveSessionAction(session(), { type: 'reveal-answer' }, 1, 'moderator', now, slide);
    expect(revealed).toMatchObject({ answerRevealed: true, revision: 2 });
    const hidden = applyLiveSessionAction(revealed, { type: 'hide-answer' }, 2, 'moderator', now, slide);
    expect(hidden).toMatchObject({ answerRevealed: false, revision: 3 });
  });

  test('rejects invalid positions, ended mutations, missing answers, and stale concurrent operations', () => {
    const first = questionSlide();
    expect(() => applyLiveSessionAction(
      session(),
      { type: 'go-to-slide', position: 99, slideId: first.id },
      1,
      'moderator',
      now,
      first,
    )).toThrow(LiveSessionError);
    expect(() => applyLiveSessionAction(session({ status: 'ended' }), { type: 'reveal-answer' }, 1, 'moderator', now, first))
      .toThrow(/ended/u);
    expect(() => applyLiveSessionAction(session(), { type: 'reveal-answer' }, 1, 'moderator', now, {
      ...first,
      correctAnswer: undefined,
    })).toThrow(/displayable answer/u);
    expect(() => applyLiveSessionAction(session({ revision: 8 }), { type: 'reveal-answer' }, 7, 'moderator', now, first))
      .toThrow(/changed/u);
  });

  test('ending clears reveal state and prevents all later mutations', () => {
    const ended = applyLiveSessionAction(
      session({ answerRevealed: true }),
      { type: 'end-session' },
      1,
      'admin',
      now,
    );
    expect(ended).toMatchObject({ status: 'ended', answerRevealed: false, revision: 2, endedAt: now });
    expect(() => applyLiveSessionAction(ended, { type: 'hide-answer' }, 2, 'admin', now, questionSlide()))
      .toThrow(/ended/u);
  });

  test('selects recap questions in arbitrary order and resets media generation on every selection', () => {
    const recapSession = session({
      currentSlidePosition: 3,
      currentSlideId: 'slide-003',
      presentationMode: 'recap',
      mediaGeneration: 4,
    });
    const second = questionSlide(2);
    const selectedSecond = applyLiveSessionAction(
      recapSession,
      { type: 'select-recap-question', position: 2, slideId: second.id },
      1,
      'moderator',
      now,
      second,
    );
    expect(selectedSecond).toMatchObject({ recapQuestionPosition: 2, answerRevealed: true, mediaGeneration: 5 });
    const first = questionSlide(1);
    const selectedFirst = applyLiveSessionAction(
      selectedSecond,
      { type: 'select-recap-question', position: 1, slideId: first.id },
      2,
      'moderator',
      now,
      first,
    );
    expect(selectedFirst).toMatchObject({ recapQuestionPosition: 1, answerRevealed: true, revision: 3, mediaGeneration: 6 });
  });

  test('media commands carry monotonic generations and stale slide callbacks cannot target a replaced slide', () => {
    const audio = { ...questionSlide(), kind: 'audio' };
    const playing = applyLiveSessionAction(session(), { type: 'play-media' }, 1, 'moderator', now, audio);
    expect(playing).toMatchObject({ mediaCommand: 'play', mediaPlaybackState: 'preparing', mediaGeneration: 1, revision: 2 });
    expect(() => applyLiveSessionAction(playing, { type: 'finish-media' }, 2, 'moderator', now, questionSlide(2)))
      .toThrow(/active presentation slide/u);
    const stopped = applyLiveSessionAction(playing, { type: 'stop-media' }, 2, 'moderator', now, audio);
    expect(stopped).toMatchObject({ mediaCommand: 'stop', mediaPlaybackState: 'idle', mediaGeneration: 2, revision: 3 });
  });

  test('trusted playback reports distinguish command from actual player state and reject stale order', () => {
    const audio = { ...questionSlide(), kind: 'audio' };
    const preparing = applyLiveSessionAction(session(), { type: 'play-media' }, 1, 'moderator', now, audio);
    const ready = applyMediaPlaybackReport(preparing, 'ready', preparing.mediaGeneration, 'moderator', now);
    expect(ready).toMatchObject({ mediaCommand: 'play', mediaPlaybackState: 'ready', revision: 3 });
    const playing = applyMediaPlaybackReport(ready, 'playing', ready.mediaGeneration, 'moderator', now);
    expect(playing).toMatchObject({ mediaCommand: 'play', mediaPlaybackState: 'playing', revision: 4 });
    const failed = applyMediaPlaybackReport(playing, 'error', playing.mediaGeneration, 'moderator', now);
    expect(failed).toMatchObject({ mediaCommand: 'error', mediaPlaybackState: 'error', revision: 5 });
    expect(() => applyMediaPlaybackReport(failed, 'ready', failed.mediaGeneration, 'moderator', now)).toThrow(/out-of-order/u);
    expect(() => applyMediaPlaybackReport(playing, 'finished', playing.mediaGeneration - 1, 'moderator', now)).toThrow(/stale/u);
  });
});

test('native audio pause and resume keep generation; stopped callbacks remain stale', () => {
  const playing = session({mediaCommand:'play',mediaPlaybackState:'playing',mediaGeneration:4});
  const paused = applyMediaPlaybackReport(playing,'ready',4,'staff-1',now);
  expect(paused.mediaPlaybackState).toBe('ready');
  expect(applyMediaPlaybackReport(paused,'playing',4,'staff-1',now).mediaPlaybackState).toBe('playing');
  expect(()=>applyMediaPlaybackReport({...paused,mediaGeneration:5},'playing',4,'staff-1',now)).toThrow();
});


test('player explanation is revealed explicitly and moderator note remains private', () => {
  const slide = { ...questionSlide(), imageLayout:'stacked', answerExplanation:'PRIVATE-EXPLANATION' };
  const before = buildPublicSessionState(session(),slide);
  expect(before).toMatchObject({imageLayout:'stacked'});
  expect(JSON.stringify(before)).not.toContain('PRIVATE-EXPLANATION');
  const after = buildPublicSessionState(session({answerRevealed:true}),slide);
  expect(after.answerExplanation).toBe('PRIVATE-EXPLANATION');
  expectNoPrivateFields(after);
});

test('original YouTube source is private and only an explicit revealed play substitutes the prepared clip', () => {
  const slide = originalVideo();
  const hidden = buildPublicSessionState(session(), slide);
  expect(hidden.mediaSource).toBe(clipSource);
  expect(JSON.stringify(hidden)).not.toContain('abcdefghijk');
  expect(() => applyLiveSessionAction(session(), { type: 'play-media', mode: 'original' }, 1, 'moderator', now, slide)).toThrow(/revealed answer/u);
  const revealed = applyLiveSessionAction(session(), { type: 'reveal-answer' }, 1, 'moderator', now, slide);
  expect(buildPublicSessionState(revealed, slide).mediaSource).toBe(clipSource);
  const playing = applyLiveSessionAction(revealed, { type: 'play-media', mode: 'original' }, 2, 'moderator', now, slide);
  const published = buildPublicSessionState(playing, slide);
  expect(published).toMatchObject({ mediaSource: originalUrl, mediaPlaybackMode: 'original', clipStartSeconds: 0, answerRevealed: true, renderMode: 'recap' });
  expect(published).not.toHaveProperty('clipEndSeconds');
  expect(published).not.toHaveProperty('originalMediaSource');
  expect(published).not.toHaveProperty('driveImportProvenance');
  const mapped = mapPublicLiveState(playing.sessionId, published);
  expect(parsePublicLiveState(mapped)?.mediaPlaybackMode).toBe('original');
  expect(sanitizedChannelState(mapped).mediaSource).toBe(originalUrl);
  expect(parsePublicLiveState({ ...mapped, answerRevealed: false })).toBeUndefined();
  expect(parsePublicLiveState({ ...mapped, clipEndSeconds: 12 })).toBeUndefined();
  expect(() => mapPublicLiveState(playing.sessionId, { ...published, answerRevealed: false })).toThrow();
  const clip = applyLiveSessionAction(playing, { type: 'play-media' }, 3, 'moderator', now, slide);
  expect(buildPublicSessionState(clip, slide).mediaSource).toBe(clipSource);
  expect(clip).not.toHaveProperty('mediaPlaybackMode');
});

test('original mode resets on hide, navigation, recap selection and rejects missing source', () => {
  const slide = originalVideo();
  const playing = session({ answerRevealed: true, mediaPlaybackMode: 'original', mediaCommand: 'play', mediaPlaybackState: 'playing' });
  expect(applyLiveSessionAction(playing, { type: 'hide-answer' }, 1, 'moderator', now, slide)).not.toHaveProperty('mediaPlaybackMode');
  expect(applyLiveSessionAction(playing, { type: 'go-to-slide', position: 2, slideId: 'slide-002' }, 1, 'moderator', now, questionSlide(2))).not.toHaveProperty('mediaPlaybackMode');
  expect(applyLiveSessionAction({ ...playing, presentationMode: 'recap', currentSlidePosition: 3 }, { type: 'select-recap-question', position: 1, slideId: slide.id }, 1, 'moderator', now, slide)).not.toHaveProperty('mediaPlaybackMode');
  expect(() => applyLiveSessionAction(session({ answerRevealed: true }), { type: 'play-media', mode: 'original' }, 1, 'moderator', now, { ...slide, originalMediaSource: undefined })).toThrow();
  expect(buildPublicSessionState({ ...playing, answerRevealed: false }, slide).mediaSource).toBe(clipSource);
});

test('private mapping extracts only canonical original YouTube and redacts it without answer authority', () => {
  const importJobId = 'b'.repeat(64), assetId = createHash('sha256').update(JSON.stringify(['drive-asset-v1', importJobId])).digest('hex');
  const raw = { ...questionSlide(), kind: 'audio', mediaSource: `quiz-asset:safe-quiz/${assetId}`,
    driveImportProvenance: { mediaSource: { importJobId, field: 'mediaSource', source: { type: 'youtube', videoId: 'abcdefghijk', privateToken: 'SECRET' } } } };
  expect(mapEditorSlide('slide', raw).originalMediaSource).toBe(originalUrl);
  expect(slideView('slide', raw, true, true).originalMediaSource).toBe(originalUrl);
  expect(slideView('slide', raw, false, true).originalMediaSource).toBeUndefined();
  expect(verifiedOriginalYoutubeSource(raw)).toBe(originalUrl);
  expect(slideView('slide', { ...raw, mediaSource: clipSource }, true, true).originalMediaSource).toBeUndefined();
  expect(originalYoutubeSource({ ...raw, mediaSource: 'https://example.test/other.mp4' })).toBeUndefined();
  expect(originalYoutubeSource({ ...raw, driveImportProvenance: { mediaSource: { field: 'mediaSource', source: { type: 'youtube', videoId: '<script>' } } } })).toBeUndefined();
  expect(JSON.stringify(mapEditorSlide('slide', raw))).not.toContain('SECRET');
});

test.each(['slide', 'recap'] as const)('results entry and %s return preserve explicit answer intent without resurrecting original playback', presentationMode => {
  const question = { ...originalVideo(), roundId: 'round' };
  const current = presentationMode === 'recap' ? { ...questionSlide(3), kind: 'recap', isQuestion: false, roundId: 'round' } : question;
  const playing = session({ snapshotId: 'snapshot', currentSlidePosition: current.position, currentSlideId: current.id, presentationMode,
    answerRevealed: true, mediaPlaybackMode: 'original', mediaCommand: 'play', mediaPlaybackState: 'playing',
    ...(presentationMode === 'recap' ? { recapQuestionPosition: question.position, recapQuestionId: question.id } : {}) });
  const intent = captureInterimReturn(playing, current);
  expect(intent).not.toHaveProperty('mediaPlaybackMode');
  expect(() => parseInterimReturn({ ...intent, mediaPlaybackMode: 'original' })).toThrow();
  // Both result controllers enter/hide/resume through this navigation action.
  const entered = applyLiveSessionAction(playing, { type: 'go-to-slide', position: current.position, slideId: current.id }, playing.revision, 'moderator', now, current);
  expect(entered).not.toHaveProperty('mediaPlaybackMode');
  expect(entered).toMatchObject({ answerRevealed: false, mediaCommand: 'idle', mediaPlaybackState: 'idle' });
  const backdrop = staticInterimBackdrop(playing, current);
  expect(JSON.stringify(backdrop)).not.toContain('abcdefghijk');
  const restored = restoreInterimReturn({ ...entered, interimReturn: intent }, current, presentationMode === 'recap' ? question : undefined, true, 'moderator', now);
  expect(restored.restored).toBe(true);
  expect(restored.session).not.toHaveProperty('mediaPlaybackMode');
  expect(restored.session).toMatchObject({ answerRevealed: true, mediaCommand: 'idle', mediaPlaybackState: 'idle' });
  expect(buildPublicSessionState(restored.session, restored.slide).mediaSource).toBe(clipSource);
});

test('event cancellation closure strips original mode and publishes no media source', () => {
  const writes: Array<{ path: string; value: unknown }> = [];
  const transaction = { set: (reference: { path: string }, value: unknown) => { writes.push({ path: reference.path, value }); } };
  const playing = session({ answerRevealed: true, mediaPlaybackMode: 'original', mediaCommand: 'play', mediaPlaybackState: 'playing' });
  const reference = { path: 'sessions/' + playing.sessionId } as unknown as Parameters<typeof closeSessions>[1][number]['ref'];
  closeSessions(transaction as unknown as Parameters<typeof closeSessions>[0], [{ ref: reference, session: playing }], 'moderator');
  expect(writes).toHaveLength(2);
  const privateState = writes.find(write => write.path.startsWith('sessions/'))!.value;
  const publicState = writes.find(write => write.path.startsWith('publicSessions/'))!.value;
  expect(privateState).not.toHaveProperty('mediaPlaybackMode');
  expect(privateState).not.toHaveProperty('finalReveal');
  expect(privateState).toMatchObject({ status: 'ended', answerRevealed: false, mediaCommand: 'idle' });
  expect(publicState).not.toHaveProperty('mediaSource');
  expect(publicState).not.toHaveProperty('mediaPlaybackMode');
  expect(JSON.stringify(publicState)).not.toContain('abcdefghijk');
});

test.each(['active', 'ended'] as const)('event closure retains confirmed history for a %s session and clears public overlays', status => {
  const finalReveal = { versionId: 'f'.repeat(64), visible: true, mode: 'table' as const, revealedCount: 2, totalGroups: 2, rank: null, page: 1, pageCount: 2, presentationStyle: 'show' as const, pageSize: 6 as const };
  const current = session({ status, eventId: 'event', snapshotId: 'snapshot', finalReveal,
    interimResults: { versionId: 'i'.repeat(64), roundNumber: 1, page: 0, pageCount: 1 },
    interimReturn: { snapshotId: 'snapshot', slideId: 'slide-001', slidePosition: 1, presentationMode: 'slide', answerRevealed: true, capturedRevision: 1 },
    showCue: { id: 'c'.repeat(64), kind: 'winners', startedAt: 1, durationMs: 1000, motion: 'static', intensity: 'subtle', topThree: true, winnerAnimation: true },
    ...(status === 'ended' ? { endedAt: now } : {}) });
  const reference = { path: 'sessions/' + current.sessionId } as unknown as Parameters<typeof closeSessions>[1][number]['ref'];
  const writes = new Map<string, unknown>();
  const transaction = { set: (ref: { path: string }, value: unknown) => { writes.set(ref.path, value); } } as unknown as Parameters<typeof closeSessions>[0];
  closeSessions(transaction, [{ ref: reference, session: current }], 'owner');
  const ended = writes.get(reference.path) as PrivateLiveSession;
  expect(ended.finalReveal).toEqual({ ...finalReveal, visible: false });
  expect(ended).toMatchObject({ status: 'ended', eventId: 'event', snapshotId: 'snapshot', revision: current.revision + (status === 'ended' ? 0 : 1) });
  if (status === 'ended') expect(ended.endedAt).toBe(now);
  for (const field of ['interimResults', 'interimReturn', 'showCue']) expect(ended).not.toHaveProperty(field);
  const published = writes.get('publicSessions/' + current.sessionId);
  expect(published).toMatchObject({ status: 'ended', answerRevealed: false, mediaCommand: 'idle', mediaPlaybackState: 'idle' });
  for (const field of ['finalReveal', 'interimResults', 'interimBackdrop', 'showCue', 'revealedAnswer', 'answerImage', 'mediaSource', 'snapshotId', 'eventId']) expect(published).not.toHaveProperty(field);
  closeSessions(transaction, [{ ref: reference, session: ended }], 'owner');
  expect(writes.get(reference.path)).toEqual(ended);
  expect(writes.get('publicSessions/' + current.sessionId)).toEqual(published);
});

test('explicit slide navigation hides a confirmed finale while retaining its private version', () => {
  const finalReveal = { versionId: 'f'.repeat(64), visible: true, mode: 'intro' as const, revealedCount: 0, totalGroups: 2, rank: null, page: 0, pageCount: 1 };
  const current = session({ finalReveal, answerRevealed: true, mediaCommand: 'play', mediaPlaybackState: 'playing' });
  const target = questionSlide(2);
  const navigated = applyLiveSessionAction(current, { type: 'go-to-slide', position: 2, slideId: target.id }, current.revision, 'moderator', now, target);
  expect(navigated.finalReveal).toEqual({ ...finalReveal, visible: false });
  expect(navigated).toMatchObject({ answerRevealed: false, mediaCommand: 'idle', mediaPlaybackState: 'idle' });
  expect(buildPublicSessionState(navigated, target)).not.toHaveProperty('finalReveal');
  expect(buildPublicSessionState(navigated, target)).not.toHaveProperty('revealedAnswer');
});
