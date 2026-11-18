import { describe, expect, test } from 'vitest';

import type { EditorQuiz, EditorSlide } from '../apps/web/src/features/editor/types';
import { preflightVisibleQuiz, runQuizPreflight } from '../apps/web/src/features/preflight/validation';

function slide(values: Partial<EditorSlide> = {}): EditorSlide {
  return {
    id: 'question-1', position: 1, storedKind: 'free', kind: 'free', isQuestion: true,
    roundId: 'round-1', roundTitle: 'První kolo', title: '', text: 'Syntetická otázka',
    moderatorNote: '', options: [], correctAnswer: 'Syntetická odpověď', media: [],
    presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null },
    backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '', backgroundOverlay: null,
    clipStartSeconds: null, clipEndSeconds: null, hasLegacyData: false,
    ...values,
  };
}

function quiz(slides: readonly EditorSlide[] = [slide()]): EditorQuiz {
  return {
    id: 'synthetic-quiz', title: 'Syntetický kvíz', description: '', revision: 0,
    slideCount: slides.length, questionCount: slides.filter((item) => item.isQuestion).length,
    roundCount: 1, slides,
  };
}

const codes = (value: ReturnType<typeof runQuizPreflight>) => value.issues.map((issue) => issue.code);

describe('whole-quiz preflight', () => {
  test('valid free question without a quiz intro is usable with a warning', () => {
    const result = runQuizPreflight(quiz());
    expect(result.status).toBe('READY_WITH_WARNINGS');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'QUIZ_INTRO_MISSING', severity: 'WARNING' }));
    expect(result.blockerCount).toBe(0);
    expect(result.validAnswerCount).toBe(1);
  });

  test('valid choice has one unambiguous correct option', () => {
    const question = slide({ kind: 'question', storedKind: 'question', options: ['První', 'Druhá'], correctAnswer: 'B' });
    expect(runQuizPreflight(quiz([question])).status).toBe('READY_WITH_WARNINGS');
  });

  test('choice without one valid correct option is blocked', () => {
    const question = slide({ kind: 'question', storedKind: 'question', options: ['Stejná', 'Stejná'], correctAnswer: 'Stejná' });
    expect(codes(runQuizPreflight(quiz([question])))).toContain('CHOICE_CORRECT_INVALID');
  });

  test('choice needs at least two non-empty options', () => {
    const question = slide({ kind: 'question', storedKind: 'question', options: ['Jediná', ''], correctAnswer: 'A' });
    expect(codes(runQuizPreflight(quiz([question])))).toContain('CHOICE_OPTIONS_TOO_FEW');
  });

  test('empty free prompt and answer are blockers', () => {
    const result = runQuizPreflight(quiz([slide({ text: '', title: '', correctAnswer: '' })]));
    expect(codes(result)).toEqual(expect.arrayContaining(['QUESTION_PROMPT_MISSING', 'ANSWER_MISSING']));
    expect(result.status).toBe('BLOCKED');
  });

  test('title remains a valid prompt when legacy text is whitespace', () => {
    const result = runQuizPreflight(quiz([slide({ title: 'Syntetické zadání', text: '   ' })]));
    expect(codes(result)).not.toContain('QUESTION_PROMPT_MISSING');
  });

  test('image requires a valid question image', () => {
    expect(codes(runQuizPreflight(quiz([slide({ kind: 'image', storedKind: 'image', questionImage: '' })])))).toContain('IMAGE_SOURCE_MISSING');
    expect(codes(runQuizPreflight(quiz([slide({ kind: 'image', storedKind: 'image', questionImage: 'not-a-url' })])))).toContain('IMAGE_SOURCE_INVALID');
  });

  test('audio requires source and both clip boundaries', () => {
    const result = runQuizPreflight(quiz([slide({ kind: 'audio', storedKind: 'audio' })]));
    expect(codes(result)).toEqual(expect.arrayContaining(['MEDIA_SOURCE_MISSING', 'CLIP_START_MISSING', 'CLIP_END_MISSING']));
  });

  test('audio rejects an end at or before start', () => {
    const question = slide({ kind: 'audio', storedKind: 'audio', mediaSource: 'abcdefghijk', clipStartSeconds: 8, clipEndSeconds: 8 });
    expect(codes(runQuizPreflight(quiz([question])))).toContain('CLIP_RANGE_INVALID');
  });

  test('video rejects invalid timing', () => {
    const question = slide({ kind: 'video', storedKind: 'video', mediaSource: 'abcdefghijk', clipStartSeconds: -1, clipEndSeconds: -2 });
    expect(codes(runQuizPreflight(quiz([question])))).toEqual(expect.arrayContaining(['CLIP_START_INVALID', 'CLIP_END_INVALID']));
  });

  test('valid PL is usable with a limited-editability warning', () => {
    const result = runQuizPreflight(quiz([slide({ kind: 'pl', storedKind: 'pl', correctAnswer: 'Pravda', hasLegacyData: true })]));
    expect(result.status).toBe('READY_WITH_WARNINGS');
    expect(codes(result)).toContain('LEGACY_LIMITED');
  });

  test('invalid PL answer is blocked', () => {
    const result = runQuizPreflight(quiz([slide({ kind: 'pl', storedKind: 'pl', correctAnswer: 'neurčeno', hasLegacyData: true })]));
    expect(result.status).toBe('BLOCKED');
    expect(codes(result)).toContain('PL_ANSWER_INVALID');
  });

  test('empty and roundless structures are classified', () => {
    const empty = runQuizPreflight({ ...quiz([]), roundCount: 0 });
    expect(codes(empty)).toContain('QUIZ_HAS_NO_ROUNDS');
    const roundless = runQuizPreflight(quiz([slide({ roundId: undefined, roundTitle: undefined })]));
    expect(codes(roundless)).toContain('ROUNDLESS_QUESTIONS');
    expect(roundless.status).toBe('BLOCKED');
  });

  test('a stored round title is required instead of accepting a generated fallback', () => {
    const result = runQuizPreflight(quiz([slide({ roundTitle: undefined })]));
    expect(codes(result)).toContain('ROUND_TITLE_MISSING');
  });

  test('normal system round slides allow intro and recap to be derived', () => {
    const question = slide({ position: 2 });
    const roundHeader = slide({ id: 'round-header', position: 1, storedKind: 'round', kind: 'round', isQuestion: false, title: 'První kolo', correctAnswer: '' });
    const recap = slide({ id: 'recap', position: 3, storedKind: 'recap', kind: 'recap', isQuestion: false, title: 'Rekapitulace', correctAnswer: '' });
    expect(runQuizPreflight(quiz([roundHeader, question, recap])).status).toBe('READY_WITH_WARNINGS');
  });

  test('a visible quiz intro clears the warning, while a hidden or round intro does not', () => {
    const intro = slide({ id: 'intro', position: 0, kind: 'intro', storedKind: 'intro',
      isQuestion: false, roundId: undefined, roundTitle: undefined, correctAnswer: '' });
    expect(runQuizPreflight(quiz([intro, slide()])).status).toBe('READY');
    for (const other of [{ ...intro, hidden: true }, { ...intro, roundId: 'round-1' }, { ...intro, isQuestion: true }]) {
      expect(codes(runQuizPreflight(quiz([other, slide()])))).toContain('QUIZ_INTRO_MISSING');
    }
  });

  test('online media uncertainty is a warning rather than a blocker', () => {
    const question = slide({ kind: 'video', storedKind: 'video', mediaSource: 'abcdefghijk', clipStartSeconds: 0, clipEndSeconds: 10 });
    const result = runQuizPreflight(quiz([question]));
    expect(result.status).toBe('READY_WITH_WARNINGS');
    expect(result.blockerCount).toBe(0);
    expect(codes(result)).toContain('MEDIA_ONLINE_UNVERIFIED');
  });

  test('question numbering is derived contiguously inside each round', () => {
    const result = runQuizPreflight(quiz([
      slide({ id: 'later', position: 2 }),
      slide({ id: 'earlier', position: 1 }),
    ]));
    expect(result.questionCount).toBe(2);
    expect(codes(result)).not.toContain('ROUND_QUESTION_NUMBERING_INVALID');
  });

  test('unsaved local draft blocks live without hiding other findings', () => {
    const result = runQuizPreflight(quiz(), { source: 'LOCAL_DRAFT', hasUnsavedChanges: true });
    expect(result.source).toBe('LOCAL_DRAFT');
    expect(result.status).toBe('BLOCKED');
    expect(codes(result)).toContain('UNSAVED_CHANGES');
  });

  test('result never contains private values or raw legacy payloads', () => {
    const privateValue = 'PRIVATE-SENTINEL-ANSWER';
    const result = runQuizPreflight(quiz([slide({ correctAnswer: privateValue, moderatorNote: 'PRIVATE-SENTINEL-NOTE', hasLegacyData: true })]));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(privateValue);
    expect(serialized).not.toContain('PRIVATE-SENTINEL-NOTE');
    expect(serialized).not.toContain('legacy.raw');
  });
});

