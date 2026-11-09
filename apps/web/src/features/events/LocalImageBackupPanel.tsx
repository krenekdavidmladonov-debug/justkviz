import { useEffect, useRef, useState } from 'react';
import type { LocalImageManifest, LocalImageOmission } from '@filmovy-kviz/quiz-domain';
import { Link, useLocation } from 'react-router-dom';
import { authorizeImageBackup, openImageBackup, prepareImageBackup } from './localImageBackup';
import { saveLocalEventMediaBackup } from './localEventMediaBackupFile';
import type { LocalEventMediaScope } from './localEventMediaApi';
type Status = 'idle' | 'preparing' | 'prepared' | 'saving' | 'downloaded' | 'verifying' | 'ready' | 'invalid' | 'error';
const messages: Record<Status, string> = {
    idle: 'Připravte zálohu vlastních obrázků uzamčeného kvízu.', preparing: 'Server ověřuje manifest; potom se každý obrázek stáhne a dekóduje…',
    prepared: 'Obrázky jsou připraveny k uložení.', saving: 'Ukládám zálohu obrázků…', downloaded: 'Otevřete uložený soubor pro ověření skutečné kopie na disku.',
    verifying: 'Ověřuji oprávnění a dekóduji všechny obrázky ze souboru…', ready: 'Záloha obrázků je ověřena.', invalid: 'Soubor je poškozený, staršího formátu nebo jej aktuální server nepotvrdil.', error: 'Příprava obrázků selhala. Zkuste to znovu.',
};
const omissionLabels: Record<string, string> = {
    'external-source': 'Externí obrázek se do místní zálohy neukládá.',
    'private-export-denied': 'K exportu soukromých obrázků odpovědí nemáte oprávnění.',
    'ambiguous-private-reference': 'Obrázek má nejednoznačné soukromé použití a nelze jej bezpečně zahrnout.',
    'unsupported-image': 'Zdroj nebo formát obrázku není pro zálohu podporovaný.',
    'integrity-unavailable': 'Obsah obrázku se nepodařilo ověřit.',
};
function omissionLabel(item: LocalImageOmission): string {
    const message = omissionLabels[item.reason] ?? 'Obrázek nelze bezpečně zahrnout do zálohy.';
    return item.position > 0 ? `Snímek ${item.position}: ${message}` : message;
}
export function LocalImageBackupPanel(scope: LocalEventMediaScope) {
    const legacyUrl = `${useLocation().pathname}?backupPilot=1`;
    const [status, setStatus] = useState<Status>('idle'), [manifest, setManifest] = useState<LocalImageManifest>();
    const [backup, setBackup] = useState<Blob>(), [items, setItems] = useState<Record<string, string>>({});
    const active = useRef<AbortController | undefined>(undefined);
    useEffect(() => () => active.current?.abort(), []);
    const progress = (reference: string, value: string) => setItems(previous => ({ ...previous, [reference]: value }));
    function run(next: Status, work: (signal: AbortSignal) => Promise<void>) {
        active.current?.abort();
        const operation = new AbortController();
        active.current = operation;
        setStatus(next);
        void work(operation.signal).catch(() => {
            if (!operation.signal.aborted) {
                setBackup(undefined);
                setStatus(next === 'verifying' ? 'invalid' : 'error');
            }
        });
    }
    useEffect(() => {
        if (!manifest)
            return;
        let timer: number | undefined;
        const expire = () => {
            const remaining = manifest.validUntilMs - Date.now();
            if (remaining <= 0) {
                active.current?.abort();
                setBackup(undefined);
                setManifest(undefined);
                setStatus('invalid');
            }
            else
                timer = window.setTimeout(expire, Math.min(remaining, 2147483647));
        };
        expire();
        return () => window.clearTimeout(timer);
    }, [manifest]);
    const busy = ['preparing', 'saving', 'verifying'].includes(status);
    return <section className="event-section" data-local-image-backup-status={status} aria-label="Záloha obrázků kvízu">
    <h2>Záloha obrázků kvízu</h2><p role="status">{messages[status]}</p>
    <p>Nejvýše 64 obrázků, 10 MiB na obrázek a 64 MiB dat. Každý obrázek může mít nejvýše 8 388 608 pixelů a 8 192 px na každou stranu. Záloha vyžaduje online oprávnění; sama nenahrazuje připojení k relaci.</p>
    {manifest && <><p>Obrázky: {manifest.assets.length} · chybí {manifest.missing.length} · vyloučeno {manifest.excluded.length}</p>
      {manifest.assets.some(asset => asset.visibility === 'answer') && <p role="alert">Soukromý soubor obsahuje obrázky odpovědí. Chraňte jej před hráči a po použití jej odstraňte.</p>}</>}
    <ul>{Object.entries(items).map(([reference, value], index) => <li key={reference} data-local-image-reference={reference} data-local-image-status={value}>Obrázek {index + 1}: {value === 'verified' ? 'ověřen' : value === 'invalid' ? 'chyba' : 'ověřuji'}</li>)}</ul>
    {manifest && manifest.missing.length + manifest.excluded.length > 0 && <details>
      <summary>Chybějící a vynechané obrázky ({manifest.missing.length + manifest.excluded.length})</summary>
      <ul>
        {manifest.missing.map((item, index) => <li key={`missing-${index}`} data-local-image-status="invalid" data-local-image-position={item.position > 0 ? item.position : undefined}>{omissionLabel(item)}</li>)}
        {manifest.excluded.map((item, index) => <li key={`excluded-${index}`} data-local-image-status="excluded">{omissionLabel(item)}</li>)}
      </ul>
    </details>}
    <button type="button" disabled={busy} onClick={() => run('preparing', async (signal) => {
            setItems({});
            setBackup(undefined);
            setManifest(undefined);
            const prepared = await prepareImageBackup(scope, signal, (reference, value) => {
                if (!signal.aborted)
                    progress(reference, value);
            }, current => {
                if (!signal.aborted)
                    setManifest(current);
            });
            signal.throwIfAborted();
            setManifest(prepared.manifest);
            setBackup(prepared.file);
            setStatus('prepared');
        })}>Připravit zálohu obrázků</button>
    <button type="button" disabled={status !== 'prepared' || !manifest || !backup} onClick={() => {
            if (!manifest || !backup)
                return;
            run('saving', async (signal) => {
                const file = await saveLocalEventMediaBackup(backup, manifest.assets.some(asset => asset.visibility === 'answer') ? 'justkviz-obrazky-soukrome.justkvizbackup' : 'justkviz-obrazky.justkvizbackup', () => authorizeImageBackup(scope, manifest, signal));
                signal.throwIfAborted();
                if (file === 'downloaded') {
                    setStatus('downloaded');
                    return;
                }
                await openImageBackup(file, scope, signal);
                signal.throwIfAborted();
                setStatus('ready');
                setBackup(undefined);
            });
        }}>Uložit zálohu obrázků</button>
    <label>Otevřít zálohu obrázků<input type="file" accept=".justkvizbackup" disabled={busy} onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file)
                return;
            run('verifying', async (signal) => {
                setItems({});
                setBackup(undefined);
                setManifest(undefined);
                const opened = await openImageBackup(file, scope, signal, (reference, value) => {
                    if (!signal.aborted)
                        progress(reference, value);
                });
                signal.throwIfAborted();
                setManifest(opened.manifest);
                setStatus('ready');
            });
        }}/></label>
    <p><Link to={legacyUrl}>Otevřít starší jednoobrázkovou zálohu</Link></p>
  </section>;
}
