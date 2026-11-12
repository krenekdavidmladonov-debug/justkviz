/* global document, window, getComputedStyle */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance as clock } from 'node:perf_hooks';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { mediaSlide, syntheticImage } from '../e2e/media-fixture.mjs';

const phase = process.env.EDITOR_SIMPLICITY_PHASE || 'current';
const out = '.local-data/editor-simplicity/' + phase;
const prompt = page => page.getByLabel('Otázka *', { exact: true });
const answer = page => page.getByLabel('Správná odpověď *', { exact: true });
const round = (page, index) => page.locator('.outline-round').nth(index);
const summary = values => { const s = [...values].sort((a,b) => a-b); return { n:s.length, medianMs:s[Math.floor(s.length/2)], p95Ms:s[Math.ceil(s.length*.95)-1], maxMs:s.at(-1) }; };

test('A–E real browser workflows and larger synthetic quiz comparison', async ({ page, context, browser }) => {
  const identity = await editorIdentity(), quizzes = [], events = [], snapshots = [], errors = [], requests = [];
  const metrics = { phase, source:phase === 'baseline' ? 'ba6bf41 archived web source' : 'integrated working tree', environment:'same machine, production Vite build, pinned Chromium, demo-editor-simplicity real Auth/Firestore/Functions/Storage emulators', method:'Each click, fill, select, upload or drag is one interaction. Timings are automated interaction-to-observable-result wall times, not human completion times. Waits count interactions over 300 ms. No network transport mocked.', scenarios:{}, performance:{} };
  let current;
  async function step(label, action) { const start=clock.now(); await action(); current.steps.push({ label, ms:clock.now()-start }); }
  async function scenario(name, action) { current={steps:[]}; const start=clock.now(); await action(); metrics.scenarios[name]={ interactions:current.steps.length, elapsedMs:clock.now()-start, waitsOver300ms:current.steps.filter(s=>s.ms>300).length, steps:current.steps }; }
  async function save() { await step('Uložit',async()=>{await page.getByRole('button',{name:'Uložit vše',exact:true}).click();await expect(page.locator('.save-state')).toHaveText('Uloženo');}); }
  async function addQuestion(index) {
    await step('Přidat otázku',async()=>{await round(page,index).getByRole('button',{name:/^\+?\s*Přidat otázku$/,exact:false}).click();});
    if(phase==='baseline') await step('Vybrat volnou odpověď',async()=>page.getByRole('dialog',{name:/Typ otázky/}).getByRole('button',{name:'Volná odpověď',exact:true}).click());
    await expect(prompt(page)).toBeVisible();
  }
  await mkdir(out,{recursive:true});
  await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  page.on('pageerror',e=>errors.push(e.message));
  context.on('response',r=>{if(r.url().includes(':5001/')&&r.request().method()==='POST')requests.push({endpoint:r.url().split('/').at(-1),status:r.status()});});
  try {
    await page.goto('/admin/login'); await page.getByLabel('E-mail').fill(identity.email); await page.getByLabel('Heslo').fill(identity.password); await page.getByRole('button',{name:'Přihlásit se',exact:true}).click(); await expect(page).toHaveURL(/\/admin$/);
    let quizId;
    await page.goto('/admin/quizzes');
    await scenario('A-create-2-rounds-10-questions',async()=>{
      await step('Nový kvíz',()=>page.getByRole('link',{name:'+ Nový kvíz',exact:true}).first().click());
      await step('Název kvízu',()=>page.getByLabel('Název kvízu').fill('Filmový večer – '+phase));
      await step('Vytvořit',async()=>{await page.getByRole('button',{name:'Vytvořit',exact:true}).click();await expect(page).toHaveURL(/\/edit$/);}); quizId=page.url().split('/').at(-2); quizzes.push(quizId);
      for(let r=0;r<2;r++){
        await step('Přidat kolo',async()=>{await page.getByRole('button',{name:/^\+?\s*Přidat kolo$/}).click();await expect(page.locator('.outline-round')).toHaveCount(r+1);});
        await step('Název kola',()=>page.getByLabel('Název kola *').fill('Filmové kolo '+(r+1))); await save();
        for(let q=0;q<5;q++){
          await addQuestion(r);
          await step('Zadání otázky',()=>prompt(page).fill(`Kolo ${r+1}: Kdo natočil film číslo ${q+1}?`));
          await step('Správná odpověď',()=>answer(page).fill('Režisér '+(q+1))); await save();
        }
      }
      await expect(page.locator('.outline-question')).toHaveCount(10);
      expect((await identity.db.collection('quizzes/'+quizId+'/slides').get()).docs.filter(d=>d.data().isQuestion)).toHaveLength(10);
      const openAdvanced=await page.locator('details.editor-extra[open]').evaluateAll(nodes=>nodes.map(n=>n.querySelector('summary')?.textContent)); metrics.scenariosAOpenAdvanced=openAdvanced;
      await page.screenshot({path:out+'/A-editor-desktop.png',fullPage:true});
    });
    await scenario('B-edit-prompt-answer-image-save',async()=>{
      await step('Vybrat otázku',()=>page.locator('.outline-question').first().click());
      await step('Změnit zadání',()=>prompt(page).fill('Kdo režíroval film Amadeus?'));
      await step('Změnit odpověď',()=>answer(page).fill('Miloš Forman'));
      if(phase==='baseline') await step('Zvolit obrázek',()=>page.getByLabel('Způsob zadání').selectOption('image'));
      else await step('Přidat obrázek',()=>page.getByRole('button',{name:/^Přidat obrázek$/,exact:false}).click());
      await step('Nahrát obrázek',async()=>{await page.getByLabel('Obrázek otázky — soubor',{exact:true}).setInputFiles({name:'synthetic-film.png',mimeType:'image/png',buffer:syntheticImage()});await expect(page.getByRole('button',{name:'Zrušit nahrávání'})).toHaveCount(0);});
      await save(); await page.screenshot({path:out+'/B-question-image.png',fullPage:true});
    });
    await scenario('C-add-round-reorder-round-cross-round-question-save',async()=>{
      await step('Přidat kolo',async()=>{await page.getByRole('button',{name:/^\+?\s*Přidat kolo$/}).click();await expect(page.locator('.outline-round')).toHaveCount(3);});
      await step('Název kola',()=>page.getByLabel('Název kola *').fill('Bonusové kolo')); await save();
      if(phase==='baseline') await step('Posunout kolo nahoru',()=>page.getByRole('button',{name:'Přesunout nahoru',exact:true}).click());
      else {
        const source=round(page,2).getByRole('button',{name:/^Přetáhnout kolo/});
        await step('Přetáhnout kolo',async()=>{await source.dragTo(round(page,1).locator('.outline-round-header'),{targetPosition:{x:50,y:5}});await expect(round(page,1).locator('.outline-round-select strong')).toHaveText('Bonusové kolo');await expect(page.locator('.editor-outline')).toHaveAttribute('aria-busy','false');});
      }
      await expect(round(page,1)).toContainText('Bonusové kolo');
      await step('Vybrat otázku',async()=>{await page.locator('.outline-question').first().click();await expect(prompt(page)).toHaveValue('Kdo režíroval film Amadeus?');});
      if(phase==='baseline') await step('Přesunout otázku do jiného kola',()=>page.getByLabel('Přesunout do kola').selectOption({label:'2. kolo – Bonusové kolo'}));
      else await step('Přetáhnout otázku do jiného kola',async()=>{await page.locator('li[data-question-id]').first().getByRole('button',{name:/^Přetáhnout otázku/}).dragTo(round(page,1).locator('.outline-round-header'),{targetPosition:{x:80,y:30}});await expect(round(page,1).locator('.outline-question')).toContainText('Kdo režíroval film Amadeus?');await expect(page.locator('.editor-outline')).toHaveAttribute('aria-busy','false');});
      await expect(round(page,1)).toContainText('Kdo režíroval film Amadeus?');
      await page.screenshot({path:out+'/C-outline.png',fullPage:true});
    });
    const eventId=(await identity.call('createEvent',{expectedRevision:0,event:{title:'Syntetická zkouška '+phase,startsAt:'2031-11-20T18:00:00Z',timeZone:'Europe/Prague',venue:{name:'Syntetický sál',publicLocation:'Praha'},teamCapacity:30,peopleCapacity:120,teamSizeMin:2,teamSizeMax:6}})).eventId; events.push(eventId);
    await scenario('D-check-and-prepare-event',async()=>{
      if(phase==='baseline') await step('Zkontrolovat kvíz',()=>page.getByRole('button',{name:'Zkontrolovat kvíz',exact:true}).click());
      else await expect(page.locator('.readiness-chip')).toContainText('Připraveno');
      await step('Otevřít akci',async()=>{await page.goto('/admin/events/'+eventId);await expect(page.getByRole('combobox',{name:/^Kvíz/})).toBeVisible();});
      await step('Vybrat kvíz',async()=>{await page.getByRole('combobox',{name:/^Kvíz/}).selectOption(quizId);await expect(page.locator('.event-readiness')).toBeVisible();});
      const warning=page.getByLabel('Potvrzuji upozornění pro tuto verzi kvízu.'); if(await warning.count()) await step('Potvrdit doporučení',()=>warning.check());
      await step('Připravit ke hraní',async()=>{await page.getByRole('button',{name:/^(Zkontrolovat a připravit|Připravit ke hraní|Připravit kvíz)$/}).click();await expect(page.getByText(phase==='baseline'?'Kvíz byl zkontrolován a připraven.':'Kvíz je připraven ke hraní.',{exact:true})).toBeVisible();});
      const assignment=(await identity.db.doc('events/'+eventId).get()).get('quizAssignment'); snapshots.push(assignment.snapshotId); await page.screenshot({path:out+'/D-prepared-event.png',fullPage:true});
    });
    await page.goto('/admin/events');
    await scenario('E-soft-delete-event-one-confirmation',async()=>{
      const card=page.locator('.event-card').filter({hasText:'Syntetická zkouška '+phase});
      if(phase==='baseline') { await step('Možnosti akce',()=>card.locator('summary').click()); await step('Přesunout do koše',()=>card.getByRole('button',{name:'Přesunout do koše',exact:true}).click()); }
      else await step('Smazat z přehledu',()=>card.getByRole('button',{name:'Smazat',exact:true}).click());
      const dialog=page.getByRole('dialog'); await expect(dialog).toBeVisible(); expect(await dialog.locator('input,textarea,select').count()).toBe(0); await page.screenshot({path:out+'/E-delete-confirmation.png'});
      await step('Potvrdit smazání akce',async()=>{await dialog.getByRole('button',{name:phase==='baseline'?'Přesunout do koše':'Smazat akci',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(card).toHaveCount(0);});
      expect((await identity.db.doc('events/'+eventId).get()).get('disposition')).toBe('trash'); expect((await identity.db.doc('quizSnapshots/'+snapshots[0]).get()).exists).toBe(true);
    });
    // Separate 60-question fixture is generated locally; no migrated/production content is read.
    const largeId='simplicity-large-'+randomUUID(); quizzes.push(largeId);const ref=identity.db.doc('quizzes/'+largeId),batch=identity.db.batch();
    batch.set(ref,{title:'Větší syntetický filmový kvíz',description:'60 otázek, 6 kol; pouze lokální QA',revision:0,slideCount:72,questionCount:60,roundCount:6,status:'draft',createdAt:new Date(),updatedAt:new Date()});
    for(let r=0;r<6;r++){
      const rid='r'+r;batch.set(ref.collection('rounds').doc(rid),{title:'Filmové kolo '+(r+1),position:r+1,type:'classic',questionCount:10});
      batch.set(ref.collection('slides').doc('round'+r),{...mediaSlide('round'),position:r*12+1,roundId:rid,isQuestion:false,title:'Filmové kolo '+(r+1)});
      for(let q=0;q<10;q++)batch.set(ref.collection('slides').doc('q'+(r*10+q)),{...mediaSlide('free',{text:'Filmová otázka '+(r*10+q+1),correctAnswer:'Soukromá odpověď '+q,authoringStatus:'ready',answerMode:'open'}),position:r*12+q+2,roundId:rid,isQuestion:true,questionNumber:q+1,questionCount:10});
      batch.set(ref.collection('slides').doc('recap'+r),{...mediaSlide('recap'),position:r*12+12,roundId:rid,isQuestion:false});
    }await batch.commit();
    const navigation=[],selection=[],typing=[],saving=[];
    for(let i=0;i<5;i++){const t=clock.now();await page.goto('/admin/quizzes/'+largeId+'/edit');await expect(page.locator('.outline-round')).toHaveCount(6);if(phase==='current')for(let r=0;r<6;r++){const toggle=round(page,r).locator('.outline-collapse');if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();}await expect(page.locator('.outline-question')).toHaveCount(60);navigation.push(clock.now()-t);}
    metrics.largeQuizMethod='All six rounds explicitly expanded for original all-expanded comparison; navigation includes expansion interactions where required. Separate performance-default-round.json measures the compact default workflow.';
    for(let i=0;i<24;i++){
      const index=i*17%60,t=clock.now();await page.locator('.outline-question').nth(index).click();await expect(prompt(page)).toHaveValue('Filmová otázka '+(index+1));selection.push(clock.now()-t);
      const inputStart=clock.now();await prompt(page).fill('Filmová otázka '+(index+1)+' upravena');await expect(prompt(page)).toHaveValue('Filmová otázka '+(index+1)+' upravena');typing.push(clock.now()-inputStart);
      const saveStart=clock.now();await page.getByRole('button',{name:'Uložit vše',exact:true}).click();await expect(page.locator('.save-state')).toHaveText('Uloženo');saving.push(clock.now()-saveStart);
    }
    metrics.performance={fixture:{rounds:6,questions:60,slides:72},navigation:summary(navigation),selection:summary(selection),typing:summary(typing),save:summary(saving),samples:{navigation,selection,typing,saving}};
    metrics.performance.cursors=await page.locator('.editor-outline, .outline-round, .outline-question, .outline-drag-handle,button:disabled').evaluateAll(nodes=>nodes.slice(0,20).map(node=>({className:node.className,cursor:getComputedStyle(node).cursor})));
    await page.screenshot({path:out+'/large-quiz-desktop.png',fullPage:true});
    for(const width of [1024,390]){await page.setViewportSize({width,height:width===390?844:900});await page.screenshot({path:out+'/editor-'+width+'.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);}
    metrics.browser=browser.version();metrics.pageErrors=errors;metrics.callables=requests;expect(errors).toEqual([]);metrics.status='PASS';
  } catch(error) {metrics.status='FAIL';metrics.error=error.message;metrics.pageErrors=errors;await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});await writeFile(out+'/failure-body.txt',await page.locator('body').innerText());throw error;
  } finally {
    await writeFile(out+'/measurements.json',JSON.stringify(metrics,null,2));
    for(const id of events){await identity.db.recursiveDelete(identity.db.doc('events/'+id));await identity.db.doc('publicEvents/'+id).delete();}
    for(const id of snapshots)await identity.db.recursiveDelete(identity.db.doc('quizSnapshots/'+id));
    for(const id of quizzes)await identity.db.recursiveDelete(identity.db.doc('quizzes/'+id));
    await identity.dispose();
  }
});

test('settled overview and current draft readiness, direct fix, preview and next question',async({page,context})=>{
  const identity=await editorIdentity(),id='simplicity-overview-'+randomUUID(),ref=identity.db.doc('quizzes/'+id),batch=identity.db.batch(),errors=[];
  await mkdir(out,{recursive:true});
  await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  page.on('pageerror',e=>errors.push(e.message));
  batch.set(ref,{title:'Filmový večer',description:'Dvě kola filmových otázek',revision:0,slideCount:14,questionCount:10,roundCount:2,status:'draft',createdAt:new Date(),updatedAt:new Date()});
  for(let r=0;r<2;r++){
    const rid='r'+r;batch.set(ref.collection('rounds').doc(rid),{title:r===0?'Filmoví tvůrci':'Slavné filmové příběhy',position:r+1,type:'classic',questionCount:5});
    batch.set(ref.collection('slides').doc('round'+r),{...mediaSlide('round'),position:r*7+1,roundId:rid,isQuestion:false,title:r===0?'Filmoví tvůrci':'Slavné filmové příběhy'});
    for(let q=0;q<5;q++)batch.set(ref.collection('slides').doc('q'+(r*5+q)),{...mediaSlide('free',{text:r===0&&q===0?'Kdo režíroval film Amadeus?':`Filmová otázka ${r*5+q+1}`,correctAnswer:r===0&&q===0?'Miloš Forman':'Soukromá odpověď',authoringStatus:'ready',answerMode:'open'}),position:r*7+q+2,roundId:rid,isQuestion:true,questionNumber:q+1,questionCount:5});
    batch.set(ref.collection('slides').doc('recap'+r),{...mediaSlide('recap'),position:r*7+7,roundId:rid,isQuestion:false});
  }await batch.commit();
  try{
    await page.goto('/admin/login');await page.getByLabel('E-mail').fill(identity.email);await page.getByLabel('Heslo').fill(identity.password);await page.getByRole('button',{name:'Přihlásit se',exact:true}).click();await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/quizzes/'+id+'/edit');if(phase==='current')await round(page,0).locator('.outline-round-select').click();await page.locator('.outline-question').first().click();await expect(prompt(page)).toHaveValue('Kdo režíroval film Amadeus?');
    if(phase==='current')await expect(page.locator('.readiness-chip')).toHaveText('Připraveno');
    await page.evaluate(()=>{window.scrollTo(0,0);for(const element of document.querySelectorAll('.editor-outline,.round-editor-content,.round-editor-preview'))element.scrollTop=0;});
    await page.screenshot({path:out+'/editor-overview.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/editor-overview-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    if(phase==='current'){await page.getByRole('button',{name:'Struktura',exact:true}).click();await page.screenshot({path:out+'/editor-outline-mobile.png',fullPage:true});await page.getByRole('button',{name:'Obsah',exact:true}).click();}
    await page.setViewportSize({width:1440,height:900});
    if(phase==='baseline')return;
    await answer(page).fill('');await expect(page.locator('.readiness-chip')).toHaveText('Rozpracováno');await page.locator('.readiness-chip').click();
    const missing=page.locator('.editor-preflight-shell [data-issue-code="ANSWER_MISSING"]');await expect(missing).toBeVisible();await missing.getByRole('button',{name:'Opravit',exact:true}).click();await expect(answer(page)).toBeFocused();await expect(answer(page)).toHaveValue('');
    await answer(page).fill('Miloš Forman');await page.getByRole('button',{name:'Uložit vše',exact:true}).click();await expect(page.locator('.save-state')).toHaveText('Uloženo');await expect(page.locator('.readiness-chip')).toHaveText('Připraveno');
    await page.getByRole('button',{name:'Zvětšit náhled',exact:true}).click();const preview=page.getByRole('dialog',{name:'Zvětšený náhled projekce'});await expect(preview).toContainText('Kdo režíroval film Amadeus?');await expect(preview).not.toContainText('Miloš Forman');await page.screenshot({path:out+'/expanded-preview.png'});await page.keyboard.press('Escape');await expect(preview).toHaveCount(0);await expect(page.getByRole('button',{name:'Zvětšit náhled',exact:true})).toBeFocused();
    await page.getByRole('button',{name:'Uložit a přidat další',exact:true}).click();await expect(prompt(page)).toHaveValue('');await expect(answer(page)).toHaveValue('');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(prompt(page)).toBeFocused();await prompt(page).fill('Další otázka bez výběru typu');await answer(page).fill('Další odpověď');await page.getByRole('button',{name:'Uložit vše',exact:true}).click();await expect(page.locator('.save-state')).toHaveText('Uloženo');await expect.poll(async()=>(await ref.collection('slides').get()).docs.filter(d=>d.data().isQuestion).length).toBe(11);await expect(page.locator('.readiness-chip')).toHaveText('Připraveno');
    const saved=(await ref.collection('slides').get()).docs.map(d=>d.data()).find(s=>s.text==='Další otázka bez výběru typu');expect(saved.correctAnswer).toBe('Další odpověď');expect(saved.authoringStatus).toBe('ready');expect(errors).toEqual([]);
    await writeFile(out+'/reliability.json',JSON.stringify({status:'PASS',dirtyDraftAutomaticValidation:true,missingAnswerDirectFixAndFocus:true,savedRevisionReturnsReady:true,expandedProjectionPreviewAndEscapeFocus:true,unrevealedAnswerAbsentFromPreview:true,saveNextCreatesDirectFreeQuestion:true,pageErrors:errors},null,2));
  }finally{await identity.db.recursiveDelete(ref);await identity.dispose();}
});

test('focused default active round responsiveness on 60 question fixture',async({page,context,browser})=>{
  const identity=await editorIdentity(),id='simplicity-active-round-'+randomUUID(),ref=identity.db.doc('quizzes/'+id),batch=identity.db.batch();
  await mkdir(out,{recursive:true});await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  batch.set(ref,{title:'Větší syntetický filmový kvíz',description:'Lokální QA 6 kol a 60 otázek',revision:0,slideCount:72,questionCount:60,roundCount:6,status:'draft',createdAt:new Date(),updatedAt:new Date()});
  for(let r=0;r<6;r++){
    const rid='r'+r;batch.set(ref.collection('rounds').doc(rid),{title:'Filmové kolo '+(r+1),position:r+1,type:'classic',questionCount:10});
    batch.set(ref.collection('slides').doc('round'+r),{...mediaSlide('round'),position:r*12+1,roundId:rid,isQuestion:false,title:'Filmové kolo '+(r+1)});
    for(let q=0;q<10;q++)batch.set(ref.collection('slides').doc('q'+(r*10+q)),{...mediaSlide('free',{text:'Filmová otázka '+(r*10+q+1),correctAnswer:'Soukromá odpověď '+q,authoringStatus:'ready',answerMode:'open'}),position:r*12+q+2,roundId:rid,isQuestion:true,questionNumber:q+1,questionCount:10});
    batch.set(ref.collection('slides').doc('recap'+r),{...mediaSlide('recap'),position:r*12+12,roundId:rid,isQuestion:false});
  }await batch.commit();
  try{
    await page.goto('/admin/login');await page.getByLabel('E-mail').fill(identity.email);await page.getByLabel('Heslo').fill(identity.password);await page.getByRole('button',{name:'Přihlásit se',exact:true}).click();await expect(page).toHaveURL(/\/admin$/);
    const navigation=[],selection=[],typing=[],saving=[],labels=new Map();
    for(let i=0;i<5;i++){const t=clock.now();await page.goto('/admin/quizzes/'+id+'/edit');await expect(page.locator('.outline-round')).toHaveCount(6);navigation.push(clock.now()-t);}
    const initialRows=await page.locator('.outline-question').count(),openStart=clock.now();
    if(phase==='current')await round(page,0).locator('.outline-round-select').click();else await round(page,0).getByRole('button',{name:'Úvod a vzhled kola',exact:true}).click();
    await expect(round(page,0).locator('.outline-question')).toHaveCount(10);const openRoundMs=clock.now()-openStart,editingRows=await page.locator('.outline-question').count();
    for(let i=0;i<24;i++){
      const index=i*7%10,label=labels.get(index)||'Filmová otázka '+(index+1),t=clock.now();await page.locator('li[data-question-id="q'+index+'"] .outline-question').click();await expect(prompt(page)).toHaveValue(label);selection.push(clock.now()-t);
      const revised=label+' upravena',inputStart=clock.now();await prompt(page).fill(revised);await expect(prompt(page)).toHaveValue(revised);typing.push(clock.now()-inputStart);
      const saveStart=clock.now();await page.getByRole('button',{name:'Uložit vše',exact:true}).click();await expect(page.locator('.save-state')).toHaveText('Uloženo');saving.push(clock.now()-saveStart);labels.set(index,revised);
    }
    const result={phase,status:'PASS',browser:browser.version(),method:'Same 60-question/6-round fixture. Five warmed navigations, then one measured round selection in each version. Twenty-four question selection/input/save samples within that already active first round. Baseline default has all 60 rows rendered; current default renders only active round 10 rows. Original all-expanded benchmark remains in measurements-all-expanded.json; this is a separate default-workflow comparison.',initialRows,editingRows,openRoundMs,navigation:summary(navigation),selection:summary(selection),typing:summary(typing),save:summary(saving),samples:{navigation,selection,typing,saving}};
    await writeFile(out+'/performance-default-round.json',JSON.stringify(result,null,2));
    if(phase==='current')await expect(page.locator('.readiness-chip')).toHaveText('Připraveno');await page.screenshot({path:out+'/large-quiz-default-round.png',fullPage:true});
  }finally{await identity.db.recursiveDelete(ref);await identity.dispose();}
});
