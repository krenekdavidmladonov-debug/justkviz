import { useEffect, useRef, useState } from 'react';

import { adminAddEventTeam, adminUpdateEventTeam, registrationActionError } from './registrationApi';
import type { EventRecord, RegistrationRecord } from './types';

export function ManualTeamDialog({ event, team, onClose, onSaved }: {
  event: EventRecord; team?: RegistrationRecord;
  onClose: () => void; onSaved: (id: string, name: string) => Promise<void>;
}) {
  const maximumMembers = Math.min(4, event.teamSizeMax);
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [teamName, setTeamName] = useState(team?.teamName ?? '');
  const [memberCount, setMemberCount] = useState(String(team?.memberCount ?? event.teamSizeMin));
  const [contactEmail, setContactEmail] = useState(team?.contactEmail ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const modal = dialog.current;
    const previous = document.activeElement;
    modal?.showModal();
    return () => { modal?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const submit = async () => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null);
    try {
      const values = { teamName, memberCount: Number(memberCount), contactEmail: contactEmail.trim() };
      const result = team
        ? await adminUpdateEventTeam(event.id, team.id, team.revision ?? 0, values)
        : await adminAddEventTeam(event.id, requestId, values);
      await onSaved(result.registrationId, result.teamName);
      onClose();
    } catch (reason) { setError(registrationActionError(reason)); }
    finally { busy.current = false; setPending(false); }
  };
  return <dialog ref={dialog} className="team-tool-dialog" aria-labelledby="manual-team-title" onCancel={(e) => { e.preventDefault(); if (!busy.current) onClose(); }}>
    <h2 id="manual-team-title">{team ? 'Upravit tým' : 'Přidat tým'}</h2>
    <p>{event.title} · {event.teamSizeMin}–{maximumMembers} členů</p>
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <fieldset disabled={pending} className="manual-team-fields">
        <label className="form-field"><span>Název týmu</span><input autoFocus required minLength={2} maxLength={80} value={teamName} onChange={(e) => setTeamName(e.target.value)} /></label>
        <label className="form-field"><span>Počet členů</span><input required type="number" min={event.teamSizeMin} max={maximumMembers} step={1} value={memberCount} onChange={(e) => setMemberCount(e.target.value)} /></label>
        <details open={Boolean(team?.contactEmail)}><summary>E-mail (volitelné)</summary><label className="form-field"><span>E-mail</span><input type="email" maxLength={254} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} /></label></details>
      </fieldset>
      {error && <p role="alert" className="round-editor-error">{error}</p>}
      <div className="team-tool-actions"><button className="primary-button" disabled={pending}>{pending ? 'Ukládám…' : team ? 'Uložit tým' : 'Přidat tým'}</button><button className="secondary-button" type="button" disabled={pending} onClick={onClose}>Zrušit</button></div>
    </form>
  </dialog>;
}
