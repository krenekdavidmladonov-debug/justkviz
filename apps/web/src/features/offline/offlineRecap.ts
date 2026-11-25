import type { EditorSlide, OfflineEventManifest } from '@filmovy-kviz/quiz-domain';

export interface OfflineRecapChoice {
  readonly identity: string;
  readonly roundNumber: number;
  readonly questionNumber: number;
  readonly slide: EditorSlide;
}

const boundaries = new Set(['round', 'roundheader', 'round-header', 'section', 'recap']);

/** Resolve old packages from their ordered boundaries without changing their signed manifest. */
export function offlineRecapChoices(manifest: OfflineEventManifest, position: number): readonly OfflineRecapChoice[] {
  const slides = [...manifest.slides].sort((left, right) => left.position - right.position);
  const anchor = slides.find(slide => slide.position === position);
  if (!anchor || anchor.kind.toLowerCase() !== 'recap') return [];
  const boundary = slides.filter(slide => slide.position < position && boundaries.has(slide.kind.toLowerCase())).at(-1);
  const segment = slides.filter(slide => slide.isQuestion && slide.position < position && slide.position > (boundary?.position ?? 0));
  const headerRoundId = boundary?.kind.toLowerCase() !== 'recap' ? boundary?.roundId : undefined;
  const roundIds = new Set([...segment.flatMap(slide => slide.roundId ? [slide.roundId] : []), ...(headerRoundId ? [headerRoundId] : [])]);
  if (roundIds.size > 1 || (anchor.roundId && [...roundIds].some(id => id !== anchor.roundId))) return [];
  const roundId = anchor.roundId ?? [...roundIds][0];
  const round = manifest.rounds.find(item => item.id === roundId);
  const roundNumber = round?.position ?? slides.filter(slide => slide.kind.toLowerCase() === 'recap' && slide.position < position).length + 1;
  const identity = roundId ?? 'legacy:' + anchor.id;
  const questions = anchor.roundId
    ? slides.filter(slide => slide.isQuestion && slide.position < position
      && (slide.roundId === anchor.roundId || (!slide.roundId && segment.includes(slide))))
    : segment;
  return questions.map((slide, index) => ({
    identity: JSON.stringify([identity, slide.id]),
    roundNumber,
    questionNumber: index + 1,
    slide,
  }));
}

export function validOfflineRecap(manifest: OfflineEventManifest, slidePosition: number, revealPosition: number | null): boolean {
  return revealPosition !== null && offlineRecapChoices(manifest, slidePosition).some(choice => choice.slide.position === revealPosition);
}
