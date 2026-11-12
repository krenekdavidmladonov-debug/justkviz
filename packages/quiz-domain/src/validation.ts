import { parseQuizAsset } from './media-assets.js';
import { generatedAgendaOptions, isSafeHttpUrl, youtubeVideoId, directMediaKind } from './presentation.js';
import { buildSemanticQuizModel, questionPrompt, semanticQuestionType } from './semantic.js';
import type {
  EditorQuiz,
  EditorSlide,
  EditorValidationIssue,
  PreflightCategory,
  PreflightFixTarget,
  PreflightIssue,
  PreflightResult,
  PreflightSource,
} from './types.js';

const normalized = (value: string) => value.trim().toLocaleLowerCase('cs-CZ');
const rendererQuestionKinds = new Set([
  'question', 'text', 'classic', 'free', 'image', 'picture', 'photo',
  'audio', 'music', 'video', 'youtube', 'pl', 'legacy',
]);

function issue(
  code: EditorValidationIssue['code'],
  category: EditorValidationIssue['category'],
  field: string,
  message: string,
  severity: EditorValidationIssue['severity'] = 'error',
): EditorValidationIssue {
  return { code, category, field, message, severity };
}

export function correctOptionIndex(slide: Pick<EditorSlide, 'options' | 'correctAnswer'>): number | undefined {
  const answer = normalized(slide.correctAnswer);
  if (answer === '') return undefined;
  const exactMatches = slide.options
    .map((option, index) => ({ index, value: normalized(option) }))
    .filter((option) => option.value !== '' && option.value === answer);
  if (exactMatches.length === 1) return exactMatches[0]!.index;
  if (exactMatches.length > 1) return undefined;
  if (/^[a-z]$/u.test(answer)) {
    const index = answer.codePointAt(0)! - 'a'.codePointAt(0)!;
    if (index >= 0 && index < slide.options.length && normalized(slide.options[index] ?? '') !== '') return index;
  }
  return undefined;
}

