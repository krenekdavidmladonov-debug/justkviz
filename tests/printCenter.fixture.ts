import type { PrintEvent, PrintQuestionKind, PrintTeam } from '../functions/src/print/types';

export function syntheticPrintEvent(): PrintEvent {
  const kinds: PrintQuestionKind[] = ['choice', 'free', 'pl', 'audio', 'video', 'image'];
  return {
    title: 'Filmový večer: Žluťoučký kůň a příliš dlouhý název akce pro ověření sazby',
    quiz: {
      title: 'Syntetický kvíz bez produkčních dat',
      rounds: Array.from({ length: 5 }, (_, roundIndex) => ({
        number: roundIndex + 1,
        title: `Kolo ${roundIndex + 1} — české znaky ěščřžýáíé`,
        questions: Array.from({ length: 10 }, (_, questionIndex) => {
          const kind = kinds[(roundIndex * 10 + questionIndex) % kinds.length] ?? 'free';
          const answer = kind === 'pl'
            ? (questionIndex % 2 === 0 ? 'Pravda' : 'Lež')
            : kind === 'choice'
              ? 'Správná syntetická možnost B'
              : `Syntetická odpověď ${questionIndex + 1} s diakritikou a dlouhým textem, který bezpečně ověřuje zalamování bez skutečného obsahu.`;
          return {
            number: questionIndex + 1,
            kind,
            answerMode: kind === 'pl' ? 'true-false' : kind === 'choice' ? 'choice' : 'open',
            ...(kind === 'choice' ? { choiceCount: 4 as const } : {}),
            answer,
            ...(kind === 'choice' ? { choiceLabel: 'B' } : {}),
          };
        }),
      })),
    },
  };
}

export function syntheticTeams(count = 20): PrintTeam[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `team-${index + 1}`,
    name: index === count - 1
      ? `Tým ${index + 1} — Neobyčejně dlouhý český název Žluťoučkých koní`
      : `Tým ${String(index + 1).padStart(2, '0')}`,
  }));
}

export function syntheticSnapshotDocuments() {
  const rounds = Array.from({ length: 5 }, (_, index) => ({
    id: `round-${index + 1}`,
    data: { position: index + 1, title: `Syntetické kolo ${index + 1}` },
  }));
  const slides = rounds.flatMap((round, roundIndex) => Array.from({ length: 10 }, (_, questionIndex) => {
    const kind = questionIndex % 5 === 0 ? 'question' : questionIndex % 5 === 1 ? 'free' : questionIndex % 5 === 2 ? 'pl' : questionIndex % 5 === 3 ? 'audio' : 'video';
    return {
      id: `private-slide-${roundIndex + 1}-${questionIndex + 1}`,
      data: {
        roundId: round.id,
        position: roundIndex * 10 + questionIndex + 1,
        isQuestion: true,
        kind,
        correctAnswer: kind === 'question' ? 'Možnost B' : kind === 'pl' ? 'Pravda' : `Odpověď ${questionIndex + 1}`,
        options: kind === 'question' ? ['Možnost A', 'Možnost B', 'Možnost C'] : [],
        text: 'TAJNÝ TEXT OTÁZKY',
        moderatorNote: 'TAJNÁ POZNÁMKA',
        mediaSource: 'TAJNÉ-MEDIA-ID',
        legacy: { raw: 'TAJNÝ LEGACY RAW' },
      },
    };
  }));
  return { rounds, slides };
}

/** Six rounds and 67 questions, covering every supported response/media combination. */
export function longSyntheticPrintEvent(): PrintEvent {
  const event = syntheticPrintEvent();
  event.title = 'JustKvíz / Filmový večer';
  event.quiz.rounds = Array.from({ length: 6 }, (_, roundIndex) => ({
    number: roundIndex + 1,
    title: roundIndex === 3 ? 'Obrazy, hudba a příběhy z filmového světa' : 'Filmové kolo ' + (roundIndex + 1),
    questions: Array.from({ length: roundIndex === 0 ? 12 : 11 }, (_, questionIndex) => {
      const index = roundIndex * 11 + questionIndex;
      const kind: PrintQuestionKind = ['choice', 'free', 'audio', 'video', 'image', 'pl'][index % 6] as PrintQuestionKind;
      const choice = kind !== 'free' && kind !== 'pl' && index % 3 !== 0;
      return {
        number: questionIndex + 1,
        kind,
        answerMode: kind === 'pl' ? 'true-false' : choice ? 'choice' : 'open',
        ...(choice ? { choiceCount: (2 + index % 5) as 2 | 3 | 4 | 5 | 6, choiceLabel: 'B' } : {}),
        answer: kind === 'pl' ? 'Pravda' : 'TAJNÁ ODPOVĚĎ ' + (index + 1),
      };
    }),
  }));
  return event;
}
