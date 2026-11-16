import { useEffect, useRef, useState } from 'react';
import type { MediaDiagnosticReason, MediaDiagnosticTarget } from '../presentation/mediaDiagnostics';
import { probeHosting, type HostingProbeResult } from './hostingProbe';
import { HumanError } from '../../ui/HumanError';
import type { ReactNode } from 'react';

export interface LiveDiagnosticObservation {
  readonly device: 'projector' | 'moderator' | 'preview';
  readonly target: MediaDiagnosticTarget;
  readonly reason: MediaDiagnosticReason;
  readonly position: number;
  readonly mediaGeneration: number;
  readonly observedAt: number;
}

const targets: Record<MediaDiagnosticTarget, string> = {
  'question-image': 'Obrázek otázky', 'answer-image': 'Obrázek odpovědi',
  'background-image': 'Pozadí', 'logo-image': 'Logo', audio: 'Audio', video: 'Video',
};

const devices: Record<LiveDiagnosticObservation['device'], string> = {
  projector: 'Projektor', moderator: 'Moderátor', preview: 'Náhled moderátora',
};

const reasons: Record<MediaDiagnosticReason, string> = {
  'slow-load': 'Načítání trvá přes 6 sekund. Příčinou může být slabé připojení nebo pomalý zdroj.',
  buffering: 'Přehrávání čeká přes 6 sekund na další data. Zkuste stabilnější připojení nebo přehrání zopakujte.',
  timeout: 'Načítání média překročilo časový limit. Zkontrolujte připojení a dostupnost zdroje.',
  'load-failed': 'Zdroj se nenačetl. Prohlížeč neposkytl přesný důvod. Ověřte připojení a odkaz na soubor.',
  'network-error': 'Přenos média selhal. Zkontrolujte připojení a dostupnost zdroje.',
  offline: 'Prohlížeč při načítání hlásil odpojení od sítě. Obnovte připojení a zkuste to znovu.',
  'gateway-throttled': 'Služba pro čtení souboru omezila počet požadavků. Chvíli počkejte a zkuste načtení zopakovat.',
  'gateway-error': 'Služba pro čtení souboru vrátila chybu. Zkuste načtení zopakovat.',
  'gateway-unavailable': 'Služba pro čtení souboru je nedostupná nebo neodpověděla včas. Zkuste načtení zopakovat.',
  'access-denied': 'Přístup k médiu byl odmítnut. Ověřte přihlášení a přístup k souboru.',
  'not-found': 'Zdroj není dostupný. Ověřte existenci souboru nebo videa a jeho nastavení sdílení.',
  'source-unavailable': 'Zdroj chybí nebo ho prohlížeč nepodporuje. Ověřte odkaz a formát souboru.',
  'invalid-media': 'Zdroj není platné nebo podporované médium. Zkontrolujte odkaz a formát.',
  'decode-failed': 'Prohlížeč nedokázal přečíst stažená data. Soubor může být poškozený nebo v nepodporovaném formátu.',
  'invalid-timing': 'Čas ukázky je mimo délku média. Zkontrolujte začátek a konec klipu.',
  'youtube-unavailable': 'Přehrávač YouTube se nepodařilo načíst. Ověřte přístup k YouTube na této síti.',
  'youtube-embedding-disabled': 'YouTube zakazuje vložené přehrávání tohoto videa. Použijte jiný zdroj.',
  'youtube-configuration': 'YouTube odmítl konfiguraci přehrávače. Zkontrolujte nastavení prohlížeče nebo rozšíření.',
  'autoplay-blocked': 'Prohlížeč zablokoval spuštění. Použijte Pustit znovu nebo ruční spuštění v přehrávači, pokud ho nabízí.',
};

export function LiveMediaAlerts({ observations }: { readonly observations: readonly LiveDiagnosticObservation[] }) {
  return observations.map(({ device, target, reason }) => (
    <div key={`${device}:${target}`} className="live-media-alert" data-media-issue={reason}>
      <HumanError error={{ title: `${targets[target]} · ${devices[device]}`, message: reasons[reason] }} />
    </div>
  ));
}

