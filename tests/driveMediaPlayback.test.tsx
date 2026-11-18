// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mapEditorSlide, validOwnedMedia, validateQuestion } from '../packages/quiz-domain/src/index';
import { assertQuizAssets, mediaSignature, publicMediaAllowed } from '../functions/src/media/model';
import { applyKnownSlideUpdate } from '../functions/src/editor/model';
import { validateSlideInput } from '../functions/src/editor/validation';
import { MediaPlayer } from '../apps/web/src/features/presentation/MediaPlayer';
import { SlideRenderer } from '../apps/web/src/features/presentation/SlideRenderer';
import { AssetImage } from '../apps/web/src/features/media/AssetImage';
import { LocalProjectorMediaContext } from '../apps/web/src/features/media/LocalProjectorMediaContext';
import type { PublicLiveState } from '../apps/web/src/features/live/types';
import { quizMediaReadFailure, readQuizMediaBlob, uploadQuizMedia } from '../apps/web/src/features/media/mediaApi';
import { MediaBlobCache, quizMediaBlobCache } from '../apps/web/src/features/media/mediaBlobCache';
import { getFirebaseServices } from '../apps/web/src/services/firebase/client';

vi.mock('../apps/web/src/services/firebase/app', () => ({
  getFirebaseAppContext: () => ({
    app: { options: { projectId: 'demo-media-video' } },
    config: { useEmulators: true, options: { projectId: 'demo-media-video' } },
  }),
}));
const mediaIdentity = vi.hoisted(() => ({ token: 'synthetic-firebase-token' }));
vi.mock('../apps/web/src/services/firebase/auth', () => ({ getFirebaseAuth: () => ({ currentUser: { getIdToken: () => Promise.resolve(mediaIdentity.token) } }) }));
vi.mock('../apps/web/src/services/firebase/client', () => ({ getFirebaseServices: vi.fn() }));
vi.mock('../apps/web/src/features/access/api', () => ({ privateRead: vi.fn() }));
const source = 'quiz-asset:quiz-1/' + 'a'.repeat(64), other = 'quiz-asset:quiz-1/' + 'b'.repeat(64);
const maxSize = 25 * 1024 * 1024;
const http = vi.fn<typeof fetch>(), onError = vi.fn(), onPlaybackState = vi.fn(), onFinished = vi.fn();
const play = vi.fn<() => Promise<void>>(), revoke = vi.fn(), pause = vi.fn<() => void>();
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  quizMediaBlobCache.clear();
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', http);
  vi.stubGlobal('React', React);
  window.__FILMOVY_KVIZ_MEDIA_DEBUG__ = undefined;
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-media');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(8);
  play.mockResolvedValue(); vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  quizMediaBlobCache.clear(); vi.useRealTimers();
  await act(async () => { root.unmount(); await Promise.resolve(); }); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const render = (command: 'idle' | 'play' | 'stop' | 'replay', generation = 1, reference = source) => act(async () => {
  root.render(<MediaPlayer source={reference} sessionId="session-1" command={command} generation={generation} startSeconds={1} endSeconds={3}
    onError={onError} onPlaybackState={onPlaybackState} onFinished={onFinished} />);
  await Promise.resolve();
});
const emit = (element: HTMLMediaElement, name: string) => act(async () => { element.dispatchEvent(new Event(name)); await Promise.resolve(); });

it('accepts only MP4 video within 25 MiB and leaves image/audio MIME separation intact', () => {
  expect(validOwnedMedia('video', 'video/mp4', maxSize)).toBe(true);
  for (const [kind, mime, size] of [['video', 'video/mp4', maxSize + 1], ['video', 'video/webm', 20], ['video', 'audio/mpeg', 20],
    ['audio', 'video/mp4', 20], ['image', 'video/mp4', 20], ['video', 'video/mp4', 0]]) expect(validOwnedMedia(kind, mime, size)).toBe(false);
  const mp4 = Buffer.alloc(32); mp4.writeUInt32BE(24, 0); mp4.write('ftyp', 4); mp4.write('isom', 8); mp4.write('mp42', 16); mp4.write('isom', 20);
  expect(mediaSignature(mp4, 'video/mp4')).toBe(true);
  for (const bytes of [Buffer.from('<html>not video</html>'), mp4.subarray(0, 20), Buffer.from(mp4)]) {
    if (bytes.length === 32) bytes.writeUInt32BE(4096, 0);
    expect(mediaSignature(bytes, 'video/mp4')).toBe(false);
  }
  const wrongBrand = Buffer.from(mp4); wrongBrand.write('qt  ', 8); wrongBrand.write('qt  ', 16); wrongBrand.write('qt  ', 20);
  expect(mediaSignature(wrongBrand, 'video/mp4')).toBe(false);
});

