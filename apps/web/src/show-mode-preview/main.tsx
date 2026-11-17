import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/global.css';
import { SlideRenderer } from '../features/presentation/SlideRenderer';
import { pointUnit } from '../features/scoring/model';
import { ResultsTable } from '../features/leaderboard/ResultsTable';
import { Brand } from '../ui/Brand';
import './preview.css';
import { points, question, results, type ResultRow, type Scene } from './fixtures';

const query = new URLSearchParams(window.location.search);
const capture = query.get('capture') === '1';
const sceneParam = query.get('scene');
const initialScene: Scene = sceneParam === 'finale' || sceneParam === 'winner' ? sceneParam : 'interim';

function Movement({ row }: { readonly row: ResultRow }) {
  if (row.previousPublishedRank === undefined) return <span className="show-move" />;
  const delta = row.previousPublishedRank - row.rank;
  return <span className={`show-move ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`} aria-label={delta ? `${delta > 0 ? 'Vzestup' : 'Pokles'} o ${Math.abs(delta)}` : 'Beze změny'}>{delta ? `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)}` : '—'}</span>;
}

function RankingRow({ row, movement = false }: { readonly row: ResultRow; readonly movement?: boolean }) {
  return <div className="show-ranking-row">
    <span className="show-row-rank">{row.rank}<span>.</span></span>
    <strong className="show-row-name">{row.name}</strong>
    {movement && <Movement row={row} />}
    <strong className="show-row-points">{points(row.halfPoints)}</strong>
  </div>;
}

