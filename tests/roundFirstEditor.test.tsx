import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

import { EditorPreview, QuestionForm, SystemSectionForm } from '../apps/web/src/features/editor/EditorForms';
import { practiceSlides } from '../apps/web/src/features/editor/QuizPractice';
import {
  buildSemanticQuizModel,
  creatableQuestionTypes,
  insertionPositionForRound,
  questionTypeLabels,
  semanticQuestionType,
} from '../apps/web/src/features/editor/semanticModel';
import { editorSaveLabels, editorSaveStatus, needsNavigationDecision } from '../apps/web/src/features/editor/sessionState';
import { clipDuration, formatHumanTime, parseHumanTime } from '../apps/web/src/features/editor/time';
import type { EditorQuiz, EditorSlide } from '../apps/web/src/features/editor/types';
import {
  correctOptionIndex,
  hasBlockingIssues,
  hasSaveBlockingIssues,
  validateQuestion,
} from '../apps/web/src/features/editor/validation';

function slide(overrides: Partial<EditorSlide> = {}): EditorSlide {
  return {
    id: 'question-1', position: 1, storedKind: 'question', kind: 'question', isQuestion: true,
    roundId: 'round-1', roundTitle: 'První kolo', title: '', text: 'Syntetické zadání',
    moderatorNote: '', options: ['První', 'Druhá', 'Třetí', 'Čtvrtá'], correctAnswer: 'První', media: [],
    presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null },
    questionNumber: 1, questionCount: 1, backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '',
    backgroundOverlay: null, clipStartSeconds: null, clipEndSeconds: null, hasLegacyData: false,
    ...overrides,
  };
}

function quizFixture(): EditorQuiz {
  const slides: EditorSlide[] = [
    slide({ id: 'opening', position: 1, kind: 'intro', storedKind: 'intro', isQuestion: false, roundId: undefined, roundTitle: undefined, text: '', options: [], correctAnswer: '' }),
    slide({ id: 'agenda', position: 2, kind: 'agenda', storedKind: 'agenda', isQuestion: false, roundId: undefined, roundTitle: undefined, text: '', options: [], correctAnswer: '' }),
    slide({ id: 'round-1-intro', position: 3, kind: 'intro', storedKind: 'intro', isQuestion: false, title: 'Vizuální intro', text: '', options: [], correctAnswer: '' }),
    slide({ id: 'choice', position: 4, questionNumber: 1, questionCount: 2 }),
    slide({ id: 'pl', position: 5, kind: 'pl', storedKind: 'pl', text: 'Syntetické tvrzení', options: [], correctAnswer: 'Pravda', questionNumber: 2, questionCount: 2, hasLegacyData: true }),
    slide({ id: 'recap-1', position: 6, kind: 'recap', storedKind: 'recap', isQuestion: false, text: '', options: [], correctAnswer: '' }),
    slide({ id: 'round-2-intro', position: 7, kind: 'intro', storedKind: 'intro', isQuestion: false, roundId: 'round-2', roundTitle: 'Druhé kolo', title: '', text: '', options: [], correctAnswer: '' }),
    slide({ id: 'audio', position: 8, kind: 'audio', storedKind: 'audio', roundId: 'round-2', roundTitle: 'Druhé kolo', options: [], correctAnswer: 'Odpověď', mediaSource: 'dQw4w9WgXcQ', clipStartSeconds: 5, clipEndSeconds: 12, questionNumber: 1, questionCount: 1 }),
    slide({ id: 'recap-2', position: 9, kind: 'recap', storedKind: 'recap', isQuestion: false, roundId: 'round-2', roundTitle: 'Druhé kolo', text: '', options: [], correctAnswer: '' }),
    slide({ id: 'end', position: 10, kind: 'end', storedKind: 'end', isQuestion: false, roundId: undefined, roundTitle: undefined, text: '', options: [], correctAnswer: '' }),
  ];
  return { id: 'quiz', title: 'Syntetický kvíz', description: '', revision: 0, slideCount: slides.length, roundCount: 2, questionCount: 3, slides };
}

function renderQuestion(value: EditorSlide, showAllIssues = true): string {
  return renderToStaticMarkup(
    <QuestionForm
      slide={value}
      number={value.questionNumber ?? 1}
      disabled={false}
      showAllIssues={showAllIssues}
      touched={new Set()}
      onTouch={vi.fn()}
      onChange={vi.fn()}
    />,
  );
}

