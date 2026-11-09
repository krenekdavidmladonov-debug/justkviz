import { writeFile } from 'node:fs/promises';
import { expect, test, type Page, type Request } from '@playwright/test';
import {
  agenda, allowListenAbort, answer, answerImage, callableRevision, endSession, expectPosition, holdRequest, imageQuestion,
  isFirestoreListen, jumpToQuestion, localContext, mockYouTube, monitorConnectivity, navigate, navigationUrl, question,
  questionImage, stage, startSession, trace, watchProjection,
} from './live-latency-resilience-fixture';

test('recovers a projector after the initial Firestore transport fails while the browser stays online', { tag: '@transport' }, async ({ browser, baseURL }, testInfo) => {
  const moderatorContext = await localContext(browser);
  const projectorContext = await localContext(browser);
  try {
    const { moderator, projectorUrl } = await startSession(moderatorContext, baseURL);
    for (const position of [1, 2, 3, 4]) {
      await navigate(moderator);
      await expectPosition(moderator, position);
    }

    const projector = await projectorContext.newPage();
    const { assertSafe: assertNoStaleProjection } = await watchProjection(projector, [imageQuestion, agenda], [questionImage]);
    const connectivity = await monitorConnectivity(projector);

    let blocked = true;
    let failedRequests = 0;
    let restoredRequests = 0;
    await projector.route(isFirestoreListen, route => {
      if (blocked) {
        failedRequests++;
        return route.abort('connectionfailed');
      }
      restoredRequests++;
      return route.fallback();
    });
    await projector.goto(projectorUrl);
    await expect.poll(() => failedRequests).toBeGreaterThan(0);
    const disconnected = projector.getByRole('heading', { name: 'Projektor není připojen' });
    await expect(disconnected).toBeVisible();
    expect(await connectivity()).toEqual({ online: true, events: 0 });

    for (const position of [3, 2]) {
      await navigate(moderator, 'previous');
      await expectPosition(moderator, position);
    }
    await expect(disconnected).toBeVisible();
    await expect(projector.getByText(question, { exact: true })).toHaveCount(0);
    await assertNoStaleProjection();

    const started = performance.now();
    blocked = false;
    await expect(projector.getByText(question, { exact: true }), 'project the latest state without an online event or reload').toBeVisible();
    const recoveryMs = Math.round(performance.now() - started);
    expect(restoredRequests).toBeGreaterThan(0);
    expect(await connectivity()).toEqual({ online: true, events: 0 });
    await assertNoStaleProjection();

    // End the session on the healthy moderator to verify the recovered projector is listening.
    await endSession(moderator, projector);
    expect(await connectivity()).toEqual({ online: true, events: 0 });
    await assertNoStaleProjection();
    const sample = { recoveryMs, failedRequests, restoredRequests, onlineOfflineEvents: 0 };
    await testInfo.attach('firestore-transport-recovery', { body: JSON.stringify(sample), contentType: 'application/json' });
    console.log(`Firestore startup transport recovery: ${JSON.stringify(sample)}`);
  } finally {
    await projectorContext.close();
    await moderatorContext.close();
  }
});

