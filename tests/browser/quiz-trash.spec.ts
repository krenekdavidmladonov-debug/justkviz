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
  const mocks = fileURLToPath(new URL('./quiz-trash.mocks.ts', import.meta.url));
  const result = await build({
    entryPoints: ['tests/browser/quiz-trash.harness.tsx'], bundle: true, write: false,
    outfile: 'quiz-trash.js', format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'synthetic-quiz-library', setup(builder: { onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => { path: string }) => void }) {
      builder.onResolve({ filter: /(?:auth\/AuthProvider|quizzes\/quizRepository|quizTrashApi)$/ }, () => ({ path: mocks }));
    } }],
  });
  const script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const css = result.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  html = `<!doctype html><html lang="cs" data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>`;
});
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => route.request().url().startsWith('http://quiz-trash.test/')
    ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
});

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}px library`, () => {
    test.use({ viewport });
    test('cancel keeps the quiz; confirmed delete moves only the named quiz to trash; restore returns it', async ({ page }) => {
      await page.goto('/admin/quizzes');
      const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Filmový večer 42', exact: true }) });
      const remove = row.getByRole('button', { name: 'Smazat kvíz Filmový večer 42', exact: true });
      await expect(remove).toBeVisible();
      await page.screenshot({ path: `.local-data/quiz-trash/library-${viewport.width}.png`, fullPage: true });
      await remove.click();
      const dialog = page.getByRole('dialog', { name: 'Smazat kvíz?' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Filmový večer 42');
      await page.screenshot({ path: `.local-data/quiz-trash/dialog-${viewport.width}.png`, fullPage: true });
      await dialog.getByRole('button', { name: 'Zrušit', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(row).toBeVisible();
      expect(await page.evaluate(() => window.quizTrashCalls)).toEqual([]);
      await remove.click();
      await dialog.getByRole('button', { name: 'Smazat kvíz', exact: true }).dblclick();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByRole('link', { name: 'Filmový večer 42', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Druhý syntetický kvíz', exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.quizTrashCalls)).toEqual([{ name: 'trashQuiz', quizId: 'quiz-1', expectedRevision: 7 }]);
      await page.getByRole('button', { name: 'Koš', exact: true }).click();
      await expect(page.getByText('Filmový večer 42', { exact: true })).toBeVisible();
      await expect(page.getByText('Druhý syntetický kvíz', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Obnovit kvíz Filmový večer 42', exact: true }).click();
      await expect(page.getByText('Filmový večer 42', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Knihovna', exact: true }).click();
      await expect(page.getByRole('link', { name: 'Filmový večer 42', exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.quizTrashCalls)).toEqual([
        { name: 'trashQuiz', quizId: 'quiz-1', expectedRevision: 7 },
        { name: 'restoreQuiz', quizId: 'quiz-1', expectedRevision: 8 },
      ]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
    test('server rejection preserves the selected quiz and shows an actionable error', async ({ page }) => {
      await page.goto('/admin/quizzes?failure=1');
      await page.getByRole('button', { name: 'Smazat kvíz Filmový večer 42', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Smazat kvíz?' });
      await dialog.getByRole('button', { name: 'Smazat kvíz', exact: true }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Smazat kvíz', exact: true })).toBeEnabled();
      await dialog.getByRole('button', { name: 'Zrušit', exact: true }).click();
      await expect(page.getByRole('link', { name: 'Filmový večer 42', exact: true })).toBeVisible();
    });
    test('reader has no delete, restore or trash controls', async ({ page }) => {
      await page.goto('/admin/quizzes?access=reader');
      await expect(page.getByRole('link', { name: 'Filmový večer 42', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /Smazat|Obnovit|^Koš$/ })).toHaveCount(0);
      expect(await page.evaluate(() => window.quizTrashCalls)).toEqual([]);
    });
  });
}
