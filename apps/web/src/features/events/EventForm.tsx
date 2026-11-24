import { useId, useRef, useState, type FormEvent } from 'react';

import { hasUnsupportedEventText } from '@filmovy-kviz/quiz-domain';
import type { EventFormValues } from './types';
import { eventPriceLabel } from './eventPricing';
import { eventFormInstant } from './eventFormTime';
import './event-form.css';

const missingFieldMessages: Record<string, string> = {
  title: 'Vyplňte název akce.',
  startsAt: 'Vyplňte datum a čas.',
  venueName: 'Vyplňte místo konání.',
  publicLocation: 'Vyplňte upřesnění místa.',
  pricingAmountCzk: 'Vyplňte cenu v Kč.',
  teamCapacity: 'Vyplňte maximální počet týmů.',
  teamSizeMin: 'Vyplňte minimální počet členů týmu.',
  teamSizeMax: 'Vyplňte maximální počet členů týmu.',
};

interface EventFormProps {
  readonly values: EventFormValues;
  readonly pending: boolean;
  readonly submitLabel: string;
  readonly pendingLabel?: string;
  readonly live?: boolean;
  readonly fieldsLocked?: boolean;
  readonly confirmPastDate?: boolean;
  readonly onChange: (values: EventFormValues) => void;
  readonly onSubmit: () => void;
}