it('permits ready video only in normalized video roles and checks kind, quiz, status and size', async () => {
  let data: Record<string, unknown> = { quizId: 'quiz-1', kind: 'video', status: 'ready', contentType: 'video/mp4', size: 20,
    generation: 'drive:' + 'c'.repeat(64), storageBackend: 'drive', drive: { ownerUid: 'owner', connectionGeneration: 1, file: { id: 'synthetic-private-id' } } };
  const transaction = { get: () => Promise.resolve({ data: () => data }) } as unknown as Parameters<typeof assertQuizAssets>[0];
  const db = { doc: (path: string) => path } as unknown as Parameters<typeof assertQuizAssets>[1];
  const bind = (slides: Record<string, unknown>[]) => assertQuizAssets(transaction, db, 'quiz-1', slides);
  for (const kind of ['video', 'youtube']) await expect(bind([{ kind, mediaSource: source }])).resolves.toBeUndefined();
  for (const slide of [{ kind: 'audio', mediaSource: source }, { kind: 'video', questionImage: source },
    { kind: 'video', mediaSource: source.replace('quiz-1', 'foreign') }, { kind: 'video', media: [{ source }] }]) await expect(bind([slide])).rejects.toThrow();
  for (const patch of [{ status: 'processing' }, { kind: 'audio' }, { size: maxSize + 1 }, { quizId: 'foreign' }]) {
    const previous = data; data = { ...data, ...patch }; await expect(bind([{ kind: 'video', mediaSource: source }])).rejects.toThrow(); data = previous;
  }
  await expect(bind([{ kind: 'video', mediaSource: source }, { kind: 'image', answerImage: source }])).rejects.toThrow();
});

it('accepts an owned video source in editor and readiness while retaining explicit clip timing', () => {
  const stored = { kind: 'video', position: 1, isQuestion: true, title: '', text: 'Syntetická otázka', correctAnswer: 'Soukromá odpověď',
    options: [], media: [], mediaSource: 'https://example.test/old.mp4', clipStartSeconds: 0, clipEndSeconds: 3, presentation: {} };
  const view = mapEditorSlide('slide-1', stored);
  const saved = applyKnownSlideUpdate(stored, validateSlideInput({ ...view, mediaSource: source, clipStartSeconds: 1, clipEndSeconds: 3 }));
  expect(saved.mediaSource).toBe(source); expect(validateQuestion(mapEditorSlide('slide-1', saved))).toEqual([]);
  expect(() => applyKnownSlideUpdate(stored, validateSlideInput({ ...view, mediaSource: source, clipStartSeconds: null, clipEndSeconds: null }))).toThrow(/začátek/);
});

it('authorizes only the currently published video and keeps private answers/audio protected', () => {
  const publication = { status: 'active', slideKind: 'video', renderMode: 'question', mediaSource: source, answerImage: other, answerRevealed: false };
  for (const renderMode of ['question', 'recap']) expect(publicMediaAllowed({ ...publication, renderMode }, source, 'video')).toBe(true);
  for (const patch of [{ mediaSource: other }, { mediaSource: undefined }, { status: 'ended' }, { status: 'waiting' }, { interimResults: {} },
    { finalReveal: {} }, { renderMode: 'roundIntro' }, { slideKind: 'audio' }, { slideKind: 'image' }]) expect(publicMediaAllowed({ ...publication, ...patch }, source, 'video')).toBe(false);
  expect(publicMediaAllowed(publication, source, 'audio')).toBe(false);
  expect(publicMediaAllowed(publication, other, 'image')).toBe(false);
  expect(publicMediaAllowed({ ...publication, answerRevealed: true }, other, 'image')).toBe(true);
  expect(publicMediaAllowed({ ...publication, slideKind: 'audio' }, source, 'audio')).toBe(false);
});

