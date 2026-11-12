/* global document, window, getComputedStyle */
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { auditDarkUi, installPaintProbe } from './dark-theme-audit.mjs';

const dir='.local-data/dark-mode/local-visual';
const measurements=[];
const loopback=context=>context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
async function audit(page,name) {
  const result=await auditDarkUi(page);measurements.push({name,...result});
  expect(result.rootBackground).toBe('rgb(11, 18, 32)');expect(result.colorScheme).toBe('dark');
  expect(result.failures,name).toEqual([]);expect(result.horizontalOverflow,name+' overflow').toBe(false);
  await page.screenshot({path:dir+'/'+name+'.png',mask:[page.locator('.admin-account > strong')]});
}
const save=async page=>{await page.getByRole('button',{name:'Uložit vše',exact:true}).click();await expect(page.locator('.save-state')).toHaveText('Uloženo');};

test('fresh system-light browser starts dark before JS, refreshes dark, and supports keyboard/high contrast',async({browser})=>{
  await mkdir(dir,{recursive:true});
  const noJs=await browser.newContext({javaScriptEnabled:false,colorScheme:'light'});
  await loopback(noJs);const shell=await noJs.newPage();await shell.goto('http://127.0.0.1:5198/admin/quizzes');
  expect(await shell.locator('html').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(11, 18, 32)');
  expect(await shell.locator('html').evaluate(el=>getComputedStyle(el).colorScheme)).toBe('dark');await noJs.close();
  const context=await browser.newContext({colorScheme:'light'});await loopback(context);await installPaintProbe(context);const page=await context.newPage();
  for(const [width,height] of [[1920,1080],[1366,768],[1024,768],[390,844]]){
    await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:5198/admin/login');await expect(page.getByLabel('E-mail')).toBeVisible();await audit(page,'login-'+width);
    const paints=await page.evaluate(()=>window.__darkPaints);expect(paints.length).toBeGreaterThan(0);expect(paints.every(p=>p.html==='rgb(11, 18, 32)'&&p.body==='rgb(11, 18, 32)')).toBe(true);
    await page.reload();await expect(page.getByLabel('E-mail')).toBeVisible();expect((await page.evaluate(()=>window.__darkPaints)).every(p=>p.html==='rgb(11, 18, 32)')).toBe(true);
  }
  await page.getByLabel('E-mail').focus();await page.keyboard.press('Tab');await expect(page.getByLabel('Heslo')).toBeFocused();
  expect(await page.getByLabel('Heslo').evaluate(el=>({width:getComputedStyle(el).outlineWidth,color:getComputedStyle(el).outlineColor}))).toEqual({width:'3px',color:'rgb(96, 165, 250)'});
  await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Přihlásit se'})).toBeFocused();
  await page.emulateMedia({forcedColors:'active'});expect(await page.locator('body').evaluate(el=>getComputedStyle(el).forcedColorAdjust)).toBe('auto');await page.screenshot({path:dir+'/forced-colors.png',mask:[page.locator('.admin-account > strong')]});
  await context.close();
});

test('real editor controls, modal focus, media and light content remain separate',async({page,context})=>{
  const identity=await editorIdentity();let quizId;
  const png=new PNG({width:320,height:180});png.data.fill(255);const white=PNG.sync.write(png);
  await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await context.route('**/qa-light.png',route=>route.fulfill({contentType:'image/png',body:white}));
  try{
    await page.goto('/admin/login');await page.getByLabel('E-mail').fill(identity.email);await page.getByLabel('Heslo').fill(identity.password);await page.getByRole('button',{name:'Přihlásit se'}).click();await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/quizzes');await audit(page,'library-empty');await page.getByRole('link',{name:'+ Nový kvíz',exact:true}).first().click();await audit(page,'create-quiz');
    await page.getByLabel('Název kvízu').fill('QA-DarkMode — světlý obsah');await page.getByRole('button',{name:'Vytvořit',exact:true}).click();await expect(page).toHaveURL(/\/edit$/);quizId=page.url().split('/').at(-2);
    await page.getByRole('button',{name:'+ Přidat kolo',exact:true}).click();await page.getByLabel('Název kola *').fill('QA první kolo');await save(page);
    await page.getByRole('button',{name:/Další typy otázek pro kolo/}).click();await audit(page,'question-type-menu');await page.getByRole('dialog',{name:/Typ otázky/}).getByRole('button',{name:'Výběr z možností (ABCD)',exact:true}).click();
    await page.getByLabel('Otázka *',{exact:true}).fill('QA kontrast odpovědí');for(let i=0;i<4;i++)await page.getByLabel('Možnost '+String.fromCharCode(65+i),{exact:true}).fill('QA možnost '+(i+1));await page.getByLabel('Označit možnost B jako správnou').check();await save(page);
    expect(await page.getByLabel('Označit možnost B jako správnou').isChecked()).toBe(true);
    for(const [width,height] of [[1920,1080],[1366,768],[1024,768]]){await page.setViewportSize({width,height});await audit(page,'editor-abcd-'+width);await expect(page.getByRole('button',{name:'Uložit vše',exact:true})).toBeInViewport();await expect(page.getByRole('button',{name:'+ Přidat kolo',exact:true})).toBeInViewport();}
    await page.setViewportSize({width:1920,height:1080});await page.locator('details.editor-extra > summary').filter({hasText:'Vzhled otázky nebo slidu'}).click();
    const picker=page.locator('.slide-design-editor').first().getByRole('region',{name:/^Pozadí · (děděné|vlastní)$/,exact:true});await picker.getByRole('button',{name:'Vložit odkaz',exact:true}).click();await audit(page,'media-url-picker');await picker.getByRole('textbox').fill('http://127.0.0.1:5198/qa-light.png');await picker.getByRole('button',{name:'Použít odkaz'}).click();await save(page);
    const slide=page.locator('.round-editor-preview .slide-renderer');await expect(slide.locator('.slide-background img')).toBeVisible();await slide.locator('img').evaluateAll(images=>Promise.all(images.map(img=>img.decode())));
    const before=PNG.sync.read(await slide.screenshot({path:dir+'/light-slide-current.png'}));
    // Stress the inheritance boundary with the previous UI palette, without touching content.
    const override=await page.addStyleTag({content:':root{--color-text:#f8f5ec;--color-text-muted:#a8afb9;--color-text-subtle:#818b98;--color-background:#0e1116;--color-surface:#171c24;--color-primary:#f3b33d;--color-accent:#f3b33d}'});
    const after=PNG.sync.read(await slide.screenshot({path:dir+'/light-slide-previous-ui.png'}));
    expect([after.width,after.height]).toEqual([before.width,before.height]);
    // The rounded outer corners expose the intentionally changed editor surround.
    // Compare every painted content pixel, excluding only those four corner squares.
    let changedContentPixels=0;
    for(let y=0;y<before.height;y++)for(let x=0;x<before.width;x++){
      if((x<14||x>=before.width-14)&&(y<14||y>=before.height-14))continue;
      const offset=(y*before.width+x)*4;if(!before.data.subarray(offset,offset+4).equals(after.data.subarray(offset,offset+4)))changedContentPixels++;
    }
    expect(changedContentPixels).toBe(0);
    await override.evaluate(el=>el.remove());
    expect(await slide.locator('.slide-background img').evaluate(el=>getComputedStyle(el).filter)).toBe('none');
    await page.getByLabel('Otázka *',{exact:true}).fill('QA neuložená změna');await page.getByRole('button',{name:'Zahodit změny…',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Máte neuložené změny.'});await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Zrušit',exact:true})).toBeFocused();await audit(page,'unsaved-dialog');
    expect(await dialog.evaluate(el=>el.matches(':modal'))).toBe(true);
    const tabOrder=[];
    for(let i=0;i<4;i++){
      await page.keyboard.press('Tab');
      // Chromium may visit its own address bar between the last and first dialog button.
      // No focus may enter a control in the inert application behind the native modal.
      const focus=await dialog.evaluate(el=>({inside:el.contains(document.activeElement),browserChrome:document.activeElement===document.body,text:el.contains(document.activeElement)?document.activeElement.textContent:null}));
      expect(focus.inside||focus.browserChrome).toBe(true);if(focus.inside)tabOrder.push(focus.text);
    }
    expect(tabOrder.slice(0,3)).toEqual(['Uložit a pokračovat','Pokračovat bez uložení','Zrušit']);
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByLabel('Otázka *',{exact:true})).toHaveValue('QA neuložená změna');await expect(page.getByRole('button',{name:'Zahodit změny…',exact:true})).toBeFocused();
    await writeFile(dir+'/measurements.json',JSON.stringify({status:'PASS',measurements,contentPixelsIdentical:true,nativeModalBackgroundInert:true,tabOrder,escapePreservesDraft:true,focusReturned:true},null,2));
  } catch (error) {
    try {
      const docs=await identity.db.collection('memberships').where('email','==',identity.email).limit(2).get();
      const d=docs.size===1?docs.docs[0]:null,m=d?.data();
      const pathname=new URL(page.url()).pathname;
      console.log('DARK_AUTH_DIAGNOSTIC '+JSON.stringify({membershipCount:docs.size,membership:m?{uidMatchesDocument:m.uid===d.id,active:m.status==='active',role:['owner','manager','creator','moderator','referee','viewer'].includes(m.role)?m.role:'other',permissionCount:Array.isArray(m.permissions)?m.permissions.length:null,quizRead:m.permissions?.includes('quiz.read')===true,quizEdit:m.permissions?.includes('quiz.edit')===true,cutoffZero:m.sessionValidAfter===0}:null,route:['/admin','/admin/login','/admin/quizzes','/admin/no-access'].includes(pathname)?pathname:'other'}));
    } catch { console.log('DARK_AUTH_DIAGNOSTIC '+JSON.stringify({unavailable:true})); }
    throw error;
  } finally {if(quizId)await identity.db.recursiveDelete(identity.db.doc('quizzes/'+quizId));await identity.dispose();}
});

test('public, referee, projector waiting/error and denied routes use the same foundation',async({page})=>{
  for(const width of [1024,390]){
    await page.setViewportSize({width,height:768});
    for(const [name,path] of [['public-events','/events'],['public-missing','/events/qa-dark-missing'],['registration-missing','/events/qa-dark-missing/registration/manage'],['referee-denied','/referee/qa-dark-missing'],['no-access','/admin/no-access'],['not-found','/qa-dark-missing'],['projector-waiting','/projector']]){
      await page.goto(path);await expect(page.locator('main')).toBeVisible();await audit(page,name+'-'+width);
    }
  }
});
