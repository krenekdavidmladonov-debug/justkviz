/* global document */
import { setTimeout as wait } from 'node:timers/promises';
import { expect, test } from '@playwright/test';
import { mediaFixture, syntheticAudio, syntheticImage } from '../e2e/media-fixture.mjs';
import { localEmulatorEndpoint, requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const projectId = 'demo-filmovy-kviz-v2';
const hosting = 'http://127.0.0.1:5000';
const gateway = 'http://127.0.0.1:5001';
const gatewayPath = '/' + projectId + '/europe-west1/readQuizMedia';
const allowedOrigins = new Set([hosting, gateway, 'http://127.0.0.1:8080', 'http://127.0.0.1:9099']);
const hiddenAnswer = 'Soukromá odpověď';

function requirePreflightEmulators(environment) {
  const { projectId: configuredProject, authEndpoint, firestoreEndpoint, functionsEndpoint } =
    requireFullEmulatorEnvironment(environment, 'Live event preflight');
  const storageEndpoint = localEmulatorEndpoint(environment.FIREBASE_STORAGE_EMULATOR_HOST, 'Live event preflight Storage');
  if (configuredProject !== projectId || authEndpoint.port !== 9099 || firestoreEndpoint.port !== 8080
    || functionsEndpoint.port !== 5001 || storageEndpoint.port !== 9199) {
    throw new Error('Live event preflight requires the dedicated demo project and its loopback emulator ports.');
  }
}

function allowEmulatorsOnly(context) {
  return context.route('**/*', route => {
    const url = new URL(route.request().url());
    return allowedOrigins.has(url.origin) ? route.continue() : route.abort('blockedbyclient');
  });
}

function gatewayReference(requestUrl) {
  const url = new URL(requestUrl);
  return url.origin === gateway && url.pathname === gatewayPath ? url.searchParams.get('reference') : null;
}

function recordGatewayResponse(page, reference) {
  let observed;
  page.on('response', response => {
    if (response.request().method() !== 'GET' || gatewayReference(response.url()) !== reference) return;
    const headers = response.headers();
    observed = {
      status: response.status(),
      mime: headers['content-type']?.split(';')[0],
      noStore: headers['cache-control'] === 'no-store',
    };
  });
  return () => observed;
}

async function openModerator(page, fixture, sessionId) {
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill(fixture.loginEmail);
  await page.getByLabel('Heslo').fill(fixture.loginPassword);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page).toHaveURL(/\/admin$/u);
  await page.goto('/admin/live/' + sessionId);
}

test('REL-01 reaches Hosting, decodes an owned projector image and plays owned native audio', async ({ browser, context, page, baseURL }, testInfo) => {
  requirePreflightEmulators(process.env);
  if (baseURL !== hosting) throw new Error('Live event preflight requires the loopback Hosting emulator.');

  const fixture = await mediaFixture();
  const publicContext = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    await allowEmulatorsOnly(context);
    await allowEmulatorsOnly(publicContext);
    const projector = await publicContext.newPage();
    const prompt = await fixture.upload('image', syntheticImage(), 'image/png');
    const answer = await fixture.upload('image', syntheticImage(), 'image/png');
    const audio = await fixture.upload('audio', syntheticAudio(), 'audio/wav');
    await fixture.update('image', { questionImage: prompt.reference, answerImage: answer.reference });
    await fixture.update('audio', { mediaSource: audio.reference, clipStartSeconds: 0, clipEndSeconds: 3 });
    await fixture.lock();
    const sessionId = await fixture.live();
    let privateMediaRequests = 0;
    projector.on('request', request => {
      const reference = gatewayReference(request.url());
      if (reference === answer.reference || reference === audio.reference) privateMediaRequests++;
    });

    await test.step('Verify Hosting reachability separately from media', async () => {
      await openModerator(page, fixture, sessionId);
      const diagnostics = page.locator('.focused-live-shell .live-diagnostics');
      await diagnostics.locator('summary').click();
      await diagnostics.getByRole('button', { name: 'Otestovat připojení' }).click();
      await expect(diagnostics.getByText(/Web JustKvíz odpověděl|Pomalá odezva webu JustKvíz/u)).toBeVisible();
    });

    await test.step('Verify the authorized gateway response and decoded projector image', async () => {
      const promptResponse = recordGatewayResponse(projector, prompt.reference);
      await fixture.navigate(sessionId, 3);
      await projector.goto('/projector/' + sessionId);
      await expect(projector.getByText('Syntetický obrázek', { exact: true })).toBeVisible();
      const image = projector.getByAltText('Obrázek k otázce');
      await expect(image).toHaveJSProperty('naturalWidth', 8);
      await expect(image).toHaveJSProperty('naturalHeight', 4);
      await expect.poll(promptResponse).toEqual({ status: 200, mime: 'image/png', noStore: true });
      await expect(projector.getByText(hiddenAnswer, { exact: true })).toHaveCount(0);
      const denied = await fixture.read(answer.reference, { sessionId });
      expect(denied.status).toBe(404);
      expect((await denied.arrayBuffer()).byteLength).toBe(0);
    });

    await test.step('Verify Play and Stop through the actual WAV gateway response', async () => {
      const audioResponse = recordGatewayResponse(page, audio.reference);
      await page.evaluate(() => {
        document.addEventListener('playing', event => {
          if (event.target?.nodeName === 'AUDIO') document.documentElement.dataset.nativeAudioPlayed = 'true';
        }, true);
      });
      await fixture.navigate(sessionId, 4);
      await expect(projector.getByText('Syntetické audio', { exact: true })).toBeVisible();
      await expect(projector.locator('audio, video, iframe')).toHaveCount(0);
      const denied = await fixture.read(audio.reference, { sessionId });
      expect(denied.status).toBe(404);
      expect((await denied.arrayBuffer()).byteLength).toBe(0);

      const player = page.locator('audio');
      await expect(player).toHaveCount(1);
      await expect(player).toHaveJSProperty('paused', true);
      await expect(page.locator('html')).not.toHaveAttribute('data-native-audio-played', 'true');
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-native-audio-played', 'true');
      await expect.poll(audioResponse).toEqual({ status: 200, mime: 'audio/wav', noStore: true });
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(player).toHaveJSProperty('paused', true);
      await expect.poll(async () => (await fixture.db.doc('sessions/' + sessionId).get()).data()?.mediaCommand).toBe('stop');
      expect(privateMediaRequests).toBe(0);
    });

    await testInfo.attach('live-event-preflight', {
      body: JSON.stringify({
        hosting: 'pass', ownedPngGateway: 'pass', projectorImage: 'pass',
        ownedWavGateway: 'pass', nativePlayStop: 'pass', privateBytesWithheld: 'pass',
        physicalProjectorAndSound: 'not-run', venueNetworkAndHotspot: 'not-run',
      }),
      contentType: 'application/json',
    });
  } finally {
    await publicContext.close();
    await fixture.dispose();
  }
});