it.each([['video/mp4', 'video'], ['audio/mpeg', 'audio'], ['audio/wav', 'audio']])('renders gateway MIME %s using native %s without a Drive URL', async (mime, element) => {
  http.mockImplementation(() => Promise.resolve(new Response('synthetic-media-bytes', { headers: { 'Content-Type': mime } })));
  await render('idle'); const player = host.querySelector<HTMLMediaElement>(element)!;
  expect(player).not.toBeNull(); expect(host.querySelector(element === 'audio' ? 'video' : 'audio')).toBeNull();
  expect(player.src).toBe('blob:synthetic-media'); expect(player.controls).toBe(false);
  expect(host.querySelector('iframe')).toBeNull();
  await emit(player, 'loadedmetadata'); expect(player.currentTime).toBe(1); expect(play).not.toHaveBeenCalled();
  await render('play', 2); const playing = host.querySelector<HTMLMediaElement>(element)!;
  await emit(playing, 'loadedmetadata'); await emit(playing, 'playing');
  expect(onPlaybackState).toHaveBeenLastCalledWith(2, 'playing');
  playing.currentTime = 3; await emit(playing, 'timeupdate'); expect(onFinished).toHaveBeenCalledExactlyOnceWith(2);
  await render('stop', 3, other); expect(playing.isConnected).toBe(false); expect(revoke).toHaveBeenCalled();
  expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__?.peakPlayers).toBe(1);
  const [url, request] = http.mock.calls[0]!;
  const requestedUrl = url instanceof URL ? url.href : typeof url === 'string' ? url : url.url;
  expect(requestedUrl).toContain('127.0.0.1:5001/demo-media-video/'); expect(requestedUrl).toContain('sessionId=session-1');
  expect(request?.headers).toEqual({}); expect(host.innerHTML).not.toContain('drive.google.com');
});

it.each(['video', 'audio'])('keeps the owned %s clip through question, reveal and replay despite an available original YouTube link', async kind => {
  http.mockImplementation(() => Promise.resolve(new Response('synthetic-media-bytes', { headers: { 'Content-Type': kind === 'video' ? 'video/mp4' : 'audio/mpeg' } })));
  const slide = { kind, title: 'Syntetická ukázka', text: 'Otázka', options: [], media: [], mediaSource: source,
    originalMediaSource: 'https://www.youtube.com/watch?v=abcdefghijk', clipStartSeconds: 0, clipEndSeconds: 8 };
  let generation = 0;
  for (const reveal of [false, true]) {
    for (const command of ['play', 'stop', 'replay'] as const) {
      await act(async () => {
        root.render(<SlideRenderer playPrivateAudio quizTitle="Zkouška" slide={{ ...slide, ...(reveal ? { revealedAnswer: 'Odpověď' } : {}) }}
          mode={reveal ? 'recap' : 'question'} mediaCommand={command} mediaGeneration={++generation} />);
        await Promise.resolve();
      });
      const player = host.querySelector<HTMLMediaElement>(kind)!;
      expect(player).not.toBeNull();
      await emit(player, 'loadedmetadata');
      expect(player.src).toBe('blob:synthetic-media');
      expect(host.querySelector('iframe')).toBeNull();
      expect(document.querySelector('script[data-filmovy-kviz-youtube-api]')).toBeNull();
    }
  }
  expect(http.mock.calls.every(([url]) => (url instanceof URL ? url.href : typeof url === 'string' ? url : url.url).includes('readQuizMedia'))).toBe(true);
});

it('rejects unsupported MIME and declared oversize before creating a player', async () => {
  const cases: Record<string, string>[] = [{ 'Content-Type': 'text/html' }, { 'Content-Type': 'video/mp4', 'Content-Length': String(maxSize + 1) }];
  for (const headers of cases) {
    http.mockResolvedValueOnce(new Response('bad', { headers }));
    await expect(readQuizMediaBlob(source, new AbortController().signal, 'session-1')).rejects.toThrow();
  }
  http.mockResolvedValue(new Response('not-native-media', { headers: { 'Content-Type': 'image/png' } }));
  await render('play'); expect(host.querySelector('video,audio')).toBeNull(); expect(onError).toHaveBeenCalledOnce();
});

it('enforces the byte limit on chunked data without trusting Content-Length', async () => {
  const cancel = vi.fn(), chunk = new Uint8Array(1024 * 1024); let count = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { count++; controller.enqueue(chunk); }, cancel });
  http.mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'video/mp4' } }));
  await expect(readQuizMediaBlob(source, new AbortController().signal, 'session-1')).rejects.toThrow(/velikost/);
  expect(cancel).toHaveBeenCalledOnce(); expect(count).toBeLessThanOrEqual(27);
});

