import { eventDisposition } from '@filmovy-kviz/quiz-domain';
import { Timestamp, type DocumentData } from 'firebase/firestore';
import { mapEventPricing, mapPublicEventPricing } from './eventPricing';

import type {
  EventLifecycleStatus,
  EventQuizAssignment,
  EventRecord,
  PublicEventRecord,
  RegistrationStatus,
  RegistrationRecord,
} from './types';

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && !Array.isArray(value) && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined;
}

function text(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== 'string') throw new Error(`Neplatné pole akce: ${field}`);
  return value;
}

function integer(data: Record<string, unknown>, field: string, minimum = 0): number {
  const value = data[field];
  if (!Number.isInteger(value) || (value as number) < minimum) throw new Error(`Neplatné pole akce: ${field}`);
  return value as number;
}

function date(value: unknown, field: string): Date {
  if (!(value instanceof Timestamp)) throw new Error(`Neplatné pole akce: ${field}`);
  return value.toDate();
}

function optionalDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null) return undefined;
  return date(value, field);
}

function registrationStatus(value: unknown): RegistrationStatus {
  if (value !== 'scheduled' && value !== 'open' && value !== 'paused' && value !== 'full' && value !== 'closed') {
    throw new Error('Neplatný stav registrace.');
  }
  return value;
}

function lifecycleStatus(value: unknown): EventLifecycleStatus {
  if (value !== 'draft' && value !== 'scheduled' && value !== 'ready' && value !== 'live'
    && value !== 'finalizing' && value !== 'completed' && value !== 'cancelled' && value !== 'archived') {
    throw new Error('Neplatný stav akce.');
  }
  return value;
}

function quizAssignment(value: unknown): EventQuizAssignment | undefined {
  if (value === undefined || value === null) return undefined;
  const data = object(value);
  if (data === undefined) throw new Error('Neplatné přiřazení kvízu.');
  return {
    quizId: text(data, 'quizId'),
    quizRevision: integer(data, 'quizRevision'),
    snapshotId: text(data, 'snapshotId'),
    quizTitle: text(data, 'quizTitle'),
    roundCount: integer(data, 'roundCount'),
    questionCount: integer(data, 'questionCount'),
    lockedAt: date(data.lockedAt, 'quizAssignment.lockedAt'),
  };
}

export function mapEvent(id: string, value: DocumentData): EventRecord {
  const data = value as Record<string, unknown>;
  const venue = object(data.venue);
  const scoring = object(data.scoring);
  const assignment = quizAssignment(data.quizAssignment);
  const registrationOpensAt = optionalDate(data.registrationOpensAt, 'registrationOpensAt');
  const registrationClosesAt = optionalDate(data.registrationClosesAt, 'registrationClosesAt');
  if (venue === undefined || scoring === undefined || scoring.unitScale !== 2
    || scoring.rankingMode !== 'dense' || typeof scoring.started !== 'boolean') {
    throw new Error('Konfigurace akce je neplatná.');
  }
  return {
    id,
    pricing: mapEventPricing(data.pricing),
    description: typeof data.description === 'string' ? data.description : '',
    disposition: eventDisposition(data),
    ...(typeof data.liveSessionId === 'string' ? { liveSessionId: data.liveSessionId } : {}),
    title: text(data, 'title'),
    startsAt: date(data.startsAt, 'startsAt'),
    timeZone: text(data, 'timeZone'),
    venue: { name: text(venue, 'name'), publicLocation: text(venue, 'publicLocation') },
    teamCapacity: integer(data, 'teamCapacity', 1),
    peopleCapacity: integer(data, 'peopleCapacity', 1),
    teamSizeMin: integer(data, 'teamSizeMin', 1),
    teamSizeMax: integer(data, 'teamSizeMax', 1),
    acceptedTeams: data.acceptedTeams === undefined ? 0 : integer(data, 'acceptedTeams'),
    acceptedPeople: data.acceptedPeople === undefined ? 0 : integer(data, 'acceptedPeople'),
    registrationPublished: data.registrationPublished === true,
    ...(registrationOpensAt === undefined ? {} : { registrationOpensAt }),
    ...(registrationClosesAt === undefined ? {} : { registrationClosesAt }),
    registrationStatus: registrationStatus(data.registrationStatus),
    lifecycleStatus: lifecycleStatus(data.lifecycleStatus),
    scoring: { unitScale: 2, rankingMode: 'dense', started: scoring.started },
    revision: integer(data, 'revision', 1),
    ...(assignment === undefined ? {} : { quizAssignment: assignment }),
  };
}

