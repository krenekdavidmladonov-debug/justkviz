import { EventEmitter } from 'node:events';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { RequestOptions, request as httpsRequest } from 'node:https';
import { expect, test, vi } from 'vitest';
import { fetchPrivateImage, imageSourceUrl, MAX_PRIVATE_IMAGE_BYTES, publicImageAddress } from '../functions/src/drive/images';

const png = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.write('IHDR', 12);
interface Plan {
  status?: number;
  headers?: IncomingHttpHeaders;
  chunks?: Buffer[];
  abort?: boolean;
  close?: boolean;
  stall?: boolean;
  requestError?: boolean;
}
function fixture(plans: Plan[] = [{}], addresses = ['93.184.216.34']) {
  const responses: { destroyed: boolean; emittedBytes: number }[] = [];
  const resolve = vi.fn((hostname: string) => { void hostname; return Promise.resolve(addresses); });
  const send = vi.fn((url: URL, options: RequestOptions, handler: (response: IncomingMessage) => void) => {
    void url; void options;
    const plan = plans[send.mock.calls.length - 1] ?? {}, req = new EventEmitter();
    const response = Object.assign(new EventEmitter(), { statusCode: plan.status ?? 200,
      headers: { 'content-type': 'image/png', ...plan.headers }, destroyed: false, emittedBytes: 0,
      destroy() { this.destroyed = true; req.emit('close'); return this; }, resume() { return this; } });
    responses.push(response);
    return Object.assign(req, {
      end() {
        queueMicrotask(() => {
          if (plan.requestError) { req.emit('error', new Error('RAW PROVIDER URL SECRET')); req.emit('close'); return; }
          handler(response as unknown as IncomingMessage);
          if (response.destroyed) return;
          for (const chunk of plan.chunks ?? [png]) {
            if (response.destroyed) return;
            response.emittedBytes += chunk.length; response.emit('data', chunk);
          }
          if (response.destroyed) return;
          if (plan.abort) response.emit('aborted');
          else if (plan.close) response.emit('close');
          else if (plan.stall) return;
          else { response.emit('end'); response.emit('close'); }
          req.emit('close');
        });
      },
      destroy() { response.destroyed = true; req.emit('close'); return req; },
    });
  });
  return { transport: { resolve, request: send as unknown as typeof httpsRequest }, resolve, send, responses };
}

test('rejects IP literals, local/reserved names, credentials, insecure protocols and malformed URLs before DNS or HTTPS', async () => {
  const { transport, resolve, send } = fixture();
  for (const value of ['http://images.example.com/a.png', 'file:///etc/passwd', 'ftp://images.example.com/a.png',
    'https://localhost/a', 'https://localhost./a', 'https://metadata.google.internal/a', 'https://service.local/a', 'https://service.test/a',
    'https://127.0.0.1/a', 'https://0177.0.0.1/a', 'https://0x7f000001/a', 'https://2130706433/a',
    'https://[::1]/a', 'https://[::ffff:127.0.0.1]/a', 'https://10.0.0.1/a', 'https://user:secret@images.example.com/a',
    'https://images.example.com:444/a', 'https://images.example.com/a#fragment', 'invalid private source', 'https://images.example.com/' + 'a'.repeat(4096)]) {
    expect(() => imageSourceUrl(value)).toThrow('IMAGE_SOURCE_REJECTED');
    await expect(fetchPrivateImage(value, transport)).rejects.toThrow('IMAGE_SOURCE_REJECTED');
  }
  expect(resolve).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  expect(imageSourceUrl('https://images.example.com:443/a.png?version=2').href).toBe('https://images.example.com/a.png?version=2');
});

test('public IPv4 allowlist rejects loopback, private, shared, link-local, documentation, benchmarking and multicast addresses', () => {
  for (const address of ['0.0.0.0', '0.1.2.3', '10.1.2.3', '100.64.0.1', '100.127.255.254', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '172.31.255.254', '192.168.0.1', '192.0.0.0', '192.0.0.1', '192.0.0.255',
    '192.0.2.0', '192.0.2.1', '192.0.2.255', '192.88.99.1', '198.18.0.1', '198.19.0.1',
    '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '::ffff:93.184.216.34', '93.184.216.34 ', 'invalid']) {
    expect(publicImageAddress(address), address).toBe(false);
  }
  for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '100.128.0.1',
    '192.0.1.0', '192.0.1.255', '192.0.3.0', '192.0.78.24', '192.0.78.25', '192.0.66.239', '192.0.255.255']) {
    expect(publicImageAddress(address), address).toBe(true);
  }
});

