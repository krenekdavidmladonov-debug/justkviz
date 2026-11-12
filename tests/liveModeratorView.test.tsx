// @vitest-environment happy-dom

import React, { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { LiveModeratorView } from '../apps/web/src/features/live/LiveModeratorView';
import { questionNavigationGroups } from '../apps/web/src/features/live/LiveQuestionNavigator';
import { liveNavigationDirection } from '../apps/web/src/features/live/navigationKeys';
import type { LiveControlSlide, LiveControlState } from '../apps/web/src/features/live/types';
import { readQuizMediaBlob } from '../apps/web/src/features/media/mediaApi';
import { SnapshotMediaContext } from '../apps/web/src/features/media/SnapshotMediaContext';

vi.mock('../apps/web/src/features/media/mediaApi', () => ({ readQuizMediaBlob: vi.fn() }));

const slides: LiveControlSlide[] = [1, 2, 3].map(position => ({
  id: `slide-${position}`, position, kind: 'question', isQuestion: true,
  title: `Otázka ${position}`, text: '', options: [], media: [], presentation: {}, correctAnswer: 'Odpověď',
}));
const session: LiveControlState = {
  sessionId: 'synthetic-session', quizId: 'synthetic-quiz', quizTitle: 'Syntetický kvíz',
  slideCount: 3, status: 'active', currentSlidePosition: 2, answerRevealed: false,
  presentationMode: 'slide', mediaCommand: 'idle', mediaPlaybackState: 'idle',
  mediaGeneration: 0, introGeneration: 0, revision: 1,
};
type Props = ComponentProps<typeof LiveModeratorView>;
const roots: Root[] = [];

async function mount(patch: Partial<Props> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  let props: Props = {
    session, slides, currentSlide: slides[1], presentedSlide: slides[1], recapChoices: [],
    pendingAction: null, error: null, projectorOpened: false,
    onOpenProjector: vi.fn(), onPrevious: vi.fn(), onNext: vi.fn(), onGoToSlide: vi.fn(),
    onSelectRecap: vi.fn(), onPlay: vi.fn(), onStop: vi.fn(), onReplay: vi.fn(), onEnd: vi.fn(),
    onMediaFinished: vi.fn(), onMediaError: vi.fn(), onMediaPlayback: vi.fn(), ...patch,
  };
  const render = async (update: Partial<Props> = {}) => {
    props = { ...props, ...update };
    await act(async () => { root.render(<MemoryRouter><SnapshotMediaContext.Provider value={props.session.snapshotId}><LiveModeratorView {...props} /></SnapshotMediaContext.Provider></MemoryRouter>); });
  };
  await render();
  return { host, root, props, render };
}

function key(keyValue: string, options: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key: keyValue, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach(root => root.unmount()); });
  document.body.replaceChildren();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks();
});