export function validateQuestion(slide: EditorSlide): readonly EditorValidationIssue[] {
  if (!slide.isQuestion) return [];
  const type = semanticQuestionType(slide);
  const issues: EditorValidationIssue[] = [];
  if (slide.authoringStatus === 'draft') issues.push(issue('QUESTION_DRAFT', 'STRUCTURE', 'authoringStatus', 'Otázka je uložená jako koncept.'));
  if ((slide.answerMode === 'open' && slide.options.length > 0) || (slide.answerMode === 'choice' && slide.kind === 'free')) issues.push(issue('CHOICE_OPTIONS_INVALID', 'ANSWER', 'options', 'Režim odpovědi neodpovídá uloženým možnostem.'));
  const prompt = questionPrompt(slide).trim();
  if (prompt === '') issues.push(issue('QUESTION_PROMPT_MISSING', 'STRUCTURE', 'prompt', 'Chybí zadání otázky.'));
  if (!rendererQuestionKinds.has(slide.kind.toLowerCase())) {
    issues.push(issue('QUESTION_RENDERER_UNSUPPORTED', 'STRUCTURE', 'prompt', 'Tento obsah renderer neumí bezpečně zobrazit jako otázku.'));
  }

  if (slide.answerMode === 'choice' || (slide.answerMode !== 'open' && (type === 'choice' || (['image','audio','video'].includes(type) && slide.options.length > 0)))) {
    if (slide.options.filter((option) => option.trim() !== '').length < 2) {
      issues.push(issue('CHOICE_OPTIONS_TOO_FEW', 'ANSWER', 'options', 'Doplňte alespoň dvě platné možnosti.'));
    }
    if (slide.answerMode === 'choice' && (slide.options.length > 6 || slide.options.some(o => !o.trim()) || new Set(slide.options.map(normalized)).size !== slide.options.length)) issues.push(issue('CHOICE_OPTIONS_INVALID', 'ANSWER', 'options', 'Použijte 2–6 vyplněných, navzájem odlišných možností.'));
    if (slide.correctAnswer.trim() === '') {
      issues.push(issue('CHOICE_CORRECT_MISSING', 'ANSWER', 'correctAnswer', 'Chybí správná možnost.'));
    } else if (correctOptionIndex(slide) === undefined) {
      issues.push(issue('CHOICE_CORRECT_INVALID', 'ANSWER', 'correctAnswer', 'Správná odpověď neodpovídá právě jedné platné možnosti.'));
    }
  } else if (type === 'legacy-pl') {
    if (!['pravda', 'lež', 'lez', 'true', 'false', 'ano', 'ne', '1', '0'].includes(normalized(slide.correctAnswer))) {
      issues.push(issue('PL_ANSWER_INVALID', 'ANSWER', 'correctAnswer', 'Správná odpověď musí být Pravda nebo Lež.'));
    } else {
      issues.push(issue('LEGACY_LIMITED', 'LEGACY', 'legacy', 'Starší typ Pravda / Lež má omezené možnosti úprav.', 'warning'));
    }
  } else if (slide.correctAnswer.trim() === '') {
    issues.push(issue('ANSWER_MISSING', 'ANSWER', 'correctAnswer', 'Chybí správná odpověď.'));
  }
  if (type === 'legacy') {
    issues.push(issue('LEGACY_LIMITED', 'LEGACY', 'legacy', 'Starší typ otázky má omezené možnosti úprav.', 'warning'));
  }

  if (type === 'image') {
    if (slide.questionImage.trim() === '') {
      issues.push(issue('IMAGE_SOURCE_MISSING', 'IMAGE', 'questionImage', 'Chybí obrázek otázky.'));
    } else if (!isSafeHttpUrl(slide.questionImage) && !parseQuizAsset(slide.questionImage)) {
      issues.push(issue('IMAGE_SOURCE_INVALID', 'IMAGE', 'questionImage', 'Obrázek otázky nemá platnou HTTP(S) adresu.'));
    }
  }
  if (type === 'audio' || type === 'video') {
    if (slide.mediaSource.trim() === '') {
      issues.push(issue('MEDIA_SOURCE_MISSING', 'MEDIA', 'mediaSource', 'Chybí zdroj ukázky.'));
    } else if (youtubeVideoId(slide.mediaSource) === undefined && directMediaKind(slide.mediaSource) !== type && !parseQuizAsset(slide.mediaSource)) {
      issues.push(issue('MEDIA_SOURCE_INVALID', 'MEDIA', 'mediaSource', 'Zdroj není podporovaný audio/video odkaz ani připravené vlastní médium.'));
    }
    if (slide.clipStartSeconds === null) {
      issues.push(issue('CLIP_START_MISSING', 'TIMING', 'clipStartSeconds', 'Chybí začátek ukázky.'));
    } else if (!Number.isFinite(slide.clipStartSeconds) || slide.clipStartSeconds < 0) {
      issues.push(issue('CLIP_START_INVALID', 'TIMING', 'clipStartSeconds', 'Začátek ukázky musí být platný nezáporný čas.'));
    }
    if (slide.clipEndSeconds === null) {
      issues.push(issue('CLIP_END_MISSING', 'TIMING', 'clipEndSeconds', 'Chybí konec ukázky.'));
    } else if (!Number.isFinite(slide.clipEndSeconds) || slide.clipEndSeconds < 0) {
      issues.push(issue('CLIP_END_INVALID', 'TIMING', 'clipEndSeconds', 'Konec ukázky musí být platný nezáporný čas.'));
    } else if (slide.clipStartSeconds !== null && Number.isFinite(slide.clipStartSeconds)
      && slide.clipStartSeconds >= 0 && slide.clipEndSeconds <= slide.clipStartSeconds) {
      issues.push(issue('CLIP_RANGE_INVALID', 'TIMING', 'clipEndSeconds', 'Konec ukázky musí být po začátku.'));
    }
  }
  if (slide.answerImage.trim() !== '' && !isSafeHttpUrl(slide.answerImage) && !parseQuizAsset(slide.answerImage)) {
    issues.push(issue('ANSWER_IMAGE_INVALID', 'IMAGE', 'answerImage', 'Obrázek odpovědi nemá platnou HTTP(S) adresu.', 'warning'));
  }
  if (slide.backgroundImage.trim() !== '' && !isSafeHttpUrl(slide.backgroundImage) && !parseQuizAsset(slide.backgroundImage)) {
    issues.push(issue('BACKGROUND_IMAGE_INVALID', 'IMAGE', 'backgroundImage', 'Pozadí nemá platnou HTTP(S) adresu.', 'warning'));
  }
  return issues;
}

