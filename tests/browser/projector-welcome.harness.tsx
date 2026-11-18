import React from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectorWelcome } from '../../apps/web/src/features/presentation/ProjectorWelcome';
import { SlideRenderer } from '../../apps/web/src/features/presentation/SlideRenderer';
import '../../apps/web/src/styles/theme.css';
import '../../apps/web/src/styles/global.css';

const scene = new URLSearchParams(location.search).get('scene') ?? 'welcome';
const quizTitle = 'JustKvíz · filmový večer';
createRoot(document.getElementById('root')!).render(
  <main className="projector-shell"><div className="projector-viewport">
    {scene === 'welcome' ? <ProjectorWelcome quizTitle={quizTitle} />
      : <SlideRenderer quizTitle={quizTitle} mediaEnabled={false}
        slide={{ kind: scene === 'question' ? 'question' : 'round',
          title: scene === 'question' ? 'Kdo režíroval film Ostře sledované vlaky?' : 'Český film',
          roundNumber: 2, roundTitle: 'Český film', text: '', media: [],
          options: scene === 'question' ? ['Miloš Forman', 'Jiří Menzel', 'Věra Chytilová', 'Jan Svěrák'] : [],
          questionNumber: 3, questionCount: 8 }} />}
  </div></main>,
);
