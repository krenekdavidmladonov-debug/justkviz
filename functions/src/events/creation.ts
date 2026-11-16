import { createHash } from 'node:crypto';
import { storedEventPricing } from './pricing.js';
import type { EventConfigurationInput } from './types.js';

/** Keep this v1 fingerprint input stable for attempts replayed after later edits. */
export function eventCreationIdentity(actorUid: string, requestId: string, configuration: EventConfigurationInput): {
  readonly eventId: string;
  readonly fingerprint: string;
} {
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    eventId: `event_${digest([actorUid, requestId])}`,
    fingerprint: digest({
      title: configuration.title,
      description: configuration.description ?? '',
      startsAt: configuration.startsAt.toISOString(),
      timeZone: configuration.timeZone,
      venue: { name: configuration.venue.name, publicLocation: configuration.venue.publicLocation },
      pricing: storedEventPricing(configuration.pricing),
      teamCapacity: configuration.teamCapacity,
      peopleCapacity: configuration.peopleCapacity,
      teamSizeMin: configuration.teamSizeMin,
      teamSizeMax: configuration.teamSizeMax,
    }),
  };
}
