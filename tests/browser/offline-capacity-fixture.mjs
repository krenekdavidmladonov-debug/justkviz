/* global document, createImageBitmap */
import { seedEmptyQuiz } from '../e2e/legacy-quiz-fixture.mjs';
import assert from 'node:assert/strict';
import { createDecipheriv, createHash, pbkdf2Sync, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { deleteApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { canonicalOfflineJson, parseOfflineManifest, parseOfflineOperations, initialOfflineState, applyOfflineOperation, offlineOperationContent } from '../../packages/quiz-domain/lib/index.js';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { mediaSlide } from '../e2e/media-fixture.mjs';
import { localEmulatorEndpoint, requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

export const MiB = 1024 * 1024;
export const capacityPayloadBytes = 512 * MiB;
const hash = value => createHash('sha256').update(value).digest('hex');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));

function ownDirectory(directory) {
  const resolved = path.resolve(directory);
  assert(resolved.startsWith(path.resolve('.local-data/offline-v1') + path.sep));
  return resolved;
}

export async function hashFile(filename) {
  const digest = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(filename, { highWaterMark: 64 * 1024 })) {
    digest.update(chunk);
    size += chunk.length;
  }
  return { size, sha256: digest.digest('hex') };
}

/** Keeps the genuine H264/AAC sample intact and appends a valid top-level free box. */
async function paddedMp4(seed, filename, targetBytes, index) {
  const inputSize = (await stat(seed)).size;
  const freeSize = targetBytes - inputSize;
  assert(freeSize >= 64 && freeSize < 2 ** 32);
  const output = await open(filename, 'wx');
  try {
    for await (const chunk of createReadStream(seed, { highWaterMark: 64 * 1024 })) await output.write(chunk);
    const box = Buffer.alloc(8);
    box.writeUInt32BE(freeSize);
    box.write('free', 4, 'ascii');
    await output.write(box);
    const marker = Buffer.from(`JUSTKVIZ-OWNED-CAPACITY-${String(index).padStart(2, '0')}\n`, 'ascii');
    await output.write(marker);
    let remaining = freeSize - box.length - marker.length;
    const slab = Buffer.alloc(64 * 1024, index);
    while (remaining) {
      const size = Math.min(slab.length, remaining);
      await output.write(slab.subarray(0, size));
      remaining -= size;
    }
    await output.sync();
  } finally {
    await output.close();
  }
  assert.equal((await stat(filename)).size, targetBytes);
}

/** Both declared limits: 233 images + 2 audio + 21 videos, exactly 512 MiB. */
export async function createCapacityMedia(seeds, directory, page, extraByte = false) {
  const output = ownDirectory(directory);
  await mkdir(output, { recursive: true });
  const seedVideo = seeds.find(asset => asset.kind === 'video');
  assert(seedVideo?.filename);
  const other = [];
  for (const [index, seed] of seeds.filter(asset => asset.kind !== 'video').entries()) {
    const filename = path.join(output, `native-${index}.${seed.contentType.split('/')[1]}`);
    await writeFile(filename, seed.bytes, { flag: 'wx' });
    other.push({ filename, kind: seed.kind, contentType: seed.contentType,
      ...(seed.width ? { width: seed.width, height: seed.height } : {}), ...await hashFile(filename) });
  }
  assert.equal(other.length, 5);
  const additionalImages = await page.evaluate(async () => {
    const images = [];
    for (let index = 0; index < 230; index++) {
      const canvas = document.createElement('canvas');
      canvas.width = 24; canvas.height = 12;
      const context = canvas.getContext('2d');
      context.fillStyle = `rgb(${index},${255 - index},91)`;
      context.fillRect(0, 0, 24, 12);
      for (let bit = 0; bit < 8; bit++) {
        context.fillStyle = index & (1 << bit) ? '#ffffff' : '#000000';
        context.fillRect(bit * 3, 2, 2, 8);
      }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Native PNG generation failed.');
      const bitmap = await createImageBitmap(blob);
      try { images.push({ width: bitmap.width, height: bitmap.height, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }); }
      finally { bitmap.close(); }
    }
    return images;
  });
  for (const [index, image] of additionalImages.entries()) {
    const filename = path.join(output, `native-extra-${index}.png`);
    await writeFile(filename, Buffer.from(image.bytes), { flag: 'wx' });
    other.push({ filename, kind: 'image', contentType: 'image/png', width: image.width, height: image.height,
      expectedPixel: [index, 255 - index, 91, 255], ...await hashFile(filename) });
  }
  const otherBytes = other.reduce((sum, asset) => sum + asset.size, 0);
  const videos = [];
  for (let index = 0; index < 21; index++) {
    const targetBytes = index < 20 ? 25 * MiB : 12 * MiB - otherBytes + Number(extraByte);
    const filename = path.join(output, `native-padded-${index}.mp4`);
    await paddedMp4(seedVideo.filename, filename, targetBytes, index);
    videos.push({ filename, kind: 'video', contentType: 'video/mp4', width: 384, height: 216,
      ...await hashFile(filename) });
  }
  const assets = [...other, ...videos];
  assert.equal(assets.length, 256);
  assert.equal(assets.reduce((sum, asset) => sum + asset.size, 0), capacityPayloadBytes + Number(extraByte));
  assert.equal(new Set(assets.map(asset => asset.sha256)).size, assets.length);
  assert(assets.every(asset => asset.size <= (asset.kind === 'image' ? 10 : 25) * MiB));
  return assets;
}

