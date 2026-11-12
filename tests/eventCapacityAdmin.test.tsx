// @vitest-environment happy-dom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventForm } from '../apps/web/src/features/events/EventForm';
import { ManualTeamDialog } from '../apps/web/src/features/events/ManualTeamDialog';
import { createEvent, updateEvent } from '../apps/web/src/features/events/eventApi';
import type { EventFormValues } from '../apps/web/src/features/events/types';
import { eventFormRecord } from './browser/events-form-ux.data';

const mocks = vi.hoisted(() => ({ callable: vi.fn(), invoke: vi.fn() }));
vi.mock('../apps/web/src/services/firebase/client', () => ({ getFirebaseServices: () => ({ functions: 'synthetic-functions' }) }));
vi.mock('firebase/functions', async original => ({ ...await original<typeof import('firebase/functions')>(), httpsCallable: mocks.callable }));
const values: EventFormValues = {
  title: 'Akce', startsAt: '2030-10-20T19:00', timeZone: 'Europe/Prague', venueName: 'Sál', publicLocation: 'Praha',
  teamCapacity: 20, peopleCapacity: 120, teamSizeMin: 3, teamSizeMax: 4,
  pricingMode: 'per-team', pricingAmountCzk: 350,
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.invoke.mockReset().mockResolvedValue({ data: {} }); mocks.callable.mockReset().mockReturnValue(mocks.invoke);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('shows only team capacity and keeps a three-member minimum with a four-member ceiling', async () => {
  await act(async () => root.render(<EventForm values={values} pending={false} submitLabel="Uložit" onChange={vi.fn()} onSubmit={vi.fn()} />));
  const numberInputs = [...host.querySelectorAll<HTMLInputElement>('fieldset:last-of-type input[type=number]')];
  expect(numberInputs.map(input => input.closest('label')?.textContent)).toEqual(['Maximální počet týmů', 'Minimální počet členů týmu', 'Maximální počet členů týmu']);
  expect(numberInputs[1]?.value).toBe('3'); expect(numberInputs[1]?.max).toBe('4');
  expect(numberInputs[2]?.min).toBe('3'); expect(numberInputs[2]?.max).toBe('4');
  expect(host.textContent).not.toContain('Maximální počet účastníků');
});

it.each([3, 6])('manual teams respect the event maximum %s and the universal ceiling without writing on open', async teamSizeMax => {
  await act(async () => root.render(<ManualTeamDialog event={{ ...eventFormRecord(), teamSizeMin: 3, teamSizeMax }} onClose={vi.fn()} onSaved={vi.fn()} />));
  const input = host.querySelector<HTMLInputElement>('input[type=number]')!;
  expect(input.min).toBe('3'); expect(input.max).toBe(String(Math.min(4, teamSizeMax)));
  expect(input.value).toBe('3'); expect(mocks.invoke).not.toHaveBeenCalled();
});

it('derives new compatibility capacity while preserving historical capacity on explicit edits', async () => {
  await createEvent(values);
  expect(mocks.invoke.mock.calls.at(-1)?.[0]).toMatchObject({ event: { teamCapacity: 20, peopleCapacity: 80, teamSizeMin: 3, teamSizeMax: 4 } });
  await updateEvent('event', 2, values);
  expect(mocks.invoke.mock.calls.at(-1)?.[0]).toMatchObject({ eventId: 'event', expectedRevision: 2, event: { peopleCapacity: 120 } });
});

it('shows public pricing with whole-crown constraints and retains the amount through agreement mode', async () => {
  function EditableForm() {
    const [draft, setDraft] = useState({ ...values, pricingAmountCzk: 720 });
    return <EventForm values={draft} onChange={setDraft} pending={false} submitLabel="Uložit" onSubmit={vi.fn()} />;
  }
  await act(async () => root.render(<EditableForm />));
  const mode = [...host.querySelectorAll('select')].find(select => select.closest('label')?.textContent?.includes('Způsob účtování'))!;
  const priceInput = () => [...host.querySelectorAll<HTMLInputElement>('input[type=number]')].find(input => input.closest('label')?.textContent === 'Cena v Kč');
  expect(priceInput()?.min).toBe('0'); expect(priceInput()?.max).toBe('1000000'); expect(priceInput()?.step).toBe('1');
  expect(priceInput()?.required).toBe(true);
  expect(host.textContent).toContain('Veřejné zobrazení: 720 Kč za tým');
  expect(host.textContent).toContain('Tato cena se zobrazuje veřejně');
  for (const value of ['per-event', 'agreement', 'per-team']) {
    await act(async () => { mode.value = value; mode.dispatchEvent(new Event('change', { bubbles: true })); });
    if (value === 'agreement') {
      expect(priceInput()).toBeUndefined(); expect(host.textContent).toContain('Veřejné zobrazení: Cena dle dohody');
    } else {
      expect(priceInput()?.value).toBe('720'); expect(host.textContent).toContain(value === 'per-event' ? '720 Kč za celou akci' : '720 Kč za tým');
    }
  }
});

it.each([
  ['per-team', 0, { mode: 'per-team', amountCzk: 0 }],
  ['per-event', 12500, { mode: 'per-event', amountCzk: 12500 }],
  ['agreement', 720, { mode: 'agreement', amountCzk: null }],
] as const)('submits canonical %s pricing on create and update', async (pricingMode, pricingAmountCzk, pricing) => {
  const draft = { ...values, pricingMode, pricingAmountCzk };
  await createEvent(draft);
  expect(mocks.invoke.mock.calls.at(-1)?.[0]).toMatchObject({ event: { pricing } });
  await updateEvent('event', 2, draft);
  expect(mocks.invoke.mock.calls.at(-1)?.[0]).toMatchObject({ event: { pricing } });
});

it.each([-1, 0.5, 1_000_001, NaN])('rejects invalid amount %s before calling the backend', async pricingAmountCzk => {
  expect(() => createEvent({ ...values, pricingAmountCzk })).toThrow('Neplatná cena akce.');
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it('toggles public price visibility without clearing the editable amount', async () => {
  let saved: typeof values | undefined;
  function EditableForm() {
    const [draft, setDraft] = useState({ ...values, pricingAmountCzk: 720 });
    return <EventForm values={draft} onChange={setDraft} pending={false} submitLabel="Uložit" onSubmit={() => { saved = draft; }} />;
  }
  await act(async () => root.render(<EditableForm />));
  const checkbox = host.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  const amount = [...host.querySelectorAll<HTMLInputElement>('input[type=number]')].find(input => input.closest('label')?.textContent === 'Cena v Kč')!;
  expect(checkbox.checked).toBe(true);
  await act(async () => checkbox.click());
  expect(checkbox.checked).toBe(false); expect(amount.value).toBe('720'); expect(amount.disabled).toBe(false);
  expect(host.textContent).toContain('Veřejně se cena nezobrazuje. Uložená cena: 720 Kč za tým');
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(saved).toMatchObject({ pricingHidden: true, pricingAmountCzk: 720 });
  await updateEvent('event', 2, saved!);
  expect(mocks.invoke.mock.calls.at(-1)?.[0]).toMatchObject({ event: { pricing: { mode: 'per-team', amountCzk: 720, hidden: true } } });
  await act(async () => checkbox.click());
  expect(checkbox.checked).toBe(true); expect(amount.value).toBe('720');
  await updateEvent('event', 3, { ...saved!, pricingHidden: false });
  expect(mocks.invoke.mock.calls.at(-1)?.[0]).toMatchObject({ event: { pricing: { mode: 'per-team', amountCzk: 720, hidden: false } } });
});
