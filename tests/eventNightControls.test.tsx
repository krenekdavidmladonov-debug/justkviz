// @vitest-environment happy-dom
import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EventNightControls, type EventNightNavigation } from '../apps/web/src/features/live/EventNightControls';
import { ShowCommandContext, type ShowCommandCoordinator } from '../apps/web/src/features/live/ShowCommandContext';
import type { LiveControlState, LiveControlSlide } from '../apps/web/src/features/live/types';

const calls = vi.hoisted(() => ({ invoke: vi.fn<(name: string, payload: Record<string, unknown>) => Promise<unknown>>(), prepare: vi.fn(), play: vi.fn(), stop: vi.fn(), fresh: vi.fn<() => Promise<{ exists: () => boolean; id: string; data: () => unknown }>>() }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), runTransaction: () => calls.fresh() }));
vi.mock('../apps/web/src/features/live/liveMappers', () => ({ mapLiveControlState: (_id: string, data: unknown) => data }));
vi.mock('../apps/web/src/features/presentation/YouTubePlayer', () => ({ YouTubePlayer: (props: { source: string; startSeconds: number }) => <div data-winner-source={props.source} data-start={props.startSeconds} /> }));
vi.mock('firebase/functions', () => ({ httpsCallable: (_functions: unknown, name: string) => (payload: Record<string, unknown>) => calls.invoke(name, payload) }));
vi.mock('../apps/web/src/services/firebase/client', () => ({ getFirebaseServices: () => ({ functions: {} }) }));
vi.mock('../apps/web/src/services/firebase/firestore', () => ({ getFirebaseFirestore: () => ({}) }));
vi.mock('../apps/web/src/features/final-reveal/fanfare', () => ({ Fanfare: class { prepare = calls.prepare; play = calls.play; stop = calls.stop; dispose() {} } }));

let root: Root, host: HTMLDivElement, state: LiveControlState;
const navigation = createRef<EventNightNavigation>();
const slides: LiveControlSlide[] = ['recap', 'end'].map((kind, index) => ({ id: 's' + index, position: index + 1, kind, isQuestion: false, title: '', text: '', options: [], media: [], presentation: {} }));
async function render(patch: Partial<LiveControlState> = {}, sourceSlides: readonly LiveControlSlide[] = slides, busy: boolean | null = false, execute?: ShowCommandCoordinator['execute'], onCommit?: () => void) {
  state = { ...state, ...patch };
  const coordinator: ShowCommandCoordinator | null = busy === null ? null : { busy, enabled: true, execute: execute ?? (action => action(state, state.revision)), prepareAudio: () => 0, playAudio: async () => {}, stopAudio: vi.fn() };
  await act(async () => root.render(<ShowCommandContext.Provider value={coordinator}><React.Profiler id="event-night" onRender={() => onCommit?.()}><EventNightControls session={state} slides={sourceSlides} navigation={navigation} /></React.Profiler></ShowCommandContext.Provider>));
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers(); vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  state = { eventId: 'event', snapshotId: 'snapshot', sessionId: 'session', quizId: 'quiz', quizTitle: 'Synthetic', slideCount: 2, status: 'active', currentSlidePosition: 1, answerRevealed: false, presentationMode: 'recap', mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 0, introGeneration: 0, revision: 10 };
  calls.invoke.mockResolvedValue({ data: { revision: 11, replayed: false } });
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

test('demo is available without scores and makes no server requests', async () => {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent === 'Náhled závěrečné show')!;
  await act(async () => button.click());
  expect(host.querySelector('dialog[open]')).not.toBeNull();
  expect(calls.invoke).not.toHaveBeenCalled();
  expect(calls.fresh).not.toHaveBeenCalled();
});