export function mapPublicEvent(id: string, value: DocumentData): PublicEventRecord {
  const data = value as Record<string, unknown>;
  const teamSize = object(data.teamSize);
  const capacity = object(data.capacity);
  const teams = capacity && object(capacity.teams);
  const people = capacity && object(capacity.people);
  const window = object(data.registrationWindow);
  const registrationOpensAt = window ? optionalDate(window.opensAt, 'registrationWindow.opensAt') : undefined;
  const registrationClosesAt = window ? optionalDate(window.closesAt, 'registrationWindow.closesAt') : undefined;
  if (teamSize === undefined) throw new Error('Veřejná konfigurace akce je neplatná.');
  return {
    id,
    pricing: mapPublicEventPricing(data.pricing),
    ...(typeof data.description === 'string' ? { description: data.description } : {}),
    ...(data.lifecycleStatus === undefined ? {} : { lifecycleStatus: lifecycleStatus(data.lifecycleStatus) }),
    title: text(data, 'title'),
    startsAt: date(data.startsAt, 'startsAt'),
    timeZone: text(data, 'timeZone'),
    cancelled: data.cancelled === true,
    cancellationMessage: typeof data.cancellationMessage === 'string' ? data.cancellationMessage : '',
    venueName: text(data, 'venueName'),
    publicLocation: text(data, 'publicLocation'),
    registrationStatus: registrationStatus(data.registrationStatus),
    registrationPublished: data.registrationPublished === true,
    teamSizeMin: integer(teamSize, 'min', 1),
    teamSizeMax: integer(teamSize, 'max', 1),
    teamCapacity: teams ? integer(teams, 'maximum', 1) : 0,
    peopleCapacity: people ? integer(people, 'maximum', 1) : 0,
    acceptedTeams: teams ? integer(teams, 'accepted') : 0,
    acceptedPeople: people ? integer(people, 'accepted') : 0,
    ...(registrationOpensAt === undefined ? {} : { registrationOpensAt }),
    ...(registrationClosesAt === undefined ? {} : { registrationClosesAt }),
    revision: integer(data, 'revision', 1),
  };
}

export function mapRegistration(id: string, value: DocumentData): RegistrationRecord {
  const data = value as Record<string, unknown>;
  if (data.status !== 'accepted' && data.status !== 'cancelled') throw new Error('Neplatný stav registrace.');
  const cancelledAt = optionalDate(data.cancelledAt, 'cancelledAt');
  const delivery = data.emailDelivery as { status?: unknown; updatedAt?: unknown } | undefined;
  const emailDelivery: RegistrationRecord['emailDelivery'] = delivery && (delivery.status === 'pending' || delivery.status === 'processing' || delivery.status === 'sent' || delivery.status === 'failed')
    ? { status: delivery.status, updatedAt: date(delivery.updatedAt, 'emailDelivery.updatedAt') } : undefined;
  return {
    id,
    eventId: text(data, 'eventId'),
    teamName: text(data, 'teamName'),
    memberCount: integer(data, 'memberCount', 1),
    contactEmail: data.source === 'manual' && data.contactEmail == null ? null : text(data, 'contactEmail'),
    source: data.source === 'manual' ? 'manual' : 'online',
    revision: data.revision === undefined ? 0 : integer(data, 'revision'),
    status: data.status,
    createdAt: date(data.createdAt, 'createdAt'),
    updatedAt: date(data.updatedAt, 'updatedAt'),
    ...(cancelledAt === undefined ? {} : { cancelledAt }),
    ...(emailDelivery === undefined ? {} : { emailDelivery }),
  };
}
