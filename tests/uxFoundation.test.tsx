// @vitest-environment happy-dom

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import { productConfig } from '../apps/web/src/config/product';
import { HumanError } from '../apps/web/src/ui/HumanError';
import { LiveModeratorView } from '../apps/web/src/features/live/LiveModeratorView';
import { recapQuestionChoices } from '../apps/web/src/features/live/livePresentation';
import { SlideRenderer } from '../apps/web/src/features/presentation/SlideRenderer';
import type { LiveControlSlide, LiveControlState, PublicLiveState } from '../apps/web/src/features/live/types';

const question = (id: string, position: number, kind = 'question'): LiveControlSlide => ({
  id,
  position,
  kind,
  isQuestion: true,
  roundId: 'round-a',
  roundTitle: 'První kolo',
  title: `Syntetická otázka ${position}`,
  text: 'Bezpečné syntetické zadání',
  options: ['Možnost A', 'Možnost B'],
  media: [],
  presentation: {},
  correctAnswer: `Syntetická odpověď ${position}`,
});

const baseSlides: readonly LiveControlSlide[] = [
  { id: 'round', position: 1, kind: 'round', isQuestion: false, roundId: 'round-a', roundTitle: 'První kolo', title: 'První kolo', text: '', options: [], media: [], presentation: {} },
  question('q-1', 2),
  question('q-2', 4),
  question('q-3', 5),
  question('q-4', 6),
  { id: 'recap', position: 7, kind: 'recap', isQuestion: false, roundId: 'round-a', roundTitle: 'První kolo', title: 'Rekapitulace', text: '', options: [], media: [], presentation: {} },
];

function session(patch: Partial<LiveControlState> = {}): LiveControlState {
  return {
    sessionId: 'safe-session-id',
    quizId: 'safe-quiz-id',
    quizTitle: 'Syntetický kvíz',
    slideCount: 7,
    status: 'active',
    currentSlidePosition: 2,
    currentSlideId: 'q-1',
    answerRevealed: false,
    presentationMode: 'slide',
    mediaCommand: 'idle',
    mediaPlaybackState: 'idle',
    mediaGeneration: 0,
    introGeneration: 0,
    revision: 42,
    ...patch,
  };
}

const noOp = () => undefined;

function moderatorMarkup({
  liveSession = session(),
  slides = baseSlides,
  current = baseSlides[1],
  presented = current,
  publicState,
}: {
  readonly liveSession?: LiveControlState;
  readonly slides?: readonly LiveControlSlide[];
  readonly current?: LiveControlSlide;
  readonly presented?: LiveControlSlide;
  readonly publicState?: PublicLiveState;
} = {}): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <LiveModeratorView
        session={liveSession}
        publicState={publicState}
        slides={slides}
        currentSlide={current}
        presentedSlide={presented}
        recapChoices={current?.kind === 'recap' ? recapQuestionChoices(current, slides) : []}
        pendingAction={null}
        error={null}
        projectorOpened={false}
        onOpenProjector={noOp}
        onPrevious={noOp}
        onNext={noOp}
        onGoToSlide={noOp}
        onSelectRecap={noOp}
        onPlay={noOp}
        onStop={noOp}
        onReplay={noOp}
        onEnd={noOp}
        onMediaFinished={noOp}
        onMediaError={noOp}
        onMediaPlayback={noOp}
      />
    </MemoryRouter>,
  );
}

function documentFor(markup: string): Document {
  const template = document.implementation.createHTMLDocument();
  template.body.innerHTML = markup;
  return template;
}

