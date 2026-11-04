import { eventOperational, pragueDateTime } from '@filmovy-kviz/quiz-domain';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { ManualTeamDialog } from '../../features/events/ManualTeamDialog';
import { RegistrationSharePanel } from '../../features/events/RegistrationSharePanel';
import { registrationManagementUrl } from '../../features/events/registrationSharing';
import { adminCancelRegistration, configureEventRegistration, reissueRegistrationLink, registrationActionError } from '../../features/events/registrationApi';
import { getEvent, listEventRegistrations } from '../../features/events/eventRepository';
import type { EventRecord, RegistrationRecord } from '../../features/events/types';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import { readFirebaseConfig } from '../../services/firebase/config';

const localDateTime = pragueDateTime;
export function AdminEventRegistrationsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { can } = useAuth();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [registrations, setRegistrations] = useState<readonly RegistrationRecord[]>([]);
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [opensOffset, setOpensOffset] = useState(''), [closesOffset, setClosesOffset] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newLink, setNewLink] = useState('');
  const [search] = useSearchParams();
  const [selectedId, setSelectedId] = useState(search.get('team') ?? '');
  const [teamDialog, setTeamDialog] = useState<RegistrationRecord | 'new' | null>(null);
  const load = useCallback(async () => {
    if (!eventId) return; setLoading(true);
    try {
      const [nextEvent, nextRegistrations] = await Promise.all([getEvent(eventId), listEventRegistrations(eventId)]);
      setEvent(nextEvent); setRegistrations(nextRegistrations);
      if (nextEvent) {
        setOpensAt(localDateTime(nextEvent.registrationOpensAt ?? new Date()));
        setClosesAt(localDateTime(nextEvent.registrationClosesAt ?? nextEvent.startsAt));
      }
    } catch { setError('Registrace se nepodařilo načíst.'); } finally { setLoading(false); }
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);
  const configure = async () => {
    if (!event) return; setPending(true); setError(null); setNotice(null);
    try { await configureEventRegistration(event.id, event.revision, opensAt, closesAt, undefined, opensOffset, closesOffset); setNotice('Nastavení registrací bylo uloženo.'); await load(); }
    catch (reason) { setError(registrationActionError(reason)); } finally { setPending(false); }
  };
  const cancel = async (registration: RegistrationRecord) => {
    if (!event || !window.confirm(`Zrušit registraci týmu ${registration.teamName}?`)) return;
    setPending(true); setError(null);
    try { await adminCancelRegistration(event.id, registration.id); setNotice('Registrace byla administrativně zrušena.'); await load(); }
    catch (reason) { setError(registrationActionError(reason)); } finally { setPending(false); }
  };
  const reissue = async (team: RegistrationRecord) => {
    if (!event || !window.confirm('Vydat nový odkaz týmu ' + team.teamName + '? Dosavadní odkaz přestane platit. Nový odkaz se neodešle e-mailem.')) return;
    setPending(true); setNewLink(''); setError(null);
    try {
      const config = readFirebaseConfig();
      const result = await reissueRegistrationLink(event.id, team.id, team.revision ?? 0);
      if (result.managementToken) setNewLink(registrationManagementUrl(event.id, team.id, result.managementToken, { projectId: config.options.projectId ?? '', useEmulators: config.useEmulators }, window.location.origin));
      await load();
    }
    catch (reason) { setError(registrationActionError(reason)); } finally { setPending(false); }
  };
  if (loading) return <QuizLoading label="Načítám registrace…" />;
  if (error && !event) return <QuizErrorState message={error} onRetry={() => void load()} />;
  if (!event) return <section className="quiz-state-card"><h2>Akce neexistuje</h2></section>;
  const admin = can('event.manage') && can('event.contacts') && eventOperational(event);
  return <article className="event-detail-page"><Link className="back-link" to={`/admin/events/${event.id}`}>← Zpět na akci</Link><header className="event-page-heading"><div><p className="eyebrow">Akce · Registrace</p><h1>{event.title}</h1><p className="lead">{event.acceptedTeams} / {event.teamCapacity} týmů</p></div><span className={`quiz-status status-${event.registrationStatus}`}>{{ scheduled: 'Otevřou se později', open: 'Otevřené', paused: 'Pozastavené', full: 'Naplněno', closed: 'Uzavřené' }[event.registrationStatus]}</span></header>
    {error && <p className="round-editor-error" role="alert">{error}</p>}{notice && <p className="event-notice" role="status">{notice}</p>}
    {newLink && <section className="event-notice" role="status"><p>Nový odkaz uložte a předejte týmu. E-mail nebyl odeslán.</p><label className="form-field">Nový soukromý odkaz<input readOnly value={newLink} onFocus={e => e.target.select()} /></label><button className="secondary-button" onClick={() => setNewLink('')}>Skrýt odkaz</button></section>}
    <RegistrationSharePanel event={event} />
    <section className="event-section"><div className="event-section-heading"><div><p className="eyebrow">Týmy</p><h2>Registrované týmy</h2></div>{admin && <button className="primary-button" type="button" onClick={() => setTeamDialog('new')}>+ Přidat tým</button>}</div>
      {registrations.length === 0 ? <p>Zatím bez registrací.</p> : <div className="registration-table-wrap"><table className="registration-table"><thead><tr><th>Tým</th><th>Členů</th><th>Stav / původ</th><th>E-mail</th><th>Poslední registrační e-mail</th>{admin && <th>Akce</th>}</tr></thead><tbody>{registrations.map((item) => <tr key={item.id} className={item.id === selectedId ? 'team-selected' : ''} aria-selected={item.id === selectedId}><td>{item.teamName}</td><td>{item.memberCount}</td><td>{item.status === 'accepted' ? 'Přijatý' : 'Zrušený'}<br />{item.source === 'manual' ? 'Přidáno pořadatelem' : 'Online'}</td><td>{item.contactEmail ?? 'Neuveden'}</td><td>{item.emailDelivery ? <><span>{{ pending: 'Čeká na odeslání', processing: 'Odesílá se', sent: 'Odesláno', failed: 'Vyžaduje kontrolu' }[item.emailDelivery.status]}</span><br /><time dateTime={item.emailDelivery.updatedAt.toISOString()}>{item.emailDelivery.updatedAt.toLocaleString('cs-CZ')}</time></> : '—'}</td>{admin && <td>{item.status === 'accepted' && <div className="team-tool-actions">{item.source === 'manual' && <button className="secondary-button" type="button" disabled={pending} onClick={() => setTeamDialog(item)}>Upravit tým</button>}{item.source === 'online' && <button className="secondary-button" type="button" disabled={pending} onClick={() => void reissue(item)}>Vydat nový odkaz</button>}<button className="danger-button" type="button" disabled={pending} onClick={() => void cancel(item)}>Zrušit</button></div>}</td>}</tr>)}</tbody></table></div>}
      {registrations.some(item => item.emailDelivery) && <p className="event-muted">Odesláno znamená, že zprávu přijal poskytovatel. Doručení do schránky tím není potvrzené. Pokud zpráva vyžaduje kontrolu, před dalším odesláním ověřte u týmu a správce, zda už dorazila.</p>}
    </section>
    {admin && teamDialog && <ManualTeamDialog event={event} {...(teamDialog === 'new' ? {} : { team: teamDialog })} onClose={() => setTeamDialog(null)} onSaved={async (id, name) => { setTeamDialog(null); setSelectedId(id); setNotice(`Tým ${name} byl uložen.`); await load(); }} />}
    <section className="event-section" id="registration-settings"><h2>Doba registrace · český čas</h2><p>Zveřejnění akce nastavíte samostatně na detailu akce. Uložení času viditelnost nemění.</p>{admin ? <form className="registration-form" onSubmit={(e) => { e.preventDefault(); void configure(); }}><label className="form-field"><span>Otevření</span><input required type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} /></label><label className="form-field"><span>Uzavření</span><input required type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></label>{[[opensOffset, setOpensOffset, 'Časové pásmo začátku'], [closesOffset, setClosesOffset, 'Časové pásmo konce']].map(([value, setter, label]) => <label className="form-field" key={String(label)}><span>{String(label)} — při opakovaném podzimním čase</span><select value={value as string} onChange={e => (setter as (value: string) => void)(e.target.value)}><option value="">Automaticky</option><option value="+02:00">Letní čas (+02:00)</option><option value="+01:00">Zimní čas (+01:00)</option></select></label>)}<button className="primary-button" disabled={pending}>Uložit nastavení</button></form> : <p>Moderátor má přístup pouze pro čtení.</p>}</section>
  </article>;
}
