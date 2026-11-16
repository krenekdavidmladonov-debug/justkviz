import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';

import { createTokenVault, emulatorTokenVault } from '../functions/src/email/token-vault';
import { managementUrl, registrationEmail, registrationOwnerNotification } from '../functions/src/email/templates';
import { CaptureEmailTransport } from '../functions/src/dev/capture-email';
import { mapRegistration } from '../apps/web/src/features/events/eventMappers';

const content = { eventTitle: 'Filmový večer <script>alert(1)</script>', startsAtMillis: Date.parse('2031-11-20T18:00:00Z'), timeZone: 'Europe/Prague', venueName: 'Sál & kino', publicLocation: '', teamName: 'Tým "<img src=x onerror=alert(1)>"', memberCount: 4 };
const protectedManagementLink = managementUrl('http://localhost:5000', 'synthetic', 'registration', 'a'.repeat(43));
afterEach(() => vi.unstubAllEnvs());

describe('private organizer registration notification template', () => {
  test('includes only the requested roster details and an authenticated admin destination', () => {
    const body = registrationOwnerNotification({ ...content, contactEmail: 'DO-NOT-RENDER@example.test', token: 'DO-NOT-RENDER' } as typeof content,
      'https://justkviz.cz', 'synthetic-event');
    expect(body.subject).toContain('Nová registrace týmu');
    expect(body.text).toContain(content.teamName);
    expect(body.text).toContain(content.eventTitle);
    expect(body.text).toContain('Počet hráčů: 4'); expect(body.text).toContain('19:00');
    expect(body.text).toContain('https://justkviz.cz/admin/events/synthetic-event/registrations');
    expect(body.html).toContain('href="https://justkviz.cz/admin/events/synthetic-event/registrations"');
    expect(body.html).toContain('&lt;script&gt;'); expect(body.html).toContain('&lt;img');
    expect(body.html).not.toMatch(/<script|<iframe|<form|onerror=alert\(1\)>/u);
    expect(JSON.stringify(body)).not.toMatch(/registration\/manage|#registration=|token=|DO-NOT-RENDER|Sál &|Kde:/u);
  });
  test('sanitizes subject headers and never accepts a destination URL or path from an event ID', () => {
    const body = registrationOwnerNotification({ ...content, teamName: 'Team\r\nBcc: forged\0\u202e' }, 'https://justkviz.cz', 'event');
    expect(body.subject).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    for (const origin of ['javascript:alert(1)', 'https://user:password@example.test', 'http://remote.example.test', 'https://justkviz.cz/path',
      'https://justkviz.cz?token=secret', 'https://justkviz.cz#secret']) expect(() => registrationOwnerNotification(content, origin, 'event')).toThrow();
    for (const eventId of ['../other', 'event?recipient=attacker', 'event#token=secret', 'https://attacker.test', 'event/<script>', '']) {
      expect(() => registrationOwnerNotification(content, 'https://justkviz.cz', eventId)).toThrow();
    }
  });
});

describe('Czech transactional messages', () => {
  test('renders custom-domain management links and artwork while keeping capabilities out of requests', () => {
    const origin = 'https://justkviz.cz', token = 'a'.repeat(43);
    const link = managementUrl(origin, 'synthetic', 'registration', token), url = new URL(link);
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe('/events/synthetic/registration/manage');
    expect(url.search).toBe('');
    expect(url.hash).toContain(token);
    for (const type of ['registration-confirmed', 'registration-updated', 'registration-cancelled'] as const) {
      const body = registrationEmail(type, content, link, origin);
      const image = body.html.match(/<img[^>]+>/u)?.[0];
      expect(image).toContain('src="https://justkviz.cz/brand/justkviz-email.png"');
      expect(image).not.toContain(token);
      expect(body.text.includes(link)).toBe(type !== 'registration-cancelled');
      expect(body.html.includes(link.replaceAll('&', '&amp;'))).toBe(type !== 'registration-cancelled');
      expect(body.html).not.toMatch(/justkviz-v2\.web\.app|filmovy-kviz-v2-staging\.web\.app/u);
    }
  });
  test('uses the configured public logo without copying protected link capabilities into image URLs', () => {
    for (const type of ['registration-confirmed', 'registration-updated', 'registration-cancelled'] as const) {
      const body = registrationEmail(type, content, protectedManagementLink, 'https://justkviz-v2.web.app');
      expect(body.html).toContain('<img src="https://justkviz-v2.web.app/brand/justkviz-email.png" width="264" height="60" alt="JustKvíz"');
      expect(body.html.match(/<img[^>]+>/gu)).toHaveLength(1);
      expect(body.html.match(/<img[^>]+>/u)?.[0]).not.toMatch(/registration|token|localhost/u);
      expect(body.text).toContain('Tým JustKvíz');
    }
    for (const origin of ['javascript:alert(1)', 'https://user:password@example.test', 'https://example.test/path', 'https://example.test?token=secret']) {
      expect(registrationEmail('registration-updated', content, undefined, origin).html).not.toContain('<img');
    }
  });
  for (const type of ['registration-confirmed', 'registration-updated', 'registration-cancelled'] as const) {
    test(type + ' has text, escaped HTML and event/team details', () => {
      const body = registrationEmail(type, content, protectedManagementLink);
      expect(body.subject.length > 10).toBe(true);
      expect(body.text.includes(content.teamName) && body.text.includes('19:00') && body.text.includes('Počet hráčů: 4')).toBe(true);
      expect(body.html.includes('<script>') || body.html.includes('<img')).toBe(false);
      expect(body.html.includes('&lt;script&gt;') && body.html.includes('&amp;')).toBe(true);
      expect(body.html.includes('href=')).toBe(type !== 'registration-cancelled');
      expect(body.subject).toBe('JustKvíz | ' + {
        'registration-confirmed': `Registrace týmu ${content.teamName} potvrzena`,
        'registration-updated': `Změna registrace týmu ${content.teamName}`,
        'registration-cancelled': `Registrace týmu ${content.teamName} zrušena`,
      }[type]);
      expect(body.text).toContain('Dobrý den,'); expect(body.text).toContain('Tým JustKvíz');
      expect(body.html).toContain('max-width:600px'); expect(body.html).not.toMatch(/<script|<iframe|<img|<form|https?:\/\/(?!localhost)/u);
      expect(body.text.includes('Tým již není aktivně přihlášen')).toBe(type === 'registration-cancelled');
    });
  }
  test('requires a confirmation link and rejects unsafe link protocols', () => {
    expect(() => registrationEmail('registration-confirmed', content)).toThrow();
    expect(() => registrationEmail('registration-confirmed', content, 'javascript:alert(1)')).toThrow();
    for (const unsafe of [protectedManagementLink.replace('localhost:5000', 'remote.example.test'),
      protectedManagementLink.replace('localhost:5000', 'user:password@localhost:5000'),
      protectedManagementLink + '&token=' + 'b'.repeat(43), protectedManagementLink.replace('/registration/manage#', '/other#')]) {
      expect(() => registrationEmail('registration-updated', content, unsafe)).toThrow('Invalid management link.');
    }
  });
  test('uses an actual update capability while historical updates remain deliverable without a link', () => {
    const current = registrationEmail('registration-updated', content, protectedManagementLink);
    expect(current.text).toContain(`Spravovat registraci: ${protectedManagementLink}`);
    expect(current.html).toContain(protectedManagementLink.replace('&', '&amp;'));
    expect(current.text).toContain('Nesdílejte ho veřejně.');
    const historical = registrationEmail('registration-updated', content);
    expect(historical.text).toContain('byly změněny'); expect(historical.html).not.toContain('href=');
    expect(historical.text).not.toContain('Spravovat registraci:');
  });
  test('omits absent or invalid optional details without invented defaults', () => {
    const absent = registrationEmail('registration-cancelled', { ...content, eventTitle: '', teamName: '', startsAtMillis: Number.NaN,
      venueName: '', publicLocation: '', memberCount: 0 });
    expect(absent.subject).toBe('JustKvíz | Registrace zrušena');
    expect(absent.text).not.toMatch(/Kdy:|Kde:|Akce:|Tým:|Počet hráčů:|undefined|NaN|Invalid Date/u);
    expect(absent.text).toContain('obraťte na pořadatele konkrétní akce');
    expect(registrationEmail('registration-updated', { ...content, timeZone: 'not-a-time-zone' }).text).not.toContain('Kdy:');
  });
  test('formats real event time with daylight saving and includes a known address only once', () => {
    const summer = registrationEmail('registration-updated', { ...content, startsAtMillis: Date.parse('2031-07-20T18:00:00Z'),
      venueName: 'Praha', publicLocation: 'Praha' });
    expect(summer.text).toContain('20:00'); expect(summer.text).toContain('Kde: Praha'); expect(summer.text).not.toContain('Praha · Praha');
  });
  test('keeps capabilities in URL fragments on the configured server origin', () => {
    const token = randomBytes(32).toString('base64url');
    const link = new URL(managementUrl('https://mail.example.test', 'event', 'registration', token));
    expect(link.search === '' && !link.pathname.includes(token) && link.hash.includes(token)).toBe(true);
    for (const origin of ['http://remote.example.test', 'https://user:password@example.test', 'https://example.test/redirect', 'javascript:alert(1)']) {
      expect(() => managementUrl(origin, 'event', 'registration', token)).toThrow();
    }
  });
  test('prevents subject header injection', () => {
    expect(registrationEmail('registration-updated', { ...content, teamName: 'Tým\r\nBcc: forged\0\u202e' }).subject).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  });
});

describe('protected management capability', () => {
  test('round-trips without plaintext persistence and uses fresh nonces', () => {
    const vault = createTokenVault('unit-key', randomBytes(32));
    const token = randomBytes(32).toString('base64url');
    const first = vault.seal(token, 'event/registration/intent');
    const second = vault.seal(token, 'event/registration/intent');
    expect(vault.open(first, 'event/registration/intent') === token).toBe(true);
    expect(JSON.stringify(first).includes(token)).toBe(false);
    expect(first.ciphertext !== second.ciphertext && first.nonce !== second.nonce).toBe(true);
  });
  test('rejects cross-intent replay, tampering, unknown key version and wrong key safely', () => {
    const vault = createTokenVault('unit-key', randomBytes(32));
    const token = randomBytes(32).toString('base64url');
    const envelope = vault.seal(token, 'event/registration/intent');
    for (const operation of [
      () => vault.open(envelope, 'another/registration/intent'),
      () => vault.open({ ...envelope, ciphertext: randomBytes(43).toString('base64') }, 'event/registration/intent'),
      () => vault.open({ ...envelope, keyId: 'unknown' }, 'event/registration/intent'),
      () => createTokenVault('unit-key', randomBytes(32)).open(envelope, 'event/registration/intent'),
    ]) expect(operation).toThrow('Management link protection is unavailable.');
  });
  for (const [project, host] of [['filmovy-kviz-v2-staging', '127.0.0.1:8080'], ['demo-filmovy-kviz-v2', 'remote.test:8080'], ['demo-filmovy-kviz-v2', 'localhost:99999'], ['demo-filmovy-kviz-v2', '']]) {
    test(`refuses emulator fixture outside demo/local guard (${project}, ${host || 'missing'})`, () => {
      expect(() => emulatorTokenVault({ GCLOUD_PROJECT: project, FIRESTORE_EMULATOR_HOST: host })).toThrow('not configured');
    });
  }
  test('does not log tokens, provider exceptions or message bodies', () => {
    for (const path of ['functions/src/email/delivery.ts', 'functions/src/email/token-vault.ts', 'functions/src/email/intent.ts', 'functions/src/dev/capture-email.ts']) {
      expect(readFileSync(path, 'utf8')).not.toMatch(/(?:console|logger)\./u);
    }
  });
});

test('local capture deduplicates an accepted message after a lost response', async () => {
  vi.stubEnv('GCLOUD_PROJECT', 'demo-filmovy-kviz-v2'); vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
  const capture = new CaptureEmailTransport();
  const message = { idempotencyKey: 'logical-message', to: 'synthetic@example.test', ...registrationEmail('registration-updated', content) };
  capture.nextFailure = 'before-accept';
  await expect(capture.send(message)).rejects.toThrow('provider-unavailable');
  expect(capture.messages.size).toBe(0);
  capture.nextFailure = 'after-accept';
  await expect(capture.send(message)).rejects.toThrow('outcome-unknown');
  await capture.send(message);
  expect(capture.messages.size).toBe(1);
  await expect(capture.send({ ...message, subject: 'Different retry payload' })).rejects.toThrow('Synthetic idempotency payload mismatch.');
});

test('organizer mapper includes only safe delivery status and timestamp', () => {
  const stamp = Timestamp.fromDate(new Date('2030-01-01T00:00:00Z'));
  const row = mapRegistration('synthetic', { eventId: 'event', teamName: 'Synthetic', memberCount: 4, contactEmail: 'team@example.test', status: 'accepted', createdAt: stamp, updatedAt: stamp,
    emailDelivery: { status: 'failed', updatedAt: stamp, providerPayload: 'DO NOT EXPOSE', rawToken: 'DO NOT EXPOSE' } });
  expect(row.emailDelivery?.status).toBe('failed');
  expect(JSON.stringify(row).includes('DO NOT EXPOSE')).toBe(false);
});
