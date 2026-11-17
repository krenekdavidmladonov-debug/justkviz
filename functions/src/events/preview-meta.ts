import { Timestamp } from 'firebase-admin/firestore';

function publicText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function dateLabel(startsAt: unknown, timeZone: unknown): string {
  if (!(startsAt instanceof Timestamp)) return '';
  const options = { dateStyle: 'medium', timeStyle: 'short' } as const;
  const date = startsAt.toDate();
  try {
    return new Intl.DateTimeFormat('cs-CZ', { ...options, timeZone: publicText(timeZone) || 'Europe/Prague' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('cs-CZ', { ...options, timeZone: 'Europe/Prague' }).format(date);
  }
}

function teamCapacityLabel(value: unknown): string {
  const teams = object(object(value)?.teams);
  const maximum = teams?.maximum, accepted = teams?.accepted;
  if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || maximum <= 0
      || typeof accepted !== 'number' || !Number.isSafeInteger(accepted) || accepted < 0) return '';
  return 'Volná místa pro týmy: ' + Math.max(0, maximum - accepted);
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function renderEventPreview(html: string, eventId: string, event: Record<string, unknown> | undefined): string {
  if (event?.registrationPublished !== true) return html;
  const title = publicText(event.title);
  if (!title) return html;
  const venue = [...new Set([publicText(event.venueName), publicText(event.publicLocation)].filter(Boolean))].join(', ');
  const description = [dateLabel(event.startsAt, event.timeZone), venue, teamCapacityLabel(event.capacity)].filter(Boolean).join(' · ');
  const tags = { title, description: description || title };
  const url = 'https://justkviz.cz/events/' + encodeURIComponent(eventId);
  return html.replace(/(<meta property="og:(title|description)" content=")[^"]*(")/gu,
    (_match, start: string, tag: keyof typeof tags, end: string) => start + escapeAttribute(tags[tag]) + end)
    .replace(/([ \t]*)<\/head>/u, (_match, indent: string) =>
      `${indent}  <meta property="og:url" content="${escapeAttribute(url)}" />\n${indent}</head>`);
}
