import type { EventFormValues, EventMutationResponse, EventRecord } from '../../apps/web/src/features/events/types';
import type { Access } from '../../apps/web/src/features/referee/api';
import { canMutateEvent, defaultScoringConfiguration, validateEventConfiguration } from '../../functions/src/events/model';
import { pragueInstant } from '../../packages/quiz-domain/src/event-management';
import { eventFormPricing, mapEventPricing } from '../../apps/web/src/features/events/eventPricing';

export function eventFormRecord(): EventRecord {
  return {
    id: 'synthetic-event', title: 'Syntetická testovací akce', description: '', disposition: 'active',
    startsAt: new Date('2030-10-20T17:00:00Z'), timeZone: 'Europe/Prague',
    venue: { name: 'Testovací sál', publicLocation: 'Testovací lokalita' },
    pricing: { mode: 'per-team', amountCzk: 350 },
    teamCapacity: 20, peopleCapacity: 80, teamSizeMin: 2, teamSizeMax: 4,
    acceptedTeams: 0, acceptedPeople: 0, registrationPublished: false,
    registrationStatus: 'scheduled', lifecycleStatus: 'draft', revision: 2,
    scoring: { ...defaultScoringConfiguration },
  };
}

function configuration(values: EventFormValues) {
  // Same Prague wall-clock conversion as eventApi; form-only keys are not stored.
  const fields = {
    title: values.title.trim(), description: (values.description ?? '').trim(),
    startsAt: new Date(pragueInstant(values.startsAt, values.utcOffset)), timeZone: 'Europe/Prague',
    venue: { name: values.venueName.trim(), publicLocation: values.publicLocation.trim() },
    pricing: mapEventPricing(eventFormPricing(values)),
    teamCapacity: values.teamCapacity, peopleCapacity: values.peopleCapacity,
    teamSizeMin: values.teamSizeMin, teamSizeMax: values.teamSizeMax,
  };
  const issues = validateEventConfiguration(fields);
  if (issues.length > 0) throw new Error(issues.join(' '));
  return fields;
}

function mutationResponse(record: EventRecord): EventMutationResponse {
  return {
    eventId: record.id, revision: record.revision,
    lifecycleStatus: record.lifecycleStatus, registrationStatus: record.registrationStatus,
  };
}

// One page owns one synthetic event. This is only the create/edit fixture, not a backend substitute.
export function createEventFormData(initial: EventRecord | null = eventFormRecord(), failWrites = false) {
  let record = structuredClone(initial);
  function assertWritable() {
    if (failWrites) throw new Error('Změny se nepodařilo uložit. Zkuste to znovu.');
  }
  return {
    getEvent(id: string): EventRecord | null {
      return record?.id === id ? structuredClone(record) : null;
    },
    createEvent(values: EventFormValues): EventMutationResponse {
      assertWritable();
      if (record !== null) throw new Error('The isolated fixture already contains its event.');
      record = { ...eventFormRecord(), ...configuration(values), lifecycleStatus: 'scheduled', revision: 1 };
      return mutationResponse(record);
    },
    updateEvent(id: string, revision: number, values: EventFormValues): EventMutationResponse {
      assertWritable();
      if (record === null || record.id !== id) throw new Error('Event was not found.');
      if (record.revision !== revision) throw new Error('Event changed in another client.');
      if (!canMutateEvent(record.lifecycleStatus)) throw new Error('Unsupported event lifecycle in the form fixture.');
      const fields = configuration(values);
      if (fields.teamCapacity < record.acceptedTeams) {
        throw new Error('Capacity cannot be lower than accepted registrations.');
      }
      const full = record.acceptedTeams >= fields.teamCapacity;
      const registrationStatus = record.registrationStatus === 'open' && full ? 'full'
        : record.registrationStatus === 'full' && !full ? 'open' : record.registrationStatus;
      record = { ...record, ...fields, registrationStatus, revision: record.revision + 1 };
      return mutationResponse(record);
    },
    listRefereeAccess(id: string): Access[] {
      if (record === null || record.id !== id) throw new Error('Event was not found.');
      // These scenarios have no issued referee credentials; no write operation is simulated.
      return [];
    },
  };
}
