// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuizEditorPage } from '../apps/web/src/routes/admin/QuizEditorPage';
import { getEditorQuiz } from '../apps/web/src/features/editor/editorRepository';
import { createQuizSlide, deleteQuizSlide, removeQuizRound, updateQuizSlide } from '../apps/web/src/features/editor/editorApi';
import { runQuizPreflight } from '../apps/web/src/features/preflight/validation';
import { QuizPractice } from '../apps/web/src/features/editor/QuizPractice';
import { SlideRenderer } from '../apps/web/src/features/presentation/SlideRenderer';
import type { EditorQuiz, EditorSlide } from '../apps/web/src/features/editor/types';

const access = vi.hoisted(() => ({ denied: [] as string[] }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({ can: (permission: string) => !access.denied.includes(permission) }) }));
vi.mock('../apps/web/src/features/editor/editorRepository', () => ({ getEditorQuiz: vi.fn() }));
vi.mock('../apps/web/src/features/editor/editorApi', () => ({
  staleEditorMessage: 'stale',
  ...Object.fromEntries(['createQuizSlide', 'createQuizRound', 'deleteQuizSlide', 'duplicateQuizRound', 'duplicateQuizSlide',
    'moveQuizQuestionToRound', 'moveQuizRound', 'moveQuizSlide', 'removeQuizRound', 'reorderQuizQuestion',
    'updateQuizMetadata', 'updateQuizRound', 'updateQuizSlide'].map(name => [name, vi.fn()])),
}));
vi.mock('../apps/web/src/features/presentation/SlidePreview', () => ({ SlidePreview: () => <div className="slide-renderer" /> }));
vi.mock('../apps/web/src/features/presentation/SlideRenderer', () => ({ SlideRenderer: vi.fn(() => <div className="practice-renderer" />) }));
vi.mock('../apps/web/src/features/preflight/validation', async importOriginal => {
  const actual = await importOriginal<typeof import('../apps/web/src/features/preflight/validation')>();
  return { ...actual, runQuizPreflight: vi.fn(actual.runQuizPreflight) };
});

