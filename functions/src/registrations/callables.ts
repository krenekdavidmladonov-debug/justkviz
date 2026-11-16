import { assertCapability, assertEventOperational, isCompletedEventHide } from '../events/guards.js';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { accessActor, securedOnCall, runAccessTransaction } from '../access/authorization.js';

import { buildPublicEventProjection, isEventLifecycleStatus, maximumTeamMembers } from '../events/model.js';
import { requestedEventConfiguration } from '../events/validation.js';
import { enqueueRegistrationEmail } from '../email/intent.js';
import { enqueueRegistrationOwnerNotification } from '../email/organizer.js';
import { emulatorTokenVault, type TokenEnvelope } from '../email/token-vault.js';
import { emailEmulatorRuntime, registrationEmailActivation, registrationEmailRecipientEligible, registrationEmailSecrets } from '../email/runtime.js';
import { capacityAfter, effectiveRegistrationStatus, hasCapacity } from './domain.js';
import { consumeRegistrationBudget, reportRegistrationThrottle } from './abuse.js';
import type { RegistrationCapacity, RegistrationInput } from './types.js';
import { manualTeamInput, registrationInput, registrationWindow, requestId, requestToken } from './validation.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const callableOptions = { region: 'europe-west1', cors: true } as const;

interface EventState {
  readonly data: Record<string, unknown>;
  readonly revision: number;
  readonly lifecycleStatus: string;
  readonly published: boolean;
  readonly opensAt: Timestamp | null;
  readonly closesAt: Timestamp | null;
  readonly capacity: RegistrationCapacity;
  readonly teamSizeMin: number;
  readonly teamSizeMax: number;
}

function record(value: unknown, message = 'Stored data is malformed.'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpsError('failed-precondition', message);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, minimum: number, message: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum) throw new HttpsError('failed-precondition', message);
  return value as number;
}

function eventState(snapshot: DocumentSnapshot, publicationRequest?: unknown): EventState {
  if (!snapshot.exists) throw new HttpsError('not-found', 'Event was not found.');
  const data = record(snapshot.data(), 'Event is malformed.');
  if (!isCompletedEventHide(data, publicationRequest)) assertEventOperational(data);
  const teamCapacity = integer(data.teamCapacity, 1, 'Event capacity is malformed.');
  const peopleCapacity = integer(data.peopleCapacity, 1, 'Event capacity is malformed.');
  const acceptedTeams = data.acceptedTeams === undefined ? 0 : integer(data.acceptedTeams, 0, 'Event counters are malformed.');
  const acceptedPeople = data.acceptedPeople === undefined ? 0 : integer(data.acceptedPeople, 0, 'Event counters are malformed.');
  const opensAt = data.registrationOpensAt instanceof Timestamp ? data.registrationOpensAt : null;
  const closesAt = data.registrationClosesAt instanceof Timestamp ? data.registrationClosesAt : null;
  return {
    data,
    revision: integer(data.revision, 1, 'Event revision is malformed.'),
    lifecycleStatus: typeof data.lifecycleStatus === 'string' ? data.lifecycleStatus : 'scheduled',
    published: data.registrationPublished === true,
    opensAt,
    closesAt,
    capacity: { acceptedTeams, acceptedPeople, maximumTeams: teamCapacity, maximumPeople: peopleCapacity },
    teamSizeMin: integer(data.teamSizeMin, 1, 'Event team limits are malformed.'),
    teamSizeMax: integer(data.teamSizeMax, 1, 'Event team limits are malformed.'),
  };
}

function requireAdmin(auth: CallableRequest<unknown>['auth']): string {
  return accessActor(auth).uid;
}

function requirePublicCaller(auth: CallableRequest<unknown>['auth']): void {
  if (auth !== undefined) throw new HttpsError('permission-denied', 'Use the public registration form without a staff session.');
}

