// @vitest-environment happy-dom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { SlideRenderer } from '../apps/web/src/features/presentation/SlideRenderer';
import { ProjectorMotionContext } from '../apps/web/src/features/show-mode/ProjectorMotion';
import { ProjectorPage } from '../apps/web/src/routes/projector/ProjectorPage';
import { readPublicLiveStateFromServer, subscribePublicLiveState } from '../apps/web/src/features/live/liveRepository';
import type { PublicLiveState } from '../apps/web/src/features/live/types';

vi.mock('../apps/web/src/features/live/liveRepository', () => ({
  readPublicLiveStateFromServer: vi.fn(), subscribePublicLiveState: vi.fn(),
}));

beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(() => { vi.clearAllMocks(); });

async function mounted(element: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(element); });
  return { host, root, async close() { await act(async () => { root.unmount(); }); host.remove(); } };
}

for (const kind of ['intro', 'round']) {
  test.each(['projector', 'moderator', 'editor', 'offline'])(`${kind} shows a round number in %s`, async surface => {
    const slide = <SlideRenderer quizTitle="Večerní kvíz" mediaEnabled={false}
      {...(surface === 'editor' ? { mode: 'editorPreview' as const } : {})}
      slide={{ kind, roundNumber: 3, title: 'Český film', text: '', options: [], media: [] }} />;
    const view = await mounted(surface === 'projector'
      ? <ProjectorMotionContext.Provider value={{ animated: false, key: 'round', phase: 'none' }}>{slide}</ProjectorMotionContext.Provider>
      : slide);
    try { expect(view.host.querySelector('.slide-kicker')?.textContent).toBe('3. KOLO'); }
    finally { await view.close(); }
  });
}

test.each([undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('round intro without a valid round number (%s) keeps the fallback', async roundNumber => {
  const view = await mounted(<SlideRenderer quizTitle="Kvíz" mediaEnabled={false}
    slide={{ kind: 'round', ...(roundNumber === undefined ? {} : { roundNumber }), title: 'Český film', text: '', options: [], media: [] }} />);
  try { expect(view.host.querySelector('.slide-kicker')?.textContent).toBe('NOVÉ KOLO'); }
  finally { await view.close(); }
});

test.each([
  ['Český film', 2, '2. KOLO · Český film'],
  ['2. KOLO · Český film', 2, '2. KOLO · Český film'],
  ['2. kolo: Český film', 2, '2. kolo: Český film'],
  ['Český film', undefined, 'Český film'],
] as const)('question footer %s does not duplicate its number', async (roundTitle, roundNumber, expected) => {
  const view = await mounted(<SlideRenderer quizTitle="Kvíz" mediaEnabled={false}
    slide={{ kind: 'question', roundTitle, ...(roundNumber === undefined ? {} : { roundNumber }), title: 'Zadání', text: '', options: [], media: [] }} />);
  try { expect(view.host.querySelector('.slide-round-title')?.textContent).toBe(expected); }
  finally { await view.close(); }
});

test('waiting projector shows a full welcome and never renders stale question or answer content, then displays the actual quiz intro', async () => {
  const waiting: PublicLiveState = {
    sessionId: 'synthetic-welcome', quizTitle: 'JustKvíz · filmový večer', status: 'waiting',
    slidePosition: 0, options: ['STALE-OPTION'], media: [], presentation: {},
    presentationMode: 'slide', renderMode: 'recap', mediaCommand: 'play', mediaPlaybackState: 'playing',
    mediaGeneration: 1, introGeneration: 0, answerRevealed: true, revision: 0,
    slideKind: 'question', title: 'STALE-QUESTION', text: 'STALE-PROMPT', revealedAnswer: 'STALE-ANSWER',
    answerImage: 'https://example.test/STALE-ANSWER.png', mediaSource: 'abcdefghijk',
    design: { showLogo: false, backgroundImage: 'https://example.test/STALE-BACKGROUND.png' },
  };
  vi.mocked(readPublicLiveStateFromServer).mockResolvedValue(waiting);
  vi.mocked(subscribePublicLiveState).mockReturnValue(() => {});
  const router = createMemoryRouter([{ path: '/projector/:sessionId', element: <ProjectorPage /> }], {
    initialEntries: ['/projector/synthetic-welcome'],
  });
  const view = await mounted(<RouterProvider router={router} />);
  try {
    const canvas = view.host.querySelector('.projector-viewport .slide-renderer.kind-intro');
    expect(canvas).not.toBeNull();
    expect(canvas?.querySelector('.slide-kicker')?.textContent).toBe('VÍTEJTE NA KVÍZU');
    expect(canvas?.querySelector('h1')?.textContent).toBe(waiting.quizTitle);
    expect(canvas?.querySelector('svg[aria-label="JustKvíz"]')).not.toBeNull();
    expect(view.host.innerHTML).not.toContain('STALE-');
    expect(view.host.querySelector('iframe, video, audio, .slide-answer')).toBeNull();
    const next = vi.mocked(subscribePublicLiveState).mock.calls[0]![1];
    await act(async () => { next({ ...waiting, status: 'active', revision: 1, slidePosition: 1,
      slideKind: 'intro', title: 'Skutečný úvod kvízu', text: '', options: [], design: {},
      renderMode: 'roundIntro', mediaCommand: 'idle', mediaPlaybackState: 'idle',
      answerRevealed: false, revealedAnswer: '', answerImage: '', mediaSource: '',
    }); });
    expect(view.host.querySelector('h1')?.textContent).toBe('Skutečný úvod kvízu');
    expect(view.host.textContent).not.toContain('STALE-ANSWER');
  } finally { await view.close(); router.dispose(); }
});
