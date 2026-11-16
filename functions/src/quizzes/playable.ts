import { visibleSlidePosition } from '@filmovy-kviz/quiz-domain';
import { HttpsError } from 'firebase-functions/v2/https';

/** Technical navigation contract, independent of the optional editorial review. */
export function assertPlayableQuizSource(slideCount: unknown, source: readonly Record<string, unknown>[]): void {
  if (!Number.isSafeInteger(slideCount) || (slideCount as number) < 1 || slideCount !== source.length) {
    throw new HttpsError('failed-precondition', 'Quiz has no complete ordered slide source.');
  }
  const slides = [...source].sort((left, right) => Number(left.position) - Number(right.position));
  for (const [index, slide] of slides.entries()) {
    if (slide.position !== index + 1 || typeof slide.kind !== 'string' || slide.kind.trim() === '') {
      throw new HttpsError('failed-precondition', 'Quiz slide order or kind is malformed.');
    }
  }
  const navigation = slides.map(slide => ({
    position: slide.position as number, kind: slide.kind as string,
    isQuestion: slide.isQuestion === true, hidden: slide.hidden === true,
    ...(typeof slide.roundId === 'string' ? { roundId: slide.roundId } : {}),
  }));
  if (visibleSlidePosition(navigation, 0, 1) === undefined) {
    throw new HttpsError('failed-precondition', 'Quiz has no visible slides.');
  }
}
