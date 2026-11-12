import type { FormEvent } from 'react';

import type { EventFormValues } from './types';
import { eventPriceLabel } from './eventPricing';

interface EventFormProps {
  readonly values: EventFormValues;
  readonly pending: boolean;
  readonly submitLabel: string;
  readonly pendingLabel?: string;
  readonly live?: boolean;
  readonly onChange: (values: EventFormValues) => void;
  readonly onSubmit: () => void;
}

export function EventForm({ values, pending, submitLabel, pendingLabel = 'Ukládám…', onChange, onSubmit, live = false }: EventFormProps) {
  const validAmount = Number.isInteger(values.pricingAmountCzk) && values.pricingAmountCzk >= 0 && values.pricingAmountCzk <= 1_000_000;
  const pricePreview = values.pricingMode === 'agreement'
    ? eventPriceLabel({ mode: 'agreement', amountCzk: null })
    : validAmount ? eventPriceLabel({ mode: values.pricingMode, amountCzk: values.pricingAmountCzk }) : 'Zadejte celé koruny od 0 do 1 000 000.';
  const update = <Key extends keyof EventFormValues>(key: Key, value: EventFormValues[Key]) => {
    onChange({ ...values, [key]: value });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!pending) onSubmit();
  };
  return (
    <form className="event-form" onSubmit={submit} aria-busy={pending}>
      <fieldset className="event-form-section" disabled={pending}>
      <legend>Základní údaje</legend>
      <div className="event-form-grid">
      <label className="form-field event-field-wide">
        <span>Název akce</span>
        <input required maxLength={300} value={values.title} onChange={(event) => update('title', event.target.value)} />
      </label>
      <label className="form-field">
        <span>Datum a čas v Praze</span>
        <input required type="datetime-local" value={values.startsAt} onChange={(event) => update('startsAt', event.target.value)} />
      </label>
      <label className="form-field">
        <span>Europe/Prague · při opakovaném čase</span><select value={values.utcOffset ?? ''} onChange={event => update('utcOffset', event.target.value)}><option value="">Automaticky</option><option value="+02:00">Letní čas (UTC+2)</option><option value="+01:00">Zimní čas (UTC+1)</option></select>
      </label>
      <label className="form-field">
        <span>Místo</span>
        <input required maxLength={300} value={values.venueName} onChange={(event) => update('venueName', event.target.value)} />
      </label>
      <label className="form-field">
        <span>Veřejné upřesnění místa</span>
        <input required maxLength={500} value={values.publicLocation} onChange={(event) => update('publicLocation', event.target.value)} />
      </label>
      <label className="form-field event-field-wide"><span>Popis akce</span><textarea maxLength={2000} value={values.description ?? ''} onChange={event => update('description', event.target.value)} /></label>
      </div>
      </fieldset>
      <fieldset className="event-form-section" disabled={pending}>
        <legend>Cena akce</legend>
        <label className="event-pricing-visibility"><input type="checkbox" checked={values.pricingHidden !== true} onChange={event => update('pricingHidden', !event.target.checked)} /> Zobrazovat cenu na veřejném webu</label>
        <p className="event-muted" id="event-pricing-help">{values.pricingHidden ? 'Cena zůstává uložená pro správce a na veřejném webu se nezobrazuje.' : 'Tato cena se zobrazuje veřejně v přehledu a detailu zveřejněné akce.'} Pro individuální domluvu zvolte Dle dohody.</p>
        <div className="event-form-grid">
          <label className="form-field"><span>Způsob účtování</span>
            <select value={values.pricingMode} aria-describedby="event-pricing-help" onChange={event => update('pricingMode', event.target.value as EventFormValues['pricingMode'])}>
              <option value="per-team">Za tým</option><option value="per-event">Za celou akci</option><option value="agreement">Dle dohody</option>
            </select>
          </label>
          {values.pricingMode !== 'agreement' && <label className="form-field"><span>Cena v Kč</span>
            <input required type="number" min={0} max={1_000_000} step={1} value={Number.isFinite(values.pricingAmountCzk) ? values.pricingAmountCzk : ''} onChange={event => update('pricingAmountCzk', event.target.valueAsNumber)} />
          </label>}
        </div>
        <p className="event-muted" aria-live="polite">{values.pricingHidden ? 'Veřejně se cena nezobrazuje. Uložená cena: ' : 'Veřejné zobrazení: '}<strong>{pricePreview}</strong></p>
      </fieldset>
      <fieldset className="event-form-section" disabled={pending || live}>
      <legend>Kapacita a velikost týmů</legend>
      <p className="event-muted" id="event-capacity-help">{live && 'Během živého běhu je kapacita uzamčená. '}Kapacitu určuje počet týmů. Každý tým může mít nejvýše 4 členy.</p>
      <div className="event-form-grid" aria-describedby="event-capacity-help">
      <label className="form-field">
        <span>Maximální počet týmů</span>
        <input required type="number" min={1} max={10_000} value={values.teamCapacity} onChange={(event) => update('teamCapacity', event.target.valueAsNumber)} />
      </label>
      <label className="form-field">
        <span>Minimální počet členů týmu</span>
        <input required type="number" min={1} max={Math.min(4, values.teamSizeMax || 4)} value={values.teamSizeMin} onChange={(event) => update('teamSizeMin', event.target.valueAsNumber)} />
      </label>
      <label className="form-field">
        <span>Maximální počet členů týmu</span>
        <input required type="number" min={values.teamSizeMin || 1} max={4} value={values.teamSizeMax} onChange={(event) => update('teamSizeMax', event.target.valueAsNumber)} />
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
