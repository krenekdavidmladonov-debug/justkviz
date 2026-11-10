// @vitest-environment happy-dom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuestionForm } from '../apps/web/src/features/editor/EditorForms';
import type { EditorSlide } from '../apps/web/src/features/editor/types';
import { MediaAuthoringContext } from '../apps/web/src/features/media/MediaUploadField';
import { listQuizMedia } from '../apps/web/src/features/media/mediaApi';

vi.mock('../apps/web/src/features/media/mediaApi', () => ({ listQuizMedia: vi.fn(), uploadQuizMedia: vi.fn() }));
vi.mock('../apps/web/src/features/presentation/MediaPlayer', () => ({ MediaPlayer: () => null }));

const audioReference = 'quiz-asset:synthetic-quiz/' + 'a'.repeat(64);
const videoReference = 'quiz-asset:synthetic-quiz/' + 'b'.repeat(64);
const initialSlide: EditorSlide = {
  id: 'question-one', kind: 'audio', storedKind: 'audio', position: 1, isQuestion: true,
  title: '', text: 'Syntetické zadání', correctAnswer: 'Syntetická odpověď', options: [], media: [], moderatorNote: '',
  backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '', backgroundOverlay: null,
  clipStartSeconds: 0, clipEndSeconds: null, hasLegacyData: false,
  presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null },
};
let host: HTMLDivElement;
let root: Root;
const changes = vi.fn<(slide: EditorSlide) => void>();
const uploadPending = vi.fn<(pending: boolean) => void>();
function EditableQuestion() {
  const [slide, setSlide] = useState(initialSlide);
  return <MediaAuthoringContext.Provider value={{ quizId: 'synthetic-quiz', onPending: uploadPending }}>
    <QuestionForm slide={slide} number={1} disabled={false} showAllIssues={false} touched={new Set()} onTouch={() => {}}
      onChange={next => { changes(next); setSlide(next); }} />
  </MediaAuthoringContext.Provider>;
}
const sourcePicker = () => host.querySelector<HTMLElement>('[data-preflight-field="mediaSource"] .media-picker')!;
async function click(label: string) {
  const button = [...sourcePicker().querySelectorAll('button')].find(item => item.textContent?.startsWith(label))!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  changes.mockClear(); uploadPending.mockClear();
  vi.mocked(listQuizMedia).mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it.each(['pending', 'loaded'] as const)('discards the %s audio library when the same question changes to video', async state => {
  let resolveAudio!: (items: Awaited<ReturnType<typeof listQuizMedia>>) => void;
  vi.mocked(listQuizMedia).mockImplementationOnce(() => new Promise(resolve => { resolveAudio = resolve; }))
    .mockResolvedValueOnce([{ reference: videoReference, size: 2048 }]);
  await act(async () => root.render(<EditableQuestion />));
  await click('Vybrat z médií tohoto kvízu');
  expect(listQuizMedia).toHaveBeenCalledExactlyOnceWith('synthetic-quiz', 'audio');
  if (state === 'loaded') await act(async () => resolveAudio([{ reference: audioReference, size: 1024 }]));

  const type = [...host.querySelectorAll('select')].find(item => item.closest('label')?.textContent?.startsWith('Způsob zadání'))!;
  expect(type.disabled).toBe(false);
  await act(async () => { type.value = 'video'; type.dispatchEvent(new Event('change', { bubbles: true })); });
  if (state === 'pending') await act(async () => resolveAudio([{ reference: audioReference, size: 1024 }]));

  expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ id: initialSlide.id, kind: 'video', mediaSource: '' }));
  const obsoleteChoice = sourcePicker().querySelector<HTMLButtonElement>('.media-library button');
  if (obsoleteChoice) await act(async () => obsoleteChoice.click());
  expect(changes.mock.calls.some(([slide]) => slide.kind === 'video' && slide.mediaSource === audioReference)).toBe(false);
  expect(sourcePicker().querySelector('.media-library')).toBeNull();
  await click('Vybrat z médií tohoto kvízu');
  expect(listQuizMedia).toHaveBeenLastCalledWith('synthetic-quiz', 'video');
  await click('Vybrat médium 1');
  expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'video', mediaSource: videoReference }));
  expect(changes.mock.calls.some(([slide]) => slide.kind === 'video' && slide.mediaSource === audioReference)).toBe(false);
});
