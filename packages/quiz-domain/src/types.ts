import type { SlideDesign, ResultTemplates, PrintTemplate } from './design.js';
export const editableSlideKinds = [
  'intro', 'agenda', 'rules', 'recap', 'end', 'title', 'info', 'round', 'roundheader', 'round-header', 'section',
  'question', 'text', 'classic', 'free', 'image', 'picture', 'photo',
  'audio', 'music', 'video', 'youtube', 'pl', 'legacy',
] as const;

export type EditableSlideKind = typeof editableSlideKinds[number];
export type EditorMediaKind = 'image' | 'audio' | 'video' | 'unknown';
export type EditorMediaRole = 'prompt' | 'answer' | 'background' | 'unknown';

export interface EditorMedia {
  readonly sourceIndex?: number;
  readonly role: EditorMediaRole;
  readonly kind: EditorMediaKind;
  readonly source: string;
}

export interface EditorPresentation {
  readonly videoStart: number | null;
  readonly videoEnd: number | null;
  readonly audioTrigger: number | null;
  readonly backgroundOverlay: number | null;
  readonly answerOverlay: number | null;
  readonly sourceQuestionNumber: string | null;
}

export interface EditorSlide {
  /** Local mutation intent, never stored in the private source. */
  readonly resetAppearance?: true;
  readonly hidden?: boolean;
  readonly design?: SlideDesign;
  readonly answerDesign?: SlideDesign;
  readonly automaticAgenda?: boolean;
  readonly authoringStatus?: 'draft' | 'ready';
  readonly answerMode?: 'open' | 'choice';
  readonly imageLayout?: 'split' | 'stacked';
  readonly answerExplanation?: string;

  readonly id: string;
  readonly position: number;
  readonly storedKind: string;
  readonly kind: EditableSlideKind;
  readonly isQuestion: boolean;
  readonly roundId?: string;
  readonly roundTitle?: string;
  readonly title: string;
  readonly text: string;
  readonly moderatorNote: string;
  readonly options: readonly string[];
  readonly correctAnswer: string;
  readonly media: readonly EditorMedia[];
  readonly presentation: EditorPresentation;
  readonly questionNumber?: number;
  readonly questionCount?: number;
  readonly backgroundImage: string;
  readonly questionImage: string;
  readonly answerImage: string;
  readonly mediaSource: string;
  readonly originalMediaSource?: string;
  readonly backgroundOverlay: number | null;
  readonly clipStartSeconds: number | null;
  readonly clipEndSeconds: number | null;
  readonly hasLegacyData: boolean;
}

export type CreatableQuestionType = 'choice' | 'free' | 'image' | 'audio' | 'video';
export type SemanticQuestionType = CreatableQuestionType | 'legacy-pl' | 'legacy';
export type EditorValidationCategory = 'STRUCTURE' | 'ANSWER' | 'MEDIA' | 'TIMING' | 'IMAGE' | 'LEGACY';
export type EditorValidationCode =
  | 'QUESTION_DRAFT'
  | 'CHOICE_OPTIONS_INVALID'
  | 'QUESTION_PROMPT_MISSING'
  | 'QUESTION_RENDERER_UNSUPPORTED'
  | 'ANSWER_MISSING'
  | 'CHOICE_OPTIONS_TOO_FEW'
  | 'CHOICE_CORRECT_MISSING'
  | 'CHOICE_CORRECT_INVALID'
  | 'PL_ANSWER_INVALID'
  | 'IMAGE_SOURCE_MISSING'
  | 'IMAGE_SOURCE_INVALID'
  | 'ANSWER_IMAGE_INVALID'
  | 'BACKGROUND_IMAGE_INVALID'
  | 'MEDIA_SOURCE_MISSING'
  | 'MEDIA_SOURCE_INVALID'
  | 'CLIP_START_MISSING'
  | 'CLIP_START_INVALID'
  | 'CLIP_END_MISSING'
  | 'CLIP_END_INVALID'
  | 'CLIP_RANGE_INVALID'
  | 'LEGACY_LIMITED';

export interface EditorValidationIssue {
  readonly code: EditorValidationCode;
  readonly category: EditorValidationCategory;
  readonly field: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

export interface EditorAppearance {
  readonly backgroundImage: string;
  readonly backgroundOverlay: number;
  readonly imageLayout: 'split' | 'stacked';
}
export interface EditorQuiz {
  readonly status?: 'draft' | 'ready' | 'archived';
  readonly printTemplate?: PrintTemplate;
  readonly defaultDesign?: SlideDesign;
  readonly resultTemplates?: ResultTemplates;
  readonly defaultAppearance?: EditorAppearance;
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly revision: number;
  readonly slideCount: number;
  readonly questionCount: number;
  readonly roundCount: number;
  readonly slides: readonly EditorSlide[];
}

export interface EditorMutationResponse {
  readonly quizId: string;
  readonly revision: number;
  readonly slideCount: number;
  readonly questionCount: number;
  readonly roundCount: number;
  readonly selectedSlideId?: string;
}

export type PreflightSeverity = 'BLOCKER' | 'WARNING';
export type PreflightStatus = 'BLOCKED' | 'READY_WITH_WARNINGS' | 'READY';
export type PreflightSource = 'SAVED_QUIZ' | 'LOCAL_DRAFT';
export type PreflightCategory = EditorValidationCategory | 'PROJECTOR';
export type PreflightIssueCode = EditorValidationCode
  | 'QUIZ_TITLE_MISSING'
  | 'QUIZ_HAS_NO_ROUNDS'
  | 'ROUND_TITLE_MISSING'
  | 'ROUND_HAS_NO_QUESTIONS'
  | 'ROUND_QUESTION_NUMBERING_INVALID'
  | 'ROUNDLESS_QUESTIONS'
  | 'AGENDA_OUT_OF_DATE'
  | 'MEDIA_ONLINE_UNVERIFIED'
  | 'IMAGE_ONLINE_UNVERIFIED'
  | 'UNSAVED_CHANGES';

export interface PreflightReference {
  readonly quizId: string;
  readonly roundId?: string;
  readonly roundPosition?: number;
  readonly roundTitle?: string;
  readonly questionId?: string;
  readonly questionNumber?: number;
  readonly questionType?: SemanticQuestionType;
}

export interface PreflightFixTarget {
  readonly kind: 'quiz' | 'round' | 'question' | 'system';
  readonly roundId?: string;
  readonly questionId?: string;
  readonly systemKey?: 'agenda';
  readonly field?: string;
}

export interface PreflightIssue {
  readonly severity: PreflightSeverity;
  readonly code: PreflightIssueCode;
  readonly category: PreflightCategory;
  readonly message: string;
  readonly reference: PreflightReference;
  readonly fixTarget?: PreflightFixTarget;
}

export interface PreflightCategoryCount {
  readonly blockers: number;
  readonly warnings: number;
}

export interface PreflightResult {
  readonly status: PreflightStatus;
  readonly source: PreflightSource;
  readonly validationDurationMs: number;
  readonly roundCount: number;
  readonly questionCount: number;
  readonly validAnswerCount: number;
  readonly blockerCount: number;
  readonly warningCount: number;
  readonly issues: readonly PreflightIssue[];
  readonly categories: Readonly<Record<PreflightCategory, PreflightCategoryCount>>;
}
