import { describe, expect, test } from 'vitest';
import { eventDisposition, eventOperational, hasPermission, pragueDateTime, pragueInstant, rolePresets, transitionProblem, type Membership } from '../packages/quiz-domain/src/index';

describe('event lifecycle and old documents', () => {
  test('missing overlay remains visible; archive retains outcome', () => {
    expect(eventDisposition({ lifecycleStatus: 'ready' })).toBe('active');
    expect(eventDisposition({ lifecycleStatus: 'archived' })).toBe('archived');
    expect(eventOperational({ lifecycleStatus: 'ready', disposition: 'trash' })).toBe(false);
    for (const lifecycleStatus of ['completed', 'cancelled']) expect(transitionProblem({ lifecycleStatus }, 'archive')).toBeNull();
    expect(transitionProblem({ lifecycleStatus: 'completed' }, 'cancel')).toBeTruthy();
    expect(transitionProblem({ lifecycleStatus: 'ready', hasActiveSession: true }, 'trash')).toBeTruthy();
    expect(transitionProblem({ disposition: 'deleting' }, 'restore')).toBeTruthy();
    expect(transitionProblem({ lifecycleStatus: 'cancelled', scoring: { started: true } }, 'prepare')).toBeTruthy();
  });
  test('manual completion accepts only prepared or played active events', () => {
    for (const lifecycleStatus of ['ready', 'live', 'finalizing']) expect(transitionProblem({ lifecycleStatus }, 'complete')).toBeNull();
    for (const lifecycleStatus of ['draft', 'scheduled', 'completed', 'cancelled', 'archived']) expect(transitionProblem({ lifecycleStatus }, 'complete')).toBeTruthy();
    for (const disposition of ['trash', 'archived', 'deleting']) expect(transitionProblem({ lifecycleStatus: 'ready', disposition }, 'complete')).toBeTruthy();
  });
  test('deletion requires an explicit permission for every editable role preset', () => {
    expect(rolePresets.owner).toContain('event.delete');
    expect(rolePresets.manager).not.toContain('event.delete');
    expect(rolePresets.moderator).not.toContain('event.delete');
    expect(rolePresets.referee).not.toContain('event.delete');
    for (const role of Object.keys(rolePresets)) {
      expect(hasPermission({ role, permissions: [] } as unknown as Membership, 'event.delete')).toBe(false);
      expect(hasPermission({ role, permissions: ['event.read', 'event.manage'] } as unknown as Membership, 'event.delete')).toBe(false);
      expect(hasPermission({ role, permissions: ['event.read', 'event.delete'] } as unknown as Membership, 'event.delete')).toBe(true);
    }
  });
});
describe('Prague wall time, independent of browser time zone', () => {
  test('winter and summer round trips', () => {
    expect(pragueInstant('2026-01-20T19:30')).toBe('2026-01-20T18:30:00.000Z');
    expect(pragueInstant('2026-07-20T19:30')).toBe('2026-07-20T17:30:00.000Z');
    expect(pragueDateTime(new Date('2026-07-20T17:30:00Z'))).toBe('2026-07-20T19:30');
  });
  test('nonexistent and ambiguous times require correction or explicit offset', () => {
    expect(() => pragueInstant('2026-03-29T02:30')).toThrow('neexistuje');
    expect(() => pragueInstant('2026-10-25T02:30')).toThrow('dvakrát');
    expect(pragueInstant('2026-10-25T02:30', '+02:00')).toBe('2026-10-25T00:30:00.000Z');
    expect(pragueInstant('2026-10-25T02:30', '+01:00')).toBe('2026-10-25T01:30:00.000Z');
  });
});