describe('advisory media readiness', () => {
  test('uses strictly width <800 and keeps unknown dimensions distinct', () => {
    const a = 'https://example.test/one.png', b = 'https://example.test/two.png', c = 'https://example.test/three.png';
    const value = quiz([slide({ questionImage: a, answerImage: b, backgroundImage: c })]);
    const unknown = runQuizPreflight(value);
    expect(unknown.media).toMatchObject({ imageCount: 3, unknownImageCount: 3, smallImageCount: 0 });
    const checked = runQuizPreflight(value, { imageWidths: new Map([[a, 799], [b, 800], [c, 0]]) });
    expect(checked.media).toMatchObject({ imageCount: 3, unknownImageCount: 1, smallImageCount: 1 });
    expect(checked.issues.filter(issue => issue.code === 'IMAGE_WIDTH_SMALL')).toHaveLength(1);
    expect(checked.blockerCount).toBe(0);
    expect(checked.status).toBe('READY_WITH_WARNINGS');
  });

  test('deduplicates actual sources and distinguishes YouTube, Drive, external and owned provenance', () => {
    const image = 'https://example.test/image.png', drive = 'https://drive.google.com/file/d/synthetic/view';
    const owned = 'quiz-asset:synthetic-quiz/' + 'a'.repeat(64);
    const value = quiz([slide({ questionImage: image, backgroundImage: image, answerImage: drive,
      kind: 'video', storedKind: 'video', mediaSource: 'abcdefghijk', clipStartSeconds: 0, clipEndSeconds: 2,
      originalMediaSource: 'https://youtube.com/watch?v=provenance0', media: [{ role: 'prompt', kind: 'image', source: owned }] })]);
    const result = runQuizPreflight(value);
    expect(result.media).toMatchObject({ imageCount: 3, offlineExcludedCount: 3, youtubeCount: 1, driveCount: 1, externalCount: 1 });
    const driveOwned = runQuizPreflight(value, { offlineExcludedReferences: new Set([owned]) });
    expect(driveOwned.media).toMatchObject({ offlineExcludedCount: 4, driveCount: 2 });
    expect(result.issues.filter(issue => issue.code === 'MEDIA_NOT_OFFLINE')).toHaveLength(3);
    expect(result.blockerCount).toBe(0);
  });

  test.each([
    ['https://example.test/%C5%BDelva-velk%C3%A1.png', 'Želva', true],
    ['https://example.test/%25C5%25BDelva.png', 'Želva', true],
    ['https://example.test/ZELVA.png?bad=%ZZ', 'Želva', true],
    ['https://example.test/zelvami.png', 'Želva', false],
    ['https://example.test/a-v-ve.png', 'A v', false],
    ['https://example.test/portrait.png?name=%C5%BDelva', 'Želva', true],
    ['https://example.test/c%CC%8Cap.png', 'Čáp', true],
    ['https://example.test/uk.png', 'UK', true],
  ])('URL token check %s uses Unicode whole words without echoing private evidence', (url, answer, warns) => {
    const result = runQuizPreflight(quiz([slide({ questionImage: url, correctAnswer: answer })]));
    const hints = result.issues.filter(issue => issue.code === 'IMAGE_URL_ANSWER_HINT');
    expect(hints.length > 0).toBe(warns);
    expect(JSON.stringify(hints)).not.toContain(url);
    if (warns) expect(JSON.stringify(hints)).not.toContain(answer);
  });

  test('resolves a choice letter to the answer option, and redacted answers cannot create hints', () => {
    const value = slide({ kind: 'question', options: ['Želva', 'Čáp'], correctAnswer: 'B', questionImage: 'https://example.test/cap.png' });
    expect(codes(runQuizPreflight(quiz([value])))).toContain('IMAGE_URL_ANSWER_HINT');
    expect(codes(runQuizPreflight(quiz([{ ...value, correctAnswer: '' }])))).not.toContain('IMAGE_URL_ANSWER_HINT');
  });

  test('never mutates the source quiz while deriving advice', () => {
    const value = quiz([slide({ questionImage: 'https://example.test/synthetic.png' })]);
    const before = JSON.stringify(value);
    runQuizPreflight(value, { imageWidths: new Map([[value.slides[0]!.questionImage, 100]]) });
    expect(JSON.stringify(value)).toBe(before);
  });
});

