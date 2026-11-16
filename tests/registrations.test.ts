import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FunctionsError } from 'firebase/functions';
import { registrationActionError } from '../apps/web/src/features/events/registrationApi';

import { capacityAfter, effectiveRegistrationStatus, hasCapacity, normalizeTeamName } from '../functions/src/registrations/domain';
import { registrationToPrintTeam } from '../functions/src/registrations/print-adapter';
import { registrationInput, registrationWindow } from '../functions/src/registrations/validation';

const capacity = { acceptedTeams: 19, acceptedPeople: 98, maximumTeams: 20, maximumPeople: 100 };

describe('registration domain', () => {
  test('separates publication from window edits and accepts the original combined request', () => {
    expect(registrationWindow({ published: true })).toEqual({ published: true });
    expect(registrationWindow({ published: false })).toEqual({ published: false });
    const dates = { registrationOpensAt: '2030-01-01T00:00:00Z', registrationClosesAt: '2031-01-01T00:00:00Z' };
    expect(registrationWindow(dates)).toEqual({ opensAt: new Date(dates.registrationOpensAt), closesAt: new Date(dates.registrationClosesAt) });
    expect(registrationWindow({ ...dates, published: true })).toMatchObject({ published: true });
    for (const invalid of [{}, { published: 'true' }, { published: null }, { published: true, registrationOpensAt: dates.registrationOpensAt }, { ...dates, registrationClosesAt: dates.registrationOpensAt }]) {
      expect(() => registrationWindow(invalid)).toThrow();
    }
  });
  test('requires explicit publication and a server-derived window when opening registrations now', () => {
    expect(registrationWindow({ published: true, openRegistrationsNow: true })).toEqual({ published: true, openRegistrationsNow: true });
    expect(registrationWindow({ published: false, openRegistrationsNow: false })).toEqual({ published: false });
    for (const invalid of [
      { openRegistrationsNow: true },
      { published: false, openRegistrationsNow: true },
      { published: true, openRegistrationsNow: 'true' },
      { published: true, openRegistrationsNow: null },
      { published: true, openRegistrationsNow: true, registrationOpensAt: '2030-01-01T00:00:00Z' },
      { published: true, openRegistrationsNow: true, registrationClosesAt: '2031-01-01T00:00:00Z' },
      { published: true, openRegistrationsNow: true, registrationOpensAt: null, registrationClosesAt: null },
    ]) expect(() => registrationWindow(invalid)).toThrow();
  });
  test('maps public validation failures to Czech without returning server exception text', () => {
    for (const [code, message, expected] of [
      ['invalid-argument', 'contactEmail is invalid.', 'Zadejte platný e-mail.'],
      ['invalid-argument', 'Team size must be between 2 and 6.', 'Počet členů musí být celé číslo v povoleném rozsahu této akce.'],
      ['failed-precondition', 'Registration capacity is full.', 'Kapacita akce je naplněna. Nový tým nyní nelze přihlásit.'],
      ['failed-precondition', 'Registration is closed.', 'Registrace jsou uzavřené. Přihlášku už nelze měnit ani zrušit.'],
    ] as const) expect(registrationActionError(new FunctionsError(code, message))).toBe(expected);
    expect(registrationActionError(new FunctionsError('failed-precondition', 'INTERNAL PRIVATE DETAIL'))).not.toContain('INTERNAL');
  });
  test('normalizes Unicode, case, and whitespace for event-scoped uniqueness', () => {
    expect(normalizeTeamName('  FILMOVÍ   BORCI ')).toBe(normalizeTeamName('Filmoví borci'));
    expect(normalizeTeamName('Cafe\u0301')).toBe(normalizeTeamName('CAFÉ'));
  });

  test('enforces team capacity while retaining people totals only as bookkeeping', () => {
    expect(hasCapacity(capacity, 1, 2)).toBe(true);
    expect(hasCapacity(capacity, 1, 4)).toBe(true);
    expect(hasCapacity({ ...capacity, maximumPeople: 1 }, 1, 4)).toBe(true);
    expect(hasCapacity({ ...capacity, acceptedTeams: 20, acceptedPeople: 80 }, 1, 2)).toBe(false);
    expect(hasCapacity(capacity, 0, -99)).toBe(false);
    expect(hasCapacity({ ...capacity, acceptedTeams: 0 }, -1, 0)).toBe(false);
    expect(capacityAfter(capacity, -1, -4)).toMatchObject({ acceptedTeams: 18, acceptedPeople: 94 });
  });

  test('uses the server timestamp and publication flag for availability', () => {
    const base = { published: true, lifecycleStatus: 'scheduled', opensAtMillis: 100, closesAtMillis: 200, capacity };
    expect(effectiveRegistrationStatus({ ...base, nowMillis: 99 })).toBe('scheduled');
    expect(effectiveRegistrationStatus({ ...base, nowMillis: 100 })).toBe('open');
    expect(effectiveRegistrationStatus({ ...base, nowMillis: 200 })).toBe('closed');
    expect(effectiveRegistrationStatus({ ...base, published: false, nowMillis: 150 })).toBe('closed');
    expect(effectiveRegistrationStatus({ ...base, capacity: { ...capacity, maximumPeople: 1 }, nowMillis: 150 })).toBe('open');
    expect(effectiveRegistrationStatus({ ...base, capacity: { ...capacity, acceptedTeams: 20 }, nowMillis: 150 })).toBe('full');
  });

  test('validates and canonicalizes public input server-side', () => {
    expect(registrationInput({ teamName: '  Testovací   tým ', memberCount: 4, contactEmail: 'TEAM@EXAMPLE.TEST' })).toEqual({
      teamName: 'Testovací tým', normalizedTeamName: 'testovací tým', memberCount: 4, contactEmail: 'team@example.test',
    });
    expect(() => registrationInput({ teamName: 'Tým\u0000', memberCount: 4, contactEmail: 'team@example.test' })).toThrow();
    expect(() => registrationInput({ teamName: 'Tým', memberCount: 2.5, contactEmail: 'team@example.test' })).toThrow();
    expect(() => registrationInput({ teamName: 'Tým', memberCount: 5, contactEmail: 'team@example.test' })).toThrow();
    expect(() => registrationInput({ teamName: 'Tým', memberCount: 4, contactEmail: 'invalid' })).toThrow();
  });

  test('does not contain a token or contact logging path', () => {
    const source = readFileSync('functions/src/registrations/callables.ts', 'utf8');
    expect(source).not.toMatch(/logger\.|console\./u);
  });
});

describe('registration PrintTeam adapter', () => {
  test('maps only stable id and display name for accepted registrations', () => {
    const team = registrationToPrintTeam('registration-1', {
      status: 'accepted', teamName: ' Syntetický tým ', contactEmail: 'private@example.test', managementTokenHash: 'secret',
    });
    expect(team).toEqual({ id: 'registration-1', name: 'Syntetický tým' });
    expect(JSON.stringify(team)).not.toMatch(/email|private|token|hash/iu);
  });

  test('excludes cancelled registrations', () => {
    expect(registrationToPrintTeam('registration-2', { status: 'cancelled', teamName: 'Zrušený tým' })).toBeUndefined();
  });
});
