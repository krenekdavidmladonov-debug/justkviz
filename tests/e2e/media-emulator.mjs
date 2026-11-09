import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { ref, uploadBytes, getBytes, listAll, deleteObject, updateMetadata } from 'firebase/storage';
import { mediaFixture, syntheticAudio, syntheticImage, mediaSlide } from './media-fixture.mjs';
import { createMediaUploadFixtures, mediaUploadSha256 } from './media-upload-fixtures.mjs';
import { storageReadBudgetContract } from './storage-read-budget.mjs';
import { localEmulatorEndpoint } from '../../tools/local-emulator-environment.mjs';
let f,phase='fixture';
const denied=(promise,code)=>assert.rejects(promise,error=>error.code===code);
try {
  f=await mediaFixture();const image=syntheticImage(),audio=syntheticAudio();const moderator=await f.roleClient('moderator');
  phase='scope-bound server grants and two-read budget';
  const uid=f.admin.auth.currentUser.uid,memberRef=f.db.doc('memberships/'+uid),originalMember=(await memberRef.get()).data();
  const setScope=async(mode,ids=[])=>{const current=(await memberRef.get()).data();await memberRef.update({quizzes:{mode,ids},version:current.version+1});};
  await setScope('own');const own=await f.begin('image',image,'image/png');
  const ownMember=(await memberRef.get()).data(),ownGrant=(await f.db.doc('quizzes/'+f.quizId+'/mediaAssets/'+own.assetId).get()).data();
  assert.equal(ownGrant.membershipVersion,ownMember.version);assert.equal((await f.quizRef.get()).data().createdBy,uid);
  await storageReadBudgetContract({uid,quizId:f.quizId,assetId:own.assetId,member:ownMember,grant:ownGrant,owner:uid});
  await uploadBytes(ref(f.admin.storage,own.path),image,{contentType:'image/png'});
  const outsider=await f.roleClient('admin'),outsiderUid=outsider.auth.currentUser.uid,outsiderRef=f.db.doc('memberships/'+outsiderUid);
  const outsiderMember=(await outsiderRef.get()).data();await outsiderRef.update({quizzes:{mode:'own',ids:[]},version:outsiderMember.version+1});
  await denied(f.begin('image',image,'image/png',outsider),'functions/permission-denied');
  const stale=await f.begin('image',image,'image/png');await setScope('none');
  await denied(uploadBytes(ref(f.admin.storage,stale.path),image,{contentType:'image/png'}),'storage/unauthorized');
  await denied(f.admin.call('finalizeQuizMediaUpload',{quizId:f.quizId,assetId:stale.assetId}),'functions/permission-denied');
  await denied(f.begin('image',image,'image/png'),'functions/permission-denied');
  await setScope('selected',[f.quizId]);const selected=await f.begin('image',image,'image/png');
  await uploadBytes(ref(f.admin.storage,selected.path),image,{contentType:'image/png'});
  const selectedStale=await f.begin('image',image,'image/png');await setScope('selected',[]);
  await denied(uploadBytes(ref(f.admin.storage,selectedStale.path),image,{contentType:'image/png'}),'storage/unauthorized');
  await denied(f.begin('image',image,'image/png'),'functions/permission-denied');
  await setScope('all');const all=await f.begin('image',image,'image/png');await uploadBytes(ref(f.admin.storage,all.path),image,{contentType:'image/png'});
  const guard=await f.begin('image',image,'image/png'),grantRef=f.db.doc('quizzes/'+f.quizId+'/mediaAssets/'+guard.assetId),grant=(await grantRef.get()).data(),activeMember=(await memberRef.get()).data();
  await denied(uploadBytes(ref(outsider.storage,guard.path),image,{contentType:'image/png'}),'storage/unauthorized');
  for(const patch of [{uid:outsiderUid},{status:'revoked'},{permissions:activeMember.permissions.filter(value=>value!=='quiz.media.upload')},{sessionValidAfter:Math.floor(Date.now()/1000)+60},{version:activeMember.version+1}]) {
    await memberRef.update(patch);await denied(uploadBytes(ref(f.admin.storage,guard.path),image,{contentType:'image/png'}),'storage/unauthorized');await memberRef.set(activeMember);
  }
  for(const patch of [{createdBy:outsiderUid},{quizId:'foreign-quiz'},{assetId:'foreign-asset'},{status:'ready'},{uploadExpiresAt:grant.createdAt}]) {
    await grantRef.update(patch);await denied(uploadBytes(ref(f.admin.storage,guard.path),image,{contentType:'image/png'}),'storage/unauthorized');await grantRef.set(grant);
  }
  await uploadBytes(ref(f.admin.storage,guard.path),image,{contentType:'image/png'});
  // All fixture mutations above are demo/local guarded by mediaFixture. Restore
  // the original all-scope grant policy with a higher version, never a rollback.
  await memberRef.update({quizzes:originalMember.quizzes,version:activeMember.version+1});
  console.log('PASS: real own/all/selected grants; foreign scope mint denied; scope/version/UID/status/permission/session/expiry revocation and two-document Rules budget');
  phase='upload rules';
  await denied(f.begin('image',image,'image/png',f.anonymous),'functions/unauthenticated');await denied(f.begin('image',image,'image/png',moderator),'functions/permission-denied');
  const pending=await f.begin('image',image,'image/png');
  for(const who of [f.anonymous,moderator])await denied(uploadBytes(ref(who.storage,pending.path),image,{contentType:'image/png'}),'storage/unauthorized');
  await denied(uploadBytes(ref(f.admin.storage,pending.path),image,{contentType:'text/html'}),'storage/unauthorized');
  await denied(uploadBytes(ref(f.admin.storage,pending.path),image.subarray(0,10),{contentType:'image/png'}),'storage/unauthorized');
  await denied(uploadBytes(ref(f.admin.storage,pending.path.replace(f.quizId,'other-quiz')),image,{contentType:'image/png'}),'storage/unauthorized');
  await uploadBytes(ref(f.admin.storage,pending.path),image,{contentType:'image/png'});
  await denied(f.update('image',{questionImage:pending.reference}),'functions/failed-precondition');
  await f.admin.call('finalizeQuizMediaUpload',{quizId:f.quizId,assetId:pending.assetId});
  for(const who of [f.anonymous,f.admin,moderator]) {await denied(getBytes(ref(who.storage,pending.path)),'storage/unauthorized');await denied(listAll(ref(who.storage,'quiz-assets')),'storage/unauthorized');}
  await denied(uploadBytes(ref(f.admin.storage,pending.path),image,{contentType:'image/png'}),'storage/unauthorized');await denied(deleteObject(ref(f.admin.storage,pending.path)),'storage/unauthorized');await denied(updateMetadata(ref(f.admin.storage,pending.path),{contentType:'text/html'}),'storage/unauthorized');
  console.log('PASS: Storage create authorization, exact MIME/size/quiz target, ready boundary, no direct read/list/overwrite/delete');
  phase='content validation';
  await denied(f.admin.call('beginQuizMediaUpload',{quizId:f.quizId,requestId:'oversize',kind:'image',contentType:'image/png',size:10485761}),'functions/invalid-argument');
  const fake=Buffer.from('<html>not an image</html>');const bad=await f.begin('image',fake,'image/png');await uploadBytes(ref(f.admin.storage,bad.path),fake,{contentType:'image/png'});await denied(f.admin.call('finalizeQuizMediaUpload',{quizId:f.quizId,assetId:bad.assetId}),'functions/failed-precondition');
  const sound=await f.upload('audio',audio,'audio/wav');await f.update('image',{questionImage:pending.reference});await f.update('audio',{mediaSource:sound.reference});
  await denied(f.update('audio',{questionImage:sound.reference,mediaSource:sound.reference}),'functions/invalid-argument');
  await denied(f.update('image',{questionImage:sound.reference}),'functions/failed-precondition');
  const q=(await f.quizRef.get()).data();await denied(f.admin.call('updateQuizSlide',{quizId:f.quizId,slideId:f.ids.image,expectedRevision:q.revision,slide:mediaSlide('image',{questionImage:pending.reference.replace(f.quizId,'other-quiz')})}),'functions/invalid-argument');
  console.log('PASS: actual content signature, oversized declaration, audio upload, cross-quiz/type/conflicting slot denial');

  phase = 'owned MP4 upload and privacy boundary';
  const { video } = await createMediaUploadFixtures(['video']);
  const videoType = { contentType: 'video/mp4' };
  const videoUpload = (who, target, bytes = video.bytes, metadata = videoType) => uploadBytes(ref(who.storage, target.path), bytes, metadata);
  for (const [who, code] of [[f.anonymous, 'functions/unauthenticated'], [moderator, 'functions/permission-denied'], [outsider, 'functions/permission-denied']]) {
    await denied(f.begin('video', video.bytes, 'video/mp4', who), code);
  }
  await denied(f.begin('video', video.bytes, 'video/webm'), 'functions/invalid-argument');
  await denied(f.begin('audio', video.bytes, 'video/mp4'), 'functions/invalid-argument');
  await denied(f.admin.call('beginQuizMediaUpload', { quizId: f.quizId, requestId: randomUUID(), kind: 'video',
    contentType: 'video/mp4', size: 25 * 1024 * 1024 + 1 }), 'functions/invalid-argument');
  const staleVideoCreate = await f.begin('video', video.bytes, 'video/mp4');
  const staleVideoFinalize = await f.begin('video', video.bytes, 'video/mp4');
  await videoUpload(f.admin, staleVideoFinalize);
  assert.equal((await f.quizRef.collection('mediaAssets').doc(staleVideoFinalize.assetId).get()).get('status'), 'uploading');
  // Keep the overwrite probe separate so an unexpected overwrite cannot rotate
  // the other upload's bearer and mask its post-finalize exposure.
  const overwriteResult = await videoUpload(f.admin, staleVideoFinalize).then(() => 'accepted', error => String(error?.code ?? 'unexpected-error'));
  await setScope('all'); // Membership version changes even though this actor still owns access to the quiz.
  await denied(videoUpload(f.admin, staleVideoCreate), 'storage/unauthorized');
  await denied(f.admin.call('finalizeQuizMediaUpload', { quizId: f.quizId, assetId: staleVideoFinalize.assetId }), 'functions/permission-denied');
  const videoGrant = await f.begin('video', video.bytes, 'video/mp4');
  const canonicalVideoPath = `quiz-assets/${f.quizId}/${videoGrant.assetId}/source`;
  assert.deepEqual(Object.keys(videoGrant).sort(), ['assetId', 'path', 'reference']);
  assert.equal(videoGrant.path, `quiz-assets/${f.quizId}/${videoGrant.assetId}/upload`);
  for (const who of [f.anonymous, moderator, outsider]) await denied(videoUpload(who, videoGrant), 'storage/unauthorized');
  await denied(videoUpload(f.admin, { path: `quiz-assets/${f.quizId}/ungranted-video/source` }), 'storage/unauthorized');
  await denied(videoUpload(f.admin, { path: videoGrant.path.replace(f.quizId, 'foreign-quiz') }), 'storage/unauthorized');
  await denied(videoUpload(f.admin, { path: canonicalVideoPath }), 'storage/unauthorized');
  await denied(videoUpload(f.admin, videoGrant, video.bytes, { contentType: 'video/webm' }), 'storage/unauthorized');
  await denied(videoUpload(f.admin, videoGrant, video.bytes.subarray(0, -1)), 'storage/unauthorized');
  await videoUpload(f.admin, videoGrant);
  const videoRef = ref(f.admin.storage, videoGrant.path), videoDoc = f.quizRef.collection('mediaAssets').doc(videoGrant.assetId);
  assert.equal((await videoDoc.get()).get('status'), 'uploading');
  await denied(updateMetadata(videoRef, { contentType: 'video/webm' }), 'storage/unauthorized');
  await denied(getBytes(videoRef), 'storage/unauthorized');
  const [uploadMetadata] = await f.bucket.file(videoGrant.path).getMetadata();
  const originalBearer = uploadMetadata.metadata?.firebaseStorageDownloadTokens?.split(',')[0];
  assert(Boolean(originalBearer), 'Expected a real synthetic upload-issued bearer for the bypass probe.');
  const endpoint = localEmulatorEndpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'MP4 bearer probe');
  async function anonymousBearerRead(objectPath) {
    const url = new URL(`http://${endpoint.host}:${endpoint.port}/v0/b/${f.bucket.name}/o/${encodeURIComponent(objectPath)}`);
    url.searchParams.set('alt', 'media'); url.searchParams.set('token', originalBearer);
    const response = await fetch(url, { redirect: 'error' });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, returnedUploadedBytes: mediaUploadSha256(bytes) === video.sha256 };
  }
  const bearerBefore = { upload: await anonymousBearerRead(videoGrant.path), canonical: await anonymousBearerRead(canonicalVideoPath) };
  assert.deepEqual(bearerBefore.upload, { status: 200, returnedUploadedBytes: true }, 'The real original bearer must exercise the anonymous bypass before finalization.');
  assert([401, 403, 404].includes(bearerBefore.canonical.status) && !bearerBefore.canonical.returnedUploadedBytes);
  const canonicalVideo = f.bucket.file(canonicalVideoPath);
  async function finalizeAndReadReadyPin() {
    const result = await f.admin.call('finalizeQuizMediaUpload', { quizId: f.quizId, assetId: videoGrant.assetId });
    assert.deepEqual(result, { reference: videoGrant.reference });
    const record = (await videoDoc.get()).data(), [metadata] = await canonicalVideo.getMetadata();
    assert.equal(record.status, 'ready'); assert.equal(record.generation, metadata.generation);
    assert.equal((await f.bucket.file(videoGrant.path).exists())[0], false);
    assert.equal(Boolean(metadata.metadata?.firebaseStorageDownloadTokens), false);
    assert.equal(metadata.cacheControl, 'private, no-store');
    const pinned = f.bucket.file(canonicalVideoPath, { generation: metadata.generation });
    const [bytes] = await pinned.download();
    const sha256 = mediaUploadSha256(bytes);
    assert.equal(bytes.length, video.bytes.length); assert.equal(sha256, video.sha256);
    return { generation: metadata.generation, metageneration: metadata.metageneration, sha256 };
  }
  const concurrent = await Promise.allSettled([finalizeAndReadReadyPin(), finalizeAndReadReadyPin()]);
  const completed = concurrent.filter(outcome => outcome.status === 'fulfilled');
  assert(completed.length >= 1, 'Concurrent finalization must produce a ready canonical object.');
  for (const outcome of concurrent) if (outcome.status === 'rejected') assert.equal(outcome.reason.code, 'functions/aborted');
  const readyPin = completed[0].value;
  for (const outcome of completed) assert.deepEqual(outcome.value, readyPin);
  const replayed = await Promise.all([finalizeAndReadReadyPin(), finalizeAndReadReadyPin()]);
  for (const pin of replayed) assert.deepEqual(pin, readyPin, 'A repeated READY finalize must preserve the canonical generation and bytes.');
  console.log('MP4_CONCURRENT_FINALIZE ' + JSON.stringify({ requests: concurrent.length, confirmed: completed.length,
    aborted: concurrent.length - completed.length, idempotentReplays: replayed.length, stableReadyGeneration: true,
    stagingAbsent: true, canonicalSha256: readyPin.sha256 }));
  const bearerAfter = { upload: await anonymousBearerRead(videoGrant.path), canonical: await anonymousBearerRead(canonicalVideoPath) };
  console.log('MP4_BEARER_PROBE ' + JSON.stringify({ before: bearerBefore, after: bearerAfter, overwriteWhileUploading: overwriteResult, sameObjectPath: videoGrant.path === canonicalVideoPath }));
  const bearerDenied = Object.values(bearerAfter).every(observation => [401, 403, 404].includes(observation.status) && !observation.returnedUploadedBytes);
  assert.deepEqual({ overwriteResult, bearerDenied }, { overwriteResult: 'storage/unauthorized', bearerDenied: true },
    'Pending MP4 bytes must resist a second upload, and the original bearer must not expose READY MP4 bytes.');
  for (const who of [f.admin, f.anonymous, moderator, outsider]) {
    await denied(getBytes(ref(who.storage, videoGrant.path)), 'storage/unauthorized');
    await denied(getBytes(ref(who.storage, canonicalVideoPath)), 'storage/unauthorized');
    await denied(listAll(ref(who.storage, `quiz-assets/${f.quizId}`)), 'storage/unauthorized');
  }
  await denied(videoUpload(f.admin, videoGrant), 'storage/unauthorized');
  const videoRecord = (await videoDoc.get()).data();
  const [videoMetadata] = await f.bucket.file(canonicalVideoPath).getMetadata();
  assert.equal(videoRecord.status, 'ready'); assert.equal(videoRecord.generation, videoMetadata.generation);
  assert.equal(videoRecord.size, video.bytes.length); assert.equal(videoMetadata.contentType, 'video/mp4');
  assert.equal((await f.read(videoGrant.reference, { who: f.anonymous })).status, 403);
  const videoRead = await f.read(videoGrant.reference);
  assert.equal(videoRead.status, 200); assert.equal(videoRead.headers.get('content-type'), 'video/mp4');
  assert.equal(videoRead.headers.get('location'), null); assert.equal(videoRead.headers.get('cache-control'), 'no-store');
  assert.equal(videoRead.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(mediaUploadSha256(Buffer.from(await videoRead.arrayBuffer())), video.sha256);
  const malformedMp4 = Buffer.from(video.bytes.subarray(0, 24));
  malformedMp4.writeUInt32BE(128, 0); // Real MP4 prefix, but its declared ftyp box is truncated.
  const malformedGrant = await f.begin('video', malformedMp4, 'video/mp4');
  await videoUpload(f.admin, malformedGrant, malformedMp4);
  await denied(f.admin.call('finalizeQuizMediaUpload', { quizId: f.quizId, assetId: malformedGrant.assetId }), 'functions/failed-precondition');
  assert.equal((await f.quizRef.collection('mediaAssets').doc(malformedGrant.assetId).get()).get('status'), 'uploading');
  const encodedGrant = await f.begin('video', video.bytes, 'video/mp4');
  await videoUpload(f.admin, encodedGrant, video.bytes, { ...videoType, contentEncoding: 'gzip' });
  await denied(f.admin.call('finalizeQuizMediaUpload', { quizId: f.quizId, assetId: encodedGrant.assetId }), 'functions/failed-precondition');
  console.log('PASS: real owned H264/AAC MP4, stale grants, MIME/size/signature/encoding checks, protected Storage reads and overwrite, gateway bytes and generation');

  phase='snapshot and reveal';const answer=await f.upload('image',image,'image/png'),background=await f.upload('image',image,'image/png'); await f.update('image',{questionImage:pending.reference,answerImage:answer.reference,backgroundImage:background.reference}); const snapshotId=await f.lock();const replacement=await f.upload('image',image,'image/png');await f.update('image',{questionImage:replacement.reference});
  assert.equal((await f.db.doc('quizSnapshots/'+snapshotId+'/slides/'+f.ids.image).get()).data().questionImage,pending.reference);
  const sessionId=await f.live();assert.equal((await f.read(pending.reference,{sessionId})).status,404);
  await f.navigate(sessionId,3);const shown=await f.read(pending.reference,{sessionId});assert.equal(shown.status,200);assert.equal(shown.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await shown.arrayBuffer()),image);
  assert.equal((await f.read(background.reference,{sessionId})).status,200); assert.equal((await f.read(answer.reference,{sessionId})).status,404);
  const beforeReveal=(await f.db.doc('publicSessions/'+sessionId).get()).data(); assert.equal(JSON.stringify(beforeReveal).includes(answer.reference),false);
  const active=(await f.db.doc('sessions/'+sessionId).get()).data(); await f.admin.call('revealAnswer',{sessionId,expectedRevision:active.revision}); assert.equal((await f.read(answer.reference,{sessionId})).status,200);
  assert.equal((await f.read(replacement.reference,{sessionId})).status,404);assert.equal((await f.read(sound.reference,{sessionId})).status,404);
  await f.navigate(sessionId,4); assert.equal((await f.read(answer.reference,{sessionId})).status,404); assert.equal((await f.read(background.reference,{sessionId})).status,404);assert.equal((await f.read(sound.reference,{sessionId,range:'bytes=0-15'})).status,404);
  const raw=(await f.db.doc('publicSessions/'+sessionId).get()).data();assert.equal(raw.mediaSource,undefined);assert.equal(JSON.stringify(raw).includes('Soukromá odpověď'),false);
  assert.equal((await f.read(sound.reference,{who:f.anonymous})).status,403);assert.equal((await f.read(sound.reference,{who:moderator})).status,200);
  await f.navigate(sessionId,5);const session=(await f.db.doc('sessions/'+sessionId).get()).data();await f.admin.call('selectRecapQuestion',{sessionId,expectedRevision:session.revision,position:4});
  const range=await f.read(sound.reference,{sessionId,range:'bytes=0-15'});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 0-15/'+audio.length);assert.equal((await range.arrayBuffer()).byteLength,16);
  assert.equal((await f.read(sound.reference,{sessionId,range:'bytes=999999-'})).status,416);
  await f.navigate(sessionId,6);assert.equal((await f.read(sound.reference,{sessionId})).status,404);
  console.log('PASS: immutable event asset after library edit, exact current public projection, ordinary audio withheld, recap and Range, navigation revocation');
} catch(error){console.error('Media contract failed during: '+phase+'; code: '+String(error?.code??error?.name));throw error;}
finally {if(f)await f.dispose();}
