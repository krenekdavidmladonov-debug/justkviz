/* global window, document */
import { test, expect } from '@playwright/test';
import { browserFixture } from '../access/browser-fixture.mjs';
import { randomUUID } from 'node:crypto';

async function localOnly(context) { await context.route('**/*', route => { const url = new URL(route.request().url()); return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort(); }); }
async function openRounds(page) { await expect(page.locator('.outline-round').first()).toBeVisible(); while (await page.locator('.outline-collapse[aria-expanded="false"]').count()) await page.locator('.outline-collapse[aria-expanded="false"]').first().click(); }

async function login(page, person) {
  await page.goto('/admin/login'); await page.getByLabel('E-mail', { exact: true }).fill(person.email); await page.getByLabel('Heslo', { exact: true }).fill(person.password);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
}

test('audit failure and stalled audit preserve real users, invitation state and independent retries', async ({ page }) => {
  await localOnly(page.context());
  const f = await browserFixture();
  let mode = 'fail', release = () => {}, held = false;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    await page.route('**/listAccessAudit', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INTERNAL', message: 'Synthetic audit failure' } }) });
      if (mode === 'hold') { held = true; await gate; }
      return route.continue().catch(() => {});
    });
    await login(page, f.owner); await page.goto('/admin/users');
    await expect(page.getByRole('row').filter({ hasText: f.viewer.email })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'listAccessAudit: functions/internal' })).toBeVisible();
    await page.getByLabel('Najít člověka').fill(f.viewer.email);
    await page.getByRole('button', { name: 'Pozvat člověka', exact: true }).click();
    await page.getByLabel('E-mail', { exact: true }).fill(f.invitedEmail);
    await page.getByRole('button', { name: 'Znovu načíst uživatele', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: f.viewer.email })).toBeVisible();
    await expect(page.getByLabel('Najít člověka')).toHaveValue(f.viewer.email);
    await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue(f.invitedEmail);
    await page.getByRole('button', { name: 'Vytvořit odkaz s pozvánkou', exact: true }).click();
    const link = await page.getByLabel('Odkaz na pozvánku').inputValue();
    expect(link).toContain('#token=');
    mode = 'pass';
    await page.getByRole('button', { name: 'Znovu načíst historii', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'listAccessAudit' })).toHaveCount(0);
    await expect(page.getByLabel('Odkaz na pozvánku')).toHaveValue(link);
    await expect(page.getByLabel('Najít člověka')).toHaveValue(f.viewer.email);
    mode = 'hold'; await page.reload();
    await expect.poll(() => held).toBe(true);
    await expect(page.getByRole('row').filter({ hasText: f.viewer.email })).toBeVisible();
    await expect(page.getByText('Načítám historii…', { exact: true })).toBeVisible();
    release();
    await expect(page.getByText('Načítám historii…', { exact: true })).toHaveCount(0);
  } finally { release(); await page.close(); await f.dispose(); }
});