const question = (id: string, position: number): EditorSlide => ({
  id, position, kind: 'free', storedKind: 'free', isQuestion: true, roundId: 'r1', roundTitle: 'Filmy',
  title: '', text: `Zadání ${id}`, correctAnswer: 'Odpověď', options: [], moderatorNote: '', media: [], hasLegacyData: false,
  backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '', backgroundOverlay: null, clipStartSeconds: null, clipEndSeconds: null,
  presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null },
});
const quiz: EditorQuiz = { id: 'quiz', title: 'Filmový večer', description: '', revision: 1, slideCount: 2, questionCount: 2, roundCount: 1, slides: [question('q1', 1), question('q2', 2)] };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(getEditorQuiz).mockReset().mockResolvedValue(quiz); vi.mocked(runQuizPreflight).mockClear();
  vi.mocked(createQuizSlide).mockReset(); vi.mocked(updateQuizSlide).mockReset();
  vi.mocked(deleteQuizSlide).mockReset(); vi.mocked(removeQuizRound).mockReset(); access.denied = [];
  vi.mocked(SlideRenderer).mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(query = '?questionId=q1') {
  const router = createMemoryRouter([{ path: '/admin/quizzes/:quizId/edit', element: <QuizEditorPage /> }], { initialEntries: ['/admin/quizzes/quiz/edit' + query] });
  await act(async () => root.render(<RouterProvider router={router} />));
  await advance(220);
  return router;
}
async function advance(ms: number) { await act(async () => vi.advanceTimersByTimeAsync(ms)); }
async function setText(field: string, value: string) {
  const input = host.querySelector<HTMLTextAreaElement>(`[data-preflight-field="${field}"] textarea`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('visiting a missing system screen does not add its pristine local draft to automatic readiness', async () => {
  await render('?section=agenda');
  expect(host.textContent).toContain('Harmonogram');
  expect(host.querySelector('.readiness-chip')?.textContent).toBe('Zkontrolovat kvíz');
  expect(vi.mocked(runQuizPreflight).mock.lastCall?.[0].slides.map(slide => slide.id)).toEqual(['q1', 'q2']);
  expect(vi.mocked(runQuizPreflight).mock.lastCall?.[1]).toEqual({ source: 'SAVED_QUIZ', hasUnsavedChanges: false });
});

it('shows question and round trash controls without opening an extra menu and confirms the actual question', async () => {
  await render();
  const remove = host.querySelector<HTMLButtonElement>('[data-question-id="q1"] .outline-delete-button')!;
  expect(remove.getAttribute('aria-label')).toContain('Zadání q1'); expect(remove.closest('details')).toBeNull();
  expect(host.querySelector('.outline-round-header .outline-delete-button')?.getAttribute('aria-label')).toBe('Smazat kolo Filmy');
  expect(host.querySelector('.editor-selection-actions button')?.textContent).toBe('Smazat otázku…');
  remove.focus(); await act(async () => remove.click());
  expect(host.querySelector('dialog')?.textContent).toContain('Zadání q1'); expect(host.querySelector('dialog')?.textContent).toContain('Kolo: Filmy');
  expect(document.activeElement?.textContent).toBe('Zrušit');
  await act(async () => host.querySelector<HTMLButtonElement>('dialog .secondary-button')!.click());
  expect(host.querySelector('dialog')).toBeNull(); expect(document.activeElement).toBe(remove);
  expect(deleteQuizSlide).not.toHaveBeenCalled(); expect(removeQuizRound).not.toHaveBeenCalled();
});

it('deletes once with the rendered revision, blocks cancellation while pending, and refreshes the acknowledged outline', async () => {
  let resolve!: (response: { quizId: string; revision: number; slideCount: number; questionCount: number; roundCount: number }) => void;
  vi.mocked(deleteQuizSlide).mockImplementation(() => new Promise(done => { resolve = done; }));
  vi.mocked(getEditorQuiz).mockResolvedValueOnce(quiz).mockResolvedValue({ ...quiz, revision: 2, slideCount: 1, questionCount: 1, slides: [{ ...question('q2', 1) }] });
  await render(); await act(async () => host.querySelector<HTMLButtonElement>('[data-question-id="q1"] .outline-delete-button')!.click());
  const confirm = host.querySelector<HTMLButtonElement>('dialog .danger-button')!;
  await act(async () => { confirm.click(); confirm.click(); });
  expect(deleteQuizSlide).toHaveBeenCalledExactlyOnceWith('quiz', 1, 'q1'); expect(confirm.disabled).toBe(true);
  expect(host.querySelector('dialog')?.textContent).toContain('Mažu otázku');
  await act(async () => host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })));
  expect(host.querySelector('dialog')).not.toBeNull();
  await act(async () => resolve({ quizId: 'quiz', revision: 2, slideCount: 1, questionCount: 1, roundCount: 1 }));
  expect(host.querySelector('dialog')).toBeNull(); expect(host.querySelector('[data-question-id="q1"]')).toBeNull();
  expect(getEditorQuiz).toHaveBeenCalledTimes(2);
});

it('keeps the question confirmation open with a readable error after a failed delete', async () => {
  vi.mocked(deleteQuizSlide).mockRejectedValue(new Error('stale'));
  await render(); await act(async () => host.querySelector<HTMLButtonElement>('.editor-selection-actions button')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('dialog .danger-button')!.click());
  expect(host.querySelector('dialog [role="alert"]')?.textContent).toContain('mezitím upravil');
  expect(host.querySelector<HTMLButtonElement>('dialog .danger-button')?.disabled).toBe(false);
  expect(host.querySelector('[data-question-id="q1"]')).not.toBeNull(); expect(getEditorQuiz).toHaveBeenCalledTimes(1);
});