it.each([
  [401, 'access-denied'], [403, 'access-denied'], [404, 'not-found'],
  [429, 'gateway-throttled'], [500, 'gateway-error'], [501, 'gateway-error'],
  [502, 'gateway-unavailable'], [503, 'gateway-unavailable'], [504, 'gateway-unavailable'],
])('classifies the managed media response HTTP %d without reading its error body', async (status, expected) => {
  const response = new Response('synthetic server details', { status });
  http.mockResolvedValueOnce(response);
  await expect(readQuizMediaBlob(source, new AbortController().signal, 'session-1').catch(quizMediaReadFailure)).resolves.toBe(expected);
  expect(response.bodyUsed).toBe(false);
  expect(http).toHaveBeenCalledOnce();
});

it('distinguishes failed managed media transfer from a browser-reported offline state', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const read = () => readQuizMediaBlob(source, new AbortController().signal, 'session-1').catch(quizMediaReadFailure);
  http.mockRejectedValueOnce(new TypeError('synthetic fetch rejection'));
  await expect(read()).resolves.toBe('network-error');

  const interrupted = new ReadableStream({ start(controller) { controller.error(new TypeError('synthetic interrupted stream')); } });
  http.mockResolvedValueOnce(new Response(interrupted, { headers: { 'Content-Type': 'image/png' } }));
  await expect(read()).resolves.toBe('network-error');

  online.mockReturnValue(false);
  http.mockRejectedValueOnce(new TypeError('synthetic fetch rejection while offline'));
  await expect(read()).resolves.toBe('offline');
  expect(http).toHaveBeenCalledTimes(3);
});

it('keeps the headers mark when a managed image body stalls and then fails', async () => {
  let breakTransfer = () => {};
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    breakTransfer = () => controller.error(new TypeError('synthetic interrupted stream'));
  } });
  http.mockResolvedValueOnce(new Response(body, { headers: { 'Content-Type': 'image/png' } }));
  const observe = vi.fn();
  const result = readQuizMediaBlob(source, new AbortController().signal, 'session-1', undefined, observe).catch(quizMediaReadFailure);
  await vi.waitFor(() => expect(observe.mock.calls).toEqual([['asset-request'], ['asset-headers']]));
  breakTransfer();
  await expect(result).resolves.toBe('network-error');
  expect(observe.mock.calls).toEqual([['asset-request'], ['asset-headers']]);
});

it.each([[true, 'load-failed'], [false, 'offline']])('reports a failed external image when online is %s without probing its URL', async (online, reason) => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  const observation = vi.fn(), resolved = vi.fn();
  await act(async () => {
    root.render(<AssetImage source="https://example.test/prompt.png" alt="Syntetický obrázek"
      onDiagnostic={observation} onDiagnosticResolved={resolved} />);
  });
  await act(async () => { host.querySelector('img')!.dispatchEvent(new Event('error')); });
  expect(observation).toHaveBeenCalledExactlyOnceWith(reason);
  expect(host.textContent).toContain('Obrázek není dostupný.');
  expect(host.textContent).not.toContain(reason);
  expect(resolved).not.toHaveBeenCalled();
  await act(async () => { host.querySelector('button')!.click(); });
  expect(resolved).toHaveBeenCalledOnce();
  await act(async () => { host.querySelector('img')!.dispatchEvent(new Event('load')); });
  expect(resolved).toHaveBeenCalledTimes(2);
  expect(http).not.toHaveBeenCalled();
});

it('reports a still-failed owned image on the next display generation without fetching it again', async () => {
  const diagnostics = vi.fn();
  const show = (generation: number) => act(async () => {
    root.render(<AssetImage source={source} sessionId="session-1" alt="Syntetické pozadí" diagnosticGeneration={generation}
      onDiagnostic={reason => { diagnostics(generation, reason); }} />);
  });

  http.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await show(1);
  await show(2);
  await show(2);
  expect(diagnostics.mock.calls).toEqual([[1, 'gateway-unavailable'], [2, 'gateway-unavailable']]);
  expect(http).toHaveBeenCalledOnce();

  http.mockResolvedValueOnce(new Response('fresh-image', { headers: { 'Content-Type': 'image/png' } }));
  await act(async () => { host.querySelector('button')!.click(); });
  await act(async () => { host.querySelector('img')!.dispatchEvent(new Event('load')); });
  await show(3);
  expect(diagnostics).toHaveBeenCalledTimes(2);
  expect(http).toHaveBeenCalledTimes(2);
});