test('clears a previously revealed slide when an active Firestore stream fails and resumes with fresh state', { tag: '@active-stream' }, async ({ browser, baseURL }, testInfo) => {
  const moderatorContext = await localContext(browser);
  const projectorContext = await localContext(browser);
  try {
    const { moderator, projectorUrl } = await startSession(moderatorContext, baseURL);
    const projector = await projectorContext.newPage();
    const safety = await watchProjection(projector, [question, imageQuestion], [questionImage], false);
    const connectivity = await monitorConnectivity(projector);
    const abortActiveListen = await allowListenAbort(projector);
    const activeRequests = new Set<Request>();
    const openAtFailure = new Set<Request>();
    let failedActiveRequests = 0;
    let blocked = false;
    projector.on('request', request => {
      if (request.method() === 'GET' && isFirestoreListen(new URL(request.url()))) activeRequests.add(request);
    });
    projector.on('requestfinished', request => activeRequests.delete(request));
    projector.on('requestfailed', request => {
      activeRequests.delete(request);
      if (openAtFailure.has(request)) failedActiveRequests++;
    });
    await projector.route(isFirestoreListen, route => blocked ? route.abort('connectionfailed') : route.fallback());

    await projector.goto(projectorUrl);
    await expect(projector.getByText('Čekáme na první slide')).toBeVisible();
    await jumpToQuestion(moderator, 1);
    await expectPosition(moderator, 2);
    await expect(projector.getByText(question, { exact: true })).toBeVisible();
    await expect(projector.getByText(answer, { exact: true })).toHaveCount(0);
    await moderator.getByRole('button', { name: 'Odhalit odpověď', exact: true }).click();
    await expect(projector.getByText(answer, { exact: true })).toBeVisible();
    await expect(projector.locator(`img[src="${answerImage}"]`)).toHaveJSProperty('naturalWidth', 8);
    await expect.poll(() => activeRequests.size).toBeGreaterThan(0);

    const droppedAt = performance.now();
    for (const request of activeRequests) openAtFailure.add(request);
    blocked = true;
    await abortActiveListen();
    await expect.poll(() => failedActiveRequests).toBeGreaterThan(0);
    const disconnected = projector.getByRole('heading', { name: 'Projektor není připojen' });
    await expect(disconnected).toBeVisible({ timeout: 45_000 });
    const clearedMs = Math.round(performance.now() - droppedAt);
    await expect(projector.getByText(answer, { exact: true })).toHaveCount(0);
    await expect(projector.locator(`img[src="${answerImage}"]`)).toHaveCount(0);
    expect(await connectivity()).toEqual({ online: true, events: 0 });
    await safety.start();

    await jumpToQuestion(moderator, 2);
    await expectPosition(moderator, 4);
    await navigate(moderator, 'previous');
    await expectPosition(moderator, 3);
    await expect(disconnected).toBeVisible();
    await safety.assertSafe();

    const restoredAt = performance.now();
    blocked = false;
    await expect(projector.getByText(agenda, { exact: true })).toBeVisible({ timeout: 30_000 });
    const recoveryMs = Math.round(performance.now() - restoredAt);
    expect(await connectivity()).toEqual({ online: true, events: 0 });
    await safety.assertSafe();
    await endSession(moderator, projector);
    await safety.assertSafe();
    const sample = { clearedMs, recoveryMs, failedActiveRequests, onlineOfflineEvents: 0 };
    await testInfo.attach('active-firestore-transport-recovery', { body: JSON.stringify(sample), contentType: 'application/json' });
    console.log(`Active Firestore transport recovery: ${JSON.stringify(sample)}`);
  } finally {
    await projectorContext.close();
    await moderatorContext.close();
  }
});

interface TimingSample {
  pass: number;
  transition: string;
  status: 'confirmed' | 'unconfirmed' | 'failed';
  ms: Record<string, number | null>;
}

const timingStages = ['dispatched', 'callable', 'snapshot', 'frame'];
const repeatPasses = 10;

async function readStages(moderator: Page) {
  return trace(moderator).locator('[data-latency-ms]').evaluateAll(rows => Object.fromEntries(rows.map(row => {
    const name = row.getAttribute('data-latency-stage');
    const target = row.getAttribute('data-latency-target');
    return [target ? `${name}:${target}` : name, Number(row.getAttribute('data-latency-ms'))];
  })) as Record<string, number>);
}

function summarize(samples: TimingSample[]) {
  return Object.fromEntries([...new Set(samples.map(sample => sample.transition))].map(transition => {
    const attempts = samples.filter(sample => sample.transition === transition);
    const stages = new Set(attempts.flatMap(sample => Object.keys(sample.ms)));
    const distributions = Object.fromEntries([...stages].map(name => {
      const values = attempts.flatMap(sample => {
        const value = sample.status === 'confirmed' ? sample.ms[name] : null;
        return value == null ? [] : [value];
      }).sort((a, b) => a - b);
      const n = values.length;
      const lo = values[Math.floor((n - 1) / 2)];
      const hi = values[Math.floor(n / 2)];
      return [name, {
        count: n,
        missing: attempts.filter(sample => sample.status === 'confirmed').length - n,
        median: lo === undefined || hi === undefined ? null : (lo + hi) / 2,
        p95: values[Math.ceil(n * 0.95) - 1] ?? null,
        max: values.at(-1) ?? null,
      }];
    }));
    return [transition, {
      attempts: attempts.length,
      failed: attempts.filter(sample => sample.status === 'failed').length,
      unconfirmed: attempts.filter(sample => sample.status === 'unconfirmed').length,
      distributions,
    }];
  }));
}

