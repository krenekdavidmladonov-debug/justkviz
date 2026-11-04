import { createHash } from 'node:crypto';
import { accessActor, securedOnCall, runAccessTransaction, currentMembership } from '../access/authorization.js';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { quizAssetReference, validOwnedMedia } from '@filmovy-kviz/quiz-domain';
import { assetPath, mediaId, mediaInput, mediaSignature } from './model.js';
import { mediaBucket } from './storage.js';
const options = { region: 'europe-west1', cors: true, maxInstances: 5 };
function admin(request: CallableRequest) {
  return Promise.resolve(accessActor(request.auth).uid);
}
export const beginQuizMediaUpload = securedOnCall('beginQuizMediaUpload', options, async request => {
  const uid = await admin(request), data = mediaInput(request.data, ['quizId','requestId','kind','contentType','size']);
  const quizId = mediaId(data.quizId), requestId = mediaId(data.requestId);
  if (data.kind === 'video' || !validOwnedMedia(data.kind, data.contentType, data.size)) throw new HttpsError('invalid-argument', 'Podporujeme PNG/JPEG/WebP do 10 MiB a MP3/WAV do 25 MiB.');
  const assetId = createHash('sha256').update(JSON.stringify([quizId, uid, requestId])).digest('hex');
  const ref = getFirestore().doc('quizzes/' + quizId + '/mediaAssets/' + assetId);
  const fingerprint = createHash('sha256').update(JSON.stringify([data.kind,data.contentType,data.size])).digest('hex');
  return runAccessTransaction(getFirestore(), async transaction => {
    const quiz = await transaction.get(ref.parent.parent!), existing = (await transaction.get(ref)).data();
    if (!quiz.exists) throw new HttpsError('not-found', 'Kvíz neexistuje.');
    if (existing && existing.fingerprint !== fingerprint) throw new HttpsError('already-exists', 'Požadavek již patří jinému souboru.');
    if (!existing) transaction.create(ref, { quizId, assetId, kind: data.kind, contentType: data.contentType, size: data.size,
      status: 'uploading', membershipVersion: currentMembership().version, createdBy: uid, createdAt: Timestamp.now(), uploadExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60_000), fingerprint });
    return { assetId, path: assetPath(quizId, assetId), reference: quizAssetReference(quizId, assetId) };
  });
});
export const finalizeQuizMediaUpload = securedOnCall('finalizeQuizMediaUpload', options, async request => {
  const uid = await admin(request), input = mediaInput(request.data, ['quizId','assetId']);
  const quizId = mediaId(input.quizId), assetId = mediaId(input.assetId), ref = getFirestore().doc('quizzes/' + quizId + '/mediaAssets/' + assetId);
  const data = (await ref.get()).data();
  if (!data || data.createdBy !== uid || data.quizId !== quizId) throw new HttpsError('not-found', 'Médium neexistuje.');
  if (data.status === 'ready') return { reference: quizAssetReference(quizId, assetId) };
  if (data.membershipVersion !== currentMembership().version) throw new HttpsError('permission-denied', 'Oprávnění k nahrávání se změnilo. Vytvořte nový požadavek.');
  if (data.status !== 'uploading') throw new HttpsError('failed-precondition', 'Upload není dostupný.');
  const file = mediaBucket().file(assetPath(quizId, assetId));
  const [metadata] = await file.getMetadata().catch(() => { throw new HttpsError('failed-precondition', 'Soubor ještě není nahraný.'); });
  if (metadata.contentType !== data.contentType || Number(metadata.size) !== data.size || !validOwnedMedia(data.kind, metadata.contentType, Number(metadata.size))) throw new HttpsError('failed-precondition', 'Typ nebo velikost souboru nesouhlasí.');
  const [bytes] = await file.download({ start: 0, end: 4095 });
  if (!mediaSignature(bytes, metadata.contentType!)) throw new HttpsError('failed-precondition', 'Obsah souboru neodpovídá deklarovanému typu.');
  // Never publish Firebase download tokens. Reads go through current publication authorization.
  await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
  await runAccessTransaction(getFirestore(), async transaction => {
    await admin(request);
    const current = (await transaction.get(ref)).data();
    if (current?.membershipVersion !== currentMembership().version) throw new HttpsError('permission-denied', 'Oprávnění k nahrávání se změnilo.');
    if (!current || current.fingerprint !== data.fingerprint || !['uploading','ready'].includes(current.status as string)) throw new HttpsError('aborted', 'Stav média se změnil.');
    transaction.update(ref, { status: 'ready', generation: metadata.generation, readyAt: Timestamp.now() });
  });
  return { reference: quizAssetReference(quizId, assetId) };
});