test('private rehearsal preserves persisted legacy order and manual agenda without inventing sections', () => {
  const manualAgenda = slide({ id: 'manual-agenda', position: 9, kind: 'agenda', storedKind: 'agenda', isQuestion: false, options: ['Ručně napsaný program', 'Přestávka'] });
  const question = slide({ id: 'only-question', position: 4 });
  const quiz = { ...quizFixture(), slides: [manualAgenda, question] };
  const originalOrder = [...quiz.slides];
  expect(practiceSlides(quiz)).toEqual([question, manualAgenda]);
  expect(quiz.slides).toEqual(originalOrder);
  expect(practiceSlides({ ...quiz, slides: [] })).toEqual([]);
});

describe('round-first semantic editor model', () => {
  test('agenda form preserves manual options and generates only automatic agendas', () => {
    const quiz = quizFixture(), model = buildSemanticQuizModel(quiz);
    const section = model.introduction.find(item => item.key === 'agenda')!;
    const manual = slide({ kind: 'agenda', isQuestion: false, options: ['Původní ruční položka'] });
    const onChange = vi.fn();
    const render = (agenda: EditorSlide) => renderToStaticMarkup(<SystemSectionForm section={section} slide={agenda} model={model} disabled={false} onChange={onChange} />);
    for (const automaticAgenda of [undefined, false]) {
      const html = render({ ...manual, automaticAgenda });
      expect(html).toContain('Uložený ruční harmonogram');
      expect(html).toContain('Původní ruční položka');
      expect(html).not.toContain('První kolo');
    }
    const automatic = render({ ...manual, automaticAgenda: true });
    expect(automatic).toContain('Automaticky podle pořadí a názvů kol');
    expect(automatic).toContain('První kolo');
    expect(automatic).not.toContain('Původní ruční položka');
    expect(manual.options).toEqual(['Původní ruční položka']);
    expect(onChange).not.toHaveBeenCalled();
  });
  test('builds intro system sections, rounds, round-local questions, and generated recap nodes', () => {
    const quiz = quizFixture();
    const model = buildSemanticQuizModel(quiz);
    expect(model.introduction.map((section) => section.label)).toEqual(['Úvodní obrazovka', 'Harmonogram', 'Pravidla']);
    expect(model.rounds.map((round) => [round.title, round.questions.length, round.recaps.length])).toEqual([
      ['První kolo', 2, 1], ['Druhé kolo', 1, 1],
    ]);
    expect(model.rounds[0]!.questions.map((question) => question.number)).toEqual([1, 2]);
    expect(model.questionBySlideId.get('pl')?.type).toBe('legacy-pl');
    expect(model.slideById.size).toBe(quiz.slideCount);
    expect(insertionPositionForRound(model.rounds[0]!)).toBe(6);
  });

  test('exposes exactly five creatable types and keeps PL legacy-only', () => {
    expect(creatableQuestionTypes).toEqual(['choice', 'free', 'image', 'audio', 'video']);
    expect(creatableQuestionTypes).not.toContain('legacy-pl');
    expect(questionTypeLabels['legacy-pl']).toBe('Legacy: Pravda / Lež');
    expect(semanticQuestionType(slide({ kind: 'pl', storedKind: 'pl', options: [] }))).toBe('legacy-pl');
  });
});

