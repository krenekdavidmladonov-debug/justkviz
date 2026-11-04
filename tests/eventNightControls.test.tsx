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
async function render(patch: Partial<LiveControlState> = {}, sourceSlides: readonly LiveControlSlide[] = slides) {
  state = { ...state, ...patch };
  const coordinator: ShowCommandCoordinator = { busy: false, enabled: true, execute: action => action(state, state.revision), prepareAudio: () => 0, playAudio: async () => {}, stopAudio: vi.fn() };
  await act(async () => root.render(<ShowCommandContext.Provider value={coordinator}><EventNightControls session={state} slides={sourceSlides} navigation={navigation} /></ShowCommandContext.Provider>));
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
test('one button publishes current saved scores, then closes without round settings', async () => {
  expect(host.querySelectorAll('button')).toHaveLength(2);
  expect(host.querySelector('select')).toBeNull();
  await act(async () => host.querySelector('button')!.click());
  expect(calls.invoke).toHaveBeenCalledWith('controlInterimResults', expect.objectContaining({ action: 'current', expectedRevision: 10 }));
  await render({ revision: 11, interimResults: { versionId: 'a'.repeat(64), roundNumber: 2, page: 0, pageCount: 1, presentationStyle: 'show', pageSize: 6 } });
  await act(async () => host.querySelector('button')!.click());
  expect(calls.invoke).toHaveBeenLastCalledWith('controlInterimResults', expect.objectContaining({ action: 'hide', expectedRevision: 11 }));
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
test('failed current results request leaves closeable error and never sends team/answer content', async () => {
  calls.invoke.mockRejectedValue(new Error('offline'));
  await act(async () => host.querySelector('button')!.click());
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('button')!.disabled).toBe(false);
  const payload = calls.invoke.mock.calls[0]![1];
  expect(Object.keys(payload).sort()).toEqual(['action', 'eventId', 'expectedRevision', 'requestId', 'sessionId']);
});