test('missing-score dialog offers an isolated demo without publishing results', async () => {
  calls.invoke.mockResolvedValue({ data: { complete: false, rows: [] } });
  await act(async () => { await navigation.current!.openFinale(); });
  calls.invoke.mockClear();
  const button = [...host.querySelectorAll('button')].find(item => item.textContent === 'Náhled s ukázkovými týmy')!;
  await act(async () => button.click());
  expect(host.querySelectorAll('dialog[open]')).toHaveLength(1);
  expect(calls.invoke).not.toHaveBeenCalled();
});
async function openInterimPreview() {
  calls.invoke.mockResolvedValueOnce({ data: { sessionRevision: state.revision, sourceFingerprint: 'preview-fingerprint',
    rows: [{ rank: 1, teamName: 'Alfa', halfPoints: 8 }], missing: [{ teamId: 'beta', teamName: 'Beta' }] } });
  await act(async () => host.querySelector('button')!.click());
}
function interimConfirmation() {
  return [...host.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.textContent === 'Ukázat sálu')!;
}
test('opens a private preview, publishes current scores only on confirmation, then closes', async () => {
  expect(host.querySelectorAll('button')).toHaveLength(2);
  expect(host.querySelector('select')).toBeNull();
  await openInterimPreview();
  expect(calls.invoke).toHaveBeenCalledExactlyOnceWith('previewInterimResults', expect.objectContaining({ scope: 'current' }));
  expect(host.querySelector('dialog[open] [role="alert"]')?.textContent).toContain('Beta');
  await act(async () => interimConfirmation().click());
  expect(calls.invoke).toHaveBeenLastCalledWith('controlInterimResults', expect.objectContaining({ action: 'current', expectedRevision: 10, sourceFingerprint: 'preview-fingerprint' }));
  await render({ revision: 11, interimResults: { versionId: 'a'.repeat(64), roundNumber: 2, page: 0, pageCount: 1, presentationStyle: 'show', pageSize: 6 } });
  await act(async () => host.querySelector('button')!.click());
  expect(calls.invoke).toHaveBeenLastCalledWith('controlInterimResults', expect.objectContaining({ action: 'hide', expectedRevision: 11 }));
});

const interimPage = { versionId: 'a'.repeat(64), roundNumber: 2, page: 0, pageCount: 2, presentationStyle: 'show' as const, pageSize: 6 as const };
const finalIntro: NonNullable<LiveControlState['finalReveal']> = { versionId: 'a'.repeat(64), visible: true, mode: 'intro', rank: null,
  revealedCount: 0, totalGroups: 3, page: 0, pageCount: 1, presentationStyle: 'show', pageSize: 6 };

test.each(['reveal', 'hide'] as const)('rejects a queued final %s after the visible version is replaced', async action => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await render({ revision: 25, finalReveal: finalIntro }, slides, false, async work => { await gate; return work(state, state.revision); });
  let gesture!: Promise<boolean>;
  await act(async () => { gesture = navigation.current!.navigate(action === 'hide' ? -1 : 1); });
  expect(calls.invoke).not.toHaveBeenCalled();
  await render({ revision: 31, finalReveal: { ...finalIntro, versionId: 'b'.repeat(64) } });
  await act(async () => { release(); await gesture; });
  expect(calls.invoke).not.toHaveBeenCalled();
});

test.each(['rank advanced', 'page advanced', 'table entered'] as const)('rejects a queued same-version finale gesture after %s', async change => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = { ...finalIntro, mode: 'group' as const, rank: change === 'table entered' ? 1 : 3,
    revealedCount: change === 'table entered' ? 3 : 1, pageCount: change === 'page advanced' ? 3 : 1 };
  await render({ revision: 25, finalReveal: original }, slides, false, async work => { await gate; return work(state, state.revision); });
  let gesture!: Promise<boolean>;
  await act(async () => { gesture = navigation.current!.navigate(1); });
  await render({ revision: 31, finalReveal: { ...original,
    ...(change === 'rank advanced' ? { rank: 2, revealedCount: 2 } : {}),
    ...(change === 'page advanced' ? { page: 2 } : {}),
    ...(change === 'table entered' ? { mode: 'table' as const, rank: null, page: 1, pageCount: 2 } : {}),
  } });
  await act(async () => { release(); await gesture; });
  expect(calls.invoke).not.toHaveBeenCalled();
});

