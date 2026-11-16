import { correctOptionIndex, mapEditorSlide, normalizePrintTemplate, semanticQuestionType } from '@filmovy-kviz/quiz-domain';
import { PrintCenterError } from './errors.js';
import { PRINT_LIMITS } from './limits.js';
import type { PrintEvent, PrintQuestion } from './types.js';

interface SnapshotDocument {
  id: string;
  data: Record<string, unknown>;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 500) {
    throw new PrintCenterError(422, 'invalid-snapshot', `Snapshot nemá platné pole ${field}.`);
  }
  return value.trim().normalize('NFC');
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new PrintCenterError(422, 'invalid-snapshot', `Snapshot nemá platné pole ${field}.`);
  }
  return value as number;
}

function invalidAnswer(): never {
  throw new PrintCenterError(422, 'invalid-snapshot', 'Snapshot nemá platný režim odpovědi nebo možnosti otázky.');
}

function printQuestion(slide: SnapshotDocument): Omit<PrintQuestion, 'number'> {
  // Use the same private source mapper and response rules as snapshot readiness.
  // Nothing from this intermediate editor model is returned to the browser.
  const data = slide.data;
  if (data.answerMode !== undefined && data.answerMode !== 'open' && data.answerMode !== 'choice') invalidAnswer();
  let mapped;
  try {
    // The existing print boundary also accepted the historical "choice" alias.
    mapped = mapEditorSlide(slide.id, data.kind === 'choice' ? { ...data, kind: 'question' } : data);
  } catch {
    throw new PrintCenterError(422, 'invalid-snapshot', 'Snapshot obsahuje neplatnou otázku.');
  }
  const type = semanticQuestionType(mapped);
  if (type === 'legacy') {
    throw new PrintCenterError(422, 'invalid-snapshot', 'Snapshot obsahuje nepodporovaný typ otázky.');
  }
  const kind = type === 'legacy-pl' ? 'pl' : type;
  const answer = requiredText(data.correctAnswer, 'slide.correctAnswer');
  if ((mapped.answerMode === 'open' && mapped.options.length > 0)
    || (mapped.answerMode === 'choice' && mapped.kind === 'free')) invalidAnswer();

  const isChoice = mapped.answerMode === 'choice'
    || (mapped.answerMode !== 'open'
      && (type === 'choice' || (['image', 'audio', 'video'].includes(type) && mapped.options.length > 0)));
  if (isChoice) {
    // Preserve positions exactly; never drop blank options or truncate a source.
    if (!Array.isArray(data.options) || !data.options.every(option => typeof option === 'string' && option.trim() !== '')
      || mapped.options.length < 2 || mapped.options.length > 6
      || new Set(mapped.options.map(option => option.trim().toLocaleLowerCase('cs-CZ'))).size !== mapped.options.length) invalidAnswer();
    const index = correctOptionIndex(mapped);
    if (index === undefined) invalidAnswer();
    return {
      kind,
      answerMode: 'choice',
      choiceCount: mapped.options.length as NonNullable<PrintQuestion['choiceCount']>,
      answer: requiredText(mapped.options[index], 'slide.correctAnswer'),
      choiceLabel: String.fromCharCode(65 + index),
    };
  }
  if (type === 'legacy-pl') {
    if (!['pravda', 'lež', 'lez', 'true', 'false', 'ano', 'ne', '1', '0'].includes(answer.toLocaleLowerCase('cs-CZ'))) invalidAnswer();
    return { kind, answerMode: 'true-false', answer };
  }
  return { kind, answerMode: 'open', answer };
}

export function mapSnapshotToPrintEvent(
  eventData: Record<string, unknown>,
  snapshotData: Record<string, unknown>,
  roundDocuments: SnapshotDocument[],
  slideDocuments: SnapshotDocument[],
): PrintEvent {
  if (snapshotData.status !== 'ready') {
    throw new PrintCenterError(409, 'snapshot-not-ready', 'Snapshot kvízu není připravený pro tisk.');
  }
  if (roundDocuments.length === 0 || roundDocuments.length > PRINT_LIMITS.rounds) {
    throw new PrintCenterError(422, 'round-limit', 'Počet kol není vhodný pro tisk.');
  }
  if (slideDocuments.length > PRINT_LIMITS.slides) {
    throw new PrintCenterError(422, 'slide-limit', 'Snapshot obsahuje příliš mnoho slidů.');
  }

  const sortedRounds = [...roundDocuments].sort(
    (left, right) => positiveInteger(left.data.position, 'round.position') - positiveInteger(right.data.position, 'round.position'),
  );
  const roundIndex = new Map(sortedRounds.map((round, index) => [round.id, index]));
  const questionsByRound = sortedRounds.map(() => [] as Array<Omit<PrintQuestion, 'number'> & {
    position: number;
  }>);

  for (const slide of slideDocuments) {
    if (slide.data.isQuestion !== true) continue;
    const roundId = slide.data.roundId;
    if (typeof roundId !== 'string' || !roundIndex.has(roundId)) {
      throw new PrintCenterError(422, 'invalid-snapshot', 'Otázka nepatří do známého kola.');
    }
    const targetQuestions = questionsByRound[roundIndex.get(roundId)!];
    if (!targetQuestions) {
      throw new PrintCenterError(422, 'invalid-snapshot', 'Otázka nepatří do známého kola.');
    }
    targetQuestions.push({
      position: positiveInteger(slide.data.position, 'slide.position'),
      ...printQuestion(slide),
    });
  }

  const questionCount = questionsByRound.reduce((total, questions) => total + questions.length, 0);
  if (questionCount === 0 || questionCount > PRINT_LIMITS.questions) {
    throw new PrintCenterError(422, 'question-limit', 'Počet otázek není vhodný pro tisk.');
  }

  return {
    title: requiredText(eventData.title, 'event.title'),
    quiz: {
      title: requiredText(snapshotData.quizTitle, 'snapshot.quizTitle'),
      ...(snapshotData.printTemplate ? { printTemplate: normalizePrintTemplate(snapshotData.printTemplate) } : {}),
      rounds: sortedRounds.map((round, roundOffset) => ({
        number: roundOffset + 1,
        title: requiredText(round.data.title, 'round.title'),
        questions: (questionsByRound[roundOffset] ?? [])
          .sort((left, right) => left.position - right.position)
          .map((question, questionOffset) => ({
            number: questionOffset + 1,
            kind: question.kind,
            answerMode: question.answerMode,
            ...(question.choiceCount === undefined ? {} : { choiceCount: question.choiceCount }),
            answer: question.answer,
            ...(question.choiceLabel ? { choiceLabel: question.choiceLabel } : {}),
          })),
      })),
    },
  };
}

export function answerDisplay(answer: { answer: string; choiceLabel?: string }): string {
  return answer.choiceLabel ? `${answer.choiceLabel} — ${answer.answer}` : answer.answer;
}
