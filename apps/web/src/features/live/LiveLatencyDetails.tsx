import type { LatencyTrace } from './liveLatency';

const actionLabels = { next: 'Další', previous: 'Předchozí', jump: 'Přejít', recap: 'Výběr v rekapitulaci', play: 'Play', replay: 'Pustit znovu' };
const targetLabels = { 'question-image': 'obrázek otázky', 'answer-image': 'obrázek odpovědi',
  'background-image': 'pozadí', 'logo-image': 'logo', audio: 'audio', video: 'video' };
const stageLabels = { snapshot: 'Projektor převzal potvrzený stav', frame: 'Snímek vykreslen (odhad podle snímku prohlížeče)',
  'asset-request': 'Zahájeno čtení souboru', 'asset-headers': 'Přijata hlavička odpovědi',
  'asset-body': 'Soubor stažen', 'image-ready': 'Obrázek načten', 'image-error': 'Chyba obrázku',
  'player-mounted': 'Přehrávač připojen', 'player-ready': 'Přehrávač připraven (nativní: metadata)',
  'player-cued': 'Nastavení ukázky předáno přehrávači YouTube',
  'player-can-play': 'Nativní médium lze spustit',
  'player-playing': 'Přehrávání začalo', 'player-error': 'Chyba přehrávání' };

export function LiveLatencyDetails({ trace }: { readonly trace: LatencyTrace | undefined }) {
  return (
    <div>
      <p><strong>Časy posledního měřeného příkazu</strong></p>
      <p className="field-help">Pro měření projekce otevřete odkaz na projektor s měřením ve stejném prohlížeči. Časy jsou od přijetí kliknutí. Připravenost videa a audia se měří po stisknutí Play.</p>
      {!trace ? <p>Zatím bez měření.</p> : <LatencyRows trace={trace} />}
    </div>
  );
}

function LatencyRows({ trace }: { readonly trace: LatencyTrace }) {
  const mark = (stage: 'snapshot' | 'frame') => trace.marks.find(item => item.stage === stage)?.at;
  const mediaTargets = [...new Set(trace.marks.flatMap(({ target }) => target === undefined ? [] : [target]))];
  const duration = (at: number | undefined) => at === undefined ? undefined : Math.max(0, Math.round(at - trace.start));
  function row(stage: string, label: string, at: number | undefined, target?: keyof typeof targetLabels) {
    const ms = duration(at);
    return <div key={`${stage}:${target ?? ''}`} data-latency-stage={stage} data-latency-target={target} data-latency-ms={ms}>
      <dt>{label}{target && ` · ${targetLabels[target]}`}</dt><dd>{ms === undefined ? 'Nezjištěno' : `${ms} ms`}</dd>
    </div>;
  }
  return (
    <div data-latency-status={trace.failed ? 'failed' : trace.revision === undefined ? 'pending' : 'confirmed'} data-latency-revision={trace.revision}>
      <p>{actionLabels[trace.action]} · měření {trace.id}{trace.revision !== undefined && ` · revize ${trace.revision}`}</p>
      <dl>
        {row('accepted', 'Kliknutí přijato', trace.start)}
        {row('dispatched', 'Zahájeno volání serveru', trace.dispatched)}
        {row('callable', trace.failed ? 'Odpověď na příkaz nepotvrzena' : 'Server potvrdil příkaz', trace.settled)}
        {row('snapshot', stageLabels.snapshot, mark('snapshot'))}
        {row('frame', stageLabels.frame, mark('frame'))}
        {mediaTargets.map(target => {
          const stages = target === 'audio' || target === 'video'
            ? ['asset-request', 'asset-headers', 'asset-body', 'player-mounted', 'player-cued', 'player-ready', 'player-can-play', 'player-playing', 'player-error'] as const
            : ['asset-request', 'asset-headers', 'asset-body', 'image-ready', 'image-error'] as const;
          return stages.map(stage => {
            const at = trace.marks.find(item => item.stage === stage && item.target === target)?.at;
            if (stage.endsWith('-error') && at === undefined) return null;
            return row(stage, stageLabels[stage], at, target);
          });
        })}
      </dl>
      {mediaTargets.length === 0 && <p>Médium: nezjištěno (bez média, čeká na načtení nebo není sledováno).</p>}
    </div>
  );
}
