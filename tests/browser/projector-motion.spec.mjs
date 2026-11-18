/* global window, document, requestAnimationFrame, getComputedStyle */
import { test, expect } from '@playwright/test';
const fixture = '/tests/browser/projector-motion.fixture.html';
async function open(page) {
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto(fixture);
  await page.waitForFunction(() => window.projectorFixture);
}
async function scene(page, kind) { await page.evaluate(kind => window.projectorFixture.scene(kind), kind); }

test('projector entrances, actual answer visibility, ordering, counting and refresh', async ({ page }, testInfo) => {
  await open(page);
  expect(await page.locator('.pm-projector').getAttribute('class')).toContain('pm-static');
  await scene(page, 'question');
  await expect(page.locator('.pm-word')).not.toHaveCount(0);
  const delays = await page.locator('.pm-word').evaluateAll(words => words.map(word => parseFloat(getComputedStyle(word).animationDelay) * 1000));
  expect(Math.max(...delays) + 120).toBeLessThanOrEqual(601);
  await page.waitForTimeout(650);
  const wordsVisible = await page.locator('.pm-word').evaluateAll(words => words.every(word => Number(getComputedStyle(word).opacity) === 1));
  expect(wordsVisible).toBe(true);
  const animationStart = await page.locator('.pm-word').first().evaluate(word => word.getAnimations()[0]?.startTime);
  await page.evaluate(() => window.projectorFixture.tick());
  expect(await page.locator('.pm-word').first().evaluate(word => word.getAnimations()[0]?.startTime)).toBe(animationStart);
  const answerMs = await page.evaluate(async () => {
    const start = performance.now();
    window.projectorFixture.scene('answer');
    return await new Promise(resolve => {
      const sample = () => {
        const answer = document.querySelector('.slide-answer-value strong');
        if (answer) {
          let visible = true;
          for (let node = answer; node; node = node.parentElement) {
            const css = getComputedStyle(node);
            if (Number(css.opacity) < .99 || css.visibility !== 'visible' || css.display === 'none') visible = false;
          }
          const box = answer.getBoundingClientRect();
          if (visible && box.width > 0 && box.height > 0 && answer.textContent === 'Praha') return resolve(performance.now() - start);
        }
        if (performance.now() - start > 350) return resolve(999);
        requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    });
  });
  expect(answerMs).toBeLessThanOrEqual(300);
  console.log('Actual answer visibility: ' + answerMs.toFixed(2) + ' ms');
  await testInfo.attach('answer-visibility-ms', { body: String(answerMs), contentType: 'text/plain' });
  await page.reload();
  await page.waitForFunction(() => window.projectorFixture);
  expect(await page.locator('.pm-projector').getAttribute('class')).toContain('pm-static');
  expect(await page.locator('.slide-answer').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  for (const kind of ['interim', 'final', 'classic', 'classic-final']) {
    await scene(page, 'question');
    const firstFrame = await page.evaluate(async kind => {
      window.projectorFixture.scene(kind);
      return await new Promise(resolve => requestAnimationFrame(() => resolve([...document.querySelectorAll(kind.includes('classic') ? 'tbody tr' : '.sm-table .sm-row')].map(row => row.lastElementChild.textContent))));
    }, kind);
    expect(firstFrame.every(value => Number(value.replace(',', '.')) < 3)).toBe(true);
    const row = page.locator(kind.includes('classic') ? 'tbody tr' : '.sm-table .sm-row');
    const timing = await row.evaluateAll(rows => rows.map(row => getComputedStyle(row).animationDelay));
    expect(parseFloat(timing[0])).toBeGreaterThan(parseFloat(timing[3]));
    expect(timing[1]).toBe(timing[2]);
    await page.waitForTimeout(1480);
    const content = await row.allTextContents();
    expect(content[0]).toContain('24,5'); expect(content[1]).toContain('18,5'); expect(content[2]).toContain('18,5'); expect(content[3]).toContain('10,5');
  }
});

test('reduced motion and quiz OFF remain fully static; moderator and media excluded', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  for (const kind of ['question', 'answer', 'interim', 'classic', 'final']) {
    await scene(page, kind);
    const staticStyles = await page.locator('main *').evaluateAll(nodes => nodes.flatMap(node => {
      const style = getComputedStyle(node);
      return style.animationName === 'none' && style.transitionDuration.split(',').every(value => parseFloat(value) === 0) ? [] : [{node: node.className, animation: style.animationName, transition: style.transitionDuration}];
    }));
    expect(staticStyles).toEqual([]);
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.projectorFixture.enabled(false));
  await scene(page, 'question');
  expect(await page.locator('.pm-word').count()).toBe(0);
  await scene(page, 'interim');
  expect(await page.locator('.sm-static').count()).toBe(1);
  await page.evaluate(() => window.projectorFixture.enabled(true));
  await scene(page, 'media');
  expect(await page.locator('.pm-projector').getAttribute('class')).toContain('pm-static');
  await page.evaluate(() => window.projectorFixture.moderator(true));
  await scene(page, 'question');
  expect(await page.locator('.pm-projector,.pm-word').count()).toBe(0);
});

test('synthetic local motion recording for PR GIF', async ({ page }, testInfo) => {
  await open(page);
  await scene(page, 'question'); await scene(page, 'round'); await page.waitForTimeout(1250);
  await scene(page, 'image'); await page.waitForTimeout(700);
  await page.evaluate(() => window.projectorFixture.reveal()); await page.waitForTimeout(500);
  await scene(page, 'interim'); await page.waitForTimeout(1600);
  await page.screenshot({ path: testInfo.outputPath('synthetic.png') });
  await scene(page, 'question'); await scene(page, 'round'); await page.waitForTimeout(1300);
});

test('round sequence and image entrance use bounded transform/opacity only', async ({ page }) => {
  await open(page);
  await scene(page, 'question'); await scene(page, 'round');
  const sequence = await page.locator('.round-intro-content').evaluate(node => ['.slide-kicker', '.pm-round-line', 'h1'].map(selector => {
    const css = getComputedStyle(node.querySelector(selector));
    return { delay: parseFloat(css.animationDelay), duration: parseFloat(css.animationDuration) };
  }));
  expect(sequence).toEqual([{ delay: 0, duration: .35 }, { delay: .35, duration: .35 }, { delay: .7, duration: .5 }]);
  await scene(page, 'image');
  await expect(page.locator('.question-image-frame img')).toBeVisible();
  const imageEntrance = await page.locator('.question-image-frame').evaluate(node => ({ name: getComputedStyle(node).animationName, duration: getComputedStyle(node).animationDuration }));
  expect(imageEntrance).toEqual({ name: 'pm-image', duration: '0.4s' });
  const animatedProperties = await page.locator('main').evaluate(node => node.getAnimations({ subtree: true }).flatMap(animation => animation.effect.getKeyframes().flatMap(keyframe => Object.keys(keyframe).filter(key => !['offset', 'computedOffset', 'easing', 'composite', 'opacity', 'transform'].includes(key)))));
  expect(animatedProperties).toEqual([]);
  await page.waitForTimeout(650);
  expect(await page.locator('.question-image-frame').evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
});

test('picture reveal preserves every frame of photo geometry and never replays prompt entrance', async ({ page }) => {
  await open(page);
  await scene(page, 'image');
  await expect(page.locator('.question-image-frame')).toHaveCSS('animation-name', 'pm-image');
  await page.waitForTimeout(650);
  const observed = await page.evaluate(async () => {
    const frame = document.querySelector('.question-image-frame');
    const before = frame.getBoundingClientRect();
    const baseline = { x: before.x, y: before.y, width: before.width, height: before.height };
    const start = performance.now();
    window.projectorFixture.reveal();
    const samples = [];
    while (performance.now() - start < 500) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const current = document.querySelector('.question-image-frame');
      const rect = current.getBoundingClientRect();
      samples.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        imageAnimation: getComputedStyle(current).animationName,
        promptAnimations: [...document.querySelectorAll('.slide-copy, .slide-copy *')].map(node => getComputedStyle(node).animationName) });
    }
    return { baseline, samples, fillAnimation: getComputedStyle(document.querySelector('.slide-answer'), '::before').animationName };
  });
  expect(observed.fillAnimation).toBe('pm-fill');
  for (const sample of observed.samples) {
    expect({ x: sample.x, y: sample.y, width: sample.width, height: sample.height }).toEqual(observed.baseline);
    expect(sample.imageAnimation).toBe('none');
    expect(sample.promptAnimations.every(name => name === 'none')).toBe(true);
  }
  await page.evaluate(() => window.projectorFixture.hide());
  expect(await page.locator('.question-image-frame').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  for (const kind of ['media', 'video']) {
    await scene(page, 'question'); await scene(page, kind);
    expect(await page.locator('.pm-projector').getAttribute('class')).toContain('pm-static');
    expect(await page.locator('.slide-copy *').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === 'none'))).toBe(true);
  }
});
