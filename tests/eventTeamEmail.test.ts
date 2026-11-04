import { readTeamMessageRecovery } from '../apps/web/src/features/events/teamMessageRecovery';
import { describe, expect, it } from 'vitest';
import { deliverySummary, eventTeamMessage, messageCopy, messageInput, recipientSnapshot, teamMessageEventTitle, teamMessageHash } from '../functions/src/email/team-message';
const row = (id: string, contactEmail: unknown = 'same@example.test', status = 'accepted') => ({ id, data: { eventId: 'event', contactEmail, status } });
describe('event team email boundary', () => {
  it('uses the configured public logo and keeps a plain text brand fallback', () => {
    const email = eventTeamMessage({ subject: 'Začínáme', message: 'Od 18:00', eventTitle: 'Večer' }, 'https://justkviz-v2.web.app');
    expect(email.html).toContain('src="https://justkviz-v2.web.app/brand/justkviz-email.png"');
    expect(email.html).toContain('alt="JustKvíz"');
    expect(email.html).not.toContain('registration/manage');
    expect(email.text).toContain('JustKvíz');
  });
  it('normalizes Czech plain text and escapes HTML without a management CTA', () => {
    const copy = messageCopy({ subject: '  Zítra začínáme ', message: ' Čaj & <script>&lt;&gt;\r\nOd 18:00 ' });
    expect(copy.subject).toBe('Zítra začínáme'); expect(copy.message).toContain('\nOd 18:00');
    const email = eventTeamMessage({ ...copy, eventTitle: '<Večer>' });
    expect(email.html).toContain('&lt;script&gt;'); expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;Večer&gt;'); expect(email.text).not.toContain('registration/manage');
  });
  it('rejects recipient injection, header injection, private links and oversized content', () => {
    expect(() => messageInput({ recipient: 'attacker@example.test' }, ['subject', 'message'])).toThrow();
    for (const copy of [{ subject: 'Hello\nBcc: other', message: 'text' }, { subject: 'Title', message: 'x'.repeat(4001) }, { subject: 'Title', message: 'https://example.test/referee#token=secret' }, { subject: 'Title', message: 'a'.repeat(43) }, { subject: 'Title', message: '-' + 'a'.repeat(42) }, { subject: 'Title', message: 'a'.repeat(42) + '-' }]) expect(() => messageCopy(copy)).toThrow();
  });
  it('rejects private capabilities in the added event title', () => { expect(() => teamMessageEventTitle('-' + 'a'.repeat(42))).toThrow(); });
  it('takes each accepted registration, preserving shared mailboxes and skipping absent addresses', () => {
    expect(recipientSnapshot('event', [row('b'), row('a'), row('manual', null), row('cancel', 'cancel@example.test', 'cancelled'), row('waiting', 'wait@example.test', 'pending')])).toEqual([{ registrationId: 'a', recipient: 'same@example.test' }, { registrationId: 'b', recipient: 'same@example.test' }]);
  });
  it('never truncates before filtering and fails atomically above 450', () => {
    expect(recipientSnapshot('event', [...Array.from({ length: 600 }, (_, i) => row('none' + i, null)), row('last')])).toHaveLength(1);
    expect(recipientSnapshot('event', Array.from({ length: 450 }, (_, i) => row('r' + i)))).toHaveLength(450);
    expect(() => recipientSnapshot('event', Array.from({ length: 451 }, (_, i) => row('r' + i)))).toThrow();
  });
  it('rejects cross-event or malformed contact records', () => {
    expect(() => recipientSnapshot('other', [row('a')])).toThrow(); expect(() => recipientSnapshot('event', [row('a', 'bad\nBcc: x')])).toThrow();
  });
  it('fingerprints contents and recipients, counts processing as pending without exposing addresses', () => {
    expect(teamMessageHash(['event', row('a')])).not.toBe(teamMessageHash(['event', row('a', 'changed@example.test')]));
    expect(deliverySummary(['pending', 'processing', 'sent', 'failed'])).toEqual({ total: 4, pending: 2, sent: 1, failed: 1 });
    expect(() => deliverySummary(['unknown'])).toThrow();
  });
});

describe('uncertain team message browser recovery', () => {
  const request = { eventId: 'event', requestId: 'request', subject: 'Title', message: 'Body', confirmed: true, previewFingerprint: 'a'.repeat(64) };
  const data = { request, preview: { ...request, total: 2, eventTitle: 'Event' } };
  it('restores a valid operation and distinguishes no operation', () => {
    expect(readTeamMessageRecovery(() => JSON.stringify(data), 'event')).toEqual({ data, blocked: false });
    expect(readTeamMessageRecovery(() => null, 'event')).toEqual({ data: null, blocked: false });
  });
  it('blocks malformed, incomplete and cross-event recovery without dropping the operation', () => {
    for (const raw of ['invalid', '{}', 'null', JSON.stringify({ ...data, request: { ...request, eventId: 'other' } })]) expect(readTeamMessageRecovery(() => raw, 'event')).toEqual({ data: null, blocked: true });
  });
  it('blocks when tab storage cannot be read', () => { expect(readTeamMessageRecovery(() => { throw new Error('Storage unavailable'); }, 'event').blocked).toBe(true); });
});
