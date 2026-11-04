import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { createUserWithEmailAndPassword, EmailAuthProvider, getIdToken, reauthenticateWithCredential, reload, sendEmailVerification, sendPasswordResetEmail, updatePassword, updateProfile, verifyBeforeUpdateEmail } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { roleLabels, permissionLabels, type AccessScope } from '@filmovy-kviz/quiz-domain';
import { useAuth } from '../auth/AuthProvider';
import { getFirebaseAuth } from '../services/firebase/auth';
import { getFirebaseServices } from '../services/firebase/client';
import { revokeSessions } from '../auth/sessionRevocation';

function scopeSummary(scope: AccessScope): string {
  return scope.mode === 'selected' ? `Vybrané položky (${scope.ids.length})` : ({ none: 'Žádné', own: 'Vlastní podle autorství', all: 'Všechny' })[scope.mode];
}
function message(error: unknown): string {
  const code = (error as { code?: string }).code;
  if (code === 'auth/requires-recent-login' || code === 'functions/unauthenticated') return 'Zadejte aktuální heslo a zkuste akci znovu.';
  if (code === 'auth/invalid-credential') return 'E-mail nebo heslo nesouhlasí.';
  if (code === 'auth/email-already-in-use') return 'Účet už existuje. Přihlaste se nebo obnovte heslo.';
  if (code === 'auth/too-many-requests') return 'Příliš mnoho pokusů. Zkuste to později.';
  return error instanceof Error && code?.startsWith('functions/') ? error.message : 'Akci se nepodařilo dokončit. Zkontrolujte údaje a spojení.';
}
export function AccountPage() {
  const { currentUser: user, membership, loading, signIn, signOut } = useAuth();
  const location = useLocation(), navigate = useNavigate(), { inviteId } = useParams();
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState(user?.email ?? ''), [name, setName] = useState(user?.displayName ?? '');
  const [password, setPassword] = useState(''), [newPassword, setNewPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  useEffect(() => { setName(user?.displayName ?? ''); setEmail(user?.email ?? ''); }, [user?.uid, user?.displayName, user?.email]);
  async function run(action: () => Promise<void>) {
    setPending(true); setError(''); setNotice('');
    try { await action(); } catch (failure) { setError(message(failure)); } finally { setPending(false); setPassword(''); setNewPassword(''); setConfirmation(''); }
  }
  async function reauthenticate() {
    if (!user?.email || !password) throw new Error('Zadejte aktuální heslo.');
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  }
  function submitLogin(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (mode === 'signup') {
        const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
        await updateProfile(credential.user, { displayName: name.trim() });
        await sendEmailVerification(credential.user);
      } else await signIn(email, password);
    });
  }
  if (loading) return <p role="status">Ověřuji účet…</p>;
  return <div className="account-page">
    <header><p className="eyebrow">JustKvíz · osobní přístup</p><h1>{inviteId ? 'Přijmout pozvánku' : 'Můj účet'}</h1>
      <p>Každý člověk se přihlašuje vlastním e-mailem a heslem.</p></header>
    {error && <p className="error-message" role="alert">{error}</p>}
    {notice && <p className="notice-message" role="status">{notice}</p>}
    {!user ? <section className="account-card">
      <div className="account-actions"><button className="quiet-button" onClick={() => setMode('login')} aria-pressed={mode === 'login'}>Přihlásit se</button><button className="quiet-button" onClick={() => setMode('signup')} aria-pressed={mode === 'signup'}>Vytvořit osobní účet</button></div>
      <form onSubmit={submitLogin} className="account-form">
        {mode === 'signup' && <label>Zobrazované jméno<input required maxLength={80} autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label>}
        <label>E-mail<input required type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Heslo<input required type="password" minLength={mode === 'signup' ? 12 : undefined} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} /></label>
        {mode === 'signup' && <p>Minimálně 12 znaků. Vytvoření účtu samo o sobě nepřiděluje přístup ke kvízům ani akcím. Po vytvoření ověřte svůj e-mail.</p>}
        <button className="primary-button" disabled={pending}>{pending ? 'Zpracovávám…' : mode === 'signup' ? 'Vytvořit účet' : 'Přihlásit se'}</button>
      </form>
      <button className="quiet-button" disabled={pending || !email} onClick={() => void run(async () => { await sendPasswordResetEmail(getFirebaseAuth(), email.trim()); setNotice('Pokud pro tento e-mail existuje účet, odešleme pokyny k obnovení hesla.'); })}>Zapomenuté heslo</button>
    </section> : <>
      <section className="account-card"><h2>Osobní údaje</h2>
        <p><strong>{user.email}</strong> · {user.emailVerified ? 'E-mail ověřen' : 'E-mail čeká na ověření'}</p>
        <form className="account-form" onSubmit={event => { event.preventDefault(); void run(async () => { await updateProfile(user, { displayName: name.trim() }); setNotice('Zobrazované jméno bylo uloženo.'); }); }}>
          <label>Zobrazované jméno<input required maxLength={80} autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label>
          <button className="secondary-button" disabled={pending}>Uložit jméno</button>
        </form>
        {!user.emailVerified && <div className="account-actions">
          <button className="secondary-button" disabled={pending} onClick={() => void run(async () => { await sendEmailVerification(user); setNotice('Ověřovací e-mail byl odeslán.'); })}>Odeslat ověřovací e-mail</button>
          <button className="quiet-button" disabled={pending} onClick={() => void run(async () => { await reload(user); await getIdToken(user, true); setNotice(user.emailVerified ? 'E-mail je ověřen.' : 'E-mail zatím není ověřen.'); })}>Už jsem e-mail ověřil/a</button>
        </div>}
      </section>
      {inviteId && <section className="account-card"><h2>Přístup z pozvánky</h2><p>Pozvánku může přijmout pouze ověřený účet se stejným e-mailem. Oprávnění určuje její vydavatel.</p>
        <button className="primary-button" disabled={pending || !user.emailVerified || !token} onClick={() => void run(async () => { await httpsCallable(getFirebaseServices().functions, 'acceptAccessInvitation')({ inviteId, token }); if (getFirebaseAuth().currentUser?.uid === user.uid) { await navigate('/account', { replace: true }); await getIdToken(user, true); } })}>Přijmout pozvánku</button>
        <button className="quiet-button" disabled={pending} onClick={() => void signOut()}>Přihlásit jiný účet</button>
      </section>}
      <section className="account-card"><h2>Přístup do JustKvízu</h2>
        {membership ? <><p><strong>{roleLabels[membership.role]}</strong></p><p>Kvízy: {scopeSummary(membership.quizzes)}<br />Akce: {scopeSummary(membership.events)}</p><ul>{membership.permissions.map(p => <li key={p}>{permissionLabels[p]}</li>)}</ul><Link className="primary-button" to="/admin">Otevřít administraci</Link></>
          : <><p>Přístup zatím není přidělen</p><p>Pro práci s kvízy a akcemi přijměte pozvánku od správce.</p></>}
      </section>
      <section className="account-card"><h2>Zabezpečení účtu</h2>
        <div className="account-form"><label>Aktuální heslo<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label>Nový přihlašovací e-mail<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
          <button className="secondary-button" disabled={pending || !email || email === user.email} onClick={() => void run(async () => { await reauthenticate(); await verifyBeforeUpdateEmail(user, email.trim()); setNotice('Na nový e-mail jsme odeslali ověření. Změna se dokončí až po jeho potvrzení; pak se znovu přihlaste.'); })}>Ověřit a změnit e-mail</button>
          <label>Nové heslo<input type="password" minLength={12} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
          <label>Zopakovat nové heslo<input type="password" minLength={12} autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
          <p>Po změně hesla se odhlásí všechna zařízení včetně tohoto. Přihlaste se potom novým heslem.</p>
          <button className="secondary-button" disabled={pending || newPassword.length < 12 || newPassword !== confirmation} onClick={() => void run(async () => { await reauthenticate(); await updatePassword(user, newPassword); await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email!, newPassword)); await revokeSessions(); await signOut(); })}>Změnit heslo</button>
        </div>
        <hr /><h3>Přihlášená zařízení</h3><p>Odhlášení všech zařízení zneplatní i toto přihlášení. Další požadavky do aplikace budou odmítnuty; již stažené soubory tím nelze vymazat.</p>
        <button className="secondary-button" disabled={pending || !password} onClick={() => void run(async () => { await reauthenticate(); await revokeSessions(); await signOut(); })}>Odhlásit všechna zařízení</button>
        <button className="quiet-button" disabled={pending} onClick={() => void signOut()}>Odhlásit pouze toto zařízení</button>
      </section>
    </>}
  </div>;
}
