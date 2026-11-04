// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuizEditorPage } from '../apps/web/src/routes/admin/QuizEditorPage';
import { getEditorQuiz } from '../apps/web/src/features/editor/editorRepository';
import { updateQuizSlide } from '../apps/web/src/features/editor/editorApi';
import { readDriveConnection } from '../apps/web/src/features/drive/api';
import { accessCall } from '../apps/web/src/features/access/api';
import { requestDriveMediaImport, readDriveMediaImport } from '../apps/web/src/features/drive/importsApi';
import { driveImportCandidates } from '../apps/web/src/features/drive/useDriveMediaImports';
import type { EditorQuiz, EditorSlide } from '../apps/web/src/features/editor/types';

const auth = vi.hoisted(() => ({ role: 'owner', denied: [] as string[] }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({ can: (permission: string) => !auth.denied.includes(permission),
  currentUser: { uid: 'owner' }, membership: { role: auth.role, version: 1 }, loading: false,
}) }));
vi.mock('../apps/web/src/features/editor/editorRepository', () => ({ getEditorQuiz: vi.fn() }));
vi.mock('../apps/web/src/features/drive/api', () => ({ readDriveConnection: vi.fn() }));
vi.mock('../apps/web/src/features/access/api', () => ({ accessCall: vi.fn(), privateRead: vi.fn() }));
vi.mock('../apps/web/src/features/editor/editorApi', () => ({ staleEditorMessage: 'stale',
  ...Object.fromEntries(['createQuizSlide', 'createQuizRound', 'deleteQuizSlide', 'duplicateQuizRound', 'duplicateQuizSlide',
    'moveQuizQuestionToRound', 'moveQuizRound', 'moveQuizSlide', 'removeQuizRound', 'reorderQuizQuestion',
    'updateQuizMetadata', 'updateQuizRound', 'updateQuizSlide'].map(name => [name, vi.fn()])),
}));
vi.mock('../apps/web/src/features/presentation/SlidePreview', () => ({ SlidePreview: () => <div className="slide-renderer" /> }));
vi.mock('../apps/web/src/features/presentation/MediaPlayer', () => ({ MediaPlayer: ({ source }: { source: string }) => <span data-test-source={source} /> }));

