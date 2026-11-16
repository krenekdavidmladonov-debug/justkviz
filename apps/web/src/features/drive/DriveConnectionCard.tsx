import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { beginDriveConnection, createDriveMediaFolder, disconnectDriveConnection, getDriveFolderPicker, readDriveConnection, selectDriveFolder, type DriveConnectionStatus } from './api';
import { openDriveFolderPicker, type DrivePickerErrorCode } from './picker';
import { driveConnectionSettingsDestination, prepareDriveConnection, type DriveConnectionResult } from './session';
import { DriveMediaCompanionCard } from './DriveMediaCompanionCard';

const resultMessages: Record<DriveConnectionResult, string> = {
  connected: 'Účet byl připojen. Zkontrolujte vybranou složku pro média.',
  cancelled: 'Připojení bylo zrušeno. Můžete ho zkusit znovu.',
  failed: 'Připojení se nepodařilo dokončit. Zkuste ho znovu.',
  expired: 'Ověření připojení vypršelo nebo neodpovídá tomuto účtu. Začněte znovu.',
  forbidden: 'K připojení Google Disku potřebujete přístup vlastníka s příslušnými oprávněními.',
};
const pickerErrorMessages: Record<DrivePickerErrorCode, string> = {
  unavailable: 'Okno výběru Google Disku se nepodařilo načíst. Zkuste výběr znovu. Pokud zůstane prázdné, zkontrolujte, zda prohlížeč neblokuje obsah Google, nebo zkuste jiný prohlížeč.',
  expired: 'Platnost výběru Google Disku vypršela. Spusťte výběr složky znovu.',
  timeout: 'Výběr Google Disku neodpověděl včas a byl zavřen. Zkuste výběr znovu. Pokud okno zůstává prázdné, zkontrolujte blokování obsahu Google v prohlížeči nebo zkuste jiný prohlížeč.',
  'invalid-selection': 'Google Disk nevrátil platnou složku. Zkuste výběr znovu a potvrďte jednu složku.',
};

export function DriveConnectionCard() {
  const { currentUser, membership, can, loading } = useAuth();
  const allowed = !loading && !!currentUser && membership?.role === 'owner' && can('users.manage') && can('quiz.media.upload');
  return allowed ? <OwnerDriveConnectionCard key={`${currentUser.uid}:${membership.version}`} uid={currentUser.uid} /> : null;
}