test('measures first-pass and repeated navigation and playback slices in a bounded local matrix', { tag: '@matrix' }, async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(360_000);
  const context = await localContext(browser);
  const samples: TimingSample[] = [];
  try {
    await mockYouTube(context);
    const { moderator, projectorUrl } = await startSession(context, baseURL);
    const projector = await context.newPage();
    const { assertSafe: assertNoAnswer } = await watchProjection(projector);
    await projector.goto(projectorUrl);
    await expect(projector.getByText('Čekáme na první slide')).toBeVisible();
    const videoPlayer = projector.locator('.projector-video-player');
    const videoPresentation = projector.locator('.video-presentation');
    const play = () => moderator.getByRole('button', { name: 'Play', exact: true }).click();

    async function measure(pass: number, transition: string, action: () => Promise<void>, verify: () => Promise<void>, mediaStages: string[] = []) {
      const expected = [...timingStages, ...mediaStages];
      const heading = trace(moderator).locator('p').first();
      const previous = (await heading.allTextContents()).at(0);
      const sample: TimingSample = { pass, transition, status: 'unconfirmed', ms: {} };
      for (const key of [...expected, 'callableDuration', 'dispatchToSnapshot', 'snapshotToFrame']) sample.ms[key] = null;
      samples.push(sample);
      try {
        await action();
        await expect(heading).toBeVisible();
        if (previous !== undefined) await expect(heading).not.toHaveText(previous);
        await expect(trace(moderator)).toHaveAttribute('data-latency-status', /^(confirmed|failed)$/u);
        const status = await trace(moderator).getAttribute('data-latency-status');
        if (status === 'failed') sample.status = 'failed';
        await verify();
        if (status !== 'confirmed') return;
        sample.status = 'confirmed';
        try {
          await expect.poll(async () => {
            const actual = await readStages(moderator);
            return expected.filter(name => actual[name] === undefined);
          }, { timeout: 3_000 }).toEqual([]);
        } catch {
          // Missing stages are reported independently of successful navigation or playback.
        }
        const actual = await readStages(moderator);
        for (const name of expected) sample.ms[name] = actual[name] ?? null;
        const { dispatched, callable, snapshot, frame } = actual;
        if (callable !== undefined && dispatched !== undefined) sample.ms.callableDuration = callable - dispatched;
        if (snapshot !== undefined && dispatched !== undefined) sample.ms.dispatchToSnapshot = snapshot - dispatched;
        if (frame !== undefined && snapshot !== undefined) sample.ms.snapshotToFrame = frame - snapshot;
      } catch (error) {
        sample.status = 'failed';
        throw error;
      }
    }

    const showsTextAt = (position: number, text: string) => async () => {
      await expectPosition(moderator, position);
      await expect(projector.getByText(text, { exact: true })).toBeVisible();
    };
    await measure(0, 'waiting → text prompt', () => jumpToQuestion(moderator, 1), showsTextAt(2, question));

    for (let pass = 0; pass <= repeatPasses; pass++) {
      await measure(pass, 'text prompt → image', () => jumpToQuestion(moderator, 2), async () => {
        await showsTextAt(4, imageQuestion)();
        await expect(projector.getByAltText('Obrázek k otázce')).toHaveJSProperty('naturalWidth', 8);
      }, ['image-ready:question-image']);
      await measure(pass, 'image → video', () => jumpToQuestion(moderator, 4), async () => {
        await showsTextAt(6, 'Syntetická video otázka')();
        await expect(videoPlayer).toHaveCount(1);
        await expect(videoPresentation).toHaveCount(0);
      }, ['player-mounted:video', 'player-cued:video']);
      await measure(pass, 'video Play', play, async () => {
        await expect(videoPresentation).toBeVisible();
        await expect(videoPlayer).toHaveCount(1);
        await expect(moderator.locator('.media-controls [role="status"]')).toHaveText('Přehrává se');
      }, ['player-ready:video', 'player-playing:video']);
      await measure(pass, 'video → audio', () => navigate(moderator, 'previous'), async () => {
        await showsTextAt(5, 'Syntetická audio otázka')();
        await expect(videoPlayer).toHaveCount(0);
        await expect(videoPresentation).toHaveCount(0);
      });
      await measure(pass, 'audio Play', play, async () => {
        await expect(projector.locator('.vinyl-visual.is-playing')).toBeVisible();
        await expect(videoPlayer).toHaveCount(0);
        await expect(moderator.locator('.media-controls [role="status"]')).toHaveText('Přehrává se');
      }, ['player-ready:audio', 'player-playing:audio']);
      // The moderator navigator only jumps to questions. The seeded recap follows video.
      await measure(pass, 'audio → video', () => navigate(moderator), async () => {
        await showsTextAt(6, 'Syntetická video otázka')();
        await expect(videoPlayer).toHaveCount(1);
        await expect(videoPresentation).toHaveCount(0);
      }, ['player-mounted:video', 'player-cued:video']);
      await measure(pass, 'video → recap', () => navigate(moderator), async () => {
        await expectPosition(moderator, 7);
        await expect(projector.getByRole('heading', { name: 'Rekapitulace' })).toBeVisible();
        await expect(videoPlayer).toHaveCount(0);
      });
      await measure(pass, 'recap → text prompt', () => jumpToQuestion(moderator, 1), showsTextAt(2, question));
      await assertNoAnswer();
    }
    expect(samples).toHaveLength(1 + (repeatPasses + 1) * 8);
    expect(samples.every(sample => sample.status === 'confirmed')).toBe(true);
    await endSession(moderator, projector);
  } finally {
    const report = {
      browser: browser.version(),
      expectedRepeatPasses: repeatPasses,
      expectedAttempts: 1 + (repeatPasses + 1) * 8,
      cache: 'Fresh browser context on the first pass. Same context on later passes. Playwright routing disables HTTP cache.',
      media: 'Local synthetic image and mocked YouTube IFrame API. Times do not represent actual playback or image transport.',
      firstPass: summarize(samples.filter(sample => sample.pass === 0)),
      sameContextRepeats: summarize(samples.filter(sample => sample.pass > 0)),
      samples,
    };
    const reportPath = testInfo.outputPath('live-latency-matrix.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    await testInfo.attach('live-latency-matrix', { path: reportPath, contentType: 'application/json' });
    const { samples: rawSamples, ...summary } = report;
    console.log(`Live latency matrix (${rawSamples.length} attempts, ms): ${JSON.stringify(summary)}`);
    await context.close();
  }
});

