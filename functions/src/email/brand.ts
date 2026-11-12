import { brand } from '@filmovy-kviz/quiz-domain';

// The image URL contains only a server-configured origin and a fixed public asset.
// Never use a registration capability URL as an image source or link target.
export function emailBrandHeader(origin?: string): string {
  let image: string | undefined;
  if (origin) {
    try {
      const url = new URL(origin);
      if (url.origin === origin && !url.username && !url.password
        && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
        image = `${origin}/brand/justkviz-email.png`;
      }
    } catch { /* Missing artwork must not prevent a valid message from being sent. */ }
  }
  return image
    ? `<img src="${image}" width="264" height="60" alt="${brand.name}" style="display:block;width:264px;max-width:100%;height:auto;color:#ffc107;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;border:0">`
    : `<p style="margin:0;color:#ffc107;font-size:22px;font-weight:bold">${brand.name}</p>`;
}