it('keeps the displayed online question image across public revisions of the same session and asset', async () => {
  const state: PublicLiveState = {
    sessionId: 'session-1', quizTitle: 'Zkouška', status: 'active', slidePosition: 1, slideKind: 'image',
    options: [], media: [], presentation: {}, questionImage: source, presentationMode: 'slide', renderMode: 'question',
    mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 1, introGeneration: 0, answerRevealed: false, revision: 1,
  };
  const show = (value: PublicLiveState, reference: string) => act(async () => {
    root.render(<LocalProjectorMediaContext.Provider value={value}>
      <AssetImage source={reference} sessionId={value.sessionId} alt="Syntetická otázka" mediaRole="question-image"
        diagnosticGeneration={value.revision} />
    </LocalProjectorMediaContext.Provider>);
  });
  http.mockImplementation(() => Promise.resolve(new Response('synthetic-image', { headers: { 'Content-Type': 'image/png' } })));

  await show(state, source);
  const originalImage = host.querySelector('img')!;
  expect(originalImage).not.toBeNull();
  expect(http).toHaveBeenCalledOnce();

  await show({ ...state, revision: 2, answerRevealed: true, revealedAnswer: 'Syntetická odpověď' }, source);
  expect(http).toHaveBeenCalledOnce();
  expect(host.querySelector('img')).toBe(originalImage);
  expect(revoke).not.toHaveBeenCalled();

  await show({ ...state, revision: 3, questionImage: other }, other);
  expect(http).toHaveBeenCalledTimes(2);
  expect(originalImage.isConnected).toBe(false);
  const replacement = host.querySelector('img')!;
  expect(replacement).not.toBeNull();

  await show({ ...state, sessionId: 'session-2', questionImage: other }, other);
  expect(http).toHaveBeenCalledTimes(3);
  expect(replacement.isConnected).toBe(false);
  expect(host.querySelector('img')).not.toBeNull();
});

it('rejects an unsupported WebM upload before opening Firebase services', async () => {
  const progress = vi.fn();
  await expect(uploadQuizMedia('quiz-1', 'video', new File(['synthetic'], 'video.webm', { type: 'video/webm' }),
    { signal: new AbortController().signal, onProgress: progress })).rejects.toThrow(/MP4 do 25 MiB/u);
  expect(getFirebaseServices).not.toHaveBeenCalled();
  expect(progress).not.toHaveBeenCalled();
  expect(http).not.toHaveBeenCalled();
});

it('pays one delayed media transfer, then play/stop/replay reuse the prepared player immediately', async () => {
  vi.useFakeTimers();
  http.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(new Response('synthetic', { headers: { 'Content-Type': 'video/mp4', ETag: '"version-1"' } })), 3500)));
  await render('idle'); expect(host.querySelector('video')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
  const player = host.querySelector('video')!; await emit(player, 'loadedmetadata');
  const preparedAt = Date.now();
  await render('play', 2); expect(play).toHaveBeenCalledOnce();
  await emit(player, 'playing');
  const stalePlaying = player.onplaying!;
  await render('stop', 3);
  onPlaybackState.mockClear();
  const pauses = pause.mock.calls.length;
  await act(async () => { stalePlaying.call(player, new Event('playing')); });
  expect(pause).toHaveBeenCalledTimes(pauses);
  expect(onPlaybackState).not.toHaveBeenCalled(); expect(player.controls).toBe(false);
  await render('replay', 4);
  expect(Date.now() - preparedAt).toBe(0); expect(play).toHaveBeenCalledTimes(2);
  expect(host.querySelector('video')).toBe(player); expect(http).toHaveBeenCalledOnce();
  expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__).toMatchObject({ activePlayers: 1, createdPlayers: 1, destroyedPlayers: 0 });
});

it('revalidates cached bytes through the gateway and never serves a denied cached answer', async () => {
  http.mockResolvedValueOnce(new Response('synthetic', { headers: { 'Content-Type': 'image/png', ETag: '"image-v1"' } }));
  const read = (sessionId = 'current-session') => readQuizMediaBlob(source, new AbortController().signal, sessionId);
  const original = await read();
  http.mockResolvedValueOnce(new Response(null, { status: 304 }));
  expect(await read()).toBe(original);
  expect(http.mock.calls[1]![1]?.headers).toEqual({ 'If-None-Match': '"image-v1"' });
  http.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(read()).rejects.toThrow(/dostupné/);
  http.mockResolvedValueOnce(new Response('fresh', { headers: { 'Content-Type': 'image/png', ETag: '"image-v1"' } }));
  expect(await read()).not.toBe(original);
  expect(http.mock.calls[3]![1]?.headers).toEqual({});
  http.mockResolvedValueOnce(new Response('separate', { headers: { 'Content-Type': 'image/png', ETag: '"image-v1"' } }));
  await read('different-session'); expect(http.mock.calls[4]![1]?.headers).toEqual({});
});

