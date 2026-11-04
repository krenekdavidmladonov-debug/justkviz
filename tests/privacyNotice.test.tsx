// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { PrivacyPage } from '../apps/web/src/routes/PrivacyPage';
import { RegistrationForm } from '../apps/web/src/features/registrations/RegistrationForm';

afterEach(() => vi.unstubAllGlobals());
test('privacy review is visibly incomplete and has no invented contact destination', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'), root = createRoot(host);
  await act(async () => root.render(<PrivacyPage />));
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Návrh k doplnění');
  expect(host.textContent).toContain('ČEKÁ NA DOPLNĚNÍ VLASTNÍKEM');
  expect(host.textContent).toContain('samo nevymaže');
  expect(host.textContent).toContain('Účty obsluhy');
  expect(host.querySelector('a[href^="mailto:"]')).toBeNull();
  await act(async () => root.unmount());
});
test('registration links privacy before submit and keeps the existing payload without invented consent', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'), root = createRoot(host), submit = vi.fn();
  const values = { teamName: 'Tým', memberCount: 2, contactEmail: 'synthetic@example.test' };
  await act(async () => root.render(<RegistrationForm values={values} minimum={1} maximum={4} pending={false} submitLabel="Přihlásit" onChange={vi.fn()} onSubmit={submit} />));
  expect(host.querySelector('a[href="/privacy"]')).not.toBeNull();
  expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(submit).toHaveBeenCalledWith(values);
  await act(async () => root.unmount());
});

test('physical-person controller and ninety-day contact retention remain an unapproved proposal', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'), root = createRoot(host);
  await act(async () => root.render(<PrivacyPage />));
  expect(host.textContent).toContain('správcem bude fyzická osoba');
  expect(host.textContent).toContain('90 dnů po skončení akce');
  expect(host.textContent).toContain('nikoliv schválenou právní lhůtu');
  expect(host.textContent).toContain('WAITING_FOR_OWNER');
  expect(host.textContent).toContain('odděleně od nepotřebných e-mailů');
  expect(host.querySelector('a[href^="mailto:"]')).toBeNull();
  await act(async () => root.unmount());
});
