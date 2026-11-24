// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { compatibleScoringRounds, eventQuizMutationProblem, eventScoringEpoch, scoringRoundsFromSlides, mapEditorQuiz, mapEditorSlide } from '../packages/quiz-domain/src';
import { EventQuizChangeDialog } from '../apps/web/src/features/events/EventQuizChangeDialog';
import { ResetEventScoresAction } from '../apps/web/src/features/events/ResetEventScoresAction';
import { getEvent } from '../apps/web/src/features/events/eventRepository';
import { getEditorQuiz } from '../apps/web/src/features/editor/editorRepository';
import { lockEventQuiz, resetEventScores } from '../apps/web/src/features/events/eventApi';
import { eventFormRecord } from './browser/events-form-ux.data';
import type { EventRecord } from '../apps/web/src/features/events/types';

const access = vi.hoisted(() => ({ denied: [] as string[] }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({ can: (permission: string) => !access.denied.includes(permission) }) }));
vi.mock('../apps/web/src/features/events/eventRepository', () => ({ getEvent: vi.fn() }));
vi.mock('../apps/web/src/features/editor/editorRepository', () => ({ getEditorQuiz: vi.fn() }));
vi.mock('../apps/web/src/features/events/eventApi', () => ({ lockEventQuiz: vi.fn(), resetEventScores: vi.fn(), eventActionError: (error: Error) => error.message }));
let host: HTMLDivElement, root: Root;
const state = { hasActiveSession: false, hasPresentedQuestion: false, scoreDocumentCount: 3, snapshotRounds: [{ id: 'r', questionCount: 1 }] };
const record = (): EventRecord => ({ ...eventFormRecord(), lifecycleStatus: 'ready', revision: 8, scoring: { unitScale: 2, rankingMode: 'dense', started: true }, quizChangeState: state });
const quiz = () => mapEditorQuiz('quiz', { title: 'Nová verze', description: '', revision: 2, slideCount: 1, roundCount: 1, questionCount: 1 }, [
  mapEditorSlide('question', { position: 1, kind: 'free', isQuestion: true, roundId: 'r', text: 'Syntetická otázka', correctAnswer: 'Syntetická odpověď' }),
]);
const button = (text: string, scope: ParentNode = host) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === text)!;
async function input(value: string) {
  const field = host.querySelector<HTMLInputElement>('dialog input:not([type=radio]):not([type=checkbox])')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); access.denied = [];
  vi.mocked(getEvent).mockReset().mockResolvedValue(record()); vi.mocked(getEditorQuiz).mockReset().mockResolvedValue(quiz());
  vi.mocked(resetEventScores).mockReset().mockResolvedValue({ eventId: record().id, revision: 9, scoringEpoch: 1, deletedScoreCount: 3, deletedHistoryCount: 4 });
  vi.mocked(lockEventQuiz).mockReset().mockResolvedValue({ eventId: record().id, revision: 9, lifecycleStatus: 'ready', registrationStatus: 'closed' });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('shares concrete lifecycle and live reasons between UI and server', () => {
  expect(eventQuizMutationProblem(record(), state, 'version')).toBeNull();
  expect(eventQuizMutationProblem(record(), { ...state, hasActiveSession: true }, 'version')).toBeNull();
  expect(eventQuizMutationProblem(record(), { ...state, hasActiveSession: true, hasPresentedQuestion: true }, 'version')).toContain('sál už viděl otázky');
  expect(eventQuizMutationProblem(record(), { ...state, hasActiveSession: true }, 'reset')).toContain('Ukončit kvíz');
  expect(eventQuizMutationProblem(record(), { ...state, hasActiveSession: true, hasUnknownQuestionHistory: true }, 'version')).toContain('Starší moderování neobsahuje údaje');
  expect(eventQuizMutationProblem({ ...record(), lifecycleStatus: 'completed' }, state, 'version')).toContain('dokončená');
  for (const patch of [{ lifecycleStatus: 'cancelled' }, { disposition: 'archived' }, { disposition: 'trash' }]) {
    expect(eventQuizMutationProblem({ ...record(), ...patch }, state, 'version')).not.toBeNull();
    expect(eventQuizMutationProblem({ ...record(), ...patch }, state, 'reset')).not.toBeNull();
  }
});
it('preserves scores only for identical round IDs and question counts', () => {
  const previous = [{ id: 'a', questionCount: 2 }, { id: 'b', questionCount: 0 }];
  expect(compatibleScoringRounds(previous, [...previous].reverse())).toBe(true);
  for (const next of [previous.slice(0, 1), [...previous, { id: 'c', questionCount: 1 }], [{ id: 'a', questionCount: 3 }, previous[1]!], [{ id: 'x', questionCount: 2 }, previous[1]!], [previous[0]!, previous[0]!]]) expect(compatibleScoringRounds(previous, next)).toBe(false);
  expect(scoringRoundsFromSlides([], ['empty'])).toEqual([{ id: 'empty', questionCount: 0 }]);
  expect(eventQuizMutationProblem({ ...record(), lifecycleStatus: 'completed' }, state, 'reset')).toContain('dokončená');
  expect(eventScoringEpoch({})).toBe(0); expect(eventScoringEpoch({ epoch: 1 })).toBe(1);
  for (const epoch of [null, -1, '1', NaN, Number.MAX_SAFE_INTEGER]) expect(() => eventScoringEpoch({ epoch })).toThrow();
});
it('shows the exact reset count and makes no request after cancel or an inexact confirmation', async () => {
  const saved = vi.fn();
  await act(async () => root.render(<ResetEventScoresAction event={record()} onSaved={saved} />));
  await act(async () => button('Smazat všechny body').click());
  expect(host.querySelector('dialog')?.textContent).toContain('Akce má zapsané body: 3 záznamy.');
  await input('smazat'); expect(button('Smazat všechny body', host.querySelector('dialog')!).disabled).toBe(true);
  await act(async () => button('Zrušit').click());
  expect(resetEventScores).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
});
it('sends one exact reset and preserves the same operation ID on retry', async () => {
  vi.mocked(resetEventScores).mockRejectedValueOnce(new Error('Výpadek'));
  const saved = vi.fn().mockResolvedValue(undefined);
  await act(async () => root.render(<ResetEventScoresAction event={record()} onSaved={saved} />));
  await act(async () => button('Smazat všechny body').click()); await input('SMAZAT');
  const submit = button('Smazat všechny body', host.querySelector('dialog')!);
  await act(async () => { submit.click(); submit.click(); });
  expect(resetEventScores).toHaveBeenCalledTimes(1); expect(saved).not.toHaveBeenCalled();
  await act(async () => submit.click());
  expect(resetEventScores).toHaveBeenCalledTimes(2);
  expect(vi.mocked(resetEventScores).mock.calls[0]).toEqual(vi.mocked(resetEventScores).mock.calls[1]);
  expect(resetEventScores).toHaveBeenCalledWith(record().id, 8, expect.any(String), 'SMAZAT');
  expect(saved).toHaveBeenCalledTimes(1);
});
it('rereads active moderation before reset and refuses confirmation', async () => {
  vi.mocked(getEvent).mockResolvedValue({ ...record(), quizChangeState: { ...state, hasActiveSession: true } });
  await act(async () => root.render(<ResetEventScoresAction event={record()} onSaved={vi.fn()} />));
  await act(async () => button('Smazat všechny body').click());
  expect(host.querySelector('dialog')?.textContent).toContain('Nejprve ho ukončete tlačítkem Ukončit kvíz');
  expect(button('Smazat všechny body', host.querySelector('dialog')!).disabled).toBe(true);
  expect(resetEventScores).not.toHaveBeenCalled();
});
it('requires an explicit preserve choice and sends the current source and event revisions', async () => {
  await act(async () => root.render(<EventQuizChangeDialog eventId={record().id} quizId="quiz" onClose={vi.fn()} onSaved={vi.fn().mockResolvedValue(undefined)} />));
  expect(button('Změnit verzi').disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type=radio]')!.click());
  await act(async () => button('Ponechat body a změnit verzi').click());
  expect(lockEventQuiz).toHaveBeenCalledExactlyOnceWith(record().id, 8, 'quiz', 2, false, { scoreAction: 'preserve' });
});
it('disables incompatible preservation and requires SMAZAT for discard', async () => {
  vi.mocked(getEvent).mockResolvedValue({ ...record(), quizChangeState: { ...state, snapshotRounds: [{ id: 'different', questionCount: 1 }] } });
  await act(async () => root.render(<EventQuizChangeDialog eventId={record().id} quizId="quiz" onClose={vi.fn()} onSaved={vi.fn().mockResolvedValue(undefined)} />));
  expect(host.querySelector<HTMLInputElement>('input[type=radio]')!.disabled).toBe(true);
  expect(host.textContent).toContain('Nová verze má jiná kola – body nelze převzít.');
  await act(async () => host.querySelectorAll<HTMLInputElement>('input[type=radio]')[1]!.click());
  expect(button('Zahodit body a změnit verzi').disabled).toBe(true); await input('SMAZAT');
  await act(async () => button('Zahodit body a změnit verzi').click());
  expect(lockEventQuiz).toHaveBeenCalledExactlyOnceWith(record().id, 8, 'quiz', 2, false, { scoreAction: 'discard', confirm: 'SMAZAT' });
});
it('keeps the dialog open and never resets separately when a legacy lock rejects discard after rehearsal', async () => {
  const saved = vi.fn(), close = vi.fn();
  vi.mocked(lockEventQuiz).mockRejectedValueOnce(new Error('The event quiz can no longer be replaced.'));
  await act(async () => root.render(<EventQuizChangeDialog eventId={record().id} quizId="quiz" onClose={close} onSaved={saved} />));
  await act(async () => host.querySelectorAll<HTMLInputElement>('input[type=radio]')[1]!.click());
  await input('SMAZAT');
  await act(async () => button('Zahodit body a změnit verzi').click());
  expect(host.textContent).toContain('The event quiz can no longer be replaced.');
  expect(lockEventQuiz).toHaveBeenCalledTimes(1);
  expect(resetEventScores).not.toHaveBeenCalled();
  expect(saved).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it('requires explicit closure of an unplayed active session and the matching live permission', async () => {
  vi.mocked(getEvent).mockResolvedValue({ ...record(), quizChangeState: { ...state, hasActiveSession: true, scoreDocumentCount: 0 } });
  await act(async () => root.render(<EventQuizChangeDialog eventId={record().id} quizId="quiz" onClose={vi.fn()} onSaved={vi.fn().mockResolvedValue(undefined)} />));
  expect(button('Změnit verzi').disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await act(async () => button('Změnit verzi').click());
  expect(lockEventQuiz).toHaveBeenCalledExactlyOnceWith(record().id, 8, 'quiz', 2, false, { closeUnplayedSession: true });
});

it.each(['event.manage', 'quiz.export', 'quiz.answers.read', 'event.live', 'event.score'])('does not send a version request without %s for its concrete operation', async permission => {
  access.denied = [permission];
  const closing = permission === 'event.live';
  vi.mocked(getEvent).mockResolvedValue({ ...record(), quizChangeState: { ...state, hasActiveSession: closing, scoreDocumentCount: closing ? 0 : 3 } });
  await act(async () => root.render(<EventQuizChangeDialog eventId={record().id} quizId="quiz" onClose={vi.fn()} onSaved={vi.fn()} />));
  if (closing) {
    expect(host.querySelector('input[type=checkbox]')).toBeNull();
    expect(host.textContent).toContain('Nejprve ho ukončete tlačítkem Ukončit kvíz');
  } else if (permission === 'event.score') {
    expect(host.querySelectorAll<HTMLInputElement>('input[type=radio]')[1]!.disabled).toBe(true);
    expect(host.textContent).toContain('Zahození bodů navíc vyžaduje právo');
  } else {
    await act(async () => host.querySelectorAll<HTMLInputElement>('input[type=radio]')[1]!.click());
    await input('SMAZAT');
    expect(host.textContent).toContain('Změna verze vyžaduje správu akce');
  }
  expect(host.querySelector<HTMLButtonElement>('dialog button:last-child')!.disabled).toBe(true);
  expect(lockEventQuiz).not.toHaveBeenCalled();
  // Positive control: the identical form becomes submittable when only the missing grant changes.
  access.denied = [];
  await act(async () => root.render(<EventQuizChangeDialog eventId={record().id} quizId="quiz" onClose={vi.fn()} onSaved={vi.fn()} />));
  if (closing) await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  else if (permission === 'event.score') {
    await act(async () => host.querySelectorAll<HTMLInputElement>('input[type=radio]')[1]!.click()); await input('SMAZAT');
  }
  expect(host.querySelector<HTMLButtonElement>('dialog button:last-child')!.disabled).toBe(false);
  expect(lockEventQuiz).not.toHaveBeenCalled();
});
it.each(['reset', 'version'] as const)('fails closed when the %s preview cannot be verified', async kind => {
  let complete!: (event: EventRecord | null) => void;
  vi.mocked(getEvent).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await act(async () => root.render(kind === 'reset' ? <ResetEventScoresAction event={record()} onSaved={vi.fn()} /> : <EventQuizChangeDialog eventId={record().id} quizId="quiz" onClose={vi.fn()} onSaved={vi.fn()} />));
  if (kind === 'reset') await act(async () => button('Smazat všechny body').click());
  expect(host.querySelector<HTMLButtonElement>('dialog button:last-child')!.disabled).toBe(true);
  await act(async () => complete(null));
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.querySelector<HTMLButtonElement>('dialog button:last-child')!.disabled).toBe(true);
  expect(resetEventScores).not.toHaveBeenCalled(); expect(lockEventQuiz).not.toHaveBeenCalled();
});
