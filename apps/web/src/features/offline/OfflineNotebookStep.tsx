import { useCallback, useEffect, useRef, useState } from 'react';
import { installOfflineEvent } from './offlinePreparation';
import { installOfflineShell, testOfflineShellBoot } from './offlineShell';
import { prepareOfflineStorage, readOfflineTrusts, verifyStoredOfflineStorage } from './offlineStore';
import './offlineNotebookStep.css';

interface ChromeInstallPrompt extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function useOfflineInstallPrompt() {
  const [prompt, setPrompt] = useState<ChromeInstallPrompt | null>(null);
  useEffect(() => {
    const available = (event: Event) => {
      event.preventDefault();
      setPrompt(event as ChromeInstallPrompt);
    };
    const installed = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', available);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  return { prompt, clear: () => setPrompt(null) };
}

type Readiness = 'checking' | 'application' | 'storage' | 'trust' | 'unsupported' | 'ready';

const notebookStatus: Record<Exclude<Readiness, 'ready'>, string> = {
  checking: 'Ověřujeme, že se JustKvíz na tomto notebooku spustí bez internetu a bezpečně uloží průběh.',
  application: 'Notebook ještě není připravený. S připojením k internetu uložte JustKvíz pro hraní offline.',
  storage: 'Notebook ještě není připravený. Uvolněte místo nebo v prohlížeči povolte uchování dat.',
  trust: 'Notebook ještě potřebuje ověřit, že smí otevřít kvíz této akce.',
  unsupported: 'Otevřete JustKvíz v běžném okně Google Chrome na notebooku.',
};

function readyStatus(transferTarget: boolean, ready: boolean): string {
  if (transferTarget) return 'Notebook je připravený. Teď na něm otevřete přenesený soubor a ověřte kvíz.';
  if (ready) return 'Kvíz i tento notebook jsou připravené. Před akcí si zkuste kvíz otevřít s vypnutým internetem.';
  return 'Notebook je připravený. Ještě potřebujete uložit a ověřit offline soubor.';
}

async function inspectNotebook(eventId: string, transferTarget: boolean): Promise<Readiness> {
  if (!window.isSecureContext || !navigator.serviceWorker || !navigator.storage?.persist || !navigator.locks) {
    return 'unsupported';
  }
  try {
    await testOfflineShellBoot();
  } catch {
    return 'application';
  }
  try {
    await verifyStoredOfflineStorage();
  } catch {
    return 'storage';
  }
  if (transferTarget) {
    try {
      const pinned = await readOfflineTrusts();
      if (!navigator.onLine || pinned.length === 0) return 'trust';
      const { fetchOfflineTrust } = await import('./offlineOnline');
      const trust = await fetchOfflineTrust(eventId);
      if (!pinned.some(key => key.keyId === trust.keyId && key.environment === trust.environment)) return 'trust';
    } catch {
      return 'trust';
    }
  }
  return 'ready';
}

export function offlineTransferHref(eventId: string): string {
  return `/offline.html#/prepare?eventId=${encodeURIComponent(eventId)}&transfer=1`;
}

interface NotebookStepProps {
  readonly eventId: string;
  readonly packageVerified?: boolean;
  readonly transferTarget?: boolean;
  readonly installation?: ReturnType<typeof useOfflineInstallPrompt>;
  readonly onReady?: ((ready: boolean) => void) | undefined;
  readonly onOpen?: (() => void) | undefined;
  readonly opening?: boolean;
}

export function OfflineNotebookStep({ eventId, packageVerified = false, transferTarget = false, installation, onReady, onOpen, opening }: NotebookStepProps) {
  const [readiness, setReadiness] = useState<Readiness>('checking');
  const [usingOtherNotebook, setUsingOtherNotebook] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = useRef<AbortController | null>(null);
  const standalone = window.matchMedia('(display-mode: standalone)').matches;

  const check = useCallback((prepare = false, installPrompt?: ChromeInstallPrompt) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setReadiness('checking');
    setFailed(false);
    async function run(): Promise<Readiness> {
      try {
        if (installPrompt && (await installPrompt.prompt()).outcome === 'dismissed') return 'storage';
        if (prepare || installPrompt) {
          controller.signal.throwIfAborted();
          if (transferTarget) {
            await installOfflineEvent(eventId, () => {});
          } else {
            await installOfflineShell();
            controller.signal.throwIfAborted();
            await testOfflineShellBoot();
            controller.signal.throwIfAborted();
            await prepareOfflineStorage(0);
          }
          return 'ready';
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
      return controller.signal.aborted ? 'checking' : inspectNotebook(eventId, transferTarget);
    }
    void run().then(result => {
      if (!controller.signal.aborted) setReadiness(result);
    }).finally(() => {
      if (active.current === controller) active.current = null;
    });
  }, [eventId, transferTarget]);

  useEffect(() => {
    check();
    const recheck = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('focus', recheck);
    window.addEventListener('online', recheck);
    return () => {
      active.current?.abort();
      active.current = null;
      window.removeEventListener('focus', recheck);
      window.removeEventListener('online', recheck);
    };
  }, [check]);

  const ready = !transferTarget && !usingOtherNotebook && readiness === 'ready' && packageVerified;
  useEffect(() => { onReady?.(ready); }, [onReady, ready]);

  return (
    <section className="offline-notebook-step" aria-labelledby="offline-notebook-heading"
      data-offline-notebook-state={usingOtherNotebook ? 'transfer' : readiness}>
      <h2 id="offline-notebook-heading">Připravit notebook</h2>
      {usingOtherNotebook ? <>
        <p>Na notebooku, na kterém budete hrát, dokončete tyto kroky ještě před odjezdem.</p>
        <ol className="offline-notebook-list">
          <li>Přeneste uložený soubor na notebook, například na USB disku. Heslo si vezměte zvlášť.</li>
          <li>Na notebooku se přihlaste do JustKvízu a otevřete přípravu této akce. Zvolte přípravu cílového notebooku.</li>
          <li>Otevřete přenesený kvíz, vyberte uložený soubor a zadejte heslo. Před akcí zkuste kvíz znovu otevřít bez internetu.</li>
        </ol>
        <div className="offline-notebook-actions">
          <a className="offline-notebook-primary" href={offlineTransferHref(eventId)}>Příprava cílového notebooku</a>
          <button type="button" className="offline-notebook-secondary" onClick={() => setUsingOtherNotebook(false)}>Budu hrát na tomto notebooku</button>
        </div>
      </> : <>
        {transferTarget && <p>Tento postup použijte na notebooku, na kterém budete hrát. Připojte ho k internetu a přihlaste se do JustKvízu.</p>}
        <p role="status">{readiness === 'ready' ? readyStatus(transferTarget, ready) : notebookStatus[readiness]}</p>
        {failed && readiness !== 'ready' && <p className="offline-error" role="alert">
          Přípravu notebooku se nepodařilo dokončit. Zkontrolujte připojení, přihlášení a volné místo. Potom zkuste přípravu znovu.
        </p>}
        <div className="offline-notebook-actions">
          {readiness === 'ready' && transferTarget && <a className="offline-notebook-primary" href={`/offline.html#/import?eventId=${encodeURIComponent(eventId)}`}>Načíst přenesený kvíz</a>}
          {ready && onOpen && <button type="button" className="offline-notebook-primary" onClick={onOpen} disabled={opening}>Otevřít offline kvíz</button>}
          {readiness === 'storage' && installation?.prompt && !standalone
            ? <button className="offline-notebook-primary" type="button" onClick={() => {
              const prompt = installation.prompt;
              if (!prompt) return;
              installation.clear();
              check(false, prompt);
            }}>Nainstalovat JustKvíz v Chrome</button>
            : ['application', 'storage', 'trust'].includes(readiness) &&
              <button className="offline-notebook-primary" type="button" onClick={() => check(true)}>Připravit JustKvíz pro hraní bez internetu</button>}
          {!transferTarget && <button type="button" className="offline-notebook-secondary"
            onClick={() => setUsingOtherNotebook(true)}>Budu hrát na jiném notebooku</button>}
        </div>
        {readiness === 'storage' && !standalone && !installation?.prompt &&
          <p className="offline-notebook-hint">Pokud Chrome v nabídce nabízí instalaci JustKvízu, použijte ji. Otevřete aplikaci z její ikony a znovu zkontrolujte přípravu notebooku.</p>}
      </>}
    </section>
  );
}
