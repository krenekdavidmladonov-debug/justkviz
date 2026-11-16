import QRCode from 'qrcode';
import type { EventRecord } from './types';
import { registrationPresentation } from './eventPresentation';
import { publicAppOrigin, type PublicAppConfig } from '../../services/publicAppOrigin';

export function publicRegistrationUrl(eventId: string, config: PublicAppConfig, localOrigin: string): string {
  if (!/^[A-Za-z0-9_-]{1,1500}$/u.test(eventId)) throw new Error('Neplatné ID akce.');
  return `${publicAppOrigin(config, localOrigin)}/events/${eventId}`;
}

export function registrationManagementUrl(eventId: string, registrationId: string, token: string, config: { projectId: string; useEmulators: boolean }, localOrigin: string): string {
  return publicRegistrationUrl(eventId, config, localOrigin) + '/registration/manage#registration=' + encodeURIComponent(registrationId) + '&token=' + encodeURIComponent(token);
}

export function registrationSharingState(event: EventRecord, now = Date.now()) {
  const available = event.registrationPublished && !['cancelled', 'archived'].includes(event.lifecycleStatus);
  const open = registrationPresentation(event, now).canRegister;
  return { available, message: !available ? 'Akce nemá zveřejněné přihlášení.' : open ? 'Přihlášky jsou otevřené.' : 'Stránka je dostupná, přihlášky jsou nyní uzavřené.' };
}

export const registrationQrOptions = { margin: 4, scale: 8, errorCorrectionLevel: 'M' as const, color: { dark: '#000000ff', light: '#ffffffff' } };
export async function registrationQr(url: string) {
  const [png, svg] = await Promise.all([QRCode.toDataURL(url, registrationQrOptions), QRCode.toString(url, { ...registrationQrOptions, type: 'svg' })]);
  return { png, svg: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) };
}
export function qrFilename(title: string) { return 'registrace-' + (title.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').replace(/[^a-zA-Z0-9_-]+/gu, '-').slice(0,60) || 'akce'); }
