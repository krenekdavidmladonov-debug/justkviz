import { createHash } from 'node:crypto';
import { brand } from '@filmovy-kviz/quiz-domain';
import { HttpsError } from 'firebase-functions/v2/https';

import { mailbox } from './gmail.js';
import { emailBrandHeader } from './brand.js';
import { escapeHtml, type EmailBody } from './templates.js';

export const MAX_TEAM_MESSAGE_RECIPIENTS = 450; // Below the existing 475-write snapshot safety budget.
export const MAX_ACCEPTED_ROSTER = 10_000; // Existing event capacity ceiling; never truncate before filtering.
export interface TeamMessageContent { readonly subject: string; readonly message: string; readonly eventTitle: string }
export interface TeamMessageRecipient { readonly registrationId: string; readonly recipient: string }
export const teamMessageHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function messageInput(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new HttpsError('invalid-argument', 'Neplatný požadavek zprávy.');
  return value as Record<string, unknown>;
}
export function messageId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/u.test(value)) throw new HttpsError('invalid-argument', 'Neplatné ID zprávy.');
  return value;
}
export function safeTeamMessageText(value: string): boolean {
  return !/registration\/manage|#registration=|[?&#](?:token|key)=|(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/iu.test(value);
}
export function teamMessageEventTitle(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 300 || /[\p{Cc}\p{Cf}]/u.test(value) || !safeTeamMessageText(value)) throw new HttpsError('failed-precondition', 'Akce má neplatný název pro zprávu.');
  return value;
}
export function messageCopy(data: Record<string, unknown>): Pick<TeamMessageContent, 'subject' | 'message'> {
  if (typeof data.subject !== 'string' || typeof data.message !== 'string') throw new HttpsError('invalid-argument', 'Vyplňte předmět a zprávu.');
  const subject = data.subject.trim(), message = data.message.replace(/\r\n?/gu, '\n').trim();
  if (!subject || subject.length > 200 || /[\p{Cc}\p{Cf}]/u.test(subject) || !message || message.length > 4000
    || /[\p{Cc}\p{Cf}]/u.test(message.replace(/\n/gu, '')) || Buffer.byteLength(subject + message) > 8000) throw new HttpsError('invalid-argument', 'Předmět nebo zpráva překračuje povolený rozsah.');
  // Never turn organizational mail into a channel for registration/referee capabilities.
  if (!safeTeamMessageText(subject + '\n' + message)) throw new HttpsError('invalid-argument', 'Do organizační zprávy nevkládejte soukromé přístupové odkazy ani tokeny.');
  return { subject, message };
}
export function recipientSnapshot(eventId: string, rows: readonly { id: string; data: Record<string, unknown> }[]): TeamMessageRecipient[] {
  if (rows.length > MAX_ACCEPTED_ROSTER) throw new HttpsError('resource-exhausted', 'Soupiska překračuje podporovaný rozsah.');
  const recipients: TeamMessageRecipient[] = [];
  for (const row of rows) {
    if (row.data.status !== 'accepted') continue;
    if (row.data.eventId !== eventId) throw new HttpsError('failed-precondition', 'Registrace nepatří do této akce.');
    if (row.data.contactEmail == null || row.data.contactEmail === '') continue;
    if (typeof row.data.contactEmail !== 'string') throw new HttpsError('failed-precondition', 'Registrace obsahuje neplatný email.');
    let email: string;
    try { email = mailbox(row.data.contactEmail); } catch { throw new HttpsError('failed-precondition', 'Registrace obsahuje neplatný email.'); }
    recipients.push({ registrationId: messageId(row.id), recipient: email });
  }
  if (recipients.length > MAX_TEAM_MESSAGE_RECIPIENTS) throw new HttpsError('resource-exhausted', 'Jedna zpráva podporuje nejvýše 450 příjemců. Nic nebylo odesláno.');
  return recipients.sort((a, b) => a.registrationId.localeCompare(b.registrationId));
}
export function eventTeamMessage(content: TeamMessageContent, origin?: string): EmailBody {
  const paragraphs = content.message.split('\n').map(line => line ? '<p>' + escapeHtml(line) + '</p>' : '<br>').join('');
  return { subject: content.subject, text: [content.eventTitle, content.message, brand.name].join('\n\n'),
    html: '<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="font-family:Arial,sans-serif;line-height:1.6;color:#202938;padding:24px"><main style="max-width:560px;margin:auto"><div style="padding:20px 24px;background:#0b1220;border-top:4px solid #ffc107">' + emailBrandHeader(origin) + '</div><h1>' + escapeHtml(content.eventTitle) + '</h1>' + paragraphs + '<p>' + brand.name + '</p></main></body></html>' };
}
export function deliverySummary(statuses: readonly unknown[]) {
  if (statuses.some(status => !['pending', 'processing', 'sent', 'failed'].includes(status as string))) throw new HttpsError('failed-precondition', 'Stav zprávy je neplatný.');
  return { total: statuses.length, pending: statuses.filter(status => status === 'pending' || status === 'processing').length,
    sent: statuses.filter(status => status === 'sent').length, failed: statuses.filter(status => status === 'failed').length };
}
