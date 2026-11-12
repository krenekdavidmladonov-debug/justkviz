import { assertPlayableQuizSource } from '../quizzes/playable.js';
import { eventSessions } from '../live/event-lifecycle.js';
import { assertQuizAssets } from '../media/model.js';
import { assertEventOperational } from './guards.js';
import { storedEventPricing } from './pricing.js';
export { cancelEvent, archiveEvent } from './management.js';
import {
  mapEditorQuiz,
  mapEditorSlide,
  runQuizPreflight,
} from '@filmovy-kviz/quiz-domain';
import { getApps, initializeApp } from 'firebase-admin/app';
import {
  getFirestore,
  Timestamp,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { accessActor, securedOnCall, runAccessTransaction, grantCreatedResource } from '../access/authorization.js';

import {
  buildPublicEventProjection,
  canLockQuiz,
  canMutateEvent,
  defaultScoringConfiguration,
  isEventLifecycleStatus,
  isRegistrationStatus,
} from './model.js';
import {
  buildQuizSnapshotMetadata,
  snapshotWriteCount,
} from './snapshot-model.js';
import type {
  EventConfigurationInput,
  EventLifecycleStatus,
  EventMutationResponse,
  EventPricing,
  EventScoringConfiguration,
  EventVenueInput,
  RegistrationStatus,
} from './types.js';
import {
  expectedRevision,
  isObject,
  requestedEventConfiguration,
  requiredId,
} from './validation.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const callableOptions = { region: 'europe-west1', cors: true } as const;
const maximumSnapshotWrites = 475;

interface AdminActor { readonly uid: string; readonly role: 'admin' }
interface StoredEvent {
  readonly pricing: EventPricing;
  readonly title: string;
  readonly description: string;
  readonly startsAt: unknown;
  readonly timeZone: string;
  readonly venue: EventVenueInput;
  readonly teamCapacity: number;
  readonly peopleCapacity: number;
  readonly teamSizeMin: number;
  readonly teamSizeMax: number;
  readonly acceptedTeams: number;
  readonly acceptedPeople: number;
  readonly registrationOpensAt: unknown;
  readonly registrationClosesAt: unknown;
  readonly registrationStatus: RegistrationStatus;
  readonly registrationPublished: boolean;
  readonly lifecycleStatus: EventLifecycleStatus;
  readonly scoring: EventScoringConfiguration;
  readonly revision: number;
}

export function authorizeEventAdmin(auth: CallableRequest<unknown>['auth']): AdminActor {
  return accessActor(auth);
}

function snapshotData(snapshot: DocumentSnapshot, location: string): Record<string, unknown> {
  const value: unknown = snapshot.data();
  if (!isObject(value)) throw new HttpsError('failed-precondition', `${location} is malformed.`);
  return value;
}

function storedPositiveInteger(data: Record<string, unknown>, field: string): number {
  const value = data[field];
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new HttpsError('failed-precondition', 'Event capacity configuration is malformed.');
  }
  return value as number;
}

function storedText(data: Record<string, unknown>, field: string, location: string): string {
  const value = data[field];
  if (typeof value !== 'string') throw new HttpsError('failed-precondition', `${location} is malformed.`);
  return value;
}