function App() {
  const [scene, setScene] = useState<Scene>(initialScene);
  const [overlay, setOverlay] = useState(sceneParam !== 'slide' && sceneParam !== 'baseline-results');
  const [page, setPage] = useState(0);
  const [revealedPage, setRevealedPage] = useState(0);
  const [rank, setRank] = useState(3);
  const [ties, setTies] = useState(true);
  const [coWinners, setCoWinners] = useState(false);
  const [staticMode, setStaticMode] = useState(query.get('static') === '1');
  const [skipped, setSkipped] = useState(false);
  const [generation, setGeneration] = useState(0);
  const table = results(ties, coWinners);
  const pages = Math.ceil(table.length / 6);
  // This selection models the future sanitized server response; only this subset reaches JSX.
  const visibleRows = table.slice(page * 6, page * 6 + 6);
  const revealedRows = table.filter(row => row.rank >= rank);
  const featured = revealedRows.filter(row => row.rank === rank);
  const allLowerRows = revealedRows.filter(row => row.rank > rank);
  const revealedPageCount = Math.max(1, Math.ceil(allLowerRows.length / 6));
  const activeRevealedPage = Math.min(revealedPage, revealedPageCount - 1);
  const lowerRows = allLowerRows.slice(activeRevealedPage * 6, activeRevealedPage * 6 + 6);
  const winners = scene === 'winner' ? table.filter(row => row.rank === 1) : [];

  function animate() { setSkipped(false); setGeneration(value => value + 1); }
  function chooseScene(next: Scene) {
    setScene(next); setOverlay(true); setRank(3); setPage(0); setRevealedPage(0); animate();
  }
  function nextRank() {
    const next = Math.max(...table.filter(row => row.rank < rank).map(row => row.rank), 1);
    if (next === 1) chooseScene('winner');
    else { setRank(next); setRevealedPage(0); animate(); }
  }
  const sceneTitle = !overlay ? 'Původní otázka' : scene === 'interim' ? 'Průběžné pořadí' : scene === 'finale' ? 'Postupné finále' : 'Vítězná obrazovka';

  return <div className={`show-preview ${capture ? 'is-capture' : ''}`}>
    {!capture && <header className="show-preview-header"><div><Brand /><span className="show-prototype-badge">NÁVRH · FÁZE 1</span></div><p>SHOW MODE / vizuální prototyp se syntetickými daty</p></header>}
    <div className="show-preview-workspace">
      <main className={`show-canvas ${staticMode || skipped ? 'show-static' : ''} scene-${scene}`} aria-label={`Projektor: ${sceneTitle}`}>
        {!overlay && sceneParam === 'baseline-results' ? <ResultsTable roundNumber={3} page={0} pageCount={pages} rows={visibleRows.map(row => ({ rank: row.rank, teamName: row.name, halfPoints: row.halfPoints }))} /> : (!overlay || scene === 'interim') && <div className="show-slide-backdrop" aria-hidden={overlay}><SlideRenderer slide={question} quizTitle="Filmový večer" mode="question" /></div>}
        {overlay && <div key={`${scene}-${generation}-${page}-${ties}-${coWinners}`} className="show-scene">
          {scene === 'interim' ? <>
            <div className="show-dimmer" />
            <section className="show-interim-panel">
              <header className="show-interim-heading"><div><p className="show-eyebrow">PO 3. KOLE</p><h1>Jak si stojíte?</h1></div><Brand /></header>
              <div className="show-table-heading"><span>POŘADÍ</span><span>TÝM</span><span>ZMĚNA</span><span>BODY</span></div>
              <div className="show-ranking-list">{visibleRows.map(row => <RankingRow key={row.id} row={row} movement />)}</div>
              <footer className="show-interim-footer"><span>Průběžné výsledky<span className="show-footer-dot">·</span>Filmový večer</span><span className="show-pages">{Array.from({ length: pages }, (_, index) => <i key={index} className={index === page ? 'active' : ''} />)}<span>{page + 1} / {pages}</span></span></footer>
            </section>
          </> : <>
            <header className="show-stage-header"><span>FILMOVÝ VEČER<span className="show-header-slash">/</span>FINÁLOVÉ VÝSLEDKY</span><Brand /></header>
            {scene === 'finale' ? <div className="show-finale-layout">
              <section className={`show-rank-feature ${featured.length > 1 ? 'multiple' : ''}`} aria-label={`Právě odhaleno ${rank}. místo`}>
                <p className="show-eyebrow">PRÁVĚ ODHALENO</p>
                <div className="show-feature-number">{rank}<span>.</span></div>
                <p className="show-feature-label">{featured.length > 1 ? 'SDÍLENÉ MÍSTO' : 'MÍSTO'}</p>
                <div className="show-feature-teams">{featured.map(row => <h1 key={row.id}>{row.name}</h1>)}</div>
                <p className="show-feature-score"><strong>{points(featured[0]?.halfPoints ?? 0)}</strong> {pointUnit(featured[0]?.halfPoints ?? 0)}</p>
              </section>
              <section className="show-revealed-list"><p className="show-eyebrow">UŽ ZNÁME</p>{lowerRows.length ? <>{lowerRows.map(row => <RankingRow row={row} key={row.id} />)}<p className="show-revealed-page">{lowerRows[0]?.rank}.–{lowerRows.at(-1)?.rank}. místo<span>Strana {activeRevealedPage + 1} / {revealedPageCount}</span></p></> : <p className="show-no-lower">Další výsledky zatím nejsou odhalené.</p>}</section>
            </div> : <section className={`show-winner ${winners.length > 1 ? 'co-winners' : ''}`}>
              <div className="show-winner-label"><span />VÍTĚZOVÉ DNEŠNÍHO VEČERA<span /></div>
              <div className="show-winner-place">1<span>.</span></div>
              <div className="show-winner-names">{winners.map(row => <h1 key={row.id}>{row.name}</h1>)}</div>
              <p className="show-winner-score"><strong>{points(winners[0]?.halfPoints ?? 0)}</strong><span>{pointUnit(winners[0]?.halfPoints ?? 0)}</span></p>
              <p className="show-winner-message">{winners.length > 1 ? 'Jedno první místo. Společné vítězství.' : 'Tenhle večer patří vám.'}</p>
            </section>}
            <footer className="show-stage-footer"><span>{scene === 'winner' ? 'DĚKUJEME, ŽE HRAJETE S NÁMI.' : 'KAŽDÝ BOD MÁ SVŮJ PŘÍBĚH.'}</span><span>{scene === 'winner' ? 'POTLESK VÍTĚZŮM' : 'POSTUPNÉ ODHALOVÁNÍ'}</span></footer>
          </>}
        </div>}
      </main>
      {!capture && <aside className="show-controls" aria-label="Ovládání vizuálního prototypu">
        <div className="show-controls-top"><div><span className="show-control-kicker">MODERÁTORSKÝ PROTOTYP</span><h2>{sceneTitle}</h2></div><span className="show-local-status">Lokální náhled</span></div>
        <div className="show-control-grid">
          <section><h3>Obrazovka</h3><div className="show-button-row">{(['interim', 'finale', 'winner'] as const).map((item, index) => <button key={item} className={scene === item && overlay ? 'selected' : ''} aria-pressed={scene === item && overlay} onClick={() => chooseScene(item)}>{index + 1}. {item === 'interim' ? 'Průběžné' : item === 'finale' ? 'Finále' : 'Vítězové'}</button>)}</div><p>Každá scéna je samostatný návrh k vizuálnímu schválení.</p></section>
          <section><h3>{scene === 'interim' ? 'Stránkování pořadí' : 'Řízené odhalování'}</h3><div className="show-button-row">{scene === 'interim' ? <><button disabled={page === 0 || !overlay} onClick={() => { setPage(value => value - 1); animate(); }}>← Předchozí</button><button disabled={page === pages - 1 || !overlay} onClick={() => { setPage(value => value + 1); animate(); }}>Další strana →</button></> : <><button className="show-primary" disabled={scene === 'winner' || !overlay} onClick={nextRank}>Odhalit další místo</button><button disabled={scene === 'winner' || !overlay} onClick={() => chooseScene('winner')}>Odhalit vítěze</button><button onClick={() => { setScene('finale'); setOverlay(true); setRank(Math.max(...table.map(row => row.rank))); setRevealedPage(0); animate(); }}>Zahájit od posledního</button>{scene === 'finale' && revealedPageCount > 1 && <button onClick={() => { setRevealedPage(value => (value + 1) % revealedPageCount); animate(); }}>Další odhalené týmy ({activeRevealedPage + 1}/{revealedPageCount})</button>}</>}</div><p>{scene === 'interim' ? '6 týmů na stránku. Změna vůči předchozímu potvrzenému zveřejnění.' : 'Remíza se odhalí společně. Vyšší neodhalená místa se nevykreslují.'}</p></section>
          <section><h3>Průběh projekce</h3><div className="show-button-row"><button onClick={() => setSkipped(true)}>Přeskočit animaci</button><button onClick={() => { setOverlay(value => !value); animate(); }}>{overlay ? 'Zpět na stejný slide' : 'Znovu otevřít výsledky'}</button></div><label><input type="checkbox" checked={staticMode} onChange={event => setStaticMode(event.target.checked)} /> Statický režim bez animací</label></section>
          <section><h3>Zátěžové ukázky a zvuk</h3><div className="show-fixture-switches"><label><input type="checkbox" checked={ties} onChange={event => { setTies(event.target.checked); setPage(0); setRank(3); setRevealedPage(0); animate(); }} /> Shoda pořadí 1 / 2 / 2 / 3</label><label><input type="checkbox" checked={coWinners} onChange={event => { setCoWinners(event.target.checked); setRank(3); setRevealedPage(0); animate(); }} /> Společní vítězové</label></div><p className="show-audio-note">Zvuk: nepřipojeno. Tento návrh žádnou hudbu nepřehrává.</p></section>
        </div>
        <p className="show-prototype-note">Pouze syntetická ukázka bez spojení s Firebase. Budoucí produkční klient smí přijmout jen serverem odhalenou podmnožinu výsledků a sanitizovaný aktuální slide. Po schválení návrhu bude následovat implementace.</p>
      </aside>}
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
