export const registrationStatuses = ['scheduled', 'open', 'paused', 'full', 'closed'] as const;
export type RegistrationStatus = typeof registrationStatuses[number];

export const eventLifecycleStatuses = [
  'draft', 'scheduled', 'ready', 'live', 'finalizing', 'completed', 'cancelled', 'archived',
] as const;
export type EventLifecycleStatus = typeof eventLifecycleStatuses[number];

export interface EventVenueInput {
  readonly name: string;
  readonly publicLocation: string;
}

export interface EventConfigurationInput {
  readonly pricing?: EventPricing;
  readonly description?: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly timeZone: string;
  readonly venue: EventVenueInput;
  readonly teamCapacity: number;
  readonly peopleCapacity: number;
  readonly teamSizeMin: number;
  readonly teamSizeMax: number;
}

export type EventPricing = (
  | { readonly mode: 'per-team' | 'per-event'; readonly amountCzk: number }
  | { readonly mode: 'agreement'; readonly amountCzk: null }
) & { readonly hidden?: boolean };

export interface EventScoringConfiguration {
  readonly unitScale: 2;
  readonly rankingMode: 'dense';
  readonly started: boolean;
}

export interface QuizAssignment {
  readonly quizId: string;
  readonly quizRevision: number;
  readonly snapshotId: string;
  readonly quizTitle: string;
  readonly roundCount: number;
  readonly questionCount: number;
  readonly lockedAt: unknown;
}

export interface EventMutationResponse {
  readonly eventId: string;
  readonly revision: number;
  readonly lifecycleStatus: EventLifecycleStatus;
  readonly registrationStatus: RegistrationStatus;
  readonly snapshotId?: string;
  readonly preflight?: {
    readonly status: 'BLOCKED' | 'READY' | 'READY_WITH_WARNINGS';
    readonly blockerCount: number;
    readonly warningCount: number;
  };
}

export interface PublicEventProjectionInput {
  readonly pricing?: unknown;
  readonly description?: string;
  readonly lifecycleStatus?: EventLifecycleStatus;
  readonly title: string;
  readonly startsAt: unknown;
  readonly timeZone: string;
  readonly venue: EventVenueInput;
  readonly registrationStatus: RegistrationStatus;
  readonly registrationPublished: boolean;
  readonly teamSizeMin: number;
  readonly teamSizeMax: number;
  readonly teamCapacity: number;
  readonly peopleCapacity: number;
  readonly acceptedTeams: number;
  readonly acceptedPeople: number;
  readonly registrationOpensAt: unknown;
  readonly registrationClosesAt: unknown;
  readonly revision: number;
  readonly updatedAt: unknown;
}
