import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request, type RequestOptions } from 'node:https';
import { mediaSignature } from '../media/model.js';

export const MAX_PRIVATE_IMAGE_BYTES = 10 * 1024 * 1024;
export interface ImageFetchTransport {
  resolve?: (hostname: string) => Promise<readonly string[]>;
  request?: typeof request;
  timeoutMillis?: number;
}
function imageError(code: 'IMAGE_SOURCE_REJECTED' | 'IMAGE_UNAVAILABLE'): never { throw new Error(code); }
/** IPv4-only transport makes DNS rebinding/IPv4-mapped IPv6 behavior explicit. */
export function publicImageAddress(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number) as [number, number, number, number];
  return a > 0 && a < 224 && a !== 10 && a !== 127
    && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254)
    && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
    && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113);
}
export function imageSourceUrl(value: string): URL {
  try {
    const url = new URL(value), hostname = url.hostname.replace(/\.$/u, '');
    if (value.length > 4096 || url.protocol !== 'https:' || url.username || url.password || url.hash
      || (url.port && url.port !== '443') || isIP(hostname.replace(/^\[|\]$/gu, '')) || !hostname.includes('.')
      || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/iu.test(hostname)) throw new Error();
    return url;
  } catch { throw new Error('IMAGE_SOURCE_REJECTED'); }
}
/** Fetch only a saved server-owned image URL. Every redirect resolves/pins a public address again. */
export async function fetchPrivateImage(source: string, transport: ImageFetchTransport = {}): Promise<{ bytes: Buffer; contentType: string }> {
  const timeoutMillis = transport.timeoutMillis ?? 25_000;
  if (!Number.isSafeInteger(timeoutMillis) || timeoutMillis < 1 || timeoutMillis > 25_000) throw new Error('IMAGE_UNAVAILABLE');
  const resolveAddress = transport.resolve ?? (async (hostname: string) => (await lookup(hostname, { all: true, family: 4 })).map(item => item.address));
  const send = transport.request ?? request, deadline = Date.now() + timeoutMillis;
  let current = imageSourceUrl(source);
  try {
  for (let hop = 0; hop < 4; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('IMAGE_UNAVAILABLE');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      resolveAddress(current.hostname),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('IMAGE_UNAVAILABLE')), remaining); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    if (!addresses.length || addresses.some(address => !publicImageAddress(address))) throw new Error('IMAGE_SOURCE_REJECTED');
    if (Date.now() >= deadline) throw new Error('IMAGE_UNAVAILABLE');
    const pinned = addresses[0]!;
    const response = await new Promise<{ redirect: string } | { bytes: Buffer; contentType: string }>((resolve, reject) => {
      const fail = () => reject(new Error('IMAGE_UNAVAILABLE'));
      const requestOptions: RequestOptions = { method: 'GET', family: 4,
        lookup: (_host, _options, callback) => callback(null, pinned, 4),
        headers: { Accept: 'image/jpeg,image/png,image/webp', 'Accept-Encoding': 'identity', 'User-Agent': 'JustKviz-Media/1' } };
      const req = send(current, requestOptions, res => {
        res.on('error', fail);
        if ([301,302,303,307,308].includes(res.statusCode ?? 0) && res.headers.location) {
          // Never consume an unbounded redirect body from an unrelated origin.
          res.destroy();
          try { resolve({ redirect: new URL(res.headers.location, current).href }); } catch { fail(); }
          return;
        }
        const contentType = (res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
        const length = res.headers['content-length'];
        if (res.statusCode !== 200 || !['image/jpeg','image/png','image/webp'].includes(contentType)
          || (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > MAX_PRIVATE_IMAGE_BYTES))
          || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) { res.destroy(); fail(); return; }
        const chunks: Buffer[] = []; let bytes = 0, complete = false;
        res.on('data', (chunk: Buffer) => {
          if (!(chunk instanceof Buffer)) { res.destroy(); fail(); return; }
          bytes += chunk.length;
          if (bytes > MAX_PRIVATE_IMAGE_BYTES) { res.destroy(); fail(); } else chunks.push(chunk);
        });
        res.on('aborted', fail);
        res.on('close', () => { if (!complete) fail(); });
        res.on('end', () => {
          complete = true;
          const body = Buffer.concat(chunks);
          if (!body.length || !mediaSignature(body, contentType) || (length !== undefined && Number(length) !== body.length)) { fail(); return; }
          resolve({ bytes: body, contentType });
        });
      });
      const timeout = setTimeout(() => { req.destroy(); fail(); }, Math.max(1, deadline - Date.now()));
      req.on('close', () => clearTimeout(timeout)); req.on('error', fail); req.end();
    });
    if ('bytes' in response) return response;
    current = imageSourceUrl(response.redirect);
  }
  throw new Error('IMAGE_UNAVAILABLE');
  } catch (error) {
    imageError(error instanceof Error && error.message === 'IMAGE_SOURCE_REJECTED' ? 'IMAGE_SOURCE_REJECTED' : 'IMAGE_UNAVAILABLE');
  }
}
