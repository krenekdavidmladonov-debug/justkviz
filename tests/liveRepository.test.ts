import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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

import { invalidatePrivateAccess } from '../apps/web/src/features/access/api';
import { subscribeLiveControlSlides, subscribeLiveControl, subscribePublicLiveState } from '../apps/web/src/features/live/liveRepository';
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


describe('moderator frozen snapshot authorization', () => {
  const frozen = [{ id: 'question', position: 1, kind: 'free', text: 'Private question', correctAnswer: 'PRIVATE-ANSWER', moderatorNote: 'PRIVATE-NOTE' }];
  beforeEach(() => {
    vi.useFakeTimers();
    invalidatePrivateAccess();
    functionMocks.callable.mockReturnValue(functionMocks.invoke);
    functionMocks.invoke.mockReset();
  });
  afterEach(() => { invalidatePrivateAccess(); vi.useRealTimers(); vi.clearAllMocks(); });
  const settle = () => vi.advanceTimersByTimeAsync(0);

  test('reauthorizes every two seconds with the current version without remapping unchanged snapshots', async () => {
    functionMocks.invoke.mockResolvedValueOnce({ data: { version: 'version-a', slides: frozen } }).mockResolvedValue({ data: { version: 'version-a' } });
    const value = vi.fn(), fail = vi.fn();
    const stop = subscribeLiveControlSlides('quiz', value, fail, 'snapshot', 'session');
    await settle();
    expect(functionMocks.invoke).toHaveBeenCalledWith({ operation: 'snapshotSlides', snapshotId: 'snapshot', sessionId: 'session' });
    expect(value).toHaveBeenCalledExactlyOnceWith(expect.arrayContaining([expect.objectContaining({ correctAnswer: 'PRIVATE-ANSWER' })]));
    await vi.advanceTimersByTimeAsync(6000);
    expect(functionMocks.invoke).toHaveBeenCalledTimes(4);
    expect(functionMocks.invoke).toHaveBeenLastCalledWith({ operation: 'snapshotSlides', snapshotId: 'snapshot', sessionId: 'session', knownVersion: 'version-a' });
    expect(value).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
    stop();
    expect(value).toHaveBeenLastCalledWith([]);
  });

  test('accepts a full replacement when permissions or the scoring epoch changes the version', async () => {
    functionMocks.invoke.mockResolvedValueOnce({ data: { version: 'version-a', slides: frozen } });
    const value = vi.fn(), fail = vi.fn();
    subscribeLiveControlSlides('quiz', value, fail, 'snapshot', 'session');
    await settle();
    functionMocks.invoke.mockResolvedValue({ data: { version: 'version-b', slides: [{ ...frozen[0], correctAnswer: '', moderatorNote: '' }] } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(value).toHaveBeenCalledTimes(2);
    expect(value).toHaveBeenLastCalledWith([expect.objectContaining({ correctAnswer: '', moderatorNote: '' })]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(functionMocks.invoke).toHaveBeenLastCalledWith(expect.objectContaining({ knownVersion: 'version-b' }));
    expect(fail).not.toHaveBeenCalled();
  });

  test('keeps legacy array servers and mutable quiz reads on their original polling path', async () => {
    functionMocks.invoke.mockResolvedValue({ data: frozen });
    const value = vi.fn(), fail = vi.fn();
    const stop = subscribeLiveControlSlides('quiz', value, fail, 'snapshot', 'session');
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    expect(value).toHaveBeenCalledTimes(2);
    expect(functionMocks.invoke).toHaveBeenLastCalledWith({ operation: 'snapshotSlides', snapshotId: 'snapshot', sessionId: 'session' });
    stop();
    functionMocks.invoke.mockClear();
    subscribeLiveControlSlides('quiz', value, fail);
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    expect(functionMocks.invoke).toHaveBeenCalledTimes(2);
    expect(functionMocks.invoke).toHaveBeenLastCalledWith({ operation: 'quizSlides', quizId: 'quiz' });
    expect(fail).not.toHaveBeenCalled();
  });

  test.each([false, true])('fails closed when a missing list has no matching authorized version, prior full %s', async priorFull => {
    functionMocks.invoke.mockResolvedValueOnce({ data: priorFull ? { version: 'version-a', slides: frozen } : { version: 'version-b' } });
    const value = vi.fn(), fail = vi.fn();
    subscribeLiveControlSlides('quiz', value, fail, 'snapshot', 'session');
    await settle();
    if (priorFull) {
      functionMocks.invoke.mockResolvedValue({ data: { version: 'version-b' } });
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(value).toHaveBeenCalledTimes(priorFull ? 1 : 0);
    expect(fail).toHaveBeenCalledTimes(1);
    const count = functionMocks.invoke.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(functionMocks.invoke).toHaveBeenCalledTimes(count);
  });

  test('invalidates visible private data immediately and rejects an old in-flight request after account or scope change', async () => {
    functionMocks.invoke.mockResolvedValueOnce({ data: { version: 'version-a', slides: frozen } });
    const value = vi.fn(), fail = vi.fn();
    subscribeLiveControlSlides('quiz', value, fail, 'snapshot', 'session');
    await settle();
    let finish!: (value: unknown) => void;
    functionMocks.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(2000);
    invalidatePrivateAccess();
    expect(value).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledOnce();
    finish({ data: { version: 'old-authority', slides: frozen } });
    await settle();
    expect(value).toHaveBeenCalledTimes(1);
    const fresh = vi.fn();
    functionMocks.invoke.mockResolvedValue({ data: { version: 'version-new-user', slides: [{ ...frozen[0], text: 'New private question', correctAnswer: '' }] } });
    subscribeLiveControlSlides('quiz', fresh, vi.fn(), 'snapshot', 'session');
    await settle();
    expect(functionMocks.invoke).toHaveBeenLastCalledWith({ operation: 'snapshotSlides', snapshotId: 'snapshot', sessionId: 'session' });
    expect(fresh).toHaveBeenCalledExactlyOnceWith(expect.arrayContaining([expect.objectContaining({ correctAnswer: '' })]));
  });

  test('cleanup clears the list and prevents a late successful response from rehydrating it', async () => {
    functionMocks.invoke.mockResolvedValueOnce({ data: { version: 'version-a', slides: frozen } });
    const value = vi.fn(), fail = vi.fn();
    const stop = subscribeLiveControlSlides('quiz', value, fail, 'snapshot', 'session');
    await settle();
    let finish!: (value: unknown) => void;
    functionMocks.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(2000);
    stop();
    expect(value).toHaveBeenLastCalledWith([]);
    finish({ data: { version: 'late-version', slides: frozen } });
    await settle();
    expect(value).toHaveBeenCalledTimes(2);
    expect(fail).not.toHaveBeenCalled();
  });
});
