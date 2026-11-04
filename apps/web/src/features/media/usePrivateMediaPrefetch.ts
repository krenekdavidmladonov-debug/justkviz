import { useContext, useEffect } from 'react';
import { canHideInfoSlide, isSafeHttpUrl, parseQuizAsset, resolveLegacySlideAppearance, resolveSlideDesign, type EditorQuiz, type EditorSlide } from '@filmovy-kviz/quiz-domain';
import { readQuizMediaBlob } from './mediaApi';
import { quizMediaBlobCache } from './mediaBlobCache';
import { SnapshotMediaContext } from './SnapshotMediaContext';
import type { LiveControlSlide } from '../live/types';

function promptReferences(quiz: EditorQuiz, slide: EditorSlide): string[] {
  const round = quiz.slides.find(item => item.roundId === slide.roundId && ['round', 'roundheader', 'round-header', 'section'].includes(item.kind))
    ?? quiz.slides.find(item => item.roundId === slide.roundId && item.kind === 'intro' && !item.isQuestion);
  const design = resolveSlideDesign(quiz.defaultDesign, round?.design, slide.design);
  // Deliberately excludes clips, answerImage, answerDesign, and legacy answer media.
  return [slide.questionImage, design.backgroundImage ?? resolveLegacySlideAppearance(quiz.defaultAppearance, slide).backgroundImage, design.showLogo === false ? '' : design.logoImage ?? '']
    .filter(reference => isSafeHttpUrl(reference) || parseQuizAsset(reference)?.quizId === quiz.id);
}

/** Give each adjacent direction a slot before loading a second image from one slide. */
function adjacentReferences<T>(slides: readonly T[], index: number, references: (slide: T) => readonly string[]): readonly string[] {
  const current = new Set(references(slides[index]!));
  const neighbours = [slides[index + 1], slides[index - 1], slides[index + 2], slides[index - 2]]
    .filter((slide): slide is T => slide !== undefined)
    .map(slide => references(slide).filter(reference => !current.has(reference)));
  const result = new Set<string>();
  for (let image = 0; image < 2; image++) {
    for (const candidates of neighbours) {
      const reference = candidates[image];
      if (reference) result.add(reference);
      if (result.size === 2) return [...result];
    }
  }
  return [...result];
}

export function nextPrivateMediaReferences(quiz: EditorQuiz, currentSlideId: string): readonly string[] {
  const slides = [...quiz.slides].filter(slide => !(slide.hidden === true && canHideInfoSlide(slide))).sort((a, b) => a.position - b.position);
  const index = slides.findIndex(slide => slide.id === currentSlideId);
  if (index < 0) return [];
  return adjacentReferences(slides, index, slide => promptReferences(quiz, slide));
}

/** Private moderator only; never called by public/projector clients. */
export function nextPrivateLiveMediaReferences(quizId: string, slides: readonly LiveControlSlide[], currentSlideId: string): readonly string[] {
  const visible = [...slides].filter(slide => !(slide.hidden === true && canHideInfoSlide(slide))).sort((a, b) => a.position - b.position);
  const index = visible.findIndex(slide => slide.id === currentSlideId);
  if (index < 0) return [];
  const references = (slide: LiveControlSlide) => {
    const round = visible.find(item => item.roundId === slide.roundId && ['round', 'roundheader', 'round-header', 'section'].includes(item.kind))
      ?? visible.find(item => item.roundId === slide.roundId && item.kind === 'intro' && !item.isQuestion);
    const design = resolveSlideDesign(undefined, round?.design, slide.design);
    // Image lookahead only; clips must not occupy the idle queue ahead of image reads.
    // No answer image/design or answer-role media.
    return [slide.questionImage, design.backgroundImage ?? slide.backgroundImage, design.showLogo === false ? '' : design.logoImage]
      .filter((reference): reference is string => typeof reference === 'string' && (isSafeHttpUrl(reference) || parseQuizAsset(reference)?.quizId === quizId));
  };
  return adjacentReferences(visible, index, references);
}

/** Use the same browser image cache as AssetImage, without requiring cross-origin fetch access. */
function preloadHttpImage(reference: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (error?: Error) => {
      image.onload = null; image.onerror = null; signal.removeEventListener('abort', cancel);
      if (error) { image.removeAttribute('src'); reject(error); } else resolve();
    };
    const cancel = () => finish(new DOMException('Image preload aborted', 'AbortError'));
    if (signal.aborted) { cancel(); return; }
    image.onload = () => finish();
    image.onerror = () => finish(new Error('Image preload failed'));
    signal.addEventListener('abort', cancel, { once: true });
    image.src = reference;
  });
}

/** Private editor/rehearsal only. */
export function usePrivateMediaPrefetch(quiz: EditorQuiz | null, currentSlideId: string | undefined, enabled: boolean, accessKey: string): void {
  const references = quiz && currentSlideId ? nextPrivateMediaReferences(quiz, currentSlideId) : [];
  usePrivateMediaReferencesPrefetch(references, enabled, accessKey);
}

/** At most two prompt images, fetched sequentially after visible reads settle. */
export function usePrivateMediaReferencesPrefetch(candidates: readonly string[], enabled: boolean, accessKey: string): void {
  const snapshotId = useContext(SnapshotMediaContext);
  const references = [...new Set(candidates)].slice(0, 2).join('\n');
  useEffect(() => {
    if (!enabled || !references) return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        await quizMediaBlobCache.waitForPendingReads();
        for (const reference of references.split('\n')) {
          if (abort.signal.aborted) return;
          const request = new AbortController();
          const cancel = () => request.abort();
          abort.signal.addEventListener('abort', cancel, { once: true });
          const timeout = window.setTimeout(cancel, 15000);
          try {
            if (isSafeHttpUrl(reference)) await preloadHttpImage(reference, request.signal);
            else await readQuizMediaBlob(reference, request.signal, undefined, snapshotId);
          }
          catch { /* Speculative failures must not interrupt editing; visible reads show their own retry. */ }
          finally { window.clearTimeout(timeout); abort.signal.removeEventListener('abort', cancel); }
        }
      })();
    }, 900);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [accessKey, enabled, references, snapshotId]);
}
