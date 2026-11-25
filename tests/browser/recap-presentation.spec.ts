import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const appRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const viteRequire = createRequire(appRequire.resolve('vite'));
const { build } = viteRequire('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: { path: string; text: string }[] }>;
};
let html = '';

test.beforeAll(async () => {
  const mocks = fileURLToPath(new URL('./recap-presentation.mocks.tsx', import.meta.url));
  const bundle = await build({
    entryPoints: ['tests/browser/recap-presentation.harness.tsx'], bundle: true, write: false,
    outfile: 'recap-layout.js', format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'synthetic-media', setup(builder: { onResolve: (options: { filter: RegExp }, callback: () => { path: string }) => void }) {
      builder.onResolve({ filter: /(?:\/MediaPlayer|\/AssetImage)$/ }, () => ({ path: mocks }));
    } }],
  });
  html = `<!doctype html><html lang="cs"><head><meta charset="UTF-8"><style>${bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text}html,body{margin:0;padding:0;}</style></head><body><div id="root"></div><script>${bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text}</script></body></html>`;
});

for (const width of [1920, 960, 400]) {
  test.describe(`${width}px slide`, () => {
    test.use({ viewport: { width, height: Math.ceil(width * 9 / 16) } });
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route('**/*', route => route.request().url().startsWith('http://recap-layout.test/')
        ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
    });
    for (const scenario of ['choice', 'photo', 'video', 'recap-video', 'recap-video-native', 'video-blocked', 'recap-video-blocked']) {
      test(`${scenario} preserves safe margins, compact answer and complete media frame`, async ({ page }) => {
        await page.goto(`/?scenario=${scenario}`);
        const canvas = page.locator('.slide-renderer');
        await expect(canvas).toBeVisible();
        const box = (await canvas.boundingBox())!;
        const copy = (await page.locator('.slide-copy').boundingBox())!;
        expect(copy.x - box.x).toBeGreaterThanOrEqual(width * .049);
        expect(copy.x + copy.width).toBeLessThanOrEqual(box.x + box.width * .951);
        const answer = page.locator('.slide-answer');
        if (scenario === 'choice') {
          await expect(answer).toContainText('Jiří Menzel');
          await expect(page.locator('.slide-answer-letter')).toHaveText('B');
          expect((await answer.boundingBox())!.height).toBeLessThan(box.height * .3);
          expect(await answer.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
          await expect.poll(() => answer.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
        }
        if (scenario.includes('video')) {
          const player = page.locator('.recap-player, .projector-video-player');
          await expect(player).toBeVisible();
          const media = (await player.boundingBox())!;
          expect(media.width / media.height).toBeCloseTo(16 / 9, 1);
          expect(media.x).toBeGreaterThanOrEqual(box.x + width * .049);
          expect(media.y + media.height).toBeLessThanOrEqual(box.y + box.height - width * .034);
          const host = (await player.locator('video, iframe').boundingBox())!;
          expect(host.height).toBeCloseTo(media.height, 0);
          expect(host.width).toBeCloseTo(media.width, 0);
          if (scenario.endsWith('native')) expect(await player.locator('video').evaluate(element => getComputedStyle(element).objectFit)).toBe('contain');
          if (scenario.endsWith('blocked')) {
            const manual = page.getByRole('button', { name: 'Spustit video ručně' });
            await expect(manual).toBeVisible();
            const control = (await manual.boundingBox())!;
            expect(control.x).toBeGreaterThanOrEqual(media.x);
            expect(control.y).toBeGreaterThanOrEqual(media.y);
            expect(control.x + control.width).toBeLessThanOrEqual(media.x + media.width);
            expect(control.y + control.height).toBeLessThanOrEqual(media.y + media.height);
          }
        }
        if (scenario === 'photo') {
          await expect(page.getByAltText('Obrázek odpovědi')).toBeVisible();
          const photo = (await page.getByAltText('Obrázek odpovědi').boundingBox())!;
          expect(photo.y + photo.height).toBeLessThan(box.y + box.height);
        }
        await page.screenshot({ path: `.local-data/recap-layout/${scenario}-${width}.png`, animations: 'disabled' });
      });
    }
  });
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1024, height: 768 }, { width: 400, height: 225 }]) {
  test.describe('complete long recap at ' + viewport.width + '×' + viewport.height, () => {
    test.use({ viewport });
    for (const surface of ['projector', 'editor']) {
      for (const scenario of ['long-answer', 'long-choice', 'extreme-answer']) {
        test(surface + ' ' + scenario + ' keeps every answer line visible', async ({ page }, testInfo) => {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await page.route('**/*', route => route.request().url().startsWith('http://recap-layout.test/')
            ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
          await page.goto('/?scenario=' + scenario + '&surface=' + surface + (viewport.width === 1024 && surface === 'projector' ? '&canvas=4:3' : ''));
          const answer = page.locator('.slide-answer-value > strong');
          const longAnswer = 'Jiří Menzel natočil film Ostře sledované vlaky podle novely Bohumila Hrabala. '.repeat(6);
          const expected = scenario === 'extreme-answer' ? longAnswer.repeat(43).slice(0, 20_000) : longAnswer;
          await expect(answer).toHaveText(expected);
          if (scenario === 'long-choice') await expect(page.locator('.slide-answer-letter')).toHaveText('B');
          await page.evaluate(() => document.fonts.ready);
          const measure = () => answer.evaluate(element => {
            const canvasElement = element.closest('.slide-renderer')!;
            const canvas = canvasElement.getBoundingClientRect();
            const clips = [canvas];
            for (let parent = element.parentElement; parent && parent !== canvasElement; parent = parent.parentElement) {
              const style = getComputedStyle(parent);
              if ([style.overflowX, style.overflowY].some(value => ['hidden', 'clip', 'auto', 'scroll'].includes(value))) {
                clips.push(parent.getBoundingClientRect());
              }
            }
            const range = document.createRange();
            range.selectNodeContents(element);
            const lines = [...range.getClientRects()];
            const context = [...canvasElement.querySelectorAll('.slide-brand, .slide-question-label, .slide-copy, .slide-round-title')]
              .map(item => item.getBoundingClientRect()).filter(item => item.width > 0 && item.height > 0);
            const answerBox = element.getBoundingClientRect();
            return {
              lineCount: lines.length,
              canvasRatio: canvas.width / canvas.height,
              separateFromContext: lines.every(line => context.every(item => line.right <= item.left + 1 || line.left >= item.right - 1
                || line.bottom <= item.top + 1 || line.top >= item.bottom - 1)),
              allLinesVisible: lines.every(line => clips.every(clip => line.top >= clip.top - 1 && line.bottom <= clip.bottom + 1
                && line.left >= clip.left - 1 && line.right <= clip.right + 1)),
              contentFits: element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1,
              relativeFontSize: parseFloat(getComputedStyle(element).fontSize) / canvas.width,
              answerVisible: answerBox.width > 0 && answerBox.height > 0,
            };
          });
          await expect.poll(async () => {
            const current = await measure();
            return current.allLinesVisible && current.answerVisible && current.relativeFontSize > 0;
          }).toBe(true);
          const measured = await measure();
          await testInfo.attach('answer-measurements', { body: JSON.stringify(measured), contentType: 'application/json' });
          const screenshot = testInfo.outputPath('complete-answer-' + surface + '-' + scenario + '.png');
          await page.screenshot({ path: screenshot, animations: 'disabled' });
          await testInfo.attach('answer-layout', { path: screenshot, contentType: 'image/png' });
          console.log(JSON.stringify({ scenario, surface, viewport, measured }));
          expect(measured.lineCount).toBeGreaterThan(1);
          expect(measured.canvasRatio).toBeCloseTo(viewport.width === 1024 && surface === 'projector' ? 4 / 3 : 16 / 9, 2);
          expect(measured.contentFits).toBe(true);
          expect(measured.separateFromContext).toBe(true);
          expect(measured.answerVisible).toBe(true);
          if (scenario === 'extreme-answer') {
            await expect(page.locator('.slide-renderer')).toHaveAttribute('data-answer-too-long', 'true');
          } else {
            expect(measured.relativeFontSize).toBeGreaterThanOrEqual(.02 - .00001);
            await expect(page.locator('.slide-renderer')).not.toHaveAttribute('data-answer-too-long', 'true');
          }

        });
      }
    }
  });
}


test('answer measurement warns for a saveable extreme and clears after shortening', async ({ page }) => {
  await page.route('**/*', route => route.request().url().startsWith('http://recap-layout.test/')
    ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
  await page.goto('/?scenario=answer-length-warning');
  await expect(page.getByTestId('question-validation-errors')).toHaveText('0');
  const warning = page.getByRole('status').filter({ hasText: 'Odpověď je na projekci příliš dlouhá, zkraťte ji.' });
  await expect(warning).toBeVisible();
  await page.getByRole('button', { name: 'Zkrátit odpověď' }).click();
  await expect(warning).toHaveCount(0);
  await expect(page.getByTestId('question-validation-errors')).toHaveText('0');
});