function OwnerDriveConnectionCard({ uid }: { uid: string }) {
  const { can } = useAuth();
  const canPrepareLocally = (['quiz.media.attach', 'quiz.edit', 'quiz.read', 'quiz.answers.read'] as const).every(permission => can(permission));
  const [status, setStatus] = useState<DriveConnectionStatus | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const location = useLocation();
  const result = (location.state as { driveConnectionResult?: DriveConnectionResult } | null)?.driveConnectionResult;
  const [notice, setNotice] = useState(result && Object.hasOwn(resultMessages, result) ? resultMessages[result] : '');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [selectingFolder, setSelectingFolder] = useState(false);
  const alive = useRef(false);
  const pickerAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true; alive.current = true;
    void readDriveConnection().then(value => { if (active) setStatus(value); }).catch(() => {
      if (active) setError('Stav Google Disku se nepodařilo načíst. Zkuste to znovu.');
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; alive.current = false; pickerAbort.current?.abort(); };
  }, []);
  async function run(action: () => Promise<void>) {
    if (pending) return;
    setPending(true); setError(''); setNotice('');
    try { await action(); }
    catch { if (alive.current) setError('Operaci se nepodařilo dokončit. Zkuste to znovu. Pokud potíže trvají, obnovte připojení.'); }
    finally { if (alive.current) setPending(false); }
  }
  async function connect() {
    const response = await beginDriveConnection();
    if (!alive.current) return;
    const destination = prepareDriveConnection(uid, response.state, response.authorizationUrl);
    window.location.assign(destination);
  }
  async function chooseFolder() {
    const controller = new AbortController(); pickerAbort.current = controller;
    let id: string | null;
    try {
      const credentials = await getDriveFolderPicker();
      if (!alive.current || controller.signal.aborted) return;
      setSelectingFolder(true);
      id = await openDriveFolderPicker(credentials, controller.signal);
    } catch (failure) {
      if (alive.current && !controller.signal.aborted) {
        const code = failure && typeof failure === 'object' && 'pickerCode' in failure ? failure.pickerCode : undefined;
        setError(typeof code === 'string' && Object.hasOwn(pickerErrorMessages, code)
          ? pickerErrorMessages[code as DrivePickerErrorCode] : 'Výběr složky se nepodařilo otevřít. Zkuste ho znovu nebo znovu načtěte stav připojení.');
      }
      return;
    } finally {
      if (pickerAbort.current === controller) pickerAbort.current = null;
      if (alive.current) setSelectingFolder(false);
    }
    if (!alive.current) return;
    if (controller.signal.aborted || !id) { setNotice('Výběr složky byl zrušen.'); return; }
    const selected = await selectDriveFolder(id);
    if (alive.current) { setStatus(selected); setNotice('Složka pro média byla uložena.'); }
  }
  const connected = status?.status === 'connected' || status?.status === 'folder-required';
  // Folder URLs are derived from validated IDs; no remote response can inject a link destination.
  const folder = status?.folder;
  const folderUrl = folder && /^[a-zA-Z0-9_-]+$/.test(folder.id) ? `https://drive.google.com/drive/folders/${folder.id}` : null;
  const connectionSettings = driveConnectionSettingsDestination(window.location.origin);
  return <section className="event-section" aria-labelledby="drive-connection-heading" aria-busy={pending}>
    <h2 id="drive-connection-heading">Google Disk</h2>
    <p>Připojte svůj osobní účet Google (Gmail) a soukromou složku pro média.</p>
    {status?.mediaImportEnabled && <p>Po uložení otázky se připraví výřez videa nebo zvuku podle zadaného začátku a konce. Obrázky se načítají z původních webových adres. Průběh uvidíte v editoru.</p>}
    {status?.status === 'connected' && status.mediaImportEnabled && status.mediaImportMode === 'local' && canPrepareLocally && <DriveMediaCompanionCard />}
    <p>Aplikace má přístup jen k souborům, které sama vytvoří nebo jí zpřístupníte výběrem.</p>
    {pending && <p role="status">{selectingFolder ? 'Čekám na výběr složky v okně Google Disku…' : status ? 'Pracuji…' : 'Načítám stav připojení…'}</p>}
    {selectingFolder && <>
      <p>Pokud je okno prázdné nebo se nenačítá, zrušte výběr a zkuste ho znovu. Výběr se po dvou minutách automaticky zavře.</p>
      <button type="button" className="secondary-button" onClick={() => { pickerAbort.current?.abort(); setNotice('Výběr složky byl zrušen.'); }}>Zrušit výběr složky</button>
    </>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {status?.status === 'not-configured' && <p>Připojení Google Disku zatím není aktivované.</p>}
    {status?.status === 'disconnected' && <p>Google Disk není připojen.</p>}
    {status?.status === 'reauthorization-required' && <p>Přístup k Google Disku vypršel nebo byl odebrán. Připojte účet znovu.</p>}
    {connected && <>
      <p>Připojený účet: <strong>{status.accountEmail ?? 'Účet Google'}</strong></p>
      {folderUrl ? <p>Složka: <a href={folderUrl} target="_blank" rel="noopener noreferrer">{folder?.name}</a></p> : <p>Vytvořte soukromou složku aplikace nebo vyberte vlastní složku.</p>}
      {!folderUrl && <button type="button" className="primary-button" disabled={pending} onClick={() => void run(async () => {
        const selected = await createDriveMediaFolder();
        if (alive.current) { setStatus(selected); setNotice('Soukromá složka aplikace je připravená.'); }
      })}>Vytvořit složku aplikace</button>}
      <button type="button" className="secondary-button" disabled={pending} onClick={() => void run(chooseFolder)}>{folderUrl ? 'Změnit složku' : 'Vybrat složku pro média'}</button>
    </>}
    {status?.configured && (status.status === 'disconnected' || status.status === 'reauthorization-required') && (connectionSettings ? <>
      <p>Google Disk připojíte v nastavení na justkviz.cz. Může být potřeba se tam přihlásit.</p>
      <a className="primary-button" href={connectionSettings}>Připojit Google Disk na justkviz.cz</a>
    </> : <button type="button" className="primary-button" disabled={pending} onClick={() => void run(connect)}>Připojit Google Disk</button>)}
    {status?.configured && status.status !== 'disconnected' && status.status !== 'not-configured' && <>
      {!confirmDisconnect ? <button type="button" className="secondary-button" disabled={pending} onClick={() => setConfirmDisconnect(true)}>Odpojit Google Disk</button> : <div role="group" aria-label="Potvrzení odpojení Google Disku">
        <p>Odpojit účet Google? Soubory ve složce zůstanou zachované.</p>
        <button type="button" className="danger-button" disabled={pending} onClick={() => void run(async () => { const disconnected = await disconnectDriveConnection(); if (alive.current) { setStatus(disconnected); setConfirmDisconnect(false); setNotice('Google Disk byl odpojen. Soubory zůstaly zachované.'); } })}>Potvrdit odpojení</button>
        <button type="button" className="secondary-button" disabled={pending} onClick={() => setConfirmDisconnect(false)}>Zrušit</button>
      </div>}
    </>}
    {error && <button type="button" className="secondary-button" disabled={pending} onClick={() => void run(async () => { const next = await readDriveConnection(); if (alive.current) setStatus(next); })}>Znovu načíst stav</button>}
  </section>;
}
