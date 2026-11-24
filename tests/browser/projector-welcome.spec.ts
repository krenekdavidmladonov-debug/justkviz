import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

const appRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const viteRequire = createRequire(appRequire.resolve('vite'));
const { build } = viteRequire('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: { path: string; text: string }[] }>;
};
const screenshots = 'docs/pr-assets/projector-welcome';
let html = '';
test.beforeAll(async () => {
  const mocks = fileURLToPath(new URL('./recap-presentation.mocks.tsx', import.meta.url));
  const bundle = await build({
    entryPoints: ['tests/browser/projector-welcome.harness.tsx'], bundle: true, write: false,
    outfile: 'projector-welcome.js', format: 'iife', platform: 'browser', jsx: 'automatic',
    define: {
      'process.env.NODE_ENV': '"test"',
      'import.meta.env': '{"MODE":"test","VITE_FIREBASE_PROJECT_ID":"demo-filmovy-kviz-v2","VITE_FIREBASE_USE_EMULATORS":"true"}',
    },
    plugins: [{ name: 'synthetic-media', setup(builder: { onResolve: (options: { filter: RegExp }, callback: () => { path: string }) => void }) {
      builder.onResolve({ filter: /(?:\/MediaPlayer|\/AssetImage)$/ }, () => ({ path: mocks }));
    } }],
  });
  html = `<!doctype html><html lang="cs"><head><meta charset="UTF-8"><style>${bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text}html,body{margin:0;padding:0;}</style></head><body><div id="root"></div><script>${bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text}</script></body></html>`;
  await mkdir(screenshots, { recursive: true });
});

for (const scene of ['welcome', 'round', 'question']) {
  test(`${scene} fills a 1600×900 slide and preserves safe margins`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // No app server, Firebase or external network: all page bytes are synthetic and local.
    await page.route('**/*', route => route.request().resourceType() === 'document' && route.request().url().startsWith('http://127.0.0.1:5579/')
      ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
    await page.goto(`/?scene=${scene}`);
    const canvas = page.locator('.slide-renderer');
    await expect(canvas).toBeVisible();
    await expect(canvas.locator('svg[aria-label="JustKvíz"]')).toBeVisible();
    await expect(canvas.locator('.slide-kicker, .slide-round-title')).toContainText(scene === 'welcome' ? 'VÍTEJTE NA KVÍZU' : '2. KOLO');
    const bounds = (await canvas.boundingBox())!;
    expect(bounds).toMatchObject({ x: 0, y: 0, width: 1600, height: 900 });
    const heading = (await canvas.locator('h1').boundingBox())!;
    expect(heading.x).toBeGreaterThanOrEqual(79);
    expect(heading.x + heading.width).toBeLessThanOrEqual(1521);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(900);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `${screenshots}/${scene}-1600x900.png` });
  });
}
