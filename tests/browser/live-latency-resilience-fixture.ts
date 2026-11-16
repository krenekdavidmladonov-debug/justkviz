import { expect, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';

export const hostingOrigin = 'http://127.0.0.1:5000';
export const firestoreOrigin = 'http://127.0.0.1:8080';
export const functionsOrigin = 'http://127.0.0.1:5001/demo-filmovy-kviz-v2/europe-west1';
export const navigationUrl = `${functionsOrigin}/goToSlide`;
const emulatorOrigins = new Set([hostingOrigin, firestoreOrigin, new URL(functionsOrigin).origin, 'http://127.0.0.1:9099', 'http://127.0.0.1:9199']);
export const question = 'Syntetický veřejný prompt';
export const imageQuestion = 'Syntetická obrázková otázka';
export const agenda = 'Syntetická agenda';
export const questionImage = 'https://example.test/image.jpg';
export const answer = 'Syntetická odpověď';
export const answerImage = 'https://example.test/answer.jpg';

export async function localContext(browser: Browser) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (emulatorOrigins.has(url.origin)) return route.continue();
    if (url.origin === 'https://example.test') {
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>',
      });
    }
    return route.abort('blockedbyclient');
  });
  return context;
}

export function holdRequest() {
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  return { held, release };
}

export function trace(page: Page) {
  return page.locator('[data-latency-status]');
}

export function stage(page: Page, name: string, target?: string) {
  const targetSelector = target === undefined ? '' : `[data-latency-target="${target}"]`;
  return trace(page).locator(`[data-latency-stage="${name}"]${targetSelector}`);
}

export async function expectPosition(page: Page, position: number) {
  await expect(page.locator('.focused-live-shell')).toHaveAttribute('data-current-position', String(position));
}

export function navigate(page: Page, direction: 'next' | 'previous' = 'next') {
  const name = direction === 'next' ? 'Další →' : '← Předchozí';
  return page.getByRole('button', { name, exact: true }).click();
}

export async function jumpToQuestion(page: Page, number: number) {
  await page.getByRole('button', { name: 'Přejít na otázku', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: `1. kolo, otázka ${number}`, exact: true }).click();
}