test('OBS-01 keeps gateway failures visible with diagnostics closed and clears them after manual retry', async ({ context, page, baseURL }, testInfo) => {
  requirePreflightEmulators(process.env);
  if (baseURL !== hosting) throw new Error('Live event preflight requires the loopback Hosting emulator.');

  const fixture = await mediaFixture();
  try {
    await allowEmulatorsOnly(context);
    const prompt = await fixture.upload('image', syntheticImage(), 'image/png');
    await fixture.update('image', { questionImage: prompt.reference });
    await fixture.lock();
    const sessionId = await fixture.live();
    await openModerator(page, fixture, sessionId);
    const diagnostics = page.locator('.live-diagnostics');
    await expect(diagnostics).toHaveJSProperty('open', false);
    await expect(page.locator('.focused-live-shell')).toHaveAttribute('data-current-position', '0');

    const projector = await context.newPage();
    const promptResponse = recordGatewayResponse(projector, prompt.reference);
    const rawText = 'SYNTHETIC GATEWAY RESPONSE DETAIL';
    const rawUrl = 'https://synthetic.invalid/protected-gateway-reference';
    const matchPrompt = url => gatewayReference(url.href) === prompt.reference && url.searchParams.get('sessionId') === sessionId;
    let responseStatus = 429;
    let injectedRequests = 0;
    const injectFailure = route => {
      if (route.request().method() !== 'GET') return route.fallback();
      injectedRequests++;
      return route.fulfill({
        status: responseStatus,
        headers: { 'access-control-allow-origin': hosting, 'cache-control': 'no-store' },
        contentType: 'text/plain',
        body: rawText + ' ' + rawUrl,
      });
    };
    await projector.route(matchPrompt, injectFailure);
    await projector.goto('/projector/' + sessionId);
    await expect(projector.getByText('Čekáme na první slide')).toBeVisible();
    await fixture.navigate(sessionId, 3);

    const retry = projector.getByRole('button', { name: 'Zkusit načíst znovu', exact: true });
    const alert = page.locator('.live-media-alert');
    for (const [status, reason, message] of [
      [429, 'gateway-throttled', 'omezila počet požadavků'],
      [500, 'gateway-error', 'vrátila chybu'],
    ]) {
      await expect(alert).toBeVisible();
      await expect(alert).toHaveAttribute('data-media-issue', reason);
      await expect(alert).toContainText(message);
      await expect(diagnostics).toHaveJSProperty('open', false);
      for (const tab of [page, projector]) {
        await expect(tab.locator('body')).not.toContainText(rawText);
        await expect(tab.locator('body')).not.toContainText(rawUrl);
      }
      await expect(retry).toBeVisible();
      // Observe a stable failure before any explicit retry.
      await wait(750);
      expect(injectedRequests).toBe(status === 429 ? 1 : 2);
      if (status === 429) {
        responseStatus = 500;
        await retry.click();
      }
    }

    await projector.unroute(matchPrompt, injectFailure);
    await retry.click();
    await expect(projector.getByAltText('Obrázek k otázce')).toHaveJSProperty('naturalWidth', 8);
    await expect.poll(promptResponse).toEqual({ status: 200, mime: 'image/png', noStore: true });
    await expect(alert).toHaveCount(0);
    await expect(diagnostics).toHaveJSProperty('open', false);
    await testInfo.attach('gateway-diagnostics', {
      body: JSON.stringify({ throttled: 'pass', gatewayError: 'pass', manualRetry: 'pass', rawDetailWithheld: 'pass' }),
      contentType: 'application/json',
    });
  } finally {
    await fixture.dispose();
  }
});
