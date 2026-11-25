import type { SlideDesign } from '@filmovy-kviz/quiz-domain';
export const editorSlideKinds = [
  'intro',
  'agenda',
  'rules',
  'recap',
  'thank-you',
  'end',
  'title',
  'info',
  'round',
  'roundheader',
  'round-header',
  'section',
  'question',
  'text',
  'classic',
  'free',
  'image',
  'picture',
  'photo',
  'audio',
  'music',
  'video',
  'youtube',
  'pl',
  'legacy',
] as const;

export type EditorSlideKind = typeof editorSlideKinds[number];
export type EditorMediaKind = 'image' | 'audio' | 'video' | 'unknown';
export type EditorMediaRole = 'prompt' | 'answer' | 'background' | 'unknown';

export interface EditorMediaInput {
  readonly sourceIndex?: number;
  readonly role: EditorMediaRole;
  readonly kind: EditorMediaKind;
  readonly source: string;
}

export interface EditorPresentationInput {
  readonly videoStart: number | null;
  readonly videoEnd: number | null;
  readonly audioTrigger: number | null;
  readonly backgroundOverlay: number | null;
  readonly answerOverlay: number | null;
  readonly sourceQuestionNumber: string | null;
}

export interface EditorSlideInput {
  readonly resetAppearance?: true;
  readonly hidden?: boolean;
  readonly automaticAgenda?: boolean;
  readonly design?: SlideDesign;
  readonly answerDesign?: SlideDesign;
  readonly authoringStatus?: 'draft' | 'ready';
  readonly answerMode?: 'open' | 'choice';
  readonly imageLayout?: 'split' | 'stacked';
  readonly answerExplanation?: string;

  readonly kind: EditorSlideKind;
  readonly title: string;
  readonly text: string;
  readonly moderatorNote: string;
  readonly options: readonly string[];
  readonly correctAnswer: string;
  readonly media: readonly EditorMediaInput[];
  readonly presentation: EditorPresentationInput;
  readonly backgroundImage: string;
  readonly questionImage: string;
  readonly answerImage: string;
  readonly mediaSource?: string;
  readonly backgroundOverlay: number | null;
  readonly clipStartSeconds: number | null;
  readonly clipEndSeconds: number | null;
}

export interface EditorQuizMutationResponse {
  readonly quizId: string;
  readonly revision: number;
  readonly slideCount: number;
  readonly questionCount: number;
  readonly roundCount: number;
  readonly selectedSlideId?: string;
}
