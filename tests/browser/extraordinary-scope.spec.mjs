/* global history, dispatchEvent, PopStateEvent, requestAnimationFrame */
import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

test.use({ screenshot: 'off', trace: 'off', video: 'off' });

test('STRESS scope: real delayed public A-B-A registration and independent management edit/cancel', async ({ browser, baseURL }) => {
  const env = requireFullEmulatorEnvironment(process.env, 'Stress public scope');
  const identity = await editorIdentity();
  const context = await browser.newContext({ baseURL });
  const functionsHost = `${env.functionsEndpoint.host}:${env.functionsEndpoint.port}`;
  const ports = { '9099': `${env.authEndpoint.host}:${env.authEndpoint.port}`, '8080': `${env.firestoreEndpoint.host}:${env.firestoreEndpoint.port}`, '5001': functionsHost };
  const endpoint = `http://${functionsHost}/${env.projectId}/europe-west1/`;
  const scenarios = [], pageErrors = [];
  let release = () => {};
  context.on('page', page => page.on('pageerror', () => pageErrors.push('browser-error')));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (ports[url.port]) { url.host = ports[url.port]; return route.continue({ url: url.href }); }
    return route.continue();
  });
  const page = await context.newPage();
  const navigate = path => page.evaluate(path => {
    const previous = history.state ?? {};
    history.pushState({ ...previous, idx: (previous.idx ?? 0) + 1, key: crypto.randomUUID() }, '', path);
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, path);
  const settle = () => page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
  async function openEvent(title) {
    const created = await identity.call('createEvent', { expectedRevision: 0, event: {
      title, startsAt: '2031-11-20T18:00:00Z', timeZone: 'Europe/Prague',
      venue: { name: 'Synthetic', publicLocation: 'Synthetic' }, teamCapacity: 4, peopleCapacity: 16, teamSizeMin: 2, teamSizeMax: 4,
    } });
    const current = (await identity.db.doc(`events/${created.eventId}`).get()).data();
    await identity.call('configureEventRegistration', { eventId: created.eventId, expectedRevision: current.revision, published: true, openRegistrationsNow: true });
    return created.eventId;
  }
  async function blankForm() {
    await expect(page.getByLabel('Název týmu')).toHaveValue('');
    await expect(page.getByLabel('E-mail')).toHaveValue('');
    await expect(page.getByLabel('Počet členů')).toHaveValue('2');
    await expect(page.getByRole('button', { name: 'Přihlásit tým', exact: true })).toBeEnabled();
  }
  async function fill(name, email) {
    await page.getByLabel('Název týmu').fill(name);
    await page.getByLabel('Počet členů').fill('2');
    await page.getByLabel('E-mail').fill(email);
  }
  try {
    const eventA = await openEvent('Synthetic scope A'), eventB = await openEvent('Synthetic scope B');
    let reached, completed;
    const seen = new Promise(resolve => { reached = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const fulfilled = new Promise(resolve => { completed = resolve; });
    let held = false;
    await context.route('**/createEventRegistration', async route => {
      if (route.request().method() !== 'POST' || route.request().postDataJSON()?.data?.eventId !== eventA || held) return route.fallback();
      held = true;
      const url = new URL(route.request().url()); url.host = functionsHost;
      const response = await route.fetch({ url: url.href });
      expect(response.status()).toBe(200);
      reached();
      await gate;
      await route.fulfill({ response });
      completed();
    });
    await page.goto(`/events/${eventA}`);
    await blankForm();
    await fill('Scope submitted A', 'scope-a@example.test');
    await page.getByRole('button', { name: 'Přihlásit tým', exact: true }).click();
    await seen;
    await navigate(`/events/${eventB}`);
    await expect(page.getByRole('heading', { name: 'Synthetic scope B', exact: true })).toBeVisible();
    await blankForm();
    await fill('Scope draft B', 'scope-b@example.test');
    scenarios.push('S01-pending-A-to-B-clears-draft-and-pending');
    await navigate(`/events/${eventA}`);
    await expect(page.getByRole('heading', { name: 'Synthetic scope A', exact: true })).toBeVisible();
    await blankForm();
    await fill('Scope fresh A', 'scope-fresh-a@example.test');
    const received = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/createEventRegistration'));
    release(); await fulfilled; await received; await settle();
    await expect(page.getByLabel('Název týmu')).toHaveValue('Scope fresh A');
    await expect(page.getByLabel('E-mail')).toHaveValue('scope-fresh-a@example.test');
    await expect(page.getByRole('button', { name: 'Přihlásit tým', exact: true })).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'Děkujeme, tým byl přihlášen.', exact: true })).toHaveCount(0);
    const acceptedA = await identity.db.collection(`events/${eventA}/registrations`).where('status', '==', 'accepted').get();
    expect(acceptedA.size).toBe(1);
    expect(acceptedA.docs[0].data().teamName).toBe('Scope submitted A');
    expect((await identity.db.collection(`events/${eventB}/registrations`).get()).size).toBe(0);
    scenarios.push('S02-A-to-B-to-A-real-old-response-preserves-new-draft-one-backend-registration');

    // Bootstrap one independent synthetic registration through the real anonymous callable.
    const response = await context.request.post(endpoint + 'createEventRegistration', { data: { data: {
      eventId: eventB, teamName: 'Scope managed B', memberCount: 2, contactEmail: 'scope-managed@example.test', requestKey: randomBytes(32).toString('base64url'),
    } } });
    expect(response.status()).toBe(200);
    const created = (await response.json()).result;
    expect(Boolean(created?.registrationId && created?.managementToken)).toBe(true);
    // Capability URL is used only for navigation, never written to evidence or screenshots.
    const managementPath = `/events/${eventB}/registration/manage#registration=${encodeURIComponent(created.registrationId)}&token=${encodeURIComponent(created.managementToken)}`;
    await navigate(managementPath);
    await expect(page.getByLabel('Název týmu')).toHaveValue('Scope managed B');
    await expect(page.getByLabel('Počet členů')).toHaveAttribute('max', '4');
    await page.getByLabel('Název týmu').fill('Scope managed edited B');
    await page.getByLabel('Počet členů').fill('3');
    await page.getByRole('button', { name: 'Uložit změny', exact: true }).click();
    await expect(page.getByText('Registrace byla upravena.', { exact: true })).toBeVisible();
    const registrationRef = identity.db.doc(`events/${eventB}/registrations/${created.registrationId}`);
    const edited = (await registrationRef.get()).data();
    expect(edited.teamName).toBe('Scope managed edited B'); expect(edited.memberCount).toBe(3); expect(edited.status).toBe('accepted');
    await navigate(`/events/${eventB}`);
    await expect(page.getByRole('heading', { name: 'Synthetic scope B', exact: true })).toBeVisible();
    await navigate(managementPath);
    await expect(page.getByLabel('Název týmu')).toHaveValue('Scope managed edited B');
    await expect(page.getByLabel('Počet členů')).toHaveValue('3');
    scenarios.push('S03-independent-management-edit-real-backend-and-return');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Zrušit registraci', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Registrace je zrušená', exact: true })).toBeVisible();
    expect((await registrationRef.get()).data().status).toBe('cancelled');
    expect((await identity.db.doc(`events/${eventB}`).get()).data().acceptedTeams).toBe(0);
    expect((await identity.db.doc(`events/${eventA}`).get()).data().acceptedTeams).toBe(1);
    scenarios.push('S04-management-soft-cancel-preserves-independent-event-A');
    expect(pageErrors.length).toBe(0);
    const dir = (process.env.JUSTKVIZ_QA_OUTPUT_ROOT || '.local-data/qa') + '/whole-evening/evidence';
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/stress-scope.json`, JSON.stringify({ status: 'PASS', scenarios,
      names: ['Scope submitted A', 'Scope fresh A', 'Scope managed edited B'],
      acceptedTeamsA: 1, acceptedTeamsB: 0, anonymousContexts: 1, browserErrors: pageErrors.length,
    }, null, 2));
  } finally {
    release();
    await context.close();
    await identity.dispose();
  }
});
