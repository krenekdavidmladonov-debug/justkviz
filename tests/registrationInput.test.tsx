// @vitest-environment happy-dom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RegistrationForm, type RegistrationDraftValues } from '../apps/web/src/features/registrations/RegistrationForm';

let host: HTMLDivElement, root: Root;
const values: RegistrationDraftValues = { teamName: 'Syntetický tým', memberCount: 2, contactEmail: 'synthetic@example.test' };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function inputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('preserves an empty draft across other edits and submits the entered numeric replacement', async () => {
  const submit = vi.fn();
  function Harness() {
    const [draft, setDraft] = useState(values);
    return <RegistrationForm values={draft} minimum={2} maximum={6} pending={false} submitLabel="Přihlásit" onChange={setDraft} onSubmit={submit} />;
  }
  await act(async () => root.render(<Harness />));
  const count = host.querySelector<HTMLInputElement>('input[type=number]')!;
  expect(count.inputMode).toBe('numeric'); expect(count.step).toBe('1'); expect(count.min).toBe('2'); expect(count.max).toBe('4');
  await inputValue(count, '');
  expect(count.value).toBe('');
  await inputValue(host.querySelector<HTMLInputElement>('input')!, 'Upravený tým');
  expect(count.value).toBe('');
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(submit).not.toHaveBeenCalled();
  await inputValue(count, '3');
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(submit).toHaveBeenCalledWith({ ...values, teamName: 'Upravený tým', memberCount: 3 });
});

it.each([null, 0, 1, 2.5, 5, NaN, Infinity])('does not submit an invalid member draft %s even for a synthetic submit event', async memberCount => {
  const submit = vi.fn();
  await act(async () => root.render(<RegistrationForm values={{ ...values, memberCount }} minimum={2} maximum={6} pending={false} submitLabel="Přihlásit" onChange={vi.fn()} onSubmit={submit} />));
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(submit).not.toHaveBeenCalled();
});

it.each([2, 3, 4])('submits the valid integer %s as a number', async memberCount => {
  const submit = vi.fn();
  await act(async () => root.render(<RegistrationForm values={{ ...values, memberCount }} minimum={2} maximum={6} pending={false} submitLabel="Přihlásit" onChange={vi.fn()} onSubmit={submit} />));
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(submit).toHaveBeenCalledWith({ ...values, memberCount });
});

it('keeps a stricter event minimum and blocks repeated submission while pending', async () => {
  const submit = vi.fn();
  for (const [memberCount, pending] of [[2, false], [3, true]] as const) {
    await act(async () => root.render(<RegistrationForm values={{ ...values, memberCount }} minimum={3} maximum={4} pending={pending} submitLabel="Přihlásit" onChange={vi.fn()} onSubmit={submit} />));
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  }
  expect(submit).not.toHaveBeenCalled();
});
