import { describe, expect, test } from 'vitest';

import { mapSnapshotToPrintEvent } from '../functions/src/print/snapshot-mapper';
import { parsePrintOptions, parsePrintRequestOptions } from '../functions/src/print/validation';

function question(data: Record<string, unknown> = {}) {
  return {
    id: 'private-question',
    data: {
      position: 1, roundId: 'round-one', isQuestion: true, kind: 'question',
      correctAnswer: 'Druhá', options: ['První', 'Druhá'],
      ...data,
    },
  };
}

function mapQuestion(data: Record<string, unknown> = {}) {
  return mapSnapshotToPrintEvent(
    { title: 'Připravená akce' },
    { status: 'ready', quizTitle: 'Připravený kvíz' },
    [{ id: 'round-one', data: { position: 1, title: 'První kolo' } }],
    [question(data)],
  ).quiz.rounds[0]!.questions[0]!;
}

describe('prepared print response semantics', () => {
  test.each([2, 3, 4, 5, 6])('keeps exactly %i options without exposing their text in player layout metadata', count => {
    const options = Array.from({ length: count }, (_, index) => `Soukromá možnost ${index}`);
    const result = mapQuestion({ answerMode: 'choice', options, correctAnswer: options[count - 1] });
    expect(result).toEqual({
      number: 1, kind: 'choice', answerMode: 'choice', choiceCount: count,
      answer: options[count - 1], choiceLabel: String.fromCharCode(64 + count),
    });
    expect(Object.keys(result)).not.toContain('options');
  });

  test.each(['image', 'audio', 'video'])('%s media supports both single choice and open responses', kind => {
    expect(mapQuestion({ kind, answerMode: 'choice' })).toMatchObject({ kind, answerMode: 'choice', choiceCount: 2 });
    expect(mapQuestion({ kind, answerMode: 'open', options: [] })).toEqual({ number: 1, kind, answerMode: 'open', answer: 'Druhá' });
    expect(mapQuestion({ kind })).toMatchObject({ kind, answerMode: 'choice', choiceCount: 2 });
    expect(mapQuestion({ kind, options: [] })).toEqual({ number: 1, kind, answerMode: 'open', answer: 'Druhá' });
  });

  test('uses domain legacy text and media aliases without treating question kind as a fixed ABCD shape', () => {
    expect(mapQuestion({ kind: 'question', options: [] })).toMatchObject({ kind: 'free', answerMode: 'open' });
    expect(mapQuestion({ kind: 'question', options: ['Legacy note'] })).toMatchObject({ kind: 'free', answerMode: 'open' });
    expect(mapQuestion({ kind: 'classic' })).toMatchObject({ kind: 'choice', answerMode: 'choice', choiceCount: 2 });
    expect(mapQuestion({ kind: 'choice' })).toMatchObject({ kind: 'choice', answerMode: 'choice', choiceCount: 2 });
    expect(mapQuestion({ kind: 'text', answerMode: 'open', options: [] })).toMatchObject({ kind: 'free', answerMode: 'open' });
    expect(mapQuestion({ kind: 'music' })).toMatchObject({ kind: 'audio', answerMode: 'choice', choiceCount: 2 });
    expect(mapQuestion({ kind: 'photo' })).toMatchObject({ kind: 'image', answerMode: 'choice', choiceCount: 2 });
    expect(mapQuestion({ kind: 'youtube', options: [] })).toMatchObject({ kind: 'video', answerMode: 'open' });
  });

  test('matches the authoritative single-choice answer resolution for normalized values and stored letters', () => {
    expect(mapQuestion({ correctAnswer: '  dRuHÁ  ' })).toMatchObject({ answer: 'Druhá', choiceLabel: 'B' });
    expect(mapQuestion({ correctAnswer: 'b' })).toMatchObject({ answer: 'Druhá', choiceLabel: 'B' });
    // Literal option content takes precedence over interpreting it as a letter.
    expect(mapQuestion({ options: ['B', 'Jiné'], correctAnswer: 'B' })).toMatchObject({ answer: 'B', choiceLabel: 'A' });
  });

  test.each(['Pravda', 'Lež', 'true', 'false', 'ano', 'ne', '1', '0'])('retains legacy P/L response semantics for %s', answer => {
    expect(mapQuestion({ kind: 'pl', options: [], correctAnswer: answer })).toEqual({ number: 1, kind: 'pl', answerMode: 'true-false', answer });
  });

  test.each([
    { answerMode: 'choice', options: ['Pouze jedna'] },
    { options: Array.from({ length: 7 }, (_, index) => `Možnost ${index}`) },
    { options: ['První', ''] },
    { options: ['První', 2] },
    { options: ['První', ' první '] },
    { answerMode: 'open' },
    { kind: 'free', answerMode: 'choice' },
    { answerMode: 'multiple' },
    { correctAnswer: 'Neexistující možnost' },
    { kind: 'pl', options: [], correctAnswer: 'Nevím' },
  ])('rejects invalid or unsupported response data rather than guessing a player layout: %j', data => {
    expect(() => mapQuestion(data)).toThrowError();
  });

  test('numbers the exact prepared round and question order and drops non-print private fields', () => {
    const result = mapSnapshotToPrintEvent(
      { title: 'Akce', libraryQuiz: { correctAnswer: 'UNSAVED LIBRARY ANSWER' } },
      { status: 'ready', quizTitle: 'Uzamčený název' },
      [
        { id: 'round-two', data: { position: 2, title: 'Druhé' } },
        { id: 'round-one', data: { position: 1, title: 'První' } },
      ],
      [
        question({ position: 4, roundId: 'round-two', options: [], correctAnswer: 'Připravená čtvrtá' }),
        question({ position: 2, options: [], correctAnswer: 'Připravená druhá', text: 'PRIVATE PROMPT', moderatorNote: 'PRIVATE NOTE', mediaSource: 'PRIVATE MEDIA' }),
        question({ position: 1, options: [], correctAnswer: 'Připravená první' }),
        question({ position: 3, isQuestion: false, kind: 'recap', correctAnswer: 'PRIVATE RECAP' }),
      ],
    );
    expect(result.quiz.title).toBe('Uzamčený název');
    expect(result.quiz.rounds.map(round => [round.number, round.title, round.questions.map(item => [item.number, item.answer])])).toEqual([
      [1, 'První', [[1, 'Připravená první'], [2, 'Připravená druhá']]],
      [2, 'Druhé', [[1, 'Připravená čtvrtá']]],
    ]);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|UNSAVED|libraryQuiz|correctAnswer|options|mediaSource|moderatorNote/u);
  });
});

