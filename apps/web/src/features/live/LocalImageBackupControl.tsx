import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { openImageBackup, type LoadedImageBackup } from '../events/localImageBackup';
import { localMediaBackupSupported, type LocalMediaOperatorScope } from './localMediaBackupAuthority';
import { managedProjectorWindow } from './projectorWindow';
import { serveLocalImages } from './localImageRelay';
import type { LiveControlState, PublicLiveState } from './types';
import { Link, useLocation } from 'react-router-dom';
interface Props {
    readonly session: LiveControlState;
    readonly state: PublicLiveState | null;
    readonly projectorOpened: boolean;
}
function Control({ scope, state, projectorOpened }: {
    scope: LocalMediaOperatorScope;
    state: PublicLiveState | null;
    projectorOpened: boolean;
}) {
    const legacyUrl = `${useLocation().pathname}?backupPilot=1`;
    const [loaded, setLoaded] = useState<LoadedImageBackup>(), [status, setStatus] = useState<'idle' | 'checking' | 'ready' | 'used' | 'invalid'>('idle');
    const [items, setItems] = useState<Record<string, { index: number; status: string }>>({});
    const active = useRef<AbortController | undefined>(undefined);
    useLayoutEffect(() => () => active.current?.abort(), []);
    useEffect(() => {
        if (!loaded || !state)
            return;
        return serveLocalImages(scope, state, loaded, result => {
            if (result === 'used')
                setStatus('used');
            else {
                setLoaded(undefined);
                setStatus('invalid');
            }
        });
    }, [loaded, state, scope]);
    useEffect(() => {
        if (!loaded)
            return;
        let timer: number | undefined;
        const expire = () => {
            const remaining = loaded.manifest.validUntilMs - Date.now();
            if (remaining <= 0) {
                setLoaded(undefined);
                setStatus('invalid');
            }
            else
                timer = window.setTimeout(expire, Math.min(remaining, 2147483647));
        };
        expire();
        return () => window.clearTimeout(timer);
    }, [loaded]);
    const supported = localMediaBackupSupported();
    const verificationItems = Object.values(items);
    const verifiedCount = verificationItems.filter(item => item.status === 'verified').length;
    const errorCount = verificationItems.filter(item => item.status === 'invalid').length;
    return <section className="event-section" data-local-image-control-status={status} aria-label="Místní záloha obrázků">
    <h2>Místní záloha obrázků</h2><p role="status">{status === 'used' ? 'Použita místní záloha' : status === 'ready' ? 'Záloha obrázků je ověřena' : status === 'checking' ? 'Ověřuji oprávnění a všechny obrázky…' : status === 'invalid' ? 'Záloha je poškozená, staršího formátu nebo není aktuálně povolena.' : 'Načtěte uložený soubor .justkvizbackup.'}</p>
    {!supported && <p role="alert">Použijte podporovaný Chrome nebo Chromium na stejném notebooku.</p>}
    {supported && (!projectorOpened || !managedProjectorWindow()) && <p role="alert">Otevřete projektor tlačítkem Otevřít projektor v tomto moderování. Samostatná karta místní zálohu nepoužije.</p>}
    {loaded && <><p>Ověřené obrázky: {loaded.manifest.assets.length}</p>{loaded.manifest.assets.some(asset => asset.visibility === 'answer') && <p role="alert">Soukromá záloha obsahuje obrázky odpovědí. Projektor je získá teprve po jejich výslovném odhalení serverem.</p>}</>}
    {verificationItems.length > 0 && <>
      <p data-local-image-verified-count={verifiedCount} data-local-image-error-count={errorCount}>Ověřeno: {verifiedCount} · chyby: {errorCount}</p>
      <details open={status === 'checking' || errorCount > 0}>
        <summary>Stav jednotlivých obrázků</summary>
        <ul>{verificationItems.map(item => <li key={item.index} data-local-image-index={item.index} data-local-image-status={item.status}>
          Obrázek {item.index}: {item.status === 'verified' ? 'ověřen' : item.status === 'invalid' ? 'neplatný obsah nebo obrázek nelze načíst' : 'ověřuji'}
        </li>)}</ul>
      </details>
    </>}
    <label>Načíst zálohu obrázků<input type="file" accept=".justkvizbackup" disabled={!supported || status === 'checking'} onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file)
                return;
            active.current?.abort();
            const operation = new AbortController();
            active.current = operation;
            setLoaded(undefined);
            setItems({});
            setStatus('checking');
            void openImageBackup(file, scope, operation.signal, (reference, imageStatus) => {
                if (operation.signal.aborted || active.current !== operation) {
                    return;
                }
                setItems(previous => ({
                    ...previous,
                    [reference]: { index: previous[reference]?.index ?? Object.keys(previous).length + 1, status: imageStatus },
                }));
            }).then(result => {
                operation.signal.throwIfAborted();
                setLoaded(result);
                setStatus('ready');
            })
                .catch(() => {
                if (!operation.signal.aborted)
                    setStatus('invalid');
            });
        }}/></label><p>Síť má přednost. Místní kopie čeká 1,5 sekundy a po celou dobu vyžaduje aktuální připojení a oprávnění.</p>
    <p><Link to={legacyUrl}>Otevřít starší jednoobrázkovou zálohu</Link></p>
  </section>;
}
export function LocalImageBackupControl(props: Props) {
    const { currentUser, membership, can } = useAuth();
    const eventId = props.session.eventId, snapshotId = props.session.snapshotId, actorId = currentUser?.uid;
    const scope = useMemo<LocalMediaOperatorScope | undefined>(() => eventId && snapshotId && actorId ? { eventId, snapshotId, actorId } : undefined, [eventId, snapshotId, actorId]);
    if (!scope || !can('event.read') || !can('event.export'))
        return null;
    return <Control key={`${props.session.sessionId}:${snapshotId}:${actorId}:${membership?.version}`} scope={scope} state={props.state} projectorOpened={props.projectorOpened}/>;
}