export async function mockYouTube(context: BrowserContext) {
  await context.route('https://www.youtube.com/iframe_api', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      (() => {
        class Player {
          constructor(element, { events }) {
            this.events = events;
            queueMicrotask(() => events.onReady());
          }
          cueVideoById() {}
          loadVideoById() { this.playVideo(); }
          playVideo() { queueMicrotask(() => this.events.onStateChange({ data: 1 })); }
          pauseVideo() {}
          seekTo() {}
          destroy() {}
        }
        window.YT = { Player, PlayerState: { ENDED: 0, PLAYING: 1 } };
        window.onYouTubeIframeAPIReady?.();
      })();`,
  }));
}

export async function startSession(context: BrowserContext, baseURL: string | undefined) {
  expect(baseURL).toBe(hostingOrigin);
  const moderator = await context.newPage();
  await moderator.goto(`${hostingOrigin}/admin/login`);
  await moderator.getByLabel('E-mail').fill('admin@example.test');
  await moderator.getByLabel('Heslo').fill('LocalQuiz123!');
  await moderator.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(moderator).toHaveURL(/\/admin$/u);
  await moderator.goto(`${hostingOrigin}/admin/quizzes/projector-lifecycle-e2e`);
  await moderator.getByRole('button', { name: 'Spustit kvíz' }).click();
  await expect(moderator).toHaveURL(/\/admin\/live\/[^/]+$/u);
  const sessionId = new URL(moderator.url()).pathname.split('/').at(-1);
  const projectorUrl = `${hostingOrigin}/projector/${sessionId}?latency=1`;
  await moderator.goto(`${moderator.url()}?latency=1`);
  await expectPosition(moderator, 0);
  const diagnostics = moderator.locator('.live-diagnostics');
  await diagnostics.locator('summary').click();
  await expect(diagnostics.getByText('Časy posledního měřeného příkazu', { exact: true })).toBeVisible();
  return { moderator, projectorUrl };
}

export async function endSession(moderator: Page, projector: Page) {
  await moderator.getByText('Další možnosti', { exact: true }).click();
  await moderator.getByRole('button', { name: 'Ukončit kvíz' }).click();
  await expect(projector.getByText('Kvíz skončil')).toBeVisible();
}

export async function watchProjection(page: Page, forbiddenTexts: string[] = [], forbiddenImages: string[] = [], startImmediately = true) {
  let watching = startImmediately;
  let forbiddenRequests = 0;
  page.on('request', request => {
    if (watching && (request.url() === answerImage || forbiddenImages.includes(request.url()))) forbiddenRequests++;
  });
  await page.addInitScript(({ texts, images, enabled }) => {
    let watching = enabled;
    window.addEventListener('start-synthetic-projection-watch', () => { watching = true; });
    new MutationObserver(() => {
      const root = document.documentElement;
      if (!root) return;
      root.dataset.unexpectedProjection ??= 'false';
      if (!watching) return;
      const text = document.querySelector('.projector-viewport')?.textContent ?? '';
      if (texts.some(item => text.includes(item)) || document.querySelector('.slide-answer') ||
        images.some(url => document.querySelector(`img[src="${url}"]`))) {
        root.dataset.unexpectedProjection = 'true';
      }
    }).observe(document, { childList: true, characterData: true, attributes: true, attributeFilter: ['src'], subtree: true });
  }, { texts: [answer, ...forbiddenTexts], images: [answerImage, ...forbiddenImages], enabled: startImmediately });
  return {
    start: async () => {
      watching = true;
      await page.evaluate(() => { window.dispatchEvent(new Event('start-synthetic-projection-watch')); });
    },
    assertSafe: async () => {
      await expect(page.locator('html')).toHaveAttribute('data-unexpected-projection', 'false');
      expect(forbiddenRequests).toBe(0);
    },
  };
}

export function isFirestoreListen(url: URL) {
  return url.origin === firestoreOrigin && url.pathname.endsWith('/google.firestore.v1.Firestore/Listen/channel');
}

export async function monitorConnectivity(page: Page) {
  await page.addInitScript(() => {
    const recordEvent = () => {
      const root = document.documentElement;
      root.dataset.connectivityEvents = String(Number(root.dataset.connectivityEvents ?? '0') + 1);
    };
    window.addEventListener('online', recordEvent);
    window.addEventListener('offline', recordEvent);
  });
  return () => page.evaluate(() => ({
    online: navigator.onLine, events: Number(document.documentElement.dataset.connectivityEvents ?? '0'),
  }));
}

export async function allowListenAbort(page: Page) {
  await page.addInitScript(origin => {
    const nativeFetch = window.fetch.bind(window);
    const streams: AbortController[] = [];
    window.fetch = (input, init) => {
      const requestUrl = new URL(input instanceof Request ? input.url : input, location.href);
      if (requestUrl.origin !== origin || !requestUrl.pathname.endsWith('/google.firestore.v1.Firestore/Listen/channel')) {
        return nativeFetch(input, init);
      }
      const controller = new AbortController();
      streams.push(controller);
      if (streams.length > 32) streams.shift();
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      return nativeFetch(input, { ...init, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
    };
    window.addEventListener('abort-synthetic-listen', () => streams.splice(0).forEach(stream => stream.abort()));
  }, firestoreOrigin);
  return () => page.evaluate(() => { window.dispatchEvent(new Event('abort-synthetic-listen')); });
}

export async function callableRevision(response: Pick<Awaited<ReturnType<Route['fetch']>>, 'ok' | 'json'>) {
  expect(response.ok()).toBe(true);
  const body = await response.json() as { result?: { revision?: unknown } };
  const revision = body.result?.revision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) throw new Error('Expected a committed callable revision');
  return revision;
}