describe('UX foundation contracts', () => {
  test('moderator preview uses the published payload and does not reconstruct it from private answers', () => {
    const publicState: PublicLiveState = {
      sessionId: 'safe-session-id', quizTitle: 'Syntetický kvíz', status: 'active', slidePosition: 2, slideKind: 'question',
      answerRevealed: false, presentationMode: 'slide', mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 0, introGeneration: 0, revision: 42,
      title: 'Publikované zadání', text: 'Potvrzeno serverem', options: [], media: [], presentation: {}, renderMode: 'question',
    };
    const doc = documentFor(moderatorMarkup({ publicState }));
    const preview = doc.querySelector('.live-preview-stage');
    expect(preview?.textContent).toContain('Publikované zadání');
    expect(preview?.textContent).not.toContain('Syntetická odpověď');
    expect(doc.querySelector('[data-private-answer]')?.textContent).toContain('Syntetická odpověď');
    expect(doc.querySelector('.live-next-step')?.textContent).toContain('Syntetická otázka 4');
    expect(documentFor(moderatorMarkup()).querySelector('.live-preview-stage')?.textContent).toContain('Načítám obsah');
  });
  test('brand configuration and projector rendering preserve the public name', () => {
    expect(productConfig).toMatchObject({ name: 'JustKvíz', shortName: 'JK', adminLabel: 'JustKvíz' });
    const markup = renderToStaticMarkup(
      <SlideRenderer quizTitle="Syntetický kvíz" slide={{ kind: 'intro', title: 'Úvod', text: '', options: [], media: [] }} />,
    );
    expect(markup.replace(/<[^>]+>/g, '')).toContain(productConfig.name);
    expect(markup).not.toContain('FILMOVÝ KVÍZ');
  });

  test('live controls match intro, ordinary question, audio, and video content', () => {
    const ordinary = moderatorMarkup();
    expect(ordinary).toContain('Další →');
    expect(ordinary).not.toContain('Spustit intro');
    expect(ordinary).not.toContain('Pustit znovu');

    const intro: LiveControlSlide = { ...baseSlides[0]!, kind: 'intro' };
    expect(moderatorMarkup({ current: intro, presented: intro })).not.toContain('Spustit intro');

    for (const kind of ['audio', 'video'] as const) {
      const media = { ...question(`q-${kind}`, 3, kind), mediaSource: 'abcdefghijk' };
      const markup = moderatorMarkup({ current: media, presented: media, slides: [...baseSlides, media] });
      expect(markup).toContain('>Play<');
      expect(markup).toContain('>Stop<');
      expect(markup).toContain('Pustit znovu');
    }
  });

  test('moderator sees the private answer before controls while the revision stays collapsed', () => {
    const doc = documentFor(moderatorMarkup());
    const answer = doc.querySelector<HTMLElement>('[data-private-answer="true"]');
    const controls = doc.querySelector<HTMLElement>('.live-actions');
    const progress = doc.querySelector<HTMLElement>('.live-progress');
    const technical = doc.querySelector<HTMLDetailsElement>('.technical-details');
    expect(answer?.textContent).toContain('Syntetická odpověď 2');
    expect(answer && controls && (answer.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
    expect(progress?.textContent).not.toContain('42');
    expect(technical?.open).toBe(false);
    expect(technical?.textContent).toContain('42');
  });

  test('errors lead with a human explanation and keep a safe technical code collapsed', () => {
    const doc = documentFor(renderToStaticMarkup(
      <HumanError error={{ title: 'Akci se nepodařilo dokončit', message: 'Zkuste to znovu.', technicalCode: 'SAFE_ERROR_CODE' }} />,
    ));
    const alert = doc.querySelector('[role="alert"]');
    const details = doc.querySelector<HTMLDetailsElement>('details');
    expect(alert?.textContent).toContain('Akci se nepodařilo dokončit');
    expect(alert?.textContent).toContain('Zkuste to znovu.');
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain('SAFE_ERROR_CODE');
    expect(alert?.textContent).not.toContain('https://');
  });

  test('recap numbering is local to the round and independent of stored positions', () => {
    const recap = baseSlides.at(-1)!;
    const choices = recapQuestionChoices(recap, baseSlides);
    expect(choices.map(({ localNumber, slide }) => [localNumber, slide.position])).toEqual([[1, 2], [2, 4], [3, 5], [4, 6]]);
    const doc = documentFor(moderatorMarkup({
      liveSession: session({ currentSlidePosition: 7, currentSlideId: recap.id, presentationMode: 'recap', recapQuestionPosition: 4, recapQuestionId: 'q-2' }),
      current: recap,
      presented: baseSlides[2],
    }));
    expect([...doc.querySelectorAll('.recap-question-buttons button')].map((button) => button.textContent)).toEqual(['1', '2', '3', '4']);
    expect(doc.querySelector('button[aria-label="Zobrazit odpověď na otázku 2"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  test('mobile DOM order exposes moderator information and named controls before the collapsible preview', () => {
    const doc = documentFor(moderatorMarkup());
    const workspace = doc.querySelector('.live-workspace');
    expect([...workspace!.children].map((child) => child.className)).toEqual([
      'moderator-info-panel',
      'live-actions',
      'live-preview-panel',
    ]);
    const controls = [...doc.querySelectorAll<HTMLButtonElement>('.live-actions button')];
    expect(controls.length).toBeGreaterThan(3);
    expect(controls.every((button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim().length > 0)).toBe(true);
    expect(doc.querySelector<HTMLDetailsElement>('.live-preview-panel')?.open).toBe(true);
  });
});
