import { readTeamMessageRecovery } from './teamMessageRecovery';
import { Brand } from '../../ui/Brand';
import { useEffect, useRef, useState } from 'react';
import { createTeamMessage, resetTeamMessageRequest, getTeamMessage, listTeamMessages, previewTeamMessage, teamMessageError,
  type TeamMessagePreview, type TeamMessageReceipt, type TeamMessageRequest, type TeamMessageStatus } from './teamMessageApi';

export function EventTeamMessagePanel({ eventId, actorId, canCreate }: { eventId: string; actorId: string; canCreate: boolean }) {
  const storageKey = 'team-message-pending:' + actorId + ':' + eventId;
  const [recoveryState] = useState(() => readTeamMessageRecovery(() => sessionStorage.getItem(storageKey), eventId));
  const recovery = recoveryState.data;
  const [open, setOpen] = useState(Boolean(recovery) || recoveryState.blocked), [subject, setSubject] = useState(recovery?.request.subject ?? ''), [message, setMessage] = useState(recovery?.request.message ?? '');
  const [preview, setPreview] = useState<TeamMessagePreview | null>(recovery?.preview ?? null), [confirmed, setConfirmed] = useState(Boolean(recovery));
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<TeamMessageRequest | null>(recovery?.request ?? null), [status, setStatus] = useState<TeamMessageStatus | null>(null);
  const [history, setHistory] = useState<TeamMessageReceipt[]>([]);
  const latch = useRef(false);
  useEffect(() => {
    let current = true;
    if (open) void listTeamMessages(eventId).then(data => { if (current) setHistory(data); }).catch(() => { if (current) setError('Historii zpráv se nepodařilo načíst.'); });
    return () => { current = false; };
  }, [eventId, open]);
  async function action(work: () => Promise<void>) {
    if (latch.current) return;
    latch.current = true; setPending(true); setError(null);
    try { await work(); } catch (cause) { setError(teamMessageError(cause)); }
    finally { latch.current = false; setPending(false); }
  }
  async function send() {
    if (!preview || !confirmed) return;
    const payload = request ?? { eventId, subject: preview.subject, message: preview.message, requestId: crypto.randomUUID(), previewFingerprint: preview.previewFingerprint, confirmed: true as const };
    sessionStorage.setItem(storageKey, JSON.stringify({ request: payload, preview }));
    setRequest(payload);
    let receipt: TeamMessageReceipt;
    try { receipt = await createTeamMessage(payload); }
    catch (cause) {
      if (resetTeamMessageRequest(cause, Boolean(request))) { sessionStorage.removeItem(storageKey); setRequest(null); setPreview(null); setConfirmed(false); }
      throw cause;
    }
    // A successful receipt closes this operation before a fallible status refresh.
    sessionStorage.removeItem(storageKey);
    setRequest(null); setPreview(null); setConfirmed(false); setSubject(''); setMessage('');
    setHistory(current => [receipt, ...current.filter(item => item.campaignId !== receipt.campaignId)].slice(0, 20));
    setStatus({ ...receipt, pending: receipt.total, sent: 0, failed: 0 });
    try { setStatus(await getTeamMessage(eventId, receipt.campaignId)); } catch { setError('Zpráva byla přijata. Obnovte stav doručování.'); }
  }
  return <section className="event-section" aria-label="Zprávy týmům">
    <h2>Zprávy týmům</h2>
    <button className="secondary-button" type="button" onClick={() => setOpen(true)}>Napsat týmům</button>
    {open && <>
      <p>Organizační zpráva přijatým týmům s emailem. Jeden email na tým; nejvýše 450 příjemců v jedné zprávě. Týmy bez emailu se vynechají.</p>
      {!canCreate && <p>V tomto stavu akce už nelze vytvořit novou zprávu.</p>}
      {recoveryState.blocked && <p role="alert">Uložený stav odesílání nelze bezpečně obnovit. Nové odesílání je zablokované. Zkontrolujte historii zpráv před dalším postupem.</p>}
      {canCreate && !recoveryState.blocked && <form onSubmit={e => { e.preventDefault(); void action(async () => { setPreview(await previewTeamMessage(eventId, { subject, message })); setConfirmed(false); }); }}>
        <fieldset disabled={pending || Boolean(request)} style={{ border: 0, padding: 0 }}>
          <label className="editor-field"><span>Předmět</span><input required maxLength={200} value={subject} onChange={e => { setSubject(e.target.value); setPreview(null); setConfirmed(false); }} /></label>
          <label className="editor-field"><span>Zpráva týmům</span><textarea required maxLength={4000} rows={7} value={message} onChange={e => { setMessage(e.target.value); setPreview(null); setConfirmed(false); }} /></label>
          <button className="secondary-button" type="submit">Zobrazit náhled</button>
        </fieldset>
      </form>}
      {preview && <section aria-label="Náhled zprávy">
        <h3>{preview.subject}</h3><p>{preview.eventTitle}</p><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{preview.message}</p><p><Brand /></p>
        <p>Počet příjemců: <strong>{preview.total}</strong></p>
        <label><input type="checkbox" checked={confirmed} disabled={pending || Boolean(request)} onChange={e => setConfirmed(e.target.checked)} /> Potvrzuji obsah a odeslání všem uvedeným příjemcům.</label>
        <p><button className="primary-button" type="button" disabled={pending || !confirmed || preview.total === 0} onClick={() => void action(send)}>{request ? 'Ověřit stejný požadavek' : 'Odeslat týmům'}</button></p>
      </section>}
      {request && <p role="status">Výsledek odeslání zatím není potvrzen. Ponechte stránku otevřenou a ověřte stejný požadavek.</p>}
      {error && <p role="alert">{error}</p>}
      {status && <section aria-label="Stav zprávy"><h3>{status.subject}</h3>
        <p role="status">Celkem: {status.total} · Čeká: {status.pending} · Odesláno: {status.sent} · Selhalo: {status.failed}</p>
        <p>Odesláno znamená, že poskytovatel přijal požadavek k odeslání.</p>
        <button type="button" className="secondary-button" disabled={pending} onClick={() => void action(async () => setStatus(await getTeamMessage(eventId, status.campaignId)))}>Obnovit stav</button>
      </section>}
      {history.length > 0 && <><h3>Poslední zprávy</h3><ul>{history.map(item => <li key={item.campaignId}><button type="button" disabled={pending} onClick={() => void action(async () => setStatus(await getTeamMessage(eventId, item.campaignId)))}>{item.subject} · {new Date(item.createdAt).toLocaleString('cs-CZ')}</button></li>)}</ul></>}
    </>}
  </section>;
}
