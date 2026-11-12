import { SlideRenderer } from './SlideRenderer';
import { resolveSlideDesign, type SlideDesign } from '@filmovy-kviz/quiz-domain';
import type { SlideMediaReference, SlidePresentationInput } from './types';

export type PreviewMedia = SlideMediaReference;

export interface PreviewSlide {
  readonly design?: SlideDesign;
  readonly answerDesign?: SlideDesign;
  readonly roundTitle?: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly options: readonly string[];
  readonly media: readonly PreviewMedia[];
  readonly correctAnswer?: string;
  readonly questionNumber?: number;
  readonly questionCount?: number;
  readonly backgroundImage?: string;
  readonly questionImage?: string;
  readonly answerImage?: string;
  readonly imageLayout?: string;
  readonly answerExplanation?: string;
  readonly mediaSource?: string;
  readonly clipStartSeconds?: number | null;
  readonly clipEndSeconds?: number | null;
  readonly backgroundOverlay?: number | null;
  readonly presentation?: SlidePresentationInput;
}

export function SlidePreview({
  slide,
  quizTitle,
  position,
  showAnswer = false,
}: {
  readonly slide: PreviewSlide;
  readonly quizTitle: string;
  readonly position?: number;
  readonly showAnswer?: boolean;
}) {
  return (
    <div className="preview-stage" data-slide-position={position}>
      <SlideRenderer
        compact
        mediaEnabled={false}
        quizTitle={quizTitle}
        {...(showAnswer ? { mode: 'recap' as const } : {})}
        slide={{
          ...slide,
          design: resolveSlideDesign(undefined, undefined, slide.design, slide.answerDesign, showAnswer),
          ...(showAnswer && slide.correctAnswer ? { revealedAnswer: slide.correctAnswer } : {}),
        }}
      />
    </div>
  );
}
