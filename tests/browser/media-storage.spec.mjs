/* global window, getComputedStyle, HTMLMediaElement */
import { test, expect } from '@playwright/test';
import { mediaFixture, syntheticImage, syntheticAudio } from '../e2e/media-fixture.mjs';
import { createMediaUploadFixtures, mediaUploadSha256 } from '../e2e/media-upload-fixtures.mjs';
import { verifyOfflineNativeMedia } from './offline-media-fixture.mjs';
import { requireFullEmulatorEnvironment, localEmulatorEndpoint } from '../../tools/local-emulator-environment.mjs';
async function openRounds(page) { await expect(page.locator('.outline-round').first()).toBeVisible(); while (await page.locator('.outline-collapse[aria-expanded="false"]').count()) await page.locator('.outline-collapse[aria-expanded="false"]').first().click(); }

async function observeClipEnd(page, endSeconds) {
  await expect.poll(() => page.locator('audio').evaluate(audio => typeof audio.ontimeupdate)).toBe('function');
  await expect.poll(() => page.locator('audio').evaluate(audio =>
    audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && !audio.seeking)).toBe(true);
  await page.locator('audio').evaluate((audio, end) => {
    window.__JUSTKVIZ_CLIP_START__ = null;
    window.__JUSTKVIZ_CLIP_END__ = null; window.__JUSTKVIZ_CLIP_MAX__ = audio.currentTime;
    audio.addEventListener('playing', () => {
      window.__JUSTKVIZ_CLIP_START__ = { time: audio.currentTime, paused: audio.paused };
    }, { once: true });
    audio.addEventListener('timeupdate', () => {
      const time = audio.currentTime; window.__JUSTKVIZ_CLIP_MAX__ = Math.max(window.__JUSTKVIZ_CLIP_MAX__, time);
      if (time >= end && window.__JUSTKVIZ_CLIP_END__ === null) window.__JUSTKVIZ_CLIP_END__ = { time, duration: audio.duration, paused: audio.paused };
    });
  }, endSeconds);
}
async function stoppedAtFirstCrossing(page, endSeconds) {
  await expect.poll(() => page.evaluate(() => window.__JUSTKVIZ_CLIP_END__)).not.toBeNull();
  const started = await page.evaluate(() => window.__JUSTKVIZ_CLIP_START__);
  expect(started).toMatchObject({ paused: false });
  expect(started.time).toBeLessThan(endSeconds);
  const sample = await page.evaluate(() => window.__JUSTKVIZ_CLIP_END__);
  expect(Number.isFinite(sample.time) && Number.isFinite(sample.duration)).toBe(true);
  expect(sample.time).toBeGreaterThanOrEqual(endSeconds); expect(sample.time).toBeLessThan(sample.duration); expect(sample.paused).toBe(true);
  expect(await page.evaluate(() => window.__JUSTKVIZ_CLIP_MAX__)).toBeLessThanOrEqual(sample.time);
  await expect(page.locator('[data-media-lifecycle]')).toHaveAttribute('data-media-lifecycle', 'FINISHED');
  await expect(page.locator('.projector-media-error')).toHaveCount(0);
  return sample;
}