function statusAt(event: EventState, now: Timestamp) {
  if (event.opensAt === null || event.closesAt === null) return 'closed' as const;
  return effectiveRegistrationStatus({
    published: event.published,
    lifecycleStatus: event.lifecycleStatus,
    opensAtMillis: event.opensAt.toMillis(),
    closesAtMillis: event.closesAt.toMillis(),
    nowMillis: now.toMillis(),
    capacity: event.capacity,
  });
}

function publicProjection(event: EventState, status: 'scheduled' | 'open' | 'full' | 'closed', now: Timestamp) {
  const venue = record(event.data.venue, 'Event venue is malformed.');
  if (typeof event.data.title !== 'string' || typeof event.data.timeZone !== 'string'
    || typeof venue.name !== 'string' || typeof venue.publicLocation !== 'string') {
    throw new HttpsError('failed-precondition', 'Event public data is malformed.');
  }
  return buildPublicEventProjection({
    pricing: event.data.pricing,
    title: event.data.title,
    ...(typeof event.data.description === 'string' ? { description: event.data.description } : {}),
    ...(isEventLifecycleStatus(event.lifecycleStatus) ? { lifecycleStatus: event.lifecycleStatus } : {}),
    startsAt: event.data.startsAt,
    timeZone: event.data.timeZone,
    venue: { name: venue.name, publicLocation: venue.publicLocation },
    registrationStatus: status,
    registrationPublished: event.published,
    teamSizeMin: event.teamSizeMin,
    teamSizeMax: event.teamSizeMax,
    teamCapacity: event.capacity.maximumTeams,
    peopleCapacity: event.capacity.maximumPeople,
    acceptedTeams: event.capacity.acceptedTeams,
    acceptedPeople: event.capacity.acceptedPeople,
    registrationOpensAt: event.opensAt,
    registrationClosesAt: event.closesAt,
    revision: event.revision,
    updatedAt: now,
  });
}

function assertWindowOpen(event: EventState, now: Timestamp, allowFull = false): void {
  const status = statusAt(event, now);
  if (status !== 'open' && !(allowFull && status === 'full')) {
    throw new HttpsError('failed-precondition', status === 'full' ? 'Registration capacity is full.' : 'Registration is closed.');
  }
}

function assertTeamSize(event: EventState, input: Pick<RegistrationInput, 'memberCount'>): void {
  const maximum = Math.min(event.teamSizeMax, maximumTeamMembers);
  if (input.memberCount < event.teamSizeMin || input.memberCount > maximum) {
    throw new HttpsError('invalid-argument', `Team size must be between ${event.teamSizeMin} and ${maximum}.`);
  }
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function nameKey(normalizedName: string): string {
  return createHash('sha256').update(normalizedName, 'utf8').digest('hex');
}

function verifyToken(storedHash: unknown, token: string): void {
  const supplied = Buffer.from(tokenHash(token), 'hex');
  const stored = typeof storedHash === 'string' && /^[a-f0-9]{64}$/u.test(storedHash)
    ? Buffer.from(storedHash, 'hex') : Buffer.alloc(0);
  if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
    throw new HttpsError('not-found', 'Registration was not found.');
  }
}

function safeResponse(id: string, data: Record<string, unknown>, managementToken?: string) {
  return {
    eventId: data.eventId,
    registrationId: id,
    teamName: data.teamName,
    memberCount: data.memberCount,
    contactEmail: data.contactEmail,
    status: data.status,
    ...(managementToken === undefined ? {} : { managementToken }),
  };
}

