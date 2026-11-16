import { brand } from '@filmovy-kviz/quiz-domain';
import { emailBrandHeader } from './brand.js';
import type { RegistrationOwnerNotificationContent } from './intent.js';
export type RegistrationEmailType = 'registration-confirmed' | 'registration-updated' | 'registration-cancelled';

export interface RegistrationEmailContent {
  readonly eventTitle: string;
  readonly startsAtMillis: number;
  readonly timeZone: string;
  readonly venueName: string;
  readonly publicLocation: string;
  readonly teamName: string;
  readonly memberCount: number;
}

export interface EmailBody {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function managementUrl(origin: string, eventId: string, registrationId: string, token: string): string {
  const base = new URL(origin);
  if (base.origin !== origin || base.username || base.password
    || !(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) {
    throw new Error('Invalid server email origin.');
  }
  return `${origin}/events/${encodeURIComponent(eventId)}/registration/manage#registration=${encodeURIComponent(registrationId)}&token=${encodeURIComponent(token)}`;
}

function singleLine(value: string | undefined): string {
  return typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim() : '';
}

function protectedLink(value: string): string {
  try {
    if (value.length > 8192 || /[\p{Cc}\p{Cf}]/u.test(value)) throw new Error();
    const url = new URL(value);
    const fragment = new URLSearchParams(url.hash.slice(1));
    if (url.username || url.password || url.search
      || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      || !/^\/events\/[^/]+\/registration\/manage$/u.test(url.pathname)
      || [...fragment.keys()].sort().join(',') !== 'registration,token'
      || !/^[A-Za-z0-9_-]{1,150}$/u.test(fragment.get('registration') ?? '')
      || !/^[A-Za-z0-9_-]{43}$/u.test(fragment.get('token') ?? '')) throw new Error();
    return url.href;
  } catch { throw new Error('Invalid management link.'); }
}

function eventTime(content: RegistrationEmailContent): string {
  if (!Number.isFinite(content.startsAtMillis) || !content.timeZone) return '';
  try {
    return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'full', timeStyle: 'short', timeZone: content.timeZone }).format(content.startsAtMillis);
  } catch { return ''; } // Never substitute the worker's time zone or invent a date.
}

/** Authenticated roster destination only: never a public management capability. */
export function registrationOwnerNotification(content: RegistrationOwnerNotificationContent, origin: string, eventId: string): EmailBody {
  const base = new URL(origin);
  if (base.origin !== origin || base.username || base.password
    || !(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))
    || !/^[a-zA-Z0-9_-]{1,150}$/u.test(eventId)) throw new Error('Invalid server email origin or event.');
  const link = `${origin}/admin/events/${encodeURIComponent(eventId)}/registrations`;
  const team = singleLine(content.teamName), event = singleLine(content.eventTitle);
  const when = eventTime({ ...content, venueName: '', publicLocation: '' });
  const rows = [['Akce', event], ['Tým', team],
    ...(Number.isSafeInteger(content.memberCount) && content.memberCount > 0 ? [['Počet hráčů', String(content.memberCount)]] : []),
    ...(when ? [['Termín akce', when]] : [])];
  const title = 'Nová registrace týmu';
  return {
    subject: `${brand.name} | ${title}${team ? ` ${team}` : ''}`,
    text: [title, rows.map(([label, value]) => `${label}: ${value}`).join('\n'), `Přehled registrací: ${link}`, 'Odkaz vyžaduje přihlášení a aktuální oprávnění k akci.'].join('\n\n'),
    html: `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:Arial,Helvetica,sans-serif;line-height:1.6">${emailBrandHeader(origin)}<h1>${title}</h1><table>${rows.map(([label, value]) => `<tr><th style="text-align:left;padding-right:20px">${escapeHtml(label!)}</th><td>${escapeHtml(value!)}</td></tr>`).join('')}</table><p><a href="${escapeHtml(link)}">Přehled registrací</a></p><p>Odkaz vyžaduje přihlášení a aktuální oprávnění k akci.</p></body></html>`,
  };
}

