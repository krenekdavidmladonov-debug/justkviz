// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditorOutline } from '../apps/web/src/features/editor/EditorOutline';
import { buildSemanticQuizModel } from '../apps/web/src/features/editor/semanticModel';
import type { EditorQuiz } from '../apps/web/src/features/editor/types';
import { moveOutlineQuestion, moveOutlineRound } from '../apps/web/src/features/editor/outlineMoves';
import { moveQuizQuestionToRound, moveQuizRound, reorderQuizQuestion } from '../apps/web/src/features/editor/editorApi';
vi.mock('../apps/web/src/features/editor/editorApi', () => ({ moveQuizQuestionToRound: vi.fn(), moveQuizRound: vi.fn(), reorderQuizQuestion: vi.fn() }));
const quiz: EditorQuiz = { id: 'quiz', title: 'Quiz', description: '', slideCount: 4, questionCount: 4, roundCount: 2, revision: 7, slides: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, isQuestion: true, roundId: i < 2 ? 'r1' : 'r2', position: i + 1, kind: 'free', storedKind: 'free', text: id, title: '', options: [], correctAnswer: '', moderatorNote: '', media: [], hasLegacyData: false, presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null }, backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '', backgroundOverlay: null, clipStartSeconds: null, clipEndSeconds: null })) };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(moveQuizQuestionToRound).mockImplementation((_quiz, revision) => Promise.resolve({ quizId: 'quiz', revision: revision + 1, slideCount: 4, questionCount: 4, roundCount: 2 }));
  vi.mocked(reorderQuizQuestion).mockImplementation((_quiz, revision) => Promise.resolve({ quizId: 'quiz', revision: revision + 1, slideCount: 4, questionCount: 4, roundCount: 2 }));
  vi.mocked(moveQuizRound).mockImplementation((_quiz, revision) => Promise.resolve({ quizId: 'quiz', revision: revision + 1, slideCount: 4, questionCount: 4, roundCount: 2 }));
});
it('moves a whole round to its destination with acknowledged revisions', async () => {
  const threeRounds = { ...quiz, slides: [...quiz.slides, { ...quiz.slides[0]!, id: 'e', roundId: 'r3', position: 5 }] };
  await moveOutlineRound(threeRounds, 'r1');
  expect(vi.mocked(moveQuizRound).mock.calls).toEqual([['quiz', 7, 'r1', 1], ['quiz', 8, 'r1', 1]]);
  vi.mocked(moveQuizRound).mockClear();
  await moveOutlineRound(threeRounds, 'r3', 'r1');
  expect(vi.mocked(moveQuizRound).mock.calls).toEqual([['quiz', 7, 'r3', -1], ['quiz', 8, 'r3', -1]]);
});
it('does not write when a round already has the requested position', async () => {
  await moveOutlineRound(quiz, 'r1', 'r2');
  await moveOutlineRound(quiz, 'r2');
  await moveOutlineRound(quiz, 'r1', 'r1');
  expect(moveQuizRound).not.toHaveBeenCalled();
});
it('rejects stale round targets before writing and stops after the first failed move', async () => {
  await expect(moveOutlineRound(quiz, 'r1', 'missing')).rejects.toThrow('Cílové kolo');
  await expect(moveOutlineRound(quiz, 'missing', 'r1')).rejects.toThrow('Přesouvané kolo');
  expect(moveQuizRound).not.toHaveBeenCalled();
  vi.mocked(moveQuizRound).mockRejectedValueOnce(new Error('revision conflict'));
  await expect(moveOutlineRound(quiz, 'r2', 'r1')).rejects.toThrow('revision conflict');
  expect(moveQuizRound).toHaveBeenCalledTimes(1);
});
it('moves across rounds and positions with successive acknowledged revisions', async () => {
  await moveOutlineQuestion(quiz, 'a', 'r2', 'c');
  expect(moveQuizQuestionToRound).toHaveBeenCalledWith('quiz', 7, 'a', 'r2');
  expect(vi.mocked(reorderQuizQuestion).mock.calls).toEqual([['quiz', 8, 'a', -1], ['quiz', 9, 'a', -1]]);
});
it('moves down within a round and does not write for unchanged position', async () => {
  await moveOutlineQuestion(quiz, 'a', 'r1', 'b'); expect(reorderQuizQuestion).not.toHaveBeenCalled();
  await moveOutlineQuestion(quiz, 'a', 'r1'); expect(reorderQuizQuestion).toHaveBeenCalledWith('quiz', 7, 'a', 1);
});
it('stops at the first failed revision and rejects an unknown target before writing', async () => {
  await expect(moveOutlineQuestion(quiz, 'a', 'r2', 'missing')).rejects.toThrow();
  expect(moveQuizQuestionToRound).not.toHaveBeenCalled();
  vi.mocked(reorderQuizQuestion).mockRejectedValueOnce(new Error('revision conflict'));
  await expect(moveOutlineQuestion(quiz, 'a', 'r2', 'c')).rejects.toThrow('revision conflict');
  expect(reorderQuizQuestion).toHaveBeenCalledTimes(1);
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
async function update(action: () => void) {
  await act(async () => { action(); await Promise.resolve(); });
}
const mounted: { root: Root; host: HTMLDivElement }[] = [];
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) { await update(() => root.unmount()); host.remove(); }
});
async function mountOutline(patch: Partial<ComponentProps<typeof EditorOutline>> = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); mounted.push({ root, host });
  const props: ComponentProps<typeof EditorOutline> = {
    model: buildSemanticQuizModel(quiz), selectedKey: 'round:r1', activeDraft: null, disabled: false,
    onSelect: vi.fn(), onInsert: vi.fn(), onAddRound: vi.fn(),
    onMove: vi.fn().mockResolvedValue(true), onMoveRound: vi.fn().mockResolvedValue(true), ...patch,
  };
  await update(() => root.render(createElement(EditorOutline, props)));
  return { host, props, render: async (next: Partial<ComponentProps<typeof EditorOutline>>) => {
    await update(() => root.render(createElement(EditorOutline, { ...props, ...next })));
  } };
}
async function click(button: Element | null | undefined) {
  expect(button).toBeTruthy();
  await update(() => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
it('shows every stored slide once, even when another round is selected', async () => {
  const { host, render } = await mountOutline();
  const ids = () => [...host.querySelectorAll<HTMLElement>('[data-slide-id]')].map(row => row.dataset.slideId);
  expect(ids()).toEqual(['a','b','c','d']);
  await render({ selectedKey: 'slide:c' });
  expect(ids()).toEqual(['a','b','c','d']);
  expect(host.textContent).not.toContain('Automatický');
  expect(host.textContent?.match(/Spouští moderátor/g)).toHaveLength(2);
});
it('distinguishes existing generated slides from manual content and selects the actual recap', async () => {
  const model = buildSemanticQuizModel({ ...quiz, slides: [
    { ...quiz.slides[0]!, id: 'recap-a', kind: 'recap', storedKind: 'recap', isQuestion: false, position: 4 },
    { ...quiz.slides[0]!, id: 'agenda', kind: 'agenda', storedKind: 'agenda', isQuestion: false, roundId: undefined, position: 1, automaticAgenda: true },
    { ...quiz.slides[0]!, id: 'r', kind: 'round', storedKind: 'round', isQuestion: false, position: 2 },
    { ...quiz.slides[0]!, position: 3 },
    { ...quiz.slides[0]!, id: 'pause', kind: 'info', storedKind: 'info', isQuestion: false, roundId: undefined, position: 5 },
  ] });
  const { host, props } = await mountOutline({ model });
  const rows = [...host.querySelectorAll<HTMLElement>('[data-slide-id]')];
  expect(rows.map(row => row.dataset.slideId)).toEqual(['agenda','r','a','recap-a','pause']);
  expect(rows.filter(row => row.textContent?.includes('Automatický')).map(row => row.dataset.slideId)).toEqual(['agenda','r','recap-a']);
  await click(host.querySelector('[data-slide-id="recap-a"] .outline-system-item'));
  expect(props.onSelect).toHaveBeenCalledWith('slide:recap-a');
});
it('keeps a legacy round header as its name until the author sets a separate heading', () => {
  const header = { ...quiz.slides[0]!, kind: 'round' as const, storedKind: 'round', isQuestion: false,
    title: 'Původní název', roundTitle: 'Jiné uložené jméno' };
  const roundName = (slide: EditorQuiz['slides'][number]) => buildSemanticQuizModel({ ...quiz, slides: [slide] }).rounds[0]?.title;
  expect(roundName(header)).toBe('Původní název');
  expect(roundName({ ...header, customRoundHeading: true })).toBe('Jiné uložené jméno');
});
it('offers all question and screen types before every slide and at the end', async () => {
  const { host, props } = await mountOutline();
  for (const id of ['a','b','c','d','']) {
    await click(host.querySelector(`[data-before="${id}"] .outline-insert`));
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
    expect(buttons.map(button => button.textContent)).toEqual(['Výběr z možností (ABCD)', 'Volná odpověď', 'Otázka s obrázkem', 'Otázka se zvukem', 'Otázka s videem', 'Úvodní obrazovka', 'Pravidla', 'Harmonogram', 'Kolo s úvodem a rekapitulací', 'Rekapitulace kola', 'Titulní snímek', 'Informační snímek', 'Přestávka', 'Poděkování', 'Závěr kvízu', 'Zrušit']);
    await click(buttons.find(button => button.textContent === 'Přestávka'));
    expect(props.onInsert).toHaveBeenLastCalledWith(id || null, 'pause');
  }
});
it('moves questions with keyboard and cross-round menu while selecting remains independent', async () => {
  const { host, props } = await mountOutline();
  const question = host.querySelector('[data-question-id="a"]')!;
  await click(question.querySelector('.outline-question'));
  expect(props.onSelect).toHaveBeenCalledWith('slide:a');
  expect(props.onMove).not.toHaveBeenCalled();
  await update(() => question.querySelector('.outline-question')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true })));
  expect(props.onMove).toHaveBeenCalledWith('a', 'r1', undefined);
  const destination = question.querySelector('select')!;
  await update(() => { destination.value = 'r2'; destination.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(props.onMove).toHaveBeenLastCalledWith('a', 'r2', undefined);
});
it('rejects duplicate movement in the same tick and exposes a disabled reason', async () => {
  let finish: (result: boolean) => void = () => undefined;
  const pending = new Promise<boolean>(resolve => { finish = resolve; });
  const onMove = vi.fn(() => pending);
  const { host } = await mountOutline({ onMove });
  const question = host.querySelector('[data-question-id="a"] .outline-question')!;
  await update(() => {
    question.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
    question.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
  });
  expect(onMove).toHaveBeenCalledTimes(1);
  expect(host.querySelector('.quiz-outline')?.getAttribute('aria-busy')).toBe('true');
  await update(() => finish(true));
  expect(host.querySelector('.outline-move-status')?.textContent).toBe('Otázka přesunuta.');
  const locked = await mountOutline({ disabled: true, disabledReason: 'Máte oprávnění pouze ke čtení.' });
  expect(locked.host.querySelector<HTMLButtonElement>('.outline-drag-handle')?.disabled).toBe(true);
  expect(locked.host.querySelector('.outline-disabled-reason')?.textContent).toBe('Máte oprávnění pouze ke čtení.');
});
