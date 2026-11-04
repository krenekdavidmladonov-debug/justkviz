import { pragueInstant } from '@filmovy-kviz/quiz-domain';
import { FunctionsError, httpsCallable } from 'firebase/functions';

import { getFirebaseServices } from '../../services/firebase/client';
import type { EventLifecycleStatus, RegistrationMutationResponse, RegistrationStatus } from './types';

export interface RegistrationFormValues {
  readonly teamName: string;
  readonly memberCount: number;
  readonly contactEmail: string;
}
async function invoke<T>(name: string, data: Record<string, unknown>): Promise<T> {
  return (await httpsCallable<Record<string, unknown>, T>(getFirebaseServices().functions, name)(data)).data;
}

export function configureEventRegistration(
  eventId: string,
  expectedRevision: number,
  registrationOpensAt: string,
  registrationClosesAt: string,
  published: boolean | undefined,
  opensOffset?: string,
  closesOffset?: string,
) {
  return invoke<{ eventId: string; revision: number; registrationStatus: string }>('configureEventRegistration', {
    eventId,
    expectedRevision,
    registrationOpensAt: pragueInstant(registrationOpensAt, opensOffset),
    registrationClosesAt: pragueInstant(registrationClosesAt, closesOffset),
    ...(published === undefined ? {} : { published }),
  });
}

export function setEventPublication(eventId: string, expectedRevision: number, published: boolean) {
  return invoke<{
    eventId: string; revision: number; registrationStatus: RegistrationStatus;
    lifecycleStatus: EventLifecycleStatus; registrationPublished: boolean;
    registrationOpensAt: string | null; registrationClosesAt: string | null;
  }>('configureEventRegistration', { eventId, expectedRevision, published, ...(published ? { openRegistrationsNow: true } : {}) });
}

export function newRegistrationRetryKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function createEventRegistration(eventId: string, values: RegistrationFormValues, requestKey?: string) {
  return invoke<RegistrationMutationResponse>('createEventRegistration', { eventId, ...values, ...(requestKey ? { requestKey } : {}) });
}

export function getManagedRegistration(eventId: string, registrationId: string, token: string) {
  return invoke<RegistrationMutationResponse>('getEventRegistration', { eventId, registrationId, token });
}

export function updateManagedRegistration(eventId: string, registrationId: string, token: string, values: RegistrationFormValues, requestId?: string) {
  return invoke<RegistrationMutationResponse>('updateEventRegistration', { eventId, registrationId, token, ...values, ...(requestId ? { requestId } : {}) });
}

export function cancelManagedRegistration(eventId: string, registrationId: string, token: string) {
  return invoke<RegistrationMutationResponse>('cancelEventRegistration', { eventId, registrationId, token });
}

export function adminCancelRegistration(eventId: string, registrationId: string) {
  return invoke<RegistrationMutationResponse>('adminCancelEventRegistration', { eventId, registrationId });
}

export function adminAddEventTeam(eventId: string, requestId: string, values: RegistrationFormValues) {
  return invoke<{ registrationId: string; teamName: string }>('adminAddEventTeam', { eventId, requestId, ...values });
}

export function adminUpdateEventTeam(eventId: string, registrationId: string, expectedRevision: number, values: RegistrationFormValues) {
  return invoke<{ registrationId: string; teamName: string }>('adminUpdateEventTeam', { eventId, registrationId, expectedRevision, ...values });
}

export function reissueRegistrationLink(eventId: string, registrationId: string, expectedRevision: number) {
  return invoke<{ registrationId: string; managementToken: string | null }>('adminUpdateEventTeam', { eventId, registrationId, expectedRevision, action: 'reissueLink', requestId: crypto.randomUUID() });
}

export function registrationActionError(error: unknown): string {
  if (error instanceof FunctionsError) {
    if (error.code === 'functions/aborted') return 'Tým mezitím někdo změnil. Zavřete dialog a obnovte seznam před další úpravou.';
    if (error.code === 'functions/already-exists' && /^request(?:Id|Key)/u.test(error.message)) return 'Tento požadavek již byl přijat s jinými údaji. Nevytvářejte duplikát; použijte původní odkaz pro správu registrace.';
    if (error.code === 'functions/already-exists') return 'Tým s tímto názvem už je na akci přihlášený.';
    if (error.code === 'functions/resource-exhausted') return 'Kapacita akce už nestačí pro tento tým.';
    if (error.code === 'functions/not-found') return 'Registrace nebo bezpečný odkaz nejsou platné.';
    if (error.code === 'functions/permission-denied') return 'Tuto operaci nelze provést v přihlášené staff relaci.';
    if (error.code === 'functions/invalid-argument') {
      if (error.message.startsWith('contactEmail')) return 'Zadejte platný e-mail.';
      if (error.message.startsWith('memberCount') || error.message.startsWith('Team size')) return 'Počet členů musí být celé číslo v povoleném rozsahu této akce.';
      if (error.message.startsWith('teamName')) return 'Název týmu musí mít 2–80 znaků a nesmí obsahovat řídicí znaky.';
      return 'Zkontrolujte vyplněné údaje a zkuste to znovu.';
    }
    if (error.code === 'functions/failed-precondition') {
      if (error.message.startsWith('Registration capacity is full')) return 'Kapacita akce je naplněna. Nový tým nyní nelze přihlásit.';
      if (error.message.startsWith('Registration is closed')) return 'Registrace jsou uzavřené. Přihlášku už nelze měnit ani zrušit.';
      if (error.message.startsWith('Registration is cancelled')) return 'Tato přihláška už byla zrušena.';
      return 'Tuto změnu teď nelze provést. Obnovte stránku a zkontrolujte stav registrace.';
    }
  }
  if (error instanceof Error && !('code' in error)) return error.message;
  return 'Registraci se nepodařilo uložit. Zkuste to znovu.';
}