test('image advice follows effective inherited designs instead of counting overridden defaults', () => {
  const old = 'https://example.test/unused.png', current = 'https://example.test/current.png';
  const value = { ...quiz([slide({ design: { backgroundImage: current } })]), defaultDesign: { backgroundImage: old } };
  const result = runQuizPreflight(value);
  expect(result.media).toMatchObject({ imageCount: 1, externalCount: 1 });
});


test('current answer authority hides previously loaded answer media and URL evidence', () => {
  const source = quiz([slide({ questionImage: 'https://example.test/zelva.png', correctAnswer: 'Želva', answerImage: 'https://example.test/private.png',
    answerDesign: { backgroundImage: 'https://example.test/answer-design.png' },
    media: [{ role: 'answer', kind: 'image', source: 'https://example.test/answer-role.png' }] })]);
  const visible = preflightVisibleQuiz(source, false);
  expect(visible.slides[0]?.answerImage).toBe('');
  expect(visible.slides[0]?.answerDesign).toBeUndefined();
  expect(visible.slides[0]?.media).toHaveLength(0);
  expect(visible.slides[0]?.correctAnswer).toBe('');
  expect(codes(runQuizPreflight(visible))).not.toContain('IMAGE_URL_ANSWER_HINT');
  expect(runQuizPreflight(visible).media?.imageCount).toBe(1);
  expect(source.slides[0]?.correctAnswer).toBe('Želva');
});
