import { useEffect, useRef, useState, type RefObject } from 'react';
import { httpsCallable } from 'firebase/functions';
import { doc, runTransaction } from 'firebase/firestore';
import { getFirebaseServices } from '../../services/firebase/client';
import { getFirebaseFirestore } from '../../services/firebase/firestore';
import type { ResultsPreview } from '../leaderboard/types';
import type { FinalResponse } from '../final-reveal/types';
import { WinnerMusic } from '../final-reveal/WinnerMusic';
import { FinaleReadinessDialog } from './FinaleReadinessDialog';
import { DemoFinalePreview } from '../final-reveal/DemoFinalePreview';
import { mapLiveControlState } from './liveMappers';
import { useShowCommands, type RevisionedResult } from './ShowCommandContext';
import type { LiveControlSlide, LiveControlState } from './types';
import { entersFinale, nextFinaleStep } from './eventNightFlow';

export interface EventNightNavigation { navigate(direction: 1 | -1): Promise<boolean>; openFinale(): Promise<void> }
interface Props {
  session: LiveControlState;
  slides: readonly LiveControlSlide[];
  navigation: RefObject<EventNightNavigation | null>;
}

/** Each reveal requires an operator gesture. Reloads/other operators never start sound. */
export function EventNightControls({ session, slides, navigation }: Props) {
  const show = useShowCommands();
  const current = useRef(session); current.current = session;
  const mounted = useRef(false), locked = useRef(false);
  const [winnerVersion, setWinnerVersion] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState<ResultsPreview | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const acknowledged = useRef(-1);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const [interimOwner, setInterimOwner] = useState<string | null>(null);
  const final = session.finalReveal;
  const busy = pending || show?.busy === true;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; navigation.current = null; };
  }, [navigation]);
  useEffect(() => {
    if (session.status === 'ended' || !final?.visible) setWinnerVersion(null);
  }, [session.status, final?.visible]);
  useEffect(() => {
    if (winnerVersion && !pending && !locked.current && session.revision > acknowledged.current) setWinnerVersion(null);
  }, [session.revision, winnerVersion, pending]);

  async function perform(work: () => Promise<void>, failureMessage = 'Výsledky se nepodařilo potvrdit. Zkontrolujte spojení a zkuste tlačítko znovu.'): Promise<boolean> {
    if (locked.current || show?.busy) return false;
    locked.current = true; setPending(true); setError('');
    try { await work(); return true; }
    catch (cause) {
      setInterimOwner(null); setWinnerVersion(null);
      if (mounted.current) setError(cause instanceof Error && cause.message.startsWith('Finále:') ? cause.message
        : (cause as { code?: string })?.code === 'functions/failed-precondition' ? 'Výsledky zatím nejsou připravené. Zkontrolujte uložené body rozhodčího.'
          : failureMessage);
      return false;
    } finally { locked.current = false; if (mounted.current) setPending(false); }
  }
  async function interim(action: 'current' | 'hide' | 'page', page?: number) {
    if (!show) return;
    await perform(async () => {
      show.stopAudio();
      const result = await show.execute((latest, revision) => httpsCallable<unknown, RevisionedResult>(getFirebaseServices().functions, 'controlInterimResults')({
        eventId: latest.eventId, sessionId: latest.sessionId, expectedRevision: revision,
        requestId: crypto.randomUUID(), action, ...(page === undefined ? {} : { page }),
      }).then(response => response.data));
      acknowledged.current = result.revision;
      setInterimOwner(action === 'hide' ? null : session.sessionId);
    }, action === 'page' ? 'Stránku průběžných výsledků se nepodařilo přepnout. Zkontrolujte spojení, zavřete výsledky a znovu je otevřete.' : undefined);
  }
  async function finalCommand(action: 'hide' | 'page' | 'reveal' | 'table', page?: number) {
    if (!show) return false;
    return perform(async () => {
      const result = await show.execute((latest, revision) => httpsCallable<unknown, FinalResponse>(getFirebaseServices().functions, 'controlFinalReveal')({
        eventId: latest.eventId, sessionId: latest.sessionId, expectedRevision: revision,
        requestId: crypto.randomUUID(), versionId: latest.finalReveal?.versionId ?? null, action,
        ...(action === 'reveal' ? { motion: 'animate' } : {}),
        ...(page === undefined ? {} : { page }),
      }).then(response => response.data));
      acknowledged.current = result.revision;
      if (action === 'hide') setWinnerVersion(null);
      if (result.winnerRevealed && !result.replayed && mounted.current) {
        const db = getFirebaseFirestore();
        const snapshot = await runTransaction(db, tx => tx.get(doc(db, 'sessions', session.sessionId)));
        const fresh = snapshot.exists() ? mapLiveControlState(snapshot.id, snapshot.data()) : null;
        if (fresh?.revision === result.revision && fresh.finalReveal?.visible && fresh.finalReveal.versionId === result.versionId) {
          if (mounted.current && navigator.onLine && current.current.sessionId === session.sessionId
            && current.current.status === 'active' && current.current.finalReveal?.visible === true
            && current.current.finalReveal.versionId === result.versionId && current.current.revision <= result.revision) setWinnerVersion(result.versionId);
        }
      }
    });
  }
  async function beginFinale() {
    if (!show) return;
    setIncomplete(null);
    setWinnerVersion(null);
    await perform(async () => {
      show.stopAudio();
      const preview = (await httpsCallable<unknown, ResultsPreview>(getFirebaseServices().functions, 'previewFinalResults')({ eventId: session.eventId, sessionId: session.sessionId })).data;
      if (!preview.complete) { setIncomplete(preview); return; }
      const result = await show.execute(() => httpsCallable<unknown, FinalResponse>(getFirebaseServices().functions, 'controlFinalReveal')({
        eventId: session.eventId, sessionId: session.sessionId, expectedRevision: preview.sessionRevision,
        requestId: crypto.randomUUID(), versionId: preview.publishedVersionId, sourceFingerprint: preview.sourceFingerprint,
        action: preview.publishedVersionId ? 'replace' : 'start', presentationStyle: 'show', motion: 'animate',
      }).then(response => response.data));
      acknowledged.current = result.revision; setInterimOwner(null);
    });
  }

  // Kept current without publishing any state from an effect.
  useEffect(() => {
    navigation.current = { openFinale: beginFinale, async navigate(direction) {
      if (session.interimResults) return true;
      if (session.finalReveal?.visible) {
        if (direction === 1 && session.finalReveal.mode !== 'table') {
          const step = nextFinaleStep(session.finalReveal);
          if (step) await finalCommand(step.action, step.page);
          return true;
        }
        if (direction === 1) {
          // A finale selected from the question list still leads to the closing
          // slide, never back into an arbitrary question beneath the show.
          await perform(async () => {
            if (!show) return;
            setWinnerVersion(null); show.stopAudio();
            const closing = [...slides].reverse().find(slide => slide.kind.toLowerCase() === 'end' && !slide.hidden);
            await show.execute((latest, revision) => httpsCallable<unknown, RevisionedResult>(getFirebaseServices().functions, closing ? 'goToSlide' : 'endLiveSession')({
              sessionId: latest.sessionId, expectedRevision: revision,
              ...(closing ? { position: closing.position } : {}),
            }).then(response => response.data));
          });
          return true;
        }
        const hidden = await finalCommand('hide');
        // Going back leaves the virtual finale on the last question/recap.
        const atEnd = slides.find(slide => slide.position === session.currentSlidePosition)?.kind.toLowerCase() === 'end';
        return !hidden || !atEnd;
      }
      if (entersFinale(slides, session.currentSlidePosition, direction)) { await beginFinale(); return true; }
      return false;
    } };
  });

  // Polling replaces session/slide objects and the command coordinator. Only an
  // actual publication change should restart the page's seven-second interval.
  const interimCommand = useRef(interim); interimCommand.current = interim;
  const interimVersion = session.interimResults?.versionId;
  const interimPage = session.interimResults?.page;
  const interimPageCount = session.interimResults?.pageCount;
  const canControlInterim = show !== null;
  useEffect(() => {
    if (interimOwner !== session.sessionId || !canControlInterim || busy || session.status !== 'active'
      || interimPage === undefined || interimPageCount === undefined || interimPageCount < 2
      || session.revision !== acknowledged.current) return;
    const timer = window.setTimeout(() => { void interimCommand.current('page', (interimPage + 1) % interimPageCount); }, 7000);
    return () => window.clearTimeout(timer);
  }, [interimOwner, canControlInterim, busy, session.sessionId, session.status, session.revision, interimVersion, interimPage, interimPageCount]);
  useEffect(() => {
    if (!session.interimResults) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); void interim('hide'); } };
    document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close);
  });

  return <section className="event-night-controls" aria-label="Výsledky akce">
    <button type="button" className={session.interimResults ? 'primary-button' : 'secondary-button'} disabled={busy || session.status !== 'active' || final?.visible === true}
      aria-pressed={Boolean(session.interimResults)} onClick={() => void interim(session.interimResults ? 'hide' : 'current')}>
      {session.interimResults ? 'Zavřít průběžné výsledky' : 'Průběžné výsledky'}
    </button>
    <button type="button" className="secondary-button" disabled={busy || final?.visible === true || Boolean(session.interimResults)} onClick={() => setDemoOpen(true)}>Náhled závěrečné show</button>
    {final?.visible && <div className="event-finale-status"><strong>{final.mode === 'table' ? 'Konečné pořadí' : 'Finální vyhlášení'}</strong>
      {(final.mode !== 'table' || final.pageCount > 1) && <button type="button" className="primary-button" disabled={busy || session.status !== 'active'} onClick={() => {
        const step = nextFinaleStep(final);
        if (step) void finalCommand(step.action, step.page);
      }}>{final.mode === 'table' || final.page + 1 < final.pageCount ? 'Další strana výsledků' : final.revealedCount >= final.totalGroups ? 'Zobrazit konečné pořadí' : 'Odhalit další místo'}</button>}
      {final.mode === 'table' && <span>Další → závěr kvízu</span>}
    </div>}
    {winnerVersion && final?.visible && final.versionId === winnerVersion && session.status === 'active' && <WinnerMusic key={winnerVersion} />}
    {error && <p role="alert">{error}</p>}
    {incomplete && session.eventId && <FinaleReadinessDialog preview={incomplete} eventId={session.eventId} onClose={() => setIncomplete(null)} onRetry={() => void beginFinale()} onPreview={() => { setIncomplete(null); setDemoOpen(true); }} />}
    {demoOpen && <DemoFinalePreview onClose={() => setDemoOpen(false)} />}
  </section>;
}
