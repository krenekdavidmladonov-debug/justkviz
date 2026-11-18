/** Session-local diagnostics only. No persistence, URLs in UI, or network requests. */
let epoch = 0;
let widths: ReadonlyMap<string, number> = new Map();
const listeners = new Set<() => void>();
export const preflightImageObservationEpoch = () => epoch;
export const preflightImageWidths = () => widths;
export function subscribePreflightImageWidths(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function recordPreflightImageWidth(source: string, width: number, observedEpoch: number): void {
  if (observedEpoch !== epoch || !source || !Number.isSafeInteger(width) || width < 1 || widths.get(source) === width) return;
  const next = new Map(widths);
  next.delete(source);
  if (next.size >= 512) next.delete(next.keys().next().value!);
  next.set(source, width);
  widths = next;
  listeners.forEach(listener => listener());
}
export function clearPreflightImageObservations(): void {
  epoch++;
  widths = new Map();
  listeners.forEach(listener => listener());
}