export const configureEventRegistration = securedOnCall('configureEventRegistration', callableOptions, async (request) => {
  const uid = requireAdmin(request.auth);
  const eventId = requestId(request.data, 'eventId');
  const expectedRevision = record(request.data).expectedRevision;
  if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 1) {
    throw new HttpsError('invalid-argument', 'expectedRevision is invalid.');
  }
  const window = registrationWindow(request.data);
  const eventRef = db.collection('events').doc(eventId);
  const publicRef = db.collection('publicEvents').doc(eventId);
  return runAccessTransaction(db, async (transaction) => {
    const current = eventState(await transaction.get(eventRef), request.data);
    if (current.revision !== expectedRevision) throw new HttpsError('aborted', 'Event changed. Reload and try again.');
    const published = window.published ?? current.published;
    if (published) {
      // Publication validates only public event configuration, never quiz readiness.
      if (!(current.data.startsAt instanceof Timestamp)) throw new HttpsError('failed-precondition', 'Event start is invalid.');
      try {
        requestedEventConfiguration({ event: { ...current.data, startsAt: current.data.startsAt.toDate().toISOString() } }, { allowLegacyTeamSize: true });
      } catch {
        throw new HttpsError('failed-precondition', 'Doplňte platný název, termín, místo a kapacity před zveřejněním akce.');
      }
    }
    const now = Timestamp.now();
    if (window.openRegistrationsNow && (!(current.data.startsAt instanceof Timestamp) || current.data.startsAt.toMillis() <= now.toMillis())) {
      throw new HttpsError('failed-precondition', 'Registrace lze otevřít pouze pro budoucí akci.');
    }
    const revision = current.revision + 1;
    const next: EventState = {
      ...current,
      revision,
      published,
      opensAt: window.openRegistrationsNow ? now : window.opensAt === undefined ? current.opensAt : Timestamp.fromDate(window.opensAt),
      closesAt: window.openRegistrationsNow ? current.data.startsAt as Timestamp : window.closesAt === undefined ? current.closesAt : Timestamp.fromDate(window.closesAt),
    };
    const registrationStatus = statusAt(next, now);
    transaction.update(eventRef, {
      registrationPublished: published,
      registrationOpensAt: next.opensAt,
      registrationClosesAt: next.closesAt,
      registrationStatus,
      revision,
      updatedAt: now,
      updatedBy: uid,
    });
    transaction.set(publicRef, publicProjection(next, registrationStatus, now));
    return {
      eventId, revision, registrationStatus, registrationPublished: published, lifecycleStatus: current.lifecycleStatus,
      registrationOpensAt: next.opensAt?.toDate().toISOString() ?? null,
      registrationClosesAt: next.closesAt?.toDate().toISOString() ?? null,
    };
  });
});

