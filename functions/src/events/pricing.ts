import type { EventPricing } from './types.js';

export const defaultEventPricing: EventPricing = { mode: 'per-team', amountCzk: 350 };

function sanitizedPricing(value: unknown): EventPricing | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const { mode, amountCzk, hidden } = value as Record<string, unknown>;
  if (hidden !== undefined && typeof hidden !== 'boolean') return null;
  const visibility = hidden === true ? { hidden: true } : {};
  if (mode === 'agreement' && amountCzk === null) return { mode, amountCzk, ...visibility };
  if ((mode === 'per-team' || mode === 'per-event') && typeof amountCzk === 'number'
    && Number.isInteger(amountCzk) && amountCzk >= 0 && amountCzk <= 1_000_000) {
    return { mode, amountCzk, ...visibility };
  }
  return null;
}

/** Only absent historical pricing receives the default; malformed stored values fail closed. */
export function storedEventPricing(value: unknown): EventPricing {
  if (value === undefined) return { ...defaultEventPricing };
  const pricing = sanitizedPricing(value);
  if (pricing === null) throw new Error('Event pricing is malformed.');
  return pricing;
}

export function requestedEventPricing(value: unknown): EventPricing {
  const pricing = sanitizedPricing(value);
  if (pricing === null || Object.keys(value as object).some(key => !['mode', 'amountCzk', 'hidden'].includes(key))
    || !Object.hasOwn(value as object, 'mode') || !Object.hasOwn(value as object, 'amountCzk')
    || (Object.hasOwn(value as object, 'hidden') && typeof (value as Record<string, unknown>).hidden !== 'boolean')) {
    throw new Error('pricing must contain a valid mode and amountCzk.');
  }
  // Retain an explicit false until the update transaction can distinguish unhide
  // from an older client that omits the visibility preference entirely.
  return Object.hasOwn(value as object, 'hidden') ? { ...pricing, hidden: (value as { hidden: boolean }).hidden } : pricing;
}

export function publicEventPricing(value: unknown): EventPricing {
  const pricing = storedEventPricing(value);
  // A benign agreement sentinel also remains readable by cached older clients.
  return pricing.hidden === true ? { mode: 'agreement', amountCzk: null, hidden: true } : pricing;
}
