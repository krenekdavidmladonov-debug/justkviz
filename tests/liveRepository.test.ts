import { afterEach, describe, expect, test, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  doc: vi.fn(() => ({ path: 'publicSessions/safe-session' })),
  onSnapshot: vi.fn(),
}));
const functionMocks = vi.hoisted(() => ({ callable: vi.fn(), invoke: vi.fn(), functions: { kind: 'mock-functions' } }));

vi.mock('firebase/firestore', () => firestoreMocks);
vi.mock('firebase/functions', () => ({ httpsCallable: functionMocks.callable }));
vi.mock('../apps/web/src/services/firebase/client', () => ({ getFirebaseServices: () => ({ functions: functionMocks.functions }) }));
vi.mock('../apps/web/src/services/firebase/firestore', () => ({
  getFirebaseFirestore: () => ({ kind: 'mock-firestore' }),
}));

import { subscribeLiveControl, subscribePublicLiveState } from '../apps/web/src/features/live/liveRepository';
import { goToSlide, nextSlide, previousSlide } from '../apps/web/src/features/live/liveApi';

test('both navigation directions use one callable with server-selected positions and the supplied revision', async () => {
  functionMocks.callable.mockReturnValue(functionMocks.invoke);
  functionMocks.invoke.mockResolvedValue({ data: { sessionId: 'session', revision: 8 } });
  await expect(nextSlide('session', 7)).resolves.toEqual({ sessionId: 'session', revision: 8 });
  await previousSlide('session', 8);
  await goToSlide('session', 9, 42);
  expect(functionMocks.callable.mock.calls).toEqual([
    [functionMocks.functions, 'goToSlide'], [functionMocks.functions, 'goToSlide'], [functionMocks.functions, 'goToSlide'],
  ]);
  expect(functionMocks.invoke.mock.calls).toEqual([
    [{ sessionId: 'session', expectedRevision: 7, direction: 1 }],
    [{ sessionId: 'session', expectedRevision: 8, direction: -1 }],
    [{ sessionId: 'session', expectedRevision: 9, position: 42 }],
  ]);
});

describe('public projector subscription safety', () => {
  afterEach(() => vi.clearAllMocks());

  test('rejects cache-only state, then accepts a server-confirmed snapshot', () => {
    let emit: ((snapshot: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    firestoreMocks.onSnapshot.mockImplementation((...args: unknown[]) => {
      emit = args[2] as (snapshot: unknown) => void;
      return unsubscribe;
    });
    const onValue = vi.fn();
    const onError = vi.fn();

    const returned = subscribePublicLiveState('safe-session', onValue, onError);
    const data = {
      quizTitle: 'Syntetický kvíz',
      status: 'active',
      slidePosition: 1,
      answerRevealed: true,
      revealedAnswer: 'SENTINEL-REVEALED-ANSWER',
      revision: 2,
    };

    emit?.({ id: 'safe-session', metadata: { fromCache: true }, exists: () => true, data: () => data });
    expect(onError).toHaveBeenCalledOnce();
    expect(onValue).not.toHaveBeenCalled();

    emit?.({ id: 'safe-session', metadata: { fromCache: false }, exists: () => true, data: () => data });
    expect(onValue).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'safe-session',
      revealedAnswer: 'SENTINEL-REVEALED-ANSWER',
    }));
    expect(returned).toBe(unsubscribe);
  });
});

test('private live subscription never forwards another identity cache before server authorization', () => {
  let emit: ((snapshot: unknown) => void) | undefined;
  firestoreMocks.onSnapshot.mockImplementation((...args: unknown[]) => {
    emit = args[2] as (snapshot: unknown) => void;
    return vi.fn();
  });
  const onValue = vi.fn(), onError = vi.fn();
  subscribeLiveControl('private-session-a', onValue, onError);
  const readCachedData = vi.fn(() => ({ quizTitle: 'PRIVATE_SESSION_A' }));
  emit?.({ id: 'private-session-a', metadata: { fromCache: true }, exists: () => true, data: readCachedData });
  expect(readCachedData).not.toHaveBeenCalled();
  expect(onValue).not.toHaveBeenCalled();
  emit?.({ id: 'private-session-a', metadata: { fromCache: false }, exists: () => false });
  expect(onValue).toHaveBeenCalledWith(null);
});
