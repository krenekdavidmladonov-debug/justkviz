import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { parseQuizAsset, validOwnedMedia } from '@filmovy-kviz/quiz-domain';
import { assetPath, mediaByteRange, mediaId, publicMediaAllowed } from './model.js';
import { mediaBucket } from './storage.js';
import { freshIdentity, type AuthIdentity } from '../access/authorization.js';
import { authorizePrivateMedia, authorizeEventShowMedia } from '../access/media.js';
import { driveRuntimeSecrets } from '../drive/runtime.js';
import { readDriveAsset, verifyDriveAsset } from '../drive/media-read.js';

export const readQuizMedia = onRequest({ region: 'europe-west1', cors: true, maxInstances: 10, timeoutSeconds: 60,
  memory: '512MiB', cpu: 1, concurrency: 2,
  ...(driveRuntimeSecrets.length ? { secrets: driveRuntimeSecrets } : {}) }, async (request, response) => {
  const started = performance.now();
  response.set('Cache-Control', 'no-store').set('X-Content-Type-Options', 'nosniff').set('Access-Control-Expose-Headers', 'ETag, Server-Timing');
  if (request.method !== 'GET') { response.status(405).end(); return; }
  const reference = request.query.reference, parsed = parseQuizAsset(reference);
  if (!parsed || typeof reference !== 'string' || Object.keys(request.query).some(key => !['reference','sessionId','snapshotId','eventId'].includes(key)) || ['sessionId','snapshotId','eventId'].filter(key => request.query[key] !== undefined).length > 1) { response.status(400).end(); return; }
  try {
    const snapshotId = request.query.snapshotId === undefined ? undefined : mediaId(request.query.snapshotId);
    const eventId = request.query.eventId === undefined ? undefined : mediaId(request.query.eventId);
    let showGeneration: string | undefined;
    let auth: AuthIdentity;
    const db = getFirestore();
    const publicRef = request.query.sessionId === undefined ? null : db.doc('publicSessions/' + mediaId(request.query.sessionId));
    const publication = publicRef ? await publicRef.get() : null;
    if (publicRef) {
      if (!publicMediaAllowed(publication?.data(), reference)) { response.status(404).end(); return; }
    } else {
      const bearer = request.get('authorization');
      if (!bearer?.startsWith('Bearer ')) { response.status(403).end(); return; }
      const claims = await getAuth().verifyIdToken(bearer.slice(7), true);
      auth = { uid: claims.uid, token: claims };
      await freshIdentity(auth);
      if (eventId) showGeneration = await authorizeEventShowMedia(auth, eventId, reference);
      else await authorizePrivateMedia(auth, reference, snapshotId);
    }
    const asset = (await db.doc('quizzes/' + parsed.quizId + '/mediaAssets/' + parsed.assetId).get()).data();
    if (!asset || asset.quizId !== parsed.quizId || asset.status !== 'ready' || !validOwnedMedia(asset.kind, asset.contentType, asset.size) || typeof asset.generation !== 'string') { response.status(404).end(); return; }
    if (eventId && (asset.kind !== 'audio' || asset.generation !== showGeneration)) { response.status(404).end(); return; }
    if (publicRef && !publicMediaAllowed(publication?.data(), reference, asset.kind)) { response.status(404).end(); return; }
    const size = asset.size as number;
    let range;
    try { range = mediaByteRange(request.get('range'), size); }
    catch { response.status(416).set('Content-Range', 'bytes */' + size).end(); return; }
    const etag = '"' + createHash('sha256').update(JSON.stringify([reference, asset.generation, asset.contentType, size])).digest('hex') + '"';
    const unchanged = !range && request.get('if-none-match') === etag;
    const isDrive = asset.drive !== undefined || asset.generation.startsWith('drive:');
    const authorizedAt = performance.now();
    let bytes: Buffer = Buffer.alloc(0);
    if (unchanged && isDrive) {
      await verifyDriveAsset(asset, parsed.quizId);
    } else if (unchanged) {
      await mediaBucket().file(assetPath(parsed.quizId, parsed.assetId), { generation: asset.generation }).getMetadata();
    } else if (!unchanged && isDrive) {
      const full = await readDriveAsset(asset, parsed.quizId);
      bytes = range ? full.subarray(range.start, range.end + 1) : full;
    } else if (!unchanged) {
      const file = mediaBucket().file(assetPath(parsed.quizId, parsed.assetId), { generation: asset.generation });
      [bytes] = await file.download(range ?? {});
    }
    const mediaFinishedAt = performance.now();
    // Recheck current authority after IO; an unrelated reveal must not break an allowed image.
    if (publicRef && !publicMediaAllowed((await publicRef.get()).data(), reference, asset.kind)) { response.status(404).end(); return; }
    if (!publicRef) {
      await freshIdentity(auth);
      if (eventId) {
        if (await authorizeEventShowMedia(auth, eventId, reference) !== asset.generation) { response.status(404).end(); return; }
      } else await authorizePrivateMedia(auth, reference, snapshotId);
    }
    const finishedAt = performance.now();
    response.set('Server-Timing', 'authorization;dur=' + (authorizedAt - started).toFixed(1)
      + ', media;dur=' + (mediaFinishedAt - authorizedAt).toFixed(1)
      + ', reauthorization;dur=' + (finishedAt - mediaFinishedAt).toFixed(1)
      + ', total;dur=' + (finishedAt - started).toFixed(1)).set('ETag', etag);
    if (unchanged) { response.status(304).end(); return; }
    response.set('Content-Type', asset.contentType as string).set('Accept-Ranges', 'bytes').set('Content-Length', String(bytes.length));
    if (range) response.status(206).set('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + size);
    response.send(bytes);
  } catch { response.status(404).end(); }
});