it('names the round before deletion and preserves the existing move-questions option', async () => {
  const q3 = { ...question('q3', 3), roundId: 'r2', roundTitle: 'Seriály' };
  vi.mocked(getEditorQuiz).mockResolvedValue({ ...quiz, slideCount: 3, questionCount: 3, roundCount: 2, slides: [...quiz.slides, q3] });
  vi.mocked(removeQuizRound).mockRejectedValue(new Error('stale'));
  await render(); await act(async () => host.querySelector<HTMLButtonElement>('[data-round-id="r1"] .outline-round-header .outline-delete-button')!.click());
  expect(host.querySelector('dialog h2')?.textContent).toBe('Smazat kolo „Filmy“?');
  expect(host.querySelector('dialog')?.textContent).toContain('Smazat kolo včetně 2 otázek');
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.textContent === 'Přesunout otázky a smazat kolo')!.click());
  expect(removeQuizRound).toHaveBeenCalledExactlyOnceWith('quiz', 1, 'r1', 'move', 'r2');
  expect(host.querySelector('dialog [role="alert"]')?.textContent).toContain('mezitím upravil');
});

it('uses the existing round deletion operation and retains the modal after failure', async () => {
  vi.mocked(removeQuizRound).mockRejectedValue(new Error('offline'));
  await render(); await act(async () => host.querySelector<HTMLButtonElement>('.outline-round-header .outline-delete-button')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('dialog .danger-button')!.click());
  expect(removeQuizRound).toHaveBeenCalledExactlyOnceWith('quiz', 1, 'r1', 'delete');
  expect(host.querySelector('dialog [role="alert"]')?.textContent).toContain('nepodařilo uložit');
});

it('disables deletion without permission and while edits remain unsaved', async () => {
  access.denied = ['quiz.delete']; await render();
  expect([...host.querySelectorAll<HTMLButtonElement>('.outline-delete-button, .editor-selection-actions button')].every(button => button.disabled)).toBe(true);
  access.denied = []; await render(); await setText('prompt', 'Rozepsané zadání');
  expect([...host.querySelectorAll<HTMLButtonElement>('.outline-delete-button, .editor-selection-actions button')].every(button => button.disabled)).toBe(true);
  expect(deleteQuizSlide).not.toHaveBeenCalled(); expect(removeQuizRound).not.toHaveBeenCalled();
});

it('clean question navigation keeps checked readiness and performs no new reads or full-quiz checks', async () => {
  const slides = Array.from({ length: 180 }, (_, index) => question(`q${index + 1}`, index + 1));
  vi.mocked(getEditorQuiz).mockResolvedValue({ ...quiz, slides, slideCount: 180, questionCount: 180 });
  await render();
  const calls = vi.mocked(runQuizPreflight).mock.calls.length;
  const selections = [17, 65, 129, 179, 0];
  for (const index of selections) {
    await act(async () => host.querySelectorAll<HTMLButtonElement>('.outline-question')[index]!.click());
    expect(host.querySelector<HTMLTextAreaElement>('[data-preflight-field="prompt"] textarea')?.value).toBe(`Zadání q${index + 1}`);
    expect(host.querySelector('.readiness-chip')?.textContent).toBe('Zkontrolovat kvíz');
    expect(host.querySelector<HTMLButtonElement>('.practice-button')?.disabled).toBe(false);
    await advance(220);
  }
  expect(runQuizPreflight).toHaveBeenCalledTimes(calls);
  expect(getEditorQuiz).toHaveBeenCalledTimes(1);
});

it('keeps the saved library status distinct from editorial findings and allows private practice', async () => {
  vi.mocked(getEditorQuiz).mockResolvedValue({ ...quiz, status: 'ready', slides: [{ ...question('q1', 1), correctAnswer: '' }] });
  await render();
  expect(host.querySelector('.quiz-status')?.textContent).toBe('Připravený');
  const checked = vi.mocked(runQuizPreflight).mock.results.at(-1)?.value as ReturnType<typeof runQuizPreflight> | undefined;
  expect(checked?.blockerCount).toBeGreaterThan(0);
  expect(host.querySelector<HTMLButtonElement>('.practice-button')?.disabled).toBe(false);
  await act(async () => host.querySelector<HTMLButtonElement>('.practice-button')!.click());
  expect(host.querySelector('dialog[aria-label="Soukromá zkouška kvízu"]')).not.toBeNull();
});