test.each(['observed', 'unobserved'] as const)('uses only an %s newer revision for an unchanged queued final gesture', async observation => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await render({ revision: 25, finalReveal: finalIntro }, slides, false, async work => { await gate; return work(state, 31); });
  let gesture!: Promise<boolean>;
  await act(async () => { gesture = navigation.current!.navigate(1); });
  if (observation === 'observed') await render({ revision: 31, finalReveal: { ...finalIntro } });
  await act(async () => { release(); await gesture; });
  if (observation === 'observed') expect(calls.invoke).toHaveBeenCalledExactlyOnceWith('controlFinalReveal',
    expect.objectContaining({ action: 'reveal', versionId: finalIntro.versionId, expectedRevision: 31 }));
  else expect(calls.invoke).not.toHaveBeenCalled();
});

test('rejects a queued manual interim hide after the publication is replaced', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await render({ revision: 25, interimResults: interimPage }, slides, false, async work => { await gate; return work(state, state.revision); });
  await act(async () => host.querySelector('button')!.click());
  await render({ revision: 31, interimResults: { ...interimPage, versionId: 'b'.repeat(64) } });
  await act(async () => release());
  expect(calls.invoke).not.toHaveBeenCalled();
});

test.each(['replaced', 'same-version page', 'observed telemetry', 'unobserved revision'] as const)('rechecks an already-fired interim page intent after %s', async change => {
  const pageCount = change === 'same-version page' ? 3 : 2;
  await publishInterim(pageCount);
  calls.invoke.mockClear();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await render({}, slides, false, async work => { await gate; return work(state, change === 'unobserved revision' ? state.revision + 1 : state.revision); });
  await act(async () => { vi.advanceTimersByTime(7000); });
  expect(calls.invoke).not.toHaveBeenCalled();
  await render({ revision: 17, interimResults: { ...interimPage, pageCount,
    ...(change === 'replaced' ? { versionId: 'b'.repeat(64) } : {}), ...(change === 'same-version page' ? { page: 2 } : {}) } });
  await act(async () => release());
  if (change === 'observed telemetry') expect(calls.invoke).toHaveBeenCalledExactlyOnceWith('controlInterimResults',
    expect.objectContaining({ action: 'page', page: 1, expectedRevision: 17 }));
  else {
    expect(calls.invoke).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Projekce se mezitím změnila');
    await act(async () => { vi.advanceTimersByTime(14000); });
    expect(calls.invoke).not.toHaveBeenCalled();
  }
});

test.each(['page ABA', 'telemetry'] as const)('binds a queued final page to its show cue through %s', async change => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const publication = { ...finalIntro, mode: 'group' as const, rank: 3, revealedCount: 1, pageCount: 3 };
  const cue: NonNullable<LiveControlState['showCue']> = { id: 'c'.repeat(64), kind: 'reveal', motion: 'static', intensity: 'show',
    topThree: true, winnerAnimation: true, startedAt: 1000, durationMs: 0 };
  await render({ revision: 25, finalReveal: publication, showCue: cue }, slides, false, async work => { await gate; return work(state, state.revision); });
  let gesture!: Promise<boolean>;
  await act(async () => { gesture = navigation.current!.navigate(1); });
  if (change === 'page ABA') await render({ revision: 30, finalReveal: { ...publication, page: 1 }, showCue: { ...cue, id: 'd'.repeat(64) } });
  await render({ revision: 31, finalReveal: { ...publication }, showCue: { ...cue, ...(change === 'page ABA' ? { id: 'e'.repeat(64) } : {}) } });
  await act(async () => { release(); await gesture; });
  if (change === 'telemetry') expect(calls.invoke).toHaveBeenCalledExactlyOnceWith('controlFinalReveal', expect.objectContaining({ action: 'page', page: 1, expectedRevision: 31 }));
  else expect(calls.invoke).not.toHaveBeenCalled();
});

