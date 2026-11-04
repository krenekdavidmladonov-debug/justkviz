import { useEffect, useMemo, useRef, useState } from 'react';
import type { FinalRevealPage, PublicResultRow, ShowCue } from '@filmovy-kviz/quiz-domain';

import { ShowModeRenderer } from '../show-mode/ShowModeRenderer';
import type { PublicLiveState } from '../live/types';
import { WinnerMusic } from './WinnerMusic';
import './demo-finale-preview.css';

const sampleRows: PublicResultRow[] = [
  { rank: 1, teamName: 'Filmoví nadšenci', halfPoints: 151 },
  { rank: 2, teamName: 'Popcornový tým', halfPoints: 146 },
  { rank: 3, teamName: 'Střihači snů', halfPoints: 138 },
  { rank: 4, teamName: 'Poslední klapka', halfPoints: 129 },
  { rank: 5, teamName: 'Tým z titulků', halfPoints: 120 },
  { rank: 6, teamName: 'Noční projekce', halfPoints: 113 },
];
const pages: FinalRevealPage[] = [
  { versionId: 'demo-finale', presentationStyle: 'show', pageSize: 6, mode: 'intro', rank: null, page: 0, pageCount: 1, groupSize: 0, rows: [] },
  ...[...sampleRows].reverse().map(row => ({
    versionId: 'demo-finale', presentationStyle: 'show' as const, pageSize: 6 as const, mode: 'group' as const,
    rank: row.rank, page: 0, pageCount: 1, groupSize: 1, rows: [row],
    ...(row.rank < sampleRows.length ? { history: { page: 0, pageCount: 1, pageSize: 6 as const, rows: sampleRows.filter(previous => previous.rank > row.rank) } } : {}),
  })),
  { versionId: 'demo-finale', presentationStyle: 'show', pageSize: 6, mode: 'table', rank: null, page: 0, pageCount: 1, groupSize: 0, rows: sampleRows },
];

function cueFor(index: number, revision: number): ShowCue {
  const page = pages[index]!;
  return {
    id: revision.toString(16).padStart(64, '0'),
    kind: page.mode === 'intro' ? 'final-intro' : page.rank === 1 ? 'winners' : page.rank === 2 ? 'second' : page.rank === 3 ? 'third' : 'reveal',
    motion: 'animate', intensity: 'show', topThree: true, winnerAnimation: true,
    startedAt: Date.now(), durationMs: page.rank === 1 ? 6000 : 3500,
  };
}

/** Entirely local sample presentation. This component has no event, session, API or channel input. */
export function DemoFinalePreview({ onClose }: { readonly onClose: () => void }) {
  const modal = useRef<HTMLDialogElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const [frame, setFrame] = useState<{ index: number; revision: number; cue?: ShowCue }>({ index: -1, revision: 0 });
  const [musicEnabled, setMusicEnabled] = useState(false);
  const page = pages[frame.index];
  const finished = frame.index === pages.length - 1;

  useEffect(() => {
    const dialog = modal.current, opener = document.activeElement;
    dialog?.showModal(); closeButton.current?.focus();
    return () => { dialog?.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true }); };
  }, []);

  function show(index: number) {
    setFrame(previous => {
      const revision = previous.revision + 1;
      return { index, revision, cue: cueFor(index, revision) };
    });
  }

  useEffect(() => {
    // Prime the mounted renderer once so the intro receives a fresh animation cue.
    // Further reveals are exclusively operator clicks.
    const timer = window.setTimeout(() => {
      setFrame(previous => {
        if (previous.index !== -1) return previous;
        const revision = previous.revision + 1;
        return { index: 0, revision, cue: cueFor(0, revision) };
      });
    }, 50);
    return () => window.clearTimeout(timer);
  }, []);

  const state = useMemo<PublicLiveState>(() => ({
    sessionId: 'demo-finale-preview', quizTitle: 'Ukázkový filmový večer', status: 'active', slidePosition: 0,
    options: [], media: [], presentation: {}, presentationMode: 'slide', renderMode: 'end',
    mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 0, introGeneration: 0, answerRevealed: false,
    revision: frame.revision, ...(page ? { finalReveal: page } : {}), ...(frame.cue ? { showCue: frame.cue } : {}),
  }), [frame, page]);

  function closePreview() { setMusicEnabled(false); onClose(); }

  return <dialog ref={modal} className="demo-finale-preview" aria-labelledby="demo-finale-title" onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); closePreview(); }}>
    <header className="demo-finale-heading"><div><span className="demo-finale-badge">NÁHLED · UKÁZKOVÉ ÚDAJE</span><h2 id="demo-finale-title">Ukázka finální show</h2></div><button ref={closeButton} type="button" className="secondary-button" onClick={closePreview}>Zavřít náhled</button></header>
    <p className="demo-finale-help">Vymyšlené týmy a body. Každé další místo odhalíte tlačítkem Další krok. Náhled nemění skutečné výsledky ani projektor.</p>
    <div className="demo-finale-stage"><ShowModeRenderer state={state}><div className="demo-finale-loading">Připravuji ukázku…</div></ShowModeRenderer></div>
    <div className="demo-finale-toolbar">
      <p role="status" aria-live="polite">{page?.mode === 'intro' ? 'Úvod vyhlášení' : page?.mode === 'table' ? 'Konečné ukázkové pořadí' : page ? `${page.rank}. místo` : 'Připravuji ukázku'} · {Math.max(1, frame.index + 1)} / {pages.length}</p>
      <div className="demo-finale-actions">
        <button type="button" className="primary-button" disabled={finished || !page} onClick={() => show(Math.min(frame.index + 1, pages.length - 1))}>Další krok</button>
        <button type="button" className="secondary-button" onClick={() => show(0)}>Přehrát znovu</button>
      </div>
    </div>
    <label className="demo-finale-music"><input type="checkbox" checked={musicEnabled} onChange={event => setMusicEnabled(event.target.checked)} /> Přehrát hudbu vítězům (YouTube)</label>
    {musicEnabled && (page?.rank === 1 || page?.mode === 'table') && <WinnerMusic />}
  </dialog>;
}
