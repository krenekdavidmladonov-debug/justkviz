// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PrintTemplate } from '../packages/quiz-domain/src/index';
import { PrintTemplateFields } from '../apps/web/src/features/print/PrintTemplateFields';

let host: HTMLDivElement, root: Root;
const onChange = vi.fn<(value: PrintTemplate) => void>();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  root = createRoot(host);
  onChange.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = async (value: PrintTemplate = {}, disabled = false) => {
  await act(async () => root.render(<PrintTemplateFields value={value} disabled={disabled} onChange={onChange} />));
};
const image = () => host.querySelector('img')!;
async function choose(label: string) {
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click());
}

it('changes only layout and preserves all previously stored print customization', async () => {
  const value: PrintTemplate = { layout: 'comfortable', title: 'Vlastní nadpis', instructions: 'Vlastní pokyny', footer: 'Patička', accentColor: '#123456', showLogo: false, logoText: 'Logo', logoImage: 'quiz-asset:stored-logo' };
  await render(value);
  await act(async () => {
    const select = host.querySelector('select')!;
    select.value = 'compact';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...value, layout: 'compact' });
});

it('shows one layout setting and no advanced inputs, including hidden uploads', async () => {
  await render();
  expect(host.querySelectorAll('select')).toHaveLength(1);
  expect(host.querySelector('input, textarea, details')).toBeNull();
  expect(host.querySelectorAll('button')).toHaveLength(3);
  expect(host.querySelector('a[href="/admin/events"]')?.textContent).toBe('Otevřít akce a tiskové centrum');
  expect(host.textContent).toContain('PDF vašeho kvízu vytvoříte z připravené akce.');
});

it('disables editing while keeping read-only sample previews available', async () => {
  await render({}, true);
  expect(host.querySelector('select')!.disabled).toBe(true);
  await choose('Bodovací tabulka');
  expect(image().getAttribute('src')).toBe('/print-samples/score.png?brand=jk-v1');
  expect(onChange).not.toHaveBeenCalled();
});

it('switches sample documents and updates only the player sample for compact layout', async () => {
  await render();
  expect(image().getAttribute('src')).toBe('/print-samples/player-standard.png?brand=jk-v1');
  await render({ layout: 'compact' });
  expect(image().getAttribute('src')).toBe('/print-samples/player-compact.png?brand=jk-v1');
  await choose('Správné odpovědi');
  expect(image().getAttribute('src')).toBe('/print-samples/organizer.png?brand=jk-v1');
  expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Správné odpovědi');
  expect(host.querySelector('figcaption')?.textContent).toContain('Ukázka vzhledu — vzorová data');
  await render({ layout: 'comfortable', title: 'Soukromý název kvízu' });
  expect(image().getAttribute('src')).toBe('/print-samples/organizer.png?brand=jk-v1');
  expect(host.textContent).not.toContain('Soukromý název kvízu');
  await choose('Bodovací tabulka');
  expect(image().getAttribute('src')).toBe('/print-samples/score.png?brand=jk-v1');
  await choose('Hráčský arch');
  expect(image().getAttribute('src')).toBe('/print-samples/player-standard.png?brand=jk-v1');
  expect(onChange).not.toHaveBeenCalled();
});

it('opens the selected sample in a separate tab without navigating away from the editor', async () => {
  await render({ layout: 'compact' });
  const enlarged = () => host.querySelector<HTMLAnchorElement>('figcaption a')!;
  expect(enlarged().textContent).toBe('Zvětšit ukázku');
  expect(enlarged().getAttribute('href')).toBe(image().getAttribute('src'));
  expect(enlarged().target).toBe('_blank');
  expect(enlarged().rel).toBe('noopener noreferrer');
  await choose('Správné odpovědi');
  expect(enlarged().getAttribute('href')).toBe('/print-samples/organizer.png?brand=jk-v1');
  expect(enlarged().getAttribute('href')).toBe(image().getAttribute('src'));
  expect(onChange).not.toHaveBeenCalled();
});
