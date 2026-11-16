import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { buildSlideRenderModel, projectorMediaPlan, recapAnswer } from '../apps/web/src/features/presentation/model';
import { SlideRenderer } from '../apps/web/src/features/presentation/SlideRenderer';
import { SlidePreview } from '../apps/web/src/features/presentation/SlidePreview';

const choice = { kind: 'question', title: 'Kdo režíroval tento film?', text: '', options: ['Miloš Forman', 'Jiří Menzel', 'Věra Chytilová', 'Jan Svěrák'], media: [] };

describe('revealed recap answers', () => {
  test.each(['B', 'b', 'Jiří Menzel', ' jiří menzel '])('resolves %s to its option letter and full text', revealedAnswer => {
    expect(recapAnswer({ revealedAnswer, options: choice.options, isLegacyPl: false })).toEqual({ optionLetter: 'B', text: 'Jiří Menzel' });
    const html = renderToStaticMarkup(<SlideRenderer quizTitle="Filmový večer" mode="recap" slide={{ ...choice, revealedAnswer }} />);
    expect(html).toContain('class="slide-answer-letter">B</span>');
    expect(html).toContain('<strong>Jiří Menzel</strong>');
  });

  test('does not guess an option for unknown, duplicate or absent answer text', () => {
    expect(recapAnswer({ options: choice.options, isLegacyPl: false })).toBeUndefined();
    expect(recapAnswer({ revealedAnswer: 'E', options: choice.options, isLegacyPl: false })).toEqual({ text: 'E' });
    expect(recapAnswer({ revealedAnswer: 'Ano', options: ['Ano', 'Ano'], isLegacyPl: false })).toEqual({ text: 'Ano' });
    expect(recapAnswer({ revealedAnswer: 'false', options: ['Pravda', 'Lež'], isLegacyPl: true })).toEqual({ text: 'LEŽ' });
  });

  test('answer text, explanation and photo stay absent until an explicit answer preview or reveal', () => {
    const slide = { ...choice, correctAnswer: 'B', answerExplanation: 'PRIVATE_EXPLANATION', answerImage: 'https://example.test/PRIVATE_PHOTO.jpg' };
    const hidden = renderToStaticMarkup(<SlidePreview quizTitle="Filmový večer" slide={slide} />);
    expect(hidden).not.toContain('slide-answer-letter');
    expect(hidden).not.toContain('PRIVATE_');
    const unrevealedRecap = renderToStaticMarkup(<SlideRenderer quizTitle="Filmový večer" mode="recap" slide={slide} />);
    expect(unrevealedRecap).not.toContain('slide-answer');
    expect(unrevealedRecap).not.toContain('PRIVATE_');
    const revealed = renderToStaticMarkup(<SlidePreview quizTitle="Filmový večer" slide={slide} showAnswer />);
    expect(revealed).toContain('class="slide-answer-letter">B</span>');
    expect(revealed).toContain('<strong>Jiří Menzel</strong>');
    expect(revealed).toContain('PRIVATE_EXPLANATION');
    expect(revealed).toContain('PRIVATE_PHOTO');
  });

  test('the video question and player share the safe content area', () => {
    const html = renderToStaticMarkup(<SlideRenderer quizTitle="Filmový večer" mediaCommand="play" slide={{ ...choice, kind: 'video', mediaSource: 'abcdefghijk', questionNumber: 3, questionCount: 8 }} />);
    expect(html).toContain('video-layout video-presentation');
    expect(html).toContain('class="video-question-copy"');
    expect(html).toContain('OTÁZKA 3 / 8');
    expect(html).toContain('class="shared-media-frame video-media-frame"');
    expect(html).not.toContain('slide-answer-value');
  });

  test('an explicitly selected recap original stays distinguishable and plays from zero without the question clip limit', () => {
    const slide = { ...choice, kind: 'video', mediaSource: 'abcdefghijk', revealedAnswer: 'B', clipStartSeconds: 20, clipEndSeconds: 35, mediaPlaybackMode: 'original' as const };
    const model = buildSlideRenderModel(slide, 'recap');
    expect(model.mediaPlaybackMode).toBe('original');
    expect(projectorMediaPlan(model, 'play')).toEqual({ mountPlayer: true, showQuestion: true, vinylPlaying: false, startSeconds: 0 });
    expect(renderToStaticMarkup(<SlideRenderer quizTitle="Večer" slide={slide} mode="recap" mediaCommand="play" />)).toContain('data-media-playback-mode="original"');
    expect(buildSlideRenderModel(choice)).not.toHaveProperty('mediaPlaybackMode');
  });
});