test('projects a committed navigation whose callable response is lost without claiming a measured confirmation', { tag: '@lost-response' }, async ({ browser, baseURL }, testInfo) => {
  const context = await localContext(browser);
  try {
    const { moderator, projectorUrl } = await startSession(context, baseURL);
    const projector = await context.newPage();
    const { assertSafe: assertNoAnswer } = await watchProjection(projector);
    await projector.goto(projectorUrl);
    await expect(projector.getByText('Čekáme na první slide')).toBeVisible();
    await navigate(moderator);
    await expect(projector.getByRole('heading', { name: 'Začínáme' })).toBeVisible();
    await expect(trace(moderator)).toHaveAttribute('data-latency-revision', '1');

    const responseGate = holdRequest();
    let posts = 0;
    let committedRevision: number | undefined;
    await moderator.route(navigationUrl, async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      if (++posts > 1) return route.fallback();
      const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
      try {
        committedRevision = await callableRevision(response);
        await responseGate.held;
      } finally {
        await response.dispose();
        await route.abort('failed');
      }
    });

    try {
      await navigate(moderator);
      await expect.poll(() => committedRevision).toBe(2);
      await expect(projector.getByText(question, { exact: true })).toBeVisible();
      await expect(trace(moderator)).toHaveAttribute('data-latency-status', 'pending');
      await assertNoAnswer();
    } finally {
      responseGate.release();
    }

    await expect(trace(moderator)).toHaveAttribute('data-latency-status', 'failed');
    await expect(trace(moderator)).not.toHaveAttribute('data-latency-revision', /./u);
    for (const name of ['snapshot', 'frame']) {
      await expect(stage(moderator, name)).not.toHaveAttribute('data-latency-ms', /./u);
      await expect(stage(moderator, name).getByText('Nezjištěno', { exact: true })).toBeVisible();
    }
    await expectPosition(moderator, 2);
    await expect(projector.getByText(question, { exact: true })).toBeVisible();
    expect(posts).toBe(1);

    await navigate(moderator);
    await expectPosition(moderator, 3);
    await expect(projector.getByText(agenda, { exact: true })).toBeVisible();
    await expect(trace(moderator)).toHaveAttribute('data-latency-revision', '3');
    expect(posts).toBe(2);
    await assertNoAnswer();
    await endSession(moderator, projector);
    const sample = { committedRevision, operatorNextRevision: 3, lostResponseCount: 1, confirmedFrameForLostResponse: false };
    await testInfo.attach('committed-callable-response-loss', { body: JSON.stringify(sample), contentType: 'application/json' });
    console.log(`Callable response lost after commit: ${JSON.stringify(sample)}`);
  } finally {
    await context.close();
  }
});
