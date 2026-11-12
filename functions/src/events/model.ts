import type {
  EventConfigurationInput,
  EventLifecycleStatus,
  EventScoringConfiguration,
  PublicEventProjectionInput,
  RegistrationStatus,
} from './types.js';
import { publicEventPricing } from './pricing.js';

export const defaultScoringConfiguration: EventScoringConfiguration = {
  unitScale: 2,
  rankingMode: 'dense',
  started: false,
};

export const maximumTeamMembers = 4;

interface ConfigurationValidationOptions {
  // Publication must still validate retained events without rewriting their team limits.
  readonly allowLegacyTeamSize?: boolean;
}

export function validateEventCapacity(configuration: Pick<
  EventConfigurationInput,
  'teamCapacity' | 'peopleCapacity' | 'teamSizeMin' | 'teamSizeMax'
>, options: ConfigurationValidationOptions = {}): readonly string[] {
  const issues: string[] = [];
  if (!Number.isInteger(configuration.teamCapacity) || configuration.teamCapacity <= 0) {
    issues.push('teamCapacity must be a positive integer.');
  }
  if (!Number.isInteger(configuration.peopleCapacity) || configuration.peopleCapacity <= 0) {
    issues.push('peopleCapacity must be a positive integer.');
  }
  if (!Number.isInteger(configuration.teamSizeMin) || configuration.teamSizeMin <= 0) {
    issues.push('teamSizeMin must be a positive integer.');
  }
  if (!Number.isInteger(configuration.teamSizeMax)
    || configuration.teamSizeMax < configuration.teamSizeMin) {
    issues.push('teamSizeMax must be an integer greater than or equal to teamSizeMin.');
  }
  if (!options.allowLegacyTeamSize && configuration.teamSizeMax > maximumTeamMembers) {
    issues.push(`teamSizeMax cannot exceed ${maximumTeamMembers}.`);
  }
  return issues;
}

export function validateEventConfiguration(configuration: EventConfigurationInput, options: ConfigurationValidationOptions = {}): readonly string[] {
  const issues = [...validateEventCapacity(configuration, options)];
  if (configuration.title.trim() === '') issues.push('title is required.');
  if (configuration.venue.name.trim() === '') issues.push('venue.name is required.');
  if (configuration.venue.publicLocation.trim() === '') issues.push('venue.publicLocation is required.');
  if (Number.isNaN(configuration.startsAt.getTime())) issues.push('startsAt is invalid.');
  try {
    new Intl.DateTimeFormat('en', { timeZone: configuration.timeZone }).format(configuration.startsAt);
  } catch {
    issues.push('timeZone is invalid.');
  }
  return issues;
}

export function buildPublicEventProjection(input: PublicEventProjectionInput): Record<string, unknown> {
  return {
    title: input.title,
    pricing: publicEventPricing(input.pricing),
    ...(typeof input.description === 'string' ? { description: input.description } : {}),
    ...(isEventLifecycleStatus(input.lifecycleStatus) ? { lifecycleStatus: input.lifecycleStatus } : {}),
    startsAt: input.startsAt,
    timeZone: input.timeZone,
    venueName: input.venue.name,
    publicLocation: input.venue.publicLocation,
    registrationStatus: input.registrationStatus,
    registrationPublished: input.registrationPublished,
    teamSize: { min: input.teamSizeMin, max: input.teamSizeMax },
    capacity: {
      teams: { accepted: input.acceptedTeams, maximum: input.teamCapacity },
      people: { accepted: input.acceptedPeople, maximum: input.peopleCapacity },
    },
    registrationWindow: {
      opensAt: input.registrationOpensAt,
      closesAt: input.registrationClosesAt,
    },
    availability: input.registrationStatus,
    revision: input.revision,
    updatedAt: input.updatedAt,
  };
}

export function canMutateEvent(lifecycleStatus: EventLifecycleStatus): boolean {
  return lifecycleStatus === 'draft' || lifecycleStatus === 'scheduled' || lifecycleStatus === 'ready';
}

export function canCancelEvent(lifecycleStatus: EventLifecycleStatus): boolean {
  return lifecycleStatus !== 'completed' && lifecycleStatus !== 'cancelled' && lifecycleStatus !== 'archived';
}

export function canArchiveEvent(lifecycleStatus: EventLifecycleStatus): boolean {
  return lifecycleStatus === 'cancelled' || lifecycleStatus === 'completed';
}

export function canLockQuiz(lifecycleStatus: EventLifecycleStatus, scoringStarted: boolean): boolean {
  return !scoringStarted && (lifecycleStatus === 'draft' || lifecycleStatus === 'scheduled' || lifecycleStatus === 'ready');
}

export function isRegistrationStatus(value: unknown): value is RegistrationStatus {
  return value === 'scheduled' || value === 'open' || value === 'paused'
    || value === 'full' || value === 'closed';
}

export function isEventLifecycleStatus(value: unknown): value is EventLifecycleStatus {
  return value === 'draft' || value === 'scheduled' || value === 'ready'
    || value === 'live' || value === 'finalizing' || value === 'completed'
    || value === 'cancelled' || value === 'archived';
}
