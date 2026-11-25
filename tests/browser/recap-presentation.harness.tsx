import React from 'react';
import { createRoot } from 'react-dom/client';
import { SlideRenderer } from '../../apps/web/src/features/presentation/SlideRenderer';
import { SlidePreview } from '../../apps/web/src/features/presentation/SlidePreview';
import { AnswerLengthWarning } from '../../apps/web/src/features/preflight/AnswerLengthMeasurement';
import { mapEditorSlide, validateQuestion } from '../../packages/quiz-domain/src';
import '../../apps/web/src/styles/global.css';
import '../../apps/web/src/styles/editor.css';
import '../../apps/web/src/features/presentation/presentation.css';

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') ?? 'choice';
const video = scenario.includes('video');
const recap = !scenario.startsWith('video');
const longAnswer = 'Jiří Menzel natočil film Ostře sledované vlaky podle novely Bohumila Hrabala. '.repeat(6);
const extreme = scenario === 'extreme-answer';
const answerText = extreme ? longAnswer.repeat(43).slice(0, 20_000) : longAnswer;
const long = scenario === 'long-answer' || scenario === 'long-choice' || extreme;
const answer = long ? (scenario === 'long-choice' ? 'B' : answerText) : video ? 'Ostře sledované vlaky' : 'B';
const slide = {
  kind: video ? 'video' : scenario === 'long-answer' || extreme ? 'free' : 'question',
  title: video ? 'Ze kterého filmu pochází tato ukázka?' : 'Kdo režíroval film Ostře sledované vlaky?',
  text: video ? 'Podívejte se na celou ukázku a napište název filmu.' : '',
  options: video || scenario === 'long-answer' || extreme ? [] : ['Miloš Forman', scenario === 'long-choice' ? longAnswer : 'Jiří Menzel', 'Věra Chytilová', 'Jan Svěrák'],
  media: [], questionNumber: 3, questionCount: 8, roundTitle: 'Český film',
  ...(video ? { mediaSource: scenario.includes('blocked') ? 'blocked' : scenario.includes('native') ? 'https://layout.test/synthetic.mp4' : 'abcdefghijk' } : {}),
  ...(recap ? { correctAnswer: answer, revealedAnswer: answer } : {}),
  ...(scenario === 'photo' ? { answerImage: 'https://layout.test/answer.svg', answerExplanation: 'Film získal v roce 1968 Oscara za nejlepší cizojazyčný film.' } : {}),
};
function AnswerLengthAudit() {
  const [correctAnswer, setCorrectAnswer] = React.useState(longAnswer.repeat(43).slice(0, 20_000));
  const slide = React.useMemo(() => mapEditorSlide('synthetic-answer-length', {
    kind: 'free', isQuestion: true, position: 1, title: 'Kdo režíroval film Ostře sledované vlaky?',
    correctAnswer, roundId: 'round-2',
  }), [correctAnswer]);
  const errors = validateQuestion(slide).filter(issue => issue.severity === 'error');
  return <>
    <AnswerLengthWarning slide={slide} quizTitle="Měření rekapitulace" />
    <output data-testid="question-validation-errors">{errors.length}</output>
    <button type="button" onClick={() => setCorrectAnswer('Jiří Menzel')}>Zkrátit odpověď</button>
  </>;
}

createRoot(document.getElementById('root')!).render(
  scenario === 'answer-length-warning' ? <AnswerLengthAudit /> : <div style={{ width: '100vw', height: params.get('canvas') === '4:3' ? '75vw' : '56.25vw', maxHeight: '100vh', margin: 0 }}>
    {params.get('surface') === 'editor'
      ? <SlidePreview slide={slide} quizTitle="Filmový večer" showAnswer />
      : <SlideRenderer slide={slide} quizTitle="Filmový večer" mode={recap ? 'recap' : 'question'} mediaCommand="play" />}
  </div>,
);
