import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LocalImageBackupPanel } from './LocalImageBackupPanel';
import {
  createLocalEventMediaBackup, saveLocalEventMediaBackup, verifyLocalEventMediaBackup,
  type LocalEventMediaManifest,
} from './localEventMediaBackupFile';
import {
  downloadLocalEventMedia, readLocalEventMediaManifest, sameLocalEventMediaManifest, type LocalEventMediaScope,
} from './localEventMediaApi';

type Status = 'idle' | 'preparing' | 'prepared' | 'saving' | 'downloaded' | 'verifying' | 'ready' | 'corrupt' | 'invalid' | 'error';
interface PanelState {
  readonly status: Status;
  readonly manifest?: LocalEventMediaManifest;
  readonly backup?: Blob;
  readonly verifiedFile?: File;
  readonly message?: string;
}

const messages: Record<Status, string> = {
  idle: 'Zatím nebyl ověřen žádný soubor.',
  preparing: 'Ověřuji manifest a stahuji zkušební obrázek…',
  prepared: 'Balíček je připraven k uložení. Uložený soubor se ověří po otevření.',
  saving: 'Ukládám balíček…',
  downloaded: 'Soubor byl nabídnut ke stažení. Otevřete stažený soubor pro ověření.',
  verifying: 'Ověřuji uložený soubor a aktuální oprávnění…',
  ready: 'Připraveno. Uložený soubor při poslední kontrole prošel ověřením po znovuotevření.',
  corrupt: 'Soubor je poškozený nebo jeho obsah nesouhlasí.',
  invalid: 'Balíček nelze ověřit pro aktuální akci a přístup. Připravte nový nebo znovu otevřete platný soubor.',
  error: 'Balíček se nepodařilo připravit. Zkuste to znovu.',
};

class LocalMediaAccessChanged extends Error {}

export function LocalEventMediaPanel(scope: LocalEventMediaScope) {
  const legacy = new URLSearchParams(useLocation().search).get('backupPilot') === '1';
  return legacy ? <LegacyLocalEventMediaPanel {...scope}/> : <LocalImageBackupPanel {...scope}/>;
}

function LegacyLocalEventMediaPanel(scope: LocalEventMediaScope) {
  const [state, setState] = useState<PanelState>({ status: 'idle' });
  const active = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  function run(
    status: 'preparing' | 'saving' | 'verifying',
    work: (signal: AbortSignal) => Promise<PanelState>,
    failure: PanelState,
    replaceVerification = false,
  ) {
    if (active.current) {
      if (!replaceVerification || state.status !== 'verifying') return;
      active.current.abort();
    }
    const operation = new AbortController();
    active.current = operation;
    setState({ status });
    void work(operation.signal).then(result => {
      if (active.current === operation) setState(result);
    }).catch((error: unknown) => {
      if (active.current === operation) setState(error instanceof LocalMediaAccessChanged ? { status: 'invalid' } : failure);
    }).finally(() => {
      if (active.current === operation) active.current = null;
    });
  }

  async function assertCurrent(expected: LocalEventMediaManifest, signal: AbortSignal) {
    try {
      const current = await readLocalEventMediaManifest(scope, signal);
      if (sameLocalEventMediaManifest(expected, current)) return;
    } catch { /* The underlying callable error is private and is never rendered. */ }
    throw new LocalMediaAccessChanged();
  }

  async function verify(file: File, signal: AbortSignal): Promise<PanelState> {
    const manifest = await readLocalEventMediaManifest(scope, signal).catch(() => { throw new LocalMediaAccessChanged(); });
    const status = await verifyLocalEventMediaBackup(file, manifest);
    if (status !== 'ready') return { status, manifest };
    await assertCurrent(manifest, signal);
    return { status, manifest, verifiedFile: file };
  }

  function prepare() {
    run('preparing', async signal => {
      const manifest = await readLocalEventMediaManifest(scope, signal);
      if (!manifest.media) return { status: 'error', manifest, message: 'V připraveném kvízu není podporovaný zkušební obrázek.' };
      const bytes = await downloadLocalEventMedia(scope, manifest, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
      const backup = await createLocalEventMediaBackup(manifest, bytes);
      await assertCurrent(manifest, signal);
      return { status: 'prepared', manifest, backup };
    }, { status: 'error' });
  }

  function save() {
    const { manifest, backup } = state;
    if (!manifest || !backup || state.status !== 'prepared') return;
    run('saving', async signal => {
      const result = await saveLocalEventMediaBackup(backup, undefined, () => assertCurrent(manifest, signal));
      if (result === 'downloaded') return { status: 'downloaded', manifest };
      return verify(result, signal);
    }, { status: 'prepared', manifest, backup, message: 'Uložení se nepodařilo dokončit. Zkuste ho znovu.' });
  }

  function open(file: File) {
    run('verifying', signal => verify(file, signal), { status: 'invalid' }, true);
  }

  useEffect(() => {
    const manifest = state.manifest;
    if (!manifest || (state.status !== 'ready' && state.status !== 'prepared')) return;
    let timer: number | undefined;
    const expire = () => {
      const remaining = manifest.validUntilMs - Date.now();
      if (remaining <= 0) {
        setState(current => current === state ? { status: 'invalid' } : current);
      } else {
        timer = window.setTimeout(expire, Math.min(remaining, 2_147_483_647));
      }
    };
    expire();
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    const file = state.verifiedFile;
    if (state.status !== 'ready' || !file) return;
    const recheck = () => {
      if (document.visibilityState === 'visible') open(file);
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  });

  const busy = state.status === 'preparing' || state.status === 'saving' || state.status === 'verifying';
  return <section className="event-section" aria-labelledby="local-event-media-title" data-local-event-media-status={state.status}>
    <h2 id="local-event-media-title">Místní zkušební balíček médií</h2>
    <p>Balíček obsahuje jeden syntetický obrázek otázky. Ověření uloženého souboru vyžaduje připojení k místním emulátorům. Projektor soubor nepoužívá.</p>
    <p role="status">{state.message ?? messages[state.status]}</p>
    {state.manifest && <p>V balíčku {state.manifest.media ? 1 : 0} · chybí {state.manifest.missing} · vyloučeno {state.manifest.excluded}</p>}
    <div className="team-tool-actions">
      <button className="secondary-button" type="button" disabled={busy} onClick={prepare}>Připravit místní zálohu</button>
      <button className="secondary-button" type="button" disabled={state.status !== 'prepared'} onClick={save}>Uložit zkušební balíček</button>
      <label>Otevřít zkušební balíček
        <input type="file" accept=".justkvizbackup" disabled={state.status === 'preparing' || state.status === 'saving'} onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) open(file);
        }} />
      </label>
    </div>
  </section>;
}