it('does not allow private practice when the saved source contains no visible slides', async () => {
  vi.mocked(getEditorQuiz).mockResolvedValue({ ...quiz, slides: [], slideCount: 0, questionCount: 0, roundCount: 0 });
  await render('?section=quiz');
  expect(host.querySelector<HTMLButtonElement>('.practice-button')?.disabled).toBe(true);
});

it('private practice navigates with arrows and space without hijacking controls or repeated keys', async () => {
  await act(async () => root.render(<QuizPractice quiz={quiz} onClose={vi.fn()} />));
  const dialog = host.querySelector('dialog')!;
  const press = async (target: Element, key: string, repeat = false) => {
    await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true })); });
  };
  await press(dialog, 'ArrowRight');
  expect(vi.mocked(SlideRenderer).mock.lastCall![0].slide).toMatchObject({ id: 'q2' });
  await press(dialog, 'ArrowLeft');
  expect(vi.mocked(SlideRenderer).mock.lastCall![0].slide).toMatchObject({ id: 'q1' });
  await press(dialog, ' ', true);
  await press(host.querySelector('button')!, ' ');
  expect(vi.mocked(SlideRenderer).mock.lastCall![0].slide).toMatchObject({ id: 'q1' });
  await press(dialog, ' ');
  expect(vi.mocked(SlideRenderer).mock.lastCall![0].slide).toMatchObject({ id: 'q2' });
  await press(dialog, 'ArrowRight');
  expect(vi.mocked(SlideRenderer).mock.lastCall![0].slide).toMatchObject({ id: 'q2' });
});

