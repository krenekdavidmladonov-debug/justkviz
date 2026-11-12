// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PrintTemplate } from '../packages/quiz-domain/src/index';
import { AdminPrintCenterPage } from '../apps/web/src/routes/admin/AdminPrintCenterPage';
import { PrintTemplateFields } from '../apps/web/src/features/print/PrintTemplateFields';
import { privateRead } from '../apps/web/src/features/access/api';
import { getEvent } from '../apps/web/src/features/events/eventRepository';
import { generatePrintArtifact } from '../apps/web/src/features/print/printApi';
import type { PrintArtifactBlob } from '../apps/web/src/features/print/types';
import type { EventRecord } from '../apps/web/src/features/events/types';
import { eventFormRecord } from './browser/events-form-ux.data';

const access = vi.hoisted(() => ({ answers: true, answerExport: true, export: true, uid: 'staff', version: 1 }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({
  can: (permission: string) => permission === 'event.answers.read' ? access.answers : permission === 'event.answers.export' ? access.answerExport : permission === 'event.export' ? access.export : true,
  currentUser: { uid: access.uid }, membership: { version: access.version },
}) }));
vi.mock('../apps/web/src/features/access/api', () => ({ privateRead: vi.fn() }));
vi.mock('../apps/web/src/features/events/eventRepository', () => ({ getEvent: vi.fn() }));
vi.mock('../apps/web/src/features/print/printApi', () => ({ generatePrintArtifact: vi.fn() }));

