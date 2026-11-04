// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MediaPlayer } from '../apps/web/src/features/presentation/MediaPlayer';
import { AssetImage } from '../apps/web/src/features/media/AssetImage';
import { readQuizMediaBlob } from '../apps/web/src/features/media/mediaApi';
import { mapEditorQuiz, mapEditorSlide, type EditorQuiz } from '../packages/quiz-domain/src/index';
import { nextPrivateLiveMediaReferences, nextPrivateMediaReferences, usePrivateMediaPrefetch } from '../apps/web/src/features/media/usePrivateMediaPrefetch';
import { mapLiveControlSlide } from '../apps/web/src/features/live/liveMappers';
import { quizMediaBlobCache } from '../apps/web/src/features/media/mediaBlobCache';
import { SlideRenderer } from '../apps/web/src/features/presentation/SlideRenderer';
import { SnapshotMediaContext } from '../apps/web/src/features/media/SnapshotMediaContext';
vi.mock('../apps/web/src/features/media/mediaApi', () => ({readQuizMediaBlob:vi.fn()}));
const source='quiz-asset:quiz-1/'+'a'.repeat(64), nextSource='quiz-asset:quiz-1/'+'b'.repeat(64);
let root:Root,host:HTMLDivElement;
const playMock=vi.fn<()=>Promise<void>>(), revokeMock=vi.fn();
const playback=vi.fn(),finished=vi.fn(),failed=vi.fn();
const render=(command:'idle'|'play'|'replay'|'stop',generation=1,reference=source)=>act(async()=>root.render(<MediaPlayer source={reference} command={command} generation={generation} startSeconds={1} endSeconds={3} onPlaybackState={playback} onFinished={finished} onError={failed}/>));
const event=async(player:HTMLAudioElement,name:string)=>act(async()=>{player.dispatchEvent(new Event(name));});
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});window.__FILMOVY_KVIZ_MEDIA_DEBUG__=undefined;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  vi.mocked(readQuizMediaBlob).mockResolvedValue(new Blob(['synthetic'],{type:'audio/wav'}));
  vi.spyOn(URL,'createObjectURL').mockImplementation(()=> 'blob:synthetic-'+Math.random());
  vi.spyOn(URL,'revokeObjectURL').mockImplementation(revokeMock);
  vi.spyOn(HTMLMediaElement.prototype,'duration','get').mockReturnValue(4);
  playMock.mockResolvedValue();vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(playMock);
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks();});
test('manual start, END and replay share a single player; late callbacks cannot affect new generation',async()=>{
  await render('idle');const idle=host.querySelector('audio')!;await event(idle,'loadedmetadata');
  expect(playMock).not.toHaveBeenCalled();expect(idle.controls).toBe(false);
  await render('play',2);const playing=host.querySelector('audio')!;await event(playing,'loadedmetadata');await event(playing,'playing');
  expect(playing.currentTime).toBe(1);expect(playback).toHaveBeenLastCalledWith(2,'playing');
  playing.currentTime=3;await event(playing,'timeupdate');await event(playing,'pause');expect(finished).toHaveBeenCalledExactlyOnceWith(2);
  await render('replay',3);await event(playing,'ended');expect(finished).toHaveBeenCalledTimes(1);
  const replay=host.querySelector('audio')!;await event(replay,'loadedmetadata');
  expect(replay.currentTime).toBe(1);expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__?.peakPlayers).toBe(1);
  await render('stop',4);expect(replay.isConnected).toBe(true);expect(replay).toBe(idle);
  expect(replay.controls).toBe(false);expect(revokeMock).not.toHaveBeenCalled();
  expect(readQuizMediaBlob).toHaveBeenCalledOnce();
  expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__?.createdPlayers).toBe(1);
});
test('error during playback stays terminal after queued native pause/metadata/playing',async()=>{
  await render('play');const player=host.querySelector('audio')!;await event(player,'loadedmetadata');await event(player,'playing');
  playback.mockClear();await event(player,'error');await event(player,'pause');await event(player,'playing');await event(player,'loadedmetadata');
  expect(failed).toHaveBeenCalledOnce();expect(playback).not.toHaveBeenCalled();
  expect(host.querySelector('[data-media-lifecycle="ERROR"]')).not.toBeNull();
});

