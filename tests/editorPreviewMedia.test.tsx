// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SlidePreview } from '../apps/web/src/features/presentation/SlidePreview';
import { SlideRenderer } from '../apps/web/src/features/presentation/SlideRenderer';
import { MediaPlayer } from '../apps/web/src/features/presentation/MediaPlayer';

import { MemoryRouter } from 'react-router-dom';
import { mapEditorSlide, runQuizPreflight, type EditorQuiz } from '../packages/quiz-domain/src';
import { MediaAuthoringContext } from '../apps/web/src/features/media/MediaUploadField';
import { AnswerYoutubeField } from '../apps/web/src/features/editor/AnswerYoutubeField';
import { EditorPreview } from '../apps/web/src/features/editor/EditorForms';
import { AnswerLengthWarning, AnswerLengthMeasurement, answerLengthWarning, type AnswerLengthResult } from '../apps/web/src/features/preflight/AnswerLengthMeasurement';
import { QuizPreflightPanel } from '../apps/web/src/features/preflight/QuizPreflightPanel';

const fit = vi.hoisted(() => ({ tooLong: false }));
vi.mock('../apps/web/src/features/presentation/recapFit', () => ({
  observeRecapFit: (_stage: HTMLElement, report?: (tooLong: boolean) => void) => { report?.(fit.tooLong); return () => {}; },
}));
const measuredQuestion = (answer: string) => mapEditorSlide('length-question', {
  kind: 'free', position: 2, isQuestion: true, roundId: 'length-round', roundTitle: 'Měřené kolo', questionNumber: 1, questionCount: 1, text: 'Syntetické zadání', correctAnswer: answer,
});
function measuredQuiz(answer: string): EditorQuiz {
  return { id: 'length-quiz', title: 'Měření', description: '', revision: 1, slideCount: 3, roundCount: 1, questionCount: 1,
    slides: [mapEditorSlide('length-intro', { kind: 'intro', position: 1, title: 'Úvod' }),
      measuredQuestion(answer), mapEditorSlide('length-recap', { kind: 'recap', position: 3, roundId: 'length-round' })] };
}
async function measurementFrame() {
  await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 50)); });
}
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
  fit.tooLong = false;
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

test('editor measures answers while question mode is visible and removes the warning after shortening', async () => {
  fit.tooLong = true;
  const large = measuredQuestion('Dlouhá soukromá odpověď');
  await act(async () => root.render(<EditorPreview slide={large} quizTitle="Měření" answersReadable showAnswer={false} onShowAnswer={() => {}} />));
  expect(host.querySelectorAll('.round-editor-preview .slide-copy')).toHaveLength(1);
  await measurementFrame();
  expect([...host.querySelectorAll('[role=status]')].some(status => status.textContent === answerLengthWarning)).toBe(true);
  expect(host.querySelector('.answer-preview-toggle input')?.hasAttribute('checked')).toBe(false);
  fit.tooLong = false;
  await act(async () => root.render(<EditorPreview slide={measuredQuestion('Krátká')} quizTitle="Měření" answersReadable showAnswer={false} onShowAnswer={() => {}} />));
  await measurementFrame();
  expect(host.textContent).not.toContain(answerLengthWarning);
});

test('preflight measures an unopened question, reports only a recommendation, and revocation removes private measurement', async () => {
  fit.tooLong = true;
  const quiz = measuredQuiz('PRIVATE_LENGTH_SECRET');
  await act(async () => root.render(<MemoryRouter><QuizPreflightPanel quizId={quiz.id} quiz={quiz} result={runQuizPreflight(quiz)} answersReadable /></MemoryRouter>));
  await measurementFrame();
  expect(host.textContent).toContain(answerLengthWarning);
  const issue = host.querySelector('[data-issue-code="ANSWER_TOO_LONG"]')!;
  expect(issue.className).toContain('severity-warning');
  expect(host.querySelector('[data-content-blocker-count]')?.getAttribute('data-content-blocker-count')).toBe('0');
  expect(host.textContent).toContain('Doporučení hraní neblokují');
  await act(async () => root.render(<MemoryRouter><QuizPreflightPanel quizId={quiz.id} quiz={quiz} result={runQuizPreflight(quiz)} answersReadable={false} /></MemoryRouter>));
  await measurementFrame();
  expect(host.textContent).not.toContain(answerLengthWarning);
  expect(document.body.textContent).not.toContain('PRIVATE_LENGTH_SECRET');
  expect(host.querySelector('[aria-hidden=true][inert]')).toBeNull();
});