describe('private question navigator', () => {
  const roundSlides: LiveControlSlide[] = [
    { ...slides[0]!, id: 'opening', position: 1, kind: 'intro', isQuestion: false },
    ...[2, 3].map((position, index) => ({ ...slides[0]!, id: `r1q${index + 1}`, position, roundId: 'r1', roundTitle: 'Filmy', correctAnswer: 'Soukromá odpověď A' })),
    { ...slides[0]!, id: 'round-2', position: 4, kind: 'round', isQuestion: false, roundId: 'r2', roundTitle: 'Seriály' },
    ...[5, 6, 7, 8, 9].map((position, index) => ({ ...slides[0]!, id: `r2q${index + 1}`, position, roundId: 'r2', roundTitle: 'Seriály', correctAnswer: 'Soukromá odpověď B' })),
  ];
  const open = async (host: HTMLElement) => act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Přejít na otázku')!.click());

  test('jumps directly to round two question five using its actual source position and closes once', async () => {
    const view = await mount({ slides: [...roundSlides].reverse(), session: { ...session, snapshotId: 'frozen-snapshot', currentSlidePosition: 2 }, currentSlide: roundSlides[1] });
    await open(view.host);
    const dialog = view.host.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('1. kolo · Filmy'); expect(dialog.textContent).toContain('2. kolo · Seriály');
    expect(dialog.textContent).not.toContain('Soukromá odpověď');
    const target = dialog.querySelector<HTMLButtonElement>('[aria-label="2. kolo, otázka 5"]')!;
    await act(async () => { target.click(); target.click(); });
    expect(view.props.onGoToSlide).toHaveBeenCalledExactlyOnceWith(9);
    expect(view.props.onNext).not.toHaveBeenCalled(); expect(view.props.onEnd).not.toHaveBeenCalled();
    expect(view.host.querySelector('dialog')).toBeNull();
  });

  test('focuses the current question, contains navigation keys and restores focus on cancel', async () => {
    const view = await mount({ slides: roundSlides, session: { ...session, currentSlidePosition: 7 }, currentSlide: roundSlides[6] });
    await open(view.host);
    const dialog = view.host.querySelector('dialog')!;
    expect(document.activeElement?.getAttribute('aria-label')).toBe('2. kolo, otázka 3');
    key('ArrowRight', {}, document.activeElement!); key(' ', {}, document.activeElement!);
    expect(view.props.onNext).not.toHaveBeenCalled(); expect(view.props.onGoToSlide).not.toHaveBeenCalled();
    await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
    expect(document.activeElement?.textContent).toBe('Přejít na otázku');
    key('ArrowRight'); expect(view.props.onNext).toHaveBeenCalledOnce();
  });

  test.each(['interim', 'final'] as const)('allows an explicit jump while %s results are visible', async mode => {
    const resultState = mode === 'final' ? { finalReveal: { versionId: 'a'.repeat(64), visible: true, mode: 'intro' as const, rank: null, revealedCount: 0, totalGroups: 3, page: 0, pageCount: 1 } }
      : { interimResults: { versionId: 'a'.repeat(64), roundId: 'r1', roundNumber: 1, page: 0, pageSize: 6 as const, pageCount: 1, totalTeams: 2 } };
    const view = await mount({ slides: roundSlides, session: { ...session, ...resultState } });
    await open(view.host);
    await act(async () => view.host.querySelector<HTMLButtonElement>('[aria-label="2. kolo, otázka 5"]')!.click());
    expect(view.props.onGoToSlide).toHaveBeenCalledWith(9);
  });

  test.each([{ pendingAction: 'jump' as const }, { session: { ...session, status: 'ended' as const } }])('disables opening while a command is pending or the session has ended', async patch => {
    const view = await mount(patch);
    expect([...view.host.querySelectorAll('button')].find(button => button.textContent === 'Přejít na otázku')?.disabled).toBe(true);
  });

  test('offers event finale explicitly without ending or jumping and excludes it for a practice session', async () => {
    const onFinale = vi.fn(); const view = await mount({ onFinale });
    await open(view.host);
    await act(async () => [...view.host.querySelectorAll('button')].find(button => button.textContent === 'Finální výsledky')!.click());
    expect(onFinale).toHaveBeenCalledOnce(); expect(view.props.onGoToSlide).not.toHaveBeenCalled(); expect(view.props.onEnd).not.toHaveBeenCalled();
    await view.render({ onFinale: undefined }); await open(view.host);
    expect(view.host.querySelector('dialog')?.textContent).not.toContain('Finální výsledky');
  });

  test('removes the obsolete intro action even on an intro source slide', async () => {
    const view = await mount({ currentSlide: roundSlides[0], presentedSlide: roundSlides[0] });
    expect(view.host.textContent).not.toContain('Spustit intro');
  });

  test('groups legacy questions without round IDs by their stored round boundaries in position order', () => {
    const legacy = roundSlides.map(({ roundId: _roundId, roundTitle: _roundTitle, ...slide }) => { void _roundId; void _roundTitle; return slide; });
    const groups = questionNavigationGroups([...legacy].reverse());
    expect(groups.map(group => group.questions.map(question => question.position))).toEqual([[2, 3], [5, 6, 7, 8, 9]]);
  });
});

