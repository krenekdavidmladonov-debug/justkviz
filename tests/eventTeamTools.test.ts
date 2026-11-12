import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { Timestamp } from 'firebase/firestore';
import { manualTeamInput, registrationInput } from '../functions/src/registrations/validation';
import { registrationToPrintTeam } from '../functions/src/registrations/print-adapter';
import { mapRegistration } from '../apps/web/src/features/events/eventMappers';
import { publicRegistrationUrl, registrationManagementUrl, registrationQr, registrationSharingState, qrFilename } from '../apps/web/src/features/events/registrationSharing';
import { effectiveRegistrationStatus } from '../functions/src/registrations/domain';
import type { EventRecord } from '../apps/web/src/features/events/types';
import { publicAppOrigin } from '../apps/web/src/services/publicAppOrigin';
import { accessInvitationUrl } from '../apps/web/src/features/access/sharing';

describe('event team tools contracts', () => {
  it('allows a genuinely absent manual email, still validates supplied email and public input', () => {
    expect(manualTeamInput({ teamName: '  Ruční   Tým ', memberCount: 2 }).contactEmail).toBeNull();
    expect(manualTeamInput({ teamName: '  Ruční   Tým ', memberCount: 2 }).normalizedTeamName).toBe('ruční tým');
    expect(() => manualTeamInput({ teamName: 'Tým', memberCount: 2, contactEmail: 'wrong' })).toThrow();
    expect(manualTeamInput({ teamName: 'Tým', memberCount: 4 }).memberCount).toBe(4);
    expect(() => manualTeamInput({ teamName: 'Tým', memberCount: 5 })).toThrow();
    expect(() => registrationInput({ teamName: 'Tým', memberCount: 2, source: 'manual' })).toThrow();
  });
  it('maps nullable/missing manual email, preserves old online records, excludes private data from print', () => {
    const data = { eventId: 'synthetic-event', teamName: 'Manual', memberCount: 2, status: 'accepted', source: 'manual', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), managementTokenHash: null, createdBy: 'private-staff' };
    expect(mapRegistration('manual', data).contactEmail).toBeNull();
    expect(mapRegistration('old-online', { ...data, source: undefined, contactEmail: 'test@example.test' }).source).toBe('online');
    expect(registrationToPrintTeam('manual', data)).toEqual({ id: 'manual', name: 'Manual' });
    expect(registrationToPrintTeam('manual', { ...data, status: 'cancelled' })).toBeUndefined();
  });
  it('constructs only the verified environment public URL', () => {
    const staging = { projectId: 'filmovy-kviz-v2-staging', useEmulators: false };
    expect(publicRegistrationUrl('synthetic-event', staging, 'https://justkviz-v2.web.app')).toBe('https://justkviz.cz/events/synthetic-event');
    expect(publicRegistrationUrl('demo-event', { projectId: 'demo-test', useEmulators: true }, 'http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/events/demo-event');
    for (const id of ['../admin', 'event#token=secret', 'event?token=secret']) expect(() => publicRegistrationUrl(id, staging, '')).toThrow();
    expect(() => publicRegistrationUrl('event', { projectId: 'unknown', useEmulators: false }, '')).toThrow();
    expect(() => publicRegistrationUrl('event', { projectId: 'demo-test', useEmulators: true }, 'https://external.example')).toThrow();
    expect(() => publicRegistrationUrl('event', { projectId: 'filmovy-kviz-v2-staging', useEmulators: true }, 'http://localhost:5173')).toThrow();
    expect(() => publicRegistrationUrl('event', { projectId: 'demo-test', useEmulators: false }, 'http://localhost:5173')).toThrow();
  });
  it('uses the canonical origin for reissued links and keeps credentials only in the fragment', () => {
    const staging = { projectId: 'filmovy-kviz-v2-staging', useEmulators: false };
    const url = new URL(registrationManagementUrl('synthetic-event', 'team/id', 'synthetic/token', staging, 'https://justkviz-v2.web.app'));
    expect(url.origin).toBe('https://justkviz.cz');
    expect(url.pathname).toBe('/events/synthetic-event/registration/manage');
    expect(url.search).toBe('');
    expect(url.hash).toBe('#registration=team%2Fid&token=synthetic%2Ftoken');
    expect(registrationManagementUrl('demo-event', 'team', 'synthetic', { projectId: 'demo-test', useEmulators: true }, 'http://localhost:5173')).toBe('http://localhost:5173/events/demo-event/registration/manage#registration=team&token=synthetic');
  });
  it('decodes generated PNG to exactly the public URL with opaque white quiet zone; SVG is local', async () => {
    const url = publicRegistrationUrl('synthetic-event', { projectId: 'filmovy-kviz-v2-staging', useEmulators: false }, '');
    const qr = await registrationQr(url);
    const png = PNG.sync.read(Buffer.from(qr.png.split(',')[1]!, 'base64'));
    expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe(url);
    for (let y = 0; y < 32; y++) for (let x = 0; x < png.width; x++) expect([...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)]).toEqual([255, 255, 255, 255]);
    expect(decodeURIComponent(qr.svg)).toContain('<svg');
    expect(decodeURIComponent(qr.svg)).not.toContain('http://localhost');
    expect(qrFilename('../../Příliš / dlouhý název')).toMatch(/^registrace-[A-Za-z0-9_-]+$/u);
  });
  it('shows current time/capacity states consistently with the existing server and mutates nothing', () => {
    const base = { registrationPublished: true, lifecycleStatus: 'ready', registrationOpensAt: new Date(1000), registrationClosesAt: new Date(3000), acceptedTeams: 0, acceptedPeople: 0, teamCapacity: 2, peopleCapacity: 6, teamSizeMin: 2, teamSizeMax: 4 } as EventRecord;
    const before = JSON.stringify(base);
    for (const lifecycleStatus of ['draft', 'ready', 'live', 'finalizing', 'completed', 'cancelled', 'archived'] as const) {
      for (const now of [500, 2000, 4000]) {
        const event = { ...base, lifecycleStatus };
        const effective = effectiveRegistrationStatus({ published: true, lifecycleStatus, opensAtMillis: 1000, closesAtMillis: 3000, nowMillis: now, capacity: { acceptedTeams: 0, acceptedPeople: 0, maximumTeams: 2, maximumPeople: 6 } });
        // The callable also checks operational lifecycle before applying the
        // window calculation; completed events cannot accept registrations.
        expect(registrationSharingState(event, now).message === 'Přihlášky jsou otevřené.').toBe(effective === 'open' && lifecycleStatus !== 'completed');
      }
    }
    expect(registrationSharingState({ ...base, registrationPublished: false }, 2000).available).toBe(false);
    for (const acceptedPeople of [5, 6, 8]) {
      expect(registrationSharingState({ ...base, acceptedPeople }, 2000).message).toBe('Přihlášky jsou otevřené.');
    }
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe('canonical shared app links', () => {
  const live = { projectId: 'filmovy-kviz-v2-staging', useEmulators: false };
  const demo = { projectId: 'demo-filmovy-kviz-v2', useEmulators: true };
  it('pins the approved live project to justkviz.cz', () => {
    for (const origin of ['https://justkviz-v2.web.app', 'https://external.example', '']) expect(publicAppOrigin(live, origin)).toBe('https://justkviz.cz');
  });
  it('allows only demo emulator configuration on a local HTTP(S) origin', () => {
    for (const origin of ['http://localhost:5173', 'https://127.0.0.1:5173', 'http://[::1]:5173']) expect(publicAppOrigin(demo, origin)).toBe(origin);
    for (const origin of ['https://external.example', 'ftp://localhost', 'http://user:password@localhost:5173']) expect(() => publicAppOrigin(demo, origin)).toThrow();
    for (const config of [{ ...live, useEmulators: true }, { ...demo, useEmulators: false }, { projectId: 'other', useEmulators: false }]) expect(() => publicAppOrigin(config, 'http://localhost:5173')).toThrow();
  });
  it('canonicalizes invitations and preserves encoded fragment credentials', () => {
    const url = new URL(accessInvitationUrl('synthetic/id', 'synthetic/token', live, 'https://justkviz-v2.web.app'));
    expect(url.origin).toBe('https://justkviz.cz');
    expect(url.pathname).toBe('/invite/synthetic%2Fid');
    expect(url.search).toBe('');
    expect(url.hash).toBe('#token=synthetic%2Ftoken');
    expect(accessInvitationUrl('synthetic-id', 'synthetic-token', demo, 'http://localhost:5173')).toBe('http://localhost:5173/invite/synthetic-id#token=synthetic-token');
  });
});