test.each([
  ['direct audio', 'https://example.test/retry.wav', 'audio/wav', 'audio'],
  ['direct video', 'https://example.test/retry.mp4', 'video/mp4', 'video'],
  ['owned audio', source, 'audio/wav', 'audio'],
] as const)('explicit replay replaces a failed native resource: %s',async(_label,reference,mime,kind)=>{
  vi.mocked(readQuizMediaBlob).mockResolvedValue(new Blob(['synthetic'],{type:mime}));
  await render('play',1,reference);
  const broken=host.querySelector<HTMLMediaElement>(kind)!;
  const staleMetadata=broken.onloadedmetadata,stalePlaying=broken.onplaying;
  await event(broken,'error');
  expect(failed).toHaveBeenCalledExactlyOnceWith(1,expect.any(String));
  expect(host.querySelector('[data-media-lifecycle="ERROR"]')).not.toBeNull();
  await render('stop',2,reference);
  expect(host.querySelector(kind)).toBe(broken);
  expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__?.createdPlayers).toBe(1);
  await render('replay',3,reference);
  const recovered=host.querySelector<HTMLMediaElement>(kind)!;
  expect(recovered).not.toBe(broken);
  expect(broken.isConnected).toBe(false);
  expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__).toMatchObject({activePlayers:1,peakPlayers:1,createdPlayers:2,destroyedPlayers:1});
  playback.mockClear();
  await act(async()=>{
    staleMetadata?.call(broken,new Event('loadedmetadata'));
    stalePlaying?.call(broken,new Event('playing'));
  });
  expect(playback).not.toHaveBeenCalled();
  await event(recovered,'loadedmetadata');
  await event(recovered,'playing');
  expect(recovered.currentTime).toBe(1);
  expect(playback).toHaveBeenLastCalledWith(3,'playing');
  expect(failed).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-media-lifecycle="PLAYING"]')).not.toBeNull();
});
test('blocked browser play reports error without falsely claiming playing',async()=>{
  playMock.mockRejectedValue(new Error('NotAllowedError'));
  await render('play');await event(host.querySelector('audio')!,'loadedmetadata');
  expect(failed).toHaveBeenCalledOnce();expect(playback).not.toHaveBeenCalledWith(1,'playing');
});
test('STOP and source changes abort delayed fetch and revoke old image URLs',async()=>{
  let resolve!:(blob:Blob)=>void;
  vi.mocked(readQuizMediaBlob).mockImplementationOnce(()=>new Promise<Blob>(r=>{resolve=r;}));
  await render('play');const signal=vi.mocked(readQuizMediaBlob).mock.calls[0]![1];
  await render('stop',2,nextSource);expect(signal.aborted).toBe(true);await act(async()=>resolve(new Blob(['late'])));
  expect(host.querySelectorAll('audio')).toHaveLength(1);expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__?.peakPlayers).toBe(1);
  await act(async()=>root.render(<AssetImage source={source} alt="Owned"/>));
  expect(host.querySelector('img')?.src).toMatch(/^blob:/);
  vi.mocked(readQuizMediaBlob).mockRejectedValueOnce(new Error('Denied'));
  await act(async()=>root.render(<AssetImage source={nextSource} alt="Owned"/>));
  expect(host.querySelector('img')).toBeNull();
  await act(async()=>root.render(<AssetImage source="https://example.test/legacy.png" alt="Legacy"/>));
  expect(host.querySelector('img')?.src).toBe('https://example.test/legacy.png');
});

test('returning to an owned image never reuses its revoked URL while the new fetch is pending',async()=>{
  await act(async()=>root.render(<AssetImage source={source} alt="Owned"/>));
  const previous=host.querySelector('img')!.src;
  await act(async()=>root.render(<AssetImage source="https://example.test/image.png" alt="Direct"/>));
  expect(revokeMock).toHaveBeenCalledWith(previous);
  let finish!:(blob:Blob)=>void;vi.mocked(readQuizMediaBlob).mockImplementationOnce(()=>new Promise<Blob>(resolve=>{finish=resolve;}));
  await act(async()=>root.render(<AssetImage source={source} alt="Owned"/>));
  expect(host.querySelector('img')).toBeNull();
  await act(async()=>finish(new Blob(['new'])));
  expect(host.querySelector('img')!.src).not.toBe(previous);
  expect(host.textContent).not.toContain('není dostupný');
});

function prefetchQuiz(): EditorQuiz {
  return mapEditorQuiz('quiz-1', { title: 'Synthetic', description: '', slideCount: 3, questionCount: 3, roundCount: 1 }, [
    mapEditorSlide('current', { position: 1, kind: 'question', backgroundImage: source }),
    mapEditorSlide('next', { position: 2, kind: 'image', questionImage: nextSource, backgroundImage: 'quiz-asset:quiz-1/' + 'c'.repeat(64),
      answerImage: 'quiz-asset:quiz-1/' + 'd'.repeat(64), answerDesign: { backgroundImage: 'quiz-asset:quiz-1/' + 'e'.repeat(64) }, originalMediaSource: 'https://example.test/original.mp4' }),
    mapEditorSlide('third', { position: 3, kind: 'audio', mediaSource: 'quiz-asset:quiz-1/' + 'f'.repeat(64) }),
  ]);
}
function Prefetch({ quiz, enabled = true }: { quiz: EditorQuiz; enabled?: boolean }) {
  usePrivateMediaPrefetch(quiz, 'current', enabled, 'synthetic-member:1');
  return null;
}
test('private lookahead selects at most two prompt assets, excludes answer/original/foreign sources and current background', () => {
  const quiz = prefetchQuiz();
  expect(nextPrivateMediaReferences(quiz, 'current')).toEqual([nextSource, 'quiz-asset:quiz-1/' + 'c'.repeat(64)]);
  const foreign = { ...quiz, slides: quiz.slides.map(slide => slide.id === 'next' ? { ...slide, questionImage: nextSource.replace('quiz-1', 'foreign-quiz'), backgroundImage: source } : slide) };
  expect(nextPrivateMediaReferences(foreign, 'current')).toEqual([]);
  expect(nextPrivateMediaReferences(quiz, 'missing')).toEqual([]);
});