export const createEventRegistration = onCall({ ...callableOptions, secrets: registrationEmailSecrets() }, async (request) => {
  requirePublicCaller(request.auth);
  const eventId = requestId(request.data, 'eventId');
  const input = registrationInput(request.data);
  const eventRef = db.collection('events').doc(eventId);
  // New clients retain this random retry capability in memory until success.
  // Legacy clients keep the existing unique-name retry behavior.
  const retryKey = record(request.data).requestKey === undefined ? undefined : requestToken({ token: record(request.data).requestKey });
  // The random 256-bit client retry capability derives a one-way management capability.
  // Default-off cloud has no vault or queued message. Explicit staging opt-in binds only the keyring.
  const rawToken = retryKey ? createHash('sha256').update(JSON.stringify(['registration-management-v1', eventId, retryKey])).digest('base64url') : randomBytes(32).toString('base64url');
  const operationRef = retryKey === undefined ? undefined : eventRef.collection('registrationOperations').doc('create_' + tokenHash(retryKey));
  const registrationRef = eventRef.collection('registrations').doc();
  const intentId = randomUUID();
  const intentRef = eventRef.collection('emailIntents').doc(intentId);
  const activation = registrationEmailActivation();
  const eligible = registrationEmailRecipientEligible(input.contactEmail);
  const vault = !eligible ? undefined : activation ? (await import('../email/config.js')).registrationTokenVault()
    : emailEmulatorRuntime() ? emulatorTokenVault() : undefined;
  const envelope = vault?.seal(rawToken, intentRef.path);
  const fingerprint = tokenHash(JSON.stringify(input));
  const nameRef = eventRef.collection('registrationNames').doc(nameKey(input.normalizedTeamName));
  const publicRef = db.collection('publicEvents').doc(eventId);
  return db.runTransaction(async (transaction) => {
    const event = eventState(await transaction.get(eventRef));
    const previous = operationRef === undefined ? undefined : await transaction.get(operationRef);
    if (previous?.exists) {
      const receipt = record(previous.data());
      if (receipt.fingerprint !== fingerprint) throw new HttpsError('already-exists', 'requestKey was used with different content.');
      const saved = await transaction.get(eventRef.collection('registrations').doc(receipt.registrationId as string));
      assertCapability(event.data, record(saved.data()));
      let recovered = rawToken;
      if (vault || activation) {
        const savedIntentRef = eventRef.collection('emailIntents').doc(receipt.intentId as string);
        const protectedLink = await transaction.get(eventRef.collection('emailSecrets').doc(savedIntentRef.id));
        // Pre-activation receipts have no envelope. Their verified requestKey still
        // derives the original token; an existing malformed envelope must fail closed.
        if (protectedLink.exists) {
          const savedEnvelope = record(protectedLink.data()).envelope as TokenEnvelope;
          const replayVault = vault ?? (await import('../email/config.js')).registrationTokenVault();
          recovered = replayVault.open(savedEnvelope, savedIntentRef.path);
        }
      }
      verifyToken(record(saved.data()).managementTokenHash, recovered);
      return safeResponse(saved.id, record(saved.data()), recovered);
    }
    const existingName = await transaction.get(nameRef);
    const now = Timestamp.now();
    assertWindowOpen(event, now);
    assertTeamSize(event, input);
    if (existingName.exists) throw new HttpsError('already-exists', 'A team with this name is already registered.');
    if (!hasCapacity(event.capacity, 1, input.memberCount)) {
      throw new HttpsError('resource-exhausted', 'Registration capacity is full.');
    }
    await consumeRegistrationBudget(transaction, eventRef, input.contactEmail);
    const capacity = capacityAfter(event.capacity, 1, input.memberCount);
    const next = { ...event, capacity };
    const registrationStatus = statusAt(next, now);
    const registrationData = {
      schemaVersion: 1,
      eventId,
      teamName: input.teamName,
      normalizedTeamName: input.normalizedTeamName,
      memberCount: input.memberCount,
      contactEmail: input.contactEmail,
      status: 'accepted',
      managementTokenHash: tokenHash(rawToken),
      capabilityVersion: event.data.capabilityVersion ?? 0,
      createdAt: now,
      updatedAt: now,
      cancelledAt: null,
      cancelledBy: null,
    };
    transaction.create(registrationRef, registrationData);
    const emailCreated = enqueueRegistrationEmail(transaction, eventRef, registrationRef, intentId, 'registration-confirmed', event.data, registrationData, now);
    enqueueRegistrationOwnerNotification(transaction, eventRef, registrationRef, event.data, registrationData, now);
    if (emailCreated && envelope) transaction.create(eventRef.collection('emailSecrets').doc(intentId), { envelope, createdAt: now });
    if (operationRef) transaction.create(operationRef, { kind: 'create', fingerprint, registrationId: registrationRef.id, intentId, createdAt: now });
    transaction.create(nameRef, { registrationId: registrationRef.id, createdAt: now });
    transaction.update(eventRef, {
      acceptedTeams: capacity.acceptedTeams,
      acceptedPeople: capacity.acceptedPeople,
      registrationStatus,
      updatedAt: now,
    });
    transaction.set(publicRef, publicProjection(next, registrationStatus, now));
    return safeResponse(registrationRef.id, registrationData, rawToken);
  }).catch(reportRegistrationThrottle);
});

