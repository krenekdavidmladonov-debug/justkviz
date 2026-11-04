/* eslint @typescript-eslint/require-await: off -- HTTP fakes intentionally return immediate async results without network IO. */
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { brand } from '../packages/quiz-domain/src/index';

import { cloudGmailTransport, keyringVault, registrationTokenVault } from '../functions/src/email/config';
import { EmailDeliveryError } from '../functions/src/email/errors';
import { GmailEmailTransport, gmailRawMessage, GMAIL_SEND_SCOPE, mailbox, type GmailConfiguration, type GmailFetch } from '../functions/src/email/gmail';
import { emailTask, enqueueEmailTask } from '../functions/src/email/task';
import { MAX_EMAIL_ATTEMPTS, retryDelayMillis, readProtectedEnvelope } from '../functions/src/email/delivery';

const config: GmailConfiguration = { clientId: 'synthetic-client', clientSecret: 'synthetic-secret', refreshToken: 'synthetic-refresh',
  sender: 'sender@example.test', replyTo: 'reply@example.test', projectId: 'demo-filmovy-kviz-v2' };
const message = { idempotencyKey: 'events/event/emailIntents/intent', to: 'team@example.test', subject: 'Příliš žluťoučký kůň – česká zpráva',
  text: 'Děkujeme!\nPříští večer v 18:00.', html: '<p>Děkujeme! &amp; Žluťoučký</p>', createdAtMillis: 1900000000000 };
afterEach(() => vi.unstubAllEnvs());
const token = () => Response.json({ access_token: 'synthetic-access', token_type: 'Bearer', scope: GMAIL_SEND_SCOPE });
const raw = () => Buffer.from(gmailRawMessage(message, config), 'base64url').toString('utf8');

describe('Gmail MIME', () => {
  test('encodes UTF-8 alternative bodies, folded subject and Gmail base64url', () => {
    const encoded = gmailRawMessage(message, config), mime = raw();
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(mime).toContain('Content-Type: multipart/alternative;');
    const from = mime.split('\r\n')[0]!;
    const decodedFrom = from.replace(/=\?UTF-8\?B\?([^?]+)\?=/gu, (_, data: string) => Buffer.from(data, 'base64').toString('utf8'));
    expect(decodedFrom).toBe(`From: ${brand.name} <sender@example.test>`);
    expect(mime).toContain('\r\nTo: team@example.test\r\nReply-To: reply@example.test');
    const subject = mime.split('Subject: ')[1]!.split('\r\nDate:')[0]!.replace(/=\?UTF-8\?B\?([^?]+)\?=/gu, (_, data: string) => Buffer.from(data, 'base64').toString('utf8')).replace(/\r\n /gu, '');
    expect(subject).toBe(message.subject);
    const bodies = [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/gu)].map(match => Buffer.from(match[1]!.replace(/\r\n/gu, ''), 'base64').toString('utf8'));
    expect(bodies).toEqual([message.text.replace(/\n/gu, '\r\n'), message.html]);
    expect(mime.replace(/\r\n/gu, '')).not.toMatch(/[\r\n]/u);
    expect(mime.split('\r\n').every(line => line.length < 998)).toBe(true);
  });
  test('uses an RFC 2046 boundary of at most 70 characters and exactly two alternatives', () => {
    const mime = raw();
    const boundary = /Content-Type: multipart\/alternative; boundary="([^"]+)"/u.exec(mime)![1]!;
    expect(boundary.length).toBeLessThanOrEqual(70);
    expect(boundary).toMatch(/^[A-Za-z0-9_]+$/u);
    const parts = mime.split('\r\n--' + boundary);
    expect(parts).toHaveLength(4);
    expect(parts[1]).toMatch(/^\r\nContent-Type: text\/plain; charset=UTF-8\r\n/u);
    expect(parts[2]).toMatch(/^\r\nContent-Type: text\/html; charset=UTF-8\r\n/u);
    expect(parts[3]).toBe('--\r\n');
  });
  test('keeps Message-ID stable for retries, distinct across intent and project', () => {
    const id = (value: string) => /Message-ID: (.+)/u.exec(Buffer.from(value, 'base64url').toString())![1];
    const first = gmailRawMessage(message, config);
    expect(gmailRawMessage(message, config)).toBe(first);
    expect(id(gmailRawMessage({ ...message, idempotencyKey: 'other' }, config))).not.toBe(id(first));
    expect(id(gmailRawMessage(message, { ...config, projectId: 'demo-other' }))).not.toBe(id(first));
  });
  test('rejects header injection, recipient lists and malformed mailboxes', () => {
    for (const value of ['a@example.test\r\nBcc: b@example.test', 'a@example.test,b@example.test', 'Name <a@example.test>', '.a@example.test', 'a..b@example.test', 'a@-bad.test']) expect(() => mailbox(value)).toThrow();
    expect(() => gmailRawMessage({ ...message, subject: 'Hi\r\nBcc: forged' }, config)).toThrow();
    expect(() => gmailRawMessage(message, { ...config, replyTo: 'x\n@example.test' })).toThrow();
  });
});

