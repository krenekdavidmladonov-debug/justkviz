/** A public, constant health response. Never load identity, event data or rate limits here. */
export function isWarmupPing(data: unknown): data is { warmup: true } {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    && Object.getPrototypeOf(data) === Object.prototype
    && Reflect.ownKeys(data).length === 1 && Object.hasOwn(data, 'warmup')
    && (data as Record<string, unknown>).warmup === true;
}
const warmupCallables = new Set(['createEventLiveSession', 'previewInterimResults', 'revealAnswer', 'saveEventScore']);
export function isCallableWarmup(name: string, data: unknown): boolean {
  return warmupCallables.has(name) && isWarmupPing(data);
}
export function warmupResponse(): { warmup: true } {
  return { warmup: true };
}