const owned = 'quiz-asset:quiz/' + 'a'.repeat(64);
function slide(): EditorSlide {
  return { id: 'q1', position: 1, kind: 'video', storedKind: 'video', isQuestion: true, roundId: 'r1', roundTitle: 'Filmy',
    title: '', text: 'Syntetické zadání', correctAnswer: 'Soukromá odpověď', options: [], moderatorNote: '', media: [], hasLegacyData: false,
    backgroundImage: '', questionImage: '', answerImage: '', mediaSource: 'https://www.youtube.com/watch?v=abcdefghijk',
    backgroundOverlay: null, clipStartSeconds: 5, clipEndSeconds: 15,
    presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null } };
}
let server: EditorQuiz, host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React);
  auth.role = 'owner'; auth.denied = [];
  server = { id: 'quiz', title: 'Filmový večer', description: '', revision: 1, slideCount: 1, questionCount: 1, roundCount: 1, slides: [slide()] };
  vi.mocked(getEditorQuiz).mockImplementation(() => Promise.resolve(structuredClone(server)));
  vi.mocked(updateQuizSlide).mockImplementation((_id, revision, saved) => {
    if (revision !== server.revision) return Promise.reject(new Error('stale revision'));
    server = { ...server, revision: revision + 1, slides: server.slides.map(current => current.id === saved.id ? { ...saved } : current) };
    return Promise.resolve({ quizId: 'quiz', revision: server.revision, slideCount: 1, questionCount: 1, roundCount: 1 });
  });
  vi.mocked(readDriveConnection).mockResolvedValue({ configured: true, mediaImportEnabled: true, status: 'connected', folder: { id: 'folder', name: 'Média', url: '' } });
  vi.mocked(accessCall).mockImplementation(name => Promise.resolve({ jobId: 'job-1', status: name === 'requestDriveMediaImport' ? 'queued' : 'processing' }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render() {
  const router = createMemoryRouter([{ path: '/admin/quizzes/:quizId/edit', element: <QuizEditorPage /> }],
    { initialEntries: ['/admin/quizzes/quiz/edit?questionId=q1'] });
  await act(async () => root.render(<RouterProvider router={router} />));
}
async function change(field: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-preflight-field="${field}"] input, [data-preflight-field="${field}"] textarea`)!;
  expect(input).not.toBeNull();
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(value => value.textContent === label);
  expect(button?.disabled).toBe(false); await act(async () => button!.click());
}
async function save() { await change('prompt', 'Uložené zadání'); await click('Uložit vše'); }
async function advance() { await act(async () => vi.advanceTimersByTimeAsync(2500)); }
function attach() {
  server = { ...server, revision: server.revision + 1, slides: [{ ...server.slides[0]!, mediaSource: owned, clipStartSeconds: 0, clipEndSeconds: 10 }] };
}

it('queues only after saving the current YouTube source and interval, then polls by exact job ID', async () => {
  await render(); await change('clipStartSeconds', '0:06');
  expect(accessCall).not.toHaveBeenCalled(); expect(readDriveConnection).not.toHaveBeenCalled();
  let acknowledge!: (value: Awaited<ReturnType<typeof updateQuizSlide>>) => void;
  vi.mocked(updateQuizSlide).mockImplementationOnce((_id, _revision, saved) => {
    server = { ...server, revision: 2, slides: [saved] };
    return new Promise(resolve => { acknowledge = resolve; });
  });
  await click('Uložit vše'); expect(accessCall).not.toHaveBeenCalled();
  await act(async () => acknowledge({ quizId: 'quiz', revision: 2, slideCount: 1, questionCount: 1, roundCount: 1 }));
  expect(accessCall).toHaveBeenCalledExactlyOnceWith('requestDriveMediaImport', { quizId: 'quiz', slideId: 'q1', field: 'mediaSource' });
  expect(vi.mocked(updateQuizSlide).mock.calls[0]?.[2].clipStartSeconds).toBe(6);
  expect(host.textContent).toContain('Ukládám na Disk'); expect(host.textContent).toContain('stejná ukázka se použije při rekapitulaci');
  await advance();
  expect(accessCall).toHaveBeenLastCalledWith('readDriveMediaImport', { quizId: 'quiz', slideId: 'q1', field: 'mediaSource', jobId: 'job-1' });
  expect(host.querySelector('[data-test-source]')?.getAttribute('data-test-source')).toContain('youtube.com');
});

it('refreshes the clean editor after ready without exposing a Drive link or changing source early', async () => {
  await render(); await save();
  vi.mocked(accessCall).mockImplementation(name => {
    if (name === 'readDriveMediaImport') { attach(); return Promise.resolve({ jobId: 'job-1', status: 'ready', reference: owned }); }
    return Promise.resolve({ jobId: 'job-1', status: 'queued' });
  });
  await advance();
  expect(getEditorQuiz).toHaveBeenCalledTimes(3);
  expect(host.querySelector('[data-test-source]')?.getAttribute('data-test-source')).toBe(owned);
  expect(host.textContent).toContain('Uloženo na Disk'); expect(host.textContent).not.toContain('Nová verze');
  expect(host.innerHTML).not.toContain('drive.google.com');
});

it('rebases new typing over an imported source and saves using the fresh revision', async () => {
  await render(); await save(); await change('prompt', 'Nová neuložená formulace');
  vi.mocked(accessCall).mockResolvedValue({ jobId: 'job-1', status: 'ready', reference: owned }); attach();
  await advance();
  expect(getEditorQuiz).toHaveBeenCalledTimes(3);
  expect(host.querySelector<HTMLTextAreaElement>('[data-preflight-field="prompt"] textarea')?.value).toBe('Nová neuložená formulace');
  expect(host.querySelector('[data-test-source]')?.getAttribute('data-test-source')).toBe(owned);
  await click('Uložit vše');
  expect(host.textContent).not.toContain('Kvíz mezitím upravil někdo jiný');
  expect(host.querySelector<HTMLTextAreaElement>('[data-preflight-field="prompt"] textarea')?.value).toBe('Nová neuložená formulace');
  expect(server.slides[0]).toMatchObject({ mediaSource: owned, text: 'Nová neuložená formulace', clipStartSeconds: 0, clipEndSeconds: 10 });
  expect(vi.mocked(updateQuizSlide).mock.lastCall?.[1]).toBe(3);
});

it('does not overwrite typing that starts while the background reload is in flight', async () => {
  await render(); await save(); attach();
  let completeRead!: (value: EditorQuiz) => void;
  vi.mocked(getEditorQuiz).mockImplementationOnce(() => new Promise(resolve => { completeRead = resolve; }));
  vi.mocked(accessCall).mockResolvedValue({ jobId: 'job-1', status: 'ready', reference: owned }); await advance();
  await change('prompt', 'Rozepsáno během načítání');
  await act(async () => completeRead(structuredClone(server)));
  expect(host.querySelector<HTMLTextAreaElement>('[data-preflight-field="prompt"] textarea')?.value).toBe('Rozepsáno během načítání');
  expect(host.querySelector('[data-test-source]')?.getAttribute('data-test-source')).toBe(owned);
});

it('saves the next question draft after the previous YouTube question finishes importing', async () => {
  server = { ...server, slideCount: 2, questionCount: 2, slides: [slide(), { ...slide(), id: 'q2', position: 2, text: 'Druhá otázka',
    kind: 'free', storedKind: 'free', mediaSource: '', clipStartSeconds: null, clipEndSeconds: null }] };
  await render(); await save();
  const second = [...host.querySelectorAll<HTMLButtonElement>('.outline-question')].find(button => button.textContent?.includes('Druhá otázka'))!;
  await act(async () => second.click()); await change('prompt', 'Nově rozepsaná druhá otázka');
  server = { ...server, revision: server.revision + 1, slides: server.slides.map(item => item.id === 'q1'
    ? { ...item, mediaSource: owned, clipStartSeconds: 0, clipEndSeconds: 10 } : item) };
  vi.mocked(accessCall).mockResolvedValue({ jobId: 'job-1', status: 'ready', reference: owned }); await advance();
  expect(host.querySelector<HTMLTextAreaElement>('[data-preflight-field="prompt"] textarea')?.value).toBe('Nově rozepsaná druhá otázka');
  await click('Uložit vše');
  expect(server.slides.find(item => item.id === 'q1')?.mediaSource).toBe(owned);
  expect(server.slides.find(item => item.id === 'q2')?.text).toBe('Nově rozepsaná druhá otázka');
  expect(vi.mocked(updateQuizSlide).mock.lastCall?.[1]).toBe(3);
  expect(host.textContent).not.toContain('souběžnou změnu');
});

it('reads a fresh revision before saving when attachment finishes before the ready poll arrives', async () => {
  await render(); await save(); await change('prompt', 'Rozepsáno před oznámením'); attach();
  await click('Uložit vše');
  expect(server.slides[0]).toMatchObject({ text: 'Rozepsáno před oznámením', mediaSource: owned, clipStartSeconds: 0, clipEndSeconds: 10 });
  expect(vi.mocked(updateQuizSlide).mock.lastCall?.[1]).toBe(3);
});

it('retries one revision race only after rebasing the remaining local changes', async () => {
  await render(); await save(); await change('prompt', 'Rozepsáno během souběhu');
  vi.mocked(updateQuizSlide).mockImplementationOnce(() => { attach(); return Promise.reject(new Error('stale revision')); });
  await click('Uložit vše');
  expect(updateQuizSlide).toHaveBeenCalledTimes(3);
  expect(server.slides[0]).toMatchObject({ text: 'Rozepsáno během souběhu', mediaSource: owned, clipStartSeconds: 0, clipEndSeconds: 10 });
  expect(vi.mocked(updateQuizSlide).mock.lastCall?.[1]).toBe(3);
});

it('preserves and reports genuine overlapping prompt changes instead of replacing the server value', async () => {
  await render(); await save(); await change('prompt', 'Moje neuložené zadání'); attach();
  server = { ...server, slides: [{ ...server.slides[0]!, text: 'Souběžné cizí zadání' }] };
  vi.mocked(accessCall).mockResolvedValue({ jobId: 'job-1', status: 'ready', reference: owned }); await advance();
  expect(host.textContent).toContain('Stejné údaje mezitím změnil někdo jiný');
  await click('Uložit vše');
  expect(updateQuizSlide).toHaveBeenCalledTimes(1);
  expect(server.slides[0]?.text).toBe('Souběžné cizí zadání');
  expect(host.querySelector<HTMLTextAreaElement>('[data-preflight-field="prompt"] textarea')?.value).toBe('Moje neuložené zadání');
});

it('never applies an old-source time offset to the newly trimmed media', async () => {
  await render(); await save(); await change('clipStartSeconds', '0:07'); attach();
  vi.mocked(accessCall).mockResolvedValue({ jobId: 'job-1', status: 'ready', reference: owned }); await advance();
  expect(host.textContent).toContain('Stejné údaje mezitím změnil někdo jiný');
  await click('Uložit vše'); expect(updateQuizSlide).toHaveBeenCalledTimes(1);
  expect(server.slides[0]).toMatchObject({ mediaSource: owned, clipStartSeconds: 0, clipEndSeconds: 10 });
  expect(host.querySelector<HTMLInputElement>('[data-preflight-field="clipStartSeconds"] input')?.value).toBe('0:07');
});

it('retains drafts and reports a failed pre-save refresh without an unsafe stale write', async () => {
  await render(); await save(); await change('prompt', 'Rozepsáno při výpadku');
  vi.mocked(getEditorQuiz).mockRejectedValueOnce(new Error('offline'));
  await click('Uložit vše'); expect(updateQuizSlide).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Rozepsané hodnoty zůstaly v editoru');
  expect(host.querySelector<HTMLTextAreaElement>('[data-preflight-field="prompt"] textarea')?.value).toBe('Rozepsáno při výpadku');
  await click('Uložit vše'); expect(server.slides[0]?.text).toBe('Rozepsáno při výpadku');
});

it.each(['admin', 'permission', 'disconnected', 'disabled', 'save-failed'])('preserves normal save behavior when imports cannot run: %s', async reason => {
  if (reason === 'admin') auth.role = 'admin';
  if (reason === 'permission') auth.denied = ['users.manage'];
  if (reason === 'disconnected') vi.mocked(readDriveConnection).mockResolvedValue({ configured: true, status: 'folder-required' });
  if (reason === 'disabled') vi.mocked(readDriveConnection).mockResolvedValue({ configured: true, status: 'connected', folder: { id: 'folder', name: 'Média', url: '' } });
  if (reason === 'save-failed') vi.mocked(updateQuizSlide).mockRejectedValue(new Error('offline'));
  await render(); await save();
  expect(accessCall).not.toHaveBeenCalled();
  expect(updateQuizSlide).toHaveBeenCalledOnce();
  if (reason !== 'disconnected' && reason !== 'disabled') expect(readDriveConnection).not.toHaveBeenCalled();
  else {
    await change('prompt', 'Druhé uložení'); await click('Uložit vše');
    expect(readDriveConnection).toHaveBeenCalledOnce();
  }
});

it('offers safe retry of a failed saved import and never requests unsaved timing', async () => {
  vi.mocked(accessCall).mockResolvedValue({ jobId: 'job-1', status: 'failed', errorCode: 'PRIVATE_PROVIDER_DETAIL' });
  await render(); await save(); expect(host.textContent).toContain('Nepodařilo se uložit na Disk');
  expect(host.textContent).not.toContain('PRIVATE_PROVIDER_DETAIL');
  await change('clipStartSeconds', '0:07');
  expect(host.textContent).toContain('Nová verze se uloží na Disk po uložení změn');
  expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Zkusit znovu')).toBe(false);
  expect(accessCall).toHaveBeenCalledOnce();
});

it('retries a failed saved import without resaving the quiz', async () => {
  vi.mocked(accessCall).mockResolvedValueOnce({ jobId: 'job-1', status: 'failed' });
  await render(); await save(); await click('Zkusit znovu');
  expect(updateQuizSlide).toHaveBeenCalledOnce();
  expect(vi.mocked(accessCall).mock.calls.filter(call => call[0] === 'requestDriveMediaImport')).toHaveLength(2);
  expect(host.textContent).toContain('Ukládám na Disk'); expect(readDriveConnection).toHaveBeenCalledOnce();
});

it('ignores a late job completion after a newer source interval has been saved', async () => {
  let completeOld!: (value: unknown) => void;
  vi.mocked(accessCall).mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve; }));
  await render(); await save();
  await change('clipStartSeconds', '0:07'); await click('Uložit vše');
  const reads = vi.mocked(getEditorQuiz).mock.calls.length;
  await act(async () => completeOld({ jobId: 'old-job', status: 'ready', reference: owned }));
  expect(getEditorQuiz).toHaveBeenCalledTimes(reads);
  expect(host.textContent).toContain('Ukládám na Disk'); expect(host.textContent).not.toContain('Uloženo na Disk');
  expect(vi.mocked(updateQuizSlide).mock.lastCall?.[2].clipStartSeconds).toBe(7);
});

it('defers imports from partially acknowledged saves until the remaining changes save successfully', async () => {
  server = { ...server, slideCount: 2, questionCount: 2, slides: [slide(), { ...slide(), id: 'q2', position: 2, text: 'Druhé zadání' }] };
  const saveOperation = vi.mocked(updateQuizSlide).getMockImplementation()!;
  vi.mocked(updateQuizSlide).mockImplementationOnce(saveOperation).mockRejectedValueOnce(new Error('offline'));
  await render(); await change('prompt', 'První uložené zadání');
  const second = [...host.querySelectorAll<HTMLButtonElement>('.outline-question')].find(button => button.textContent?.includes('Druhé zadání'))!;
  await act(async () => second.click()); await change('prompt', 'Druhé uložené zadání'); await click('Uložit vše');
  expect(accessCall).not.toHaveBeenCalled(); expect(host.textContent).toContain('Část změn je uložená');
  await click('Uložit vše');
  const requests = vi.mocked(accessCall).mock.calls.filter(call => call[0] === 'requestDriveMediaImport');
  expect(requests.map(call => call[1]?.slideId).sort()).toEqual(['q1', 'q2']);
  expect(updateQuizSlide).toHaveBeenCalledTimes(3); expect(readDriveConnection).toHaveBeenCalledOnce();
});

it('imports only complete audio/video intervals and never imports images to Drive', () => {
  expect(driveImportCandidates({ ...slide(), clipEndSeconds: null })).toEqual([]);
  expect(driveImportCandidates({ ...slide(), mediaSource: owned, questionImage: owned, answerImage: 'javascript:alert(1)' })).toEqual([]);
  expect(driveImportCandidates({ ...slide(), mediaSource: owned, questionImage: owned, answerImage: 'javascript:alert(1)' })).toEqual([]);
  expect(driveImportCandidates({ ...slide(), kind: 'image', mediaSource: 'https://example.test/photo.jpg', questionImage: 'https://example.test/photo.jpg' })).toEqual([]);
  expect(driveImportCandidates({ ...slide(), kind: 'audio', questionImage: 'https://example.test/photo.jpg', answerImage: 'https://example.test/answer.png', backgroundImage: 'https://example.test/bg.webp' }))
    .toEqual(['mediaSource']);
});

it('uses the actual callable contract and rejects unsafe provider references', async () => {
  const target = { quizId: 'quiz', slideId: 'q1', field: 'mediaSource' as const };
  vi.mocked(accessCall).mockResolvedValue({ jobId: 'job-1', status: 'ready', reference: 'https://drive.google.com/private?token=secret' });
  await expect(requestDriveMediaImport(target)).rejects.toThrow('Neplatný stav');
  vi.mocked(accessCall).mockResolvedValue({ jobId: 'job-1', status: 'processing' });
  await expect(readDriveMediaImport(target, 'job-1')).resolves.toEqual({ jobId: 'job-1', status: 'processing' });
  expect(accessCall).toHaveBeenLastCalledWith('readDriveMediaImport', { ...target, jobId: 'job-1' });
});
