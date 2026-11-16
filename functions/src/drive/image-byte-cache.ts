/** Process-local immutable bytes only; a hit never grants permission to return them. */
export class DriveImageByteCache {
  private readonly entries = new Map<string, { bytes: Buffer; expires: number }>();
  private retained = 0;
  constructor(private readonly maximumBytes = 32 * 1024 * 1024, private readonly maximumEntries = 16,
    private readonly maximumImageBytes = 8 * 1024 * 1024, private readonly lifetimeMillis = 5 * 60_000,
    private readonly now: () => number = Date.now) {}

  clear(): void { this.entries.clear(); this.retained = 0; }
  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) { this.retained -= entry.bytes.length; this.entries.delete(key); }
  }
  get(key: string): Buffer | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) { this.remove(key); return undefined; }
    this.entries.delete(key); this.entries.set(key, entry);
    return Buffer.from(entry.bytes);
  }
  put(key: string, bytes: Buffer): void {
    this.remove(key);
    if (!bytes.length || bytes.length > this.maximumImageBytes || bytes.length > this.maximumBytes) return;
    for (const [existing, entry] of this.entries) if (entry.expires <= this.now()) this.remove(existing);
    while (this.entries.size && (this.entries.size >= this.maximumEntries || this.retained + bytes.length > this.maximumBytes)) {
      this.remove(this.entries.keys().next().value!);
    }
    this.entries.set(key, { bytes: Buffer.from(bytes), expires: this.now() + this.lifetimeMillis });
    this.retained += bytes.length;
  }
}

export const driveImageBytes = new DriveImageByteCache();