test.each(['192.0.78.24', '192.0.78.25', '192.0.66.239'])('public image hosts in 192.0/16 pin their public address %s without broadening special /24 ranges', async address => {
  const { transport, resolve, send } = fixture([{}], [address]);
  await expect(fetchPrivateImage('https://images.example.com/a.png', transport)).resolves.toEqual({ bytes: png, contentType: 'image/png' });
  expect(resolve).toHaveBeenCalledExactlyOnceWith('images.example.com');
  const [url, options] = send.mock.calls[0]!;
  expect(url.hostname).toBe('images.example.com'); expect(options.rejectUnauthorized).not.toBe(false);
  const connected = vi.fn(); options.lookup!('images.example.com', { family: 4 }, connected);
  expect(connected).toHaveBeenCalledWith(null, address, 4);
});

test('every DNS answer must be public; mixed public/private results are rejected before the transport opens', async () => {
  for (const addresses of [[], ['127.0.0.1'], ['169.254.169.254'], ['93.184.216.34', '10.1.2.3'], ['93.184.216.34', '::1'],
    ['192.0.78.24', '192.0.0.1'], ['192.0.66.239', '192.0.2.1'], ['192.0.78.25', '192.168.0.1']]) {
    const { transport, send } = fixture([{}], addresses);
    await expect(fetchPrivateImage('https://images.example.com/a.png', transport)).rejects.toThrow('IMAGE_SOURCE_REJECTED');
    expect(send).not.toHaveBeenCalled();
  }
});

test('DNS pinning preserves the original TLS hostname and cannot re-resolve an attacker-controlled address on connect', async () => {
  const { transport, resolve, send } = fixture();
  await expect(fetchPrivateImage('https://images.example.com/a.png', transport)).resolves.toEqual({ bytes: png, contentType: 'image/png' });
  expect(resolve).toHaveBeenCalledExactlyOnceWith('images.example.com');
  const [url, options] = send.mock.calls[0]!;
  expect(url.hostname).toBe('images.example.com'); expect(url.protocol).toBe('https:');
  expect(options.family).toBe(4); expect(options.rejectUnauthorized).not.toBe(false);
  expect(options.headers).toEqual({ Accept: 'image/jpeg,image/png,image/webp', 'Accept-Encoding': 'identity', 'User-Agent': 'JustKviz-Media/1' });
  const connected = vi.fn();
  options.lookup!('images.example.com', { family: 4 }, connected);
  expect(connected).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  expect(resolve).toHaveBeenCalledTimes(1);
});

test('each redirect is validated and resolved again; redirect bodies are destroyed without consumption', async () => {
  const { transport, resolve, send, responses } = fixture([
    { status: 302, headers: { location: 'https://cdn.example.com/final.png' }, chunks: [Buffer.alloc(MAX_PRIVATE_IMAGE_BYTES + 1)] }, {},
  ]);
  resolve.mockResolvedValueOnce(['93.184.216.34']).mockResolvedValueOnce(['8.8.8.8']);
  await expect(fetchPrivateImage('https://images.example.com/a.png', transport)).resolves.toEqual({ bytes: png, contentType: 'image/png' });
  expect(resolve.mock.calls.map(call => call[0])).toEqual(['images.example.com', 'cdn.example.com']);
  expect(send.mock.calls[1]?.[0].hostname).toBe('cdn.example.com');
  expect(responses[0]).toMatchObject({ destroyed: true, emittedBytes: 0 });
  const relative = fixture([{ status: 307, headers: { location: '/final.png' } }, {}]);
  await expect(fetchPrivateImage('https://images.example.com/a.png', relative.transport)).resolves.toMatchObject({ contentType: 'image/png' });
  expect(relative.send.mock.calls[1]?.[0].href).toBe('https://images.example.com/final.png');
});

