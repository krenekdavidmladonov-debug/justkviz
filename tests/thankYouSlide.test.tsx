// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { SlideRenderer } from '../apps/web/src/features/presentation/SlideRenderer';
import { subscribePublishedEvents } from '../apps/web/src/features/events/eventRepository';
import type { PublicEventRecord } from '../apps/web/src/features/events/types';

vi.mock('../apps/web/src/features/events/eventRepository', () => ({ subscribePublishedEvents: vi.fn() }));

const event = (title: string, startsAt: Date, overrides: Partial<PublicEventRecord> = {}): PublicEventRecord => ({
  id: title, title, startsAt, venueName: 'Zátiší', publicLocation: '', timeZone: 'Europe/Prague',
  registrationPublished: true, registrationStatus: 'open', teamSizeMin: 2, teamSizeMax: 4,
  teamCapacity: 8, peopleCapacity: 32, acceptedTeams: 0, acceptedPeople: 0, revision: 1, ...overrides,
});

test('shows only upcoming public events and replaces or clears dates as the source changes', async () => {
  const unsubscribe = vi.fn();
  let publish: Parameters<typeof subscribePublishedEvents>[0] = () => { throw new Error('Feed is not mounted'); };
  vi.mocked(subscribePublishedEvents).mockImplementation(onChange => {
    publish = onChange;
    return unsubscribe;
  });

  const host = document.createElement('div');
  const root = createRoot(host);
  const now = Date.now();
  const near = event('Blízký kvíz', new Date(now + 3_600_000));
  const later = event('Pozdější kvíz', new Date(now + 7_200_000));

  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  try {
    await act(async () => { root.render(<SlideRenderer quizTitle="Syntetický kvíz" slide={{
      kind: 'thank-you', title: '', text: '', options: [], media: [],
    }} />); });
    expect(host.textContent).toContain('Děkujeme, že jste hráli!');
    expect(host.textContent).toContain('Načítáme termíny');

    await act(async () => publish([
      later, near, event('Již začal', new Date(now - 1)),
      event('Zrušený', near.startsAt, { cancelled: true }),
      event('Skrytý', near.startsAt, { registrationPublished: false }),
      event('Ukončený', near.startsAt, { lifecycleStatus: 'completed' }),
    ]));
    expect(Array.from(host.querySelectorAll('li strong'), item => item.textContent)).toEqual([near.title, later.title]);
    expect(host.querySelector('time')?.dateTime).toBe(near.startsAt.toISOString());

    await act(async () => publish([later]));
    expect(Array.from(host.querySelectorAll('li strong'), item => item.textContent)).toEqual([later.title]);
    await act(async () => publish([]));
    expect(host.textContent).toContain('Nové termíny právě chystáme.');
    await act(async () => publish([near]));
    await act(async () => publish(null));
    expect(host.querySelectorAll('li')).toHaveLength(0);
    expect(host.textContent).toContain('Další termíny najdete na stránce přihlášek.');

    const links = [...host.querySelectorAll<HTMLAnchorElement>('.thank-you-links a')];
    expect(links.map(link => link.href)).toEqual([
      'https://justkviz.cz/events',
      'https://www.facebook.com/profile.php?id=61596012273723',
    ]);
    for (const link of links) {
      const image = link.querySelector('img')?.src;
      expect(image).toMatch(/^data:image\/png;base64,/u);
      const png = PNG.sync.read(Buffer.from(image!.split(',')[1]!, 'base64'));
      expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe(link.href);
    }
  } finally {
    await act(async () => root.unmount());
  }
  expect(unsubscribe).toHaveBeenCalledOnce();
});