describe('type-specific question forms and validation', () => {
  test('selects correct choice from options and blocks a missing or mismatched choice', () => {
    const five = slide({ options: ['A1', 'B1', 'C1', 'D1', 'E1'], correctAnswer: 'C' });
    const six = slide({ options: ['A1', 'B1', 'C1', 'D1', 'E1', 'F1'], correctAnswer: 'F1' });
    expect(correctOptionIndex(five)).toBe(2);
    expect(correctOptionIndex(six)).toBe(5);
    expect(five.options).toHaveLength(5);
    expect(six.options).toHaveLength(6);
    expect(hasBlockingIssues(slide({ correctAnswer: '' }))).toBe(true);
    const html = renderQuestion(five);
    expect(html).toContain('Označit možnost C jako správnou');
    expect(html).not.toContain('Správná odpověď *</label>');
  });

  test('free form has no options editor', () => {
    const value = slide({ kind: 'free', storedKind: 'free', options: [], correctAnswer: 'Syntetická odpověď' });
    const html = renderQuestion(value);
    expect(html).toContain('Volná odpověď');
    expect(html).not.toContain('<legend>Odpovědi</legend>');
    expect(validateQuestion(value)).toEqual([]);
  });

  test('allows unrelated edits to persisted imported unset timing while keeping readiness strict', () => {
    const persisted = slide({
      kind: 'audio',
      storedKind: 'audio',
      options: [],
      correctAnswer: 'Syntetická odpověď',
      mediaSource: 'test__local',
      presentation: {
        videoStart: 0,
        videoEnd: 0,
        audioTrigger: null,
        backgroundOverlay: null,
        answerOverlay: null,
        sourceQuestionNumber: '1/1',
      },
      clipStartSeconds: null,
      clipEndSeconds: null,
      hasLegacyData: true,
    });
    const textEdit = { ...persisted, text: 'Upravené syntetické zadání' };

    expect(hasBlockingIssues(textEdit)).toBe(true);
    expect(hasSaveBlockingIssues(textEdit, persisted)).toBe(false);
    expect(hasSaveBlockingIssues(textEdit)).toBe(true);
    expect(hasSaveBlockingIssues({ ...textEdit, mediaSource: 'other_local' }, persisted)).toBe(true);
    expect(hasSaveBlockingIssues({ ...textEdit, clipStartSeconds: 1 }, persisted)).toBe(true);
  });

  test('image keeps question image separate, supports optional choices, and exposes answer image', () => {
    const freeImage = slide({ kind: 'image', storedKind: 'image', options: [], correctAnswer: 'Odpověď', questionImage: 'https://images.example.test/question.jpg', answerImage: 'https://images.example.test/answer.jpg' });
    const choiceImage = { ...freeImage, options: ['První', 'Druhá'], correctAnswer: 'Druhá' };
    expect(validateQuestion(freeImage)).toEqual([]);
    expect(validateQuestion(choiceImage)).toEqual([]);
    const html = renderQuestion(choiceImage);
    expect(html).toContain('Obrázek otázky');
    expect(html).toContain('ABCD – jedna možnost');
    expect(html).toContain('Odpověď po odhalení · fotografie přidána');
    expect(html).not.toContain('https://images.example.test/answer.jpg');
  });

  test('validates required audio/video timing and parses human time', () => {
    expect(parseHumanTime('01:05.5')).toBe(65.5);
    expect(parseHumanTime('1:60')).toBeUndefined();
    expect(formatHumanTime(65.5)).toBe('1:05.5');
    expect(clipDuration(5, 12.5)).toBe(7.5);
    const valid = slide({ kind: 'video', storedKind: 'video', options: [], correctAnswer: 'Odpověď', mediaSource: 'dQw4w9WgXcQ', clipStartSeconds: 5, clipEndSeconds: 12 });
    expect(validateQuestion(valid)).toEqual([]);
    const invalid = { ...valid, clipEndSeconds: null };
    expect(validateQuestion(invalid).map((issue) => issue.field)).toContain('clipEndSeconds');
    expect(renderQuestion(valid)).toContain('Použít aktuální čas jako začátek');
    expect(renderQuestion(valid)).toContain('Pustit znovu');
  });

  test('renders existing PL as editable locked legacy behavior without offering creation/type conversion', () => {
    const value = slide({ kind: 'pl', storedKind: 'pl', options: [], correctAnswer: 'Lež', hasLegacyData: true });
    const html = renderQuestion(value);
    expect(html).toContain('Starší typ Pravda / Lež');
    expect(html).toContain('Pravda');
    expect(html).toContain('Lež');
    expect(html).not.toContain('<select');
  });
});

describe('explicit save and local preview contracts', () => {
  test('represents saved, dirty, saving, and failure states and blocks dirty navigation', () => {
    expect(editorSaveLabels[editorSaveStatus(false, false, false)]).toBe('Uloženo');
    expect(editorSaveLabels[editorSaveStatus(true, false, false)]).toBe('Neuložené změny');
    expect(editorSaveLabels[editorSaveStatus(true, true, false)]).toBe('Ukládám…');
    expect(editorSaveLabels[editorSaveStatus(true, false, true)]).toBe('Uložení se nezdařilo');
    expect(needsNavigationDecision(true, 'slide:a', 'slide:b')).toBe(true);
    expect(needsNavigationDecision(false, 'slide:a', 'slide:b')).toBe(false);
  });

  test('renders the current local draft through shared preview without publishing it', () => {
    const draft = slide({ text: 'Rozepsaný syntetický text bez SAVE' });
    const html = renderToStaticMarkup(<EditorPreview slide={draft} quizTitle="Syntetický kvíz" showAnswer={false} onShowAnswer={vi.fn()} />);
    expect(html).toContain('Rozepsaný syntetický text bez SAVE');
    expect(html).toContain('Lokální náhled · nepublikováno');
    expect(html).not.toContain('publicSessions');
  });
});