describe('Gmail HTTP classification without internet', () => {
  test('refreshes offline access then invokes only users.messages.send with raw payload', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const http: GmailFetch = async (url, init) => { calls.push({ url, init }); return calls.length === 1 ? token() : Response.json({ id: 'accepted' }); };
    await new GmailEmailTransport(config, http).send(message);
    expect(calls.map(call => call.url)).toEqual(['https://oauth2.googleapis.com/token', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send']);
    expect(new URLSearchParams(calls[0]!.init.body as string).get('grant_type')).toBe('refresh_token');
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ raw: gmailRawMessage(message, config) });
    expect(calls.every(call => call.init.redirect === 'error')).toBe(true);
  });
  test('retries a known HTTP 429 rejection', async () => {
    let calls = 0;
    const transport = new GmailEmailTransport(config, async () => ++calls === 1 ? token() : Response.json({ sensitive: message.text }, { status: 429 }));
    await expect(transport.send(message)).rejects.toMatchObject({ code: 'rate-limited', retryable: true });
    expect(calls).toBe(2);
  });
  for (const status of [408, 500, 503]) test('does not retry an uncertain send HTTP ' + status, async () => {
    let calls = 0;
    await expect(new GmailEmailTransport(config, async () => ++calls === 1 ? token() : Response.json({}, { status })).send(message))
      .rejects.toMatchObject({ code: 'outcome-unknown', retryable: false });
    expect(calls).toBe(2);
  });
  test('OAuth 503 is retryable before any send request', async () => {
    const http = vi.fn(async () => Response.json({}, { status: 503 }));
    await expect(new GmailEmailTransport(config, http).send(message)).rejects.toMatchObject({ code: 'provider-unavailable', retryable: true });
    expect(http).toHaveBeenCalledTimes(1);
  });
  test('invalid_grant is terminal and sends no mail', async () => {
    const http = vi.fn(async () => Response.json({ error: 'invalid_grant', error_description: 'sensitive' }, { status: 400 }));
    await expect(new GmailEmailTransport(config, http).send(message)).rejects.toMatchObject({ code: 'credentials-invalid', retryable: false });
    expect(http).toHaveBeenCalledTimes(1);
  });
  test('quota 403 is retryable, permission 403 is terminal', async () => {
    for (const [reason, retryable] of [['userRateLimitExceeded', true], ['forbidden', false]] as const) {
      let calls = 0;
      await expect(new GmailEmailTransport(config, async () => ++calls === 1 ? token() : Response.json({ error: { errors: [{ reason }] } }, { status: 403 })).send(message)).rejects.toMatchObject({ retryable });
    }
  });
  test('send timeout is unknown outcome and bounded even if fetch ignores abort', async () => {
    let calls = 0;
    await expect(new GmailEmailTransport(config, async () => ++calls === 1 ? token() : new Promise<Response>(() => {}), 5).send(message)).rejects.toMatchObject({ code: 'outcome-unknown', retryable: false });
  });
  test('network error is sanitized and retryable', async () => {
    await expect(new GmailEmailTransport(config, async () => { throw new Error('secret provider body'); }).send(message)).rejects.toMatchObject({ message: 'network-unavailable', retryable: true });
  });
  test('malformed send success is unknown outcome', async () => {
    let calls = 0;
    await expect(new GmailEmailTransport(config, async () => ++calls === 1 ? token() : new Response('not json')).send(message)).rejects.toMatchObject({ code: 'outcome-unknown', retryable: false });
  });
  test('send network error is terminal and sanitized even after submission could have happened', async () => {
    let calls = 0;
    await expect(new GmailEmailTransport(config, async () => {
      if (++calls === 1) return token(); throw new Error('secret provider body');
    }).send(message)).rejects.toMatchObject({ message: 'outcome-unknown', retryable: false });
    expect(calls).toBe(2);
  });
  test('malformed or overprivileged OAuth response sends no mail', async () => {
    for (const data of [{}, { access_token: 'synthetic', token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/gmail.modify' }]) {
      const http = vi.fn(async () => Response.json(data));
      await expect(new GmailEmailTransport(config, http).send(message)).rejects.toMatchObject({ retryable: false });
      expect(http).toHaveBeenCalledTimes(1);
    }
  });
});

test('missing secrets fail closed and emulator cannot construct a cloud transport', () => {
  for (const key of ['clientId', 'clientSecret', 'refreshToken', 'sender'] as const) expect(() => new GmailEmailTransport({ ...config, [key]: '' }, vi.fn())).toThrow(EmailDeliveryError);
  for (const data of ['', '{}', '{"activeKeyId":"key","keys":{"key":"plaintext"}}']) expect(() => keyringVault(data)).toThrow();
  vi.stubEnv('GCLOUD_PROJECT', 'demo-filmovy-kviz-v2'); vi.stubEnv('FIRESTORE_EMULATOR_HOST', '');
  expect(() => registrationTokenVault()).toThrow('not configured');
  expect(() => cloudGmailTransport()).toThrow();
});
test('keyring seals under active key and preserves old encrypted receipts, without plaintext fallback', () => {
  const old = randomBytes(32).toString('base64'), next = randomBytes(32).toString('base64');
  const original = keyringVault(JSON.stringify({ activeKeyId: 'old', keys: { old } }));
  const secret = randomBytes(32).toString('base64url'), envelope = original.seal(secret, 'intent');
  const rotated = keyringVault(JSON.stringify({ activeKeyId: 'next', keys: { old, next } }));
  expect(rotated.open(envelope, 'intent') === secret).toBe(true);
  expect(rotated.seal(secret, 'intent').keyId).toBe('next');
  expect(() => rotated.open(envelope, 'foreign-intent')).toThrow();
  expect(JSON.stringify(envelope).includes(secret)).toBe(false);
});
test('task payload is IDs only, queue replays deduplicate and enqueue errors remain retryable', async () => {
  const task = { eventId: 'event', intentId: 'intent' };
  const enqueue = vi.fn(async () => {});
  await enqueueEmailTask({ enqueue }, task); await enqueueEmailTask({ enqueue }, task);
  expect(enqueue.mock.calls[0]).toEqual(enqueue.mock.calls[1]);
  for (const data of [{ ...task, recipient: 'forged@example.test' }, { ...task, intentId: '../other' }, null]) expect(() => emailTask(data)).toThrow();
  await expect(enqueueEmailTask({ enqueue: async () => { throw Object.assign(new Error('Synthetic existing task'), { code: 'functions/task-already-exists' }); } }, task)).resolves.toBeUndefined();
  await expect(enqueueEmailTask({ enqueue: async () => { throw new Error('secret request'); } }, task)).rejects.toThrow('Email dispatch unavailable.');
});
test('backoff and attempt policy are finite', () => {
  expect(MAX_EMAIL_ATTEMPTS).toBe(5);
  expect([1, 2, 3, 4, 5].map(retryDelayMillis)).toEqual([30000, 60000, 120000, 240000, 480000]);
  expect(retryDelayMillis(100)).toBe(600000);
});


test('transient protected-envelope IO retries while malformed configuration is terminal', async () => {
  for (const code of [4, 8, 10, 13, 14]) await expect(readProtectedEnvelope(() => Promise.reject(Object.assign(new Error('sensitive'), { code })))).rejects.toMatchObject({ retryable: true, message: 'provider-unavailable' });
  await expect(readProtectedEnvelope(() => Promise.reject(new Error('sensitive')))).rejects.toMatchObject({ retryable: false, message: 'configuration-invalid' });
});
