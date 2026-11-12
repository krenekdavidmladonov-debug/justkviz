import type { SlideDesign } from '@filmovy-kviz/quiz-domain';

export type SlideContentKind =
  | 'question'
  | 'free'
  | 'image'
  | 'audio'
  | 'video'
  | 'pl'
  | 'intro'
  | 'roundIntro'
  | 'agenda'
  | 'rules'
  | 'recap'
  | 'end'
  | 'info'
  | 'legacy';

export type SlideRenderMode =
  | 'question'
  | 'recap'
  | 'editorPreview'
  | 'roundIntro'
  | 'agenda'
  | 'rules'
  | 'end';

export type MediaPlaybackCommand = 'idle' | 'play' | 'stop' | 'replay' | 'finished' | 'error';

export type MediaPlaybackState = 'idle' | 'preparing' | 'ready' | 'playing' | 'finished' | 'error';

export interface SlideMediaReference {
  readonly role: string;
  readonly kind: string;
  readonly source: string;
}

export interface SlidePresentationInput {
  readonly backgroundOverlay?: number | null;
  readonly answerOverlay?: number | null;
  readonly sourceQuestionNumber?: string | null;
  readonly videoStart?: number | null;
  readonly videoEnd?: number | null;
  readonly clipStartSeconds?: number | null;
  readonly clipEndSeconds?: number | null;
}

export interface SlideRenderInput {
  readonly mediaPlaybackMode?: 'original';
  readonly design?: SlideDesign;
  readonly roundTitle?: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly options: readonly string[];
  readonly media: readonly SlideMediaReference[];
  readonly questionNumber?: number;
  readonly questionCount?: number;
  readonly backgroundImage?: string;
  readonly questionImage?: string;
  readonly answerImage?: string;
  readonly imageLayout?: string;
  readonly answerExplanation?: string;
  readonly mediaSource?: string;
  readonly backgroundOverlay?: number | null;
  readonly clipStartSeconds?: number | null;
  readonly clipEndSeconds?: number | null;
  readonly presentation?: SlidePresentationInput;
  readonly revealedAnswer?: string;
}

export interface NormalizedSlideRenderModel {
  readonly mediaPlaybackMode?: 'original';
  readonly design: SlideDesign;
  readonly roundTitle?: string;
  readonly contentKind: SlideContentKind;
  readonly renderMode: SlideRenderMode;
  readonly title: string;
  readonly text: string;
  readonly options: readonly string[];
  readonly questionNumber?: number;
  readonly questionCount?: number;
  readonly backgroundImage?: string;
  readonly questionImage?: string;
  readonly answerImage?: string;
  readonly imageLayout?: string;
  readonly answerExplanation?: string;
  readonly mediaSource?: string;
  readonly backgroundOverlay: number;
  readonly clipStartSeconds: number;
  readonly clipEndSeconds?: number;
  readonly revealedAnswer?: string;
  readonly isQuestionLike: boolean;
  readonly isLegacyPl: boolean;
}