test('keeps the original interim timer intent when it fires after render but before passive cleanup', async () => {
  const scheduled = vi.spyOn(window, 'setTimeout');
  await publishInterim();
  const timeout = scheduled.mock.calls.find(call => call[1] === 7000)![0];
  calls.invoke.mockClear();
  let fired = false;
  await render({ revision: 17, interimResults: { ...interimPage, versionId: 'b'.repeat(64) } }, slides, false, undefined, () => {
    if (!fired && typeof timeout === 'function') { fired = true; timeout(); }
  });
  scheduled.mockRestore();
  expect(fired).toBe(true);
  expect(calls.invoke).not.toHaveBeenCalled();
});
async function publishInterim(pageCount = 2) {
  await openInterimPreview(); calls.invoke.mockClear();
  await act(async () => interimConfirmation().click());
  await render({ revision: 11, interimResults: { ...interimPage, pageCount } });
}
async function pollInterim(milliseconds: number) {
  await act(async () => { vi.advanceTimersByTime(milliseconds); });
  // The real private watcher maps a new session and slides array every 2s,
  // and the parent creates a fresh command coordinator on each render.
  await render({ interimResults: { ...state.interimResults! } }, slides.map(slide => ({ ...slide })));
}
test('interim pages advance every seven seconds despite two-second parent polls', async () => {
  await publishInterim();
  for (let index = 0; index < 3; index++) await pollInterim(2000);
  expect(calls.invoke).toHaveBeenCalledTimes(1);
  calls.invoke.mockResolvedValue({ data: { revision: 12 } });
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(calls.invoke).toHaveBeenCalledTimes(2);
  expect(calls.invoke).toHaveBeenLastCalledWith('controlInterimResults', expect.objectContaining({ action: 'page', page: 1, expectedRevision: 11 }));
  await render({ revision: 12, interimResults: { ...interimPage, page: 1 } });
  for (let index = 0; index < 3; index++) await pollInterim(2000);
  expect(calls.invoke).toHaveBeenCalledTimes(2);
  calls.invoke.mockResolvedValue({ data: { revision: 13 } });
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(calls.invoke).toHaveBeenCalledTimes(3);
  expect(calls.invoke).toHaveBeenLastCalledWith('controlInterimResults', expect.objectContaining({ action: 'page', page: 0, expectedRevision: 12 }));
});
test('only the initiating operator with an acknowledged revision advances interim pages', async () => {
  await render({ revision: 11, interimResults: { ...interimPage } });
  await act(async () => { vi.advanceTimersByTime(14000); });
  expect(calls.invoke).not.toHaveBeenCalled();
  await render({ revision: 10, interimResults: undefined });
  await publishInterim();
  await pollInterim(4000);
  await render({ revision: 12 });
  calls.invoke.mockClear();
  await act(async () => { vi.advanceTimersByTime(14000); });
  expect(calls.invoke).not.toHaveBeenCalled();
});
test('pending acknowledgement, shared commands and ended sessions block automatic interim pages', async () => {
  let acknowledge!: (value: unknown) => void;
  await openInterimPreview(); calls.invoke.mockClear();
  calls.invoke.mockImplementation(() => new Promise(resolve => { acknowledge = resolve; }));
  await act(async () => interimConfirmation().click());
  await render({ revision: 11, interimResults: { ...interimPage } });
  await act(async () => { vi.advanceTimersByTime(14000); });
  expect(calls.invoke).toHaveBeenCalledTimes(1);
  await act(async () => { acknowledge({ data: { revision: 11 } }); });
  await pollInterim(4000);
  await render({}, slides, true);
  await act(async () => { vi.advanceTimersByTime(14000); });
  expect(calls.invoke).toHaveBeenCalledTimes(1);
  await render();
  await pollInterim(4000);
  await render({ status: 'ended' });
  await act(async () => { vi.advanceTimersByTime(14000); });
  expect(calls.invoke).toHaveBeenCalledTimes(1);
});
test('interim page failure stops retries and leaves the operator able to close results', async () => {
  await publishInterim();
  calls.invoke.mockRejectedValue(new Error('offline'));
  await act(async () => { vi.advanceTimersByTime(7000); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('zavřete výsledky a znovu je otevřete');
  expect(host.querySelector('button')!.disabled).toBe(false);
  await pollInterim(14000);
  expect(calls.invoke).toHaveBeenCalledTimes(2);
  calls.invoke.mockResolvedValue({ data: { revision: 12 } });
  await act(async () => host.querySelector('button')!.click());
  expect(calls.invoke).toHaveBeenLastCalledWith('controlInterimResults', expect.objectContaining({ action: 'hide', expectedRevision: 11 }));
});
test.each<Partial<LiveControlState>>([
  { sessionId: 'another-session' },
  { interimResults: undefined },
  { interimResults: { ...interimPage, pageCount: 1 } },
])('a new session, hidden results or a single page cancels the pending timer: %j', async patch => {
  await publishInterim();
  await pollInterim(4000);
  await render(patch);
  await act(async () => { vi.advanceTimersByTime(14000); });
  expect(calls.invoke).toHaveBeenCalledTimes(1);
});
test('removing the command coordinator cancels pending automatic pagination', async () => {
  await publishInterim();
  await pollInterim(4000);
  await render({}, slides, null);
  await act(async () => { vi.advanceTimersByTime(14000); });
  expect(calls.invoke).toHaveBeenCalledTimes(1);
});
test('incomplete final scores block finale and do not skip into closing slide', async () => {
  calls.invoke.mockResolvedValue({ data: { complete: false, rows: [{ teamName: 'Team' }] } });
  let intercepted = false;
  await act(async () => { intercepted = await navigation.current!.navigate(1); });
  expect(intercepted).toBe(true);
  expect(calls.invoke).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Rozhodčí musí nejprve uložit');
});
test('next starts the show but waits indefinitely for an explicit reveal', async () => {
  calls.invoke.mockImplementation(async name => ({ data: name === 'previewFinalResults' ? { complete: true, sessionRevision: 10, sourceFingerprint: 'b'.repeat(64), publishedVersionId: null } : { revision: 11, versionId: 'a'.repeat(64), replayed: false } }));
  await act(async () => { await navigation.current!.navigate(1); });
  expect(calls.invoke).toHaveBeenLastCalledWith('controlFinalReveal', expect.objectContaining({ action: 'start', presentationStyle: 'show', motion: 'animate' }));
  await render({ revision: 11, finalReveal: { versionId: 'a'.repeat(64), visible: true, mode: 'intro', rank: null, revealedCount: 0, totalGroups: 3, page: 0, pageCount: 1, presentationStyle: 'show', pageSize: 6 } });
  calls.invoke.mockClear();
  await act(async () => { vi.advanceTimersByTime(120000); });
  expect(calls.invoke).not.toHaveBeenCalled();
  await act(async () => { await navigation.current!.navigate(1); });
  expect(calls.invoke).toHaveBeenLastCalledWith('controlFinalReveal', expect.objectContaining({ action: 'reveal', expectedRevision: 11, motion: 'animate' }));
  expect(calls.play).not.toHaveBeenCalled();
});

test('direct finale selection opens the same penultimate show without ending the session', async () => {
  calls.invoke.mockImplementation(async name => ({ data: name === 'previewFinalResults' ? { complete: true, sessionRevision: 10, sourceFingerprint: 'b'.repeat(64), publishedVersionId: null } : { revision: 11, versionId: 'a'.repeat(64), replayed: false } }));
  await act(async () => { await navigation.current!.openFinale(); });
  expect(calls.invoke.mock.calls.map(([name]) => name)).toEqual(['previewFinalResults', 'controlFinalReveal']);
  expect(calls.invoke).toHaveBeenLastCalledWith('controlFinalReveal', expect.objectContaining({ action: 'start', motion: 'animate' }));
});

test('next from a final table opened early goes directly to the visible closing slide with the current revision', async () => {
  const source = [
    { ...slides[0]!, id: 'early', position: 1, kind: 'free', isQuestion: true },
    { ...slides[0]!, id: 'later', position: 2, kind: 'free', isQuestion: true },
    { ...slides[1]!, id: 'closing', position: 8 },
    { ...slides[1]!, id: 'hidden-closing', position: 9, hidden: true },
  ];
  await render({ revision: 21, currentSlidePosition: 1, finalReveal: { versionId: 'a'.repeat(64), visible: true, mode: 'table', rank: null, revealedCount: 3, totalGroups: 3, page: 0, pageCount: 1 } }, source);
  let intercepted = false;
  await act(async () => { intercepted = await navigation.current!.navigate(1); });
  expect(intercepted).toBe(true);
  expect(calls.invoke).toHaveBeenCalledExactlyOnceWith('goToSlide', { sessionId: 'session', expectedRevision: 21, position: 8 });
  expect(host.querySelector('[data-winner-source]')).toBeNull();
});

test('next from a final table ends the session when its frozen source has no closing slide', async () => {
  await render({ revision: 25, finalReveal: { versionId: 'a'.repeat(64), visible: true, mode: 'table', rank: null, revealedCount: 3, totalGroups: 3, page: 0, pageCount: 1 } }, [slides[0]!]);
  let intercepted = false;
  await act(async () => { intercepted = await navigation.current!.navigate(1); });
  expect(intercepted).toBe(true);
  expect(calls.invoke).toHaveBeenCalledExactlyOnceWith('endLiveSession', { sessionId: 'session', expectedRevision: 25 });
});

for (const closing of [true, false]) {
  const label = closing ? 'closing slide' : 'legacy session without a closing slide';
  const source = closing ? slides : [slides[0]!];
  const table: NonNullable<LiveControlState['finalReveal']> = { versionId: 'a'.repeat(64), visible: true, mode: 'table', rank: null, revealedCount: 3, totalGroups: 3, page: 0, pageCount: 1 };
  test.each(['hidden', 'replaced', 'superseded generation', 'slide moved', 'ended', 'ranking resumed'] as const)(`does not leave the ${label} from a queued intent after the finale is %s`, async change => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    // This is the real coordinator boundary: a previously dispatched playback
    // report can hold the queue without making show.busy true.
    await render({ revision: 25, slideCount: source.length, finalReveal: { ...table } }, source, false,
      async action => { await gate; return action(state, state.revision); });
    let intercepted!: Promise<boolean>;
    await act(async () => { intercepted = navigation.current!.navigate(1); });
    expect(calls.invoke).not.toHaveBeenCalled();
    await render({ revision: 31, finalReveal: { ...table,
      ...(change === 'hidden' ? { visible: false } : {}),
      ...(change === 'replaced' ? { versionId: 'b'.repeat(64) } : {}),
      ...(change === 'ranking resumed' ? { mode: 'group' } : {}),
    }, ...(change === 'superseded generation' ? { mediaGeneration: state.mediaGeneration + 2 } : {}),
    ...(change === 'slide moved' ? { currentSlidePosition: state.currentSlidePosition + 1 } : {}),
    ...(change === 'ended' ? { status: 'ended' } : {}) }, source);
    await act(async () => { release(); expect(await intercepted).toBe(true); });
    expect(calls.invoke).not.toHaveBeenCalled();
  });

  test(`allows a queued ${label} exit after a revision-only telemetry update`, async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    calls.invoke.mockResolvedValue({ data: { revision: 32 } });
    await render({ revision: 25, slideCount: source.length, finalReveal: { ...table } }, source, false,
      async action => { await gate; return action(state, state.revision); });
    let intercepted!: Promise<boolean>;
    await act(async () => { intercepted = navigation.current!.navigate(1); });
    await render({ revision: 31, finalReveal: { ...table } }, source);
    await act(async () => { release(); expect(await intercepted).toBe(true); });
    expect(calls.invoke).toHaveBeenCalledExactlyOnceWith(closing ? 'goToSlide' : 'endLiveSession', {
      sessionId: 'session', expectedRevision: 31, ...(closing ? { position: slides[1]!.position } : {}),
    });
  });

  test(`does not leave the ${label} using a confirmed revision whose snapshot has not arrived`, async () => {
    await render({ revision: 25, slideCount: source.length, finalReveal: { ...table } }, source, false,
      action => action(state, 31));
    await act(async () => { expect(await navigation.current!.navigate(1)).toBe(true); });
    expect(calls.invoke).not.toHaveBeenCalled();
  });
}

