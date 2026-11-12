import type { FinalRevealPage, FinalRevealState, SlideDesign, InterimBackdrop, ShowCue, ShowPreferences } from '@filmovy-kviz/quiz-domain';
import type { ResultPage } from '../leaderboard/types';
import type { MediaPlaybackCommand, MediaPlaybackState, SlidePresentationInput } from '../presentation/types';

export type LiveSessionStatus = 'waiting' | 'active' | 'ended';
export type LivePresentationMode = 'slide' | 'recap';
export type LiveRenderMode = 'question' | 'recap' | 'roundIntro' | 'agenda' | 'rules' | 'end';

export interface LiveControlState {
  readonly mediaPlaybackMode?: 'original';
  readonly showPreferences?: ShowPreferences;
  readonly showCue?: ShowCue;
  readonly sessionId: string;
  readonly eventId?: string;
  readonly snapshotId?: string;
  readonly finalReveal?: FinalRevealState;
  readonly interimResults?: Omit<ResultPage, 'rows'>;
  readonly quizId: string;
  readonly quizTitle: string;
  readonly slideCount: number;
  readonly status: LiveSessionStatus;
  readonly currentSlidePosition: number;
  readonly currentSlideId?: string;
  readonly answerRevealed: boolean;
  readonly presentationMode: LivePresentationMode;
  readonly recapQuestionPosition?: number;
  readonly recapQuestionId?: string;
  readonly mediaCommand: MediaPlaybackCommand;
  readonly mediaPlaybackState: MediaPlaybackState;
  readonly mediaGeneration: number;
  readonly introGeneration: number;
  readonly revision: number;
}

export interface LiveControlMedia {
  readonly role: string;
  readonly kind: string;
  readonly source: string;
}

export interface LiveControlSlide {
  readonly originalMediaSource?: string;
  readonly hidden?: boolean;
  readonly design?: SlideDesign;
  readonly answerDesign?: SlideDesign;
  readonly id: string;
  readonly position: number;
  readonly kind: string;
  readonly isQuestion: boolean;
  readonly roundId?: string;
  readonly roundTitle?: string;
  readonly questionNumber?: number;
  readonly questionCount?: number;
  readonly title: string;
  readonly text: string;
  readonly options: readonly string[];
  readonly media: readonly LiveControlMedia[];
  readonly presentation: SlidePresentationInput;
  readonly backgroundImage?: string;
  readonly questionImage?: string;
  readonly answerImage?: string;
  readonly imageLayout?: string;
  readonly answerExplanation?: string;
  readonly mediaSource?: string;
  readonly backgroundOverlay?: number;
  readonly clipStartSeconds?: number;
  readonly clipEndSeconds?: number;
  readonly correctAnswer?: string;
  readonly moderatorNote?: string;
}

export interface PublicMedia {
  readonly role: 'prompt' | 'background';
  readonly kind: 'image' | 'audio' | 'video' | 'unknown';
  readonly source: string;
}

export interface PublicLiveState {
  readonly mediaPlaybackMode?: 'original';
  readonly showCue?: ShowCue;
  readonly interimBackdrop?: InterimBackdrop;
  readonly design?: SlideDesign;
  readonly roundTitle?: string;
  readonly subtitle?: string;
  readonly finalReveal?: FinalRevealPage;
  readonly interimResults?: ResultPage;
  readonly sessionId: string;
  readonly quizTitle: string;
  readonly status: LiveSessionStatus;
  readonly slidePosition: number;
  readonly slideKind?: string;
  readonly title?: string;
  readonly text?: string;
  readonly options: readonly string[];
  readonly media: readonly PublicMedia[];
  readonly presentation: SlidePresentationInput;
  readonly presentationMode: LivePresentationMode;
  readonly renderMode: LiveRenderMode;
  readonly mediaCommand: MediaPlaybackCommand;
  readonly mediaPlaybackState: MediaPlaybackState;
  readonly mediaGeneration: number;
  readonly introGeneration: number;
  readonly questionNumber?: number;
  readonly questionCount?: number;
  readonly backgroundImage?: string;
  readonly questionImage?: string;
  readonly mediaSource?: string;
  readonly backgroundOverlay?: number;
  readonly clipStartSeconds?: number;
  readonly clipEndSeconds?: number;
  readonly answerRevealed: boolean;
  readonly revealedAnswer?: string;
  readonly answerImage?: string;
  readonly imageLayout?: string;
  readonly answerExplanation?: string;
  readonly recapQuestionPosition?: number;
  readonly revision: number;
}

export interface LiveActionResponse {
  readonly sessionId: string;
  readonly status: LiveSessionStatus;
  readonly currentSlidePosition: number;
  readonly answerRevealed: boolean;
  readonly presentationMode: LivePresentationMode;
  readonly mediaCommand: MediaPlaybackCommand;
  readonly mediaPlaybackState: MediaPlaybackState;
  readonly mediaGeneration: number;
  readonly revision: number;
}