test('copies an owned image from the library and replaces it in the copy only @quiz-copy-media', async ({ page, context }) => {
  const f = await mediaFixture();
  let copyId;
  try {
    const image = await f.upload('image', syntheticImage(), 'image/png');
    await f.update('image', { questionImage: image.reference });
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto('/admin/login');
    await page.getByLabel('E-mail').fill(f.loginEmail);
    await page.getByLabel('Heslo').fill(f.loginPassword);
    await page.getByRole('button', { name: 'Přihlásit se' }).click();
    await expect(page).toHaveURL(/\/admin$/u);
    await page.goto('/admin/quizzes');
    await page.getByRole('button', { name: 'Duplikovat kvíz Syntetická vlastní média' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Vytvořit kopii' }).click();
    await expect(page).toHaveURL(/\/admin\/quizzes\/quiz_[a-f0-9]{64}\/edit$/u);
    copyId = new URL(page.url()).pathname.split('/')[3];
    await openRounds(page);
    await page.locator('.outline-question').filter({ hasText: 'Syntetický obrázek' }).click();
    const media = page.getByRole('region', { name: 'Obrázek otázky', exact: true });
    await expect.poll(() => media.getByRole('img').evaluate(img => img.naturalWidth)).toBe(8);
    const copied = f.db.doc(`quizzes/${copyId}/slides/${f.ids.image}`);
    expect((await copied.get()).get('questionImage')).toBe(`quiz-asset:${copyId}/${image.assetId}`);
    await media.getByLabel('Obrázek otázky — soubor', { exact: true }).setInputFiles({
      name: 'replacement.png', mimeType: 'image/png', buffer: syntheticImage(),
    });
    await expect(media.getByText('Ověřené médium tohoto kvízu', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Uložit vše', exact: true }).click();
    await expect(page.locator('.save-state')).toHaveText('Uloženo');
    const replacement = (await copied.get()).get('questionImage');
    expect(replacement).toMatch(new RegExp(`^quiz-asset:${copyId}/[a-f0-9]{64}$`, 'u'));
    expect(replacement).not.toBe(`quiz-asset:${copyId}/${image.assetId}`);
    expect((await f.quizRef.collection('slides').doc(f.ids.image).get()).get('questionImage')).toBe(image.reference);
    await page.goto('/admin/quizzes/' + f.quizId + '/edit');
    await openRounds(page);
    await page.locator('.outline-question').filter({ hasText: 'Syntetický obrázek' }).click();
    await expect.poll(() => media.getByRole('img').evaluate(img => img.naturalWidth)).toBe(8);
  } finally {
    if (copyId) {
      await f.bucket.deleteFiles({ prefix: 'quiz-assets/' + copyId + '/' });
      await f.db.recursiveDelete(f.db.doc('quizzes/' + copyId));
    }
    await f.dispose();
  }
});

test('synthetic owned image/audio upload, editor preview, immutable projector image and manual audio lifecycle', async ({page,context,browser}) => {
  const f=await mediaFixture();let projectorContext, phase='login';
  console.log('Media browser: fixture ready');
  try {
    const localOnly=r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort();
    await context.route('**/*',localOnly);
    await page.goto('/admin/login');await page.getByLabel('E-mail').fill(f.loginEmail);await page.getByLabel('Heslo').fill(f.loginPassword);await page.getByRole('button',{name:'Přihlásit se'}).click();
    await expect(page).toHaveURL(/\/admin$/);
    phase='editor selection';console.log('Media browser: logged in');
    await page.goto('/admin/quizzes/'+f.quizId+'/edit'); await openRounds(page);
    await page.locator('.outline-question').filter({hasText:'Syntetický obrázek'}).click();
    phase='image upload';
    let releaseUpload;
    const pendingUpload=new Promise(resolve=>{releaseUpload=resolve;});
    await page.route('**/finalizeQuizMediaUpload',async route=>{await pendingUpload;await route.continue();});
    await page.locator('[data-preflight-field="prompt"] textarea').fill('Syntetický obrázek upravený');
    await page.getByLabel('Obrázek otázky — soubor', {exact:true}).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:syntheticImage()});
    await expect(page.getByRole('button',{name:'Uložit vše',exact:true})).toBeDisabled();
    await page.keyboard.press('Control+s');
    expect((await f.quizRef.collection('slides').doc(f.ids.image).get()).data().text).toBe('Syntetický obrázek');
    releaseUpload();
    await expect(page.getByText('Ověřené médium tohoto kvízu', {exact:false}).first()).toBeVisible();
    const preview=page.locator('.round-editor-preview img');
    await expect.poll(()=>preview.evaluate(img=>img.naturalWidth)).toBe(8);
    await page.getByRole('button',{name:'Uložit vše',exact:true}).click();
    await expect.poll(async()=>(await f.quizRef.collection('slides').doc(f.ids.image).get()).data().questionImage).toMatch(/^quiz-asset:/);
    await expect(page.locator('.save-state')).toHaveText('Uloženo');
    phase='audio upload';console.log('Media browser: image saved');
    await page.locator('.outline-question').filter({hasText:'Syntetické audio'}).click();
    await page.getByLabel('Zdroj ukázky — soubor', {exact:true}).setInputFiles({name:'synthetic.wav',mimeType:'audio/wav',buffer:syntheticAudio()});
    await expect(page.getByText('Ověřené médium tohoto kvízu', {exact:false}).first()).toBeVisible();
    await page.locator('[data-preflight-field="clipStartSeconds"] input').fill('0:01');
    await page.locator('[data-preflight-field="clipEndSeconds"] input').fill('0:02');
    await page.getByRole('button',{name:'Uložit vše',exact:true}).click();
    await expect.poll(async()=>(await f.quizRef.collection('slides').doc(f.ids.audio).get()).data().mediaSource).toMatch(/^quiz-asset:/);
    await expect(page.locator('.save-state')).toHaveText('Uloženo');
    await expect.poll(()=>page.locator('audio').evaluate(a=>a.readyState)).toBeGreaterThanOrEqual(1);
    expect(await page.locator('audio').evaluate(a=>a.paused)).toBe(true);
    await page.getByRole('button',{name:'Přehrát ukázku',exact:true}).click();
    await expect(page.getByText('Ukázka dohrála.',{exact:true})).toBeVisible();
    expect(await page.locator('audio').evaluate(a=>a.currentTime)).toBeGreaterThanOrEqual(2);
    expect(await page.locator('audio').evaluate(a=>a.paused)).toBe(true);
    await page.getByRole('button',{name:'Pustit znovu',exact:true}).click();
    await expect(page.getByText('Ukázka se přehrává.',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await expect.poll(()=>page.locator('audio').evaluate(a=>a.paused)).toBe(true);
    await expect(page.getByText('Ukázka je zastavená.',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>window.__FILMOVY_KVIZ_MEDIA_DEBUG__.peakPlayers)).toBe(1);

    phase='snapshot/projector';console.log('Media browser: editor audio completed');
    const quiz = (await f.quizRef.get()).data();
    await f.admin.call('updateQuizMetadata', { quizId: f.quizId, expectedRevision: quiz.revision, quiz: {
      title: quiz.title, description: quiz.description,
      defaultDesign: { layout: 'image-first', textAlign: 'center', textWidth: 70, mediaFit: 'cover' },
    } });
    await f.lock();const sessionId=await f.live();
    await f.navigate(sessionId,3);
    await page.goto('/admin/live/'+sessionId);
    projectorContext=await browser.newContext({baseURL:'http://127.0.0.1:5198',viewport:{width:1280,height:720}});
    await projectorContext.route('**/*',localOnly);const projector=await projectorContext.newPage();
    await projector.goto('/projector/'+sessionId);
    const projected=projector.locator('.question-image-frame img');
    await expect.poll(()=>projected.evaluate(img=>img.naturalWidth)).toBe(8);
    expect(await projected.evaluate(img=>getComputedStyle(img).objectFit)).toBe('contain');
    await expect(projector.locator('.slide-renderer')).toHaveClass(/fixed-photo-question/u);
    const photoGeometry = () => projector.locator('.fixed-photo-grid').evaluate(node => {
      const frame = node.querySelector('.question-image-frame'), copy = node.querySelector('.fixed-photo-copy');
      const answer = copy.querySelector('.slide-answer');
      return { photoX: frame.getBoundingClientRect().x, copyRight: copy.getBoundingClientRect().right,
        transparent: getComputedStyle(frame).backgroundColor, answerLeft: answer ? answer.getBoundingClientRect().right <= frame.getBoundingClientRect().x : null };
    });
    const beforeReveal = await photoGeometry();
    expect(beforeReveal.photoX).toBeGreaterThan(beforeReveal.copyRight);
    expect(beforeReveal.transparent).toBe('rgba(0, 0, 0, 0)');
    await expect(projector.getByText('Soukromá odpověď',{exact:true})).toHaveCount(0);
    await page.getByRole('button', { name: 'Odhalit odpověď', exact: true }).click();
    await expect(projector.getByText('Soukromá odpověď', { exact: true })).toBeVisible();
    const afterReveal = await photoGeometry();
    expect(afterReveal.answerLeft).toBe(true);
    expect(afterReveal.photoX).toBe(beforeReveal.photoX);
    await page.getByRole('button', { name: 'Skrýt odpověď', exact: true }).click();
    await expect(projector.getByText('Soukromá odpověď', { exact: true })).toHaveCount(0);
    phase='moderator audio';
    await f.navigate(sessionId,4);await expect(projector.getByText('Syntetické audio',{exact:true})).toBeVisible();
    await expect(projector.locator('audio,iframe')).toHaveCount(0);
    await expect(page.locator('.moderator-audio-player')).toHaveAttribute('data-media-lifecycle', 'READY');
    await observeClipEnd(page, 2);
    await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Play',exact:true}).click();
    // A one-second clip can finish before the coalesced server report publishes "playing".
    // Observe the native player's event and first real clip-end crossing instead.
    await stoppedAtFirstCrossing(page, 2);
    await expect.poll(async()=>(await f.db.doc('sessions/'+sessionId).get()).data().mediaPlaybackState).toBe('finished');
    await page.getByRole('button',{name:'Pustit znovu',exact:true}).click();
    await expect.poll(()=>page.locator('audio').evaluate(a=>a.paused)).toBe(false);
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await expect.poll(()=>page.locator('audio').evaluate(a=>a.paused)).toBe(true);
    await expect.poll(async()=>(await f.db.doc('sessions/'+sessionId).get()).data().mediaCommand).toBe('stop');
    phase='recap audio';
    await f.navigate(sessionId,5);
    const session=(await f.db.doc('sessions/'+sessionId).get()).data();
    await f.admin.call('selectRecapQuestion',{sessionId,expectedRevision:session.revision,position:4});
    await expect(projector.locator('audio')).toHaveCount(1);
    const recapProjection = (await f.db.doc('publicSessions/'+sessionId).get()).data();
    expect(recapProjection.clipStartSeconds).toBe(1); expect(recapProjection.clipEndSeconds).toBe(2);
    await projector.locator('audio').evaluate(audio => { window.__JUSTKVIZ_RECAP_AUDIO_START__ = null; audio.addEventListener('playing', () => { window.__JUSTKVIZ_RECAP_AUDIO_START__ = audio.currentTime; }, { once: true }); });
    await observeClipEnd(projector, 2);
    // Establish a real user gesture in the projector before manual recap playback.
    await projector.locator('body').click({position:{x:10,y:10}});
    await page.getByRole('button',{name:'Play',exact:true}).click();
    await expect.poll(()=>projector.locator('audio').evaluate(a=>a.paused)).toBe(false);
    await expect.poll(()=>projector.evaluate(()=>window.__JUSTKVIZ_RECAP_AUDIO_START__)).not.toBeNull();
    const startedAt = await projector.evaluate(()=>window.__JUSTKVIZ_RECAP_AUDIO_START__);
    expect(startedAt).toBeGreaterThanOrEqual(1); expect(startedAt).toBeLessThan(1.25);
    await expect.poll(()=>projector.locator('audio').evaluate(a=>a.currentTime)).toBeGreaterThanOrEqual(2);
    await expect.poll(()=>projector.locator('audio').evaluate(a=>a.paused)).toBe(true);
    const anonymousClip = await stoppedAtFirstCrossing(projector, 2);
    expect(await projector.evaluate(()=>window.__FILMOVY_KVIZ_MEDIA_DEBUG__.peakPlayers)).toBe(1);
    await f.navigate(sessionId,6);await expect(projector.locator('audio')).toHaveCount(0);
    expect(await projector.evaluate(()=>window.__FILMOVY_KVIZ_MEDIA_DEBUG__.activePlayers)).toBe(0);
    // Separate same-profile transport phase; anonymous-context privacy/lifecycle checks above remain intact.
    await projectorContext.close(); projectorContext = undefined;
    await f.navigate(sessionId,5); const current = (await f.db.doc('sessions/'+sessionId).get()).data();
    await f.admin.call('selectRecapQuestion',{sessionId,expectedRevision:current.revision,position:4});
    const sameProfileProjector = await context.newPage(); await sameProfileProjector.goto('/projector/'+sessionId);
    await expect(sameProfileProjector.locator('audio')).toHaveCount(1);
    await sameProfileProjector.locator('body').click({position:{x:10,y:10}});
    await observeClipEnd(sameProfileProjector, 2);
    await page.getByRole('button',{name:'Play',exact:true}).click();
    await expect.poll(async()=>(await f.db.doc('sessions/'+sessionId).get()).data().mediaPlaybackState).toBe('finished');
    await expect.poll(()=>sameProfileProjector.locator('audio').evaluate(a=>a.paused)).toBe(true);
    const sameProfileClip = await stoppedAtFirstCrossing(sameProfileProjector, 2);
    console.log('NATIVE_CLIP_OBSERVATIONS '+JSON.stringify({ anonymousClip, sameProfileClip, contract: 'Paused at first real native end crossing before source EOF; no timing SLA' }));
    await f.navigate(sessionId,6); await expect(sameProfileProjector.locator('audio')).toHaveCount(0);
    expect(await sameProfileProjector.evaluate(()=>window.__FILMOVY_KVIZ_MEDIA_DEBUG__.activePlayers)).toBe(0);
    await sameProfileProjector.close();

  } catch(error) { console.error('Media browser failed during '+phase);  throw error; } finally {await projectorContext?.close();await context.close();await f.dispose();}
});

test('owned MP4 and MP3 upload, snapshot, projector video playback and offline media validation', async ({ page, context, browser }) => {
  requireFullEmulatorEnvironment(process.env, 'Owned media editor upload');
  const storagePort = localEmulatorEndpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Owned media editor upload').port;
  const f = await mediaFixture();
  try {
    const { video, mp3, audioOnlyMp4 } = await createMediaUploadFixtures();
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    let storageWrites = 0;
    context.on('response', response => {
      const url = new URL(response.url());
      if (Number(url.port) === storagePort && ['POST', 'PUT'].includes(response.request().method()) && response.ok()) storageWrites++;
    });
    await page.goto('/admin/login');
    await page.getByLabel('E-mail').fill(f.loginEmail);
    await page.getByLabel('Heslo').fill(f.loginPassword);
    await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/u);
    await page.goto('/admin/quizzes/' + f.quizId + '/edit');
    await openRounds(page);
    const picker = page.getByRole('region', { name: 'Zdroj ukázky', exact: true });
    const callResponse = name => page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/' + name));
    async function uploadFromEditor(asset) {
      const writesBefore = storageWrites;
      const beginResponse = callResponse('beginQuizMediaUpload'), finalizeResponse = callResponse('finalizeQuizMediaUpload');
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), picker.getByRole('button', { name: 'Nahrát z počítače', exact: true }).click()]);
      await chooser.setFiles(asset.filename);
      const begin = await beginResponse;
      expect(begin.ok()).toBe(true);
      expect(await begin.headerValue('cache-control')).toBe('no-store');
      const { result: grant } = await begin.json();
      expect(Object.keys(grant).sort()).toEqual(['assetId', 'path', 'reference']);
      const canonicalPath = `quiz-assets/${f.quizId}/${grant.assetId}/source`;
      expect(grant.path).toBe(asset.kind === 'video' ? `quiz-assets/${f.quizId}/${grant.assetId}/upload` : canonicalPath);
      expect(grant.reference).toBe(`quiz-asset:${f.quizId}/${grant.assetId}`);
      const finalize = await finalizeResponse;
      expect(finalize.ok()).toBe(true);
      expect(await finalize.headerValue('cache-control')).toBe('no-store');
      expect((await finalize.json()).result).toEqual({ reference: grant.reference });
      expect(storageWrites).toBeGreaterThan(writesBefore);
      await expect(picker.getByText('Ověřené médium tohoto kvízu', { exact: false })).toBeVisible();
      await expect(picker.getByRole('alert')).toHaveCount(0);
      const assetRow = (await f.quizRef.collection('mediaAssets').doc(grant.assetId).get()).data();
      const [metadata] = await f.bucket.file(canonicalPath).getMetadata();
      expect(assetRow).toMatchObject({ status: 'ready', generation: metadata.generation, kind: asset.kind, contentType: asset.contentType, size: asset.bytes.length });
      expect(metadata.generation).toMatch(/^[1-9]\d*$/u);
      if (asset.kind === 'video') {
        expect((await f.bucket.file(grant.path).exists())[0]).toBe(false);
        expect(Boolean(metadata.metadata?.firebaseStorageDownloadTokens)).toBe(false);
        expect(metadata.cacheControl).toBe('private, no-store');
      }
      const read = await f.read(grant.reference);
      expect(read.status).toBe(200);
      expect(read.headers.get('content-type')).toBe(asset.contentType);
      expect(read.headers.get('location')).toBeNull();
      expect(read.headers.get('cache-control')).toBe('no-store');
      expect(read.headers.get('x-content-type-options')).toBe('nosniff');
      const bytes = Buffer.from(await read.arrayBuffer());
      expect(bytes.length).toBe(asset.bytes.length);
      expect(mediaUploadSha256(bytes)).toBe(asset.sha256);
      return { reference: grant.reference, generation: assetRow.generation, bytes };
    }
    async function saveEditor() {
      await page.getByRole('button', { name: 'Uložit vše', exact: true }).click();
      await expect(page.locator('.save-state')).toHaveText('Uloženo');
    }
    async function setClipTiming() {
      for (const [field, value] of [['clipStartSeconds', '0:01'], ['clipEndSeconds', '0:03']]) {
        const input = page.locator(`[data-preflight-field="${field}"] input`);
        await input.fill(value);
        await input.press('Tab');
      }
    }

    const videoPrompt = 'QA vlastní MP4 otázka';
    await page.locator('.outline-round').first().getByRole('button', { name: /Další typy otázek pro kolo/u }).click();
    await page.getByRole('dialog', { name: /Typ otázky/u }).getByRole('button', { name: 'Otázka s videem', exact: true }).click();
    await page.locator('[data-preflight-field="prompt"] textarea').fill(videoPrompt);
    await page.locator('[data-preflight-field="correctAnswer"] textarea').fill('Syntetická soukromá odpověď QA');
    await expect(picker.getByLabel('Zdroj ukázky — soubor', { exact: true })).toHaveAttribute('accept', /video\/mp4/u);
    const uploadedVideo = await uploadFromEditor(video);
    await setClipTiming();
    await saveEditor();
    const videoSlide = (await f.quizRef.collection('slides').get()).docs.find(row => row.data().text === videoPrompt);
    expect(videoSlide?.data()).toMatchObject({ mediaSource: uploadedVideo.reference, clipStartSeconds: 1, clipEndSeconds: 3 });
    await page.getByRole('button', { name: 'Přehrát ukázku', exact: true }).click();
    const player = page.locator('.editor-test-player video');
    await expect.poll(() => player.evaluate(element => !element.paused && element.currentTime > 1 && element.videoWidth === 384 && element.videoHeight === 216)).toBe(true);
    await expect(page.getByText('Ukázka dohrála.', { exact: true })).toBeVisible();
    expect(await player.evaluate(element => element.paused && element.currentTime >= 3 && element.currentTime < element.duration)).toBe(true);

    await page.locator('.outline-question').filter({ hasText: 'Syntetické audio' }).click();
    const uploadedMp3 = await uploadFromEditor(mp3);
    await setClipTiming();
    await saveEditor();
    expect((await f.quizRef.collection('slides').doc(f.ids.audio).get()).data()).toMatchObject({ mediaSource: uploadedMp3.reference, clipStartSeconds: 1, clipEndSeconds: 3 });
    const snapshotId = await f.lock();
    expect((await f.db.doc(`quizSnapshots/${snapshotId}/slides/${videoSlide.id}`).get()).data()).toMatchObject({ mediaSource: uploadedVideo.reference, clipStartSeconds: 1, clipEndSeconds: 3 });
    expect((await f.db.doc(`quizSnapshots/${snapshotId}/slides/${f.ids.audio}`).get()).data().mediaSource).toBe(uploadedMp3.reference);


    const snapshotVideo = (await f.db.doc(`quizSnapshots/${snapshotId}/slides/${videoSlide.id}`).get()).data();
    const sessionId = await f.live();
    const projectorContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5198' });
    try {
      await projectorContext.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      const projector = await projectorContext.newPage();
      await projector.goto('/projector/' + sessionId);
      const projectedVideo = projector.locator('.slide-renderer video');
      const startClip = async () => {
        await f.navigate(sessionId, snapshotVideo.position);
        await expect(projector.getByText(videoPrompt, { exact: true })).toBeVisible();
        await projector.locator('body').click({ position: { x: 10, y: 10 } });
        const session = (await f.db.doc('sessions/' + sessionId).get()).data();
        await f.admin.call('playMedia', { sessionId, expectedRevision: session.revision });
        await expect.poll(() => projectedVideo.evaluate(element => !element.paused && element.currentTime > 1 && element.videoWidth === 384)).toBe(true);
        await expect.poll(() => projectedVideo.evaluate(element => element.paused && element.currentTime >= 3 && element.currentTime < element.duration)).toBe(true);
      };
      await startClip();
      await f.navigate(sessionId, snapshotVideo.position - 1);
      await expect(projectedVideo).toHaveCount(0);
      await projector.reload();
      await startClip();
    } finally {
      await projectorContext.close();
    }

    // Audio decodes in Chromium. The actual offline verifier must reject it as video.
    const decodedAudio = await verifyOfflineNativeMedia(page, { ...audioOnlyMp4, kind: 'audio' });
    expect(decodedAudio.decoded && decodedAudio.playing && decodedAudio.duration >= 4.9).toBe(true);
    const readiness = async (asset, reference, generation) => page.evaluate(async ({ descriptor, bytes }) => {
      const { verifyOfflineMedia } = await import('/src/features/offline/offlineFile.ts');
      try {
        await verifyOfflineMedia(new Blob([new Uint8Array(bytes)], { type: descriptor.contentType }), descriptor, [{ position: 1, start: 1, end: 3 }]);
        return { ready: true };
      } catch (error) { return { ready: false, message: error.message }; }
    }, { descriptor: { reference, generation, kind: asset.kind, contentType: asset.contentType, size: asset.bytes.length,
      sha256: asset.sha256, etag: 'synthetic-readiness-probe' }, bytes: [...asset.bytes] });
    expect(await readiness({ ...video, bytes: uploadedVideo.bytes }, uploadedVideo.reference, uploadedVideo.generation)).toEqual({ ready: true });
    expect(await readiness(audioOnlyMp4, uploadedVideo.reference, uploadedVideo.generation)).toEqual({ ready: false,
      message: 'Soubor MP4 neobsahuje obraz, který lze v tomto prohlížeči přehrát.' });
    console.log('OWNED_MEDIA_EDITOR_PROOF ' + JSON.stringify({ video: { codec: 'H264/AAC', bytes: video.bytes.length, sha256: video.sha256 },
      mp3: { bytes: mp3.bytes.length, sha256: mp3.sha256 }, actualStorageWrites: storageWrites, attachedAndLocked: true,
      audioOnlyMp4DecodedAsAudioAndRejectedAsVideo: true }));
  } finally { await context.close(); await f.dispose(); }
});
