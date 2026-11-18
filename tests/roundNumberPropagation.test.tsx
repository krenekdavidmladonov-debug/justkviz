// @vitest-environment happy-dom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { QuizPractice } from '../apps/web/src/features/editor/QuizPractice';
import { mapLiveControlSlide, mapPublicLiveState } from '../apps/web/src/features/live/liveMappers';
import { parsePublicLiveState, sanitizedChannelState } from '../apps/web/src/features/live/projectorChannel';
import { SlidePreview } from '../apps/web/src/features/presentation/SlidePreview';
import type { EditorQuiz, EditorSlide } from '../packages/quiz-domain/src/types';

vi.mock('../apps/web/src/features/media/usePrivateMediaPrefetch', () => ({ usePrivateMediaPrefetch: vi.fn() }));

const publicRound = {
  sessionId: 'synthetic-round-session', quizTitle: 'Syntetický kvíz', status: 'active',
  slidePosition: 3, slideKind: 'round', title: 'Druhé téma', text: '', roundNumber: 2,
  options: [], media: [], presentation: {}, presentationMode: 'slide', renderMode: 'roundIntro',
  mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 0, introGeneration: 0,
  answerRevealed: false, revision: 1,
} as const;

test('moderator public mapping and projector channel retain the round position', () => {
  const mapped = mapPublicLiveState(publicRound.sessionId, publicRound);
  expect(mapped.roundNumber).toBe(2);
  expect(sanitizedChannelState(mapped).roundNumber).toBe(2);
  expect(parsePublicLiveState(publicRound)?.roundNumber).toBe(2);
  expect(mapLiveControlSlide('round-two', { position: 3, kind: 'round', roundNumber: 2 }).roundNumber).toBe(2);
});

test.each([undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('private mapping omits invalid round number %s', roundNumber => {
  expect(mapLiveControlSlide('round-two', { position: 3, kind: 'round', roundNumber })).not.toHaveProperty('roundNumber');
});

test('editor SlidePreview forwards the round position to the shared renderer', () => {
  const markup = renderToStaticMarkup(<SlidePreview quizTitle="Syntetický kvíz"
    slide={{ kind: 'round', title: 'Druhé téma', text: '', options: [], media: [], roundNumber: 2 }} />);
  expect(markup).toContain('2. KOLO');
  expect(markup).not.toContain('NOVÉ KOLO');
});

function slide(id: string, position: number, kind: 'round' | 'intro' | 'question', roundId: string): EditorSlide {
  return {
    id, position, kind, storedKind: kind, roundId, roundTitle: roundId, isQuestion: kind === 'question',
    title: kind === 'question' ? '' : roundId, text: kind === 'question' ? 'Syntetická otázka' : '',
    moderatorNote: '', options: [], correctAnswer: '', media: [],
    presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null },
    backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '', backgroundOverlay: null,
    clipStartSeconds: null, clipEndSeconds: null, hasLegacyData: false,
  };
}

test('private rehearsal derives each round number from its position, including legacy round intros', async () => {
  const quiz: EditorQuiz = {
    id: 'synthetic-quiz', title: 'Syntetický kvíz', description: '', revision: 1,
    slideCount: 4, roundCount: 2, questionCount: 2,
    slides: [slide('round-one', 1, 'round', 'První téma'), slide('question-one', 2, 'question', 'První téma'),
      slide('round-two', 3, 'intro', 'Druhé téma'), slide('question-two', 4, 'question', 'Druhé téma')],
  };
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<QuizPractice quiz={quiz} onClose={() => {}} />); });
    expect(host.querySelector('.slide-kicker')?.textContent).toBe('1. KOLO');
    const next = [...host.querySelectorAll('button')].find(button => button.textContent === 'Další')!;
    await act(async () => { next.click(); });
    expect(host.querySelector('.slide-round-title')?.textContent).toBe('1. KOLO · První téma');
    await act(async () => { next.click(); });
    expect(host.querySelector('.slide-kicker')?.textContent).toBe('VÍTEJTE NA KVÍZU');
    expect(host.querySelector('.slide-renderer h1')?.textContent).toBe('Druhé téma');
  } finally {
    await act(async () => { root.unmount(); });
    host.remove(); vi.unstubAllGlobals();
  }
});
