import type { StoredEditorSlide } from './model.js';
import type { EditorSlideKind } from './types.js';

/** These IDs are local to a newly created quiz, including its derived round. */
export function starterSlides(quizTitle: string): StoredEditorSlide[] {
  const round = { roundId: 'starter-round' };
  function slide(kind: EditorSlideKind, title: string, fields: Record<string, unknown> = {}): StoredEditorSlide {
    return { id: 'starter-' + kind, data: {
      kind, title, text: '', options: [], correctAnswer: '', moderatorNote: '', media: [], presentation: {},
      isQuestion: kind === 'free', ...fields,
    } };
  }
  return [
    slide('intro', quizTitle),
    slide('rules', 'Pravidla'),
    slide('agenda', 'Harmonogram', { automaticAgenda: true, generatedAgendaSlide: true }),
    slide('round', '1. kolo', round),
    slide('free', '', { ...round, answerMode: 'open', authoringStatus: 'draft' }),
    slide('recap', '1. kolo', round),
    slide('thank-you', 'Děkujeme, že jste hráli!'),
    slide('end', 'Konec kvízu'),
  ];
}