test('a delayed authorized user list cannot restore access after suspension or reload', async ({ page }) => {
  await localOnly(page.context());
  const f = await browserFixture();
  let release = () => {}, held = false;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    await login(page, f.owner);
    await page.route('**/listAccessUsers', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      held = true; await gate;
      await route.fulfill({ response }).catch(() => {});
    });
    await page.goto('/admin/users'); await expect.poll(() => held).toBe(true);
    await f.db.doc(`memberships/${f.owner.uid}`).update({ status: 'suspended', version: 2 });
    await expect(page.getByRole('heading', { name: 'Uživatelé a přístupy', exact: true })).toHaveCount(0);
    const response = page.waitForResponse(r => r.url().endsWith('/listAccessUsers') && r.request().method() === 'POST');
    release(); await response;
    await expect(page.getByText(f.viewer.email, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Uživatelé a přístupy', exact: true })).toHaveCount(0);
    await expect(page.getByText(f.viewer.email, { exact: true })).toHaveCount(0);
  } finally { release(); await page.close(); await f.dispose(); }
});
test('five isolated identities: UI invitation, verified signup, scoped editor, moderator, scoring, viewer and live revocation', async ({ browser }) => {
  const f = await browserFixture(), contexts = [], failures = [];
  const context = async () => { const c = await browser.newContext({ baseURL: 'http://127.0.0.1:5198', viewport: { width: 1366, height: 900 } }); c.setDefaultTimeout(20000); await localOnly(c); contexts.push(c); return c; };
  try {
    const owner = await (await context()).newPage(); await login(owner, f.owner); await owner.goto('/admin/users');
    await owner.getByRole('button', { name: 'Pozvat člověka' }).click(); await owner.getByLabel('E-mail', { exact: true }).fill(f.invitedEmail);
    await owner.getByLabel('Role jako výchozí sada').selectOption('creator'); await owner.getByLabel('Rozsah: Kvízy').selectOption('selected');
    await owner.getByLabel('Přidělený kvíz A', { exact: true }).check(); await expect(owner.getByLabel('Mazat obsah kvízu')).not.toBeChecked();
    await owner.getByRole('button', { name: 'Vytvořit odkaz s pozvánkou' }).click(); const link = await owner.getByLabel('Odkaz na pozvánku').inputValue();
    expect(link.includes('#token=')).toBe(true); await owner.reload(); await expect(owner.getByRole('heading', { name: 'Uživatelé a přístupy' })).toBeVisible();
    const creator = await (await context()).newPage(); await creator.goto(link); await creator.getByRole('button', { name: 'Vytvořit osobní účet' }).click();
    await creator.getByLabel('Zobrazované jméno', { exact: true }).fill('Pozvaný tvůrce'); await creator.getByLabel('E-mail', { exact: true }).fill(f.invitedEmail); await creator.getByLabel('Heslo', { exact: true }).fill(f.invitedPassword);
    await creator.getByRole('button', { name: 'Vytvořit účet', exact: true }).click(); await expect(creator.getByText('E-mail čeká na ověření', { exact: false })).toBeVisible();
    await expect(creator.getByRole('button', { name: 'Přijmout pozvánku', exact: true })).toBeDisabled();
    let verifyLink; await expect.poll(async () => { verifyLink = await f.verificationLink(f.invitedEmail); return !!verifyLink; }).toBe(true);
    const verifier = await creator.context().newPage(); await verifier.goto(verifyLink); await verifier.close();
    await creator.getByRole('button', { name: 'Už jsem e-mail ověřil/a' }).click(); await expect(creator.getByRole('button', { name: 'Přijmout pozvánku', exact: true })).toBeEnabled();
    await creator.getByRole('button', { name: 'Přijmout pozvánku', exact: true }).click(); await expect(creator).toHaveURL(/\/account$/);
    await creator.goto('/admin/quizzes'); await expect(creator.getByRole('link', { name: 'Přidělený kvíz A', exact: true })).toBeVisible(); await expect(creator.getByText('Nepřístupný kvíz B', { exact: true })).toHaveCount(0);
    await creator.goto(`/admin/quizzes/${f.quizB}/edit`); await expect(creator.getByText('Obsah nelze zobrazit', { exact: true })).toBeVisible(); await expect(creator.getByLabel('Otázka *', { exact: true })).toHaveCount(0);
    await creator.goto(`/admin/quizzes/${f.quizA}/edit`); await openRounds(creator); await creator.locator('.outline-question').filter({ hasText: 'Otázka pro kolegu' }).click(); await creator.getByLabel('Otázka *', { exact: true }).fill('Upraveno pozvaným tvůrcem');
    await creator.getByRole('button', { name: 'Uložit vše', exact: true }).click(); await expect(creator.locator('.save-state')).toHaveText('Uloženo'); await expect(creator.getByRole('button', { name: 'Smazat', exact: true })).toHaveCount(0);
    await creator.reload(); await openRounds(creator); await creator.locator('.outline-question').filter({ hasText: 'Upraveno pozvaným tvůrcem' }).click();
    const invitedIdentity = await f.auth.getUserByEmail(f.invitedEmail);
    await owner.goto('/admin/users');
    await owner.getByRole('row').filter({ hasText: f.invitedEmail }).getByRole('button', { name: 'Detail přístupu' }).click();
    await owner.getByLabel('Role jako výchozí sada').selectOption('viewer');
    await owner.getByRole('button', { name: 'Uložit přístup' }).click();
    await expect.poll(async () => (await f.db.doc(`memberships/${invitedIdentity.uid}`).get()).get('version')).toBe(2);
    await openRounds(creator); await creator.locator('.outline-question').filter({ hasText: 'Upraveno pozvaným tvůrcem' }).click();
    await expect(creator.getByLabel('Otázka *', { exact: true })).toBeDisabled();
    await owner.getByRole('row').filter({ hasText: f.invitedEmail }).getByRole('button', { name: 'Detail přístupu' }).click();
    await owner.getByLabel('Role jako výchozí sada').selectOption('creator');
    await owner.getByRole('button', { name: 'Uložit přístup' }).click();
    await expect.poll(async () => (await f.db.doc(`memberships/${invitedIdentity.uid}`).get()).get('version')).toBe(3);
    await openRounds(creator); await creator.locator('.outline-question').filter({ hasText: 'Upraveno pozvaným tvůrcem' }).click();
    await expect(creator.getByLabel('Otázka *', { exact: true })).toBeEnabled();
    const moderator = await (await context()).newPage(); await login(moderator, f.moderator); await moderator.goto(`/admin/events/${f.eventA.eventId}`);
    await expect(moderator.getByRole('heading', { name: 'Detail akce' })).toBeVisible(); await expect(moderator.getByText('Vybraný kvíz se nepodařilo načíst.')).toHaveCount(0);
    await expect(moderator.getByRole('link', { name: 'Spravovat týmy a registrace' })).toHaveCount(0);
    await moderator.getByRole('button', { name: /Spustit moderování|Otevřít moderování|Zahájit moderování/ }).click(); await expect(moderator).toHaveURL(/\/admin\/live\//);
    const referee = await (await context()).newPage(); await login(referee, f.referee); await referee.goto(`/admin/events/${f.eventA.eventId}/scoring`);
    await expect(referee.getByLabel('Body — Testovací tým', { exact: true })).toBeVisible(); await expect(referee.getByLabel('Body — Testovací tým', { exact: true })).toBeEnabled();
    await referee.getByLabel('Body — Testovací tým', { exact: true }).fill('3'); await referee.getByRole('button', { name: 'Uložit body celého kola', exact: true }).click(); await expect(referee.getByText('Body kola jsou uložené. Potvrzeno serverem.', { exact: true })).toBeVisible();
    await expect.poll(async () => (await f.db.collection(`events/${f.eventA.eventId}/scores`).get()).docs[0]?.get('halfPoints')).toBe(6);
    await moderator.goto(`/admin/events/${f.eventA.eventId}/print`); await expect(moderator.getByRole('heading', { name: 'Tiskové centrum', exact: true })).toBeVisible(); await expect(moderator.getByRole('button', { name: /Klíč správných odpovědí/ })).toBeDisabled();
    const viewer = await (await context()).newPage(); viewer.on('response', async response => { if (response.url().endsWith('/readAccessData')) { const body = await response.text().catch(() => ''); for (const value of ['ANSWER_PRIVATE_BROWSER', 'NOTE_PRIVATE_BROWSER', 'CONTACT_PRIVATE_BROWSER']) if (body.includes(value)) failures.push(value); } });
    await login(viewer, f.viewer); await viewer.goto(`/admin/quizzes/${f.quizA}/edit`); await openRounds(viewer); await viewer.locator('.outline-question').filter({ hasText: 'Upraveno pozvaným tvůrcem' }).click();
    await expect(viewer.getByLabel('Správná odpověď *', { exact: true })).toHaveCount(0); await expect(viewer.getByLabel('Otázka *', { exact: true })).toBeDisabled(); expect(failures).toEqual([]);
    const invited = await f.auth.getUserByEmail(f.invitedEmail); await owner.goto('/admin/users'); const row = owner.getByRole('row').filter({ hasText: f.invitedEmail }); await row.getByRole('button', { name: 'Detail přístupu' }).click();
    await owner.getByLabel('Stav přístupu', { exact: true }).selectOption('suspended'); await owner.getByRole('button', { name: 'Uložit přístup' }).click();
    await expect.poll(async () => (await f.db.doc(`memberships/${invited.uid}`).get()).get('status')).toBe('suspended');
    await expect(creator.getByLabel('Otázka *', { exact: true })).toHaveCount(0); await expect(creator.getByText('Upraveno pozvaným tvůrcem', { exact: true })).toHaveCount(0);
    await owner.evaluate(() => window.scrollTo(0, 0));
    await owner.goto('/account'); await owner.getByLabel('Zobrazované jméno', { exact: true }).fill('Osobní QA vlastník'); await owner.getByRole('button', { name: 'Uložit jméno' }).click();
    await expect(owner.getByText('Zobrazované jméno bylo uloženo.', { exact: true })).toBeVisible();
    expect((await f.db.doc(`memberships/${f.owner.uid}`).get()).get('role')).toBe('owner');
    const replacement = randomUUID(); await owner.getByLabel('Aktuální heslo', { exact: true }).fill(f.owner.password); await owner.getByLabel('Nové heslo', { exact: true }).fill(replacement); await owner.getByLabel('Zopakovat nové heslo', { exact: true }).fill(replacement);
    await owner.getByRole('button', { name: 'Změnit heslo', exact: true }).click(); await expect(owner.getByRole('button', { name: 'Vytvořit osobní účet', exact: true })).toBeVisible();
    await login(owner, { ...f.owner, password: replacement }); await owner.reload();
    await owner.getByRole('link', { name: 'Nastavení', exact: true }).click();
    await owner.getByRole('link', { name: 'Spravovat přístupy', exact: true }).click();
    await expect(owner.getByRole('heading', { name: 'Uživatelé a přístupy', exact: true })).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Pozvat člověka', exact: true })).toBeEnabled();
    expect((await f.db.doc(`memberships/${f.owner.uid}`).get()).get('role')).toBe('owner');
    await owner.goto('/account'); const updatedEmail = `changed-${randomUUID()}@example.test`;
    await owner.getByLabel('Aktuální heslo', { exact: true }).fill(replacement); await owner.getByLabel('Nový přihlašovací e-mail', { exact: true }).fill(updatedEmail);
    await owner.getByRole('button', { name: 'Ověřit a změnit e-mail', exact: true }).click(); await expect(owner.getByText('Na nový e-mail jsme odeslali ověření. Změna se dokončí až po jeho potvrzení; pak se znovu přihlaste.', { exact: false })).toBeVisible();
    expect((await f.auth.getUser(f.owner.uid)).email).toBe(f.owner.email);
    let changeLink; await expect.poll(async () => { changeLink = await f.verificationLink(updatedEmail, 'VERIFY_AND_CHANGE_EMAIL'); return !!changeLink; }).toBe(true);
    const emailVerifier = await owner.context().newPage(); await emailVerifier.goto(changeLink); await emailVerifier.close();
    await expect.poll(async () => (await f.auth.getUser(f.owner.uid)).email).toBe(updatedEmail);
    await owner.getByRole('button', { name: 'Odhlásit pouze toto zařízení', exact: true }).click(); await expect(owner.getByRole('button', { name: 'Vytvořit osobní účet', exact: true })).toBeVisible(); await login(owner, { email: updatedEmail, password: replacement });
    expect((await f.db.doc(`memberships/${f.owner.uid}`).get()).get('role')).toBe('owner');
    await owner.goto('/account'); await owner.setViewportSize({ width: 390, height: 844 });
    expect(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await Promise.allSettled(contexts.map(c => c.close())); await f.dispose(); }
});

test('one SPA clears private live cache and queued commands before signing in another identity', async ({ page }) => {
  await localOnly(page.context());
  const f = await browserFixture();
  let releaseRequest = () => {}, releaseSlides = () => {}, queuedRequests = 0, slidesHeld = false;
  const slidesGate = new Promise(resolve => { releaseSlides = resolve; });
  const navigate = path => page.evaluate(path => { window.history.pushState({}, '', path); window.dispatchEvent(new window.PopStateEvent('popstate')); }, path);
  try {
    const eventRevision = (await f.db.doc(`events/${f.eventA.eventId}`).get()).get('revision');
    const { sessionId } = await f.owner.call('createEventLiveSession', { eventId: f.eventA.eventId, expectedRevision: eventRevision });
    await f.owner.call('nextSlide', { sessionId, expectedRevision: 0 });
    const privateTitle = 'PRIVATE_SESSION_A_CACHE_SENTINEL';
    await f.db.doc(`sessions/${sessionId}`).update({ quizTitle: privateTitle });
    await f.db.doc(`memberships/${f.viewer.uid}`).update({ permissions: ['event.read', 'event.live'], quizzes: { mode: 'none', ids: [] }, events: { mode: 'selected', ids: [f.eventB.eventId] }, version: 2 });
    await login(page, f.owner);
    await page.route('**/readAccessData', async route => {
      const request = route.request();
      if (request.method() !== 'POST') return route.continue();
      const data = request.postDataJSON()?.data;
      if (data?.operation === 'snapshotSlides' && data.snapshotId === f.eventA.snapshotId) {
        slidesHeld = true; await slidesGate;
      }
      await route.continue().catch(() => {});
    });
    await navigate(`/admin/live/${sessionId}`);
    await expect(page).toHaveURL(new RegExp('/admin/live/'+sessionId+'$'));
    await expect.poll(() => slidesHeld).toBe(true);
    // Flush rendering while the real owned slide request is still held.
    await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
    const next = page.getByRole('button', { name: 'Další →', exact: true });
    // Loading may hide controls or disable them; neither permits a command.
    expect((await next.count()) === 0 || !(await next.isEnabled())).toBe(true);
    releaseSlides();
    await expect(page.getByText(privateTitle, { exact: true }).first()).toBeVisible();
    await expect(next).toBeEnabled();
    let held = false;
    const gate = new Promise(resolve => { releaseRequest = resolve; });
    // This delayed navigation proves stale command/cache isolation. Navigation
    // resets playback, so eligible queued playback suppression is not independently proven.
    await page.route('**/goToSlide', async route => { if (route.request().method() !== 'POST') return route.continue(); held = true; await gate; await route.continue().catch(() => {}); });
    page.on('request', request => { if (request.url().endsWith('/reportMediaPlayback')) queuedRequests++; });
    await next.click();
    await expect.poll(() => held).toBe(true);
    const mediaGeneration = (await f.db.doc(`sessions/${sessionId}`).get()).get('mediaGeneration');
    await page.evaluate(async ({ sessionId, mediaGeneration }) => {
      const channel = new window.BroadcastChannel(`filmovy-kviz-projector-${sessionId}`);
      channel.postMessage({ type: 'playback-state', sessionId, mediaGeneration, playbackState: 'error' });
      await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
      channel.close();
    }, { sessionId, mediaGeneration });
    await expect(page.getByText('Médium se na projektoru nepřehrálo', { exact: true })).toBeVisible();
    await navigate('/account'); await page.getByRole('button', { name: 'Odhlásit pouze toto zařízení', exact: true }).click();
    await page.getByLabel('E-mail', { exact: true }).fill(f.viewer.email); await page.getByLabel('Heslo', { exact: true }).fill(f.viewer.password);
    await page.locator('form').getByRole('button', { name: 'Přihlásit se', exact: true }).click();
    await expect(page.getByLabel('Zobrazované jméno', { exact: true })).toHaveValue('viewer');
    await page.evaluate(privateTitle => {
      window.__privateSessionLeak = false;
      window.__privateSessionObserver = new window.MutationObserver(() => { if (document.body.innerText.includes(privateTitle)) window.__privateSessionLeak = true; });
      window.__privateSessionObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }, privateTitle);
    const completed = page.waitForResponse(response => response.url().endsWith('/goToSlide') && response.request().method() === 'POST');
    releaseRequest(); await completed;
    await navigate(`/admin/live/${sessionId}`);
    await expect(page.getByRole('heading', { name: 'Moderování nebylo nalezeno' })).toBeVisible();
    expect(await page.evaluate(() => window.__privateSessionLeak)).toBe(false);
    expect(queuedRequests).toBe(0);
    await page.evaluate(() => window.__privateSessionObserver.disconnect());
  } finally { releaseSlides(); releaseRequest(); await page.close(); await f.dispose(); }
});