/** Streams trusted synthetic worker outputs, then authors ALL references before locking. */
export async function capacityEventFixture(assets) {
  const environment = requireFullEmulatorEnvironment(process.env, 'Offline capacity fixture');
  assert.equal(environment.projectId, 'demo-filmovy-kviz-v2');
  const storage = localEmulatorEndpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Offline capacity Storage Emulator');
  assert.deepEqual(storage, { host: '127.0.0.1', port: 9199 });
  assert.equal(process.env.STORAGE_EMULATOR_HOST, 'http://127.0.0.1:9199');
  assert.equal(process.env.GOOGLE_CLOUD_PROJECT, environment.projectId);
  const sdk = require('firebase-admin/app');
  const previousApps = new Set(sdk.getApps().map(app => app.name));
  const identity = await editorIdentity();
  const adminApp = sdk.getApps().find(app => !previousApps.has(app.name));
  assert(adminApp);
  const bucket = require('firebase-admin/storage').getStorage(adminApp).bucket(environment.projectId + '.appspot.com');
  let quizId, eventId, snapshotId;
  const call = identity.call;
  const dispose = async () => {
    requireFullEmulatorEnvironment(process.env, 'Offline capacity cleanup');
    assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, '127.0.0.1:9199');
    assert.equal(process.env.STORAGE_EMULATOR_HOST, 'http://127.0.0.1:9199');
    if (eventId) {
      await identity.db.recursiveDelete(identity.db.doc('events/' + eventId));
      await identity.db.doc('publicEvents/' + eventId).delete();
    }
    if (snapshotId) await identity.db.recursiveDelete(identity.db.doc('quizSnapshots/' + snapshotId));
    if (quizId) {
      await bucket.deleteFiles({ prefix: 'quiz-assets/' + quizId + '/' });
      await identity.db.recursiveDelete(identity.db.doc('quizzes/' + quizId));
    }
    await identity.dispose();
  };
  try {
    ({ quizId } = await seedEmptyQuiz(identity.db, 'Syntetická kapacita 512 MiB'));
    const media = [];
    for (const [index, asset] of assets.entries()) {
      const assetId = hash(`${quizId}:${index}:${asset.sha256}`);
      const file = bucket.file(`quiz-assets/${quizId}/${assetId}/source`);
      await pipeline(createReadStream(asset.filename, { highWaterMark: 64 * 1024 }),
        file.createWriteStream({ resumable: false, metadata: { contentType: asset.contentType } }));
      const [metadata] = await file.getMetadata();
      assert.equal(Number(metadata.size), asset.size);
      await identity.db.doc(`quizzes/${quizId}/mediaAssets/${assetId}`).set({ quizId, assetId,
        kind: asset.kind, contentType: asset.contentType, size: asset.size, generation: metadata.generation,
        status: 'ready', storageBackend: 'storage' });
      media.push({ ...asset, reference: `quiz-asset:${quizId}/${assetId}`, generation: metadata.generation });
    }
    const quiz = async () => (await identity.db.doc('quizzes/' + quizId).get()).data();
    const slides = async () => (await identity.db.collection(`quizzes/${quizId}/slides`).orderBy('position').get()).docs.map(row => ({ id: row.id, ...row.data() }));
    const add = async (kind, extra = {}, position) => call('createQuizSlide', { quizId,
      expectedRevision: (await quiz()).revision, position: position ?? (await slides()).length + 1,
      ...(['intro', 'end'].includes(kind) ? { scope: 'quiz' } : {}),
      slide: mediaSlide(kind, { title: 'Syntetická kapacitní otázka', text: 'Pouze vlastní syntetický obsah',
        correctAnswer: ['free', 'image', 'video', 'audio'].includes(kind) ? 'SYNTHETIC_CAPACITY_PRIVATE_ANSWER' : '',
        moderatorNote: 'SYNTHETIC_CAPACITY_PRIVATE_NOTE',
        ...(['free', 'image', 'video', 'audio'].includes(kind) ? { authoringStatus: 'ready' } : {}), ...extra }) });
    await add('intro');
    for (let round = 1; round <= 2; round++) {
      await call('createQuizRound', { quizId, expectedRevision: (await quiz()).revision, title: `Kolo ${round}` });
      const beforeRecap = async (kind, extra) => add(kind, extra, (await slides()).filter(slide => slide.kind === 'recap').at(-1).position);
      await beforeRecap('free', {});
      if (round === 1) {
        const images = media.filter(asset => asset.kind === 'image');
        await beforeRecap('image', { questionImage: images[0].reference, answerImage: images[1].reference,
          backgroundImage: images[2].reference, design: { logoImage: images[2].reference, showLogo: true },
          answerDesign: { backgroundImage: images[1].reference } });
        const extraImages = images.slice(3);
        assert.equal(extraImages.length, 230);
        for (let index = 0; index < extraImages.length; index += 2) {
          await beforeRecap('image', { title: `Vlastní obrázky ${index + 1} a ${index + 2}`,
            questionImage: extraImages[index].reference, backgroundImage: extraImages[index + 1].reference });
        }
        for (const [index, video] of media.filter(asset => asset.kind === 'video').entries()) {
          await beforeRecap('video', { title: `Vlastní video ${index + 1}`, mediaSource: video.reference, clipStartSeconds: 1, clipEndSeconds: 3 });
        }
      }
      const audio = media.filter(asset => asset.kind === 'audio')[round - 1];
      await beforeRecap('audio', { mediaSource: audio.reference, clipStartSeconds: 1, clipEndSeconds: 3 });
    }
    await add('end');
    const authored = await slides();
    const roundSlides = authored.filter(slide => typeof slide.roundId === 'string' && slide.roundId.length > 0);
    const derivedRoundIds = new Set(roundSlides.map(slide => slide.roundId)).size;
    const derivedQuestions = roundSlides.filter(slide => slide.isQuestion === true).length;
    const estimatedEditorWrites = authored.length + derivedQuestions + derivedRoundIds + 3;
    assert(authored.length <= 400 && estimatedEditorWrites <= 475, 'Capacity fixture exceeds an existing editor bound.');
    const authoredReferences = new Set(authored.flatMap(slide => [slide.questionImage, slide.answerImage, slide.backgroundImage, slide.mediaSource,
      slide.design?.backgroundImage, slide.design?.logoImage, slide.answerDesign?.backgroundImage, slide.answerDesign?.logoImage]));
    assert(media.every(asset => authoredReferences.has(asset.reference)), 'Every capacity asset must be authored before locking.');
    const authoringProof = { slideCount: authored.length, derivedQuestions, derivedRoundIds, estimatedEditorWrites, referencedAssets: media.length };
    ({ eventId } = await call('createEvent', { expectedRevision: 0, event: {
      title: 'Syntetická kapacita 512 MiB', startsAt: '2031-11-20T18:00:00Z', timeZone: 'Europe/Prague',
      venue: { name: 'Syntetický sál', publicLocation: 'Pouze lokální QA' }, teamCapacity: 30,
      peopleCapacity: 120, teamSizeMin: 2, teamSizeMax: 4 } }));
    const event = async () => (await identity.db.doc('events/' + eventId).get()).data();
    await call('lockEventQuiz', { eventId, quizId, expectedRevision: (await event()).revision,
      expectedQuizRevision: (await quiz()).revision, acknowledgeWarnings: true });
    snapshotId = (await event()).quizAssignment.snapshotId;
    for (let index = 1; index <= 10; index++) await call('adminAddEventTeam', { eventId,
      teamName: `QA${String(index).padStart(2, '0')}`, memberCount: 2, requestId: randomUUID() });
    const client = getApps().find(app => getAuth(app).currentUser?.email === identity.email);
    assert(client);
    return { identity, adminApp, user: getAuth(client).currentUser, eventId, quizId, snapshotId, media, authoringProof, call, dispose,
      async detach() { await deleteApp(client); await sdk.deleteApp(adminApp); } };
  } catch (error) {
    await dispose();
    throw error;
  }
}