test.each([
  { rows: [], message: 'zatím nejsou přihlášené týmy' },
  { rows: [{ teamName: 'Team' }], message: 'rozhodčí musí nejprve uložit' },
])('direct finale selection leaves an incomplete score set unchanged: $message', async ({ rows, message }) => {
  calls.invoke.mockResolvedValue({ data: { complete: false, rows } });
  await act(async () => { await navigation.current!.openFinale(); });
  expect(calls.invoke).toHaveBeenCalledExactlyOnceWith('previewFinalResults', { eventId: 'event', sessionId: 'session' });
  expect(host.querySelector('dialog[open]')?.textContent?.toLowerCase()).toContain(message);
  expect(host.querySelector('[data-winner-source]')).toBeNull();
});

test('missing scores are visible by round and team, with a safe retry after the referee saves them', async () => {
  const rounds = Array.from({ length: 6 }, (_, index) => ({ id: `r${index + 1}`, title: `Kolo ${index + 1}`, position: index + 1 }));
  const missing = rounds.slice(1).flatMap(round => ['Alfa', 'Beta'].map(teamName => ({ teamId: teamName, teamName, roundId: round.id, roundTitle: round.title })));
  calls.invoke.mockResolvedValue({ data: { complete: false, rows: [{ teamName: 'Alfa' }, { teamName: 'Beta' }], includedRounds: rounds, missing } });
  await act(async () => { await navigation.current!.navigate(1); });
  const modal = host.querySelector('dialog[open]');
  expect(modal?.textContent).toContain('2 / 12');
  expect(modal?.textContent).toContain('chybí 10');
  expect(modal?.querySelectorAll('.finale-missing-rounds section')).toHaveLength(5);
  expect(modal?.textContent).toContain('Alfa, Beta');
  expect(modal?.querySelector('a')?.getAttribute('href')).toBe('/admin/events/event/scoring');
  expect(calls.invoke).toHaveBeenCalledTimes(1);
  calls.invoke.mockImplementation(async name => ({ data: name === 'previewFinalResults' ? { complete: true, sessionRevision: 10, sourceFingerprint: 'b'.repeat(64), publishedVersionId: null } : { revision: 11, versionId: 'a'.repeat(64), replayed: false } }));
  await act(async () => { [...modal!.querySelectorAll('button')].find(button => button.textContent === 'Zkontrolovat znovu')!.click(); });
  expect(host.querySelector('dialog')).toBeNull();
  expect(calls.invoke).toHaveBeenLastCalledWith('controlFinalReveal', expect.objectContaining({ action: 'start' }));
});

