import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { readVerifiedLocalEventMediaBlob } from '../events/localEventMediaBackupFile';
import { sameLocalEventMediaManifest } from '../events/localEventMediaApi';
import { localMediaBackupSupported, readOperatorLocalMediaManifest, type LocalMediaOperatorScope } from './localMediaBackupAuthority';
import { managedProjectorWindow } from './projectorWindow';
import { serveLocalProjectorMedia, type LoadedLocalMedia } from './localMediaBackupRelay';
import type { LiveControlState, PublicLiveState } from './types';
import { useLocation } from 'react-router-dom';
import { LocalImageBackupControl } from './LocalImageBackupControl';

interface Props {
  readonly session: LiveControlState;
  readonly state: PublicLiveState | null;
  readonly projectorOpened: boolean;
}

function BackupControl({ scope, state, projectorOpened }: {
  readonly scope: LocalMediaOperatorScope;
  readonly state: PublicLiveState | null;
  readonly projectorOpened: boolean;
}) {
  const [loaded, setLoaded] = useState<LoadedLocalMedia>();
  const [status, setStatus] = useState<'idle' | 'checking' | 'ready' | 'used' | 'invalid'>('idle');
  const active = useRef<AbortController | undefined>(undefined);
  useLayoutEffect(() => () => active.current?.abort(), []);

  async function open(file: File) {
    active.current?.abort();
    const operation = new AbortController();
    active.current = operation;
    setLoaded(undefined); setStatus('checking');
    try {
      const manifest = await readOperatorLocalMediaManifest(scope, operation.signal);
      const bytes = await readVerifiedLocalEventMediaBlob(file, manifest);
      if (!manifest.media) throw new Error('Místní záloha není platná.');
      const authorized = await readOperatorLocalMediaManifest(scope, operation.signal, manifest.media.reference);
      operation.signal.throwIfAborted();
      if (!sameLocalEventMediaManifest(manifest, authorized)) throw new Error('Místní záloha není platná.');
      setLoaded({ manifest, bytes }); setStatus('ready');
    } catch {
      if (!operation.signal.aborted) setStatus('invalid');
    }
  }

  useEffect(() => {
    if (!loaded || !state) return;
    setStatus('ready');
    return serveLocalProjectorMedia(scope, state, loaded, result => {
      if (result === 'used') setStatus('used');
      else { setLoaded(undefined); setStatus('invalid'); }
    });
  }, [loaded, state, scope]);

  useEffect(() => {
    if (!loaded) return;
    let timeout: number | undefined;
    const expire = () => {
      const remaining = loaded.manifest.validUntilMs - Date.now();
      if (remaining <= 0) {
        setLoaded(undefined); setStatus('invalid');
      } else {
        timeout = window.setTimeout(expire, Math.min(remaining, 2_147_483_647));
      }
    };
    expire();
    return () => window.clearTimeout(timeout);
  }, [loaded]);

  const supported = localMediaBackupSupported();
  const connected = projectorOpened && managedProjectorWindow() !== null;
  return <section data-local-backup-control className="event-section" aria-label="Místní záloha obrázku">
    <h2>Místní záloha obrázku · experiment</h2>
    <p role="status">{status === 'used' ? 'Použita místní záloha' : status === 'ready' ? 'Místní záloha ověřena'
      : status === 'checking' ? 'Ověřuji soubor a oprávnění…' : status === 'invalid' ? 'Místní záloha je poškozená, neplatná nebo ji server nepotvrdil.'
        : 'Načtěte dříve připravený soubor .justkvizbackup.'}</p>
    {!supported && <p role="alert">Tato konfigurace nepodporuje místní zálohu. Použijte Chrome nebo Chromium na stejném notebooku.</p>}
    {supported && !connected && <p role="alert">Otevřete projektor tlačítkem Otevřít projektor v tomto moderování. Samostatná karta místní zálohu nepoužije.</p>}
    <label>Načíst místní zálohu
      <input type="file" accept=".justkvizbackup" disabled={!supported || status === 'checking'} onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        if (file) void open(file);
      }} />
    </label>
    <p>Síťový obrázek má přednost. Zkušební přepnutí čeká 1,5 sekundy a vyžaduje nové potvrzení serveru v projektoru.</p>
  </section>;
}

export function LocalMediaBackupControl(props: Props) {
  const legacy=new URLSearchParams(useLocation().search).get('backupPilot')==='1';
  return legacy?<LegacyMediaBackupControl {...props}/>:<LocalImageBackupControl {...props}/>;
}
function LegacyMediaBackupControl(props: Props) {
  const { currentUser, membership, can } = useAuth();
  const eventId = props.session.eventId, snapshotId = props.session.snapshotId, actorId = currentUser?.uid;
  const scope = useMemo<LocalMediaOperatorScope | undefined>(() => eventId && snapshotId && actorId
    ? { eventId, snapshotId, actorId } : undefined, [eventId, snapshotId, actorId]);
  if (!scope || !currentUser || !can('event.read') || !can('event.export')) return null;
  return <BackupControl key={`${props.session.sessionId}:${props.session.snapshotId}:${currentUser.uid}:${membership?.version}`}
    scope={scope}
    state={props.state} projectorOpened={props.projectorOpened} />;
}
