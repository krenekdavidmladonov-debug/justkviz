import { describe, expect, test } from 'vitest';

import type { EditorQuiz, EditorSlide } from '../apps/web/src/features/editor/types';
import { buildRepairQueue, nextRepairKey } from '../apps/web/src/features/preflight/repairQueue';
import { runQuizPreflight } from '../apps/web/src/features/preflight/validation';
import { applyPreflightRepair, requestedPreflightRepair } from '../functions/src/editor/repair';

function slide(values: Partial<EditorSlide>): EditorSlide {
  return {
    id: 'question-1', position: 1, storedKind: 'question', kind: 'question', isQuestion: true,
    roundId: 'round-1', roundTitle: 'Syntetické kolo', title: '', text: 'Syntetická otázka',
    moderatorNote: '', options: ['Možnost A', 'Možnost B', 'Možnost C', 'Možnost D'],
    correctAnswer: 'Historická syntetická hodnota', media: [],
    presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null },
    backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '', backgroundOverlay: null,
    clipStartSeconds: null, clipEndSeconds: null, hasLegacyData: true,
    ...values,
  };
}

function syntheticRepairQuiz(): EditorQuiz {
  const slides: EditorSlide[] = [];
  let position = 0;
  for (let round = 1; round <= 5; round += 1) {
    for (let question = 1; question <= 3; question += 1) {
      const optionCount = 4 + ((round + question) % 3);
      position += 1;
      slides.push(slide({
        id: `choice-${round}-${question}`,
        position,
        roundId: `round-${round}`,
        roundTitle: `Syntetické kolo ${round}`,
        text: `Syntetická otázka ${round}-${question}`,
        options: Array.from({ length: optionCount }, (_, index) => `Syntetická možnost ${index + 1}`),
      }));
    }
    if (round === 2) {
      position += 1;
      slides.push(slide({
        id: 'video-2-4', position, roundId: 'round-2', roundTitle: 'Syntetické kolo 2',
        storedKind: 'video', kind: 'video', options: [], correctAnswer: 'Syntetická odpověď',
        mediaSource: 'abcdefghijk', clipStartSeconds: 12, clipEndSeconds: 8,
      }));
    }
  }
  for (let warning = 1; warning <= 2; warning += 1) {
    position += 1;
    slides.push(slide({
      id: `image-warning-${warning}`, position, roundId: 'round-5', roundTitle: 'Syntetické kolo 5',
      storedKind: 'image', kind: 'image', options: [], correctAnswer: 'Syntetická odpověď',
      questionImage: `https://example.test/synthetic-${warning}.jpg`,
    }));
  }
  return {
    id: 'synthetic-repair', title: 'Syntetický repair kvíz', description: '', revision: 0,
    slideCount: slides.length, questionCount: slides.length, roundCount: 5, slides,
  };
}

