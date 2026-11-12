import type { EventFormValues, EventPricing } from './types';

export const defaultEventPricing: EventPricing = { mode: 'per-team', amountCzk: 350 };

export function mapEventPricing(value: unknown): EventPricing {
  if (value === undefined) return { ...defaultEventPricing };
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const { mode, amountCzk, hidden } = value as Record<string, unknown>;
    if (hidden !== undefined && typeof hidden !== 'boolean') throw new Error('Neplatná cena akce.');
    const visibility = hidden === true ? { hidden: true } : {};
    if (mode === 'agreement' && amountCzk === null) return { mode, amountCzk, ...visibility };
    if ((mode === 'per-team' || mode === 'per-event') && typeof amountCzk === 'number'
      && Number.isInteger(amountCzk) && amountCzk >= 0 && amountCzk <= 1_000_000) {
      return { mode, amountCzk, ...visibility };
    }
  }
  throw new Error('Neplatná cena akce.');
}

export function mapPublicEventPricing(value: unknown): EventPricing {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).hidden === true) return { mode: 'agreement', amountCzk: null, hidden: true };
  const pricing = mapEventPricing(value);
  return pricing.mode === 'agreement' ? { mode: pricing.mode, amountCzk: null } : { mode: pricing.mode, amountCzk: pricing.amountCzk };
}

export function eventFormPricing(values: Pick<EventFormValues, 'pricingMode' | 'pricingAmountCzk' | 'pricingHidden'>): EventPricing {
  return { ...mapEventPricing({ mode: values.pricingMode, amountCzk: values.pricingMode === 'agreement' ? null : values.pricingAmountCzk }), hidden: values.pricingHidden === true };
}

export function eventPriceLabel(pricing: EventPricing = defaultEventPricing): string {
  if (pricing.mode === 'agreement') return 'Cena dle dohody';
  const amount = new Intl.NumberFormat('cs-CZ').format(pricing.amountCzk);
  return `${amount} Kč ${pricing.mode === 'per-event' ? 'za celou akci' : 'za tým'}`;
}