function storedEvent(snapshot: DocumentSnapshot): StoredEvent {
  if (!snapshot.exists) throw new HttpsError('not-found', 'Event was not found.');
  const data = snapshotData(snapshot, 'Event');
  assertEventOperational(data);
  const venue = data.venue;
  const scoring = data.scoring;
  if (!isObject(venue) || !isObject(scoring)
    || !isRegistrationStatus(data.registrationStatus)
    || !isEventLifecycleStatus(data.lifecycleStatus)
    || scoring.unitScale !== 2
    || scoring.rankingMode !== 'dense'
    || typeof scoring.started !== 'boolean'
    || !Number.isInteger(data.revision)
    || (data.revision as number) < 1) {
    throw new HttpsError('failed-precondition', 'Event is malformed.');
  }
  return {
    pricing: storedEventPricing(data.pricing),
    title: storedText(data, 'title', 'Event'),
    description: typeof data.description === 'string' ? data.description : '',
    startsAt: data.startsAt,
    timeZone: storedText(data, 'timeZone', 'Event'),
    venue: {
      name: storedText(venue, 'name', 'Event venue'),
      publicLocation: storedText(venue, 'publicLocation', 'Event venue'),
    },
    teamCapacity: storedPositiveInteger(data, 'teamCapacity'),
    peopleCapacity: storedPositiveInteger(data, 'peopleCapacity'),
    teamSizeMin: storedPositiveInteger(data, 'teamSizeMin'),
    teamSizeMax: storedPositiveInteger(data, 'teamSizeMax'),
    acceptedTeams: Number.isInteger(data.acceptedTeams) && (data.acceptedTeams as number) >= 0
      ? data.acceptedTeams as number : 0,
    acceptedPeople: Number.isInteger(data.acceptedPeople) && (data.acceptedPeople as number) >= 0
      ? data.acceptedPeople as number : 0,
    registrationOpensAt: data.registrationOpensAt ?? null,
    registrationClosesAt: data.registrationClosesAt ?? null,
    registrationStatus: data.registrationStatus,
    registrationPublished: data.registrationPublished === true,
    lifecycleStatus: data.lifecycleStatus,
    scoring: {
      unitScale: 2,
      rankingMode: 'dense',
      started: scoring.started,
    },
    revision: data.revision as number,
  };
}

function assertExpectedRevision(event: StoredEvent, requested: number): void {
  if (event.revision !== requested) {
    throw new HttpsError('aborted', 'Event changed in another client. Reload and try again.');
  }
}

function publicProjection(
  event: Pick<StoredEvent, 'pricing' | 'title' | 'description' | 'lifecycleStatus' | 'startsAt' | 'timeZone' | 'venue' | 'registrationStatus' | 'registrationPublished' | 'teamSizeMin' | 'teamSizeMax' | 'teamCapacity' | 'peopleCapacity' | 'acceptedTeams' | 'acceptedPeople' | 'registrationOpensAt' | 'registrationClosesAt'>,
  revision: number,
  updatedAt: Timestamp,
): Record<string, unknown> {
  return buildPublicEventProjection({ ...event, revision, updatedAt });
}

function configurationFields(configuration: EventConfigurationInput): Record<string, unknown> {
  return {
    pricing: storedEventPricing(configuration.pricing),
    description: configuration.description ?? '',
    title: configuration.title,
    startsAt: Timestamp.fromDate(configuration.startsAt),
    timeZone: configuration.timeZone,
    venue: configuration.venue,
    teamCapacity: configuration.teamCapacity,
    peopleCapacity: configuration.peopleCapacity,
    teamSizeMin: configuration.teamSizeMin,
    teamSizeMax: configuration.teamSizeMax,
  };
}

function response(eventId: string, revision: number, lifecycleStatus: EventLifecycleStatus, registrationStatus: RegistrationStatus): EventMutationResponse {
  return { eventId, revision, lifecycleStatus, registrationStatus };
}

export const createEvent = securedOnCall('createEvent', callableOptions, async (request): Promise<EventMutationResponse> => {
  const actor = authorizeEventAdmin(request.auth);
  const initialRevision = expectedRevision(request.data);
  if (initialRevision !== 0) throw new HttpsError('invalid-argument', 'A new event must use expectedRevision 0.');
  const configuration = requestedEventConfiguration(request.data);
  const eventRef = db.collection('events').doc();
  const publicRef = db.collection('publicEvents').doc(eventRef.id);
  const now = Timestamp.now();
  const registrationStatus: RegistrationStatus = 'scheduled';
  const lifecycleStatus: EventLifecycleStatus = 'scheduled';
  const eventData = {
    schemaVersion: 1,
    ...configurationFields(configuration),
    registrationStatus,
    registrationPublished: false,
    acceptedTeams: 0,
    acceptedPeople: 0,
    registrationOpensAt: null,
    registrationClosesAt: null,
    lifecycleStatus,
    quizAssignment: null,
    scoring: defaultScoringConfiguration,
    revision: 1,
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  };
  await runAccessTransaction(db, async (transaction) => {
    if ((await transaction.get(eventRef)).exists) {
      throw new HttpsError('already-exists', 'Event identifier collision. Try again.');
    }
    grantCreatedResource(transaction, 'event', eventRef.id);
    transaction.create(eventRef, eventData);
    transaction.create(publicRef, publicProjection({
      pricing: storedEventPricing(configuration.pricing),
      title: configuration.title,
      description: configuration.description ?? '',
      lifecycleStatus,
      startsAt: Timestamp.fromDate(configuration.startsAt),
      timeZone: configuration.timeZone,
      venue: configuration.venue,
      registrationStatus,
      registrationPublished: false,
      teamSizeMin: configuration.teamSizeMin,
      teamSizeMax: configuration.teamSizeMax,
      teamCapacity: configuration.teamCapacity,
      peopleCapacity: configuration.peopleCapacity,
      acceptedTeams: 0,
      acceptedPeople: 0,
      registrationOpensAt: null,
      registrationClosesAt: null,
    }, 1, now));
  });
  return response(eventRef.id, 1, lifecycleStatus, registrationStatus);
});