function probeMessage(result: HostingProbeResult): string {
  switch (result.kind) {
    case 'ok': return `Web JustKvíz odpověděl za ${result.elapsedMs} ms.`;
    case 'slow': return `Pomalá odezva webu JustKvíz · ${result.elapsedMs} ms.`;
    case 'timeout': return 'Web JustKvíz neodpověděl do 5 sekund. Zkontrolujte síť a zopakujte test.';
    case 'offline': return 'Prohlížeč hlásí odpojení. Připojte toto zařízení k internetu.';
    case 'unreachable': return 'Spojení s webem JustKvíz selhalo. Zkontrolujte připojení a případné přihlášení do Wi-Fi.';
    case 'unexpected-response': return 'Přišla neočekávaná odpověď. Ověřte, zda Wi-Fi nečeká na přihlášení.';
    case 'http-error': return `Web JustKvíz vrátil chybu HTTP ${result.status}.`;
  }
}

export function LiveDiagnostics({ projection, observations = [], latency }: {
  readonly projection: 'unconfirmed' | 'loading' | 'failed' | 'confirmed';
  readonly observations?: readonly LiveDiagnosticObservation[];
  readonly latency?: ReactNode;
}) {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<HostingProbeResult>();
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    const updateNetwork = () => {
      inFlight.current?.abort();
      inFlight.current = null;
      setOnline(navigator.onLine);
      setTesting(false);
      setResult(undefined);
    };
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, []);

  async function runTest() {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setTesting(true);
    const outcome = await probeHosting(controller);
    if (inFlight.current !== controller) return;
    inFlight.current = null;
    setResult(outcome);
    setTesting(false);
  }

  const projectionLabel = {
    unconfirmed: 'Čeká se na moderování.',
    loading: 'Čeká se na potvrzení ze serveru.',
    failed: 'Aktuální stav projekce se v moderování nepodařilo potvrdit.',
    confirmed: 'Moderování přijalo stav projekce ze serveru.',
  }[projection];

  return (
    <details className="technical-details live-diagnostics">
      <summary>Technická diagnostika{!online ? ' · odpojeno' : observations.length > 0 ? ' · hlášení médií' : ''}</summary>
      <div className="technical-details-content">
        <p role="status">{online ? 'Prohlížeč hlásí připojení k síti.' : 'Prohlížeč hlásí odpojení od sítě.'}</p>
        <button className="secondary-button" type="button" disabled={testing} onClick={() => void runTest()}>
          {testing ? 'Měřím odezvu…' : 'Otestovat připojení'}
        </button>
        <p role="status">{testing ? 'Ověřuji odezvu webu JustKvíz…' : result && probeMessage(result)}</p>
        <p className="field-help">Test měří odezvu webu z tohoto zařízení. Dostupnost médií a stav projekce se sledují zvlášť.</p>
        {result && ['slow', 'unreachable', 'timeout', 'unexpected-response'].includes(result.kind) && (
          <p>Zkontrolujte síť na notebooku. Pokud používáte hotspot, ověřte na telefonu mobilní data a spusťte test znovu.</p>
        )}
        <p><strong>Stav projekce v moderování</strong><br />{projectionLabel}</p>
        {latency}
        <p><strong>Poslední potíže s médii</strong></p>
        {observations.length === 0 ? <p>V této kartě zatím nejsou žádná hlášení.</p> : (
          <ol>
            {observations.map(({ device, target, reason, position, mediaGeneration, observedAt }) => (
              <li key={`${device}:${mediaGeneration}:${target}:${reason}`}>
                <strong>{targets[target]} · {devices[device]}</strong>
                <div>{new Date(observedAt).toLocaleTimeString('cs-CZ')} · pozice {position}</div>
                <p>{reasons[reason]}</p>
              </li>
            ))}
          </ol>
        )}
        <p className="field-help">Hlášení z projektoru fungují v druhém okně stejného prohlížeče na tomto zařízení.</p>
      </div>
    </details>
  );
}