test('private live lookahead excludes answers, hidden slides, current backgrounds and foreign assets', () => {
  const quiz = prefetchQuiz();
  const slides = quiz.slides.map(slide => mapLiveControlSlide(slide.id, { ...slide }));
  expect(nextPrivateLiveMediaReferences(quiz.id, slides, 'current')).toEqual([nextSource, 'quiz-asset:quiz-1/' + 'c'.repeat(64)]);
  const hidden = mapLiveControlSlide('hidden', { position: 1.5, kind: 'info', hidden: true, questionImage: 'quiz-asset:quiz-1/' + '0'.repeat(64) });
  const foreign = slides.map(slide => slide.id === 'next' ? { ...slide, questionImage: nextSource.replace('quiz-1', 'foreign-quiz'), backgroundImage: source } : slide);
  expect(nextPrivateLiveMediaReferences(quiz.id, [...foreign, hidden], 'current')).toEqual([]);
  expect(nextPrivateLiveMediaReferences(quiz.id, slides, 'missing')).toEqual([]);
});

test('private live image lookahead skips audio and video clips in the next slides', () => {
  const quiz = prefetchQuiz();
  const slides = quiz.slides.map(slide => mapLiveControlSlide(slide.id, { ...slide }));
  const clips = slides.map(slide => slide.id === 'next' ? { ...slide, kind: 'video', questionImage: undefined, backgroundImage: undefined, mediaSource: nextSource } : slide);
  expect(nextPrivateLiveMediaReferences(quiz.id, clips, 'current')).toEqual([]);
});

test('private preload includes original web prompt images in both navigation directions, excluding answers and unsafe URLs', () => {
  const quiz = prefetchQuiz();
  const original = { ...quiz, slides: quiz.slides.map((slide, index) => ({ ...slide,
    questionImage: `https://images.example.test/prompt-${index}.jpg`,
    answerImage: `https://images.example.test/answer-${index}.jpg`,
    backgroundImage: 'javascript:alert(1)',
    answerDesign: { backgroundImage: 'https://images.example.test/answer-bg.jpg' },
  })) };
  const expected = ['https://images.example.test/prompt-2.jpg', 'https://images.example.test/prompt-0.jpg'];
  expect(nextPrivateMediaReferences(original, 'next')).toEqual(expected);
  expect(nextPrivateLiveMediaReferences(original.id, original.slides.map(slide => mapLiveControlSlide(slide.id, { ...slide })), 'next')).toEqual(expected);
});