export const updateEvent = securedOnCall('updateEvent', callableOptions, async (request): Promise<EventMutationResponse> => {
  const actor = authorizeEventAdmin(request.auth);
  const eventId = requiredId(request.data, 'eventId');
  const requestedRevision = expectedRevision(request.data);
  const configuration = requestedEventConfiguration(request.data);
  const eventRef = db.collection('events').doc(eventId);
  const publicRef = db.collection('publicEvents').doc(eventId);
  return runAccessTransaction(db, async (transaction) => {
    const current = storedEvent(await transaction.get(eventRef));
    assertExpectedRevision(current, requestedRevision);
    if (!canMutateEvent(current.lifecycleStatus) && current.lifecycleStatus !== 'live') {
      throw new HttpsError('failed-precondition', 'This event can no longer be edited.');
    }
    if (configuration.teamCapacity < current.acceptedTeams) {
      throw new HttpsError('failed-precondition', `Kapacitu nelze snížit pod ${current.acceptedTeams} přijatých týmů.`);
    }
    const sessions = await eventSessions(transaction, eventId);
    const live = sessions.some(s => s.session.status !== 'ended');
    if (live && (configuration.teamCapacity !== current.teamCapacity || configuration.peopleCapacity !== current.peopleCapacity || configuration.teamSizeMin !== current.teamSizeMin || configuration.teamSizeMax !== current.teamSizeMax)) throw new HttpsError('failed-precondition', 'Během živého běhu lze měnit jen název, termín, místo, popis a cenu.');
    const now = Timestamp.now();
    const revision = current.revision + 1;
    const pricing = storedEventPricing(configuration.pricing === undefined ? current.pricing : {
      ...configuration.pricing,
      hidden: configuration.pricing.hidden ?? current.pricing.hidden ?? false,
    });
    const fields = configurationFields({ ...configuration, pricing });
    const capacityFull = current.acceptedTeams >= configuration.teamCapacity;
    const registrationStatus = current.registrationStatus === 'open' && capacityFull
      ? 'full'
      : current.registrationStatus === 'full' && !capacityFull ? 'open' : current.registrationStatus;
    transaction.update(eventRef, { ...fields, registrationStatus, revision, updatedAt: now, updatedBy: actor.uid });
    transaction.set(publicRef, publicProjection({
      ...current,
      ...fields,
      pricing,
      description: configuration.description ?? '',
      registrationStatus,
      startsAt: fields.startsAt,
      venue: configuration.venue,
    }, revision, now));
    return response(eventId, revision, current.lifecycleStatus, registrationStatus);
  });
});

