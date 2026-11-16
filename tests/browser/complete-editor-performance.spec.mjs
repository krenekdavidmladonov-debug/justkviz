/* global window, document, MutationObserver */
import {test,expect} from '@playwright/test';
import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {editorIdentity} from '../e2e/editor-identity.mjs';
import {mediaSlide} from '../e2e/media-fixture.mjs';
// A separate synthetic load fixture, never evidence of UI authoring.
const panel=async(page,name)=>{const tab=page.getByRole('button',{name,exact:true});if(await tab.isVisible())await tab.click();};
test('measure 60 and 180 question libraries, preview response and active players',async({page,context})=>{
  const identity=await editorIdentity(),results=[];let quizId;
  await context.addInitScript(()=>{window.__JUSTKVIZ_EDITOR_MEDIA_OBSERVATIONS__=[];window.__JUSTKVIZ_EDITOR_MEDIA_DOM_PEAK__=0;new MutationObserver(()=>{const players=[...document.querySelectorAll('video,audio,iframe')];window.__JUSTKVIZ_EDITOR_MEDIA_DOM_PEAK__=Math.max(window.__JUSTKVIZ_EDITOR_MEDIA_DOM_PEAK__,players.length);if(players.length>1&&window.__JUSTKVIZ_EDITOR_MEDIA_OBSERVATIONS__.length<12)window.__JUSTKVIZ_EDITOR_MEDIA_OBSERVATIONS__.push({count:players.length,diagnostics:{...window.__FILMOVY_KVIZ_MEDIA_DEBUG__},players:players.map(player=>({tag:player.tagName,inTimingEditor:Boolean(player.closest('.media-timing-editor')),inProjection:Boolean(player.closest('.round-editor-preview')),lifecycle:player.closest('[data-media-lifecycle]')?.getAttribute('data-media-lifecycle')}))});}).observe(document,{childList:true,subtree:true});});
  await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  const video=await readFile('tests/fixtures/media/synthetic.webm');await context.route('**/qa.webm',route=>route.fulfill({contentType:'video/webm',body:video}));
  try {
    await page.goto('/admin/login');await page.getByLabel('E-mail').fill(identity.email);await page.getByLabel('Heslo').fill(identity.password);await page.getByRole('button',{name:'Přihlásit se'}).click();await expect(page).toHaveURL(/\/admin$/);
    for(const count of [60,180]) {
      quizId='performance-'+randomUUID();const ref=identity.db.doc('quizzes/'+quizId),batch=identity.db.batch();
      batch.set(ref,{title:'Synthetic performance '+count,description:'Technical performance fixture only',revision:0,slideCount:count+2,questionCount:count,roundCount:1,status:'draft',createdAt:new Date(),updatedAt:new Date()});
      batch.set(ref.collection('rounds').doc('r1'),{title:'Load round',position:1,questionCount:count});
      batch.set(ref.collection('slides').doc('round'),{...mediaSlide('round'),position:1,roundId:'r1',isQuestion:false,title:'Load round'});
      for(let i=0;i<count;i++)batch.set(ref.collection('slides').doc('q'+i),{...mediaSlide(i%3===0?'video':'free',{text:'Synthetic load question '+i,correctAnswer:'Private synthetic answer',mediaSource:i%3===0?'http://127.0.0.1:5198/qa.webm':'',clipStartSeconds:i%3===0?1:null,clipEndSeconds:i%3===0?3:null,authoringStatus:'ready',answerMode:'open'}),position:i+2,roundId:'r1',isQuestion:true,questionNumber:i+1,questionCount:count});
      batch.set(ref.collection('slides').doc('recap'),{...mediaSlide('recap'),position:count+2,roundId:'r1',isQuestion:false});await batch.commit();
      let start=performance.now();await page.goto('/admin/quizzes/'+quizId+'/edit');await page.getByRole('button',{name:'Rozbalit kolo Load round',exact:true}).click();await expect(page.locator('.outline-question')).toHaveCount(count);const loadMs=performance.now()-start,selectionMs=[],previewMs=[],saveMs=[],labels=new Map(),workStarted=performance.now();
      for(let i=0;i<(count===60?120:48);i++){
        const index=(i*17)%count;const label=labels.get(index)??'Synthetic load question '+index;start=performance.now();const selectedAt=start;await page.locator('.outline-question').nth(index).click();await expect(page.getByRole('textbox',{name:'Otázka *',exact:true})).toHaveValue(label);selectionMs.push(performance.now()-start);
        start=selectedAt;await panel(page,'Náhled');await expect(page.locator('.round-editor-preview .slide-copy')).toContainText(label);await expect(page.locator('.round-editor-preview')).toBeVisible();previewMs.push(performance.now()-start);await panel(page,'Obsah');
        if(i%10===0){const next=label+' edit';start=performance.now();await page.getByRole('textbox',{name:'Otázka *',exact:true}).fill(next);await page.getByRole('button',{name:'Uložit vše',exact:true}).click();await expect(page.locator('.save-state')).toHaveText('Uloženo');saveMs.push(performance.now()-start);labels.set(index,next);}
        expect(await page.locator('video,audio,iframe').count()).toBeLessThanOrEqual(1);
      }
      const players=await page.evaluate(()=>window.__FILMOVY_KVIZ_MEDIA_DEBUG__);if(players.peakPlayers>1)console.log('Media lifecycle observations:',JSON.stringify(await page.evaluate(()=>({diagnostics:window.__FILMOVY_KVIZ_MEDIA_DEBUG__,observations:window.__JUSTKVIZ_EDITOR_MEDIA_OBSERVATIONS__}))));expect(players.peakPlayers).toBeLessThanOrEqual(1);const observedPeakPlayers=await page.evaluate(()=>window.__JUSTKVIZ_EDITOR_MEDIA_DOM_PEAK__);expect(observedPeakPlayers).toBeLessThanOrEqual(1);
      await page.getByRole('link',{name:'← Knihovna kvízů'}).click();await expect.poll(()=>page.evaluate(()=>window.__FILMOVY_KVIZ_MEDIA_DEBUG__?.activePlayers??0)).toBe(0);
      results.push({questions:count,loadMs,selectionMs,previewMs,saveMs,workDurationMs:performance.now()-workStarted,players,observedPeakPlayers});await identity.db.recursiveDelete(ref);quizId=undefined;
    }
    await mkdir('.local-data/complete-editor',{recursive:true});await writeFile('.local-data/complete-editor/performance.json',JSON.stringify({previewMetric:'Selection to ready projection; desktop shows content and preview side by side',source:'separate synthetic fixture; Chromium/Vite/local emulators; 120 / 48 selections and previews plus 12 / 5 real saves',results},null,2));
  }finally{if(quizId)await identity.db.recursiveDelete(identity.db.doc('quizzes/'+quizId));await identity.dispose();}
});
