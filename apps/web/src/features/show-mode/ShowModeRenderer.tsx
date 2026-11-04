import type { CSSProperties, ReactNode } from 'react';
import type { PublicResultRow, ResultTemplate } from '@filmovy-kviz/quiz-domain';
import { ResultsTable } from '../leaderboard/ResultsTable';
import { FinalRevealView } from '../final-reveal/FinalRevealView';
import { ResultBackdrop, ResultBrand } from '../presentation/ResultBackdrop';
import { SlideRenderer } from '../presentation/SlideRenderer';
import { slideDesignStyle } from '../presentation/design';
import type { PublicLiveState } from '../live/types';
import { useShowMotion } from './useShowMotion';
import './show-mode.css';

const numberFormat = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 });
export const formatShowPoints = (halfPoints: number) => numberFormat.format(halfPoints / 2);

function ScoreRow({ row, movement = false }: { readonly row: PublicResultRow; readonly movement?: boolean }) {
  return <div className="sm-row" role="row">
    <span className="sm-rank" role="cell">{row.rank}.</span>
    <strong className="sm-team" role="rowheader">{row.teamName}</strong>
    {movement && <span role="cell" className={`sm-move ${row.movement !== undefined && row.movement > 0 ? 'sm-up' : ''}`} aria-label={row.movement === undefined ? 'Bez předchozího zveřejnění' : row.movement === 0 ? 'Beze změny' : `${row.movement > 0 ? 'Vzestup' : 'Pokles'} o ${Math.abs(row.movement)}`}>{row.movement === undefined ? '' : row.movement === 0 ? '—' : `${row.movement > 0 ? '↑' : '↓'} ${Math.abs(row.movement)}`}</span>}
    <strong className="sm-points" role="cell">{formatShowPoints(row.halfPoints)}</strong>
  </div>;
}

function PageLabel({ page, pageCount }: { readonly page: number; readonly pageCount: number }) {
  if (pageCount <= 1) return null;
  return <span className="sm-page">Strana {page + 1} / {pageCount}</span>;
}

/** Keep this component mounted around the normal slide fallback to observe fresh cues.
 * First load/remount/reconnect is static. All content and page selection come from Firestore. */