export const lockEventQuiz = securedOnCall('lockEventQuiz', callableOptions, async (request): Promise<EventMutationResponse> => {
  const actor = authorizeEventAdmin(request.auth);
  const eventId = requiredId(request.data, 'eventId');
  const quizId = requiredId(request.data, 'quizId');
  const requestedEventRevision = expectedRevision(request.data);
  const requestedQuizRevision = expectedRevision(request.data, 'expectedQuizRevision');
  const eventRef = db.collection('events').doc(eventId);
  const publicRef = db.collection('publicEvents').doc(eventId);
  const quizRef = db.collection('quizzes').doc(quizId);
  const snapshotRef = db.collection('quizSnapshots').doc();

  return runAccessTransaction(db, async (transaction: Transaction) => {
    const eventSnapshot = await transaction.get(eventRef);
    const quizSnapshot = await transaction.get(quizRef);
    const slideSnapshot = await transaction.get(quizRef.collection('slides').orderBy('position'));
    const roundSnapshot = await transaction.get(quizRef.collection('rounds').orderBy('position'));
    const event = storedEvent(eventSnapshot);
    if (eventSnapshot.data()?.liveSessionId) throw new HttpsError("failed-precondition", "Připravený kvíz již používá moderování akce.");
    assertExpectedRevision(event, requestedEventRevision);
    if (!canLockQuiz(event.lifecycleStatus, event.scoring.started)) {
      throw new HttpsError('failed-precondition', 'The event quiz can no longer be replaced.');
    }
    if (!quizSnapshot.exists) throw new HttpsError('not-found', 'Quiz was not found.');
    const quizData = snapshotData(quizSnapshot, 'Quiz');
    const actualQuizRevision = quizData.revision === undefined ? 0 : quizData.revision;
    if (!Number.isInteger(actualQuizRevision) || (actualQuizRevision as number) < 0) {
      throw new HttpsError('failed-precondition', 'Quiz revision is malformed.');
    }
    if (actualQuizRevision !== requestedQuizRevision) {
      throw new HttpsError('aborted', 'Quiz changed after selection. Reload and try again.');
    }
    if (snapshotWriteCount(slideSnapshot.size, roundSnapshot.size) > maximumSnapshotWrites) {
      throw new HttpsError('resource-exhausted', 'Quiz is too large for one atomic event snapshot.');
    }
    if (quizData.roundCount !== roundSnapshot.size) {
      throw new HttpsError('failed-precondition', 'Quiz roundCount does not match its stored rounds.');
    }
    const roundTitles = new Map<string, string>();
    for (const round of roundSnapshot.docs) {
      const title: unknown = round.data().title;
      if (typeof title === 'string') roundTitles.set(round.id, title);
    }
    let quiz;
    try {
      const slides = slideSnapshot.docs.map((slide: QueryDocumentSnapshot) => {
        const mapped = mapEditorSlide(slide.id, slide.data());
        const title = mapped.roundId === undefined ? undefined : roundTitles.get(mapped.roundId);
        return mapped.roundTitle !== undefined || title === undefined ? mapped : { ...mapped, roundTitle: title };
      });
      quiz = mapEditorQuiz(quizSnapshot.id, quizData, slides);
    } catch {
      throw new HttpsError('failed-precondition', 'Quiz source is malformed.');
    }
    assertPlayableQuizSource(quiz.slideCount, slideSnapshot.docs.map(slide => slide.data()));
    await assertQuizAssets(transaction, db, quizId, slideSnapshot.docs.map(slide => slide.data()));
    const preflight = runQuizPreflight(quiz);
    const now = Timestamp.now();
    const revision = event.revision + 1;
    const preflightSummary = {
      status: preflight.status,
      blockerCount: preflight.blockerCount,
      warningCount: preflight.warningCount,
    } as const;
    transaction.create(snapshotRef, { ...buildQuizSnapshotMetadata(quiz, preflight, actor.uid, now), eventId });
    for (const slide of slideSnapshot.docs) {
      transaction.create(snapshotRef.collection('slides').doc(slide.id), slide.data());
    }
    for (const round of roundSnapshot.docs) {
      transaction.create(snapshotRef.collection('rounds').doc(round.id), round.data());
    }
    const quizAssignment = {
      quizId,
      quizRevision: requestedQuizRevision,
      snapshotId: snapshotRef.id,
      quizTitle: quiz.title,
      roundCount: quiz.roundCount,
      questionCount: quiz.questionCount,
      lockedAt: now,
    };
    transaction.update(eventRef, {
      quizAssignment,
      lifecycleStatus: 'ready',
      revision,
      updatedAt: now,
      updatedBy: actor.uid,
    });
    transaction.set(publicRef, publicProjection({ ...event, lifecycleStatus: 'ready' }, revision, now));
    return {
      ...response(eventId, revision, 'ready', event.registrationStatus),
      snapshotId: snapshotRef.id,
      preflight: preflightSummary,
    };
  });
});
