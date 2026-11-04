import { test, expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { mediaFixture, syntheticImage, syntheticAudio } from '../e2e/media-fixture.mjs';

const imageFile = () => ({ name:'qa.png', mimeType:'image/png', buffer:syntheticImage() });
const audioFile = () => ({ name:'qa.wav', mimeType:'audio/wav', buffer:syntheticAudio(5) });
const picker = (page,label) => page.getByRole('region',{name:label,exact:true});
const background = page => page.locator('details.editor-extra[data-preflight-field="backgroundImage"] .slide-design-editor').getByRole('region',{name:/^Pozadí · (děděné|vlastní)$/,exact:true});
const extras = async page => { const answer=page.locator('details.editor-extra').filter({has:page.locator('summary').filter({hasText:'Odpověď po odhalení'})}); if(await answer.count() && await answer.getAttribute('open')===null)await answer.locator(':scope > summary').click(); const design=page.locator('details.editor-extra[data-preflight-field="backgroundImage"]'); await expect(design).toHaveCount(1); if(await design.getAttribute('open')===null)await design.locator(':scope > summary').click(); };
const save = async page => { await page.getByRole('button',{name:'Uložit vše',exact:true}).click(); await expect(page.locator('.save-state')).toHaveText('Uloženo'); };
const questionText = page => page.locator('[data-preflight-field="prompt"] textarea');
const timing = async page => { await page.locator('[data-preflight-field="clipStartSeconds"] input').fill('0:01'); await page.locator('[data-preflight-field="clipStartSeconds"] input').press('Tab'); await page.locator('[data-preflight-field="clipEndSeconds"] input').fill('0:03'); await page.locator('[data-preflight-field="clipEndSeconds"] input').press('Tab'); await expect(page.locator('[data-preflight-field="clipStartSeconds"] input')).toHaveValue('0:01'); await expect(page.locator('[data-preflight-field="clipEndSeconds"] input')).toHaveValue('0:03'); };
async function openRounds(page) { await expect(page.locator('.outline-round').first()).toBeVisible(); while (await page.locator('.outline-collapse[aria-expanded="false"]').count()) await page.locator('.outline-collapse[aria-expanded="false"]').first().click(); }

async function start(page,f) { await page.goto('/admin/login'); await page.getByLabel('E-mail').fill(f.loginEmail); await page.getByLabel('Heslo').fill(f.loginPassword); await page.getByRole('button',{name:'Přihlásit se'}).click(); await expect(page).toHaveURL(/\/admin$/); await page.goto('/admin/quizzes/'+f.quizId+'/edit'); await openRounds(page); }
async function newQuestion(page,type,text) { const names={Obrázek:'Otázka s obrázkem',Audio:'Otázka se zvukem',Video:'Otázka s videem'}; await page.locator('.outline-round').first().getByRole('button',{name:/Další typy otázek pro kolo/}).click(); await page.getByRole('dialog',{name:/Typ otázky/}).getByRole('button',{name:names[type]??type,exact:true}).click(); await questionText(page).fill(text); await page.locator('[data-preflight-field="correctAnswer"] textarea').fill('Syntetická odpověď QA'); }
async function reopen(page,text) { await page.getByRole('link',{name:'← Knihovna kvízů'}).click(); await page.getByRole('link',{name:'Syntetická vlastní média',exact:true}).click(); await page.getByRole('link',{name:'Otevřít editor'}).click(); await openRounds(page); await page.locator('.outline-question').filter({hasText:text}).click(); await expect(questionText(page)).toHaveValue(text); await page.reload(); await openRounds(page); await page.locator('.outline-question').filter({hasText:text}).click(); await expect(questionText(page)).toHaveValue(text); }
async function link(page,label,url) { const field=picker(page,label); await field.getByRole('button',{name:'Vložit odkaz',exact:true}).click(); await field.getByRole('textbox').fill(url); await field.getByRole('button',{name:'Použít odkaz',exact:true}).click(); await expect(field.getByRole('textbox')).toHaveCount(0); }

test('new multimedia authoring, independent roles, replacement, library, failures and conflict',async({page,context})=>{
  test.setTimeout(300000); const f=await mediaFixture(); const calls=[]; let second;
  await mkdir('.local-data/media-authoring',{recursive:true});
  // Capture only endpoint names/status, never authorization, query strings or request payloads.
  context.on('response',response=>{const url=new URL(response.url()); if(url.port==='5001')calls.push({endpoint:url.pathname.split('/').pop(),status:response.status()});});
  await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await context.route('**/qa-image.png',route=>route.fulfill({contentType:'image/png',body:syntheticImage()}));
  await context.route('**/qa-audio.wav',route=>route.fulfill({contentType:'audio/wav',body:syntheticAudio(5)}));
  const videoBytes=await readFile('tests/fixtures/media/synthetic.webm');
  await context.route('**/qa-video.webm',route=>route.fulfill({contentType:'video/webm',body:videoBytes}));
  try {
    await start(page,f);
    await newQuestion(page,'Obrázek','QA nová obrázková otázka');
    await page.getByLabel('Obrázek otázky — soubor',{exact:true}).setInputFiles(imageFile());
    await expect(picker(page,'Obrázek otázky').getByText('Ověřené médium tohoto kvízu',{exact:false})).toBeVisible();
    await expect.poll(()=>page.locator('.round-editor-preview .question-image-frame img').evaluate(img=>img.naturalWidth)).toBe(8);
    await extras(page);
    await page.getByLabel('Obrázek odpovědi (soukromý) — soubor',{exact:true}).setInputFiles(imageFile());
    await expect(picker(page,'Obrázek odpovědi (soukromý)').getByText('Ověřené médium tohoto kvízu',{exact:false})).toBeVisible();
    await background(page).getByLabel(/^Pozadí · (děděné|vlastní) — soubor$/).setInputFiles(imageFile());
    await expect(background(page).getByText('Ověřené médium tohoto kvízu',{exact:false})).toBeVisible();
    await expect(page.locator('.round-editor-preview .slide-answer')).toHaveCount(0);
    await expect.poll(()=>page.locator('.round-editor-preview .slide-background img').evaluate(img=>img.naturalWidth)).toBe(8);
    await save(page); await reopen(page,'QA nová obrázková otázka');

    await link(page,'Obrázek otázky','http://127.0.0.1:5198/qa-image.png'); await save(page); await reopen(page,'QA nová obrázková otázka');
    const imagePicker=picker(page,'Obrázek otázky'); await imagePicker.getByRole('button',{name:'Vybrat z médií tohoto kvízu',exact:true}).click(); await imagePicker.getByRole('button',{name:/Vybrat médium 1/}).click(); await save(page);
    await extras(page); await background(page).getByRole('button',{name:'Odebrat',exact:true}).click(); await picker(page,'Obrázek odpovědi (soukromý)').getByRole('button',{name:'Odebrat',exact:true}).click(); await save(page); await reopen(page,'QA nová obrázková otázka');
    await expect(page.locator('.round-editor-preview .slide-background img')).toHaveCount(0);
    await newQuestion(page,'Audio','QA nové audio'); await page.getByLabel('Zdroj ukázky — soubor',{exact:true}).setInputFiles(audioFile()); await expect(picker(page,'Zdroj ukázky').getByText('Ověřené médium tohoto kvízu',{exact:false})).toBeVisible(); await timing(page); await save(page); await reopen(page,'QA nové audio');
    await page.getByRole('button',{name:'Přehrát ukázku',exact:true}).click(); await expect(page.getByText('Ukázka dohrála.',{exact:true})).toBeVisible(); await expect.poll(()=>page.locator('audio').evaluate(a=>a.paused)).toBe(true);
    await link(page,'Zdroj ukázky','http://127.0.0.1:5198/qa-audio.wav'); await timing(page); await save(page); await reopen(page,'QA nové audio');
    await newQuestion(page,'Video','QA nové video'); await link(page,'Zdroj ukázky','https://youtu.be/abcdefghijk'); await timing(page); await save(page); await reopen(page,'QA nové video');
    await link(page,'Zdroj ukázky','https://www.youtube.com/shorts/lmnopqrstuv'); await timing(page); await save(page);
    await link(page,'Zdroj ukázky','http://127.0.0.1:5198/qa-video.webm'); await timing(page); await save(page); const videoSlide=(await f.quizRef.collection('slides').get()).docs.find(d=>d.data().text==='QA nové video'); expect(videoSlide.data().mediaSource).toBe('http://127.0.0.1:5198/qa-video.webm'); await reopen(page,'QA nové video');
    await page.getByRole('button',{name:'Přehrát ukázku',exact:true}).click(); await expect.poll(()=>page.locator('video').evaluate(v=>v.currentTime)).toBeGreaterThan(1); await page.locator('video').evaluate(v=>v.scrollIntoView({block:'center',behavior:'instant'}));  await expect(page.getByText('Ukázka dohrála.',{exact:true})).toBeVisible();
    await page.locator('.outline-question').filter({hasText:'QA nová obrázková otázka'}).click(); await expect(questionText(page)).toHaveValue('QA nová obrázková otázka');
    await questionText(page).fill('QA text zachovaný při chybě');
    await page.getByLabel('Obrázek otázky — soubor',{exact:true}).setInputFiles({name:'fake.png',mimeType:'image/png',buffer:Buffer.from('This is not a PNG')}); await expect(page.getByText(/Server odmítl obsah souboru/)).toBeVisible(); await expect(questionText(page)).toHaveValue('QA text zachovaný při chybě');
    await page.getByLabel('Obrázek otázky — soubor',{exact:true}).setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')}); await expect(page.getByRole('alert').filter({hasText:'Použijte PNG/JPEG/WebP'})).toBeVisible();
    await page.getByLabel('Obrázek otázky — soubor',{exact:true}).setInputFiles({name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(10485761)}); await expect(page.getByRole('alert').filter({hasText:'Použijte PNG/JPEG/WebP'})).toBeVisible();
    await page.route('**/beginQuizMediaUpload',route=>route.abort('internetdisconnected')); await page.getByLabel('Obrázek otázky — soubor',{exact:true}).setInputFiles(imageFile()); await expect(page.getByRole('alert').filter({hasText:'Přenos nebo ověření média selhalo'})).toBeVisible(); await page.unroute('**/beginQuizMediaUpload');
    let release, reached;const delayed=new Promise(r=>{release=r;}), finalizing=new Promise(r=>{reached=r;});await page.route('**/finalizeQuizMediaUpload',async route=>{reached();await delayed;await route.continue().catch(()=>{});});
    await page.getByLabel('Obrázek otázky — soubor',{exact:true}).setInputFiles(imageFile()); await expect(page.getByRole('button',{name:'Zrušit nahrávání',exact:true})).toBeVisible(); await expect(page.getByRole('button',{name:'Uložit vše',exact:true})).toBeDisabled();
    await finalizing; await expect(picker(page,'Obrázek otázky').getByText('Přenos dokončen. Ověřuji soubor…',{exact:true})).toBeVisible();
    await page.locator('.outline-question').filter({hasText:'QA nové audio'}).click(); await expect(questionText(page)).toHaveValue('QA text zachovaný při chybě');
    await page.getByRole('button',{name:'Zrušit nahrávání',exact:true}).click(); release(); await page.unroute('**/finalizeQuizMediaUpload'); await expect(questionText(page)).toHaveValue('QA text zachovaný při chybě');
    await page.getByRole('button',{name:'Zkusit nahrát znovu',exact:true}).click(); await expect(page.getByRole('button',{name:'Zrušit nahrávání',exact:true})).toHaveCount(0);
    await page.route('**/updateQuizSlide',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{status:'UNAVAILABLE',message:'QA unavailable'}})})); await page.getByRole('button',{name:'Uložit vše',exact:true}).click(); await expect(page.locator('.save-state')).toHaveText('Uložení se nezdařilo'); await expect(questionText(page)).toHaveValue('QA text zachovaný při chybě'); await page.unroute('**/updateQuizSlide'); await save(page);
    second=await context.newPage();await second.goto('/admin/quizzes/'+f.quizId+'/edit'); await openRounds(second);await second.locator('.outline-question').filter({hasText:'QA text zachovaný při chybě'}).click();await expect(questionText(second)).toHaveValue('QA text zachovaný při chybě');await questionText(second).fill('QA rozepsaný konflikt B');await questionText(page).fill('QA vítěz konflikt A');await save(page);await second.getByRole('button',{name:'Uložit vše',exact:true}).click();await expect(second.getByText(/Kvíz mezitím upravil někdo jiný/)).toBeVisible();await expect(questionText(second)).toHaveValue('QA rozepsaný konflikt B');
    const snapshot=await f.quizRef.collection('slides').get();expect(snapshot.docs.some(d=>d.data().text==='QA vítěz konflikt A')).toBe(true);expect(snapshot.docs.some(d=>d.data().text==='QA rozepsaný konflikt B')).toBe(false);
    expect(calls.some(c=>c.endpoint==='createQuizSlide'&&c.status===200)).toBe(true);expect(calls.some(c=>c.endpoint==='readQuizMedia'&&c.status===200)).toBe(true);
    expect(calls.some(c=>/Email|TeamMessage/.test(c.endpoint))).toBe(false);
    await writeFile('.local-data/media-authoring/browser-network-sanitized.json',JSON.stringify(calls,null,2));
  } catch(error) { console.error('Media authoring browser failed; only endpoint/status metadata is retained.'); throw error; } finally {await second?.close();await context.close();await f.dispose();}
});