test('confirmed first place starts the official chorus only on the initiating device and hides it on navigation', async () => {
  const versionId = 'a'.repeat(64);
  calls.invoke.mockImplementation(async name => ({ data: name === 'previewFinalResults' ? { complete: true, sessionRevision: 10, sourceFingerprint: 'b'.repeat(64), publishedVersionId: null } : { revision: 11, versionId, replayed: false } }));
  await act(async () => { await navigation.current!.openFinale(); });
  const final = { versionId, visible: true, mode: 'intro' as const, rank: null, revealedCount: 0, totalGroups: 1, page: 0, pageCount: 1, presentationStyle: 'show' as const, pageSize: 6 as const };
  await render({ revision: 11, finalReveal: final });
  calls.fresh.mockResolvedValue({ exists: () => true, id: 'session', data: () => ({ ...state, revision: 12, finalReveal: { ...final, mode: 'group', rank: 1, revealedCount: 1 } }) });
  calls.invoke.mockResolvedValue({ data: { revision: 12, versionId, winnerRevealed: true, replayed: false } });
  await act(async () => { await navigation.current!.navigate(1); });
  await render({ revision: 12, finalReveal: { ...final, mode: 'group', rank: 1, revealedCount: 1 } });
  expect(host.querySelector('[data-winner-source]')?.getAttribute('data-winner-source')).toContain('04854XqcfCY');
  expect(host.querySelector('[data-winner-source]')?.getAttribute('data-start')).toBe('30');
  const player = host.querySelector('[data-winner-source]');
  calls.invoke.mockResolvedValue({ data: { revision: 13, versionId, winnerRevealed: false, replayed: false } });
  await act(async () => { await navigation.current!.navigate(1); });
  await render({ revision: 13, finalReveal: { ...final, mode: 'table', rank: null, revealedCount: 1 } });
  expect(host.querySelector('[data-winner-source]')).toBe(player);
  await render({ revision: 13, finalReveal: { ...final, visible: false } });
  expect(host.querySelector('[data-winner-source]')).toBeNull();
});
test('loading an already visible finale does not automatically reveal or play sound', async () => {
  await render({ finalReveal: { versionId: 'a'.repeat(64), visible: true, mode: 'intro', rank: null, revealedCount: 0, totalGroups: 2, page: 0, pageCount: 1 } });
  await act(async () => { vi.advanceTimersByTime(20000); });
  expect(calls.invoke).not.toHaveBeenCalled(); expect(calls.play).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Odhalit další místo');
});
test('reloading an already visible first place does not mount music or resume the automatic sequence', async () => {
  await render({ finalReveal: { versionId: 'a'.repeat(64), visible: true, mode: 'group', rank: 1, revealedCount: 3, totalGroups: 3, page: 0, pageCount: 1 } });
  await act(async () => { vi.advanceTimersByTime(30000); });
  expect(host.querySelector('[data-winner-source]')).toBeNull();
  expect(calls.invoke).not.toHaveBeenCalled(); expect(calls.fresh).not.toHaveBeenCalled(); expect(calls.play).not.toHaveBeenCalled();
});
test('own Firestore acknowledgement arriving before callable response does not stop the show', async () => {
  calls.invoke.mockImplementation(async name => ({ data: name === 'previewFinalResults' ? { complete: true, sessionRevision: 10, sourceFingerprint: 'b'.repeat(64), publishedVersionId: null } : { revision: 11, versionId: 'a'.repeat(64), replayed: false } }));
  await act(async () => { await navigation.current!.navigate(1); });
  const final = { versionId: 'a'.repeat(64), visible: true, mode: 'intro' as const, rank: null, revealedCount: 0, totalGroups: 3, page: 0, pageCount: 1, presentationStyle: 'show' as const, pageSize: 6 as const };
  await render({ revision: 11, finalReveal: final });
  let acknowledge!: (value: unknown) => void;
  calls.invoke.mockImplementation(() => new Promise(resolve => { acknowledge = resolve; }));
  await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Odhalit další místo')!.click(); });
  await render({ revision: 12, finalReveal: { ...final, mode: 'group', rank: 3, revealedCount: 1 } });
  await act(async () => { acknowledge({ data: { revision: 12, versionId: final.versionId, replayed: false } }); });
  expect(host.textContent).toContain('Odhalit další místo');
  calls.invoke.mockResolvedValue({ data: { revision: 13, versionId: final.versionId, replayed: false } });
  await act(async () => { await navigation.current!.navigate(1); });
  expect(calls.invoke).toHaveBeenLastCalledWith('controlFinalReveal', expect.objectContaining({ action: 'reveal', expectedRevision: 12 }));
});
test('a newer command from another operator pauses the automatic sequence', async () => {
  calls.invoke.mockImplementation(async name => ({ data: name === 'previewFinalResults' ? { complete: true, sessionRevision: 10, sourceFingerprint: 'b'.repeat(64), publishedVersionId: null } : { revision: 11, versionId: 'a'.repeat(64), replayed: false } }));
  await act(async () => { await navigation.current!.navigate(1); });
  await render({ revision: 12, finalReveal: { versionId: 'a'.repeat(64), visible: true, mode: 'group', rank: 3, revealedCount: 1, totalGroups: 3, page: 0, pageCount: 1 } });
  calls.invoke.mockClear();
  await act(async () => { vi.advanceTimersByTime(10000); });
  expect(calls.invoke).not.toHaveBeenCalled(); expect(host.textContent).toContain('Odhalit další místo');
});
test('failed preview request leaves closeable error and never sends team/answer content', async () => {
  calls.invoke.mockRejectedValue(new Error('offline'));
  await act(async () => host.querySelector('button')!.click());
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('button')!.disabled).toBe(false);
  const payload = calls.invoke.mock.calls[0]![1];
  expect(Object.keys(payload).sort()).toEqual(['eventId', 'scope', 'sessionId']);
});

test('closing the private preview publishes nothing and does not acquire automatic page ownership', async () => {
  await openInterimPreview(); calls.invoke.mockClear();
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.textContent === 'Zavřít náhled')!.click());
  expect(host.querySelector('dialog')).toBeNull();
  await act(async () => { vi.advanceTimersByTime(14000); });
  expect(calls.invoke).not.toHaveBeenCalled();
});

test('an intervening revision prevents publishing a previously opened preview', async () => {
  await openInterimPreview(); calls.invoke.mockClear();
  await render({ revision: 11 });
  await act(async () => interimConfirmation().click());
  expect(calls.invoke).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Projekce se mezitím změnila');
});
