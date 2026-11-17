import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { Timestamp } from '../functions/node_modules/firebase-admin/lib/firestore/index.js';
import { renderEventPreview } from '../functions/src/events/preview-meta';

const html = readFileSync(new URL('../apps/web/index.html', import.meta.url), 'utf8');
const event = {
  registrationPublished: true,
  title: 'Kvíz "Město" & <filmy>',
  startsAt: Timestamp.fromDate(new Date('2031-11-20T18:00:00Z')),
  timeZone: 'Europe/Prague',
  venueName: "Sál u D'Artagnana",
  publicLocation: 'Nový Malín',
  capacity: { teams: { maximum: 20, accepted: 16 } },
  description: 'UNUSED_EVENT_DESCRIPTION',
  contactEmail: 'PRIVATE_EMAIL_SENTINEL',
};

describe('event link preview', () => {
  it('changes only the title, description and canonical Open Graph URL using public fields', () => {
    const rendered = renderEventPreview(html, 'synthetic-id', event);
    expect(rendered).toContain('property="og:title" content="Kvíz &quot;Město&quot; &amp; &lt;filmy&gt;"');
    const normalized = rendered.replace(/\s+/gu, ' ');
    expect(normalized).toMatch(/property="og:description" content="20\. 11\. 2031.*19:00.*Sál u D&#39;Artagnana, Nový Malín · Volná místa pro týmy: 4"/u);
    expect(rendered).toContain('property="og:url" content="https://justkviz.cz/events/synthetic-id"');
    expect(rendered).not.toMatch(/UNUSED_EVENT_DESCRIPTION|PRIVATE_EMAIL_SENTINEL/u);
    const meta = /(<meta property="og:(?:title|description|url)" content=")[^"]+/gu;
    expect(rendered.replace(meta, '$1')).toBe(html.replace(meta, '$1'));
  });

  it('keeps default metadata for missing, unpublished and malformed events', () => {
    expect(renderEventPreview(html, 'missing', undefined)).toBe(html);
    expect(renderEventPreview(html, 'private', { ...event, registrationPublished: false })).toBe(html);
    expect(renderEventPreview(html, 'invalid', { registrationPublished: true })).toBe(html);
  });

  it('reports zero for full events and omits missing legacy capacity values', () => {
    expect(renderEventPreview(html, 'full', { ...event, capacity: { teams: { maximum: 20, accepted: 21 } } }))
      .toContain('Volná místa pro týmy: 0');
    const old = renderEventPreview(html, 'legacy', { ...event, capacity: undefined, timeZone: 'bad-zone' });
    expect(old).toContain('19:00');
    expect(old).not.toContain('Volná místa pro týmy');
  });

  it('links the 1200 × 630 share PNG', () => {
    expect(html).toContain('property="og:image" content="https://justkviz.cz/brand/justkviz-share.png"');
    const { width, height } = PNG.sync.read(readFileSync(new URL('../apps/web/public/brand/justkviz-share.png', import.meta.url)));
    expect([width, height]).toEqual([1200, 630]);
  });
});
