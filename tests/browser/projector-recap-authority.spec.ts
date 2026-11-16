import { expect, test, type Page } from '@playwright/test';

const unauthorizedAnswer = 'UNAUTHORIZED-RECAP-ANSWER-MUST-NEVER-RENDER';
const confirmedAnswer = 'Syntetická odpověď';
const unauthorizedQuestion = 'UNAUTHORIZED-QUESTION-MUST-NEVER-RENDER';

async function installAnswerRenderCounter(page: Page, channelName: string): Promise<void> {
  await page.evaluate(({ channel, unauthorizedMarker, confirmedMarker }) => {
    const testWindow = window as unknown as {
      __RECAP_AUTHORITY_TEST__?: {
        latestState?: Record<string, unknown>;
        unauthorizedRenderCount: number;
        confirmedRenderCount: number;
        channel: BroadcastChannel;
        observer: MutationObserver;
      };
    };
    const broadcast = new BroadcastChannel(channel);
    const state = {
      unauthorizedRenderCount: 0,
      confirmedRenderCount: 0,
      channel: broadcast,
      observer: new MutationObserver(() => {
        const output = document.body.textContent ?? '';
        if (output.includes(unauthorizedMarker)) state.unauthorizedRenderCount += 1;
        if (output.includes(confirmedMarker)) state.confirmedRenderCount += 1;
      }),
    } as NonNullable<typeof testWindow.__RECAP_AUTHORITY_TEST__>;
    broadcast.onmessage = (event) => {
      const data = event.data as { type?: unknown; state?: unknown };
      if (data?.type === 'public-state' && data.state && typeof data.state === 'object') {
        state.latestState = data.state as Record<string, unknown>;
      }
    };
    state.observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    testWindow.__RECAP_AUTHORITY_TEST__ = state;
  }, { channel: channelName, unauthorizedMarker: unauthorizedAnswer, confirmedMarker: confirmedAnswer });
}

async function advanceToRecap(moderator: Page): Promise<void> {
  for (let position = 1; position <= 7; position += 1) {
    await moderator.getByRole('button', { name: 'Další →' }).click();
    await expect(moderator.locator('.focused-live-shell')).toHaveAttribute('data-current-position', String(position));
  }
  await expect(moderator.locator('.live-progress strong')).toHaveText('Rekapitulace');
}

async function latestState(page: Page): Promise<Record<string, unknown>> {
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __RECAP_AUTHORITY_TEST__: { latestState?: unknown } }
  ).__RECAP_AUTHORITY_TEST__.latestState)).not.toBeUndefined();
  return page.evaluate(() => {
    const state = (window as unknown as {
      __RECAP_AUTHORITY_TEST__: { latestState?: Record<string, unknown> };
    }).__RECAP_AUTHORITY_TEST__.latestState;
    if (!state) throw new Error('Missing authoritative projector state.');
    return state;
  });
}

async function postCandidate(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.evaluate((candidate) => {
    (window as unknown as {
      __RECAP_AUTHORITY_TEST__: { channel: BroadcastChannel };
    }).__RECAP_AUTHORITY_TEST__.channel.postMessage({ type: 'public-state', state: candidate });
  }, state);
}