export const getEventRegistration = onCall(callableOptions, async (request) => {
  // The management token, not the browser's staff session, grants access.
  const eventId = requestId(request.data, 'eventId');
  const registrationId = requestId(request.data, 'registrationId');
  const token = requestToken(request.data);
  return db.runTransaction(async tx => {
    const event = eventState(await tx.get(db.doc('events/' + eventId)));
    const snapshot = await tx.get(db.doc('events/' + eventId + '/registrations/' + registrationId));
    if (!snapshot.exists) throw new HttpsError('not-found', 'Registration was not found.');
    const data = record(snapshot.data());
    assertCapability(event.data, data);
    verifyToken(data.managementTokenHash, token);
    return safeResponse(snapshot.id, data);
  });
});

export const updateEventRegistration = onCall({ ...callableOptions, secrets: registrationEmailSecrets() }, async (request) => {
  const eventId = requestId(request.data, 'eventId');
  const registrationId = requestId(request.data, 'registrationId');
  const token = requestToken(request.data);
  const input = registrationInput(request.data);
  const eventRef = db.collection('events').doc(eventId);
  const registrationRef = eventRef.collection('registrations').doc(registrationId);
  const publicRef = db.collection('publicEvents').doc(eventId);
  const operationId = record(request.data).requestId === undefined ? undefined : requestId(request.data, 'requestId');
  if (operationId !== undefined && operationId.length > 100) throw new HttpsError('invalid-argument', 'requestId is too long.');
  const operationRef = operationId === undefined ? undefined : eventRef.collection('registrationOperations').doc('update_' + tokenHash(`${registrationId}:${operationId}`));
  const fingerprint = tokenHash(JSON.stringify(input));
  const intentId = randomUUID();
  return db.runTransaction(async (transaction) => {
    const event = eventState(await transaction.get(eventRef));
    const registrationSnapshot = await transaction.get(registrationRef);
    if (!registrationSnapshot.exists) throw new HttpsError('not-found', 'Registration was not found.');
    const current = record(registrationSnapshot.data());
    assertCapability(event.data, current);
    verifyToken(current.managementTokenHash, token);
    const previous = operationRef === undefined ? undefined : await transaction.get(operationRef);
    if (previous?.exists) {
      if (previous.data()?.fingerprint !== fingerprint) throw new HttpsError('already-exists', 'requestId was used with different content.');
      return safeResponse(registrationId, current);
    }
    if (current.status !== 'accepted') throw new HttpsError('failed-precondition', 'Registration is cancelled.');
    const oldNormalized = typeof current.normalizedTeamName === 'string' ? current.normalizedTeamName : '';
    const oldMemberCount = integer(current.memberCount, 1, 'Registration is malformed.');
    const oldNameRef = eventRef.collection('registrationNames').doc(nameKey(oldNormalized));
    const newNameRef = eventRef.collection('registrationNames').doc(nameKey(input.normalizedTeamName));
    const newNameSnapshot = input.normalizedTeamName === oldNormalized ? undefined : await transaction.get(newNameRef);
    const now = Timestamp.now();
    assertWindowOpen(event, now, true);
    assertTeamSize(event, input);
    if (current.teamName === input.teamName && current.memberCount === input.memberCount && current.contactEmail === input.contactEmail) {
      if (operationRef) transaction.create(operationRef, { kind: 'update', registrationId, fingerprint, intentId: null, createdAt: now });
      return safeResponse(registrationId, current);
    }
    if (newNameSnapshot?.exists) throw new HttpsError('already-exists', 'A team with this name is already registered.');
    const peopleDelta = input.memberCount - oldMemberCount;
    if (!hasCapacity(event.capacity, 0, peopleDelta)) throw new HttpsError('failed-precondition', 'Event counters are malformed.');
    const capacity = capacityAfter(event.capacity, 0, peopleDelta);
    const next = { ...event, capacity };
    const registrationStatus = statusAt(next, now);
    const revision = current.revision === undefined ? 0 : current.revision;
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER) {
      throw new HttpsError('failed-precondition', 'Registration revision is malformed.');
    }
    transaction.update(registrationRef, {
      teamName: input.teamName,
      normalizedTeamName: input.normalizedTeamName,
      memberCount: input.memberCount,
      contactEmail: input.contactEmail,
      revision: revision + 1,
      updatedAt: now,
    });
    const emailCreated = enqueueRegistrationEmail(transaction, eventRef, registrationRef, intentId, 'registration-updated', event.data, { ...current, ...input }, now);
    if (emailCreated) {
      // Only a verified capability and a real eligible change reach this branch.
      // Replays/no-ops return above; the same token is sealed, never rotated or logged.
      const vault = registrationEmailActivation() ? (await import('../email/config.js')).registrationTokenVault()
        : emailEmulatorRuntime() ? emulatorTokenVault() : undefined;
      if (vault) transaction.create(eventRef.collection('emailSecrets').doc(intentId), {
        envelope: vault.seal(token, eventRef.collection('emailIntents').doc(intentId).path), createdAt: now,
      });
    }
    if (operationRef) transaction.create(operationRef, { kind: 'update', registrationId, fingerprint, intentId, createdAt: now });
    if (input.normalizedTeamName !== oldNormalized) {
      transaction.delete(oldNameRef);
      transaction.create(newNameRef, { registrationId, createdAt: now });
    }
    transaction.update(eventRef, {
      acceptedPeople: capacity.acceptedPeople,
      registrationStatus,
      updatedAt: now,
    });
    transaction.set(publicRef, publicProjection(next, registrationStatus, now));
    return safeResponse(registrationId, { ...current, ...input, status: 'accepted' });
  });
});

