import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { cloudEmailOrigin, cloudGmailTransport, gmailWorkerSecrets, registrationTokenVault } from './config.js';
import { allowedRegistrationEmailIntent, allowedRegistrationOwnerNotificationIntent, registrationEmailActivation, registrationOwnerNotificationActivation } from './runtime.js';
import { enqueueEmailTask, processEmailTask } from './task.js';

if (getApps().length === 0) initializeApp();
const region = 'europe-west1';

export const dispatchRegistrationEmail = onDocumentCreated({
  document: 'events/{eventId}/emailIntents/{intentId}', region, retry: true,
}, async event => {
  // Local contract/browser tests drive processEmailTask with injected fake Gmail.
  // Never allow an emulator to call cloud Tasks or obtain Gmail credentials.
  const activation = registrationEmailActivation();
  if (!activation) return;
  if (!event.data?.exists) return;
  const ownerActivation = registrationOwnerNotificationActivation();
  if (!allowedRegistrationEmailIntent(event.data.data(), activation)
    && !(ownerActivation && allowedRegistrationOwnerNotificationIntent(event.data.data(), ownerActivation))) return;
  await enqueueEmailTask(getFunctions().taskQueue('locations/' + region + '/functions/deliverEmailTask'),
    { eventId: event.params.eventId, intentId: event.params.intentId });
});

export const deliverEmailTask = onTaskDispatched({
  region, timeoutSeconds: 60, invoker: 'private', secrets: gmailWorkerSecrets,
  retryConfig: { maxAttempts: 20, minBackoffSeconds: 120, maxBackoffSeconds: 600, maxDoublings: 3, maxRetrySeconds: 86400 },
  rateLimits: { maxConcurrentDispatches: 2, maxDispatchesPerSecond: 1 },
}, async request => {
  const activation = registrationEmailActivation();
  if (!activation) throw new Error('Registration email delivery is disabled.');
  const ownerActivation = registrationOwnerNotificationActivation();
  await processEmailTask(request.data, { db: getFirestore(), transport: cloudGmailTransport, vault: registrationTokenVault, origin: cloudEmailOrigin,
    allowIntent: intent => allowedRegistrationEmailIntent(intent, activation)
      || !!ownerActivation && allowedRegistrationOwnerNotificationIntent(intent, ownerActivation) });
});
