/* global window, sessionStorage, document */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ShowModeRenderer } from '../../apps/web/src/features/show-mode/ShowModeRenderer';
import { SlideRenderer } from '../../apps/web/src/features/presentation/SlideRenderer';
import '../../apps/web/src/styles/theme.css';
import '../../apps/web/src/styles/global.css';

const initial = { sessionId: 'synthetic-projector-motion', quizTitle: 'JustKvíz · zkušební večer', status: 'active', slidePosition: 0, slideKind: 'round', roundNumber: 1, title: 'Města a jejich příběhy', text: '', options: [], media: [], presentation: {}, presentationMode: 'slide', renderMode: 'roundIntro', mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 0, introGeneration: 0, answerRevealed: false, revision: 1 };
let current = JSON.parse(sessionStorage.getItem('projector-motion') || 'null') || initial;
let projector = true;
const root = createRoot(document.getElementById('root'));
const rows = [{ rank: 1, teamName: 'Sovy', halfPoints: 49 }, { rank: 2, teamName: 'Lišky', halfPoints: 37 }, { rank: 2, teamName: 'Vydry', halfPoints: 37 }, { rank: 3, teamName: 'Jezevci', halfPoints: 21 }];
function render() {
  sessionStorage.setItem('projector-motion', JSON.stringify(current));
  flushSync(() => root.render(<main style={{ width: '100vw', height: '100vh', padding: 0 }}><ShowModeRenderer state={current} projector={projector}><SlideRenderer quizTitle={current.quizTitle} mode={current.renderMode} mediaCommand={current.mediaCommand} mediaPlaybackState={current.mediaPlaybackState} mediaGeneration={current.mediaGeneration} slide={{ ...current, kind: current.slideKind, title: current.title || '', text: current.text || '' }} /></ShowModeRenderer></main>));
}
window.projectorFixture = {
  scene(kind) {
    const base = { ...initial, revision: current.revision + 1, design: current.design };
    if (kind === 'question' || kind === 'answer' || kind === 'media' || kind === 'video' || kind === 'image') Object.assign(base, { slidePosition: 1, slideKind: kind === 'media' ? 'audio' : kind === 'video' ? 'video' : kind === 'image' ? 'image' : 'question', renderMode: kind === 'answer' ? 'recap' : 'question', title: 'Které město je naší tajnou odpovědí?', text: 'Řeka protéká centrem města a nad ní stojí starý kamenný most.', answerRevealed: kind === 'answer', ...(kind === 'video' ? { mediaSource: window.location.origin + '/tests/fixtures/media/synthetic.webm' } : {}), ...(kind === 'image' ? { questionImage: window.location.origin + '/tests/browser/projector-motion-image.svg' } : {}), ...(kind === 'answer' ? { revealedAnswer: 'Praha' } : {}) });
    if (['interim', 'final', 'classic', 'classic-final'].includes(kind)) Object.assign(base, { slidePosition: 2, title: 'Naše dnešní pořadí', text: '', [kind.includes('final') ? 'finalReveal' : 'interimResults']: { versionId: String(base.revision).padStart(64, 'a'), rows, roundNumber: 1, page: 0, pageCount: 1, presentationStyle: kind.includes('classic') ? 'table' : 'show', pageSize: 6, ...(kind.includes('final') ? { mode: 'table', rank: null, groupSize: 0 } : {}) } });
    current = base;
    render();
  },
  play() { current = { ...current, mediaCommand: 'play', mediaGeneration: current.mediaGeneration + 1, revision: current.revision + 1 }; render(); },
  reveal() { current = { ...current, ...(current.slideKind === 'audio' ? { mediaSource: window.location.origin + '/synthetic-motion.wav' } : {}), answerRevealed: true, revealedAnswer: 'Praha', renderMode: 'recap', revision: current.revision + 1 }; render(); },
  hide() { const { revealedAnswer, ...question } = current; void revealedAnswer; current = { ...question, answerRevealed: false, renderMode: 'question', revision: current.revision + 1 }; render(); },
  tick() { current = { ...current, revision: current.revision + 1, mediaGeneration: current.mediaGeneration + 1 }; render(); },
  enabled(enabled) { current = { ...current, design: { projectorAnimations: enabled }, revision: current.revision + 1 }; render(); },
  moderator(value) { projector = !value; render(); },
};
render();
