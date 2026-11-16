import { eventDisposition, eventOperational } from '@filmovy-kviz/quiz-domain';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { eventActionError } from './eventApi';
import { eventDateLabel, registrationPresentation } from './eventPresentation';
import { setEventPublication } from './registrationApi';
import type { EventRecord } from './types';
import './eventPublication.css';

export function EventPublicationButton({ event, onChanged, disabled = false }: { event: EventRecord; onChanged: (event: EventRecord) => void; disabled?: boolean }) {
  const { can } = useAuth();
  const [confirmation, setConfirmation] = useState<{ event: EventRecord; published: boolean } | null>(null), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), busy = useRef(false), latestEvent = useRef(event), titleId = useId();
  latestEvent.current = event;
  const target = !event.registrationPublished;
  const canOpen = eventOperational(event) && event.startsAt.getTime() > Date.now();
  const canHide = eventOperational(event) || (event.lifecycleStatus === 'completed' && eventDisposition(event) === 'active');
  const permitted = can('event.manage') && can('event.read');
  const canConfirm = confirmation?.published ? canOpen : canHide;
  const currentRegistration = registrationPresentation(event);
  const canReopen = event.registrationPublished && canOpen && ['scheduled', 'closed'].includes(currentRegistration.status);
  const capacityFull = event.teamCapacity > 0 && event.acceptedTeams >= event.teamCapacity;
  const confirming = confirmation !== null;
  const stale = confirmation !== null && (confirmation.event.id !== event.id || confirmation.event.revision !== event.revision || confirmation.event.registrationPublished !== event.registrationPublished);
  useEffect(() => { if (stale && !busy.current) setConfirmation(null); }, [stale]);
  useEffect(() => {
    if (!confirming) return;
    const modal = dialog.current, previous = document.activeElement;
    modal?.showModal();
    return () => { modal?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [confirming]);
  const submit = async () => {
    if (busy.current || !permitted || disabled || !confirmation || stale) return;
    if (confirmation.published && (!eventOperational(event) || !(event.startsAt.getTime() > Date.now()))) {
      setError('Registrace lze otevřít pouze před začátkem aktivní akce.');
      return;
    }
    if (!confirmation.published && !canHide) return;
    const requested = confirmation;
    busy.current = true; setPending(true); setError(null);
    try {
      const result = await setEventPublication(requested.event.id, requested.event.revision, requested.published);
      const current = latestEvent.current;
      if (current.id === requested.event.id && current.revision <= result.revision) {
        onChanged({ ...current, revision: result.revision, registrationPublished: result.registrationPublished,
          registrationStatus: result.registrationStatus, lifecycleStatus: result.lifecycleStatus,
          registrationOpensAt: result.registrationOpensAt ? new Date(result.registrationOpensAt) : undefined,
          registrationClosesAt: result.registrationClosesAt ? new Date(result.registrationClosesAt) : undefined });
      }
      setConfirmation(null);
    } catch (failure) { setError(eventActionError(failure)); }
    finally { busy.current = false; setPending(false); }
  };
  return <div className="event-publication-control">
    <button className={target ? 'primary-button' : 'secondary-button'} type="button" disabled={disabled || !permitted || pending || (target ? !canOpen : !canHide)} onClick={() => { setError(null); setConfirmation({ event, published: target }); }}>{target ? 'Zveřejnit a otevřít registrace' : 'Skrýt z veřejného webu'}</button>
    {canReopen && <button className="primary-button" type="button" disabled={disabled || !permitted || pending} onClick={() => { setError(null); setConfirmation({ event, published: true }); }}>Otevřít registrace</button>}
    {target && eventOperational(event) && !canOpen && <p>Registrace lze otevřít pouze před začátkem akce.</p>}
    {event.registrationPublished && <Link className="secondary-link" to={`/events/${event.id}`}>Otevřít veřejný detail</Link>}
    {confirmation && <dialog className="team-tool-dialog event-publication-dialog" ref={dialog} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); if (!busy.current) setConfirmation(null); }}>
      <h2 id={titleId}>{confirmation.published ? confirmation.event.registrationPublished ? 'Otevřít registrace?' : 'Zveřejnit a otevřít registrace?' : 'Skrýt akci z veřejného webu?'}</h2>
      <p><strong>{confirmation.event.title}</strong></p>
      {confirmation.published ? <>
        {!confirmation.event.registrationPublished && <p>Akce bude veřejně dostupná bez přihlášení v seznamu akcí i přes přímý odkaz.</p>}
        <p>{capacityFull ? 'Registrace nastavíme od teď do začátku akce' : 'Přihlášky otevřeme ihned a uzavřeme při začátku akce'} ({eventDateLabel(confirmation.event)}). Nahradí se tím případné dosavadní nastavení času registrací.</p>
        <p>{capacityFull ? 'Kapacita je nyní naplněná. Nový tým se bude moci přihlásit až po uvolnění dostatečné kapacity.' : 'Týmy se mohou přihlašovat, dokud zbývá dostatečná kapacita.'}</p>
      </> : <p>Akce přestane být veřejně dostupná. Registrace a historie zůstanou uložené.</p>}
      {confirmation.published && !confirmation.event.quizAssignment && <p>Kvíz zatím není připravený pro hraní. Můžete ho přiřadit a připravit později.</p>}
      {error && <p className="round-editor-error" role="alert">{error}</p>}
      <div className="team-tool-actions"><button autoFocus className="secondary-button" type="button" disabled={pending} onClick={() => setConfirmation(null)}>Zrušit</button><button className="primary-button" type="button" disabled={pending || disabled || !permitted || !canConfirm || stale} aria-busy={pending} onClick={() => void submit()}>{pending ? 'Ukládám…' : confirmation.published ? confirmation.event.registrationPublished ? 'Otevřít registrace' : 'Zveřejnit a otevřít registrace' : 'Skrýt akci'}</button></div>
    </dialog>}
  </div>;
}