describe('moderator navigation shortcuts', () => {
  test.each([
    { name: 'empty waiting source', source: [], position: 0 },
    { name: 'empty active source', source: [], position: 2 },
    { name: 'missing current position', source: [slides[0]!, slides[2]!], position: 2 },
  ])('keeps event navigation unavailable for $name until a valid source arrives', async ({ source, position }) => {
    const view = await mount({ eventControls: <div>Výsledky</div>, slides: source,
      currentSlide: undefined, presentedSlide: undefined,
      session: { ...session, currentSlidePosition: position } });
    const buttons = [...view.host.querySelectorAll<HTMLButtonElement>('.primary-live-controls button')];
    expect(buttons).toHaveLength(2);
    expect(buttons.every(button => button.disabled)).toBe(true);
    await act(async () => { buttons.forEach(button => button.click()); });
    key('ArrowRight'); key('ArrowLeft'); key(' ');
    expect(view.props.onNext).not.toHaveBeenCalled();
    expect(view.props.onPrevious).not.toHaveBeenCalled();
    expect(view.props.onEnd).not.toHaveBeenCalled();
    await view.render({ slides, currentSlide: position === 0 ? undefined : slides[1],
      presentedSlide: position === 0 ? undefined : slides[1] });
    expect(view.host.querySelector<HTMLButtonElement>('.primary-live-controls .primary-button')!.disabled).toBe(false);
    key('ArrowRight');
    expect(view.props.onNext).toHaveBeenCalledOnce();
    expect(view.props.onEnd).not.toHaveBeenCalled();
  });

  test('allows the first step from waiting position zero once the source is available', async () => {
    const view = await mount({ eventControls: <div>Výsledky</div>,
      session: { ...session, currentSlidePosition: 0 }, currentSlide: undefined, presentedSlide: undefined });
    expect(view.host.querySelector<HTMLButtonElement>('.primary-live-controls .secondary-button')!.disabled).toBe(true);
    expect(view.host.querySelector<HTMLButtonElement>('.primary-live-controls .primary-button')!.disabled).toBe(false);
    key('ArrowRight');
    expect(view.props.onNext).toHaveBeenCalledOnce();
    expect(view.props.onPrevious).not.toHaveBeenCalled();
    expect(view.props.onEnd).not.toHaveBeenCalled();
  });

  test('finale cannot be skipped during reveal and can leave the final table even on the end slide', async () => {
    const end = { ...slides[2]!, kind: 'end', isQuestion: false };
    const final = { versionId: 'a'.repeat(64), visible: true, mode: 'intro' as const, rank: null, revealedCount: 0, totalGroups: 3, page: 0, pageCount: 1 };
    const view = await mount({ eventControls: <div>Výsledky</div>, slides: [slides[0]!, slides[1]!, end], currentSlide: end,
      session: { ...session, currentSlidePosition: 3, finalReveal: final } });
    key('ArrowRight');
    expect(view.props.onNext).not.toHaveBeenCalled();
    await view.render({ session: { ...session, revision: 2, currentSlidePosition: 3, finalReveal: { ...final, mode: 'table', revealedCount: 3 } } });
    key('ArrowRight');
    expect(view.props.onNext).toHaveBeenCalledOnce();
    await view.render({ session: { ...session, revision: 3, currentSlidePosition: 1, finalReveal: final } });
    key('ArrowLeft');
    expect(view.props.onPrevious).toHaveBeenCalledOnce();
  });

  test('arrows and Space use the same actions as navigation buttons, without scrolling', async () => {
    const view = await mount();
    expect(key('ArrowLeft').defaultPrevented).toBe(true);
    expect(view.props.onPrevious).toHaveBeenCalledOnce();
    await view.render({ pendingAction: 'previous' });
    await view.render({ pendingAction: null });
    expect(key('ArrowRight').defaultPrevented).toBe(true);
    expect(view.props.onNext).toHaveBeenCalledOnce();
    await view.render({ pendingAction: 'next' });
    await view.render({ pendingAction: null });
    expect(key(' ').defaultPrevented).toBe(true);
    expect(view.props.onNext).toHaveBeenCalledTimes(2);
  });

  test('blocks rapid duplicate events before pending renders and while a request is in flight', async () => {
    const view = await mount();
    key('ArrowRight'); key(' '); key('ArrowLeft');
    expect(view.props.onNext).toHaveBeenCalledOnce();
    expect(view.props.onPrevious).not.toHaveBeenCalled();
    await view.render({ pendingAction: 'next' });
    key('ArrowLeft'); key('ArrowRight');
    expect(view.props.onNext).toHaveBeenCalledOnce();
    await view.render({ pendingAction: null });
    key('ArrowLeft');
    expect(view.props.onPrevious).toHaveBeenCalledOnce();
  });

  test('does not navigate past a boundary or after ending and obeys disabled controls', async () => {
    const view = await mount({ session: { ...session, currentSlidePosition: 1 } });
    key('ArrowLeft');
    expect(view.props.onPrevious).not.toHaveBeenCalled();
    key('ArrowRight');
    expect(view.props.onNext).toHaveBeenCalledOnce();
    await view.render({ session: { ...session, revision: 2, currentSlidePosition: 3 } });
    key('ArrowRight'); key(' ');
    expect(view.props.onNext).toHaveBeenCalledOnce();
    await view.render({ session: { ...session, revision: 3, status: 'ended' } });
    key('ArrowLeft');
    expect(view.props.onPrevious).not.toHaveBeenCalled();
    expect([...view.host.querySelectorAll('.primary-live-controls button')].every(button => button.hasAttribute('disabled'))).toBe(true);
  });

  test.each<KeyboardEventInit>([
    { repeat: true }, { isComposing: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true },
  ])('respects repeated, composing, and modified keys: %j', async options => {
    const view = await mount();
    expect(key('ArrowRight', options).defaultPrevented).toBe(false);
    expect(view.props.onNext).not.toHaveBeenCalled();
  });

  test.each([
    '<input />', '<textarea></textarea>', '<select><option>A</option></select>',
    '<div contenteditable="true"><span>Text</span></div>', '<div role="slider"></div>',
    '<a href="#">Odkaz</a>', '<summary>Podrobnosti</summary>',
  ])('preserves editing and native controls: %s', async markup => {
    const view = await mount();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = markup;
    document.body.append(wrapper);
    const target = wrapper.querySelector('span') ?? wrapper.firstElementChild!;
    expect(key('ArrowRight', {}, target).defaultPrevented).toBe(false);
    expect(key(' ', {}, target).defaultPrevented).toBe(false);
    expect(view.props.onNext).not.toHaveBeenCalled();
  });

  test('Space respects focused buttons while arrows remain available there', async () => {
    const view = await mount();
    const button = view.host.querySelector('.primary-live-controls button')!;
    expect(key(' ', {}, button).defaultPrevented).toBe(false);
    expect(view.props.onNext).not.toHaveBeenCalled();
    expect(key('ArrowRight', {}, button).defaultPrevented).toBe(true);
    expect(view.props.onNext).toHaveBeenCalledOnce();
  });

  test('blocks shortcuts whenever a dialog is open, then resumes on closing', async () => {
    const view = await mount();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    expect(key('ArrowRight').defaultPrevented).toBe(false);
    expect(view.props.onNext).not.toHaveBeenCalled();
    dialog.remove();
    key('ArrowRight');
    expect(view.props.onNext).toHaveBeenCalledOnce();
  });

  test('a private practice dialog can opt into shortcuts without ignoring additional dialogs', () => {
    const practice = document.createElement('div');
    practice.setAttribute('role', 'dialog');
    document.body.append(practice);
    const classify = vi.fn((event: KeyboardEvent) => liveNavigationDirection(event, practice));
    practice.addEventListener('keydown', classify);
    key('ArrowRight', {}, practice);
    expect(classify).toHaveLastReturnedWith(1);
    const confirmation = document.createElement('dialog');
    confirmation.setAttribute('open', '');
    document.body.append(confirmation);
    key('ArrowRight', {}, practice);
    expect(classify).toHaveLastReturnedWith(undefined);
  });

  test('does not intercept an already handled event and removes its listener on unmount', async () => {
    const view = await mount();
    const handled = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    handled.preventDefault(); document.body.dispatchEvent(handled);
    expect(view.props.onNext).not.toHaveBeenCalled();
    await act(async () => { view.root.unmount(); });
    roots.splice(roots.indexOf(view.root), 1);
    expect(key('ArrowRight').defaultPrevented).toBe(false);
    expect(view.props.onNext).not.toHaveBeenCalled();
  });
});

