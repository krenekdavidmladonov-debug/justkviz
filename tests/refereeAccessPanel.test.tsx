// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RefereeAccessPanel } from '../apps/web/src/features/referee/RefereeAccessPanel';
import { refereeCall } from '../apps/web/src/features/referee/api';
import { refereeQr, refereeUrl } from '../apps/web/src/features/referee/sharing';

vi.mock('../apps/web/src/services/firebase/app', () => ({ getFirebaseAppContext: () => ({ config: { options: { projectId: 'demo-filmovy-kviz-v2' }, useEmulators: true } }) }));
vi.mock('../apps/web/src/features/referee/api', () => ({ refereeCall: vi.fn() }));
vi.mock('../apps/web/src/features/referee/sharing', () => ({ refereeUrl: vi.fn(), refereeQr: vi.fn() }));

let host: HTMLDivElement, root: Root;
const privateUrl = 'http://localhost/referee/event#access=synthetic&key=synthetic';
const grant = { accessId: 'synthetic', label: 'Rozhodčí 1', expiresAt: '2031-01-01T00:00:00Z', version: 1, status: 'active' };
const writeText = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(refereeCall).mockReset().mockImplementation(async name => name === 'issueRefereeAccess' ? { ...grant, key: 'synthetic' } : [grant]);
  vi.mocked(refereeUrl).mockReset().mockReturnValue(privateUrl);
  vi.mocked(refereeQr).mockReset().mockResolvedValue('data:image/png;base64,synthetic');
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(canIssue = true) { await act(async () => root.render(<RefereeAccessPanel eventId="event" canIssue={canIssue} />)); }
async function click(label: string) { await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click()); }
function link() { return host.querySelector<HTMLInputElement>('section[aria-label="Nový soukromý přístup"] input')!; }

it('explains the paper scoring handoff and copies the one-time private link', async () => {
  await render();
  expect(host.textContent).toContain('bez přihlášení');
  expect(host.textContent).toContain('klíč správných odpovědí');
  expect(host.textContent).toContain('výsledky na projektoru zveřejňuje moderátor');
  await click('Vydat přístup rozhodčího');
  await click('Kopírovat soukromý odkaz');
  expect(writeText).toHaveBeenCalledWith(privateUrl);
  expect(host.querySelector('[role="status"]')?.textContent).toContain('zkopírován');
  await click('Skrýt soukromý odkaz');
  expect(link()).toBeNull();
});

it('selects the complete private link for manual copying when clipboard access fails', async () => {
  writeText.mockRejectedValue(new Error('Clipboard denied'));
  await render(); await click('Vydat přístup rozhodčího'); await click('Kopírovat soukromý odkaz');
  expect(document.activeElement).toBe(link());
  expect(link().selectionStart).toBe(0);
  expect(link().selectionEnd).toBe(privateUrl.length);
  expect(host.querySelector('[role="status"]')?.textContent).toContain('zkopírujte ručně');
});

it('preserves and can copy the issued link when QR creation fails', async () => {
  vi.mocked(refereeQr).mockRejectedValue(new Error('QR unavailable'));
  await render(); await click('Vydat přístup rozhodčího');
  expect(link().value).toBe(privateUrl);
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('[role="status"]')?.textContent).toContain('QR se nepodařilo');
  await click('Kopírovat soukromý odkaz');
  expect(writeText).toHaveBeenCalledWith(privateUrl);
  expect(vi.mocked(refereeCall).mock.calls.filter(([name]) => name === 'issueRefereeAccess')).toHaveLength(1);
});

it('keeps a hidden private link hidden if its QR finishes later', async () => {
  let finishQr!: (png: string) => void;
  vi.mocked(refereeQr).mockImplementation(() => new Promise(resolve => { finishQr = resolve; }));
  await render(); await click('Vydat přístup rozhodčího');
  expect(link().value).toBe(privateUrl);
  await click('Skrýt soukromý odkaz');
  await act(async () => finishQr('data:image/png;base64,synthetic'));
  expect(link()).toBeNull();
  expect(host.querySelector('img')).toBeNull();
});

it('preserves the issued link when the follow-up access list cannot be refreshed', async () => {
  vi.mocked(refereeCall).mockResolvedValueOnce([grant]).mockResolvedValueOnce({ ...grant, key: 'synthetic' }).mockRejectedValueOnce(new Error('List unavailable'));
  await render(); await click('Vydat přístup rozhodčího');
  expect(link().value).toBe(privateUrl);
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Seznam přístupů se nepodařilo obnovit');
  await click('Obnovit seznam přístupů');
  expect(link().value).toBe(privateUrl);
  expect(vi.mocked(refereeCall).mock.calls.filter(([name]) => name === 'issueRefereeAccess')).toHaveLength(1);
});

it('keeps issuance unavailable without score permission', async () => {
  await render(false); await click('Vydat přístup rozhodčího');
  expect(vi.mocked(refereeCall).mock.calls.some(([name]) => name === 'issueRefereeAccess')).toBe(false);
});
