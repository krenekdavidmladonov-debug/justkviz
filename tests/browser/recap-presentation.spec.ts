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
