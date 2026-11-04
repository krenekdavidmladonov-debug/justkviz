/* global window, getComputedStyle */
import { test, expect } from '@playwright/test';
import { mediaFixture, syntheticImage, syntheticAudio } from '../e2e/media-fixture.mjs';
async function openRounds(page) { await expect(page.locator('.outline-round').first()).toBeVisible(); while (await page.locator('.outline-collapse[aria-expanded="false"]').count()) await page.locator('.outline-collapse[aria-expanded="false"]').first().click(); }

async function observeClipEnd(page, endSeconds) {
  await expect.poll(() => page.locator('audio').evaluate(audio => typeof audio.ontimeupdate)).toBe('function');
  await page.locator('audio').evaluate((audio, end) => {
    window.__JUSTKVIZ_CLIP_END__ = null; window.__JUSTKVIZ_CLIP_MAX__ = audio.currentTime;
    audio.addEventListener('timeupdate', () => {
      const time = audio.currentTime; window.__JUSTKVIZ_CLIP_MAX__ = Math.max(window.__JUSTKVIZ_CLIP_MAX__, time);
      if (time >= end && window.__JUSTKVIZ_CLIP_END__ === null) window.__JUSTKVIZ_CLIP_END__ = { time, duration: audio.duration, paused: audio.paused };
    });
  }, endSeconds);
}
async function stoppedAtFirstCrossing(page, endSeconds) {
  await expect.poll(() => page.evaluate(() => window.__JUSTKVIZ_CLIP_END__)).not.toBeNull();
  const sample = await page.evaluate(() => window.__JUSTKVIZ_CLIP_END__);
  expect(Number.isFinite(sample.time) && Number.isFinite(sample.duration)).toBe(true);
  expect(sample.time).toBeGreaterThanOrEqual(endSeconds); expect(sample.time).toBeLessThan(sample.duration); expect(sample.paused).toBe(true);
  expect(await page.evaluate(() => window.__JUSTKVIZ_CLIP_MAX__)).toBeLessThanOrEqual(sample.time);
  await expect(page.locator('[data-media-lifecycle]')).toHaveAttribute('data-media-lifecycle', 'FINISHED');
  await expect(page.locator('.projector-media-error')).toHaveCount(0);
  return sample;
}

test('synthetic owned image/audio upload, editor preview, immutable projector image and manual audio lifecycle', async ({page,context,browser}) => {
  const f=await mediaFixture();let projectorContext, unsubscribe, phase='login';
  const playbackStates=[];
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
    await f.lock();const sessionId=await f.live();
    await new Promise((resolve,reject)=>{unsubscribe=f.db.doc('sessions/'+sessionId).onSnapshot(snapshot=>{playbackStates.push(snapshot.data()?.mediaPlaybackState);resolve();},reject);});
    await f.navigate(sessionId,3);
    await page.goto('/admin/live/'+sessionId);
    projectorContext=await browser.newContext({baseURL:'http://127.0.0.1:5198',viewport:{width:1280,height:720}});
    await projectorContext.route('**/*',localOnly);const projector=await projectorContext.newPage();
    await projector.goto('/projector/'+sessionId);
    const projected=projector.locator('.question-image-frame img');
    await expect.poll(()=>projected.evaluate(img=>img.naturalWidth)).toBe(8);
    expect(await projected.evaluate(img=>getComputedStyle(img).objectFit)).toBe('contain');

    await expect(projector.getByText('Soukromá odpověď',{exact:true})).toHaveCount(0);
    phase='moderator audio';
    await f.navigate(sessionId,4);await expect(projector.getByText('Syntetické audio',{exact:true})).toBeVisible();
    await expect(projector.locator('audio,iframe')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Play',exact:true}).click();
    await expect.poll(()=>playbackStates).toContain('playing');
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

  } catch(error) { console.error('Media browser failed during '+phase);  throw error; } finally {unsubscribe?.();await projectorContext?.close();await context.close();await f.dispose();}
});