describe('moderator chrome', () => {
  test('event preview keeps public scope while private image lookahead warms only prompt images', async () => {
    vi.useFakeTimers();
    vi.mocked(readQuizMediaBlob).mockResolvedValue(new Blob(['synthetic image'], { type: 'image/png' }));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private-preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const currentImage = 'quiz-asset:synthetic-quiz/' + 'a'.repeat(64);
    const nextImage = 'quiz-asset:synthetic-quiz/' + 'b'.repeat(64);
    const answerImage = 'quiz-asset:synthetic-quiz/' + 'c'.repeat(64);
    const current = { ...slides[1]!, kind: 'image', questionImage: currentImage };
    const future = { ...slides[2]!, questionImage: nextImage, answerImage, answerDesign: { backgroundImage: answerImage } };
    const view = await mount({ session: { ...session, eventId: 'synthetic-event', snapshotId: 'synthetic-snapshot' },
      slides: [slides[0]!, current, future], currentSlide: current, presentedSlide: current,
      publicState: { sessionId: session.sessionId, quizTitle: session.quizTitle, status: 'active', slidePosition: 2, slideKind: 'image',
        options: [], media: [], presentation: {}, presentationMode: 'slide', renderMode: 'question', questionImage: currentImage, answerImage,
        mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 0, introGeneration: 0, answerRevealed: false, revision: 1 },
    });
    expect(view.host.querySelector('.live-preview-stage img')).not.toBeNull();
    expect(readQuizMediaBlob).toHaveBeenCalledOnce();
    expect(vi.mocked(readQuizMediaBlob).mock.calls[0]).toEqual([currentImage, expect.any(AbortSignal), 'synthetic-session', 'synthetic-snapshot']);
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(readQuizMediaBlob).toHaveBeenCalledTimes(2);
    expect(vi.mocked(readQuizMediaBlob).mock.calls[1]).toEqual([nextImage, expect.any(AbortSignal), undefined, 'synthetic-snapshot']);
    expect(vi.mocked(readQuizMediaBlob).mock.calls.some(call => call[0] === answerImage)).toBe(false);
  });

  test('navigation pending state leaves the workspace structure and labels stable', async () => {
    const view = await mount();
    const childClasses = [...view.host.querySelector('article')!.children].map(element => element.className);
    const buttonLabels = view.host.querySelector('.primary-live-controls')!.textContent;
    await view.render({ pendingAction: 'next' });
    expect([...view.host.querySelector('article')!.children].map(element => element.className)).toEqual(childClasses);
    expect(view.host.querySelector('.primary-live-controls')!.textContent).toBe(buttonLabels);
    expect(view.host.textContent).not.toContain('Přecházím');
    expect(view.host.querySelector('.operation-status')).toBeNull();
    expect([...view.host.querySelectorAll('.primary-live-controls button')].every(button => button.hasAttribute('disabled'))).toBe(true);
  });

  test('removes stale projector and YouTube notices while retaining actual errors', async () => {
    const video = { ...slides[1]!, kind: 'video', mediaSource: 'abcdefghijk' };
    const view = await mount({ currentSlide: video, presentedSlide: video,
      error: { title: 'Přehrávání selhalo', message: 'Zkuste spustit znovu.' } });
    expect(view.host.textContent).not.toContain('Připojení ani celou obrazovku');
    expect(view.host.textContent).not.toContain('Při přehrávání z YouTube');
    expect(view.host.textContent).not.toContain('Stav nelze ověřit');
    expect(view.host.textContent).toContain('Otevřít projektor');
    expect(view.host.textContent).toContain('Přehrávání selhalo');
    await view.render({ currentSlide: { ...video, mediaSource: undefined }, presentedSlide: { ...video, mediaSource: undefined } });
    expect(view.host.textContent).toContain('Médium nemá zdroj');
  });
});