async function cancelRegistration(
  eventId: string,
  registrationId: string,
  actor: string,
  token?: string,
  requireOpen = true,
) {
  const eventRef = db.collection('events').doc(eventId);
  const registrationRef = eventRef.collection('registrations').doc(registrationId);
  const publicRef = db.collection('publicEvents').doc(eventId);
  const intentId = randomUUID();
  return runAccessTransaction(db, async (transaction) => {
    const event = eventState(await transaction.get(eventRef));
    const registrationSnapshot = await transaction.get(registrationRef);
    if (!registrationSnapshot.exists) throw new HttpsError('not-found', 'Registration was not found.');
    const current = record(registrationSnapshot.data());
    if (token !== undefined) { assertCapability(event.data, current); verifyToken(current.managementTokenHash, token); }
    if (current.status === 'cancelled') return safeResponse(registrationId, current);
    if (current.status !== 'accepted') throw new HttpsError('failed-precondition', 'Registration cannot be cancelled.');
    const memberCount = integer(current.memberCount, 1, 'Registration is malformed.');
    const normalized = typeof current.normalizedTeamName === 'string' ? current.normalizedTeamName : '';
    const nameRef = eventRef.collection('registrationNames').doc(nameKey(normalized));
    await transaction.get(nameRef);
    const now = Timestamp.now();
    if (requireOpen) assertWindowOpen(event, now, true);
    const capacity = capacityAfter(event.capacity, -1, -memberCount);
    if (!hasCapacity(capacity, 0, 0)) throw new HttpsError('failed-precondition', 'Event counters are malformed.');
    const next = { ...event, capacity };
    const registrationStatus = statusAt(next, now);
    transaction.update(registrationRef, { status: 'cancelled', cancelledAt: now, cancelledBy: actor, updatedAt: now });
    if (token !== undefined) enqueueRegistrationEmail(transaction, eventRef, registrationRef, intentId, 'registration-cancelled', event.data, current, now);
    transaction.delete(nameRef);
    transaction.update(eventRef, {
      acceptedTeams: capacity.acceptedTeams,
      acceptedPeople: capacity.acceptedPeople,
      registrationStatus,
      updatedAt: now,
    });
    transaction.set(publicRef, publicProjection(next, registrationStatus, now));
    return safeResponse(registrationId, { ...current, status: 'cancelled' });
  });
}

