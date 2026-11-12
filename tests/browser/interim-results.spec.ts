import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { leaderboardFixture } from '../e2e/leaderboard-fixture.mjs';
let fixture: Awaited<ReturnType<typeof leaderboardFixture>>;
type Standings = { versionId: string; page: number; rows: { teamName: string; halfPoints: number; rank: number }[] };
test.beforeAll(async () => {
  fixture = await leaderboardFixture(12);
  // Current standings include all saved rounds. Keep the third round at zero
  // so the original two-round tie and correction expectations remain meaningful.
  for (let team = 0; team < 12; team++) await fixture.score(team, 2, 0);
});
test.afterAll(async () => { await fixture?.close(); });
async function localOnly(context: import('@playwright/test').BrowserContext) {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
}
test('moderator explicitly publishes current standings, preserves confirmed versions across corrections and hides on the existing projector', async ({ page, context, browser, baseURL }) => {
  await localOnly(context);
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill(fixture.login.email); await page.getByLabel('Heslo').fill(fixture.login.password);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/live/' + fixture.sessionId);
  const controls = page.getByRole('region', { name: 'Výsledky akce', exact: true });
  await expect(controls).toBeVisible();
  const projectorContext = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 } });
  let refereeContext: import('@playwright/test').BrowserContext | undefined;
  try {
    await localOnly(projectorContext); const projector = await projectorContext.newPage();
    await projector.goto('/projector/' + fixture.sessionId); await expect(projector.getByText('Synthetic prompt', { exact: true })).toBeVisible();
    const published = projector.getByRole('article', { name: 'Průběžné pořadí', exact: true });
    expect((await fixture.publicState()).interimResults).toBeUndefined(); await expect(published).toHaveCount(0);
    await projector.evaluate(sessionId => {
      const channel = new BroadcastChannel('filmovy-kviz-projector-' + sessionId);
      channel.postMessage({ type: 'public-state', state: { sessionId, revision: 99999, interimResults: { rows: [{ rank: 1, teamName: 'UNPUBLISHED INJECTION', halfPoints: 999 }] } } }); channel.close();
    }, fixture.sessionId);
    await expect(projector.getByText('UNPUBLISHED INJECTION')).toHaveCount(0);
    await controls.getByRole('button', { name: 'Průběžné výsledky', exact: true }).click(); await expect(published).toBeVisible();
    const rows = published.locator('.sm-row'); await expect(rows).toHaveCount(6);
    await expect(rows.nth(0)).toContainText('Alfa'); await expect(rows.nth(0)).toContainText('20');
    await expect(rows.nth(1)).toContainText('17,5'); await expect(rows.nth(1).locator('.sm-rank')).toHaveText('2.');
    await expect(rows.nth(2).locator('.sm-rank')).toHaveText('2.'); await expect(rows.nth(3).locator('.sm-rank')).toHaveText('3.');
    const currentPage = async () => (await fixture.publicState()).interimResults as Standings;
    const changePage = async (number: number) => {
      await fixture.call('controlInterimResults', { eventId: fixture.eventId, sessionId: fixture.sessionId, action: 'page', page: number, requestId: randomUUID(), expectedRevision: (await fixture.session()).revision });
      await expect.poll(async () => (await currentPage()).page).toBe(number);
      for (const row of (await currentPage()).rows) await expect(published.getByRole('rowheader', { name: row.teamName, exact: true })).toBeVisible();
    };
    // Advanced pagination is exercised through its real callable, not represented
    // as a removed button. The current operator UI owns open/close publication.
    const seen = (await currentPage()).rows.map((row: { teamName: string }) => row.teamName);
    await changePage(1); seen.push(...(await currentPage()).rows.map((row: { teamName: string }) => row.teamName));
    expect(new Set(seen).size).toBe(12); await changePage(0);
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
      await projector.setViewportSize(viewport); const last = await rows.last().boundingBox(); expect(last && last.y + last.height <= viewport.height).toBeTruthy();
      expect(await projector.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    const before = await fixture.publicState(), grant = await fixture.referee();
    refereeContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } }); await localOnly(refereeContext); const referee = await refereeContext.newPage();
    await referee.goto('/');
    await referee.evaluate(destination => { const state = { idx: 1, key: crypto.randomUUID() }; history.pushState(state, '', destination); dispatchEvent(new PopStateEvent('popstate', { state })); }, '/referee/' + grant.eventId + '#access=' + grant.accessId + '&key=' + grant.key);
    await expect(referee.getByRole('heading', { name: 'Bodování', exact: true })).toBeVisible(); await referee.getByLabel('Kolo', { exact: true }).selectOption('r2');
    await referee.getByLabel('Body — Alfa', { exact: true }).fill('25,5'); await referee.getByLabel('Důvod opravy — Alfa', { exact: true }).fill('Synthetic referee correction');
    await referee.getByRole('button', { name: 'Uložit body celého kola', exact: true }).click(); await expect(referee.getByText('Body kola jsou uložené. Potvrzeno serverem.', { exact: true })).toBeVisible();
    expect(await fixture.publicState()).toEqual(before); await expect(rows.nth(0)).toContainText('20');
    await controls.getByRole('button', { name: 'Zavřít průběžné výsledky', exact: true }).click(); await expect(published).toHaveCount(0);
    await controls.getByRole('button', { name: 'Průběžné výsledky', exact: true }).click(); await expect(rows.nth(0)).toContainText('35,5');
    const latest = await fixture.publicState(); expect((latest.interimResults as Standings).versionId).not.toBe((before.interimResults as Standings).versionId);
    await projector.evaluate(({ old, sessionId }) => { const channel = new BroadcastChannel('filmovy-kviz-projector-' + sessionId); channel.postMessage({ type: 'public-state', state: old }); channel.postMessage({ type: 'public-state', state: { ...old, sessionId: 'foreign', revision: 99999 } }); channel.close(); }, { old: before, sessionId: fixture.sessionId });
    await expect(rows.nth(0)).toContainText('35,5');
    await page.setViewportSize({ width: 768, height: 900 }); await expect(controls.getByRole('button', { name: 'Zavřít průběžné výsledky', exact: true })).toBeVisible();
    expect(await controls.evaluate(element => element.getBoundingClientRect().width <= window.innerWidth)).toBe(true);
    await projectorContext.setOffline(true); await expect(projector.getByRole('heading', { name: 'Projektor není připojen', exact: true })).toBeVisible(); await expect(published).toHaveCount(0);
    await controls.getByRole('button', { name: 'Zavřít průběžné výsledky', exact: true }).click(); await expect.poll(async () => (await fixture.publicState()).interimResults).toBeUndefined();
    await projectorContext.setOffline(false); await expect(projector.getByText('Synthetic prompt', { exact: true })).toBeVisible(); await expect(published).toHaveCount(0);
    await projector.reload(); await expect(projector.getByText('Synthetic prompt', { exact: true })).toBeVisible(); await expect(projector.getByText('PRIVATE ANSWER SENTINEL', { exact: true })).toHaveCount(0);
    expect((await fixture.session()).currentSlidePosition).toBe(1); expect((await fixture.session()).mediaPlaybackState).toBe('idle'); await expect(projector.locator('audio,video,iframe')).toHaveCount(0);
  } finally { await refereeContext?.close(); await projectorContext.close(); }
});
