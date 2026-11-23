// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultRefereeExpiry, RefereeAccessPanel } from '../apps/web/src/features/referee/RefereeAccessPanel';
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
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  vi.mocked(refereeCall).mockReset().mockImplementation(async name => name === 'issueRefereeAccess' ? { ...grant, key: 'synthetic' } : [grant]);
  vi.mocked(refereeUrl).mockReset().mockReturnValue(privateUrl);
  vi.mocked(refereeQr).mockReset().mockResolvedValue('data:image/png;base64,synthetic');
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(canIssue = true) { await act(async () => root.render(<RefereeAccessPanel eventId="event" canIssue={canIssue} />)); }
async function click(label: string) { await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click()); }
function link() { return host.querySelector<HTMLInputElement>('section[aria-label="Nový soukromý přístup"] input')!; }

it.each([
  ['2026-01-20T18:00:00Z', 'Europe/Prague', '2026-01-21T05:00:00.000Z'],
  ['2026-07-20T18:00:00Z', 'Europe/Prague', '2026-07-21T04:00:00.000Z'],
  ['2026-03-28T18:00:00Z', 'Europe/Prague', '2026-03-29T04:00:00.000Z'],
  ['2026-10-24T18:00:00Z', 'Europe/Prague', '2026-10-25T05:00:00.000Z'],
  ['2026-07-20T23:30:00Z', 'Asia/Tokyo', '2026-07-21T21:00:00.000Z'],
])('defaults to 06:00 after the event calendar day (%s, %s)', (start, zone, expected) => {
  expect(defaultRefereeExpiry(new Date(start), zone, Date.parse(start) - 86400000).toISOString()).toBe(expected);
});
it('caps distant event defaults at 30 days minus one hour', async () => {
  const startsAt = new Date('2026-07-20T18:00:00Z');
  const expected = new Date(Date.now() + 30 * 86400000 - 3600000);
  expect(defaultRefereeExpiry(startsAt).toISOString()).toBe(expected.toISOString());
  await act(async () => root.render(<RefereeAccessPanel eventId="event" canIssue startsAt={startsAt} />));
  await click('Vydat přístup rozhodčího');
  expect(refereeCall).toHaveBeenCalledWith('issueRefereeAccess', expect.objectContaining({ expiresAt: expected.toISOString() }));
});
it('shows the server validation message when access issuance is invalid', async () => {
  const message = 'Platnost přístupu musí být v budoucnosti a nejvýše 30 dnů dopředu.';
  await render();
  vi.mocked(refereeCall).mockRejectedValueOnce({ code: 'functions/invalid-argument', message });
  await click('Vydat přístup rozhodčího');
  expect(host.querySelector('[role="status"]')?.textContent).toBe(message);
});
it('falls back to 24 hours for undated and past events', () => {
  for (const start of [undefined, new Date('2025-01-01T18:00:00Z'), new Date('invalid')]) {
    expect(defaultRefereeExpiry(start).toISOString()).toBe('2026-01-02T12:00:00.000Z');
  }
});
it('issues with the event-zone default shown in the datetime field', async () => {
  await act(async () => root.render(<RefereeAccessPanel eventId="event" canIssue startsAt={new Date('2026-01-20T18:00:00Z')} timeZone="Europe/Prague" />));
  expect(new Date(host.querySelector<HTMLInputElement>('input[type="datetime-local"]')!.value).toISOString()).toBe('2026-01-21T05:00:00.000Z');
  await click('Vydat přístup rozhodčího');
  expect(refereeCall).toHaveBeenCalledWith('issueRefereeAccess', expect.objectContaining({ expiresAt: '2026-01-21T05:00:00.000Z' }));
});

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
