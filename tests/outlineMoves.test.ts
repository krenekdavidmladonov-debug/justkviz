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
    model: buildSemanticQuizModel(quiz), selectedKey: 'round:r1', activeDraft: null, disabled: false, pickerRoundId: null,
    onSelect: vi.fn(), onOpenPicker: vi.fn(), onClosePicker: vi.fn(), onCreateQuestion: vi.fn(), onAddRound: vi.fn(),
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
it('separates round collapse from selection and creates a basic question in one click', async () => {
  const { host, props } = await mountOutline();
  const round = host.querySelector('[data-round-id="r1"]')!;
  expect(round.querySelectorAll('[data-question-id]')).toHaveLength(2);
  await click(round.querySelector('.outline-collapse'));
  expect(round.querySelectorAll('[data-question-id]')).toHaveLength(0);
  expect(props.onSelect).not.toHaveBeenCalled();
  await click(round.querySelector('.outline-collapse'));
  expect(round.querySelectorAll('[data-question-id]')).toHaveLength(2);
  await click(round.querySelector('.add-question-button'));
  expect(props.onCreateQuestion).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), 'free');
  expect(props.onOpenPicker).not.toHaveBeenCalled();
  expect(host.querySelector('.presentation-outline')).toBeNull();
});
it('starts with existing rounds collapsed in the overview and reveals a linked question', async () => {
  const { host, render } = await mountOutline({ selectedKey: 'quiz' });
  expect(host.querySelectorAll('[data-question-id]')).toHaveLength(0);
  expect(host.querySelectorAll('.outline-round')).toHaveLength(2);
  await render({ selectedKey: 'slide:c' });
  expect(host.querySelector('[data-question-id="c"]')).not.toBeNull();
  expect(host.querySelector('[data-question-id="a"]')).toBeNull();
});
it('keeps the initial active round open and preserves explicit toggles during typing', async () => {
  const { host, render } = await mountOutline({ selectedKey: 'slide:c' });
  expect(host.querySelector('[data-question-id="c"]')).not.toBeNull();
  expect(host.querySelector('[data-question-id="a"]')).toBeNull();
  await click(host.querySelector('[data-round-id="r2"] .outline-collapse'));
  await render({ selectedKey: 'slide:c', activeDraft: { ...quiz.slides[2]!, text: 'Rozepsaná změna' } });
  expect(host.querySelector('[data-question-id="c"]')).toBeNull();
  await click(host.querySelector('[data-round-id="r1"] .outline-collapse'));
  await render({ selectedKey: 'slide:c' });
  expect(host.querySelector('[data-question-id="a"]')).not.toBeNull();
});
it('opens a newly added round without reopening existing collapsed rounds', async () => {
  const { host, render } = await mountOutline({ selectedKey: 'quiz' });
  const added = { ...quiz, slides: [...quiz.slides, { ...quiz.slides[0]!, id: 'new-question', roundId: 'r3', position: 5 }] };
  await render({ model: buildSemanticQuizModel(added) });
  expect(host.querySelector('[data-question-id="new-question"]')).not.toBeNull();
  expect(host.querySelector('[data-question-id="a"]')).toBeNull();
  expect(host.querySelector('[data-question-id="c"]')).toBeNull();
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