it('recap selects a private answer immediately and retains its resolved slide through playback commands', async () => {
  const recap: EditorSlide = { ...question('recap', 0), kind: 'recap', storedKind: 'recap', isQuestion: false };
  const video: EditorSlide = { ...question('video', 1), kind: 'video', storedKind: 'video', mediaSource: 'https://example.test/clip.mp4', correctAnswer: 'Soukromá odpověď', answerImage: 'https://example.test/answer.png' };
  await act(async () => root.render(<QuizPractice quiz={{ ...quiz, slides: [recap, video] }} onClose={vi.fn()} />));
  const select = host.querySelector('select')!;
  await act(async () => { select.value = 'video'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  const selected = vi.mocked(SlideRenderer).mock.lastCall![0];
  expect(selected.mode).toBe('recap');
  expect(selected.slide).toEqual(expect.objectContaining({ id: 'video', revealedAnswer: 'Soukromá odpověď', answerImage: 'https://example.test/answer.png' }));
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Přehrát')!.click());
  expect(vi.mocked(SlideRenderer).mock.lastCall![0].slide).toBe(selected.slide);
  expect(vi.mocked(SlideRenderer).mock.lastCall![0].onMediaFinished).toBe(selected.onMediaFinished);
  expect(getEditorQuiz).not.toHaveBeenCalled();
});

it('private practice offers full original only after reveal and resets it on hide and recap selection', async () => {
  const video: EditorSlide = { ...question('video', 1), kind: 'video', storedKind: 'video', mediaSource: `quiz-asset:quiz/${'a'.repeat(64)}`, originalMediaSource: 'https://www.youtube.com/watch?v=abcdefghijk', clipStartSeconds: 0, clipEndSeconds: 12 };
  const recap: EditorSlide = { ...question('recap', 2), kind: 'recap', storedKind: 'recap', isQuestion: false };
  const click = async (label: string) => act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click());
  const fullButton = () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Přehrát celé původní video z YouTube');
  await act(async () => root.render(<QuizPractice quiz={{ ...quiz, slides: [video, recap] }} onClose={vi.fn()} />));
  expect(fullButton()).toBeUndefined();
  await click('Odhalit odpověď ve zkoušce');
  expect(fullButton()).toBeDefined();
  await click('Přehrát celé původní video z YouTube');
  expect(vi.mocked(SlideRenderer).mock.lastCall![0].slide).toMatchObject({ mediaPlaybackMode: 'original', mediaSource: video.originalMediaSource, clipEndSeconds: null });
  await click('Skrýt odpověď');
  expect(vi.mocked(SlideRenderer).mock.lastCall![0].slide.mediaSource).toBe(video.mediaSource);
  expect(fullButton()).toBeUndefined();
  await click('Další');
  const select = host.querySelector('select')!;
  await act(async () => { select.value = video.id; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('Přehrát celé původní video z YouTube');
  await act(async () => { select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(vi.mocked(SlideRenderer).mock.lastCall![0].slide).not.toHaveProperty('mediaPlaybackMode');
});

it('debounces edits, hides stale results and checks only the newest complete working snapshot', async () => {
  await render();
  const calls = vi.mocked(runQuizPreflight).mock.calls.length;
  await act(async () => host.querySelector<HTMLButtonElement>('.readiness-chip')!.click());
  expect(host.querySelector('[data-preflight-status]')?.getAttribute('data-preflight-status')).toBe('READY');
  await setText('prompt', '');
  expect(host.querySelector('.readiness-chip')?.textContent).toBe('Zkontrolovat kvíz');
  expect(host.querySelector('[data-preflight-status]')).toBeNull();
  expect(host.textContent).toContain('Aktualizuji připravenost');
  await advance(100);
  await setText('prompt', 'Nejnovější zadání');
  await advance(219);
  expect(vi.mocked(runQuizPreflight).mock.calls).toHaveLength(calls);
  await advance(1);
  expect(vi.mocked(runQuizPreflight).mock.calls).toHaveLength(calls + 1);
  expect(vi.mocked(runQuizPreflight).mock.lastCall?.[0].slides[0]?.text).toBe('Nejnovější zadání');
  expect(vi.mocked(runQuizPreflight).mock.lastCall?.[1]).toEqual({ source: 'LOCAL_DRAFT', hasUnsavedChanges: true });
  const result = vi.mocked(runQuizPreflight).mock.results.at(-1)?.value as ReturnType<typeof runQuizPreflight> | undefined;
  expect(result?.issues.map(issue => issue.code)).toEqual(['UNSAVED_CHANGES']);
  expect(host.querySelector('[data-content-blocker-count]')?.getAttribute('data-content-blocker-count')).toBe('0');
  expect(host.textContent).toContain('Před hraním uložte rozepsané změny');
  expect(host.textContent).not.toContain('Vyžaduje opravu');
  expect(host.textContent).not.toContain('Chybí zadání otázky');
  const practice = [...host.querySelectorAll('button')].find(button => button.textContent === 'Soukromá zkouška');
  expect(practice?.disabled).toBe(true);
});

it('readiness includes parked edits from another question without saving or overwriting them', async () => {
  await render();
  await setText('prompt', 'První rozepsané zadání');
  const second = [...host.querySelectorAll<HTMLButtonElement>('.outline-question')].find(button => button.textContent?.includes('Zadání q2'))!;
  await act(async () => second.click());
  await setText('correctAnswer', 'Druhá rozepsaná odpověď');
  await advance(220);
  const checked = vi.mocked(runQuizPreflight).mock.lastCall?.[0];
  expect(checked?.slides.find(slide => slide.id === 'q1')?.text).toBe('První rozepsané zadání');
  expect(checked?.slides.find(slide => slide.id === 'q2')?.correctAnswer).toBe('Druhá rozepsaná odpověď');
  expect(quiz.slides[0]?.text).toBe('Zadání q1');
  expect(quiz.slides[1]?.correctAnswer).toBe('Odpověď');
});

it('a readiness deep link opens and focuses the lazy appearance section for an invalid background', async () => {
  vi.mocked(getEditorQuiz).mockResolvedValue({ ...quiz, slides: [{ ...quiz.slides[0]!, backgroundImage: 'invalid-background' }, quiz.slides[1]!] });
  await render('?questionId=q1&field=backgroundImage');
  const section = host.querySelector<HTMLDetailsElement>('[data-preflight-field="backgroundImage"]')!;
  expect(section.open).toBe(true);
  expect(section.querySelector('.slide-design-editor')).not.toBeNull();
  expect(document.activeElement).toBe(section.querySelector('summary'));
  expect(host.textContent).toContain('Obnovit výchozí vzhled');
});

it('new questions inherit shared appearance without copying it into local overrides', async () => {
  vi.mocked(getEditorQuiz).mockResolvedValue({ ...quiz, defaultAppearance: { backgroundImage: 'https://example.invalid/default.jpg', backgroundOverlay: 35, imageLayout: 'stacked' } });
  vi.mocked(createQuizSlide).mockResolvedValue({ quizId: 'quiz', revision: 2, slideCount: 3, questionCount: 3, roundCount: 1, selectedSlideId: 'new-question' });
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>('.add-question-button')!.click());
  await setText('prompt', 'Nová otázka'); await setText('correctAnswer', 'Nová odpověď');
  const save = [...host.querySelectorAll('button')].find(button => button.textContent === 'Uložit vše')!;
  await act(async () => save.click());
  expect(createQuizSlide).toHaveBeenCalledTimes(1);
  expect(vi.mocked(createQuizSlide).mock.calls[0]?.[3]).toEqual(expect.objectContaining({ text: 'Nová otázka', correctAnswer: 'Nová odpověď', backgroundImage: '', backgroundOverlay: null }));
  expect(vi.mocked(createQuizSlide).mock.calls[0]?.[3].imageLayout).toBeUndefined();
});

it('save and next preserves the current question when its save fails', async () => {
  vi.mocked(updateQuizSlide).mockRejectedValue(new Error('offline'));
  await render(); await setText('prompt', 'Neuložené zadání');
  const next = [...host.querySelectorAll('button')].find(button => button.textContent === 'Uložit a přidat další')!;
  await act(async () => next.click());
  expect(updateQuizSlide).toHaveBeenCalledTimes(1);
  expect(createQuizSlide).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLTextAreaElement>('[data-preflight-field="prompt"] textarea')?.value).toBe('Neuložené zadání');
  expect(host.textContent).toContain('Rozepsané hodnoty zůstaly v editoru');
});


function holdQuestionFocusFrames() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  return frames;
}
async function addQuestion() {
  const button = host.querySelector<HTMLButtonElement>('.add-question-button')!;
  button.focus();
  await act(async () => button.click());
  return button;
}
const questionField = (field: string) => host.querySelector<HTMLTextAreaElement>(`[data-preflight-field="${field}"] textarea`)!;
async function releaseFocusFrame(frame: FrameRequestCallback) { await act(async () => frame(0)); }

it('deferred question autofocus preserves normal initial prompt focus', async () => {
  await render(); const frames = holdQuestionFocusFrames();
  await addQuestion(); expect(frames).toHaveLength(1);
  await releaseFocusFrame(frames[0]!);
  expect(document.activeElement).toBe(questionField('prompt'));
});

it('deferred question autofocus does not steal answer focus or redirect typed answer into the prompt', async () => {
  await render(); const frames = holdQuestionFocusFrames(); await addQuestion();
  await setText('prompt', 'Synthetic question');
  const answer = questionField('correctAnswer'); answer.focus();
  await releaseFocusFrame(frames[0]!);
  expect(document.activeElement).toBe(answer);
  await act(async () => {
    const focused = document.activeElement as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(focused, 'Synthetic answer');
    focused.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(questionField('prompt').value).toBe('Synthetic question');
  expect(answer.value).toBe('Synthetic answer');
});

it('deferred question autofocus respects another explicitly focused control before any edit', async () => {
  await render(); const frames = holdQuestionFocusFrames(); await addQuestion();
  const save = [...host.querySelectorAll('button')].find(button => button.textContent === 'Uložit vše')!;
  save.focus(); await releaseFocusFrame(frames[0]!);
  expect(document.activeElement).toBe(save);
});

it('deferred question autofocus ignores an already edited draft even after its field loses focus', async () => {
  await render(); const frames = holdQuestionFocusFrames(); const opener = await addQuestion();
  await setText('prompt', 'Already edited'); opener.focus();
  await releaseFocusFrame(frames[0]!);
  expect(document.activeElement).toBe(opener);
  expect(questionField('prompt').value).toBe('Already edited');
});

it('deferred question autofocus ignores selection of an existing question', async () => {
  await render(); const frames = holdQuestionFocusFrames(); await addQuestion();
  const existing = host.querySelector<HTMLButtonElement>('#outline-question-q1')!;
  existing.focus(); await act(async () => existing.click());
  const discard = [...host.querySelectorAll('dialog button')].find(button => button.textContent === 'Pokračovat bez uložení') as HTMLButtonElement;
  await act(async () => discard.click());
  existing.focus(); expect(questionField('prompt').value).toBe('Zadání q1');
  await releaseFocusFrame(frames[0]!);
  expect(document.activeElement).toBe(existing);
  expect(questionField('prompt').value).toBe('Zadání q1');
});

it('deferred question autofocus cannot target another editor after unmount', async () => {
  await render(); const frames = holdQuestionFocusFrames(); await addQuestion();
  await act(async () => root.render(<div><button id="other-control">Other control</button><div data-preflight-field="prompt"><textarea /></div></div>));
  const other = host.querySelector<HTMLButtonElement>('#other-control')!; other.focus(); other.blur();
  expect(document.activeElement).toBe(document.body);
  await releaseFocusFrame(frames[0]!);
  expect(document.activeElement).toBe(document.body);
});

it('deferred question autofocus ignores the old draft after quiz A to B to A navigation', async () => {
  vi.mocked(getEditorQuiz).mockImplementation(async id => ({ ...quiz, id }));
  const router = await render(); const frames = holdQuestionFocusFrames(); await addQuestion();
  const oldFrame = frames[0]!;
  await act(async () => router.navigate('/admin/quizzes/other/edit?questionId=q1'));
  const discard = [...host.querySelectorAll('dialog button')].find(button => button.textContent === 'Pokračovat bez uložení') as HTMLButtonElement;
  expect(discard).toBeDefined(); await act(async () => discard.click());
  await advance(220);
  await act(async () => router.navigate('/admin/quizzes/quiz/edit?questionId=q1'));
  await advance(220); await addQuestion();
  const answer = questionField('correctAnswer'); answer.focus(); answer.blur();
  expect(document.activeElement).toBe(document.body);
  await releaseFocusFrame(oldFrame);
  expect(document.activeElement).toBe(document.body);
  expect(questionField('prompt').value).toBe('');
});

it('deferred question autofocus ignores a discarded draft replaced by another draft of the same type', async () => {
  await render(); const frames = holdQuestionFocusFrames(); await addQuestion(); const oldFrame = frames[0]!;
  await act(async () => host.querySelector<HTMLButtonElement>('#outline-question-q1')!.click());
  const discard = [...host.querySelectorAll('dialog button')].find(button => button.textContent === 'Pokračovat bez uložení') as HTMLButtonElement;
  await act(async () => discard.click()); await addQuestion();
  const answer = questionField('correctAnswer'); answer.focus(); answer.blur();
  expect(document.activeElement).toBe(document.body);
  await releaseFocusFrame(oldFrame);
  expect(document.activeElement).toBe(document.body);
  expect(questionField('prompt').value).toBe('');
});