export function registrationEmail(type: RegistrationEmailType, content: RegistrationEmailContent, link?: string, origin?: string): EmailBody {
  if (type === 'registration-confirmed' && !link) throw new Error('Confirmation requires a protected management link.');
  const checkedLink = link ? protectedLink(link) : undefined;
  const team = singleLine(content.teamName), event = singleLine(content.eventTitle);
  const subjectTeam = team ? ` týmu ${team}` : '';
  const subject = {
    'registration-confirmed': `Registrace${subjectTeam} potvrzena`,
    'registration-updated': `Změna registrace${subjectTeam}`,
    'registration-cancelled': `Registrace${subjectTeam} zrušena`,
  }[type];
  const title = { 'registration-confirmed': 'Registrace potvrzena', 'registration-updated': 'Změna registrace', 'registration-cancelled': 'Registrace zrušena' }[type];
  const registration = `registrace${team ? ` týmu „${team}“` : ''}${event ? ` na akci „${event}“` : ''}`;
  const introduction = {
    'registration-confirmed': `${registration} byla potvrzena.`,
    'registration-updated': `údaje ${registration} byly změněny. Níže najdete aktuální informace.`,
    'registration-cancelled': `${registration} byla zrušena. Tým již není aktivně přihlášen na tuto akci.`,
  }[type];
  const when = eventTime(content);
  const where = [...new Set([singleLine(content.venueName), singleLine(content.publicLocation)].filter(Boolean))].join(' · ');
  const rows = [
    ...(event ? [['Akce', event]] : []), ...(when ? [['Kdy', when]] : []), ...(where ? [['Kde', where]] : []),
    ...(team ? [['Tým', team]] : []), ...(Number.isSafeInteger(content.memberCount) && content.memberCount > 0 ? [['Počet hráčů', String(content.memberCount)]] : []),
  ];
  const cta = type === 'registration-cancelled' ? undefined : checkedLink;
  const privacy = 'Tento odkaz umožňuje změnu nebo zrušení registrace. Nesdílejte ho veřejně.';
  const followUp = type === 'registration-confirmed' ? 'Těšíme se na vás.'
    : type === 'registration-updated' ? 'Pokud jste změnu neprovedli, obraťte se na pořadatele.'
      : 'Pokud jde o omyl, obraťte se na pořadatele.';
  const footer = `Tým ${brand.name}`;
  const contact = 'V případě dotazů se obraťte na pořadatele konkrétní akce.';
  const payment = type === 'registration-cancelled' ? '' : 'Platba za kvíz se provádí na místě před začátkem.';
  const text = ['Dobrý den,', introduction, rows.map(([label, value]) => `${label}: ${value}`).join('\n'),
    ...(cta ? [`Spravovat registraci: ${cta}`, privacy] : []), payment, followUp, contact, footer].filter(Boolean).join('\n\n');
  return {
    subject: `${brand.name} | ${subject}`,
    text,
    html: `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;padding:0;background:#f3f5f7;color:#0b1220;font-family:Arial,Helvetica,sans-serif;line-height:1.6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #dbe1e8;border-radius:12px"><tr><td style="padding:20px 24px;background:#0b1220;border-top:4px solid #ffc107;border-radius:12px 12px 0 0">${emailBrandHeader(origin)}</td></tr><tr><td style="padding:24px;word-break:break-word"><h1 style="margin:0 0 24px;font-size:26px;line-height:1.25">${escapeHtml(title)}</h1><p>Dobrý den,</p><p>${escapeHtml(introduction)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;border-top:1px solid #dbe1e8">${rows.map(([label, value]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #dbe1e8"><span style="color:#526174;font-size:13px">${escapeHtml(label!)}<br></span><strong style="font-size:16px">${escapeHtml(value!)}</strong></td></tr>`).join('')}</table>${cta ? `<p style="margin:28px 0"><a style="display:inline-block;padding:12px 20px;background:#ffc107;color:#0b1220;border-radius:8px;text-decoration:none;font-weight:bold" href="${escapeHtml(cta)}">Spravovat registraci</a></p><p style="font-size:13px;color:#526174">${privacy}</p><p style="font-size:13px">Pokud tlačítko nefunguje, otevřete tento odkaz:<br><a style="color:#1d4ed8;word-break:break-all" href="${escapeHtml(cta)}">${escapeHtml(cta)}</a></p>` : ''}${payment ? `<p>${escapeHtml(payment)}</p>` : ''}<p>${escapeHtml(followUp)}</p><p>${escapeHtml(contact)}</p><p style="margin-bottom:0">${escapeHtml(footer)}</p></td></tr></table></td></tr></table></body></html>`,
  };
}
