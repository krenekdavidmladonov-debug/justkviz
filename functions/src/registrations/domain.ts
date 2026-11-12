import type { RegistrationCapacity } from './types.js';

export type EffectiveRegistrationStatus = 'scheduled' | 'open' | 'full' | 'closed';

export function normalizeTeamName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('cs-CZ');
}
export function capacityAfter(
  capacity: RegistrationCapacity,
  teamDelta: number,
  peopleDelta: number,
): RegistrationCapacity {
  return {
    ...capacity,
    acceptedTeams: capacity.acceptedTeams + teamDelta,
    acceptedPeople: capacity.acceptedPeople + peopleDelta,
  };
}

export function hasCapacity(capacity: RegistrationCapacity, teamDelta: number, peopleDelta: number): boolean {
  const next = capacityAfter(capacity, teamDelta, peopleDelta);
  return next.acceptedTeams >= 0
    && next.acceptedPeople >= 0
    && next.acceptedTeams <= next.maximumTeams;
}

export function effectiveRegistrationStatus(input: {
  readonly published: boolean;
  readonly lifecycleStatus: string;
  readonly opensAtMillis: number;
  readonly closesAtMillis: number;
  readonly nowMillis: number;
  readonly capacity: RegistrationCapacity;
}): EffectiveRegistrationStatus {
  if (!input.published || input.lifecycleStatus === 'cancelled' || input.lifecycleStatus === 'archived') return 'closed';
  if (input.nowMillis < input.opensAtMillis) return 'scheduled';
  if (input.nowMillis >= input.closesAtMillis) return 'closed';
  if (input.capacity.acceptedTeams >= input.capacity.maximumTeams) return 'full';
  return 'open';
}
