// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SlideRenderer } from '../apps/web/src/features/presentation/SlideRenderer';
import { quizMediaBlobCache } from '../apps/web/src/features/media/mediaBlobCache';

vi.mock('../apps/web/src/services/firebase/app', () => ({ getFirebaseAppContext: () => ({ config: { useEmulators: true, options: { projectId: 'demo-public-media-reuse' } } }) }));
vi.mock('../apps/web/src/services/firebase/auth', () => ({ getFirebaseAuth: vi.fn(() => { throw new Error('Public media must not request private identity'); }) }));
vi.mock('../apps/web/src/services/firebase/client', () => ({ getFirebaseServices: vi.fn() }));
vi.mock('../apps/web/src/features/access/api', () => ({ privateRead: vi.fn() }));

const background = 'quiz-asset:quiz-1/' + 'a'.repeat(64);
const answer = 'quiz-asset:quiz-1/' + 'b'.repeat(64);
const http = vi.fn<typeof fetch>(), revoke = vi.fn<(url: string) => void>();
let root: Root, host: HTMLDivElement, urlSequence: number;

beforeEach(() => {
  quizMediaBlobCache.clear(); vi.clearAllMocks(); urlSequence = 0;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', http);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:public-image-' + ++urlSequence);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); quizMediaBlobCache.clear();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const show = (number: number, sessionId = 'public-session', reveal = false) => act(async () => {
  root.render(<SlideRenderer quizTitle="Synthetic public quiz" mediaSessionId={sessionId} mode={reveal ? 'recap' : 'question'}
    slide={{ kind: 'free', title: '', text: 'Synthetic question ' + number, options: [], media: [], backgroundImage: background,
      answerImage: answer, ...(reveal ? { revealedAnswer: 'Explicitly revealed answer' } : {}) }} />);
});
const requestedReference = (request: RequestInfo | URL) => new URL(typeof request === 'string' ? request : request instanceof URL ? request.href : request.url).searchParams.get('reference');

test('normal public question and reveal updates retain the same background without another request', async () => {
  http.mockImplementation(async () => new Response('image', { headers: { 'Content-Type': 'image/png', ETag: '"image-v1"' } }));
  await show(1);
  const image = host.querySelector('.slide-background img')!;
  expect(image).not.toBeNull(); expect(http).toHaveBeenCalledOnce();
  const url = image.getAttribute('src');
  await show(2); await show(3);
  expect(host.querySelector('.slide-background img')).toBe(image);
  expect(image.getAttribute('src')).toBe(url); expect(http).toHaveBeenCalledOnce();
  expect(requestedReference(http.mock.calls[0]![0])).toBe(background);
  await show(3, 'public-session', true);
  expect(host.querySelector('.slide-background img')).toBe(image);
  expect(http).toHaveBeenCalledTimes(2);
  expect(requestedReference(http.mock.calls[1]![0])).toBe(answer);
  expect(revoke).not.toHaveBeenCalled();
});

test('public remount waits for current gateway authorization and keeps retained bytes isolated by session', async () => {
  http.mockResolvedValueOnce(new Response('background', { headers: { 'Content-Type': 'image/png', ETag: '"background-v1"' } }));
  await show(1);
  await act(async () => root.render(null));
  let finish!: (response: Response) => void;
  http.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await show(2);
  expect(host.querySelector('.slide-background img')).toBeNull();
  expect(http.mock.calls[1]![1]?.headers).toEqual({ 'If-None-Match': '"background-v1"' });
  await act(async () => finish(new Response(null, { status: 304 })));
  expect(host.querySelector('.slide-background img')).not.toBeNull();
  await act(async () => root.render(null));
  http.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await show(3);
  expect(host.querySelector('.slide-background img')).toBeNull();
  expect(http.mock.calls[2]![1]?.headers).toEqual({ 'If-None-Match': '"background-v1"' });
  await act(async () => finish(new Response(null, { status: 403 })));
  expect(host.querySelector('.slide-background img')).toBeNull();
  expect(host.textContent).toContain('Obrázek není dostupný');
  http.mockResolvedValueOnce(new Response('other session', { headers: { 'Content-Type': 'image/png', ETag: '"background-v1"' } }));
  await show(4, 'different-session');
  expect(http.mock.calls[3]![1]?.headers).toEqual({});
  expect(host.querySelector('.slide-background img')).not.toBeNull();
});

test('a cold public background still waits for the complete delayed gateway response', async () => {
  vi.useFakeTimers();
  http.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(new Response('background', {
    headers: { 'Content-Type': 'image/png', ETag: '"background-v1"' },
  })), 3500)));
  await show(1); expect(host.querySelector('.slide-background img')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(3499); });
  expect(host.querySelector('.slide-background img')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(host.querySelector('.slide-background img')).not.toBeNull();
  expect(http).toHaveBeenCalledOnce();
});
