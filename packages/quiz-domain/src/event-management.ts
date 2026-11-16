export type EventDisposition = 'active' | 'archived' | 'trash' | 'deleting';
export type EventManagementAction = 'complete' | 'cancel' | 'prepare' | 'archive' | 'unarchive' | 'trash' | 'restore';
export function eventDisposition(event: { disposition?: unknown; lifecycleStatus?: unknown }): EventDisposition {
  if (event.disposition === 'active') return 'active';
  if (event.disposition === 'trash' || event.disposition === 'deleting' || event.disposition === 'archived') return event.disposition;
  return event.lifecycleStatus === 'archived' ? 'archived' : 'active';
}
export function eventOperational(event: { disposition?: unknown; lifecycleStatus?: unknown }): boolean {
  return eventDisposition(event) === 'active' && ['draft', 'scheduled', 'ready', 'live', 'finalizing'].includes(String(event.lifecycleStatus));
}
export function transitionProblem(event: { disposition?: unknown; lifecycleStatus?: unknown; scoring?: { started?: boolean }; hasActiveSession?: boolean }, action: EventManagementAction): string | null {
  const disposition = eventDisposition(event), status = event.lifecycleStatus;
  if (disposition === 'deleting') return 'Mazání již začalo. Akci nelze obnovit ani upravovat.';
  if (action === 'restore') return disposition === 'trash' ? null : 'Obnovit lze jen akci v koši.';
  if (action === 'unarchive') return disposition === 'archived' ? null : 'Akce není v archivu.';
  if (action === 'trash' && disposition === 'archived') return event.hasActiveSession ? 'Nejprve ukončete živý běh.' : null;
  if (disposition !== 'active') return 'Nejprve vraťte akci z archivu nebo koše.';
  if (action === 'archive') return ['completed', 'cancelled', 'archived'].includes(String(status)) ? null : 'Archivovat lze dokončenou nebo zrušenou akci.';
  if (action === 'prepare') return status === 'cancelled' && !event.scoring?.started ? null : 'Do přípravy lze vrátit jen zrušenou dosud neodehranou akci.';
  if (action === 'cancel') return ['draft', 'scheduled', 'ready', 'live', 'finalizing'].includes(String(status)) ? null : 'Dokončenou akci archivujte nebo přesuňte do koše.';
  if (action === 'complete') return ['ready', 'live', 'finalizing'].includes(String(status)) ? null : 'Dokončit lze jen připravenou nebo rozehranou akci.';
  if (action === 'trash') return event.hasActiveSession ? 'Nejprve výslovně ukončete živý běh.' : null;
  return 'Neplatná změna stavu.';
}

/** Display and parse wall time independently of the browser's time zone. Ambiguous DST requires an explicit offset choice. */
export function pragueDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function pragueInstant(value: string, offset?: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) throw new Error('Vyplňte datum a čas.');
  const candidates = ['+01:00', '+02:00'].map(zone => ({ zone, date: new Date(value + zone) })).filter(c => Number.isFinite(c.date.getTime()) && pragueDateTime(c.date) === value);
  if (!candidates.length) throw new Error('Tento čas v Praze neexistuje kvůli přechodu na letní čas.');
  const chosen = candidates.length === 1 ? candidates[0] : candidates.find(c => c.zone === offset);
  if (!chosen) throw new Error('Tento čas nastává dvakrát. Vyberte letní nebo zimní čas.');
  return chosen.date.toISOString();
}
