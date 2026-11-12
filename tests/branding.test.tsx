// @vitest-environment happy-dom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { pageTitle } from '../apps/web/src/config/pageTitle';
import { productConfig } from '../apps/web/src/config/product';
import { Brand } from '../apps/web/src/ui/Brand';
import { SlideRenderer } from '../apps/web/src/features/presentation/SlideRenderer';

describe('JustKvíz presentation boundaries', () => {
  test.each([
    ['/admin/login', 'JustKvíz'], ['/admin', 'JustKvíz'],
    ['/admin/quizzes', 'Knihovna kvízů | JustKvíz'],
    ['/admin/quizzes/private-title/edit', 'Editor kvízu | JustKvíz'],
    ['/admin/events/private-event', 'Akce | JustKvíz'],
    ['/events/private-event/registration/manage', 'Akce | JustKvíz'],
    ['/projector/private-session', 'Projekce | JustKvíz'],
    ['/referee/private-event', 'JustKvíz'], ['/missing', 'JustKvíz'],
  ])('keeps private route values out of the title for %s', (path, expected) => {
    expect(pageTitle(path)).toBe(expected);
  });
  test('outlined logo is accessible without fonts, and existing content retains its title', () => {
    const logo = renderToStaticMarkup(<Brand />);
    expect(logo).toContain('role="img" aria-label="JustKvíz"');
    expect(logo).toContain('<path');
    expect(logo).not.toMatch(/<text|<image|<script|href=|font-family/);
    const html = renderToStaticMarkup(<SlideRenderer quizTitle="Filmový kvíz – září" slide={{kind:'intro',title:'Filmový kvíz – září',text:'Původní obsah',options:[],media:[]}} />);
    expect(html).toContain('Filmový kvíz – září');
    expect(html).toContain('Původní obsah');
    expect(html.replace(/<[^>]+>/g, '')).toContain('JustKvíz');
    expect(html).not.toContain(productConfig.author);
  });
  test('HTML starts with the same public metadata and the permanent vector icon', () => {
    const html = readFileSync('apps/web/index.html','utf8');
    expect(html).toContain(`<title>${productConfig.name}</title>`);
    expect(html).toContain(`content="${productConfig.description}"`);
    expect(html).toContain('/brand/justkviz-icon.svg');
    expect(productConfig.icon).toBe('/brand/justkviz-icon.svg');
    const icon = readFileSync('apps/web/public/brand/justkviz-icon.svg', 'utf8');
    expect(icon).toContain('<path');
    expect(icon).not.toMatch(/<text|<image|<script|href=/);
    expect(html).not.toContain(productConfig.author);
  });
  test('hiding a presentation logo preserves the organizer choice', () => {
    const html = renderToStaticMarkup(<SlideRenderer quizTitle="Vlastní večer" slide={{ kind: 'intro', title: 'Vítejte', text: '', options: [], media: [], design: { showLogo: false } }} />);
    expect(html).not.toContain('brand-wordmark');
    expect(html).toContain('Vlastní večer');
  });
});
