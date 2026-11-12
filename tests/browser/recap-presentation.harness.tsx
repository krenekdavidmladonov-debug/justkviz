import React from 'react';
import { createRoot } from 'react-dom/client';
import { SlideRenderer } from '../../apps/web/src/features/presentation/SlideRenderer';
import '../../apps/web/src/styles/global.css';
import '../../apps/web/src/styles/editor.css';
import '../../apps/web/src/features/presentation/presentation.css';

const scenario = new URLSearchParams(location.search).get('scenario') ?? 'choice';
const video = scenario.includes('video');
const recap = !scenario.startsWith('video');
const slide = {
  kind: video ? 'video' : 'question',
  title: video ? 'Ze kterého filmu pochází tato ukázka?' : 'Kdo režíroval film Ostře sledované vlaky?',
  text: video ? 'Podívejte se na celou ukázku a napište název filmu.' : '',
  options: video ? [] : ['Miloš Forman', 'Jiří Menzel', 'Věra Chytilová', 'Jan Svěrák'],
  media: [], questionNumber: 3, questionCount: 8, roundTitle: 'Český film',
  ...(video ? { mediaSource: scenario.includes('blocked') ? 'blocked' : scenario.includes('native') ? 'https://layout.test/synthetic.mp4' : 'abcdefghijk' } : {}),
  ...(recap ? { revealedAnswer: video ? 'Ostře sledované vlaky' : 'B' } : {}),
  ...(scenario === 'photo' ? { answerImage: 'https://layout.test/answer.svg', answerExplanation: 'Film získal v roce 1968 Oscara za nejlepší cizojazyčný film.' } : {}),
};
createRoot(document.getElementById('root')!).render(
  <div style={{ width: '100vw', height: '56.25vw', maxHeight: '100vh', margin: 0 }}>
    <SlideRenderer slide={slide} quizTitle="Filmový večer" mode={recap ? 'recap' : 'question'} mediaCommand="play" />
  </div>,
);