export function hasBlockingIssues(slide: EditorSlide): boolean {
  return validateQuestion(slide).some((item) => item.severity === 'error');
}

function isImportedUnsetTiming(slide: EditorSlide): boolean {
  return slide.hasLegacyData
    && slide.presentation.videoStart === 0
    && slide.presentation.videoEnd === 0
    && slide.clipStartSeconds === null
    && slide.clipEndSeconds === null;
}

export function hasSaveBlockingIssues(slide: EditorSlide, persistedSlide?: EditorSlide, answersRedacted = false): boolean {
  const preserveImportedUnsetTiming = persistedSlide !== undefined
    && persistedSlide.id === slide.id
    && persistedSlide.kind === slide.kind
    && persistedSlide.mediaSource === slide.mediaSource
    && isImportedUnsetTiming(persistedSlide)
    && isImportedUnsetTiming(slide);
  return validateQuestion(slide).some((item) => item.severity === 'error'
    && !(answersRedacted && item.field === 'correctAnswer')
    && !(preserveImportedUnsetTiming
      && (item.code === 'CLIP_START_MISSING' || item.code === 'CLIP_END_MISSING')));
}

const categories: readonly PreflightCategory[] = [
  'STRUCTURE', 'ANSWER', 'MEDIA', 'TIMING', 'IMAGE', 'LEGACY', 'PROJECTOR',
];

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value.trim() === right[index]?.trim());
}

function fixTarget(field: string, roundId: string, questionId: string): PreflightFixTarget {
  return { kind: 'question', roundId, questionId, field };
}

