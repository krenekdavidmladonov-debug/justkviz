export type HostingProbeResult =
  | { readonly kind: 'ok' | 'slow'; readonly elapsedMs: number }
  | { readonly kind: 'http-error'; readonly status: number }
  | { readonly kind: 'offline' | 'timeout' | 'unreachable' | 'unexpected-response' };

async function hasExpectedBody(response: Response): Promise<boolean> {
  if (!/^text\/plain(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')) {
    void response.body?.cancel().catch(() => {});
    return false;
  }
  const reader = response.body?.getReader();
  if (!reader) return false;
  const bytes = new Uint8Array(64);
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return new TextDecoder().decode(bytes.subarray(0, length)).trim() === 'justkviz-connection-check-v1';
    if (length + chunk.value.length > bytes.length) {
      void reader.cancel().catch(() => {});
      return false;
    }
    bytes.set(chunk.value, length);
    length += chunk.value.length;
  }
}

export async function probeHosting(controller: AbortController): Promise<HostingProbeResult> {
  if (!navigator.onLine) return { kind: 'offline' };
  const started = performance.now();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 5000);

  try {
    const response = await fetch('/justkviz-connection-check.txt', {
      cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return { kind: 'http-error', status: response.status };
    }
    if (!await hasExpectedBody(response)) return { kind: 'unexpected-response' };
    const elapsedMs = Math.round(performance.now() - started);
    return { kind: elapsedMs >= 1500 ? 'slow' : 'ok', elapsedMs };
  } catch {
    if (!navigator.onLine) return { kind: 'offline' };
    return { kind: timedOut ? 'timeout' : 'unreachable' };
  } finally {
    window.clearTimeout(timer);
  }
}
