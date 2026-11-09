import { getFirestore } from 'firebase-admin/firestore';
import { parseQuizAsset } from '@filmovy-kviz/quiz-domain';
import { authorize, type AuthIdentity } from '../access/authorization.js';
import { assertEventOperational } from '../events/guards.js';
import { exportAssets, exportMediaPins, pinnedMedia } from '../offline/prepare.js';
import { offlinePermissions, offlineRecord, offlineUnavailable, storedDigest } from '../offline/source.js';

export interface OfflineMediaRead {
  eventId: string;
  exportId: string;
  environment: string;
  etag: string;
}

/** The immutable export records which bytes were authorized. Recheck the event and pin before and after Storage I/O. */
export async function authorizeOfflineMedia(auth: AuthIdentity, reference: string, request: OfflineMediaRead) {
  const parsed = parseQuizAsset(reference);
  if (!parsed) throw offlineUnavailable();
  const db = getFirestore();
  return db.runTransaction(async tx => {
    const member = await authorize(auth, offlinePermissions, { kind: 'event', id: request.eventId }, tx);
    const eventRef = db.doc('events/' + request.eventId);
    const [eventDoc, exportDoc, assetDoc] = await tx.getAll(eventRef, eventRef.collection('offlineExports').doc(request.exportId),
      db.doc(`quizzes/${parsed.quizId}/mediaAssets/${parsed.assetId}`));
    const event = eventDoc?.data(), record = exportDoc?.data(), asset = assetDoc?.data();
    assertEventOperational(event);
    const assignment = offlineRecord(event.quizAssignment), seed = offlineRecord(record?.manifestSeed);
    const expectedEvent = offlineRecord(seed.event), expectedSnapshot = offlineRecord(seed.snapshot);
    if (!record || !asset || record.schemaVersion !== 1 || record.status !== 'prepared' || record.exportId !== request.exportId
      || record.actorId !== member.uid || record.membershipVersion !== member.version || seed.environment !== request.environment
      || expectedEvent.id !== request.eventId || expectedEvent.revision !== event.revision
      || typeof record.snapshotId !== 'string' || record.snapshotId !== assignment.snapshotId || record.snapshotId !== expectedSnapshot.id
      || assignment.quizId !== parsed.quizId || expectedSnapshot.quizId !== parsed.quizId || assignment.quizRevision !== expectedSnapshot.quizRevision
      || !Number.isSafeInteger(record.expiresAtMs) || Number(record.expiresAtMs) <= Date.now()) throw offlineUnavailable();
    const expectedAsset = exportAssets(record).find(item => item.reference === reference);
    const expectedPin = exportMediaPins(record).find(item => item.reference === reference);
    if (!expectedAsset || expectedAsset.etag !== request.etag || !expectedPin
      || storedDigest(pinnedMedia(asset)) !== storedDigest(expectedPin.pin)) throw offlineUnavailable();
    const snapshot = (await tx.get(db.doc('quizSnapshots/' + record.snapshotId))).data();
    if (snapshot?.status !== 'ready' || snapshot.eventId !== request.eventId || snapshot.quizId !== parsed.quizId
      || snapshot.quizRevision !== expectedSnapshot.quizRevision) throw offlineUnavailable();
    return asset;
  });
}