export function ShowModeRenderer({ state, children }: { readonly state: PublicLiveState; readonly children?: ReactNode }) {
  const motion = useShowMotion(state.sessionId, state.revision, state.showCue);
  const interim = state.interimResults, final = state.finalReveal;
  if (!interim && !final) return children;
  const template: ResultTemplate = { ...(state.title === undefined ? {} : { title: state.title }), ...(state.subtitle === undefined ? {} : { subtitle: state.subtitle }), ...(state.design === undefined ? {} : { design: state.design }) };
  const mediaSessionId = state.sessionId;
  if ((interim ?? final)?.presentationStyle !== 'show') return <div className="results-frame" data-version-id={(interim ?? final)?.versionId}>{final ? <FinalRevealView {...final} template={template} mediaSessionId={mediaSessionId} /> : interim && <ResultsTable {...interim} template={template} mediaSessionId={mediaSessionId} />}</div>;

  const style = { ...slideDesignStyle(template.design), ...(template.design?.backgroundColor ? { '--sm-panel': template.design.backgroundColor } : {}) } as CSSProperties;
  const isWinner = final?.mode === 'group' && final.rank === 1;
  const rows = interim?.rows ?? final?.rows ?? [];
  const longest = Math.max(0, ...rows.map(row => row.teamName.length));
  const groupClass = `sm-count-${rows.length}${longest > 30 ? ' sm-long-names' : ''}${longest > 60 ? ' sm-very-long-names' : ''}`;
  const hasMovement = Boolean(interim?.rows.some(row => row.movement !== undefined));
  return <article className={`show-mode-canvas sm-scene-${interim ? 'interim' : final?.mode} ${isWinner ? 'sm-winner-scene' : ''} ${(template.title?.length ?? 0) > 30 || template.subtitle ? 'sm-dense-copy' : ''} ${motion.animated ? `sm-animate sm-motion-${motion.intensity}` : 'sm-static'}`} style={style} data-version-id={(interim ?? final)?.versionId} data-show-cue={motion.cueId} aria-label={interim ? 'Průběžné pořadí' : 'Finální vyhlášení'}>
    {interim && state.interimBackdrop && <div className="sm-slide-backdrop" aria-hidden="true"><SlideRenderer quizTitle={state.quizTitle} mediaSessionId={mediaSessionId} mode={state.interimBackdrop.renderMode} slide={{ ...state.interimBackdrop, kind: state.interimBackdrop.slideKind, options: state.interimBackdrop.options ?? [], media: [] }} /></div>}
    {interim ? <><div className="sm-dimmer" /><section className="sm-interim-panel">
      <ResultBackdrop template={template} mediaSessionId={mediaSessionId} />
      <header className="sm-interim-heading"><div><p className="sm-eyebrow">AKTUÁLNĚ ZAPSANÉ BODY</p><h1>Průběžné výsledky</h1></div><ResultBrand template={template} mediaSessionId={mediaSessionId} /></header>
      <div className={`sm-table ${hasMovement ? 'sm-with-movement' : ''}`} role="table" aria-label="Průběžné výsledky"><div className="sm-table-heading" role="row"><span role="columnheader">POŘADÍ</span><span role="columnheader">TÝM</span>{hasMovement && <span role="columnheader">ZMĚNA</span>}<span role="columnheader">BODY</span></div>{rows.map((row, index) => <ScoreRow key={`${motion.cueId}-${index}-${row.rank}-${row.teamName}`} row={row} movement={hasMovement} />)}</div>
      <footer className="sm-interim-footer"><span>Průběžné výsledky · {state.quizTitle}</span><PageLabel {...interim} /></footer>
    </section></> : <>
      <ResultBackdrop template={template} mediaSessionId={mediaSessionId} />
      <div className={`sm-finale-light${isWinner ? ' is-winner' : ''}`} aria-hidden="true" key={`light-${motion.cueId}`}><i /><i /></div>
      <header className="sm-stage-header"><span>{state.quizTitle}<span className="sm-slash">/</span>FINÁLOVÉ VÝSLEDKY</span><ResultBrand template={template} mediaSessionId={mediaSessionId} /></header>
      {final?.mode === 'intro' ? <section key={motion.cueId} className="sm-intro"><p className="sm-eyebrow">FINÁLOVÉ VYHLÁŠENÍ</p><h1>{template.title || 'Celkové výsledky'}</h1><p>{template.subtitle || 'Za chvíli odhalíme konečné pořadí.'}</p></section>
        : final?.mode === 'table' || final?.mode === 'lower' ? <section className="sm-final-table">{final.mode !== 'lower' && <p className="sm-eyebrow">KONEČNÉ POŘADÍ</p>}<h1>{template.title || (final.mode === 'lower' ? 'Díky za skvělou hru.' : 'Takový byl dnešní večer.')}</h1>{template.subtitle && <p className="sm-subtitle">{template.subtitle}</p>}<div className="sm-table" role="table" aria-label={final.mode === 'lower' ? 'Odhalená nižší pořadí' : 'Konečné pořadí'}><div className="sm-table-heading" role="row"><span role="columnheader">POŘADÍ</span><span role="columnheader">TÝM</span><span role="columnheader">BODY</span></div>{rows.map((row, index) => <ScoreRow key={`${index}-${row.rank}-${row.teamName}`} row={row} />)}</div><PageLabel {...final} /></section>
        : isWinner ? <section className={`sm-winner ${groupClass}`}><div className="sm-winner-label"><span />{template.title || 'VÍTĚZOVÉ DNEŠNÍHO VEČERA'}<span /></div><div className="sm-winner-place">1.</div><div className="sm-winner-names" key={motion.cueId}>{rows.map((row, index) => <h1 key={index}>{row.teamName}</h1>)}</div><p className="sm-winner-score"><strong>{formatShowPoints(rows[0]?.halfPoints ?? 0)}</strong><span>bodů</span></p><p className="sm-winner-message">{template.subtitle || (final && final.groupSize > 1 ? 'Jedno první místo. Společné vítězství.' : 'Tenhle večer patří vám.')}</p>{final && <PageLabel {...final} />}</section>
        : final?.mode === 'group' && <div className="sm-finale-layout"><section className={`sm-rank-feature ${groupClass}`}><p className="sm-eyebrow">{template.title || 'PRÁVĚ ODHALENO'}</p><div className="sm-feature-number" key={`rank-${motion.cueId}`}>{final.rank}.</div><p className="sm-feature-label">{final.groupSize > 1 ? 'SDÍLENÉ MÍSTO' : 'MÍSTO'}</p><div className="sm-feature-teams" key={motion.cueId}>{rows.map((row, index) => <h1 key={index}>{row.teamName}</h1>)}</div><p className="sm-feature-score"><strong>{formatShowPoints(rows[0]?.halfPoints ?? 0)}</strong> bodů</p>{template.subtitle && <p className="sm-subtitle">{template.subtitle}</p>}<PageLabel {...final} /></section><section className="sm-history">{final.history ? <><div role="table" aria-label="Dříve odhalená pořadí">{final.history.rows.map((row, index) => <ScoreRow key={`${motion.cueId}-${index}`} row={row} />)}</div>{final.history.pageCount > 1 && <p className="sm-history-page"><PageLabel {...final.history} /></p>}</> : <p className="sm-no-history">Další výsledky zatím nejsou odhalené.</p>}</section></div>}
      <footer className="sm-stage-footer"><span>{isWinner ? 'DĚKUJEME, ŽE HRAJETE S NÁMI.' : 'KAŽDÝ BOD MÁ SVŮJ PŘÍBĚH.'}</span></footer>
    </>}
  </article>;
}