test('measurement requests no answer images or media and the inline warning remains advisory', async () => {
  fit.tooLong = true;
  const question = { ...measuredQuestion('Soukromá odpověď'), answerImage: 'http://127.0.0.1/private-answer.png', kind: 'video' as const,
    mediaSource: 'http://127.0.0.1/private-video.mp4' };
  const save = vi.fn();
  await act(async () => root.render(<><AnswerLengthWarning slide={question} quizTitle="Měření" /><button onClick={save}>Uložit otázku</button></>));
  await measurementFrame();
  expect(host.textContent).toContain(answerLengthWarning);
  expect(document.querySelectorAll('img[src],video,audio,iframe')).toHaveLength(0);
  const button = host.querySelector('button')!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(save).toHaveBeenCalledOnce();
});

test('measurement releases completed batches and rechecks all questions when browser fonts finish loading', async () => {
  const previousFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  const fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() });
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
  const slides = Array.from({ length: 9 }, (_, index) => ({ ...measuredQuestion('Krátká'), id: 'measured-' + index }));
  const measured = vi.fn<(result: AnswerLengthResult) => void>();
  try {
    await act(async () => root.render(<AnswerLengthMeasurement slides={slides} quizTitle="Měření" onMeasured={measured} />));
    expect(host.querySelector('.slide-renderer')).toBeNull();
    expect(document.querySelectorAll('.slide-renderer')).toHaveLength(8);
    for (let index = 0; index < 3; index++) await measurementFrame();
    expect(measured).toHaveBeenCalledTimes(1);
    expect(measured.mock.calls[0]![0].tooLong.size).toBe(0);
    expect(document.querySelectorAll('.slide-renderer')).toHaveLength(0);
    fit.tooLong = true;
    await act(async () => fonts.dispatchEvent(new Event('loadingdone')));
    for (let index = 0; index < 3; index++) await measurementFrame();
    expect(measured).toHaveBeenCalledTimes(2);
    expect([...measured.mock.calls[1]![0].tooLong]).toEqual(slides.map(slide => slide.id));
    expect(document.querySelectorAll('.slide-renderer')).toHaveLength(0);
  } finally {
    if (previousFonts) Object.defineProperty(document, 'fonts', previousFonts);
    else Reflect.deleteProperty(document, 'fonts');
  }
});

test('answer clip authoring retains decimal seconds and resets after discarding the same question', async () => {
  const original = { ...measuredQuestion('Odpověď'), answerYoutubeClip: { videoId: 'answer12345', startSeconds: 6.125, endSeconds: 12.875 } };
  const change = vi.fn();
  const renderField = async (question: typeof original) => act(async () => root.render(<AnswerYoutubeField slide={question} disabled={false} onChange={change} />));
  const fill = async (input: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await renderField(original);
  const inputs = () => [...host.querySelectorAll<HTMLInputElement>('input')];
  expect(inputs().map(input => input.value)).toEqual(['https://youtu.be/answer12345', '6.125', '12.875']);
  await fill(inputs()[0]!, 'https://youtube.com/shorts/changed1234');
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ answerYoutubeClip: { videoId: 'changed1234', startSeconds: 6.125, endSeconds: 12.875 } }));
  const changed = change.mock.lastCall![0] as typeof original;
  await renderField(changed);
  await fill(inputs()[1]!, '0:06.234');
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ answerYoutubeClip: { videoId: 'changed1234', startSeconds: 6.234, endSeconds: 12.875 } }));
  await renderField(change.mock.lastCall![0] as typeof original);
  await renderField(original);
  expect(inputs().map(input => input.value)).toEqual(['https://youtu.be/answer12345', '6.125', '12.875']);
  await fill(inputs()[0]!, 'answer12345');
  expect((change.mock.lastCall![0] as typeof original).answerYoutubeClip.videoId).toBe('');
});


test('answer clip fields follow attachment permission while showing the stored clip', async () => {
  const question = { ...measuredQuestion('Odpověď'), answerYoutubeClip: { videoId: 'answer12345' } };
  await act(async () => root.render(<MediaAuthoringContext.Provider value={{ quizId: 'quiz', onPending: () => {}, canAttach: false }}>
    <AnswerYoutubeField slide={question} disabled={false} onChange={vi.fn()} />
  </MediaAuthoringContext.Provider>));
  expect(host.querySelector('fieldset')!.disabled).toBe(true);
  expect(host.querySelector('input')!.value).toBe('https://youtu.be/answer12345');
});