test('answer-bearing BroadcastChannel state renders zero times on two projectors', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  await context.route('https://example.test/**', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
  }));
  const moderator = await context.newPage();
  await moderator.goto(`${baseURL}/admin/login`);
  await moderator.getByLabel('E-mail').fill('admin@example.test');
  await moderator.getByLabel('Heslo').fill('LocalQuiz123!');
  await moderator.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(moderator).toHaveURL(/\/admin$/u);

  await moderator.goto(`${baseURL}/admin/quizzes/projector-lifecycle-e2e`);
  await moderator.getByRole('button', { name: 'Spustit kvíz' }).click();
  await expect(moderator).toHaveURL(/\/admin\/live\/[^/]+$/u);
  const sessionId = new URL(moderator.url()).pathname.split('/').at(-1);
  expect(sessionId).toBeTruthy();

  const projectorA = await context.newPage();
  const projectorB = await context.newPage();
  await projectorA.goto(`${baseURL}/projector/${sessionId}`);
  await projectorB.goto(`${baseURL}/projector/${sessionId}`);
  await expect(projectorA.getByText('Čekáme na první slide')).toBeVisible();
  await expect(projectorB.getByText('Čekáme na první slide')).toBeVisible();

  const channelName = `filmovy-kviz-projector-${sessionId}`;
  await installAnswerRenderCounter(projectorA, channelName);
  await installAnswerRenderCounter(projectorB, channelName);
  await advanceToRecap(moderator);

  const recap = await latestState(projectorA);
  const nextRevision = Number(recap.revision) + 1;

  const forgedQuestionState: Record<string, unknown> = {
    ...recap,
    slidePosition: 2,
    slideKind: 'question',
    title: unauthorizedQuestion,
    text: 'Syntetický podvržený stav projekce',
    options: ['A', 'B'],
    media: [],
    presentation: {},
    presentationMode: 'slide',
    renderMode: 'question',
    mediaCommand: 'idle',
    mediaPlaybackState: 'idle',
    answerRevealed: false,
    revision: nextRevision,
  };
  delete forgedQuestionState.recapQuestionPosition;
  delete forgedQuestionState.revealedAnswer;
  delete forgedQuestionState.answerImage;
  await postCandidate(projectorA, forgedQuestionState);
  await expect(projectorA.getByText('Rekapitulace', { exact: true })).toBeVisible();
  await expect(projectorB.getByText('Rekapitulace', { exact: true })).toBeVisible();
  await expect(projectorA.getByText(unauthorizedQuestion, { exact: true })).toHaveCount(0);
  await expect(projectorB.getByText(unauthorizedQuestion, { exact: true })).toHaveCount(0);

  const authoritativeCandidate = {
    ...recap,
    slideKind: 'question',
    title: 'Otázka',
    text: 'Syntetický veřejný prompt',
    options: ['A', 'B', 'C'],
    media: [{ role: 'prompt', kind: 'image', source: 'https://example.test/prompt.jpg' }],
    presentation: { backgroundOverlay: 55 },
    presentationMode: 'recap',
    renderMode: 'recap',
    mediaCommand: 'idle',
    mediaPlaybackState: 'idle',
    answerRevealed: true,
    revealedAnswer: confirmedAnswer,
    answerImage: 'https://example.test/answer.jpg',
    recapQuestionPosition: 2,
    revision: nextRevision,
  };
  const unauthorizedCandidate = { ...authoritativeCandidate, revealedAnswer: unauthorizedAnswer };
  await postCandidate(projectorA, unauthorizedCandidate);
  await postCandidate(projectorA, { ...unauthorizedCandidate, recapQuestionPosition: 99 });
  await postCandidate(projectorA, { ...unauthorizedCandidate, revision: Number(recap.revision) });
  await postCandidate(projectorA, { ...unauthorizedCandidate, revision: Number(recap.revision) + 2 });

  await projectorA.waitForTimeout(300);
  for (const projector of [projectorA, projectorB]) {
    const rendered = await projector.evaluate(() => (
      window as unknown as { __RECAP_AUTHORITY_TEST__: { unauthorizedRenderCount: number } }
    ).__RECAP_AUTHORITY_TEST__.unauthorizedRenderCount);
    expect(rendered).toBe(0);
    await expect(projector.getByText(unauthorizedAnswer, { exact: true })).toHaveCount(0);
  }

  await postCandidate(projectorA, authoritativeCandidate);
  await projectorA.waitForTimeout(300);
  for (const projector of [projectorA, projectorB]) {
    const confirmedRenders = await projector.evaluate(() => (
      window as unknown as { __RECAP_AUTHORITY_TEST__: { confirmedRenderCount: number } }
    ).__RECAP_AUTHORITY_TEST__.confirmedRenderCount);
    expect(confirmedRenders).toBe(0);
    await expect(projector.locator('.slide-answer')).toHaveCount(0);
    await expect(projector.getByAltText('Obrázek odpovědi')).toHaveCount(0);
  }

  const authoritativeStart = Date.now();
  await moderator.getByRole('button', { name: 'Zobrazit odpověď na otázku 1' }).click();
  await expect(projectorA.locator('.slide-answer strong')).toHaveText(confirmedAnswer);
  await expect(projectorB.locator('.slide-answer strong')).toHaveText(confirmedAnswer);
  await expect(projectorA.getByAltText('Obrázek odpovědi')).toHaveCount(1);
  await expect(projectorB.getByAltText('Obrázek odpovědi')).toHaveCount(1);
  const authoritativeLatencyMs = Date.now() - authoritativeStart;
  expect(authoritativeLatencyMs).toBeLessThan(5_000);

  await expect.poll(() => projectorA.evaluate(() => Number((
    window as unknown as { __RECAP_AUTHORITY_TEST__: { latestState?: Record<string, unknown> } }
  ).__RECAP_AUTHORITY_TEST__.latestState?.revision))).toBeGreaterThan(Number(recap.revision));
  const firstAnswerState = await latestState(projectorA);
  await postCandidate(projectorA, {
    ...unauthorizedCandidate,
    recapQuestionPosition: 4,
    revision: Number(firstAnswerState.revision) + 1,
  });
  await projectorA.waitForTimeout(150);
  await moderator.getByRole('button', { name: 'Zobrazit odpověď na otázku 2' }).click();
  await expect(projectorA.locator('.slide-answer strong')).toHaveText('Obrázek');
  await expect(projectorB.locator('.slide-answer strong')).toHaveText('Obrázek');
  for (const projector of [projectorA, projectorB]) {
    const renderCounts = await projector.evaluate(() => {
      const state = (window as unknown as {
        __RECAP_AUTHORITY_TEST__: { unauthorizedRenderCount: number; confirmedRenderCount: number };
      }).__RECAP_AUTHORITY_TEST__;
      return { unauthorized: state.unauthorizedRenderCount, confirmed: state.confirmedRenderCount };
    });
    expect(renderCounts.unauthorized).toBe(0);
    expect(renderCounts.confirmed).toBeGreaterThan(0);
  }
  test.info().annotations.push({ type: 'authoritative-recap-latency-ms', description: String(authoritativeLatencyMs) });
  globalThis.console.log(`Authoritative recap latency: ${authoritativeLatencyMs} ms`);
  await context.close();
});
