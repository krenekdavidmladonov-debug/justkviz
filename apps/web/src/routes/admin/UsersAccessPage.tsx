import { useCallback, useEffect, useRef, useState } from 'react';
import { canDelegate, grantErrors, permissionLabels, permissions, roleLabels, rolePresets, type AccessGrant, type AccessRole, type AccessScope, type Membership } from '@filmovy-kviz/quiz-domain';
import { useAuth } from '../../auth/AuthProvider';
import { accessCall, privateRead, type PrivateDocument } from '../../features/access/api';
import { accessInvitationUrl } from '../../features/access/sharing';
import { readFirebaseConfig } from '../../services/firebase/config';

interface AccessUser extends Membership { lastLoginAt: string | null; emailVerified: boolean }
interface Invitation { inviteId: string; email: string; grant: AccessGrant; version: number; status: string; expiresAt: number }
interface Overview { users: AccessUser[]; invitations: Invitation[]; collaborationEnabled?: boolean }
interface AuditEntry { id: string; actorUid: string; kind: string; targetId: string; at: string | null; changes: Record<string, unknown> }
const emptyGrant = (): AccessGrant => ({ role: 'viewer', permissions: [...rolePresets.viewer], quizzes: { mode: 'none', ids: [] }, events: { mode: 'none', ids: [] } });
const scopeLabels = { none: 'Žádné', own: 'Vlastní nově vytvořené', selected: 'Vybrané', all: 'Všechny' } as const;
const statusLabels: Record<string, string> = { active: 'Aktivní', suspended: 'Pozastavený', invited: 'Pozván', expired: 'Vypršela', revoked: 'Odvolána', accepted: 'Přijata' };
const auditLabels: Record<string, string> = { 'membership-changed': 'Změna přístupu', 'invitation-created': 'Vytvoření pozvánky', 'invitation-accepted': 'Přijetí pozvánky', 'invitation-revoke': 'Odvolání pozvánky', 'invitation-reissue': 'Nový odkaz na pozvánku', 'sessions-revoked': 'Odhlášení všech zařízení', 'resource-created': 'Přístup k novému obsahu', 'approved-owner-bootstrap': 'Schválené předání vlastnictví' };
function readError(operation: string, failure: unknown) {
  const code = failure && typeof failure === 'object' && 'code' in failure && typeof failure.code === 'string' ? failure.code : 'unknown';
  const hint = code.endsWith('permission-denied') ? 'Pro tento požadavek nemáte oprávnění.'
    : code.endsWith('unauthenticated') ? 'Přihlaste se znovu.'
      : code.endsWith('not-found') ? 'Služba není dostupná. Správce musí ověřit nasazenou verzi.'
        : 'Službu se nepodařilo načíst. Zkuste požadavek znovu.';
  return `${hint} (${operation}: ${code})`;
}
function AuditGrant({ title, value }: { title: string; value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const validScope = (scope: unknown): scope is AccessScope => !!scope && typeof scope === 'object' && 'mode' in scope && typeof scope.mode === 'string'
    && Object.hasOwn(scopeLabels, scope.mode) && 'ids' in scope && Array.isArray(scope.ids) && scope.ids.every(id => typeof id === 'string');
  if (typeof record.role !== 'string' || !Object.hasOwn(roleLabels, record.role) || !Array.isArray(record.permissions)
    || record.permissions.some(p => typeof p !== 'string' || !Object.hasOwn(permissionLabels, p)) || !validScope(record.quizzes) || !validScope(record.events)) {
    return <p>{title}: podrobnosti staršího záznamu nejsou dostupné.</p>;
  }
  const grant = value as AccessGrant;
  return <div className="access-audit-grant"><strong>{title}: {roleLabels[grant.role]}</strong><p>Kvízy: {scopeLabels[grant.quizzes.mode]}{grant.quizzes.mode === 'selected' ? ` (${grant.quizzes.ids.length})` : ''} · Akce: {scopeLabels[grant.events.mode]}{grant.events.mode === 'selected' ? ` (${grant.events.ids.length})` : ''}</p><ul>{grant.permissions.map(p => <li key={p}>{permissionLabels[p]}</li>)}</ul></div>;
}
function ScopeEditor({ label, value, onChange, choices }: { label: string; value: AccessScope; onChange: (value: AccessScope) => void; choices: PrivateDocument[] }) {
  return <fieldset><legend>{label}</legend><select aria-label={`Rozsah: ${label}`} value={value.mode} onChange={e => onChange({ mode: e.target.value as AccessScope['mode'], ids: [] })}>
    {Object.entries(scopeLabels).map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select>
    {value.mode === 'selected' && <div className="access-scope-options">{choices.map(item => <label key={item.id}><input type="checkbox" checked={value.ids.includes(item.id)} onChange={e => onChange({ mode: 'selected', ids: e.target.checked ? [...value.ids, item.id] : value.ids.filter(id => id !== item.id) })} />{String(item.data.title)}</label>)}
      {!value.ids.length && <p>Nic není vybráno — tento rozsah nepovoluje žádný obsah.</p>}</div>}
    {value.mode === 'all' && <p>Rozsah zahrnuje i budoucí obsah. Zvolte jej pouze záměrně.</p>}
    {value.mode === 'own' && <p>Přístup určuje uložený autor vytvoření. Historické autorství se nepřepisuje.</p>}
  </fieldset>;
}
export function UsersAccessPage() {
  const { membership: actor, can } = useAuth();
  const [overview, setOverview] = useState<Overview>({ users: [], invitations: [] }), [audit, setAudit] = useState<AuditEntry[]>([]);
  const [quizzes, setQuizzes] = useState<PrivateDocument[]>([]), [events, setEvents] = useState<PrivateDocument[]>([]);
  const [selected, setSelected] = useState<AccessUser | null>(null), [editing, setEditing] = useState(false);
  const [grant, setGrant] = useState<AccessGrant>(emptyGrant), [email, setEmail] = useState(''), [status, setStatus] = useState<'active' | 'suspended'>('active');
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [link, setLink] = useState('');
  const [filter, setFilter] = useState('');
  const [usersLoading, setUsersLoading] = useState(true), [usersLoaded, setUsersLoaded] = useState(false), [usersError, setUsersError] = useState('');
  const [auditLoading, setAuditLoading] = useState(true), [auditError, setAuditError] = useState('');
  const authorized = !!actor && can('users.manage');
  const authorityKey = `${actor?.uid ?? ''}:${actor?.version ?? 0}:${authorized}`;
  const authority = useRef(authorityKey); authority.current = authorityKey;
  const alive = useRef(false), requests = useRef({ users: 0, audit: 0 });
  const loadUsers = useCallback(async () => {
    const request = ++requests.current.users;
    const current = () => alive.current && authority.current === authorityKey && requests.current.users === request;
    setUsersLoading(true); setUsersError('');
    try { const next = await accessCall<Overview>('listAccessUsers'); if (current()) { setOverview(next); setUsersLoaded(true); } }
    catch (failure) {
      if (current()) {
        setUsersError(readError('listAccessUsers', failure));
        const code = failure && typeof failure === 'object' && 'code' in failure ? String(failure.code) : '';
        if (code.endsWith('permission-denied') || code.endsWith('unauthenticated')) {
          setOverview({ users: [], invitations: [] }); setUsersLoaded(false); setSelected(null); setEditing(false); setLink('');
          requests.current.audit++; setAudit([]); setAuditLoading(false); setAuditError('');
        }
      }
    } finally { if (current()) setUsersLoading(false); }
  }, [authorityKey]);
  const loadAudit = useCallback(async () => {
    const request = ++requests.current.audit;
    const current = () => alive.current && authority.current === authorityKey && requests.current.audit === request;
    setAuditLoading(true); setAuditError('');
    try { const next = await accessCall<AuditEntry[]>('listAccessAudit'); if (current()) setAudit(next); }
    catch (failure) { if (current()) { setAudit([]); setAuditError(readError('listAccessAudit', failure)); } }
    finally { if (current()) setAuditLoading(false); }
  }, [authorityKey]);
  useEffect(() => {
    alive.current = true;
    setOverview({ users: [], invitations: [] }); setUsersLoaded(false); setAudit([]); setLink(''); setEditing(false);
    if (!authorized) return () => { alive.current = false; };
    let active = true;
    void loadUsers(); void loadAudit();
    void Promise.all([can('quiz.read') ? privateRead<PrivateDocument[]>('quizzes') : Promise.resolve([]), can('event.read') ? privateRead<PrivateDocument[]>('events') : Promise.resolve([])])
      .then(([q, e]) => { if (active) { setQuizzes(q); setEvents(e); } }).catch(() => { if (active) setError('Výběr obsahu není dostupný.'); });
    return () => { active = false; alive.current = false; requests.current.users++; requests.current.audit++; };
  }, [authorityKey, authorized, loadUsers, loadAudit]);
  if (!actor || !can('users.manage')) return <p role="alert">Pro správu uživatelů nemáte oprávnění.</p>;
  // These choices come from scoped server reads. The server rechecks ownership in its transaction.
  const delegationActor: Membership = { ...actor,
    quizzes: actor.quizzes.mode === 'own' ? { mode: 'selected', ids: quizzes.map(q => q.id) } : actor.quizzes,
    events: actor.events.mode === 'own' ? { mode: 'selected', ids: events.map(e => e.id) } : actor.events };
  const errors = grantErrors(grant), delegable = canDelegate(delegationActor, grant);
  async function run(action: () => Promise<void>) {
    setPending(true); setError(''); setNotice('');
    const key = authorityKey;
    try { await action(); if (alive.current && authority.current === key) { await loadUsers(); void loadAudit(); } }
    catch (failure) { if (alive.current && authority.current === key) setError(failure instanceof Error ? failure.message : 'Změnu nelze dokončit.'); }
    finally { if (alive.current && authority.current === key) setPending(false); }
  }
  function invitationLink(inviteId: string, token: string) {
    const config = readFirebaseConfig();
    setLink(accessInvitationUrl(inviteId, token, { projectId: config.options.projectId ?? '', useEmulators: config.useEmulators }, window.location.origin));
  }
  function edit(user: AccessUser | null) {
    setSelected(user); setGrant(user ? { role: user.role, permissions: [...user.permissions], quizzes: { ...user.quizzes, ids: [...user.quizzes.ids] }, events: { ...user.events, ids: [...user.events.ids] } } : emptyGrant());
    setEmail(user?.email ?? ''); setStatus(user?.status ?? 'active'); setEditing(true); setError(''); setLink('');
  }
  const visible = overview.users.filter(u => `${u.displayName} ${u.email}`.toLowerCase().includes(filter.toLowerCase()));
  const invitationsEnabled = overview.collaborationEnabled === true && !usersError;
  return <div className="users-access-page">
    <header className="page-header"><div><p className="eyebrow">Administrace</p><h1>Uživatelé a přístupy</h1><p>Osobní účty, jasná oprávnění a přístup jen k vybranému obsahu.</p></div><button className="primary-button" disabled={!invitationsEnabled} onClick={() => edit(null)}>Pozvat člověka</button></header>
    <p>Seznam obsahuje účty s přiděleným členstvím. Samotná registrace účtu přístup neuděluje a nevytváří žádost o schválení. Novému i již registrovanému člověku přidělíte přístup pozvánkou na jeho ověřený e-mail.</p>
    {usersLoaded && overview.collaborationEnabled !== true && <p role="status">Pozvánky nejsou dostupné: bezpečná aktivace modulu nebyla potvrzena. Stávající členství lze nadále spravovat.</p>}
    {error && <p role="alert" className="error-message">{error}</p>}{notice && <p role="status">{notice}</p>}
    {link && <section className="account-card"><h2>Pozvánka je připravená</h2><p>Odkaz zkopírujte a předejte pozvanému člověku. Platí 7 dní a lze jej použít jednou. Po zavření stránky lze vytvořit nový odkaz.</p>
      <label>Odkaz na pozvánku<input readOnly value={link} onFocus={e => e.currentTarget.select()} /></label>
      <button className="primary-button" onClick={() => void navigator.clipboard.writeText(link).then(() => setNotice('Odkaz zkopírován.')).catch(() => setNotice('Označte a zkopírujte odkaz z pole.'))}>Kopírovat odkaz</button>
    </section>}
    <section className="account-card"><button className="secondary-button" disabled={pending} onClick={() => void loadUsers()}>Znovu načíst uživatele</button>
      {usersLoading && <p role="status">Načítám uživatele a pozvánky…</p>}{usersError && <p role="alert" className="error-message">{usersError}</p>}
      <label>Najít člověka<input type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Jméno nebo e-mail" /></label>
      <div className="access-table-scroll"><table className="access-table"><thead><tr><th>Člověk</th><th>Role</th><th>Rozsah</th><th>Stav</th><th>Poslední přihlášení</th><th>Správa</th></tr></thead><tbody>
        {visible.map(u => <tr key={u.uid}><td><strong>{u.displayName || 'Bez jména'}</strong><br />{u.email}</td><td>{roleLabels[u.role]}</td><td>Kvízy: {scopeLabels[u.quizzes.mode]}{u.quizzes.mode === 'selected' ? ` (${u.quizzes.ids.length})` : ''}<br />Akce: {scopeLabels[u.events.mode]}{u.events.mode === 'selected' ? ` (${u.events.ids.length})` : ''}</td><td>{statusLabels[u.status]}</td><td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('cs-CZ') : 'Není k dispozici'}</td><td><button className="quiet-button" onClick={() => edit(u)}>Detail přístupu</button></td></tr>)}
        {usersLoaded && !usersLoading && !usersError && !visible.length && <tr><td colSpan={6}>Žádné odpovídající účty.</td></tr>}
      </tbody></table></div>
    </section>
    {editing && <section className="account-card access-editor"><h2>{selected ? `Přístup: ${selected.displayName || selected.email}` : 'Nová pozvánka'}</h2>
      <form className="account-form" onSubmit={event => { event.preventDefault(); void run(async () => {
        if (selected) { await accessCall('updateAccessMembership', { uid: selected.uid, expectedVersion: selected.version, grant, status }); setNotice('Přístup byl uložen. Změna platí pro další požadavky i otevřené editory.'); }
        else { const result = await accessCall<{ inviteId: string; token: string }>('createAccessInvitation', { email, grant }); invitationLink(result.inviteId, result.token); }
        setEditing(false);
      }); }}>
        <label>E-mail<input type="email" required readOnly={!!selected} autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Role jako výchozí sada<select value={grant.role} onChange={e => { const role = e.target.value as AccessRole; setGrant({ ...grant, role, permissions: [...rolePresets[role]] }); }}>
          {Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role} disabled={role === 'owner'}>{label}</option>)}</select></label>
        <p>Změna role upraví výchozí oprávnění. Rozsahy níže zůstanou beze změny; zkontrolujte je samostatně.</p>
        <fieldset><legend>Konkrétní oprávnění</legend><div className="access-permissions">{permissions.map(permission => <label key={permission}><input type="checkbox" checked={grant.permissions.includes(permission)} disabled={!actor.permissions.includes(permission)} onChange={e => setGrant({ ...grant, permissions: e.target.checked ? [...grant.permissions, permission] : grant.permissions.filter(p => p !== permission) })} />{permissionLabels[permission]}</label>)}</div></fieldset>
        <ScopeEditor label="Kvízy" value={grant.quizzes} choices={quizzes} onChange={value => setGrant({ ...grant, quizzes: value })} />
        <ScopeEditor label="Akce" value={grant.events} choices={events} onChange={value => setGrant({ ...grant, events: value })} />
        {selected && <label>Stav<select aria-label="Stav přístupu" value={status} onChange={e => setStatus(e.target.value as 'active' | 'suspended')}><option value="active">Aktivní</option><option value="suspended">Pozastavený</option></select></label>}
        {errors.map(text => <p key={text} className="error-message">{text}</p>)}
        {!delegable && <p className="error-message">Tato sada přesahuje vaše oprávnění nebo obsahuje vlastnictví, které lze převést jen schváleným postupem.</p>}
        {selected?.uid === actor.uid && <p>Vlastní oprávnění musí změnit jiný oprávněný správce.</p>}
        <div className="account-actions"><button className="primary-button" disabled={pending || errors.length > 0 || !delegable || selected?.uid === actor.uid || (!selected && !invitationsEnabled)}>{selected ? 'Uložit přístup' : 'Vytvořit odkaz s pozvánkou'}</button><button className="quiet-button" type="button" onClick={() => setEditing(false)}>Zavřít</button></div>
      </form>
    </section>}
    <section className="account-card"><h2>Pozvánky</h2>{overview.invitations.length ? overview.invitations.map(invite => <div className="access-invitation" key={invite.inviteId}><div><strong>{invite.email}</strong><p>{roleLabels[invite.grant.role]} · {statusLabels[invite.status]} · platnost do {new Date(invite.expiresAt).toLocaleDateString('cs-CZ')}</p></div>
      {invite.status !== 'accepted' && <div className="account-actions"><button className="secondary-button" disabled={pending || !invitationsEnabled || !canDelegate(delegationActor, invite.grant)} onClick={() => void run(async () => { const result = await accessCall<{ token: string }>('changeAccessInvitation', { inviteId: invite.inviteId, expectedVersion: invite.version, action: 'reissue' }); invitationLink(invite.inviteId, result.token); })}>Vytvořit nový odkaz</button><button className="quiet-button" disabled={pending || invite.status === 'revoked' || !canDelegate(delegationActor, invite.grant)} onClick={() => void run(async () => { await accessCall('changeAccessInvitation', { inviteId: invite.inviteId, expectedVersion: invite.version, action: 'revoke' }); setLink(''); setNotice('Pozvánka byla odvolána.'); })}>Odvolat</button></div>}
    </div>) : usersLoaded && !usersLoading && !usersError ? <p>Zatím nebyly vytvořeny žádné pozvánky.</p> : <p>Pozvánky zatím nejsou načteny.</p>}</section>
    <section className="account-card"><h2>Historie změn přístupů</h2><p>Posledních 100 neměnných záznamů.</p><button className="secondary-button" onClick={() => void loadAudit()}>Znovu načíst historii</button>{auditLoading && <p role="status">Načítám historii…</p>}{auditError && <p role="alert" className="error-message">{auditError}</p>}{audit.map(entry => <details key={entry.id}><summary>{entry.at && Number.isFinite(Date.parse(entry.at)) ? new Date(entry.at).toLocaleString('cs-CZ') : 'Čas není k dispozici'} · {auditLabels[entry.kind] ?? 'Změna přístupu'} · {overview.users.find(u => u.uid === entry.actorUid)?.displayName || overview.users.find(u => u.uid === entry.actorUid)?.email || 'Oprávněný operátor'}</summary><p>Pro: {overview.users.find(u => u.uid === entry.targetId)?.displayName || overview.users.find(u => u.uid === entry.targetId)?.email || overview.invitations.find(i => i.inviteId === entry.targetId)?.email || 'Záznam přístupu'}</p>{typeof entry.changes?.status === 'string' && <p>Stav: {statusLabels[entry.changes.status]}</p>}<AuditGrant title="Před změnou" value={entry.changes?.before} /><AuditGrant title="Po změně" value={entry.changes?.after ?? entry.changes?.grant} /></details>)}</section>
  </div>;
}