let host: HTMLDivElement, root: Root;
const urls = { create: vi.fn<(blob: Blob | MediaSource) => string>(), revoke: vi.fn<(url: string) => void>() };
const artifact = (): PrintArtifactBlob => ({ blob: new Blob(['%PDF-synthetic'], { type: 'application/pdf' }), filename: 'archy.pdf' });
const record = (id = 'synthetic-event'): EventRecord => ({ ...eventFormRecord(), id, quizAssignment: {
  quizId: 'quiz', quizRevision: 2, snapshotId: 'snapshot-' + id, quizTitle: 'Připravený kvíz', roundCount: 6, questionCount: 67, lockedAt: new Date(),
} });
const roster = (count: number) => Array.from({ length: count }, (_, index) => ({ id: 'team-' + index, data: { status: 'accepted', teamName: 'Tým ' + index } }));
const button = (prefix: string) => [...host.querySelectorAll('button')].find(item => item.textContent?.startsWith(prefix))!;
const select = (label: string) => [...host.querySelectorAll('label')].find(item => item.textContent?.startsWith(label))!.querySelector('select')!;
const frame = () => host.querySelector('iframe');
const download = () => host.querySelector<HTMLAnchorElement>('.print-actions a')!;
async function changeSelect(label: string, value: string) {
  await act(async () => { const field = select(label); field.value = value; field.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function render() {
  const router = createMemoryRouter([{ path: '/admin/events/:eventId/print', element: <AdminPrintCenterPage /> }], { initialEntries: ['/admin/events/synthetic-event/print'] });
  await act(async () => root.render(<RouterProvider router={router} />));
  return router;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(access, { answers: true, answerExport: true, export: true, uid: 'staff', version: 1 });
  vi.mocked(getEvent).mockReset().mockResolvedValue(record());
  vi.mocked(privateRead).mockReset().mockResolvedValue(roster(2));
  vi.mocked(generatePrintArtifact).mockReset().mockImplementation(async () => artifact());
  let sequence = 0;
  urls.create.mockReset().mockImplementation(() => 'blob:synthetic-' + (++sequence)); urls.revoke.mockReset();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(urls.create);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(urls.revoke);
  // Keep this state/race test detached: happy-dom cannot render Blob PDF frames.
  // Actual PDF rendering is covered by the browser and PDF integration checks.
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('immediately previews and downloads the same generated PDF without a configuration step', async () => {
  await render();
  expect(generatePrintArtifact).toHaveBeenCalledTimes(1);
  expect(generatePrintArtifact).toHaveBeenCalledWith('synthetic-event', { artifactType: 'team-sheets', disposition: 'inline', mode: 'all', colorMode: 'color' }, expect.any(AbortSignal));
  expect(frame()?.getAttribute('src')).toBe(download().getAttribute('href') + '#navpanes=0&view=Fit');
  expect(download().download).toBe('archy.pdf');
  expect(download().textContent).toBe('Stáhnout PDF');
  expect(host.textContent).toContain('2 archy vedle sebe · A4 na šířku · tisk 100 % · rozstřihnout uprostřed');
  expect(host.textContent).toContain('právě jeden univerzální rezervní arch bez jména');
  expect(host.textContent).toContain('Každé kolo zůstává celé na jedné straně archu.');
  expect(host.querySelector('.print-advanced')?.hasAttribute('open')).toBe(false);
});

it('aborts an obsolete answer-key request and never publishes its late Blob', async () => {
  await render();
  let resolve!: (value: PrintArtifactBlob) => void;
  vi.mocked(generatePrintArtifact).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => button('Klíč správných odpovědí').click());
  expect(generatePrintArtifact).toHaveBeenCalledTimes(1);
  await act(async () => button('Otevřít dokument se správnými odpověďmi').click());
  const signal = vi.mocked(generatePrintArtifact).mock.calls.at(-1)![2]!;
  expect(frame()).toBeNull(); expect(download().getAttribute('href')).toBeNull();
  await act(async () => button('Hrací arch pro hráče').click());
  const playerPdfUrl = download().getAttribute('href');
  const createdBefore = urls.create.mock.calls.length;
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(artifact()));
  expect(urls.create).toHaveBeenCalledTimes(createdBefore);
  expect(download().getAttribute('href')).toBe(playerPdfUrl);
  expect(urls.revoke).toHaveBeenCalledWith('blob:synthetic-1');
});

it('removes an answer-key preview and link immediately when its permission is lost', async () => {
  await render();
  await act(async () => button('Klíč správných odpovědí').click());
  await act(async () => button('Otevřít dokument se správnými odpověďmi').click());
  const privateUrl = download().getAttribute('href');
  expect(frame()).not.toBeNull();
  access.answers = false;
  await changeSelect('Barevnost', 'grayscale');
  expect(frame()).toBeNull(); expect(download().getAttribute('href')).toBeNull();
  expect(button('Klíč správných odpovědí').disabled).toBe(true);
  expect(urls.revoke).toHaveBeenCalledWith(privateUrl);
  expect(generatePrintArtifact).toHaveBeenCalledTimes(2);
});

it('requires explicit confirmation for the organizer sheet and keeps its preview and download identical', async () => {
  await render();
  await act(async () => button('Hrací arch se správnými odpověďmi').click());
  expect(generatePrintArtifact).toHaveBeenCalledTimes(1);
  expect(frame()).toBeNull(); expect(download().getAttribute('href')).toBeNull();
  expect(download().textContent).toBe('Stáhnout PDF se správnými odpověďmi');
  expect(host.querySelector('.print-private-note')?.textContent).toContain('NEDÁVAT HRÁČŮM');
  expect(host.querySelector('.print-private-choice')?.textContent).toContain('Hrací arch se správnými odpověďmi');
  await act(async () => button('Otevřít dokument se správnými odpověďmi').click());
  expect(generatePrintArtifact).toHaveBeenLastCalledWith('synthetic-event', { artifactType: 'organizer-sheets', disposition: 'inline', colorMode: 'color' }, expect.any(AbortSignal));
  expect(frame()?.getAttribute('src')).toBe(download().getAttribute('href') + '#navpanes=0&view=Fit');
  const privateUrl = download().getAttribute('href');
  await act(async () => button('Hrací arch pro hráče').click());
  expect(urls.revoke).toHaveBeenCalledWith(privateUrl);
  expect(download().textContent).toBe('Stáhnout PDF');
  await act(async () => button('Hrací arch se správnými odpověďmi').click());
  expect(generatePrintArtifact).toHaveBeenCalledTimes(3);
  expect(frame()).toBeNull(); expect(download().getAttribute('href')).toBeNull();
  expect(button('Otevřít dokument se správnými odpověďmi')).toBeDefined();
});

it('requires a new confirmation when switching between answer-bearing document types', async () => {
  await render();
  await act(async () => button('Hrací arch se správnými odpověďmi').click());
  await act(async () => button('Otevřít dokument se správnými odpověďmi').click());
  const organizerUrl = download().getAttribute('href');
  await act(async () => button('Klíč správných odpovědí').click());
  expect(generatePrintArtifact).toHaveBeenCalledTimes(2);
  expect(frame()).toBeNull(); expect(download().getAttribute('href')).toBeNull();
  expect(urls.revoke).toHaveBeenCalledWith(organizerUrl);
  await act(async () => button('Otevřít dokument se správnými odpověďmi').click());
  expect(vi.mocked(generatePrintArtifact).mock.calls.at(-1)?.[1]).toMatchObject({ artifactType: 'answer-key' });
  expect(frame()).not.toBeNull();
});

it.each(['answers', 'answerExport', 'export'] as const)('clears organizer consent and download after losing %s permission', async permission => {
  await render();
  await act(async () => button('Hrací arch se správnými odpověďmi').click());
  await act(async () => button('Otevřít dokument se správnými odpověďmi').click());
  const privateUrl = download().getAttribute('href');
  access[permission] = false;
  await changeSelect('Barevnost', 'grayscale');
  expect(frame()).toBeNull(); expect(download().getAttribute('href')).toBeNull();
  expect(button('Hrací arch se správnými odpověďmi').disabled).toBe(true);
  expect(urls.revoke).toHaveBeenCalledWith(privateUrl);
  access[permission] = true;
  await changeSelect('Barevnost', 'color');
  expect(generatePrintArtifact).toHaveBeenCalledTimes(2);
  expect(frame()).toBeNull(); expect(download().getAttribute('href')).toBeNull();
  expect(button('Otevřít dokument se správnými odpověďmi')).toBeDefined();
});

it.each(['uid', 'version'] as const)('clears organizer consent when the authenticated %s changes', async identity => {
  await render();
  await act(async () => button('Hrací arch se správnými odpověďmi').click());
  await act(async () => button('Otevřít dokument se správnými odpověďmi').click());
  const privateUrl = download().getAttribute('href');
  if (identity === 'uid') access.uid = 'other-staff'; else access.version++;
  await changeSelect('Barevnost', 'grayscale');
  expect(generatePrintArtifact).toHaveBeenCalledTimes(2);
  expect(frame()).toBeNull(); expect(download().getAttribute('href')).toBeNull();
  expect(urls.revoke).toHaveBeenCalledWith(privateUrl);
  expect(button('Otevřít dokument se správnými odpověďmi')).toBeDefined();
});

it('waits for the new event source after navigation and ignores a late PDF from the previous event', async () => {
  let oldPdf!: (value: PrintArtifactBlob) => void, newEvent!: (value: EventRecord) => void;
  vi.mocked(generatePrintArtifact).mockImplementationOnce(() => new Promise(done => { oldPdf = done; }));
  const router = await render();
  vi.mocked(getEvent).mockImplementationOnce(() => new Promise(done => { newEvent = done; }));
  await act(async () => router.navigate('/admin/events/other/print'));
  expect(generatePrintArtifact).toHaveBeenCalledTimes(1);
  await act(async () => oldPdf(artifact()));
  expect(urls.create).not.toHaveBeenCalled();
  await act(async () => newEvent(record('other')));
  expect(generatePrintArtifact).toHaveBeenCalledTimes(2);
  expect(vi.mocked(generatePrintArtifact).mock.calls[1]?.[0]).toBe('other');
  expect(frame()).not.toBeNull();
});

it('offers a usable blank sheet by default when the all-team export limit is exceeded', async () => {
  vi.mocked(privateRead).mockResolvedValue(roster(31));
  await render();
  expect(vi.mocked(generatePrintArtifact).mock.calls[0]?.[1]).toMatchObject({ mode: 'generic' });
  expect(frame()).not.toBeNull();
  expect(host.textContent).toContain('Akce má více než 30 týmů');
});

it('changes the simple default template without losing saved branding and custom texts', async () => {
  const saved: PrintTemplate = { layout: 'comfortable', title: 'Vlastní titulek', instructions: 'Vlastní pokyny', footer: 'Patička', accentColor: '#123456', logoText: 'Klub', showLogo: false };
  const onChange = vi.fn();
  await act(async () => root.render(<PrintTemplateFields value={saved} disabled={false} onChange={onChange} quizId="quiz" />));
  expect(onChange).not.toHaveBeenCalled();
  expect(host.querySelector('.print-template-custom')).toBeNull();
  expect(host.querySelectorAll('select')).toHaveLength(1);
  expect(new URL(host.querySelector('.print-editor-preview img')!.getAttribute('src')!, 'https://example.test').pathname).toBe('/print-samples/player-standard.png');
  expect(host.querySelectorAll('.editor-field')).toHaveLength(0);
  await changeSelect('Šablona odpovědních archů', 'compact');
  expect(onChange).toHaveBeenCalledWith({ ...saved, layout: 'compact' });
});
