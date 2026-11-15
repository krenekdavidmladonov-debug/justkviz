/* global window, document, requestAnimationFrame, MutationObserver */
import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { leaderboardFixture } from '../e2e/leaderboard-fixture.mjs';
import { finalFixture } from '../e2e/final-reveal-fixture.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const evidence = '.local-data/show-mode/evidence';
const interimPanel = page => page.getByRole('region', { name: 'Ovládání průběžných výsledků', exact: true });
const finalPanel = page => page.getByRole('region', { name: 'Ovládání finálního vyhlášení', exact: true });

async function localOnly(context) {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
}

test('thank-you projector follows public events and displays two scannable QR codes', async ({ context, page }, testInfo) => {
  const { projectId } = requireFullEmulatorEnvironment(process.env, 'Thank-you projector E2E');
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const { initializeApp, deleteApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const app = initializeApp({ projectId }, 'thank-you-projector-e2e');
  const db = getFirestore(app);
  const sessionId = 'thank-you-projector-e2e';
  const session = db.doc(`publicSessions/${sessionId}`);
  const first = db.doc('publicEvents/thank-you-first-e2e');
  const second = db.doc('publicEvents/thank-you-second-e2e');
  const now = Date.now();
  const upcoming = (title, days) => ({
    title, startsAt: new Date(now + days * 86400000), timeZone: 'Europe/Prague',
    venueName: 'Syntetická restaurace', publicLocation: '', lifecycleStatus: 'scheduled',
    registrationPublished: true, registrationStatus: 'open', teamSize: { min: 2, max: 4 }, revision: 1,
  });

  try {
    await localOnly(context);
    await session.set({
      sessionId, status: 'active', quizTitle: 'Syntetický večer', slidePosition: 42,
      renderMode: 'question', presentationMode: 'slide', slideKind: 'thank-you',
      title: '', text: '', mediaCommand: 'idle', mediaPlaybackState: 'idle', answerRevealed: false, revision: 1,
    });
    await first.set(upcoming('První syntetický kvíz', 2));
    await page.goto(`/projector/${sessionId}`);
    await expect(page.getByRole('heading', { name: 'Děkujeme, že jste hráli!' })).toBeVisible();
    const dates = page.getByRole('region', { name: 'Nadcházející kvízy' });
    await expect(dates.getByRole('listitem')).toContainText('První syntetický kvíz');

    await second.set(upcoming('Druhý syntetický kvíz', 3));
    await expect(dates.getByRole('listitem')).toHaveText([/První syntetický kvíz/, /Druhý syntetický kvíz/]);
    await first.update({ registrationPublished: false });
    await expect(dates.getByRole('listitem')).toHaveText([/Druhý syntetický kvíz/]);
    await second.delete();
    await expect(dates.getByRole('listitem')).toHaveCount(0);

    await first.set(upcoming('První syntetický kvíz', 2));
    await second.set(upcoming('Druhý syntetický kvíz', 3));
    await expect(dates.getByRole('listitem')).toHaveCount(2);
    const destinations = [
      ['Přihlášky na kvízy', 'https://justkviz.cz/events'],
      ['Facebook JustKvízu', 'https://www.facebook.com/profile.php?id=61596012273723'],
    ];
    for (const width of [1280, 1920]) {
      await page.setViewportSize({ width, height: width * 9 / 16 });
      await expect.poll(() => page.locator('.slide-renderer').evaluate(content => Math.round(content.getBoundingClientRect().width))).toBe(width);
      for (const [label, destination] of destinations) {
        const image = page.getByRole('img', { name: `QR kód – ${label}` });
        await expect(image).toBeVisible();
        const png = PNG.sync.read(await image.screenshot());
        expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe(destination);
      }
      await page.locator('.slide-renderer').screenshot({ path: testInfo.outputPath(`thank-you-${width}.png`) });
    }
  } finally {
    await Promise.all([session.delete(), first.delete(), second.delete()]);
    await deleteApp(app);
  }
});

async function login(page, fixture) {
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill(fixture.login.email);
  await page.getByLabel('Heslo').fill(fixture.login.password);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/live/' + fixture.sessionId);
  await expect(page.locator('.live-control')).toHaveAttribute('data-current-position', '1');
}
async function enableShow(page) {
  await page.getByRole('checkbox', { name: 'SHOW MODE', exact: true }).check();
  await expect(page.getByRole('region', { name: 'Zvuk show mode', exact: true })).toHaveAttribute('data-save-state', /ready|saved/);
}
async function projection(browser, baseURL, fixture, suffix) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 }, recordVideo: { dir: evidence + '/videos', size: { width: 1920, height: 1080 } } });
  await localOnly(context);
  const errors = [], requests = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto('/projector/' + fixture.sessionId);
  await expect(page.locator('.slide-renderer')).toBeVisible();
  return { page, context, errors, requests, close: async () => { const video = page.video(); await context.close(); if (video) await video.saveAs(evidence + '/videos/' + suffix + '.webm'); } };
}
async function loadInterim(page) {
  const panel = interimPanel(page);
  await panel.getByLabel('Výsledky po kole').selectOption('r2');
  await panel.getByRole('button', { name: 'Načíst náhled výsledků', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Interní náhled — zatím nezveřejněno', exact: true })).toBeVisible();
}
async function publishInterim(page) {
  await loadInterim(page);
  await interimPanel(page).getByRole('button', { name: /^(Zobrazit výsledky|Aktualizovat zobrazené výsledky)$/ }).click();
}
async function startFinal(page) {
  await finalPanel(page).getByRole('button', { name: 'Načíst konečný náhled', exact: true }).click();
  await expect(finalPanel(page).getByRole('heading', { name: 'Konečný náhled — zatím nepotvrzeno', exact: true })).toBeVisible();
  await finalPanel(page).getByRole('button', { name: 'Zahájit vyhlášení', exact: true }).click();
}
async function revealNext(page) {
  await finalPanel(page).getByRole('button', { name: /^(Odhalit další umístění|Odhalit vítěze)$/ }).click();
}
async function settle(page) {
  await page.locator('.show-mode-canvas').evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
}
async function screenshot(page, name, widths = [1920, 1280]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width * 9 / 16 });
    // Chromium can acknowledge the viewport before the proportional container
    // has completed its next layout, especially with reduced motion enabled.
    await expect.poll(() => page.locator('.show-mode-canvas').evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(width);
    await settle(page);
    await expect(page.locator('.show-mode-canvas')).toBeVisible();
    const geometry = await page.locator('.show-mode-canvas').evaluate(element => {
      const rect = element.getBoundingClientRect();
      const control = document.querySelector('.projector-fullscreen-button')?.getBoundingClientRect();
      const overlappingFooterText = control ? Array.from(element.querySelectorAll('.sm-stage-footer > span,.sm-interim-footer > span')).filter(span => { const text = span.getBoundingClientRect(); return text.left < control.right && text.right > control.left && text.top < control.bottom && text.bottom > control.top; }).map(span => span.textContent) : [];
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, overflowX: document.documentElement.scrollWidth > window.innerWidth, overlappingFooterText };
    });
    expect(geometry.width).toBeCloseTo(width, 0); expect(geometry.height).toBeCloseTo(width * 9 / 16, 0); expect(geometry.overflowX).toBe(false);
    expect(geometry.overlappingFooterText).toEqual([]);
    await page.screenshot({ path: `${evidence}/${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
}
function assertPublic(value) {
  const body = JSON.stringify(value);
  for (const sentinel of ['PRIVATE ANSWER', 'PRIVATE CONTACT', 'PRIVATE MANAGEMENT', 'correctAnswer', 'moderatorNote', 'contactEmail', 'managementTokenHash', 'teamRanks', 'rowTeamIds']) expect(body).not.toContain(sentinel);
  expect(value.answerRevealed).toBe(false);
  expect(value.revealedAnswer).toBeUndefined(); expect(value.answerImage).toBeUndefined();
  expect(value.interimResults?.rows.length ?? value.finalReveal?.rows.length ?? 0).toBeLessThanOrEqual(6);
}
async function anonymousPayload(projector, fixture) {
  const response = await projector.request.get('http://127.0.0.1:8080/v1/projects/demo-filmovy-kviz-v2/databases/(default)/documents/publicSessions/' + fixture.sessionId);
  expect(response.status()).toBe(200);
  return response.json();
}

test.beforeAll(async () => { await mkdir(evidence + '/videos', { recursive: true }); });

test('SHOW interim: actual moderator controls, safe six-row overlay, exact return, pages, skip, reload and offline', async ({ page, context, browser, baseURL }) => {
  const fixture = await leaderboardFixture(13); let display;
  try {
    await localOnly(context); await login(page, fixture); display = await projection(browser, baseURL, fixture, 'interim-controls');
    const projector = display.page;
    // An explicitly revealed answer must disappear from both the overlay payload and backdrop.
    await page.getByRole('button', { name: 'Odhalit odpověď', exact: true }).click();
    await expect(projector.getByText('PRIVATE ANSWER SENTINEL', { exact: true })).toBeVisible();
    const before = await fixture.publicState();
    await enableShow(page); await publishInterim(page);
    await expect(projector.locator('.sm-scene-interim .sm-table .sm-row')).toHaveCount(6);
    const first = await fixture.publicState(); assertPublic(first);
    expect(first.interimResults).toMatchObject({ presentationStyle: 'show', pageSize: 6, page: 0, pageCount: 3 });
    expect(first.interimBackdrop).toMatchObject({ title: 'Synthetic question 1', text: 'Synthetic prompt' });
    expect(JSON.stringify(first.interimBackdrop)).not.toContain('answer');
    await expect(projector.getByText('PRIVATE ANSWER SENTINEL', { exact: true })).toHaveCount(0);
    await screenshot(projector, 'interim');
    await writeFile(evidence + '/interim-anonymous-http.json', JSON.stringify(await anonymousPayload(projector, fixture), null, 2));
    await interimPanel(page).getByRole('button', { name: 'Další stránka projektoru', exact: true }).click();
    await expect(projector.locator('.sm-interim-footer')).toContainText('Strana 2 / 3'); assertPublic(await fixture.publicState());
    await interimPanel(page).getByRole('button', { name: 'Přeskočit animaci / statický obraz', exact: true }).click();
    await expect(projector.locator('.show-mode-canvas')).toHaveClass(/sm-static/);
    expect((await fixture.publicState()).showCue.motion).toBe('static');
    await projector.reload(); await expect(projector.locator('.sm-interim-footer')).toContainText('Strana 2 / 3');
    await expect(projector.locator('.show-mode-canvas')).toHaveClass(/sm-static/);
    await display.context.setOffline(true); await expect(projector.getByRole('heading', { name: 'Projektor není připojen', exact: true })).toBeVisible();
    await expect(projector.locator('.show-mode-canvas')).toHaveCount(0);
    await display.context.setOffline(false); await expect(projector.locator('.sm-interim-footer')).toContainText('Strana 2 / 3');
    await expect(projector.locator('.show-mode-canvas')).toHaveClass(/sm-static/);
    await projector.evaluate(sessionId => { const channel = new BroadcastChannel('filmovy-kviz-projector-' + sessionId); channel.postMessage({ type: 'public-state', state: { sessionId, revision: 999999, finalReveal: { rows: [{ rank: 1, teamName: 'FORGED HIDDEN WINNER', halfPoints: 999 }] } } }); channel.close(); }, fixture.sessionId);
    await expect(projector.getByText('FORGED HIDDEN WINNER')).toHaveCount(0);
    await interimPanel(page).getByRole('button', { name: 'Skrýt výsledky a vrátit prezentaci', exact: true }).click();
    await expect(projector.locator('.show-mode-canvas')).toHaveCount(0);
    await expect(projector.getByText('PRIVATE ANSWER SENTINEL', { exact: true })).toBeVisible();
    const restored = await fixture.publicState();
    for (const key of ['slidePosition', 'title', 'text', 'renderMode', 'answerRevealed', 'revealedAnswer']) expect(restored[key]).toEqual(before[key]);
    expect(restored.interimBackdrop).toBeUndefined(); expect(restored.showCue).toBeUndefined();
    expect(display.requests.some(url => /\/quizzes\/|\/quizSnapshots\//.test(url))).toBe(false); expect(display.errors).toEqual([]);
    await writeFile(evidence + '/interim-browser.json', JSON.stringify({ status: 'PASS', source: 'actual moderator UI + trusted Functions + anonymous projector + Firestore bytes', sixRowPage: first.interimResults, exactReturn: true, reloadStatic: true, offlineClears: true, forgedChannelIgnored: true, errors: display.errors }, null, 2));
  } finally { await display?.close(); await fixture.close(); }
});

test('SHOW final: manual tied groups, explicit history pages, winner, table, hide/resume and reduced motion', async ({ page, context, browser, baseURL }) => {
  const fixture = await finalFixture(); let display;
  try {
    await localOnly(context); await login(page, fixture); await enableShow(page); display = await projection(browser, baseURL, fixture, 'finale-reveal');
    const projector = display.page;
    await startFinal(page); await expect(projector.locator('.sm-intro')).toBeVisible(); assertPublic(await fixture.rawPublic());
    await screenshot(projector, 'finale-intro');
    await expect(finalPanel(page).getByRole('button', { name: 'Zobrazit celé konečné pořadí', exact: true })).toBeDisabled();
    await revealNext(page); await expect.poll(async () => (await fixture.rawPublic()).finalReveal.rank).toBe(4);
    await expect(projector.locator('.sm-feature-teams h1')).toHaveCount(6);
    expect((await fixture.rawPublic()).finalReveal.groupSize).toBe(9); assertPublic(await fixture.rawPublic());
    await finalPanel(page).getByRole('button', { name: 'Další stránka finále', exact: true }).click();
    await expect(projector.locator('.sm-feature-teams h1')).toHaveCount(3);
    await expect(projector.locator('.sm-rank-feature > .sm-page')).toHaveText('Strana 2 / 2');
    await revealNext(page); await expect.poll(async () => (await fixture.rawPublic()).finalReveal.rank).toBe(3);
    await expect(projector.locator('.sm-feature-teams h1')).toHaveText(['Delta']);
    await expect(projector.locator('.sm-history .sm-row')).toHaveCount(6);
    const third = await fixture.rawPublic(); assertPublic(third); expect(third.finalReveal.history.rows.every(row => row.rank > 3)).toBe(true);
    for (const name of ['Alfa', 'Beta', 'Gama']) expect(JSON.stringify(third)).not.toContain('"' + name + '"');
    await screenshot(projector, 'finale');
    await writeFile(evidence + '/finale-anonymous-http.json', JSON.stringify(await anonymousPayload(projector, fixture), null, 2));
    await finalPanel(page).getByRole('button', { name: /Další již odhalené týmy/ }).click();
    await expect(projector.locator('.sm-history .sm-row')).toHaveCount(3); await expect(projector.locator('.sm-history-page')).toContainText('Strana 2 / 2');
    expect((await fixture.rawPublic()).showCue.motion).toBe('static');
    await revealNext(page); await expect(projector.locator('.sm-feature-teams h1')).toHaveText(['Beta', 'Gama']);
    expect((await fixture.rawPublic()).finalReveal.rank).toBe(2); assertPublic(await fixture.rawPublic());
    await projector.emulateMedia({ reducedMotion: 'reduce' });
    await revealNext(page); await expect(projector.locator('.sm-winner-names h1')).toHaveText(['Alfa']);
    await expect(projector.locator('.show-mode-canvas')).toHaveClass(/sm-static/);
    expect(await projector.locator('.show-mode-canvas').evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
    await screenshot(projector, 'winner');
    await finalPanel(page).getByRole('button', { name: 'Skrýt finále', exact: true }).click(); await expect(projector.locator('.slide-renderer')).toBeVisible();
    await finalPanel(page).getByRole('button', { name: 'Pokračovat ve stejné verzi', exact: true }).click(); await expect(projector.locator('.sm-winner-names h1')).toHaveText(['Alfa']);
    expect((await fixture.rawPublic()).showCue.motion).toBe('static');
    await projector.reload(); await expect(projector.locator('.sm-winner-names h1')).toHaveText(['Alfa']); await expect(projector.locator('.show-mode-canvas')).toHaveClass(/sm-static/);
    await finalPanel(page).getByRole('button', { name: 'Zobrazit celé konečné pořadí', exact: true }).click(); await expect(projector.locator('.sm-final-table .sm-row')).toHaveCount(6); assertPublic(await fixture.rawPublic());
    // A reviewed replacement starts clean and can explicitly reveal all lower ranks.
    await finalPanel(page).getByRole('button', { name: 'Načíst konečný náhled', exact: true }).click();
    await finalPanel(page).getByRole('checkbox', { name: /Potvrzuji nahrazení/ }).check();
    await finalPanel(page).getByRole('button', { name: 'Nahradit finále a začít znovu', exact: true }).click();
    await expect(projector.locator('.sm-intro')).toBeVisible(); await expect(projector.locator('.sm-winner-names')).toHaveCount(0);
    await finalPanel(page).getByRole('button', { name: 'Odhalit nižší umístění najednou', exact: true }).click();
    await expect(projector.locator('.sm-final-table .sm-row')).toHaveCount(6);
    const lower = await fixture.rawPublic(); assertPublic(lower); expect(lower.finalReveal.mode).toBe('lower'); expect(lower.finalReveal.rows.every(row => row.rank > 3)).toBe(true);
    await screenshot(projector, 'lower-bulk');
    expect(display.errors).toEqual([]);
    await writeFile(evidence + '/finale-browser.json', JSON.stringify({ status: 'PASS', manual: true, tiedGroupSize: 9, tiedGroupPages: [6, 3], historyPages: [6, 3], higherRanksAbsentAtThird: true, reducedMotion: true, resumeAndReloadStatic: true, explicitReplacementAndLowerBulk: true, errors: display.errors }, null, 2));
  } finally { await display?.close(); await fixture.close(); }
});

test('SHOW ten long co-winners: server pages six plus four, complete readable names and no overflow', async ({ page, context, browser, baseURL }) => {
  const fixture = await finalFixture(10, false, true); let display;
  try {
    const names = Array.from({ length: 10 }, (_, index) => `Dlouhý název týmu ${String(index + 1).padStart(2, '0')} – Přátelé filmových příběhů a nečekaných zápletek`);
    for (const [index, name] of names.entries()) await fixture.db.doc(`events/${fixture.eventId}/registrations/${fixture.teamIds[index]}`).update({ teamName: name });
    await localOnly(context); await login(page, fixture); await enableShow(page); display = await projection(browser, baseURL, fixture, 'long-co-winners'); const projector = display.page;
    const settings = page.getByRole('region', { name: 'Zvuk show mode', exact: true });
    await settings.getByText('Nastavení SHOW MODE a vlastní MP3/WAV', { exact: true }).click();
    await settings.getByLabel('Intenzita animací SHOW MODE', { exact: true }).selectOption('none');
    await settings.getByRole('button', { name: 'Uložit nastavení show', exact: true }).click();
    await expect(settings).toHaveAttribute('data-save-state', 'saved');
    await startFinal(page); await revealNext(page); await expect(projector.locator('.sm-winner-names h1')).toHaveCount(6);
    const first = await fixture.rawPublic(); assertPublic(first); expect(first.finalReveal).toMatchObject({ rank: 1, groupSize: 10, pageCount: 2, pageSize: 6 });
    expect(first.showCue).toMatchObject({ intensity: 'none', motion: 'static' });
    const geometry = [];
    for (const width of [1920, 1280]) {
      await projector.setViewportSize({ width, height: width * 9 / 16 }); await settle(projector);
      const measured = await projector.locator('.show-mode-canvas').evaluate(element => {
        const canvas = element.getBoundingClientRect(), footer = element.querySelector('.sm-stage-footer').getBoundingClientRect();
        return Array.from(element.querySelectorAll('.sm-winner-names h1')).map(name => {
          const rect = name.getBoundingClientRect(), style = window.getComputedStyle(name), range = document.createRange(); range.selectNodeContents(name); const content = range.getBoundingClientRect();
          return { text: name.textContent, x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            inside: Math.min(rect.left, content.left) >= canvas.left && Math.max(rect.right, content.right) <= canvas.right && Math.min(rect.top, content.top) >= canvas.top && Math.max(rect.bottom, content.bottom) <= footer.top,
            fontSize: style.fontSize, overflowY: style.overflowY, scrollHeight: name.scrollHeight, clientHeight: name.clientHeight,
            clipped: ['hidden', 'clip'].includes(style.overflowY) && name.scrollHeight > name.clientHeight + 1 };
        });
      });
      for (const item of measured) { expect(item.inside).toBe(true); expect(item.clipped).toBe(false); }
      geometry.push({ width, names: measured });
    }
    await screenshot(projector, 'six-long-co-winners');
    for (const name of first.finalReveal.rows.map(row => row.teamName)) await expect(projector.getByRole('heading', { name, exact: true })).toBeVisible();
    await finalPanel(page).getByRole('button', { name: 'Další stránka finále', exact: true }).click(); await expect(projector.locator('.sm-winner-names h1')).toHaveCount(4);
    const second = await fixture.rawPublic(); assertPublic(second); expect(second.finalReveal.page).toBe(1); expect(second.showCue.motion).toBe('static');
    expect([...first.finalReveal.rows, ...second.finalReveal.rows].map(row => row.teamName).sort()).toEqual([...names].sort());
    await screenshot(projector, 'four-long-co-winners');
    expect(display.errors).toEqual([]); await writeFile(evidence + '/long-co-winners-browser.json', JSON.stringify({ status: 'PASS', groupSize: 10, pageSizes: [6, 4], geometry, errors: display.errors }, null, 2));
  } finally { await display?.close(); await fixture.close(); }
});

test('actual UI changes a hidden classic final into a newly reviewed SHOW version without rewriting history', async ({ page, context, browser, baseURL }) => {
  const fixture = await finalFixture(4); let display;
  try {
    await localOnly(context); await login(page, { ...fixture, login: fixture.admin.login }); display = await projection(browser, baseURL, fixture, 'classic-to-show-replacement'); const projector = display.page;
    await expect(page.getByRole('checkbox', { name: 'SHOW MODE', exact: true })).not.toBeChecked();
    await startFinal(page); await expect(projector.locator('.final-canvas.final-mode-intro')).toBeVisible();
    const classic = (await fixture.rawPublic()).finalReveal;
    expect(classic.mode).toBe('intro');
    expect(classic.presentationStyle ?? 'classic').toBe('classic'); expect(classic.pageSize ?? 8).toBe(8);
    const classicRef = fixture.db.doc(`sessions/${fixture.sessionId}/finalVersions/${classic.versionId}`);
    const storedClassic = (await classicRef.get()).data();
    expect(storedClassic).toMatchObject({ presentationStyle: 'classic', pageSize: 8 });
    await finalPanel(page).getByRole('button', { name: 'Skrýt finále', exact: true }).click(); await expect(projector.locator('.slide-renderer')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'SHOW MODE', exact: true })).toBeEnabled(); await enableShow(page);
    await finalPanel(page).getByRole('button', { name: 'Načíst konečný náhled', exact: true }).click();
    await finalPanel(page).getByRole('checkbox', { name: /Potvrzuji nahrazení/ }).check();
    await finalPanel(page).getByRole('button', { name: 'Nahradit finále a začít znovu', exact: true }).click();
    await expect(projector.locator('.show-mode-canvas.sm-scene-intro')).toBeVisible();
    const replacement = await fixture.rawPublic(); assertPublic(replacement);
    expect(replacement.finalReveal).toMatchObject({ presentationStyle: 'show', pageSize: 6, mode: 'intro' });
    expect(replacement.finalReveal.versionId).not.toBe(classic.versionId);
    expect((await classicRef.get()).data()).toEqual(storedClassic);
    await expect(page.getByRole('checkbox', { name: 'SHOW MODE', exact: true })).toBeChecked();
    await page.setViewportSize({ width: 768, height: 1000 });
    const audioSettings = page.getByRole('region', { name: 'Zvuk show mode', exact: true });
    await audioSettings.getByText('Nastavení SHOW MODE a vlastní MP3/WAV', { exact: true }).click();
    await expect(audioSettings.locator('.show-audio-picker')).toHaveCount(5);
    await expect(audioSettings.locator('input[type="file"]')).toHaveCount(5);
    const mobileGeometry = await page.locator('.show-control-desk,.show-audio-panel,.show-audio-picker,.show-result-controls,.show-result-controls > .interim-panel').evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { className: element.className, x: rect.x, width: rect.width, inside: rect.left >= -1 && rect.right <= window.innerWidth + 1 }; }));
    for (const item of mobileGeometry) expect(item.inside).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.locator('.show-control-heading').scrollIntoViewIfNeeded();
    await page.screenshot({ path: evidence + '/moderator-768.png', fullPage: true });
    expect(display.errors).toEqual([]);
    await writeFile(evidence + '/classic-to-show-replacement.json', JSON.stringify({ status: 'PASS', source: 'actual moderator UI with administrator permission for upload controls', classicVersionId: classic.versionId, replacementVersionId: replacement.finalReveal.versionId, oldVersionUnchanged: true, pageSizeChangedOnlyOnExplicitReplacement: true, mobile768: { geometry: mobileGeometry, uploadPickers: 5, horizontalOverflow: false } }, null, 2));
  } finally { await display?.close(); await fixture.close(); }
});

async function installMeasurements(admin, projector) {
  await admin.evaluate(() => {
    window.__showCommandEpoch = null;
    if (window.__showMeasuredFetch) return;
    const nativeFetch = window.fetch.bind(window); window.__showMeasuredFetch = true;
    window.fetch = (...args) => {
      const url = String(args[0] instanceof Request ? args[0].url : args[0]);
      if (url.endsWith('/controlInterimResults')) {
        try { if (JSON.parse(String(args[1]?.body)).data?.action === 'publish') window.__showCommandEpoch = performance.timeOrigin + performance.now(); } catch { /* Not an interim publish body. */ }
      }
      return nativeFetch(...args);
    };
  });
  await projector.evaluate(() => {
    window.__showPerf = { armed: false, gaps: [], longTasks: [], domEpoch: null, selector: '' };
    let previous = performance.now();
    const frame = now => { const measured = window.__showPerf; if (measured.armed) measured.gaps.push(now - previous); previous = now; requestAnimationFrame(frame); }; requestAnimationFrame(frame);
    const observer = new PerformanceObserver(list => { if (window.__showPerf.armed) for (const entry of list.getEntries()) window.__showPerf.longTasks.push(entry.duration); }); observer.observe({ type: 'longtask', buffered: false });
    new MutationObserver(() => { const measured = window.__showPerf; if (measured.armed && measured.domEpoch === null && document.querySelectorAll(measured.selector).length === 6) measured.domEpoch = performance.timeOrigin + performance.now(); }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  const median = sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null;
  return { n: values.length, min: sorted[0] ?? null, median, p95: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? null, max: sorted.at(-1) ?? null };
}

test('measured classic versus SHOW: identical six-team data, real command-to-DOM, RAF gaps and long tasks at 6× CPU', async ({ browser, baseURL }, testInfo) => {
  const report = { status: 'MEASURED', comparisonScope: 'Classic and SHOW renderer paths from the same current checkout and compiled bundle. This is not a before/after checkout benchmark.', environment: { browser: browser.version(), viewport: '1920×1080', cpuThrottle: 6, source: 'production Vite preview + real demo emulators', network: 'loopback only', repeats: 4 }, method: 'Same six synthetic team names, ranks and scores. Separate isolated sessions for classic8 versus show6 so both actual visible tables contain exactly six rows. One unmeasured publish/hide warms each session. SHOW additionally shows zero movement from its preceding confirmed publication. Actual browser fetch invocation to projector DOM mutation using epoch-aligned monotonic clocks; subsequent 900 ms of RAF gaps and Long Task entries. Only projector CPU throttled. No performance improvement is assumed.', variants: {} };
  let expectedRows;
  for (const style of ['classic', 'show']) {
    const fixture = await leaderboardFixture(6); let adminContext, display;
    try {
      adminContext = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 } }); await localOnly(adminContext); const admin = await adminContext.newPage();
      await login(admin, fixture); if (style === 'show') await enableShow(admin);
      display = await projection(browser, baseURL, fixture, 'performance-' + style); const projector = display.page;
      const cdp = await display.context.newCDPSession(projector); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
      const samples = [], selector = style === 'show' ? '.sm-scene-interim .sm-table .sm-row' : '.results-canvas tbody tr';
      await publishInterim(admin); await expect(projector.locator(selector)).toHaveCount(6);
      await interimPanel(admin).getByRole('button', { name: 'Skrýt výsledky a vrátit prezentaci', exact: true }).click(); await expect(projector.locator('.slide-renderer')).toBeVisible();
      await installMeasurements(admin, projector);
      for (let index = 0; index < 4; index++) {
        await loadInterim(admin);
        await projector.evaluate(selector => { Object.assign(window.__showPerf, { armed: true, gaps: [], longTasks: [], domEpoch: null, selector }); }, selector);
        await interimPanel(admin).getByRole('button', { name: /^(Zobrazit výsledky|Aktualizovat zobrazené výsledky)$/ }).click();
        await expect(projector.locator(selector)).toHaveCount(6);
        await expect.poll(() => projector.evaluate(() => window.__showPerf.domEpoch)).not.toBeNull();
        await projector.waitForTimeout(900);
        const measured = await projector.evaluate(() => { window.__showPerf.armed = false; return { ...window.__showPerf }; });
        const commandEpoch = await admin.evaluate(() => window.__showCommandEpoch); expect(commandEpoch).not.toBeNull();
        const latency = measured.domEpoch - commandEpoch; expect(latency).toBeGreaterThanOrEqual(0);
        const publishedRows = (await fixture.publicState()).interimResults.rows;
        if (!expectedRows) expectedRows = publishedRows;
        expect(publishedRows.map(({ rank, teamName, halfPoints }) => ({ rank, teamName, halfPoints }))).toEqual(expectedRows.map(({ rank, teamName, halfPoints }) => ({ rank, teamName, halfPoints })));
        samples.push({ index, commandToDomMs: latency, rafGapMs: summary(measured.gaps), longTasksMs: measured.longTasks, longTaskTotalMs: measured.longTasks.reduce((a, b) => a + b, 0), frameGapsOver50Ms: measured.gaps.filter(gap => gap > 50).length });
        if (index === 0) await projector.screenshot({ path: `${evidence}/performance-${style}-1920.png` });
        await interimPanel(admin).getByRole('button', { name: 'Skrýt výsledky a vrátit prezentaci', exact: true }).click(); await expect(projector.locator('.slide-renderer')).toBeVisible();
      }
      const moduleScripts = await projector.locator('script[type="module"][src]').evaluateAll(scripts => scripts.map(script => script.getAttribute('src')));
      report.variants[style] = { moduleScripts, samples, commandToDomMs: summary(samples.map(sample => sample.commandToDomMs)), rafP95GapMs: summary(samples.map(sample => sample.rafGapMs.p95)), totalLongTaskMs: samples.reduce((sum, sample) => sum + sample.longTaskTotalMs, 0) };
      expect(display.errors).toEqual([]);
    } finally { await adminContext?.close(); await display?.close(); await fixture.close(); }
  }
  expect(report.variants.classic.moduleScripts).toEqual(report.variants.show.moduleScripts);
  report.comparison = { medianCommandToDomDeltaMs: report.variants.show.commandToDomMs.median - report.variants.classic.commandToDomMs.median, medianRafP95GapDeltaMs: report.variants.show.rafP95GapMs.median - report.variants.classic.rafP95GapMs.median, interpretation: 'Positive deltas mean SHOW was slower in this run. Browser/SDK scheduling, emulator response time and recording contribute; this is local evidence, not a production latency promise.' };
  await writeFile(evidence + '/performance-classic-versus-show.json', JSON.stringify(report, null, 2));
  await testInfo.attach('classic-versus-show-performance', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});
