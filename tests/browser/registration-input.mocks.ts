import type { RegistrationFormValues } from '../../apps/web/src/features/events/registrationApi';
import type { PublicEventRecord, RegistrationMutationResponse } from '../../apps/web/src/features/events/types';

declare global {
  interface Window {
    registrationInputCalls: { operation: 'create' | 'update'; values: RegistrationFormValues }[];
  }
}

window.registrationInputCalls = [];
const minimum = Number(new URLSearchParams(location.search).get('min') ?? 2);
const event: PublicEventRecord = {
  id: 'synthetic-event', title: 'Syntetický večer', startsAt: new Date('2031-10-20T17:00:00Z'),
  timeZone: 'Europe/Prague', venueName: 'Testovací sál', publicLocation: 'Testovací místo',
  registrationStatus: 'open', registrationPublished: true, lifecycleStatus: 'ready',
  teamSizeMin: minimum, teamSizeMax: 6, teamCapacity: 20, peopleCapacity: 80,
  acceptedTeams: 1, acceptedPeople: 2, revision: 1,
  registrationOpensAt: new Date('2030-10-19T17:00:00Z'), registrationClosesAt: new Date('2031-10-20T17:00:00Z'),
};
let registration: RegistrationMutationResponse = {
  eventId: event.id, registrationId: 'synthetic-registration', managementToken: 'synthetic-token',
  teamName: 'Syntetický tým', memberCount: minimum, contactEmail: 'synthetic@example.test', status: 'accepted',
};

export const getPublicEvent = () => Promise.resolve(structuredClone(event));
export const getManagedRegistration = () => Promise.resolve(structuredClone(registration));
export const newRegistrationRetryKey = () => 'synthetic-retry-key';
export const registrationActionError = () => 'Syntetická chyba uložení.';
export function createEventRegistration(_eventId: string, values: RegistrationFormValues) {
  window.registrationInputCalls.push({ operation: 'create', values: structuredClone(values) });
  registration = { ...registration, ...values };
  return Promise.resolve(structuredClone(registration));
}
export function updateManagedRegistration(_eventId: string, _registrationId: string, _token: string, values: RegistrationFormValues) {
  window.registrationInputCalls.push({ operation: 'update', values: structuredClone(values) });
  registration = { ...registration, ...values };
  return Promise.resolve(structuredClone(registration));
}
export const cancelManagedRegistration = () => Promise.resolve({ ...registration, status: 'cancelled' as const });