export function EventForm({ values, pending, submitLabel, pendingLabel = 'Ukládám…', onChange, onSubmit, live = false, fieldsLocked = false, confirmPastDate = false }: EventFormProps) {
  const form = useRef<HTMLFormElement>(null);
  const formId = useId();
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const fieldId = (name: keyof EventFormValues) => formId + '-' + name;
  const requiredLabel = (name: keyof EventFormValues, text: string) => (
    <span><span id={fieldId(name) + '-label'}>{text}</span><span aria-hidden="true"> *</span></span>
  );
  const fieldProps = (name: keyof EventFormValues) => ({
    name, id: fieldId(name), 'aria-labelledby': fieldId(name) + '-label',
    'aria-invalid': error?.field === name ? true : undefined,
    'aria-describedby': error?.field === name ? fieldId(name) + '-error' : undefined,
  });
  const feedback = (name: keyof EventFormValues) => error?.field === name
    ? <span className="event-field-error" id={fieldId(name) + '-error'} role="alert">{error.message}</span> : null;
  const report = (field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, message: string) => {
    setError({ field: field.name, message });
    field.scrollIntoView({ block: 'center', behavior: 'auto' });
    field.focus({ preventScroll: true });
  };
  const validAmount = Number.isInteger(values.pricingAmountCzk) && values.pricingAmountCzk >= 0 && values.pricingAmountCzk <= 1_000_000;
  const pricePreview = values.pricingMode === 'agreement'
    ? eventPriceLabel({ mode: 'agreement', amountCzk: null })
    : validAmount ? eventPriceLabel({ mode: values.pricingMode, amountCzk: values.pricingAmountCzk }) : 'Zadejte celé koruny od 0 do 1 000 000.';
  const update = <Key extends keyof EventFormValues>(key: Key, value: EventFormValues[Key]) => {
    const next = { ...values, [key]: value };
    if (key === 'startsAt' && value !== values.startsAt) delete next.utcOffset;
    setError(null);
    onChange(next);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const fields = [...event.currentTarget.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')];
    for (const field of fields) {
      if (!field.willValidate) continue;
      let message: string | undefined;
      if (field.required && !field.value.trim()) message = missingFieldMessages[field.name];
      else if (field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement && field.type === 'text')) {
        if (field.maxLength >= 0 && field.value.length > field.maxLength) message = 'Zadejte nejvýše ' + field.maxLength + ' znaků.';
        else if (hasUnsupportedEventText(field.value, field instanceof HTMLTextAreaElement)) message = 'Odstraňte z textu nepodporované znaky.';
      } else if (field instanceof HTMLInputElement) {
        if (field.validity.rangeUnderflow) message = 'Zadejte alespoň ' + field.min + '.';
        else if (field.validity.rangeOverflow) message = 'Zadejte nejvýše ' + field.max + '.';
        else if (field.validity.stepMismatch) message = 'Zadejte celé číslo.';
      }
      if (message || !field.validity.valid) {
        report(field, message ?? 'Zkontrolujte hodnotu tohoto pole.');
        return;
      }
    }
    const dateField = form.current?.elements.namedItem('startsAt');
    if (dateField instanceof HTMLInputElement && dateField.willValidate) {
      let startsAt: string;
      try { startsAt = eventFormInstant(values); }
      catch (issue) { report(dateField, (issue as Error).message); return; }
      if (confirmPastDate && Date.parse(startsAt) < Date.now() && !window.confirm('Akce je v minulosti, opravdu?')) return;
    }
    setError(null);
    onSubmit();
  };
  return (
    <form ref={form} className="event-form" noValidate onSubmit={submit} aria-busy={pending}>
      <fieldset className="event-form-section" disabled={pending || fieldsLocked}>
      <legend>Základní údaje</legend>
      <div className="event-form-grid">
      <label className="form-field event-field-wide">
        {requiredLabel('title', 'Název akce')}
        <input {...fieldProps('title')} required maxLength={300} value={values.title} onChange={(event) => update('title', event.target.value)} />{feedback('title')}
      </label>
      <label className="form-field">
        {requiredLabel('startsAt', 'Datum a čas v Praze')}
        <input {...fieldProps('startsAt')} required type="datetime-local" value={values.startsAt} onChange={(event) => update('startsAt', event.target.value)} />{feedback('startsAt')}
      </label>
      <label className="form-field">
        {requiredLabel('venueName', 'Místo')}
        <input {...fieldProps('venueName')} required maxLength={300} value={values.venueName} onChange={(event) => update('venueName', event.target.value)} />{feedback('venueName')}
      </label>
      <label className="form-field">
        {requiredLabel('publicLocation', 'Veřejné upřesnění místa')}
        <input {...fieldProps('publicLocation')} required maxLength={500} value={values.publicLocation} onChange={(event) => update('publicLocation', event.target.value)} />{feedback('publicLocation')}
      </label>
      <label className="form-field event-field-wide"><span id={fieldId('description') + '-label'}>Popis akce</span><textarea {...fieldProps('description')} maxLength={2000} value={values.description ?? ''} onChange={event => update('description', event.target.value)} />{feedback('description')}</label>
      </div>
      </fieldset>
      <fieldset className="event-form-section" disabled={pending || fieldsLocked}>
        <legend>Cena akce</legend>
        <label className="event-pricing-visibility"><input type="checkbox" checked={values.pricingHidden !== true} onChange={event => update('pricingHidden', !event.target.checked)} /> Zobrazovat cenu na veřejném webu</label>
        <p className="event-muted" id="event-pricing-help">{values.pricingHidden ? 'Cena zůstává uložená pro správce a na veřejném webu se nezobrazuje.' : 'Tato cena se zobrazuje veřejně v přehledu a detailu zveřejněné akce.'} Pro individuální domluvu zvolte Dle dohody.</p>
        <div className="event-form-grid">
          <label className="form-field"><span id={fieldId('pricingMode') + '-label'}>Způsob účtování</span>
            <select {...fieldProps('pricingMode')} value={values.pricingMode} aria-describedby="event-pricing-help" onChange={event => update('pricingMode', event.target.value as EventFormValues['pricingMode'])}>
              <option value="per-team">Za tým</option><option value="per-event">Za celou akci</option><option value="agreement">Dle dohody</option>
            </select>{feedback('pricingMode')}
          </label>
          {values.pricingMode !== 'agreement' && <label className="form-field">{requiredLabel('pricingAmountCzk', 'Cena v Kč')}
            <input {...fieldProps('pricingAmountCzk')} required type="number" min={0} max={1_000_000} step={1} value={Number.isFinite(values.pricingAmountCzk) ? values.pricingAmountCzk : ''} onChange={event => update('pricingAmountCzk', event.target.valueAsNumber)} />{feedback('pricingAmountCzk')}
          </label>}
        </div>
        <p className="event-muted" aria-live="polite">{values.pricingHidden ? 'Veřejně se cena nezobrazuje. Uložená cena: ' : 'Veřejné zobrazení: '}<strong>{pricePreview}</strong></p>
      </fieldset>
      <fieldset className="event-form-section" disabled={pending || live || fieldsLocked}>
      <legend>Kapacita a velikost týmů</legend>
      <p className="event-muted" id="event-capacity-help">{live && 'Během živého běhu je kapacita uzamčená. '}Kapacitu určuje počet týmů. Každý tým může mít nejvýše 4 členy.</p>
      <div className="event-form-grid" aria-describedby="event-capacity-help">
      <label className="form-field">
        {requiredLabel('teamCapacity', 'Maximální počet týmů')}
        <input required type="number" min={1} max={10_000} {...fieldProps('teamCapacity')} value={Number.isFinite(values.teamCapacity) ? values.teamCapacity : ''} onChange={(event) => update('teamCapacity', event.target.valueAsNumber)} />{feedback('teamCapacity')}
      </label>
      <label className="form-field">
        {requiredLabel('teamSizeMin', 'Minimální počet členů týmu')}
        <input required type="number" min={1} max={Math.min(4, values.teamSizeMax || 4)} {...fieldProps('teamSizeMin')} value={Number.isFinite(values.teamSizeMin) ? values.teamSizeMin : ''} onChange={(event) => update('teamSizeMin', event.target.valueAsNumber)} />{feedback('teamSizeMin')}
      </label>
      <label className="form-field">
        {requiredLabel('teamSizeMax', 'Maximální počet členů týmu')}
        <input required type="number" min={values.teamSizeMin || 1} max={4} {...fieldProps('teamSizeMax')} value={Number.isFinite(values.teamSizeMax) ? values.teamSizeMax : ''} onChange={(event) => update('teamSizeMax', event.target.valueAsNumber)} />{feedback('teamSizeMax')}
      </label>
      </div>
      </fieldset>
      <div className="event-form-actions">
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