export function runQuizPreflight(
  quiz: EditorQuiz,
  options: { readonly source?: PreflightSource; readonly hasUnsavedChanges?: boolean } = {},
): PreflightResult {
  const validationStartedAt = performance.now();
  const model = buildSemanticQuizModel(quiz);
  const issues: PreflightIssue[] = [];
  const source = options.source ?? 'SAVED_QUIZ';
  const quizReference = { quizId: quiz.id } as const;

  if (quiz.title.trim() === '') {
    issues.push({
      severity: 'BLOCKER', code: 'QUIZ_TITLE_MISSING', category: 'STRUCTURE',
      message: 'Chybí název kvízu.', reference: quizReference,
      fixTarget: { kind: 'quiz', field: 'quizTitle' },
    });
  }
  if (model.rounds.every((round) => round.id === 'roundless')) {
    issues.push({
      severity: 'BLOCKER', code: 'QUIZ_HAS_NO_ROUNDS', category: 'STRUCTURE',
      message: 'Kvíz nemá žádné kolo.', reference: quizReference,
    });
  }
  if (options.hasUnsavedChanges === true) {
    issues.push({
      severity: 'BLOCKER', code: 'UNSAVED_CHANGES', category: 'STRUCTURE',
      message: 'Nejdříve uložte změny v editoru.', reference: quizReference,
    });
  }

  let validAnswerCount = 0;
  for (const round of model.rounds) {
    const roundReference = {
      quizId: quiz.id,
      roundId: round.id,
      roundPosition: round.position,
      roundTitle: round.title,
    } as const;
    const hasStoredRoundTitle = (round.settingsSlide?.title.trim() ?? '') !== ''
      || round.slides.some((slide) => (slide.roundTitle?.trim() ?? '') !== '');
    if (round.id !== 'roundless' && !hasStoredRoundTitle) {
      issues.push({
        severity: 'BLOCKER', code: 'ROUND_TITLE_MISSING', category: 'STRUCTURE',
        message: 'Kolo nemá název.', reference: roundReference,
        fixTarget: { kind: 'round', roundId: round.id, field: 'roundTitle' },
      });
    }
    if (round.questions.length === 0) {
      issues.push({
        severity: 'BLOCKER', code: 'ROUND_HAS_NO_QUESTIONS', category: 'STRUCTURE',
        message: 'Kolo neobsahuje žádnou otázku.', reference: roundReference,
        fixTarget: { kind: 'round', roundId: round.id },
      });
    }
    if (round.id === 'roundless') {
      issues.push({
        severity: 'BLOCKER', code: 'ROUNDLESS_QUESTIONS', category: 'STRUCTURE',
        message: 'Otázky nejsou přiřazené ke skutečnému kolu.', reference: roundReference,
      });
    }

    for (const [index, question] of round.questions.entries()) {
      const reference = {
        ...roundReference,
        questionId: question.slide.id,
        questionNumber: question.number,
        questionType: question.type,
      } as const;
      if (question.number !== index + 1) {
        issues.push({
          severity: 'BLOCKER', code: 'ROUND_QUESTION_NUMBERING_INVALID', category: 'STRUCTURE',
          message: 'Číslování otázek v kole není souvislé.', reference,
          fixTarget: fixTarget('order', round.id, question.slide.id),
        });
      }
      const questionIssues = validateQuestion(question.slide);
      if (!questionIssues.some((item) => item.category === 'ANSWER' && item.severity === 'error')) {
        validAnswerCount += 1;
      }
      for (const questionIssue of questionIssues) {
        issues.push({
          severity: questionIssue.severity === 'error' ? 'BLOCKER' : 'WARNING',
          code: questionIssue.code,
          category: questionIssue.category,
          message: questionIssue.message,
          reference,
          fixTarget: fixTarget(questionIssue.field, round.id, question.slide.id),
        });
      }

      const type = semanticQuestionType(question.slide);
      if ((type === 'audio' || type === 'video') && youtubeVideoId(question.slide.mediaSource) !== undefined) {
        issues.push({
          severity: 'WARNING', code: 'MEDIA_ONLINE_UNVERIFIED', category: 'MEDIA',
          message: 'Dostupnost a přehratelnost YouTube ukázky nelze předem zaručit.', reference,
          fixTarget: fixTarget('mediaSource', round.id, question.slide.id),
        });
      }
      if (type === 'image' && isSafeHttpUrl(question.slide.questionImage)) {
        issues.push({
          severity: 'WARNING', code: 'IMAGE_ONLINE_UNVERIFIED', category: 'IMAGE',
          message: 'Dostupnost externího obrázku nelze předem zaručit.', reference,
          fixTarget: fixTarget('questionImage', round.id, question.slide.id),
        });
      }
    }
  }

  const agenda = model.introduction.find((section) => section.key === 'agenda')?.slide;
  if (agenda !== undefined && !sameStrings(agenda.options, generatedAgendaOptions(model.rounds))) {
    issues.push({
      severity: 'WARNING', code: 'AGENDA_OUT_OF_DATE', category: 'STRUCTURE',
      message: 'Uložený harmonogram neodpovídá aktuálním kolům.', reference: quizReference,
      fixTarget: { kind: 'system', systemKey: 'agenda', field: 'agenda' },
    });
  }

  const countFor = (category: PreflightCategory) => ({
    blockers: issues.filter((item) => item.category === category && item.severity === 'BLOCKER').length,
    warnings: issues.filter((item) => item.category === category && item.severity === 'WARNING').length,
  });
  const categoryCounts = Object.fromEntries(
    categories.map((category) => [category, countFor(category)]),
  ) as Record<PreflightCategory, ReturnType<typeof countFor>>;
  const blockerCount = issues.filter((item) => item.severity === 'BLOCKER').length;
  const warningCount = issues.filter((item) => item.severity === 'WARNING').length;
  return {
    status: blockerCount > 0 ? 'BLOCKED' : warningCount > 0 ? 'READY_WITH_WARNINGS' : 'READY',
    source,
    validationDurationMs: performance.now() - validationStartedAt,
    roundCount: model.rounds.length,
    questionCount: model.rounds.reduce((total, round) => total + round.questions.length, 0),
    validAnswerCount,
    blockerCount,
    warningCount,
    issues,
    categories: categoryCounts,
  };
}
