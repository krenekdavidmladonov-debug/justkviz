import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AssetImage } from '../media/AssetImage';
import { preflightImageObservationEpoch, preflightImageWidths, subscribePreflightImageWidths } from './imageObservations';

function ImageProbe({ source, complete }: { readonly source: string; readonly complete: (source: string) => void }) {
  useEffect(() => { const timer = window.setTimeout(() => complete(source), 12_000); return () => window.clearTimeout(timer); }, [source, complete]);
  return <AssetImage source={source} alt="" onTiming={stage => { if (stage === 'image-ready' || stage === 'image-error') complete(source); }} />;
}
/** Opt-in ordinary image loads: three at a time, at most 400 distinct sources per pass. */
export function ImageResolutionCheck({ sources }: { readonly sources: readonly string[] }) {
  const widths = useSyncExternalStore(subscribePreflightImageWidths, preflightImageWidths);
  const [run, setRun] = useState<{ sources: readonly string[]; done: ReadonlySet<string>; epoch: number } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const unknown = [...new Set(sources)].filter(source => !widths.has(source));
  const active = run && run.epoch === preflightImageObservationEpoch() ? run.sources.filter(source => sources.includes(source) && !run.done.has(source)).slice(0, 3) : [];
  const complete = useRef((source: string) => {
    if (mounted.current) setRun(current => current && current.epoch === preflightImageObservationEpoch() && !current.done.has(source)
      ? { ...current, done: new Set([...current.done, source]) } : current);
  }).current;
  const checking = active.length > 0;
  return <div>
    <p>Rozlišení: šířka pod 800 px je doporučení. Neověřené obrázky: {unknown.length} z {new Set(sources).size}. Neznámý rozměr není potvrzení kvality.</p>
    <button type="button" className="secondary-button" disabled={!checking && unknown.length === 0} onClick={() => {
      if (checking) setRun(null);
      else setRun({ sources: unknown.slice(0, 400), done: new Set(), epoch: preflightImageObservationEpoch() });
    }}>{checking ? 'Zastavit ověřování obrázků' : 'Ověřit rozlišení obrázků'}</button>
    {checking && <span role="status"> Ověřuji {run!.done.size} z {run!.sources.length} obrázků…</span>}
    <div hidden aria-hidden="true">{active.map(source => <ImageProbe key={source} source={source} complete={complete} />)}</div>
  </div>;
}
