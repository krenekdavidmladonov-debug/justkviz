import { createHash } from 'node:crypto';
import { brand } from '@filmovy-kviz/quiz-domain';

import type { EmailMessage, EmailTransport } from './delivery.js';
import { EmailDeliveryError } from './errors.js';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const OAUTH_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
export interface GmailConfiguration {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly sender: string;
  readonly replyTo?: string;
  readonly projectId: string;
}
export type GmailFetch = (url: string, init: RequestInit) => Promise<Response>;

export function mailbox(value: string): string {
  // A single ASCII addr-spec, no display names, lists, controls or header injection.
  const parts = value.split('@');
  if (value.length > 254 || parts.length !== 2 || !parts[0] || parts[0].length > 64
    || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(parts[0])
    || parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..')
    || !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/u.test(parts[1] ?? '')) {
    throw new EmailDeliveryError('configuration-invalid', false);
  }
  return value;
}

export function validateGmailConfiguration(config: GmailConfiguration): void {
  if (![config.clientId, config.clientSecret, config.refreshToken].every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 8192 && !/[\r\n\0]/u.test(value))
    || !/^[a-z][a-z0-9-]{4,62}$/u.test(config.projectId)) throw new EmailDeliveryError('configuration-invalid', false);
  mailbox(config.sender);
  if (config.replyTo) mailbox(config.replyTo);
}

function encodedHeader(subject: string): string {
  if (!subject.trim() || subject.length > 1000 || /[\r\n\0]/u.test(subject)) throw new EmailDeliveryError('configuration-invalid', false);
  const chunks: string[] = [];
  let chunk = '';
  for (const point of subject) {
    if (Buffer.byteLength(chunk + point) > 42) { chunks.push(chunk); chunk = ''; }
    chunk += point;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(value => '=?UTF-8?B?' + Buffer.from(value).toString('base64') + '?=').join('\r\n ');
}

export function gmailRawMessage(message: EmailMessage, config: GmailConfiguration): string {
  validateGmailConfiguration(config);
  const to = mailbox(message.to);
  if (!message.idempotencyKey || message.idempotencyKey.length > 1000 || message.text.length + message.html.length > 500_000) throw new EmailDeliveryError('configuration-invalid', false);
  const hash = createHash('sha256').update(config.projectId + ':' + message.idempotencyKey).digest('hex');
  // RFC 2046 limits a multipart boundary to 70 characters (excluding --).
  // Retain 240 bits of the deterministic digest within that limit.
  const boundary = 'justkviz_' + hash.slice(0, 60);
  const date = new Date(message.createdAtMillis ?? 0);
  if (!Number.isFinite(date.getTime())) throw new EmailDeliveryError('configuration-invalid', false);
  const base64 = (text: string) => Buffer.from(text.replace(/\r?\n/gu, '\r\n'), 'utf8').toString('base64').match(/.{1,76}/gu)?.join('\r\n') ?? '';
  const lines = [
    'From: ' + encodedHeader(brand.name) + ' <' + config.sender + '>', 'To: ' + to, ...(config.replyTo ? ['Reply-To: ' + config.replyTo] : []),
    'Subject: ' + encodedHeader(message.subject), 'Date: ' + date.toUTCString(),
    'Message-ID: <' + hash + '@' + config.sender.split('@')[1] + '>', 'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"', '',
    '--' + boundary, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', base64(message.text),
    '--' + boundary, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', base64(message.html),
    '--' + boundary + '--', '',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export class GmailEmailTransport implements EmailTransport {
  constructor(private readonly config: GmailConfiguration, private readonly http: GmailFetch, private readonly timeoutMillis = 15_000) {
    validateGmailConfiguration(config);
  }

  private async request(url: string, init: RequestInit, sending: boolean): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // The timer covers response-body parsing too, including a stalled/malformed body.
      return await Promise.race([
        (async () => {
          const response = await this.http(url, { ...init, redirect: 'error', signal: controller.signal });
          let body: Record<string, unknown> = {};
          try { body = object(await response.json()); } catch { /* Inspect status without exposing body. */ }
          if (response.status === 429) throw new EmailDeliveryError('rate-limited', true);
          // After a send starts, even 5xx cannot prove Gmail did not accept it.
          if (response.status >= 500 || response.status === 408) throw new EmailDeliveryError(sending ? 'outcome-unknown' : 'provider-unavailable', !sending);
          const error = object(body.error);
          const reasons = Array.isArray(error.errors) ? error.errors.map(item => object(item).reason) : [];
          if (response.status === 403 && reasons.some(reason => reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded')) throw new EmailDeliveryError('rate-limited', true);
          if (!response.ok) throw new EmailDeliveryError(
            response.status === 401 || body.error === 'invalid_grant' || body.error === 'invalid_client' ? 'credentials-invalid' : 'configuration-invalid', false);
          return body;
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new EmailDeliveryError(sending ? 'outcome-unknown' : 'network-unavailable', !sending)); }, this.timeoutMillis);
        }),
      ]);
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      throw new EmailDeliveryError(sending ? 'outcome-unknown' : 'network-unavailable', !sending);
    } finally { if (timer) clearTimeout(timer); }
  }

  async send(message: EmailMessage): Promise<void> {
    const raw = gmailRawMessage(message, this.config);
    const token = await this.request(OAUTH_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, refresh_token: this.config.refreshToken, grant_type: 'refresh_token' }).toString(),
    }, false);
    if (typeof token.access_token !== 'string' || !/^[\x21-\x7e]{1,8192}$/u.test(token.access_token)
      || token.token_type !== 'Bearer'
      || (token.scope !== undefined && (typeof token.scope !== 'string' || token.scope !== GMAIL_SEND_SCOPE))) {
      throw new EmailDeliveryError('configuration-invalid', false);
    }
    const result = await this.request(SEND_URL, { method: 'POST',
      headers: { Authorization: 'Bearer ' + token.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }),
    }, true);
    if (typeof result.id !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/u.test(result.id)) throw new EmailDeliveryError('outcome-unknown', false);
  }
}