export const cancelEventRegistration = onCall(callableOptions, async (request) => {
  return cancelRegistration(
    requestId(request.data, 'eventId'),
    requestId(request.data, 'registrationId'),
    'management-link',
    requestToken(request.data),
  );
});

export const adminCancelEventRegistration = securedOnCall('adminCancelEventRegistration', callableOptions, async (request) => {
  const uid = requireAdmin(request.auth);
  return cancelRegistration(
    requestId(request.data, 'eventId'),
    requestId(request.data, 'registrationId'),
    `admin:${uid}`,
    undefined,
    false,
  );
});

function assertManualTeamAllowed(event: EventState): void {
  // Quiz content locks and the public registration window are deliberately independent.
  if (!['draft', 'scheduled', 'ready', 'live'].includes(event.lifecycleStatus)) {
    throw new HttpsError('failed-precondition', 'Event roster cannot be changed in this lifecycle.');
  }
}

export const adminAddEventTeam = securedOnCall('adminAddEventTeam', callableOptions, async (request) => {
  const uid = requireAdmin(request.auth);
  const eventId = requestId(request.data, 'eventId');
  const operationId = requestId(request.data, 'requestId');
  if (operationId.length > 100) throw new HttpsError('invalid-argument', 'requestId is too long.');
  const input = manualTeamInput(request.data);
  const eventRef = db.collection('events').doc(eventId);
  // The idempotency reservation stays on the canonical record, including after cancellation.
  const registrationRef = eventRef.collection('registrations').doc('manual_' + tokenHash(`${uid}:${operationId}`));
  const fingerprint = tokenHash(JSON.stringify(input));
  const nameRef = eventRef.collection('registrationNames').doc(nameKey(input.normalizedTeamName));
  return runAccessTransaction(db, async (transaction) => {
    const event = eventState(await transaction.get(eventRef));
    const previous = await transaction.get(registrationRef);
    if (previous.exists) {
      const data = record(previous.data());
      if (data.createdBy !== uid || data.requestFingerprint !== fingerprint || data.source !== 'manual') {
        throw new HttpsError('already-exists', 'requestId was used with different content.');
      }
      return safeResponse(previous.id, data);
    }
    assertManualTeamAllowed(event);
    assertTeamSize(event, input);
    const reserved = await transaction.get(nameRef);
    if (reserved.exists) throw new HttpsError('already-exists', 'A team with this name is already registered.');
    if (!hasCapacity(event.capacity, 1, input.memberCount)) throw new HttpsError('resource-exhausted', 'Registration capacity is full.');
    const now = Timestamp.now();
    const capacity = capacityAfter(event.capacity, 1, input.memberCount);
    const next = { ...event, capacity };
    const registrationStatus = statusAt(next, now);
    const data = { schemaVersion: 1, eventId, ...input, status: 'accepted', source: 'manual',
      managementTokenHash: null, createdBy: uid, updatedBy: uid, requestFingerprint: fingerprint,
      revision: 1, createdAt: now, updatedAt: now, cancelledAt: null, cancelledBy: null };
    transaction.create(registrationRef, data);
    transaction.create(nameRef, { registrationId: registrationRef.id, createdAt: now });
    transaction.update(eventRef, { acceptedTeams: capacity.acceptedTeams, acceptedPeople: capacity.acceptedPeople,
      registrationStatus, updatedAt: now, updatedBy: uid });
    transaction.set(db.collection('publicEvents').doc(eventId), publicProjection(next, registrationStatus, now));
    return safeResponse(registrationRef.id, data);
  });
});