/** Bounded independent AES-GCM inspector. Holds one <=4 MiB record, not the whole file. */
export async function inspectCapacityArchive(filename, password) {
  const file = await open(filename, 'r');
  const fileHash = createHash('sha256');
  let offset = 0, largestRead = 0;
  const read = async size => {
    assert(Number.isSafeInteger(size) && size > 0 && size <= 4 * MiB + 512 * 1024 + 65552);
    const bytes = Buffer.alloc(size);
    let written = 0;
    while (written < size) {
      const result = await file.read(bytes, written, size - written, offset + written);
      assert(result.bytesRead > 0, 'Truncated encrypted record.');
      written += result.bytesRead;
    }
    offset += size;
    largestRead = Math.max(largestRead, size);
    fileHash.update(bytes);
    return bytes;
  };
  try {
    const magic = Buffer.from('JUSTKVIZ-OFFLINE/1\n');
    assert((await read(magic.length)).equals(magic));
    const headerLength = (await read(4)).readUInt32BE();
    assert(headerLength > 0 && headerLength <= 65536);
    const header = JSON.parse(await read(headerLength));
    assert.equal(header.schemaVersion, 1);
    assert(header.recordSizes.length > 0 && header.recordSizes.length <= 1024);
    assert(header.iterations >= 100000 && header.iterations <= 500000);
    const fileBytes = (await file.stat()).size;
    assert.equal(offset + header.recordSizes.reduce((sum, size) => sum + size, 0), fileBytes);
    const key = pbkdf2Sync(password, Buffer.from(header.salt, 'base64url'), header.iterations, 32, 'sha256');
    let metadata, currentAsset = 0, assetBytes = 0, assetHash = createHash('sha256');
    const checkedAssets = [];
    for (const [index, size] of header.recordSizes.entries()) {
      assert(size >= 17 && size <= (index ? 4 * MiB : 4 * MiB + 512 * 1024 + 65536) + 16);
      const encrypted = await read(size);
      const iv = Buffer.alloc(12);
      const prefix = Buffer.from(header.noncePrefix, 'base64url');
      assert.equal(prefix.length, 8);
      prefix.copy(iv); iv.writeUInt32BE(index, 8);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(canonicalOfflineJson({ header, index })));
      decipher.setAuthTag(encrypted.subarray(-16));
      const plain = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
      if (index === 0) {
        const raw = JSON.parse(plain);
        metadata = { manifest: parseOfflineManifest(raw.manifest), grant: raw.grant, operations: parseOfflineOperations(raw.operations) };
      } else {
        const descriptor = metadata.manifest.assets[currentAsset];
        assert(descriptor);
        assert.equal(plain.length, Math.min(4 * MiB, descriptor.size - assetBytes));
        assetHash.update(plain); assetBytes += plain.length;
        if (assetBytes === descriptor.size) {
          assert.equal(assetHash.digest('hex'), descriptor.sha256);
          checkedAssets.push({ reference: descriptor.reference, size: assetBytes, sha256: descriptor.sha256 });
          currentAsset++; assetBytes = 0; assetHash = createHash('sha256');
        }
      }
    }
    assert.equal(currentAsset, metadata.manifest.assets.length);
    assert.equal(assetBytes, 0);
    assert.equal(offset, fileBytes);
    let state = initialOfflineState(metadata.manifest);
    for (const operation of metadata.operations) {
      const { hash: operationHash, ...content } = operation;
      assert.equal(hash(offlineOperationContent(content)), operationHash);
      state = applyOfflineOperation(metadata.manifest, state, operation);
    }
    return { metadata, state, checkedAssets, fileBytes, fileSha256: fileHash.digest('hex'), recordCount: header.recordSizes.length, largestRead };
  } finally {
    await file.close();
  }
}
