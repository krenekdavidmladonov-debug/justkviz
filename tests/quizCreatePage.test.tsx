// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { QuizCreatePage } from '../apps/web/src/routes/admin/QuizCreatePage';
import { loadCreationAttempt } from '../apps/web/src/routes/admin/quizCreationRecovery';
import { createQuiz } from '../apps/web/src/features/editor/editorApi';

const auth = vi.hoisted(() => ({ uid: 'synthetic-creator', version: 1 }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({ currentUser: { uid: auth.uid }, can: () => true }) }));
vi.mock('../apps/web/src/features/editor/editorApi', () => ({ createQuiz: vi.fn() }));

const createPath = '/admin/quizzes/new', listPath = '/admin/quizzes', editorPath = '/admin/quizzes/synthetic-created/edit';
const created: Awaited<ReturnType<typeof createQuiz>> = { quizId: 'synthetic-created', revision: 0, slideCount: 8, questionCount: 1, roundCount: 1 };
let host: HTMLDivElement, root: Root, router: ReturnType<typeof createMemoryRouter>;
let listLoader: (() => Promise<null>) | undefined;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(createQuiz).mockReset(); window.sessionStorage.clear();
  Object.assign(auth, { uid: 'synthetic-creator', version: 1 }); listLoader = undefined;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  router = createMemoryRouter([
    { path: createPath, element: <QuizCreatePage isCurrentEntry={key => router.state.location.key === key && router.state.navigation.state === 'idle'} /> },
    { path: listPath, loader: () => listLoader?.() ?? null, element: <h1>Knihovna kvízů</h1> },
    { path: '/admin/quizzes/:quizId/edit', element: <h1>Editor kvízu</h1> },
  ], { initialEntries: [createPath] });
});
afterEach(async () => { await act(async () => root.unmount()); router.dispose(); host.remove(); vi.unstubAllGlobals(); });
async function render() {
  await act(async () => root.render(<React.StrictMode><RouterProvider key={`${auth.uid}:${auth.version}`} router={router} /></React.StrictMode>));
}
const form = () => host.querySelector<HTMLFormElement>('form')!;
const button = () => form().querySelector<HTMLButtonElement>('button[type=submit]')!;
async function fill() {
  const input = form().querySelector<HTMLInputElement>('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Synthetic quiz');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function deferCreate() {
  let resolve!: (value: typeof created) => void, reject!: (error: Error) => void;
  vi.mocked(createQuiz).mockReturnValue(new Promise((done, fail) => { resolve = done; reject = fail; }));
  return { resolve, reject };
}
function deferList() {
  let finish!: (value: null) => void;
  listLoader = () => new Promise(resolve => { finish = resolve; });
  return () => finish(null);
}

test('admits one current create for two submissions in the same batch and consumes its success', async () => {
  const request = deferCreate(); await render(); await fill();
  await act(async () => { form().requestSubmit(); form().requestSubmit(); });
  expect(createQuiz).toHaveBeenCalledExactlyOnceWith('Synthetic quiz', expect.any(String));
  const id = vi.mocked(createQuiz).mock.calls[0]![1];
  expect(button().disabled).toBe(true);
  await act(async () => request.resolve(created));
  expect(router.state.location.pathname).toBe(editorPath);
  expect(loadCreationAttempt(auth.uid).requestId).not.toBe(id);
});

test('retries the same submitted request after an uncertain failure while the entry is current', async () => {
  const request = deferCreate(); await render(); await fill();
  await act(async () => form().requestSubmit());
  const original = vi.mocked(createQuiz).mock.calls[0]!;
  await act(async () => request.reject(new Error('Synthetic lost response')));
  expect(button().disabled).toBe(false);
  vi.mocked(createQuiz).mockResolvedValueOnce(created);
  await act(async () => form().requestSubmit());
  expect(vi.mocked(createQuiz).mock.calls[1]).toEqual(original);
  expect(router.state.location.pathname).toBe(editorPath);
});

test.each(['after pending render', 'in the same batch'] as const)('retains Back and recovery when create succeeds %s', async timing => {
  const finishList = deferList(), request = deferCreate();
  await render(); await fill(); await act(async () => form().requestSubmit());
  const original = vi.mocked(createQuiz).mock.calls[0]!;
  await act(async () => {
    host.querySelector<HTMLAnchorElement>('a.back-link')!.click();
    expect(router.state.location.pathname).toBe(createPath);
    expect(router.state.navigation.location?.pathname).toBe(listPath);
    if (timing === 'in the same batch') request.resolve(created);
  });
  if (timing === 'after pending render') await act(async () => request.resolve(created));
  expect(router.state.navigation.location?.pathname).toBe(listPath);
  expect(router.state.location.pathname).toBe(createPath);
  expect(loadCreationAttempt(auth.uid)).toMatchObject({ requestId: original[1], submittedTitle: original[0] });
  await act(async () => finishList());
  expect(router.state.location.pathname).toBe(listPath);
});

test('does not submit from the old mounted form after Back starts loading', async () => {
  const finishList = deferList(); deferCreate(); await render(); await fill();
  await act(async () => {
    host.querySelector<HTMLAnchorElement>('a.back-link')!.click();
    form().requestSubmit();
  });
  expect(createQuiz).not.toHaveBeenCalled();
  await act(async () => finishList());
  expect(router.state.location.pathname).toBe(listPath);
});

test('does not let the old submit handler undo an explicitly checked reset before render', async () => {
  const request = deferCreate(); await render(); await fill();
  await act(async () => form().requestSubmit());
  const oldId = vi.mocked(createQuiz).mock.calls[0]![1];
  await act(async () => request.reject(new Error('Synthetic lost response')));
  await act(async () => form().querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  const reset = [...form().querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === 'Začít nový pokus')!;
  await act(async () => { reset.click(); form().requestSubmit(); });
  expect(createQuiz).toHaveBeenCalledTimes(1);
  expect(loadCreationAttempt(auth.uid)).toMatchObject({ submittedTitle: null });
  expect(loadCreationAttempt(auth.uid).requestId).not.toBe(oldId);
  expect(form().querySelector<HTMLInputElement>('input')!.value).toBe('');
  const freshId = loadCreationAttempt(auth.uid).requestId;
  await fill(); vi.mocked(createQuiz).mockResolvedValueOnce(created);
  await act(async () => form().requestSubmit());
  expect(vi.mocked(createQuiz).mock.calls[1]).toEqual(['Synthetic quiz', freshId]);
  expect(router.state.location.pathname).toBe(editorPath);
});

test('retains pending ownership across a same-UID membership remount without another RPC', async () => {
  const request = deferCreate(); await render(); await fill();
  await act(async () => form().requestSubmit());
  auth.version++; await render();
  await act(async () => { form().requestSubmit(); form().requestSubmit(); });
  try {
    expect(createQuiz).toHaveBeenCalledTimes(1);
    expect(button().disabled).toBe(true);
  } finally { await act(async () => request.resolve(created)); }
});

test('consumes the original success after the self-grant membership remount', async () => {
  const request = deferCreate(); await render(); await fill();
  await act(async () => form().requestSubmit());
  const original = vi.mocked(createQuiz).mock.calls[0]!;
  auth.version++; await render();
  await act(async () => request.resolve(created));
  expect(createQuiz).toHaveBeenCalledTimes(1);
  expect(router.state.location.pathname).toBe(editorPath);
  expect(loadCreationAttempt(auth.uid).requestId).not.toBe(original[1]);
});

test('observes the original failure after a membership remount and retries the exact request', async () => {
  const request = deferCreate(); await render(); await fill();
  await act(async () => form().requestSubmit());
  const original = vi.mocked(createQuiz).mock.calls[0]!;
  auth.version++; await render();
  await act(async () => request.reject(new Error('Synthetic uncertain completion')));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Kvíz nelze vytvořit');
  expect(button().disabled).toBe(false);
  expect(loadCreationAttempt(auth.uid)).toMatchObject({ requestId: original[1], submittedTitle: original[0] });
  vi.mocked(createQuiz).mockResolvedValueOnce(created);
  await act(async () => form().requestSubmit());
  expect(vi.mocked(createQuiz).mock.calls[1]).toEqual(original);
  expect(router.state.location.pathname).toBe(editorPath);
});

test('never hands the original promise to another UID or clears its durable attempt on raw settlement', async () => {
  const request = deferCreate(); await render(); await fill();
  await act(async () => form().requestSubmit());
  const originalUid = auth.uid, original = vi.mocked(createQuiz).mock.calls[0]!;
  auth.uid = 'other-creator'; await render();
  const other = loadCreationAttempt(auth.uid);
  expect(form().querySelector<HTMLInputElement>('input')!.value).toBe('');
  await act(async () => request.resolve(created));
  expect(router.state.location.pathname).toBe(createPath);
  expect(loadCreationAttempt(auth.uid)).toEqual(other);
  expect(loadCreationAttempt(originalUid)).toMatchObject({ requestId: original[1], submittedTitle: original[0] });
  expect(createQuiz).toHaveBeenCalledTimes(1);
});
