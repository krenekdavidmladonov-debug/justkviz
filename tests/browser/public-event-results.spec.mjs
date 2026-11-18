/* global document, innerWidth */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { finalFixture } from '../e2e/final-reveal-fixture.mjs';
const loopback = async context => {
  await context.route('**/*', route => ['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
};

test('explicit publication → anonymous completed detail with shared winners, reload/mobile and hide', async ({ page, browser }) => {
  const f=await finalFixture(4), errors=[];
  const context=await browser.newContext(), anonymous=await context.newPage();
  let sourceQuizId;
  try {
    await loopback(page.context()); await loopback(context);
    page.on('pageerror', error => errors.push(error.message)); anonymous.on('pageerror', error => errors.push(error.message));
    ({ quizId:sourceQuizId }=await f.admin.call('createQuiz', { title:'Syntetický zdroj pro veřejný detail', requestId:randomUUID() }));
    await f.db.doc(`events/${f.eventId}`).update({ title:'Proběhlý syntetický večer', 'quizAssignment.quizId':sourceQuizId });
    await f.db.doc(`quizSnapshots/${f.snapshotId}`).update({ quizId:sourceQuizId });
    await f.db.doc(`sessions/${f.sessionId}`).update({ quizId:sourceQuizId });
    const longName='Dlouhý název vítězného týmu pro ověření mobilní šířky';
    await f.db.doc(`events/${f.eventId}/registrations/${f.teamIds[1]}`).update({ teamName:longName });
    for(let i=0;i<2;i++) for(let round=0;round<3;round++) await f.score(i, round, 22);
    const preview=await f.previewFinal(); await f.startFinal(preview); await f.command('reveal');
    await f.admin.call('completeEvent', { eventId:f.eventId, expectedRevision:(await f.db.doc('events/'+f.eventId).get()).get('revision'), requestId:randomUUID(), endLive:true });
    await anonymous.goto(`/events/${f.eventId}`); await expect(anonymous.getByRole('heading', { name:'Akce není dostupná' })).toBeVisible();
    await page.goto('/admin/login'); await page.getByLabel('E-mail', { exact:true }).fill(f.admin.login.email); await page.getByLabel('Heslo', { exact:true }).fill(f.admin.login.password);
    await page.getByRole('button', { name:'Přihlásit se', exact:true }).click(); await expect(page).toHaveURL(/\/admin$/u);
    await page.goto(`/admin/events/${f.eventId}`);
    await page.getByRole('button', { name:'Zveřejnit konečné výsledky', exact:true }).click();
    await expect(page.getByRole('group', { name:'Potvrzení zveřejnění výsledků' })).toContainText('Výslovně zveřejňuji');
    expect((await f.db.doc('publicEventResults/'+f.eventId).get()).exists).toBe(false);
    await page.getByRole('button', { name:'Potvrdit zveřejnění výsledků', exact:true }).click();
    await expect(page.getByRole('link', { name:'Otevřít veřejné výsledky', exact:true })).toBeVisible();
    const requests=[];
    anonymous.on('request', request => requests.push({ url:request.url(), body:request.postData() ?? '' }));
    await anonymous.reload();
    await expect(anonymous.getByText('JustKvíz / Akce proběhla')).toBeVisible();
    await expect(anonymous.getByRole('heading', { name:'Vítězové', exact:true })).toBeVisible();
    await expect(anonymous.locator('.public-event-winners li')).toHaveCount(2);
    const table=anonymous.getByRole('table', { name:'Konečné pořadí', exact:true });
    await expect(table.locator('tbody tr')).toHaveCount(4);
    expect(await table.locator('tbody tr').allTextContents()).toEqual(preview.rows.map(row => `${row.rank}.${row.teamName}${(row.halfPoints/2).toLocaleString('cs-CZ')}`));
    await expect(anonymous.locator('form')).toHaveCount(0);
    expect(requests.some(request => request.url.includes('/europe-west1/'))).toBe(false);
    expect(requests.some(request => /documents\/sessions\/|documents\/events\/|\/registrations\//u.test(request.body))).toBe(false);
    await mkdir('.local-data/a6-t11/screens', { recursive:true });
    for(const width of [1280,390]) {
      await anonymous.setViewportSize({ width, height:900 }); await anonymous.reload();
      await expect(table.getByRole('rowheader', { name:longName, exact:true })).toBeVisible();
      expect(await anonymous.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await anonymous.screenshot({ path:`.local-data/a6-t11/screens/completed-${width}.png`, fullPage:true });
    }
    const publicBefore=(await f.db.doc('publicEventResults/'+f.eventId).get()).data();
    await f.db.doc(`events/${f.eventId}/registrations/${f.teamIds[0]}`).update({ teamName:'Později změněný privátní tým' });
    await anonymous.reload(); await expect(table.getByRole('rowheader', { name:'Alfa', exact:true })).toBeVisible();
    expect((await f.db.doc('publicEventResults/'+f.eventId).get()).data()).toEqual(publicBefore);
    await page.getByRole('button', { name:'Skrýt veřejné výsledky', exact:true }).click();
    await page.getByRole('button', { name:'Potvrdit skrytí výsledků', exact:true }).click();
    await expect(page.getByRole('button', { name:'Zveřejnit konečné výsledky', exact:true })).toBeEnabled();
    await anonymous.reload(); await expect(anonymous.getByRole('heading', { name:'Akce není dostupná' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.close(); await f.close(); }
});
