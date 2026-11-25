import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSemanticQuizModel, resolveLegacySlideAppearance, resolveSlideDesign, type EditorSlide, type EditorQuiz } from '@filmovy-kviz/quiz-domain';
import { RecapMeasurementContext, SlideRenderer } from '../presentation/SlideRenderer';

export const answerLengthWarning = 'Odpověď je na projekci příliš dlouhá, zkraťte ji.';

export type MeasuredAnswerSlide = EditorSlide & { readonly roundNumber?: number };
export interface AnswerLengthResult {
  readonly slides: readonly MeasuredAnswerSlide[];
  readonly tooLong: ReadonlySet<string>;
}

export function answerMeasurementSlides(quiz: EditorQuiz): readonly MeasuredAnswerSlide[] {
  const model = buildSemanticQuizModel(quiz);
  return model.rounds.flatMap(round => round.questions.map(question => ({
    ...question.slide,
    ...resolveLegacySlideAppearance(quiz.defaultAppearance, question.slide),
    roundNumber: round.position,
    questionNumber: question.number, questionCount: round.questions.length,
    design: resolveSlideDesign(quiz.defaultDesign, round.settingsSlide?.design, question.slide.design, question.slide.answerDesign, true),
  })));
}

/** A bounded batch uses the real answer layout while requesting no image, sound or video. */
export function AnswerLengthMeasurement({ slides, quizTitle, onMeasured }: {
  readonly slides: readonly MeasuredAnswerSlide[];
  readonly quizTitle: string;
  readonly onMeasured: (result: AnswerLengthResult) => void;
}) {
  const [fontEpoch, setFontEpoch] = useState(0);
  const [job, setJob] = useState({ slides, quizTitle, fontEpoch, cursor: 0, complete: false });
  const currentJob = job.slides === slides && job.quizTitle === quizTitle && job.fontEpoch === fontEpoch;
  const cursor = currentJob ? job.cursor : 0;
  const complete = currentJob && job.complete;
  const results = useMemo(() => new Map<string, boolean>(), [slides, quizTitle, fontEpoch]);
  const callback = useRef(onMeasured);
  callback.current = onMeasured;
  const batch = complete ? [] : slides.slice(cursor, cursor + 4);
  useEffect(() => {
    const reloadFonts = () => setFontEpoch(epoch => epoch + 1);
    document.fonts?.addEventListener('loadingdone', reloadFonts);
    return () => document.fonts?.removeEventListener('loadingdone', reloadFonts);
  }, []);
  useEffect(() => {
    if (complete) return;
    let cancelled = false;
    let frame: number | undefined;
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (cancelled) return;
      frame = requestAnimationFrame(() => {
        if (cursor + 4 < slides.length) {
          setJob({ slides, quizTitle, fontEpoch, cursor: cursor + 4, complete: false });
        } else {
          callback.current({ slides, tooLong: new Set(slides.filter(slide => [540, 720].some(height => results.get(slide.id + ':' + height))).map(slide => slide.id)) });
          setJob({ slides, quizTitle, fontEpoch, cursor, complete: true });
        }
      });
    });
    return () => { cancelled = true; if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [cursor, slides, quizTitle, results, fontEpoch, complete]);
  if (batch.length === 0) return null;
  // Keep the measurement canvases outside the editor's interactive preview and dialog.
  return createPortal(<div aria-hidden="true" inert style={{ position: 'fixed', left: '-20000px', top: 0, width: 960, visibility: 'hidden', pointerEvents: 'none' }}>
    <RecapMeasurementContext.Provider value={true}>
      {batch.flatMap(slide => [540, 720].map(height => <div key={slide.id + ':' + height} style={{ width: 960, height }}>
        <SlideRenderer slide={{ ...slide, revealedAnswer: slide.correctAnswer ?? '' }} mode="recap" quizTitle={quizTitle}
          mediaEnabled={false} liveEventsEnabled={false} onRecapFit={tooLong => { results.set(slide.id + ':' + height, tooLong); }} />
      </div>))}
    </RecapMeasurementContext.Provider>
  </div>, document.body);
}

export function AnswerLengthWarning({ slide, quizTitle }: { readonly slide: MeasuredAnswerSlide; readonly quizTitle: string }) {
  const slides = useMemo(() => [{ ...slide, design: resolveSlideDesign(undefined, undefined, slide.design, slide.answerDesign, true) }], [slide]);
  const [result, setResult] = useState<AnswerLengthResult | null>(null);
  return <>
    <AnswerLengthMeasurement slides={slides} quizTitle={quizTitle} onMeasured={setResult} />
    {result?.slides === slides && result.tooLong.has(slide.id) && <p className="field-validation warning" role="status">{answerLengthWarning}</p>}
  </>;
}