test('redirects cannot target local IPs, private DNS, plaintext HTTP, credentials or an unbounded chain', async () => {
  for (const location of ['https://127.0.0.1/a', 'http://images.example.com/a', 'https://user:secret@images.example.com/a', 'https://service.internal/a']) {
    const { transport, send } = fixture([{ status: 302, headers: { location } }]);
    await expect(fetchPrivateImage('https://images.example.com/a.png', transport)).rejects.toThrow('IMAGE_SOURCE_REJECTED');
    expect(send).toHaveBeenCalledTimes(1);
  }
  const dns = fixture([{ status: 308, headers: { location: 'https://cdn.example.com/a' } }]);
  dns.resolve.mockResolvedValueOnce(['93.184.216.34']).mockResolvedValueOnce(['169.254.169.254']);
  await expect(fetchPrivateImage('https://images.example.com/a.png', dns.transport)).rejects.toThrow('IMAGE_SOURCE_REJECTED');
  expect(dns.send).toHaveBeenCalledTimes(1);
  const documentation = fixture([{ status: 302, headers: { location: 'https://cdn.example.com/a' } }]);
  documentation.resolve.mockResolvedValueOnce(['192.0.78.24']).mockResolvedValueOnce(['192.0.2.1']);
  await expect(fetchPrivateImage('https://images.example.com/a.png', documentation.transport)).rejects.toThrow('IMAGE_SOURCE_REJECTED');
  expect(documentation.send).toHaveBeenCalledTimes(1);
  const loop = fixture(Array.from({ length: 4 }, () => ({ status: 301, headers: { location: '/again' } })));
  await expect(fetchPrivateImage('https://images.example.com/a.png', loop.transport)).rejects.toThrow('IMAGE_UNAVAILABLE');
  expect(loop.send).toHaveBeenCalledTimes(4);
});

test('checks response status, MIME, encoding, advertised length, actual length and signature before returning bytes', async () => {
  for (const plan of [{ status: 404 }, { status: 206 }, { headers: { 'content-type': 'image/svg+xml' } },
    { headers: { 'content-encoding': 'gzip' } }, { headers: { 'content-length': '-1' } }, { headers: { 'content-length': 'invalid' } },
    { headers: { 'content-length': String(MAX_PRIVATE_IMAGE_BYTES + 1) } }, { headers: { 'content-length': String(png.length + 1) } },
    { chunks: [] }, { chunks: [Buffer.from('<html>not an image</html>')] }]) {
    const { transport } = fixture([plan]);
    await expect(fetchPrivateImage('https://images.example.com/a.png', transport)).rejects.toThrow('IMAGE_UNAVAILABLE');
  }
  const { transport } = fixture([{ headers: { 'content-type': 'IMAGE/PNG; charset=binary', 'content-length': String(png.length) } }]);
  await expect(fetchPrivateImage('https://images.example.com/a.png', transport)).resolves.toEqual({ bytes: png, contentType: 'image/png' });
});

test('enforces body cap independently of missing or dishonest Content-Length and destroys oversized responses', async () => {
  for (const headers of [{}, { 'content-length': '24' }]) {
    const { transport, responses } = fixture([{ headers, chunks: [png, Buffer.alloc(MAX_PRIVATE_IMAGE_BYTES)] }]);
    await expect(fetchPrivateImage('https://images.example.com/a.png', transport)).rejects.toThrow('IMAGE_UNAVAILABLE');
    expect(responses[0]?.destroyed).toBe(true);
  }
});

test('aborted or premature-close responses reject promptly instead of leaving an unresolved response promise', async () => {
  for (const plan of [{ abort: true }, { close: true }, { requestError: true }]) {
    const { transport } = fixture([plan]);
    await expect(fetchPrivateImage('https://images.example.com/a.png', { ...transport, timeoutMillis: 30 })).rejects.toThrow('IMAGE_UNAVAILABLE');
  }
});

test('global deadline bounds DNS and stalled response bodies and masks provider errors', async () => {
  const stalledDns = fixture(); stalledDns.resolve.mockImplementationOnce(() => new Promise<string[]>(() => {}));
  await expect(fetchPrivateImage('https://images.example.com/a.png', { ...stalledDns.transport, timeoutMillis: 5 })).rejects.toThrow('IMAGE_UNAVAILABLE');
  expect(stalledDns.send).not.toHaveBeenCalled();
  const stalledBody = fixture([{ stall: true }]);
  await expect(fetchPrivateImage('https://images.example.com/a.png', { ...stalledBody.transport, timeoutMillis: 5 })).rejects.toThrow('IMAGE_UNAVAILABLE');
  expect(stalledBody.responses[0]?.destroyed).toBe(true);
  const failed = fixture(); failed.resolve.mockRejectedValueOnce(new Error('RAW DNS ERROR SECRET'));
  await expect(fetchPrivateImage('https://images.example.com/a.png', failed.transport)).rejects.toThrow('IMAGE_UNAVAILABLE');
});
