import { useContext } from 'react';
import { ProjectorMotionContext } from '../show-mode/ProjectorMotion';
import { ProjectorResultPoints, projectorRowStyle, projectorRowDelay } from '../show-mode/ProjectorResultRow';
import type { ResultTemplate } from '@filmovy-kviz/quiz-domain';
import { slideDesignStyle } from '../presentation/design';
import { ResultBackdrop, ResultBrand } from '../presentation/ResultBackdrop';
import type { ResultRow } from './types';
import './leaderboard.css';
export function ResultsTable({ roundNumber, page, pageCount, rows, final = false, template, mediaSessionId }: {
    template?: ResultTemplate | undefined;
    mediaSessionId?: string | undefined;
    roundNumber?: number;
    final?: boolean;
    page: number;
    pageCount: number;
    rows: readonly ResultRow[];
}) {
    const motion = useContext(ProjectorMotionContext);
    return <article style={slideDesignStyle(template?.design)} className={`results-canvas result-layout-${template?.design?.layout ?? 'classic'}`} aria-label={final ? "Konečné pořadí" : "Průběžné výsledky"}>
    <ResultBackdrop template={template} mediaSessionId={mediaSessionId} />
    <header><p><ResultBrand template={template} mediaSessionId={mediaSessionId} /><span>{final ? "KONEČNÉ POŘADÍ" : `PO ${roundNumber}. KOLE`}</span></p><h1>{template?.title || (final ? "Konečné pořadí" : "Jak si vedete?")}</h1>{template?.subtitle && <p className="results-subtitle">{template.subtitle}</p>}</header>
    <table><thead><tr><th scope="col">Pořadí</th><th scope="col">Tým</th><th scope="col">Body</th></tr></thead>
      <tbody>{rows.map((row, i) => <tr style={motion ? projectorRowStyle(row.rank, rows) : undefined} className={(motion ? 'pm-table-row ' : '') + (row.rank <= 3 ? `result-rank-${row.rank}` : '')} key={page * 8 + i}><td><span>{row.rank}.</span></td><th scope="row" title={row.teamName}>{row.teamName}</th><td><ProjectorResultPoints halfPoints={row.halfPoints} delay={projectorRowDelay(row.rank, rows)} /></td></tr>)}</tbody>
    </table><footer>Strana {page + 1} z {pageCount} · Shodné body znamenají shodné umístění.</footer>
  </article>;
}
