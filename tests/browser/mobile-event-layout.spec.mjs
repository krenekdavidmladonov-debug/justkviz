/* global window, document, Image, getComputedStyle */
import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 720 }]) {
  test('event team workflow and strict page width at ' + viewport.width, async ({ page, context, baseURL }) => {
    const env = requireFullEmulatorEnvironment(process.env, 'Mobile event layout');
    const ports = { '9099': env.authEndpoint, '8080': env.firestoreEndpoint, '5001': env.functionsEndpoint };
    const localUrl = value => {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname)) return null;
      const endpoint = ports[url.port];
      if (endpoint) { url.hostname = endpoint.host; url.port = String(endpoint.port); }
      return url.href;
    };
    await context.route('**/*', route => {
      const url = localUrl(route.request().url());
      return url ? route.continue({ url }) : route.abort();
    });
    const identity = await editorIdentity();
    const output = path.resolve('.local-data/mobile-qa', String(viewport.width));
    await mkdir(output, { recursive: true });
    const measurements = [], errors = [];
    let eventId;
    page.on('pageerror', error => errors.push(error.message));
    async function measure(stage) {
      const layout = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        overflowingElements: [...document.querySelectorAll('body *')].flatMap(element => {
          const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
          if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') return [];
          return rect.right > window.innerWidth || rect.left < 0
            ? [{ tag: element.tagName, className: typeof element.className === 'string' ? element.className : '', left: rect.left, right: rect.right, width: rect.width }]
            : [];
        }),
      }));
      measurements.push({ stage, ...layout });
      await writeFile(path.join(output, 'layout.json'), JSON.stringify({ viewport, eventId, measurements }, null, 2) + '\n');
      await page.screenshot({ path: path.join(output, stage + '.png'), fullPage: true });
      expect.soft(layout.documentWidth, stage + ': horizontal page overflow').toBeLessThanOrEqual(layout.viewportWidth);
    }
    try {
      await page.setViewportSize(viewport);
      await page.goto('/admin/login');
      await page.getByLabel('E-mail', { exact: true }).fill(identity.email);
      await page.getByLabel('Heslo', { exact: true }).fill(identity.password);
      await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click();
      await expect(page).toHaveURL(/\/admin$/u);
      await page.goto('/admin/events/new');
      await page.getByLabel('Název akce').fill('Synthetic mobile layout ' + viewport.width);
      await page.getByLabel('Datum a čas').fill('2031-11-20T19:00');
      await page.getByLabel('Místo', { exact: true }).fill('Synthetic venue');
      await page.getByLabel('Veřejné upřesnění místa').fill('Synthetic location');
      await page.getByRole('button', { name: 'Vytvořit akci', exact: true }).click();
      await expect(page).not.toHaveURL(/\/admin\/events\/new$/u);
      await expect(page).toHaveURL(/\/admin\/events\/[^/]+$/u);
      eventId = page.url().split('/').at(-1);
      expect(eventId).not.toBe('new');
      const detailUrl = page.url(), dialog = page.getByRole('dialog');
      await expect(page.getByText('Akce nemá zveřejněné přihlášení.')).toBeVisible();
      await measure('created-detail');
      await page.getByRole('button', { name: '+ Přidat tým', exact: true }).click();
      await expect(dialog.getByLabel('Název týmu')).toBeFocused();
      await dialog.getByLabel('Název týmu').fill('Synthetic mobile team');
      let dropped = false;
      await page.route('**/adminAddEventTeam', async route => {
        const url = localUrl(route.request().url());
        if (!url) return route.abort();
        if (!dropped) {
          dropped = true;
          await route.fetch({ url });
          await route.abort('failed');
        } else await route.continue({ url });
      });
      await dialog.getByRole('button', { name: 'Přidat tým', exact: true }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      expect(dropped).toBe(true);
      await expect(dialog.getByLabel('Název týmu')).toHaveValue('Synthetic mobile team');
      await dialog.getByRole('button', { name: 'Přidat tým', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText('1 / 20 týmů', { exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Spravovat týmy a registrace', exact: true }).click();
      let row = page.getByRole('row').filter({ hasText: 'Synthetic mobile team' });
      await expect(row).toHaveCount(1);
      await row.getByRole('button', { name: 'Upravit tým', exact: true }).click();
      await dialog.getByLabel('Název týmu').fill('Edited synthetic team');
      await dialog.getByLabel('Počet členů').fill('3');
      await dialog.getByRole('button', { name: 'Uložit tým', exact: true }).click();
      row = page.getByRole('row').filter({ hasText: 'Edited synthetic team' });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole('cell').nth(1)).toHaveText('3');
      await measure('edited-team');
      await page.getByLabel('Otevření', { exact: true }).fill('2020-01-01T00:00');
      await page.getByLabel('Uzavření', { exact: true }).fill('2030-01-01T00:00');
      await page.getByRole('button', { name: 'Uložit nastavení', exact: true }).click();
      await expect(page.getByText('Nastavení registrací bylo uloženo.')).toBeVisible();
      await page.goto(detailUrl);
      await page.getByRole('button', { name: 'Zveřejnit a otevřít registrace', exact: true }).click();
      await dialog.getByRole('button', { name: 'Zveřejnit a otevřít registrace', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const publicUrl = baseURL + '/events/' + eventId;
      await expect(page.getByRole('textbox', { name: 'Veřejný odkaz', exact: true })).toHaveValue(publicUrl);
      await expect(page.getByText('Přihlášky jsou otevřené.', { exact: true })).toBeVisible();
      await measure('before-qr');
      await page.getByRole('button', { name: 'Zobrazit QR', exact: true }).click();
      await expect(dialog.getByRole('img')).toBeVisible();
      await measure('during-qr');
      for (const kind of ['PNG', 'SVG']) {
        const pixels = await dialog.getByRole('link', { name: 'Stáhnout ' + kind, exact: true }).evaluate(async element => {
          const image = new Image(); image.src = element.href; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
          const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 512, 512); ctx.drawImage(image, 0, 0, 512, 512);
          return Array.from(ctx.getImageData(0, 0, 512, 512).data);
        });
        expect(jsQR(new Uint8ClampedArray(pixels), 512, 512)?.data).toBe(publicUrl);
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await measure('after-qr');
      const event = (await identity.db.doc('events/' + eventId).get()).data();
      expect(event.registrationStatus).toBe('open');
      expect(errors).toEqual([]);
    } finally {
      await writeFile(path.join(output, 'layout.json'), JSON.stringify({ viewport, eventId, measurements, pageErrors: errors }, null, 2) + '\n');
      await context.unrouteAll({ behavior: 'wait' });
      await identity.dispose();
    }
  });
}
