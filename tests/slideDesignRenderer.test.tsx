import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { SlideRenderer } from '../apps/web/src/features/presentation/SlideRenderer';
import { SlidePreview } from '../apps/web/src/features/presentation/SlidePreview';
import { slideDesignStyle } from '../apps/web/src/features/presentation/design';
import { ResultsTable } from '../apps/web/src/features/leaderboard/ResultsTable';
import { FinalRevealView } from '../apps/web/src/features/final-reveal/FinalRevealView';
import { mapPublicLiveState } from '../apps/web/src/features/live/liveMappers';
import type { SlideDesign } from '../packages/quiz-domain/src/index';

const slide = { kind: 'question', title: 'Které město hledáme?', text: 'Napište svůj tip.', options: ['Praha', 'Brno'], media: [], questionNumber: 2, questionCount: 8, roundTitle: 'Česká města' };
const rows = [{ rank: 1, teamName: 'Sovy', halfPoints: 37 }, { rank: 1, teamName: 'Lišky', halfPoints: 37 }];

describe('shared viewer appearance', () => {
  test('ordinary recap preview uses the same recap mode and fallback copy as projection', () => {
    const recap = { kind: 'recap', title: 'Ohlédnutí za kolem', text: '', options: [], media: [] };
    const preview = renderToStaticMarkup(<SlidePreview slide={recap} quizTitle="Večer" />);
    const projection = renderToStaticMarkup(<SlideRenderer slide={recap} quizTitle="Večer" />);
    for (const html of [preview, projection]) {
      expect(html).toContain('mode-recap');
      expect(html).toContain('REKAPITULACE KOLA');
      expect(html).toContain('Moderátor postupně zobrazí vybrané odpovědi.');
    }
  });
  test.each(['intro', 'rules', 'agenda', 'round', 'question', 'image', 'audio', 'video', 'recap', 'end', 'info'])('%s renders content with the same proportional design contract', kind => {
    const html = renderToStaticMarkup(<SlideRenderer quizTitle="Večer ve městě" slide={{ ...slide, kind, design: { fontFamily: 'serif', fontScale: 1.2, textAlign: 'center', layout: 'centered', accentColor: '#00aabb' } }} />);
    expect(html).toContain(slide.title);
    if (kind !== 'recap') expect(html).toContain(slide.text);
    const fixedLayout = ['image', 'audio', 'video'].includes(kind) ? 'split' : kind === 'question' ? 'classic' : undefined;
    expect(html).toContain(fixedLayout ? 'layout-' + fixedLayout : 'layout-centered');
    expect(html).toContain(fixedLayout ? 'align-left' : 'align-center');
    expect(html).toContain('--slide-scale:1.2');
    expect(html).toContain('--slide-gold:#00aabb');
    expect(html).not.toContain('SPRÁVNÁ ODPOVĚĎ');
  });

  test('picture questions retain copy on the left and their uncut picture on the right through explicit reveal', () => {
    const picture = { ...slide, kind: 'image', questionImage: 'http://127.0.0.1:5199/photo.jpg', imageLayout: 'stacked',
      design: { layout: 'image-first', textAlign: 'right', textWidth: 70, mediaFit: 'cover' } as const,
      answerImage: 'http://127.0.0.1:5199/private-answer.png' };
    const question = renderToStaticMarkup(<SlideRenderer quizTitle="Večer" slide={picture} />);
    const reveal = renderToStaticMarkup(<SlideRenderer quizTitle="Večer" mode="recap" slide={{ ...picture, revealedAnswer: 'Brno' }} />);
    const preview = renderToStaticMarkup(<SlidePreview quizTitle="Večer" slide={{ ...picture, correctAnswer: 'Brno' }} showAnswer />);
    for (const html of [question, reveal, preview]) {
      expect(html).toContain('layout-split align-left');
      expect(html).toContain('fixed-photo-question');
      expect(html).toContain('--slide-media-fit:contain');
      expect(html.indexOf('fixed-photo-copy')).toBeLessThan(html.indexOf('question-image-frame'));
      expect(html.indexOf('slide-options')).toBeLessThan(html.indexOf('question-image-frame'));
    }
    expect(question).not.toContain('private-answer.png');
    expect(reveal).toContain('private-answer.png');
    expect(preview).toContain('private-answer.png');
  });

  test.each(['info', 'image'])('a standalone %s photo gets the full canvas without authoring chrome', kind => {
    const photo = 'http://127.0.0.1:5199/photo.png';
    const html = renderToStaticMarkup(<SlideRenderer quizTitle="Večer" slide={{ kind, title: ' ', text: '', options: [], media: [],
      ...(kind === 'info' ? { backgroundImage: photo } : { questionImage: photo }),
      design: { layout: 'centered', mediaFit: 'cover' },
    }} />);
    expect(html).toContain('layout-photo-only');
    expect(html).toContain('full-slide-photo');
    expect(html).toContain('Fotografie na snímku');
    expect(html).not.toContain('slide-brand');
    expect(html).not.toContain('slide-background-overlay');
  });

  test.each(['question', 'intro'])('number, round and logo controls apply to %s without modifying content', kind => {
    const html = renderToStaticMarkup(<SlideRenderer quizTitle="Večer" slide={{ ...slide, kind, design: { showLogo: false, showRoundTitle: false, showQuestionNumber: false } }} />);
    expect(html).toContain(slide.title);
    expect(html).not.toContain('OTÁZKA');
    expect(html).not.toContain('Česká města');
    expect(html).not.toContain('brand-wordmark');
  });

  test('private answer design is applied only in the explicit local answer preview', () => {
    const preview = { ...slide, correctAnswer: 'PRIVATE_ANSWER', design: { backgroundColor: '#102030' }, answerDesign: { backgroundColor: '#eeeeee', logoImage: 'https://example.test/ANSWER_ONLY.png' } };
    const question = renderToStaticMarkup(<SlidePreview quizTitle="Večer" slide={preview} />);
    expect(question).toContain('background:#102030');
    expect(question).not.toContain('PRIVATE_ANSWER');
    expect(question).not.toContain('ANSWER_ONLY');
    const answer = renderToStaticMarkup(<SlidePreview quizTitle="Večer" slide={preview} showAnswer />);
    expect(answer).toContain('background:#eeeeee');
    expect(answer).toContain('PRIVATE_ANSWER');
    expect(answer).toContain('ANSWER_ONLY');
  });

  test('untrusted appearance cannot inject arbitrary CSS or an unsafe media URL', () => {
    const style = slideDesignStyle({ backgroundColor: 'url(javascript:alert(1))', fontFamily: 'unsafe', fontScale: 999, logoImage: 'javascript:alert(1)' } as unknown as SlideDesign);
    expect(style).not.toHaveProperty('background');
    expect(style).not.toHaveProperty('fontFamily');
    expect(style).toMatchObject({ '--slide-scale': 1 });
  });

  test('result titles and appearance never replace authoritative ranks, names or half-point scores', () => {
    const template = { title: 'Dnešní hvězdy', subtitle: 'Díky za skvělou hru', design: { accentColor: '#00aabb', showLogo: false } };
    const interim = renderToStaticMarkup(<ResultsTable roundNumber={2} page={0} pageCount={1} rows={rows} template={template} />);
    expect(interim).toContain(template.title);
    expect(interim).toContain(template.subtitle);
    expect(interim).toContain('Sovy');
    expect(interim).toContain('Lišky');
    expect(interim).toContain('18,5');
    expect(interim).not.toContain('posun');
    const final = renderToStaticMarkup(<FinalRevealView versionId={'a'.repeat(64)} mode="group" rank={1} page={0} pageCount={1} groupSize={2} rows={rows} template={template} />);
    expect(final).toContain('is-winner');
    expect(final).toContain('1. místo');
    expect(final).toContain('sdílené umístění');
    expect(final).toContain('18,5');
    const intro = renderToStaticMarkup(<FinalRevealView versionId={'a'.repeat(64)} mode="intro" rank={null} page={0} pageCount={1} groupSize={0} rows={[]} template={template} />);
    expect(intro).not.toContain('Sovy');
    expect(intro).not.toContain('is-winner');
  });

  test('public mapping allowlists design and template copy without returning private design extensions', () => {
    const state = mapPublicLiveState('session', { quizTitle: 'Večer', status: 'active', slidePosition: 1, revision: 1, title: 'Pořadí', subtitle: 'Po druhém kole', design: { accentColor: '#aabbcc', correctAnswer: 'PRIVATE_CANARY' }, roundTitle: 'Města' });
    expect(state.design).toEqual({ accentColor: '#aabbcc' });
    expect(state.subtitle).toBe('Po druhém kole');
    expect(JSON.stringify(state)).not.toContain('PRIVATE_CANARY');
  });
});
