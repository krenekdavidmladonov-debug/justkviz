// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { PrivacyPage } from '../apps/web/src/routes/PrivacyPage';
import { RegistrationForm } from '../apps/web/src/features/registrations/RegistrationForm';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
test('shows the approved controller details and an actionable rights contact', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_PRIVACY_CONTROLLER_NAME', 'Testovací správce');
  vi.stubEnv('VITE_PRIVACY_CONTROLLER_ICO', '00000000');
  vi.stubEnv('VITE_PRIVACY_CONTROLLER_SEAT', 'Testovací 1');
  vi.stubEnv('VITE_PRIVACY_CONTROLLER_EMAIL', 'privacy@example.test');
  const host = document.createElement('div'), root = createRoot(host);
  await act(async () => root.render(<PrivacyPage />));
  expect(host.querySelector('h1')?.textContent).toBe('Ochrana osobních údajů');
  expect(host.textContent).toContain('IČO 00000000');
  expect(host.textContent).toContain('Testovací 1');
  expect(host.querySelector('a[href="mailto:privacy@example.test"]')).not.toBeNull();
  expect(host.querySelector('a[href^="https://uoou.gov.cz/"]')).not.toBeNull();
  expect(host.textContent).not.toMatch(/WAITING_FOR_OWNER|Návrh k doplnění/u);
  await act(async () => root.unmount());
});
test('registration links privacy before submit and keeps the existing payload without invented consent', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'), root = createRoot(host), submit = vi.fn();
  const values = { teamName: 'Tým', memberCount: 2, contactEmail: 'synthetic@example.test' };
  await act(async () => root.render(<RegistrationForm values={values} minimum={1} maximum={4} pending={false} submitLabel="Přihlásit" onChange={vi.fn()} onSubmit={submit} />));
  const privacyLink = host.querySelector('a[href="/privacy"]');
  const submitButton = host.querySelector('button[type="submit"]');
  expect(privacyLink?.textContent).toBe('Ochrana osobních údajů');
  expect(privacyLink?.compareDocumentPosition(submitButton!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(submit).toHaveBeenCalledWith(values);
  await act(async () => root.unmount());
});
