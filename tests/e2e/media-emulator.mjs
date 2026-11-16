import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { ref, uploadBytes, getBytes, listAll, deleteObject, updateMetadata } from 'firebase/storage';
import { mediaFixture, syntheticAudio, syntheticImage, mediaSlide } from './media-fixture.mjs';
import { createMediaUploadFixtures, mediaUploadSha256 } from './media-upload-fixtures.mjs';
import { storageReadBudgetContract } from './storage-read-budget.mjs';
import { localEmulatorEndpoint, requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
import { quizDuplicationIdentity } from '../../functions/lib/editor/model.js';
let f,phase='fixture';
const copies = new Set();
const extraFixtures = [];
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

  phase = 'whole quiz media copy and retry';
  const sourceRoot = (await f.quizRef.get()).data();
  const videoSlide = await f.admin.call('createQuizSlide', { quizId: f.quizId, expectedRevision: sourceRoot.revision, position: 6,
    slide: mediaSlide('video', { mediaSource: videoGrant.reference, clipStartSeconds: 0, clipEndSeconds: 2,
      text: 'Původní video', correctAnswer: 'Soukromá odpověď', moderatorNote: 'Soukromá poznámka' }) });
  await f.update('image', { questionImage: pending.reference, backgroundImage: pending.reference });
  const copyAnswer = await f.upload('image', image, 'image/png');
  await f.update('image', { questionImage: pending.reference, backgroundImage: pending.reference, answerImage: copyAnswer.reference });
  const originalQuiz = (await f.quizRef.get()).data();
  await f.admin.call('updateQuizMetadata', { quizId: f.quizId, expectedRevision: originalQuiz.revision,
    quiz: { title: originalQuiz.title, description: originalQuiz.description, defaultDesign: { logoImage: pending.reference } } });
  const readDocuments = async root => ({ root: (await root.get()).data(),
    slides: (await root.collection('slides').get()).docs.map(doc => [doc.id, doc.data()]),
    assets: (await root.collection('mediaAssets').get()).docs.map(doc => [doc.id, doc.data()]) });
  const beforeCopy = await readDocuments(f.quizRef);
  const inputs = { quizId: f.quizId, expectedRevision: beforeCopy.root.revision, title: 'Kopie se samostatnými médii', requestId: randomUUID() };
  const duplicate = data => f.admin.call('duplicateQuiz', data);
  const destination = quizDuplicationIdentity(uid, inputs.requestId, f.quizId, inputs.expectedRevision, inputs.title).quizId;
  copies.add(destination);
  const destRoot = f.db.doc('quizzes/' + destination);
  const targetPath = assetId => `quiz-assets/${destination}/${assetId}/source`;
  const targetRef = assetId => `quiz-asset:${destination}/${assetId}`;
  const media = [
    { id: pending.assetId, bytes: image, type: 'image/png' },
    { id: copyAnswer.assetId, bytes: image, type: 'image/png' },
    { id: sound.assetId, bytes: audio, type: 'audio/wav' },
    { id: videoGrant.assetId, bytes: video.bytes, type: 'video/mp4' },
  ].sort((left, right) => left.id.localeCompare(right.id));
  await setScope('selected', [f.quizId]);
  await outsiderRef.update({ quizzes: { mode: 'selected', ids: [f.quizId] }, version: outsiderMember.version + 2 });
  const validMember = (await memberRef.get()).data();
  await memberRef.update({ permissions: validMember.permissions.filter(permission => permission !== 'quiz.media.upload'), version: validMember.version + 1 });
  await denied(duplicate(inputs), 'functions/permission-denied');
  await memberRef.set({ ...validMember, version: validMember.version + 2 });
  const badTarget = f.bucket.file(targetPath(media.at(-1).id));
  await badTarget.save(Buffer.from('synthetic conflict'), { resumable: false, metadata: { contentType: 'text/plain' } });
  await denied(duplicate(inputs), 'functions/failed-precondition');
  assert.equal((await destRoot.get()).exists, false);
  assert.deepEqual((await memberRef.get()).get('quizzes.ids'), [f.quizId]);
  const [staged] = await f.bucket.file(targetPath(media[0].id)).getMetadata();
  assert.equal((await f.read(targetRef(media[0].id))).status, 404, 'A staged object is not an available quiz asset.');
  await denied(duplicate({ ...inputs, title: 'Different intent' }), 'functions/already-exists');
  await badTarget.delete();
  const [copy, replay] = await Promise.all([duplicate(inputs), duplicate(inputs)]);
  assert.deepEqual(copy, replay);
  assert.equal(copy.quizId, destination);
  assert.equal(copy.revision, 0);
  assert.equal((await destRoot.get()).get('status'), 'draft');
  assert.equal((await destRoot.get()).get('defaultDesign.logoImage'), targetRef(pending.assetId));
  assert.equal((await destRoot.collection('mediaAssets').get()).size, media.length, 'Repeated references share a single destination file.');
  assert.deepEqual((await memberRef.get()).get('quizzes.ids'), [f.quizId, destination]);
  const receipt = (await f.db.doc('quizDuplicationAttempts/' + destination).get()).data();
  assert.ok(receipt.completedAt);
  assert.equal(receipt.pins, undefined, 'Completion discards transfer progress.');
  assert.equal((await f.bucket.file(targetPath(media[0].id)).getMetadata())[0].generation, staged.generation);
  for (const asset of media) {
    const copied = (await destRoot.collection('mediaAssets').doc(asset.id).get()).data();
    const [metadata] = await f.bucket.file(targetPath(asset.id)).getMetadata();
    assert.equal(copied.quizId, destination);
    assert.equal(copied.generation, metadata.generation);
    assert.equal(copied.sha256, mediaUploadSha256(asset.bytes));
    assert.equal(metadata.contentType, asset.type);
    assert.equal(metadata.cacheControl, 'private, no-store');
    assert.equal(metadata.metadata?.firebaseStorageDownloadTokens, undefined);
    const response = await f.read(targetRef(asset.id));
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), asset.bytes);
    assert.equal((await f.read(targetRef(asset.id), { who: f.anonymous })).status, 403);
    assert.equal((await f.read(targetRef(asset.id), { who: outsider })).status, 404);
  }
  const copiedRange = await f.read(targetRef(videoGrant.assetId), { range: 'bytes=0-15' });
  assert.equal(copiedRange.status, 206);
  assert.deepEqual(Buffer.from(await copiedRange.arrayBuffer()), video.bytes.subarray(0, 16));
  const originalImageSlide = destRoot.collection('slides').doc(f.ids.image);
  assert.equal((await originalImageSlide.get()).get('questionImage'), targetRef(pending.assetId));
  assert.equal((await originalImageSlide.get()).get('backgroundImage'), targetRef(pending.assetId));
  assert.equal((await originalImageSlide.get()).get('answerImage'), targetRef(copyAnswer.assetId));
  const copiedVideo = (await destRoot.collection('slides').doc(videoSlide.selectedSlideId).get()).data();
  assert.equal(copiedVideo.mediaSource, targetRef(videoGrant.assetId));
  assert.equal(copiedVideo.moderatorNote, 'Soukromá poznámka');
  const edited = await f.admin.call('updateQuizSlide', { quizId: destination, expectedRevision: 0, slideId: f.ids.image,
    slide: mediaSlide('image', { text: 'Jen kopie', questionImage: 'https://example.test/replacement.png' }) });
  await f.admin.call('deleteQuizSlide', { quizId: destination, expectedRevision: edited.revision, slideId: videoSlide.selectedSlideId });
  assert.equal((await originalImageSlide.get()).get('text'), 'Jen kopie');
  assert.deepEqual(await readDocuments(f.quizRef), beforeCopy);
  assert.deepEqual(Buffer.from(await (await f.read(pending.reference)).arrayBuffer()), image);
  assert.deepEqual(Buffer.from(await (await f.read(videoGrant.reference)).arrayBuffer()), video.bytes);
  await f.admin.call('deleteQuizSlide', { quizId: f.quizId, expectedRevision: beforeCopy.root.revision, slideId: videoSlide.selectedSlideId });
  await setScope('all');
  console.log('PASS: complete quiz media duplication, staged retry, exact source and copied bytes, independent edits and private asset authorization');

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

  phase = 'private Drive copy with synthetic transport and current authority';
  const driveEnvironment = requireFullEmulatorEnvironment(process.env, 'Private Drive copy fixture');
  localEmulatorEndpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Private Drive copy Storage emulator');
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const { initializeApp, deleteApp } = require('firebase-admin/app');
  const localServer = initializeApp({ projectId: driveEnvironment.projectId });
  extraFixtures.push(() => deleteApp(localServer));
  const { createDuplicateQuizCallable } = await import('../../functions/lib/editor/callables.js');
  const { materializeQuizCopyAsset } = await import('../../functions/lib/media/quiz-copy-storage.js');
  const { readDriveAsset, verifyDriveAsset } = await import('../../functions/lib/drive/media-read.js');
  const { createTokenVault } = await import('../../functions/lib/email/token-vault.js');
  const driver = await f.admin.call('createQuiz', { requestId: randomUUID(), title: 'Syntetický soukromý Disk' });
  const driveQuiz = f.db.doc('quizzes/' + driver.quizId);
  const connection = f.db.doc('driveConnections/' + uid);
  extraFixtures.push(async () => { await connection.delete(); await f.db.recursiveDelete(driveQuiz); });
  const actorBefore = (await memberRef.get()).data();
  const owner = { ...actorBefore, role: 'owner', permissions: [...new Set([...actorBefore.permissions, 'users.manage'])], version: actorBefore.version + 1 };
  await memberRef.set(owner);
  const account = { email: 'synthetic-drive@example.test', permissionId: 'synthetic-owner' };
  const folder = { id: 'synthetic-folder', name: 'Synthetic folder', url: 'https://drive.google.com/drive/folders/synthetic-folder' };
  const vault = createTokenVault('dup-test-key', Buffer.alloc(32, 45));
  await connection.create({ revision: 1, generation: 1, account, folder, refreshToken: vault.seal('synthetic-refresh', 'justkviz-drive:v1:' + uid + ':refresh:1') });
  const importJobId = 'd'.repeat(64);
  const assetId = createHash('sha256').update(JSON.stringify(['drive-asset-v1', importJobId])).digest('hex');
  const driveSource = `quiz-asset:${driver.quizId}/${assetId}`;
  const driveFile = { id: 'synthetic-video', folderId: folder.id, mimeType: 'video/mp4', size: video.bytes.length, sha256: video.sha256,
    md5Checksum: createHash('md5').update(video.bytes).digest('hex') };
  const driveAsset = { quizId: driver.quizId, assetId, status: 'ready', storageBackend: 'drive', kind: 'video',
    contentType: driveFile.mimeType, size: driveFile.size, generation: 'drive:' + video.sha256, sha256: video.sha256,
    drive: { ownerUid: uid, connectionGeneration: 1, accountPermissionId: account.permissionId, file: driveFile } };
  await driveQuiz.collection('mediaAssets').doc(assetId).create(driveAsset);
  const driveSlide = await f.admin.call('createQuizSlide', { quizId: driver.quizId, expectedRevision: driver.revision, position: 1,
    slide: mediaSlide('video', { mediaSource: driveSource, clipStartSeconds: 0, clipEndSeconds: 2,
      text: 'Původní klip', correctAnswer: 'Soukromá odpověď' }) });
  const driveSlideRef = driveQuiz.collection('slides').doc(driveSlide.selectedSlideId);
  await driveSlideRef.update({ driveImportProvenance: { mediaSource: { field: 'mediaSource', importJobId,
    source: { type: 'youtube', kind: 'video', videoId: 'abcdefghijk', startSeconds: 10, endSeconds: 12 } } } });
  const beforeDrive = await readDocuments(driveQuiz);
  const driveInput = { quizId: driver.quizId, expectedRevision: driveSlide.revision, title: 'Kopie soukromého klipu', requestId: randomUUID() };
  const driveDest = quizDuplicationIdentity(uid, driveInput.requestId, driveInput.quizId, driveInput.expectedRevision, driveInput.title).quizId;
  copies.add(driveDest);
  const driveCopy = f.db.doc('quizzes/' + driveDest);
  const driveTargetRef = `quiz-asset:${driveDest}/${assetId}`;
  const unused = () => { throw new Error('No real Drive transport is available in this test.'); };
  let downloadCount = 0, verifyCount = 0, revokeAfterTransfer = true;
  const fakeDrive = { config: { clientId: '', clientSecret: '', redirectUri: '', developerKey: '', appId: '', vault },
    provider: { refresh: async token => { assert.equal(token, 'synthetic-refresh'); return { accessToken: 'synthetic-access' }; },
      account: async () => account, folder: async () => folder, generateFolderId: unused, createMediaFolder: unused, revoke: unused, exchange: unused },
    files: { generateId: unused, upload: unused, verify: async () => { verifyCount++; return driveFile; },
      download: async (_token, _account, file) => { assert.deepEqual(file, driveFile); downloadCount++; return video.bytes; } } };
  const runDriveCopy = createDuplicateQuizCallable(async (source, dest) => {
    const pin = await materializeQuizCopyAsset(source, dest, { bucket: f.bucket,
      readDrive: (asset, quizId) => readDriveAsset(asset, quizId, fakeDrive),
      verifyDrive: (asset, quizId) => verifyDriveAsset(asset, quizId, fakeDrive) });
    if (revokeAfterTransfer) await memberRef.update({ permissions: owner.permissions.filter(p => p !== 'users.manage'), version: owner.version + 1 });
    return pin;
  });
  const claims = (await f.admin.auth.currentUser.getIdTokenResult()).claims;
  const driveRequest = { data: driveInput, auth: { uid, token: claims }, rawRequest: {} };
  await assert.rejects(runDriveCopy.run(driveRequest), error => error.code === 'permission-denied' && error.details === 'quiz-copy-drive-owner-required');
  assert.equal((await driveCopy.get()).exists, false);
  assert.equal((await f.read(driveTargetRef)).status, 404);
  revokeAfterTransfer = false;
  await memberRef.set({ ...owner, version: owner.version + 2 });
  assert.equal((await runDriveCopy.run(driveRequest)).quizId, driveDest);
  assert.equal(downloadCount, 1);
  assert.equal(verifyCount, 1);
  const copiedDriveMedia = (await driveCopy.collection('mediaAssets').doc(assetId).get()).data();
  assert.equal(copiedDriveMedia.storageBackend, 'storage');
  assert.equal(copiedDriveMedia.drive, undefined);
  assert.equal(copiedDriveMedia.sha256, video.sha256);
  const copiedSlide = (await driveCopy.collection('slides').doc(driveSlide.selectedSlideId).get()).data();
  assert.equal(copiedSlide.mediaSource, driveTargetRef);
  assert.equal(copiedSlide.driveImportProvenance.mediaSource.source.videoId, 'abcdefghijk');
  assert.deepEqual(await readDocuments(driveQuiz), beforeDrive);
  await connection.delete();
  await assert.rejects(readDriveAsset(driveAsset, driver.quizId, fakeDrive), error => error.code === 'failed-precondition');
  const afterDisconnect = await f.read(driveTargetRef);
  assert.equal(afterDisconnect.status, 200);
  assert.deepEqual(Buffer.from(await afterDisconnect.arrayBuffer()), video.bytes);
  await memberRef.set({ ...actorBefore, version: owner.version + 3 });
  console.log('PASS: private Drive ACL/byte checks with synthetic provider, revoked owner denied before publication, independent copied playback after Drive disconnect');
} catch(error){console.error('Media contract failed during: '+phase+'; code: '+String(error?.code??error?.name));throw error;}
finally {
  if (f) {
    for (const id of copies) {
      await f.bucket.deleteFiles({ prefix: 'quiz-assets/' + id + '/' });
      await f.db.recursiveDelete(f.db.doc('quizzes/' + id));
      await f.db.doc('quizDuplicationAttempts/' + id).delete();
    }
    for (const cleanup of extraFixtures) await cleanup();
    await f.dispose();
  }
}