it('deduplicates simultaneous current-media reads while cancelling each subscriber independently', async () => {
  let resolve!: (response: Response) => void;
  http.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const firstAbort = new AbortController(), secondAbort = new AbortController();
  const first = readQuizMediaBlob(source, firstAbort.signal, 'same-session');
  const denied = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  const second = readQuizMediaBlob(source, secondAbort.signal, 'same-session');
  await Promise.resolve();
  expect(http).toHaveBeenCalledOnce(); firstAbort.abort();
  expect(http.mock.calls[0]![1]?.signal?.aborted).toBe(false);
  resolve(new Response('shared', { headers: { 'Content-Type': 'audio/mpeg' } }));
  await denied; expect((await second).size).toBe(6);
});

it('bounds retained media by bytes, entry count and age and clears pending loads on access changes', async () => {
  vi.useFakeTimers();
  const cache = new MediaBlobCache(6, 2, 1000), observed: (Blob | undefined)[] = [];
  const load = async (key: string) => cache.read(key, new AbortController().signal, async cached => {
    observed.push(cached?.blob); return { blob: new Blob(['abc']), etag: '"v1"' };
  });
  await load('one'); await load('two'); await load('three'); await load('one');
  expect(observed).toEqual([undefined, undefined, undefined, undefined]);
  await load('one'); expect(observed.at(-1)?.size).toBe(3);
  await vi.advanceTimersByTimeAsync(1000); await load('one'); expect(observed.at(-1)).toBeUndefined();
  let pendingSignal: AbortSignal | undefined, complete!: () => void;
  const pending = cache.read('pending', new AbortController().signal, async (_cached, signal) => {
    pendingSignal = signal;
    await new Promise<void>(resolve => { complete = resolve; });
    return { blob: new Blob(['abc']), etag: '"v1"' };
  });
  const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.resolve(); cache.clear(); expect(pendingSignal?.aborted).toBe(true); complete(); await cancelled;
});


it('pins image cache URLs within one credential/session epoch and rotates the namespace on access invalidation', async () => {
  const pin = 'a'.repeat(64);
  http.mockImplementation(async () => new Response('synthetic', { headers: { 'Content-Type': 'image/png',
    ETag: '"' + pin + '"', 'Cache-Control': 'private,max-age=31536000,immutable' } }));
  const read = (session = 'pin-session') => readQuizMediaBlob(source, new AbortController().signal, session);
  await read(); await read();
  const url = (index: number) => { const input = http.mock.calls[index]![0]; return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url); };
  expect(url(0).searchParams.has('pin')).toBe(false);
  expect(url(1).searchParams.get('pin')).toBe(pin);
  expect(url(1).searchParams.get('cacheScope')).toBe(url(0).searchParams.get('cacheScope'));
  expect(http.mock.calls[1]![1]?.headers).toEqual({});
  expect(http.mock.calls[1]![1]?.cache).toBe('default');
  await read('other-pin-session');
  expect(url(2).searchParams.get('cacheScope')).not.toBe(url(0).searchParams.get('cacheScope'));
  quizMediaBlobCache.clear(); await read();
  expect(url(3).searchParams.get('cacheScope')).not.toBe(url(0).searchParams.get('cacheScope'));
  expect(url(3).searchParams.has('pin')).toBe(false);
});


it('a new private credential cannot reuse an old account image namespace or pin', async () => {
  const pin = 'b'.repeat(64);
  http.mockImplementation(async () => new Response('synthetic', { headers: { 'Content-Type': 'image/png',
    ETag: '"' + pin + '"', 'Cache-Control': 'private,max-age=31536000,immutable' } }));
  const read = () => readQuizMediaBlob(source, new AbortController().signal);
  try {
    await read(); await read();
    mediaIdentity.token = 'synthetic-other-account-token'; await read();
    const requested = http.mock.calls.map(([input]) => new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url));
    expect(requested[1]!.searchParams.get('pin')).toBe(pin);
    expect(requested[2]!.searchParams.get('cacheScope')).not.toBe(requested[0]!.searchParams.get('cacheScope'));
    expect(requested[2]!.searchParams.has('pin')).toBe(false);
    expect(requested.every(url => !url.href.includes('synthetic-firebase-token') && !url.href.includes('synthetic-other-account-token'))).toBe(true);
  } finally { mediaIdentity.token = 'synthetic-firebase-token'; }
});
