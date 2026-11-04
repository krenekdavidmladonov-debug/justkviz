import { describe, expect, test } from 'vitest';
import { isRegistrationThrottle, nextRegistrationAbuseState, registrationAbusePolicy, registrationContactKey } from '../functions/src/registrations/abuse';

const interval = registrationAbusePolicy.refillMillis;
function exhausted(action: () => unknown, seconds: number) {
  try { action(); throw new Error('Expected throttling'); }
  catch (error) {
    expect(isRegistrationThrottle(error)).toBe(true);
    expect((error as { details: unknown }).details).toEqual({ reason: 'registration-rate-limit', retryAfterSeconds: seconds });
  }
}

describe('event and contact registration budget', () => {
  test('three immediate committed creates then one token per ten minutes', () => {
    const first = nextRegistrationAbuseState(undefined, 0);
    const second = nextRegistrationAbuseState(first, 0);
    const third = nextRegistrationAbuseState(second, 0);
    expect([first.tokens, second.tokens, third.tokens]).toEqual([2, 1, 0]);
    exhausted(() => nextRegistrationAbuseState(third, 0), 600);
    exhausted(() => nextRegistrationAbuseState(third, interval - 1), 1);
    expect(nextRegistrationAbuseState(third, interval)).toEqual({ tokens: 0, updatedAtMillis: interval });
  });
  test('fractional refill is retained and long idle never permits more than burst', () => {
    const half = { tokens: 0.5, updatedAtMillis: 0 };
    exhausted(() => nextRegistrationAbuseState(half, 0), 300);
    expect(nextRegistrationAbuseState(half, interval / 2).tokens).toBe(0);
    expect(nextRegistrationAbuseState({ tokens: 0, updatedAtMillis: 0 }, interval * 100).tokens).toBe(2);
    expect(half).toEqual({ tokens: 0.5, updatedAtMillis: 0 });
  });
  test('a server clock rollback grants no refill and returns an honest wait', () => {
    exhausted(() => nextRegistrationAbuseState({ tokens: 0, updatedAtMillis: interval }, 0), 1200);
    expect(nextRegistrationAbuseState({ tokens: 2, updatedAtMillis: interval }, 0)).toEqual({ tokens: 1, updatedAtMillis: interval });
  });
  test('corrupt state and invalid clocks fail closed', () => {
    for (const state of [null, [], {}, { tokens: -1, updatedAtMillis: 0 }, { tokens: 4, updatedAtMillis: 0 }, { tokens: NaN, updatedAtMillis: 0 },
      { tokens: Infinity, updatedAtMillis: 0 }, { tokens: 1, updatedAtMillis: -1 }, { tokens: 1, updatedAtMillis: 0.1 }, { tokens: 1, updatedAtMillis: '0' }]) {
      expect(() => nextRegistrationAbuseState(state, 0)).toThrowError(expect.objectContaining({ code: 'unavailable' }));
    }
    for (const now of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => nextRegistrationAbuseState(undefined, now)).toThrow();
  });
  test('stable contact key is normalized, one way and scoped to the event', () => {
    const key = registrationContactKey('event-a', '  SYNTHETIC@EXAMPLE.TEST ');
    expect(key).toMatch(/^[a-f0-9]{64}$/u);
    expect(key).toBe(registrationContactKey('event-a', 'synthetic@example.test'));
    expect(key).not.toBe(registrationContactKey('event-b', 'synthetic@example.test'));
    expect(key).not.toBe(registrationContactKey('event-a', 'other@example.test'));
    expect(key).not.toContain('synthetic');
  });
  test('only the explicit rate-limit error selects the safe throttle marker', () => {
    expect(isRegistrationThrottle(new Error('private payload'))).toBe(false);
    expect(isRegistrationThrottle(Object.assign(new Error('Capacity full'), { code: 'resource-exhausted' }))).toBe(false);
    expect(isRegistrationThrottle(Object.assign(new Error('failure'), { code: 'unavailable', details: { reason: 'registration-rate-limit' } }))).toBe(false);
  });
});