describe('guided preflight repair queue', () => {
  test('orders 15 ambiguous Choice issues and one Video timing issue from shared preflight', () => {
    const quiz = syntheticRepairQuiz();
    const result = runQuizPreflight(quiz);
    const queue = buildRepairQueue(quiz, result);
    expect(result.blockerCount).toBe(16);
    expect(result.warningCount).toBe(6);
    expect(result.issues.filter(issue => issue.code === 'MEDIA_NOT_OFFLINE')).toHaveLength(3);
    expect(queue).toHaveLength(16);
    expect(queue.filter((item) => item.kind === 'choice-answer')).toHaveLength(15);
    expect(queue.filter((item) => item.kind === 'video-timing')).toHaveLength(1);
    expect(queue.slice(0, 3).map((item) => item.issue.reference.questionNumber)).toEqual([1, 2, 3]);
    expect(queue.map((item) => item.slide?.options.length)).toEqual(expect.arrayContaining([4, 5, 6]));
  });

  test('selects the next still-authoritative issue after the saved issue disappears', () => {
    const quiz = syntheticRepairQuiz();
    const queue = buildRepairQueue(quiz, runQuizPreflight(quiz));
    expect(nextRepairKey(queue, queue[0]!.key, queue.slice(1))).toBe(queue[1]!.key);
    expect(nextRepairKey(queue, queue.at(-1)!.key, queue.slice(0, -1))).toBe(queue[0]!.key);
  });

  test('builds a larger queue in bounded time without reading per issue', () => {
    const base = syntheticRepairQuiz();
    const slides = Array.from({ length: 20 }, (_, copy) => base.slides.map((item, index) => ({
      ...item, id: `${copy}-${item.id}`, position: copy * base.slides.length + index + 1, roundId: `${copy}-${item.roundId}`,
    }))).flat();
    const large = { ...base, slides, slideCount: slides.length, questionCount: slides.length, roundCount: 100 };
    const started = performance.now();
    const queue = buildRepairQueue(large, runQuizPreflight(large));
    expect(queue).toHaveLength(320);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('trusted repair patch', () => {
  const stored = (optionCount = 6) => ({
    id: 'stored-choice',
    data: {
      kind: 'question', isQuestion: true,
      options: Array.from({ length: optionCount }, (_, index) => `Option ${index + 1}`),
      correctAnswer: 'Historical answer',
      legacy: { raw: { correct: 'Historical answer', opaque: ['keep', 42] } },
      futureField: { preserve: true },
    },
  });

  test.each([4, 5, 6])('patches only a human-selected option for %i options and preserves lossless data', (count) => {
    const original = stored(count);
    const result = applyPreflightRepair(original, { kind: 'choice-answer', optionIndex: count - 1 });
    expect(result.slide.data.correctAnswer).toBe(`Option ${count}`);
    expect(result.slide.data.legacy).toEqual(original.data.legacy);
    expect(result.slide.data.futureField).toEqual({ preserve: true });
    expect(result.privateCorrectAnswer).toBe(`Option ${count}`);
  });

  test('rejects invalid, missing, duplicate, or smuggled option selections', () => {
    expect(() => applyPreflightRepair(stored(4), { kind: 'choice-answer', optionIndex: 4 })).toThrow('no longer exists');
    expect(() => applyPreflightRepair({
      ...stored(4), data: { ...stored(4).data, options: ['Same', 'Same', 'Third', 'Fourth'] },
    }, { kind: 'choice-answer', optionIndex: 0 })).toThrow('exactly one');
    expect(() => requestedPreflightRepair({
      quizId: 'quiz', slideId: 'slide', expectedRevision: 1, kind: 'choice-answer', optionIndex: 0,
      correctAnswer: 'must-not-be-accepted',
    })).toThrow('unsupported fields');
  });

  test('accepts explicit valid Video timing and rejects inferred or invalid ranges', () => {
    const video = {
      id: 'stored-video',
      data: {
        kind: 'video', isQuestion: true, mediaSource: 'abcdefghijk',
        clipStartSeconds: 7, clipEndSeconds: 3,
        legacy: { raw: { videoStart: 7, videoEnd: 3 } }, futureField: 'keep',
      },
    };
    expect(() => requestedPreflightRepair({
      quizId: 'quiz', slideId: 'video', expectedRevision: 1, kind: 'video-timing',
      clipStartSeconds: 12, clipEndSeconds: 12,
    })).toThrow('START < END');
    const result = applyPreflightRepair(video, {
      kind: 'video-timing', clipStartSeconds: 12.5, clipEndSeconds: 31,
    });
    expect(result.slide.data).toMatchObject({ clipStartSeconds: 12.5, clipEndSeconds: 31, futureField: 'keep' });
    expect(result.slide.data.legacy).toEqual(video.data.legacy);
  });

  test('sanitized repair result shape does not require private values', () => {
    const publicMutationResult = {
      quizId: 'quiz', revision: 2, slideCount: 3, questionCount: 1, roundCount: 1, selectedSlideId: 'slide',
    };
    expect(JSON.stringify(publicMutationResult)).not.toContain('Historical answer');
    expect(publicMutationResult).not.toHaveProperty('correctAnswer');
  });
});
