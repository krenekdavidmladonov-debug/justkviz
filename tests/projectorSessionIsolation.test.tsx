// @vitest-environment happy-dom

import React, { act, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom';
import { expect, test, vi } from 'vitest';

import { readPublicLiveStateFromServer, subscribePublicLiveState } from '../apps/web/src/features/live/liveRepository';
import type { PublicLiveState } from '../apps/web/src/features/live/types';
import { ProjectorPage } from '../apps/web/src/routes/projector/ProjectorPage';

vi.mock('../apps/web/src/features/live/liveRepository', () => ({
  readPublicLiveStateFromServer: vi.fn(),
  subscribePublicLiveState: vi.fn(),
}));

const firstSession = 'synthetic-projector-a';
const secondSession = 'synthetic-projector-b';
const priorAnswer = 'Previously revealed synthetic answer';
const nextQuestion = 'Current synthetic question';

const firstState: PublicLiveState = {
  sessionId: firstSession, quizTitle: 'First synthetic quiz', status: 'active',
  slidePosition: 1, slideKind: 'question', title: 'First synthetic question',
  options: [], media: [], presentation: {}, presentationMode: 'recap', renderMode: 'recap',
  mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 1, introGeneration: 0,
  answerRevealed: true, revealedAnswer: priorAnswer, revision: 12,
};
const secondState: PublicLiveState = {
  ...firstState, sessionId: secondSession, quizTitle: 'Second synthetic quiz', title: nextQuestion,
  presentationMode: 'slide', renderMode: 'question', answerRevealed: false, revealedAnswer: '', revision: 1,
};

test('switches projector sessions without committing the previous session content under the new route', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let confirmSecond: (state: PublicLiveState) => void = () => { throw new Error('Second read was not started.'); };
  const readSecond = new Promise<PublicLiveState>(resolve => { confirmSecond = resolve; });
  vi.mocked(readPublicLiveStateFromServer).mockImplementation(sessionId =>
    sessionId === firstSession ? Promise.resolve(firstState) : readSecond);
  const unsubscribe = vi.fn();
  vi.mocked(subscribePublicLiveState).mockReturnValue(unsubscribe);

  const secondRouteCommits: string[] = [];
  function ObserveRouteCommit() {
    const { sessionId } = useParams();
    const viewport = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      if (sessionId === secondSession) secondRouteCommits.push(viewport.current?.textContent ?? '');
    }, [sessionId]);
    return <div ref={viewport}><ProjectorPage /></div>;
  }

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const router = createMemoryRouter([{ path: '/projector/:sessionId', element: <ObserveRouteCommit /> }], {
    initialEntries: ['/projector/' + firstSession],
  });
  try {
    await act(async () => { root.render(<RouterProvider router={router} />); });
    expect(host.textContent).toContain(priorAnswer);
    const oldSubscription = vi.mocked(subscribePublicLiveState).mock.calls.find(([sessionId]) => sessionId === firstSession);
    expect(oldSubscription).toBeDefined();

    await act(async () => { await router.navigate('/projector/' + secondSession); });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(readPublicLiveStateFromServer).toHaveBeenCalledWith(secondSession);
    expect(host.textContent).toContain('Načítám projektor');
    await act(async () => { oldSubscription?.[1]({ ...firstState, revision: 99 }); });
    expect(host.textContent).toContain('Načítám projektor');
    expect(host.textContent).not.toContain(priorAnswer);

    await act(async () => { confirmSecond(secondState); });
    expect(host.textContent).toContain(nextQuestion);
    expect(host.textContent).not.toContain(priorAnswer);
    expect(secondRouteCommits).toHaveLength(1);
    expect(secondRouteCommits[0]).not.toContain(priorAnswer);
  } finally {
    await act(async () => { root.unmount(); });
    router.dispose();
    host.remove();
  }
});
