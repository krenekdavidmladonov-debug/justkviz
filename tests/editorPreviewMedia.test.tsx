// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SlidePreview } from '../apps/web/src/features/presentation/SlidePreview';
import { SlideRenderer } from '../apps/web/src/features/presentation/SlideRenderer';
import { MediaPlayer } from '../apps/web/src/features/presentation/MediaPlayer';

let root: Root, host: HTMLDivElement;
const play = vi.fn<() => Promise<void>>();
const slide = (kind: 'audio' | 'video') => ({
  kind, title: '', text: 'Synthetic media question', options: [], media: [],
  correctAnswer: 'Private synthetic answer', answerImage: 'http://127.0.0.1/answer.png',
  mediaSource: `http://127.0.0.1/sample.${kind === 'video' ? 'webm' : 'wav'}`,
  clipStartSeconds: 1, clipEndSeconds: 3,
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  delete window.__FILMOVY_KVIZ_MEDIA_DEBUG__;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  play.mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(4);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); });

test.each([
  { kind: 'video' as const, showAnswer: false },
  { kind: 'video' as const, showAnswer: true },
  { kind: 'audio' as const, showAnswer: true },
])('static $kind preview with answer=$showAnswer preserves content without allocating a player', async ({ kind, showAnswer }) => {
  await act(async () => root.render(<SlidePreview slide={slide(kind)} quizTitle="Synthetic quiz" showAnswer={showAnswer} />));
  expect(host.textContent).toContain('Synthetic media question');
  if (showAnswer) {
    expect(host.textContent).toContain('Private synthetic answer');
    expect(host.querySelector('img[alt="Obrázek odpovědi"]')?.getAttribute('src')).toBe('http://127.0.0.1/answer.png');
  }
  expect(host.querySelectorAll('audio,video,iframe')).toHaveLength(0);
  expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__?.createdPlayers ?? 0).toBe(0);
  expect(play).not.toHaveBeenCalled();
});

test('static preview shares the editor with one working media tester', async () => {
  const media = slide('video');
  await act(async () => root.render(<><MediaPlayer source={media.mediaSource} command="idle" generation={1} startSeconds={1} endSeconds={3} /><SlidePreview slide={media} quizTitle="Synthetic quiz" showAnswer /></>));
  expect(host.textContent).toContain('Private synthetic answer');
  expect(host.querySelectorAll('video')).toHaveLength(1);
  expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__).toMatchObject({ activePlayers: 1, peakPlayers: 1, createdPlayers: 1 });
});

test('default renderer still allocates, plays and cleans up its real media resource', async () => {
  const playback = vi.fn();
  await act(async () => root.render(<SlideRenderer slide={slide('video')} quizTitle="Synthetic quiz" mediaCommand="play" mediaGeneration={1} onMediaPlaybackState={playback} />));
  const player = host.querySelector('video')!;
  expect(player).not.toBeNull();
  await act(async () => player.dispatchEvent(new Event('loadedmetadata')));
  expect(play).toHaveBeenCalledOnce();
  expect(player.currentTime).toBe(1);
  await act(async () => player.dispatchEvent(new Event('playing')));
  expect(playback).toHaveBeenLastCalledWith(1, 'playing');
  expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__).toMatchObject({ activePlayers: 1, peakPlayers: 1 });
  await act(async () => root.render(<div />));
  expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__).toMatchObject({ activePlayers: 0, createdPlayers: 1, destroyedPlayers: 1 });
});