export const adminUpdateEventTeam = securedOnCall('adminUpdateEventTeam', callableOptions, async (request) => {
  if (record(request.data).action === 'reissueLink') return reissueRegistrationLink(request);
  const uid = requireAdmin(request.auth);
  const eventId = requestId(request.data, 'eventId');
  const registrationId = requestId(request.data, 'registrationId');
  const expectedRevision = record(request.data).expectedRevision;
  if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 1) throw new HttpsError('invalid-argument', 'expectedRevision is invalid.');
  const input = manualTeamInput(request.data);
  const eventRef = db.collection('events').doc(eventId);
  const registrationRef = eventRef.collection('registrations').doc(registrationId);
  return runAccessTransaction(db, async (transaction) => {
    const event = eventState(await transaction.get(eventRef));
    const snapshot = await transaction.get(registrationRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Registration was not found.');
    const current = record(snapshot.data());
    assertManualTeamAllowed(event);
    if (current.source !== 'manual' || current.status !== 'accepted') throw new HttpsError('failed-precondition', 'Only accepted manual teams can be edited here.');
    if (current.revision !== expectedRevision) throw new HttpsError('aborted', 'Team changed. Reload and try again.');
    assertTeamSize(event, input);
    const oldName = typeof current.normalizedTeamName === 'string' ? current.normalizedTeamName : '';
    const newNameRef = eventRef.collection('registrationNames').doc(nameKey(input.normalizedTeamName));
    const reserved = await transaction.get(newNameRef);
    if (reserved.exists && reserved.data()?.registrationId !== registrationId) throw new HttpsError('already-exists', 'A team with this name is already registered.');
    const delta = input.memberCount - integer(current.memberCount, 1, 'Registration is malformed.');
    if (!hasCapacity(event.capacity, 0, delta)) throw new HttpsError('failed-precondition', 'Event counters are malformed.');
    const capacity = capacityAfter(event.capacity, 0, delta);
    const now = Timestamp.now();
    const next = { ...event, capacity };
    const registrationStatus = statusAt(next, now);
    transaction.update(registrationRef, { ...input, revision: (expectedRevision as number) + 1, updatedAt: now, updatedBy: uid });
    if (oldName !== input.normalizedTeamName) {
      transaction.delete(eventRef.collection('registrationNames').doc(nameKey(oldName)));
      transaction.create(newNameRef, { registrationId, createdAt: now });
    }
    transaction.update(eventRef, { acceptedPeople: capacity.acceptedPeople, registrationStatus, updatedAt: now, updatedBy: uid });
    transaction.set(db.collection('publicEvents').doc(eventId), publicProjection(next, registrationStatus, now));
    return safeResponse(registrationId, { ...current, ...input });
  });
});

async function reissueRegistrationLink(request: CallableRequest) {
  const uid = requireAdmin(request.auth), eventId = requestId(request.data, 'eventId'), registrationId = requestId(request.data, 'registrationId');
  const operationId = requestId(request.data, 'requestId'), expected = record(request.data).expectedRevision;
  if (!Number.isSafeInteger(expected) || Number(expected) < 0) throw new HttpsError('invalid-argument', 'Neplatná revize týmu.');
  const ref = db.doc('events/' + eventId + '/registrations/' + registrationId);
  const receipt = db.doc('events/' + eventId + '/registrationOperations/link_' + tokenHash(uid + ':' + registrationId + ':' + operationId));
  const secret = randomBytes(32).toString('base64url');
  return runAccessTransaction(db, async tx => {
    const event = eventState(await tx.get(db.doc('events/' + eventId)));
    const current = (await tx.get(ref)).data(), old = await tx.get(receipt);
    if (!current || current.status !== 'accepted' || current.source === 'manual') throw new HttpsError('failed-precondition', 'Odkaz lze vydat přijatému online týmu.');
    if (old.exists) return { managementToken: null, registrationId };
    if ((current.revision ?? 0) !== expected) throw new HttpsError('aborted', 'Tým se mezitím změnil.');
    tx.update(ref, { managementTokenHash: tokenHash(secret), capabilityVersion: event.data.capabilityVersion ?? 0, revision: Number(expected) + 1, updatedAt: Timestamp.now(), updatedBy: uid });
    tx.create(receipt, { kind: 'reissueLink', at: Timestamp.now(), registrationId });
    return { managementToken: secret, registrationId };
  });
}
