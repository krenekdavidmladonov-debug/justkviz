import { HttpsError } from 'firebase-functions/v2/https';

import { validateEventConfiguration } from './model.js';
import type { EventConfigurationInput } from './types.js';
import { requestedEventPricing } from './pricing.js';

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

export function requiredId(data: unknown, field: string): string {
  if (!isObject(data) || typeof data[field] !== 'string') {
    throw new HttpsError('invalid-argument', `${field} is required.`);
  }
  const value = data[field];
  if (value.length === 0 || value.length > 1_500 || value.includes('/')) {
    throw new HttpsError('invalid-argument', `${field} is invalid.`);
  }
  return value;
}

export function expectedRevision(data: unknown, field = 'expectedRevision'): number {
  if (!isObject(data) || !Number.isInteger(data[field]) || (data[field] as number) < 0) {
    throw new HttpsError('invalid-argument', `${field} must be a non-negative integer.`);
  }
  return data[field] as number;
}

export function requestedBoolean(data: unknown, field: string): boolean {
  if (!isObject(data) || typeof data[field] !== 'boolean') {
    throw new HttpsError('invalid-argument', `${field} must be boolean.`);
  }
  return data[field];
}

function boundedString(value: unknown, field: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && value.trim() === '')) {
    throw new HttpsError('invalid-argument', `${field} is invalid.`);
  }
  const unsupportedCodePoint = [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 31 || codePoint === 127
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069);
  });
  if (unsupportedCodePoint) {
    throw new HttpsError('invalid-argument', `${field} contains unsupported control characters.`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, field: string, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
    throw new HttpsError('invalid-argument', `${field} must be a positive integer.`);
  }
  return value as number;
}

export function requestedEventConfiguration(data: unknown, options: { readonly allowLegacyTeamSize?: boolean } = {}): EventConfigurationInput {
  if (!isObject(data)) throw new HttpsError('invalid-argument', 'event configuration is required.');
  const value = data.event;
  if (!isObject(value)) throw new HttpsError('invalid-argument', 'event configuration is required.');
  const venue = value.venue;
  if (!isObject(venue)) throw new HttpsError('invalid-argument', 'event venue is required.');
  const startsAtText = boundedString(value.startsAt, 'startsAt', 100);
  const configuration: EventConfigurationInput = {
    ...(Object.hasOwn(value, 'pricing') ? { pricing: (() => {
      try { return requestedEventPricing(value.pricing); }
      catch { throw new HttpsError('invalid-argument', 'pricing must contain a valid mode and amountCzk.'); }
    })() } : {}),
    title: boundedString(value.title, 'title', 300),
    description: (() => { const description = value.description ?? ''; if (typeof description !== 'string' || description.length > 2000 || /[\p{Cf}]/u.test(description)) throw new HttpsError('invalid-argument', 'Popis je neplatný.'); return description.trim(); })(),
    startsAt: new Date(startsAtText),
    timeZone: boundedString(value.timeZone, 'timeZone', 100),
    venue: {
      name: boundedString(venue.name, 'venue.name', 300),
      publicLocation: boundedString(venue.publicLocation, 'venue.publicLocation', 500),
    },
    teamCapacity: positiveInteger(value.teamCapacity, 'teamCapacity', 10_000),
    peopleCapacity: positiveInteger(value.peopleCapacity, 'peopleCapacity', 100_000),
    teamSizeMin: positiveInteger(value.teamSizeMin, 'teamSizeMin', 1_000),
    teamSizeMax: positiveInteger(value.teamSizeMax, 'teamSizeMax', 1_000),
  };
  const issues = validateEventConfiguration(configuration, options);
  if (issues.length > 0) throw new HttpsError('invalid-argument', issues[0]!);
  return configuration;
}