test('original web image preloads use native image loading sequentially and cancel without private media reads', async () => {
  vi.useFakeTimers();
  const images: HTMLImageElement[] = [];
  vi.stubGlobal('Image', class {
    constructor() { const image = document.createElement('img'); images.push(image); return image; }
  });
  try {
    const quiz = prefetchQuiz();
    const original = { ...quiz, slides: quiz.slides.map(slide => slide.id === 'next' ? { ...slide,
      questionImage: 'https://images.example.test/question.jpg', backgroundImage: 'https://images.example.test/background.jpg',
    } : slide) };
    await act(async () => root.render(<Prefetch quiz={original} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(images).toHaveLength(1);
    expect(images[0]!.src).toBe('https://images.example.test/question.jpg');
    await act(async () => { images[0]!.dispatchEvent(new Event('load')); });
    expect(images).toHaveLength(2);
    expect(images[1]!.src).toBe('https://images.example.test/background.jpg');
    await act(async () => root.render(<Prefetch quiz={original} enabled={false} />));
    expect(images[1]!.hasAttribute('src')).toBe(false);
    expect(readQuizMediaBlob).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

test('original web images preserve their URL and DOM node on ordinary rerenders without a private download', async () => {
  const url = 'https://images.example.test/original.jpg';
  await act(async () => root.render(<AssetImage source={url} alt="Original" />));
  const image = host.querySelector('img');
  await act(async () => root.render(<AssetImage source={url} alt="Original updated" />));
  expect(host.querySelector('img')).toBe(image);
  expect(image?.getAttribute('src')).toBe(url);
  expect(readQuizMediaBlob).not.toHaveBeenCalled();
});
test('private lookahead waits for visible reads, stays sequential and aborts when disabled', async () => {
  vi.useFakeTimers();
  let visibleReady!: () => void;
  vi.spyOn(quizMediaBlobCache, 'waitForPendingReads').mockImplementation(() => new Promise<void>(resolve => { visibleReady = resolve; }));
  const pending: ((blob: Blob) => void)[] = [];
  vi.mocked(readQuizMediaBlob).mockImplementation(() => new Promise<Blob>(resolve => { pending.push(resolve); }));
  const quiz = prefetchQuiz();
  await act(async () => root.render(<Prefetch quiz={quiz} />));
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  expect(readQuizMediaBlob).not.toHaveBeenCalled();
  await act(async () => { visibleReady(); });
  expect(readQuizMediaBlob).toHaveBeenCalledOnce();
  expect(vi.mocked(readQuizMediaBlob).mock.calls[0]![0]).toBe(nextSource);
  await act(async () => pending[0]!(new Blob(['first'])));
  expect(readQuizMediaBlob).toHaveBeenCalledTimes(2);
  const secondSignal = vi.mocked(readQuizMediaBlob).mock.calls[1]![1];
  await act(async () => root.render(<Prefetch quiz={quiz} enabled={false} />));
  expect(secondSignal.aborted).toBe(true);
  await act(async () => pending[1]!(new Blob(['second'])));
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(readQuizMediaBlob).toHaveBeenCalledTimes(2);
});

test('private lookahead uses the event snapshot and cancels when its binding changes', async () => {
  vi.useFakeTimers();
  const quiz = prefetchQuiz();
  const pending: ((blob: Blob) => void)[] = [];
  vi.mocked(readQuizMediaBlob).mockImplementation(() => new Promise<Blob>(resolve => { pending.push(resolve); }));
  const show = (snapshotId: string) => act(async () => root.render(
    <SnapshotMediaContext.Provider value={snapshotId}><Prefetch quiz={quiz} /></SnapshotMediaContext.Provider>,
  ));
  await show('snapshot-one');
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  const first = vi.mocked(readQuizMediaBlob).mock.calls[0]!;
  expect(first[0]).toBe(nextSource);
  expect(first[2]).toBeUndefined();
  expect(first[3]).toBe('snapshot-one');
  await show('snapshot-two');
  expect(first[1].aborted).toBe(true);
  await act(async () => pending[0]!(new Blob(['old snapshot'])));
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  const second = vi.mocked(readQuizMediaBlob).mock.calls[1]!;
  expect(second[3]).toBe('snapshot-two');
});

test.each([['video', 'video/mp4'], ['audio', 'audio/wav']] as const)('keeps the prepared %s player through play, stop, finish, revealed recap and question', async (kind, mime) => {
  vi.mocked(readQuizMediaBlob).mockResolvedValue(new Blob(['synthetic'], { type: mime }));
  const slide = { kind, title: 'Safe prompt', text: 'Safe question', options: [], media: [], mediaSource: source, clipStartSeconds: 1, clipEndSeconds: 3 };
  const show = (command: 'idle' | 'play' | 'stop' | 'finished' | 'replay', generation: number, reveal = false) => act(async () => {
    root.render(<SlideRenderer quizTitle="Synthetic" slide={reveal ? { ...slide, revealedAnswer: 'Explicitly revealed answer' } : slide}
      mode={reveal ? 'recap' : 'question'} mediaCommand={command} mediaGeneration={generation} playPrivateAudio={kind === 'audio'} />);
  });
  await show('idle', 1); const player = host.querySelector<HTMLMediaElement>(kind)!;
  expect(player).not.toBeNull(); await event(player, 'loadedmetadata');
  await show('play', 2); await event(player, 'playing');
  await show('stop', 3); expect(host.querySelector(kind)).toBe(player); expect(player.controls).toBe(false);
  await show('replay', 4); await event(player, 'playing');
  player.currentTime = 3; await event(player, 'timeupdate');
  await show('finished', 5); await show('stop', 6, true);
  expect(host.textContent).toContain('Explicitly revealed answer'); expect(host.querySelector(kind)).toBe(player);
  await show('idle', 7); expect(host.textContent).not.toContain('Explicitly revealed answer');
  expect(host.querySelector(kind)).toBe(player); expect(player.currentTime).toBe(1);
  expect(readQuizMediaBlob).toHaveBeenCalledOnce();
  expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__).toMatchObject({ activePlayers: 1, createdPlayers: 1, destroyedPlayers: 0 });
});
