type CachedMedia = { readonly blob: Blob; readonly etag?: string; readonly storedAt: number };
type MediaLoader = (cached: CachedMedia | undefined, signal: AbortSignal) => Promise<{ blob: Blob; etag?: string }>;
type PendingMedia = { readonly controller: AbortController; readonly promise: Promise<Blob>; users: number };

/** Memory only. Every cache hit still passes the current server authorization gate. */
export class MediaBlobCache {
  private readonly entries = new Map<string, CachedMedia>();
  private readonly pending = new Map<string, PendingMedia>();
  private bytes = 0;

  constructor(private readonly maxBytes = 64 * 1024 * 1024, private readonly maxEntries = 24, private readonly maxAgeMs = 5 * 60 * 1000) {}

  async waitForPendingReads(): Promise<void> {
    await Promise.allSettled([...this.pending.values()].map(request => request.promise));
  }

  clear(): void {
    for (const request of this.pending.values()) request.controller.abort();
    this.pending.clear();
    this.entries.clear();
    this.bytes = 0;
  }

  read(key: string, signal: AbortSignal, load: MediaLoader): Promise<Blob> {
    if (signal.aborted) return Promise.reject(new DOMException('Media request aborted', 'AbortError'));
    const now = Date.now();
    for (const [entryKey, entry] of this.entries) if (now - entry.storedAt >= this.maxAgeMs) this.remove(entryKey);
    let request = this.pending.get(key);
    if (!request || request.controller.signal.aborted) {
      const controller = new AbortController();
      const cached = this.entries.get(key);
      const promise = Promise.resolve().then(() => load(cached, controller.signal)).then(result => {
        if (controller.signal.aborted) throw new DOMException('Media request aborted', 'AbortError');
        this.remove(key);
        // An ETag is required: bytes without one cannot be reused safely by a later request.
        if (result.etag && result.blob.size <= this.maxBytes) {
          this.entries.set(key, { ...result, storedAt: Date.now() });
          this.bytes += result.blob.size;
          while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.remove(oldest);
          }
        }
        return result.blob;
      }).catch((error: unknown) => {
        // A denied or failed revalidation must never fall back to old protected bytes.
        if (this.pending.get(key)?.controller === controller) this.remove(key);
        throw error;
      }).finally(() => {
        if (this.pending.get(key)?.controller === controller) this.pending.delete(key);
      });
      request = { controller, promise, users: 0 };
      this.pending.set(key, request);
    }
    const shared = request;
    shared.users++;
    return new Promise<Blob>((resolve, reject) => {
      let settled = false;
      const release = () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        shared.users--;
        if (shared.users === 0 && this.pending.get(key) === shared) shared.controller.abort();
      };
      const abort = () => { release(); reject(new DOMException('Media request aborted', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
      shared.promise.then(blob => { if (!settled) { release(); resolve(blob); } }, (error: unknown) => {
        if (!settled) { release(); reject(error instanceof Error ? error : new Error('Médium není dostupné.')); }
      });
    });
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) { this.bytes -= entry.blob.size; this.entries.delete(key); }
  }
}

export const quizMediaBlobCache = new MediaBlobCache();