describe('print presentation allowlist', () => {
  test.each(['color', 'grayscale'])('accepts %s on requests and trusted render options', colorMode => {
    const request = { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', colorMode };
    expect(parsePrintRequestOptions(request)).toEqual(request);
    expect(parsePrintOptions({ ...request, teams: [] })).toEqual({ ...request, teams: [] });
    expect(parsePrintRequestOptions({ artifactType: 'answer-key', disposition: 'inline', colorMode })).toMatchObject({ colorMode });
    expect(parsePrintRequestOptions({ artifactType: 'organizer-sheets', disposition: 'inline', colorMode })).toEqual({ artifactType: 'organizer-sheets', disposition: 'inline', colorMode });
    expect(parsePrintOptions({ artifactType: 'organizer-sheets', disposition: 'inline', colorMode })).toEqual({ artifactType: 'organizer-sheets', disposition: 'inline', colorMode });
  });

  test.each([null, true, 1, '', 'black-and-white', { accent: '#ffffff' }])('rejects invalid color mode %j', colorMode => {
    expect(() => parsePrintRequestOptions({ artifactType: 'answer-key', disposition: 'inline', colorMode })).toThrowError();
    expect(() => parsePrintOptions({ artifactType: 'answer-key', disposition: 'inline', colorMode })).toThrowError();
    expect(() => parsePrintRequestOptions({ artifactType: 'organizer-sheets', disposition: 'inline', colorMode })).toThrowError();
    expect(() => parsePrintOptions({ artifactType: 'organizer-sheets', disposition: 'inline', colorMode })).toThrowError();
  });

  test('response metadata cannot be supplied by the browser', () => {
    for (const patch of [{ answerMode: 'open' }, { choiceCount: 2 }, { options: ['A', 'B'] }, { correctAnswer: 'A' }]) {
      expect(() => parsePrintRequestOptions({ artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', ...patch })).toThrowError();
      expect(() => parsePrintRequestOptions({ artifactType: 'organizer-sheets', disposition: 'inline', ...patch })).toThrowError();
      expect(() => parsePrintOptions({ artifactType: 'organizer-sheets', disposition: 'inline', ...patch })).toThrowError();
    }
  });
});
