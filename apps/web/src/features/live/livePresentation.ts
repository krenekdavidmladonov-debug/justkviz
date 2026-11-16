import type { LiveControlSlide, LiveControlState } from './types';

const roundBoundaryKinds = new Set(['round', 'roundheader', 'round-header', 'section', 'recap']);

export interface RecapQuestionChoice {
  readonly localNumber: number;
  readonly slide: LiveControlSlide;
}

export function isMediaSlide(slide?: LiveControlSlide): boolean {
  return slide !== undefined && ['audio', 'music', 'video', 'youtube'].includes(slide.kind.toLowerCase());
}

export function isAudioSlide(slide?: LiveControlSlide): boolean {
  return slide !== undefined && ['audio', 'music'].includes(slide.kind.toLowerCase());
}

export function isIntroSlide(slide?: LiveControlSlide): boolean {
  return slide !== undefined && ['intro', 'round', 'roundheader', 'round-header', 'section'].includes(slide.kind.toLowerCase());
}

export function liveMediaSource(slide?: LiveControlSlide): string | undefined {
  if (!slide) return undefined;
  if (slide.mediaSource) return slide.mediaSource;
  const kind = isAudioSlide(slide) ? 'audio' : 'video';
  return slide.media.find((item) => item.role === 'prompt' && item.kind === kind)?.source;
}

export function recapQuestionChoices(
  anchor: LiveControlSlide,
  slides: readonly LiveControlSlide[],
): readonly RecapQuestionChoice[] {
  let questions: readonly LiveControlSlide[];
  if (anchor.roundId) {
    questions = slides.filter((slide) => (
      slide.isQuestion && slide.roundId === anchor.roundId && slide.position < anchor.position
    ));
  } else {
    const boundary = [...slides].reverse().find((slide) => (
      slide.position < anchor.position && roundBoundaryKinds.has(slide.kind.toLowerCase())
    ));
    questions = slides.filter((slide) => (
      slide.isQuestion && slide.position < anchor.position && slide.position > (boundary?.position ?? 0)
    ));
  }
  return [...questions]
    .sort((left, right) => left.position - right.position)
    .map((slide, index) => ({ localNumber: index + 1, slide }));
}

export function humanSlideLabel(slide?: LiveControlSlide): string {
  if (!slide) return 'Čeká na spuštění';
  const kind = slide.kind.toLowerCase();
  if (['question', 'text', 'classic'].includes(kind)) return 'Otázka';
  if (kind === 'free') return 'Otázka s volnou odpovědí';
  if (['image', 'picture', 'photo'].includes(kind)) return 'Obrázková otázka';
  if (['audio', 'music'].includes(kind)) return 'Audio otázka';
  if (['video', 'youtube'].includes(kind)) return 'Video otázka';
  if (kind === 'intro') return 'Úvod kvízu';
  if (['round', 'roundheader', 'round-header', 'section'].includes(kind)) return 'Úvod kola';
  if (kind === 'agenda') return 'Program';
  if (kind === 'rules') return 'Pravidla';
  if (kind === 'recap') return 'Rekapitulace';
  if (kind === 'end') return 'Závěr kvízu';
  if (kind === 'thank-you') return 'Poděkování před vyhlášením';
  if (kind === 'pl') return 'Pravda / lež';
  return 'Obsah kvízu';
}

export function liveStatusLabel(status: LiveControlState['status']): string {
  if (status === 'waiting') return 'Čeká na spuštění';
  if (status === 'active') return 'Probíhá';
  return 'Ukončeno';
}

export function currentRoundLabel(currentSlide?: LiveControlSlide): string {
  return currentSlide?.roundTitle?.trim() || 'Aktuální kolo';
}

export function currentQuestionLabel(
  session: LiveControlState,
  currentSlide: LiveControlSlide | undefined,
  presentedSlide: LiveControlSlide | undefined,
  slides: readonly LiveControlSlide[],
): string {
  if (session.presentationMode === 'recap' && currentSlide) {
    const choices = recapQuestionChoices(currentSlide, slides);
    const selected = choices.find((choice) => choice.slide.id === presentedSlide?.id);
    return selected ? `Otázka ${selected.localNumber} / ${choices.length}` : 'Rekapitulace';
  }
  if (!presentedSlide?.isQuestion) return humanSlideLabel(currentSlide);
  const nextRecap = slides.find((slide) => (
    slide.position > presentedSlide.position
    && slide.kind.toLowerCase() === 'recap'
    && (!presentedSlide.roundId || slide.roundId === presentedSlide.roundId)
  ));
  const questions = slides.filter((slide) => (
    slide.isQuestion
    && (!presentedSlide.roundId || slide.roundId === presentedSlide.roundId)
    && (nextRecap === undefined || slide.position < nextRecap.position)
  )).sort((left, right) => left.position - right.position);
  const localIndex = questions.findIndex((slide) => slide.id === presentedSlide.id);
  if (localIndex < 0) return humanSlideLabel(presentedSlide);
  return `Otázka ${localIndex + 1} / ${questions.length}`;
}
