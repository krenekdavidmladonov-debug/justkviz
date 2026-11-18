import { usePublicMediaPrefetch } from '../../features/media/usePrivateMediaPrefetch';
import { Brand } from '../../ui/Brand';
import { ShowModeRenderer } from '../../features/show-mode/ShowModeRenderer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import {
  broadcastMediaDiagnostic,
  broadcastPlaybackState,
  openProjectorChannel,
  type ProjectorChannel,
} from '../../features/live/projectorChannel';
import { readPublicLiveStateFromServer, subscribePublicLiveState } from '../../features/live/liveRepository';
import { latencyEnabled, latencyNow, openLatencyChannel } from '../../features/live/liveLatency';
import { projectorFullscreenFailureMessage, requestProjectorFullscreen } from '../../features/live/projectorWindow';
import type { PublicLiveState } from '../../features/live/types';
import { SlideRenderer } from '../../features/presentation/SlideRenderer';
import type { MediaDiagnosticSignal, MediaDiagnosticTarget } from '../../features/presentation/mediaDiagnostics';
import type { LocalMediaTiming } from '../../features/presentation/mediaTiming';
import { LocalProjectorMediaContext } from '../../features/media/LocalProjectorMediaContext';

function ProjectorMessage({ title, text, quizTitle, error = false }: {
  readonly title: string; readonly text?: string; readonly quizTitle?: string; readonly error?: boolean;
}) {
  return (
    <article className={`projector-message-canvas${error ? ' is-error' : ''}`}>
      <div><p className="slide-kicker">{quizTitle ?? <Brand />}</p><h1>{title}</h1>{text && <p>{text}</p>}</div>
    </article>
  );
}

function ProjectorState({ state, onMediaFinished, onMediaPlaybackState, onMediaDiagnostic, onMediaTiming }: {
  readonly state: PublicLiveState;
  readonly onMediaFinished: (generation: number) => void;
  readonly onMediaPlaybackState: (generation: number, state: 'ready' | 'playing' | 'error') => void;
  readonly onMediaDiagnostic: (target: MediaDiagnosticTarget, reason: MediaDiagnosticSignal) => void;
  readonly onMediaTiming?: ((target: MediaDiagnosticTarget, stage: LocalMediaTiming) => void) | undefined;
}) {
  if (state.status === 'waiting') return <ProjectorMessage quizTitle={state.quizTitle} title="Čekáme na první slide" text="Moderátor kvíz připravuje." />;
  if (state.status === 'ended') return <ProjectorMessage quizTitle={state.quizTitle} title="Kvíz skončil" text="Děkujeme za účast." />;
  return (
    <ShowModeRenderer state={state}>
    <SlideRenderer
      mediaSessionId={state.sessionId}
      quizTitle={state.quizTitle}
      mode={state.renderMode}
      mediaCommand={state.mediaCommand}
      mediaPlaybackState={state.mediaPlaybackState}
      mediaGeneration={state.mediaGeneration}
      introGeneration={state.introGeneration}
      onMediaFinished={onMediaFinished}
      onMediaPlaybackState={(generation, playbackState) => onMediaPlaybackState(generation, playbackState)}
      onMediaDiagnostic={onMediaDiagnostic}
      onMediaTiming={onMediaTiming}
      slide={{
        ...(state.mediaPlaybackMode === undefined ? {} : { mediaPlaybackMode: state.mediaPlaybackMode }),
        ...(state.design === undefined ? {} : { design: state.design }),
        ...(state.roundTitle === undefined ? {} : { roundTitle: state.roundTitle }),
        kind: state.slideKind ?? 'legacy', title: state.title ?? '', text: state.text ?? '',
        options: state.options, media: state.media, presentation: state.presentation,
        ...(state.questionNumber === undefined ? {} : { questionNumber: state.questionNumber }),
        ...(state.questionCount === undefined ? {} : { questionCount: state.questionCount }),
        ...(state.backgroundImage === undefined ? {} : { backgroundImage: state.backgroundImage }),
        ...(state.questionImage === undefined ? {} : { questionImage: state.questionImage }),
        ...(state.imageLayout === undefined ? {} : { imageLayout: state.imageLayout }),
        ...(state.answerExplanation === undefined ? {} : { answerExplanation: state.answerExplanation }),
        ...(state.answerImage === undefined ? {} : { answerImage: state.answerImage }),
        ...(state.mediaSource === undefined ? {} : { mediaSource: state.mediaSource }),
        ...(state.backgroundOverlay === undefined ? {} : { backgroundOverlay: state.backgroundOverlay }),
        ...(state.clipStartSeconds === undefined ? {} : { clipStartSeconds: state.clipStartSeconds }),
        ...(state.clipEndSeconds === undefined ? {} : { clipEndSeconds: state.clipEndSeconds }),
        ...(state.revealedAnswer === undefined ? {} : { revealedAnswer: state.revealedAnswer }),
      }}
    />
    </ShowModeRenderer>
  );
}

export function ProjectorPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const measure = latencyEnabled(useLocation().search);
  const [state, setState] = useState<PublicLiveState | null>(null);
  usePublicMediaPrefetch(sessionId, state?.upcomingImages ?? [], state?.status === 'active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullscreenNotice, setFullscreenNotice] = useState<string | null>(null);
  const channelRef = useRef<ProjectorChannel | undefined>(undefined);
  const latencyChannel = useRef<BroadcastChannel | undefined>(undefined);
  const observer = useRef('');
  const accepted = useRef<PublicLiveState | null>(null);

  const emit = useCallback((value: PublicLiveState, stage: 'snapshot' | 'frame' | LocalMediaTiming, target?: MediaDiagnosticTarget) => {
    try {
      latencyChannel.current?.postMessage({
        observer: observer.current, revision: value.revision, generation: value.mediaGeneration,
        stage, at: latencyNow(), ...(target ? { target } : {}),
      });
    } catch { /* Diagnostics cannot interrupt display or playback. */ }
  }, []);

  useEffect(() => {
    if (!measure || !sessionId) return;
    const channel = openLatencyChannel(sessionId);
    latencyChannel.current = channel;
    observer.current = Math.random().toString(36).slice(2);
    return () => { latencyChannel.current = undefined; channel?.close(); };
  }, [measure, sessionId]);

  useEffect(() => {
    if (!sessionId) { setLoading(false); return; }
    let active = true, lastRevision = -1;
    setState(null); setLoading(true); setError(null);
    const channel = openProjectorChannel(sessionId);
    channelRef.current = channel;
    // Inbound channel payloads never authorize presentation, including results.
    // The channel remains available for outbound player lifecycle and media observations.
    const clear = () => {
      if (!active) return;
      accepted.current = null;
      setState(null); setLoading(false); setError('Projektor není připojen; čeká na aktuální serverový stav.');
    };
    let generation = 0;
    let unsubscribe: (() => void) | undefined;
    const accept = (value: PublicLiveState | null) => {
      if (!active || !navigator.onLine || (value && (value.sessionId !== sessionId || value.revision < lastRevision))) return;
      const isNew = value && value.revision > lastRevision;
      if (value) lastRevision = value.revision;
      accepted.current = value;
      if (isNew && latencyChannel.current) emit(value, 'snapshot');
      setState(value); setError(null); setLoading(false);
    };
    const disconnect = () => {
      generation++;
      unsubscribe?.(); unsubscribe = undefined;
      clear();
    };
    const connect = () => {
      const current = ++generation;
      unsubscribe?.(); unsubscribe = undefined;
      // Require a fresh server response on reconnect even when the document did not change.
      void readPublicLiveStateFromServer(sessionId).then(value => {
        if (current === generation) accept(value);
      }, () => {
        if (current === generation) clear();
      }).then(() => {
        if (!active || current !== generation || !navigator.onLine) return;
        // Keep listening after a failed read so Firestore can recover without a browser online event.
        unsubscribe = subscribePublicLiveState(sessionId, next => {
          if (active && current === generation) accept(next);
        }, () => { if (current === generation) clear(); });
      }).catch(() => { if (current === generation) clear(); });
    };
    window.addEventListener('offline', disconnect);
    window.addEventListener('online', connect);
    if (navigator.onLine) connect(); else clear();
    return () => {
      active = false; generation++;
      window.removeEventListener('offline', disconnect);
      window.removeEventListener('online', connect);
      unsubscribe?.(); channel?.close(); channelRef.current = undefined;
      accepted.current = null;
    };
  }, [sessionId, emit]);

  const frameRevision = state?.revision;
  const frameSession = state?.sessionId;
  useEffect(() => {
    if (!measure || frameRevision === undefined || frameSession !== sessionId) return;
    // rAF callbacks run before paint; two frames leave a rendering opportunity in between.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const current = accepted.current;
        if (current?.sessionId === frameSession && current?.revision === frameRevision && document.visibilityState === 'visible') emit(current, 'frame');
      });
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [frameRevision, frameSession, measure, sessionId, emit]);

  const enterFullscreen = useCallback(async () => {
    const opened = await requestProjectorFullscreen();
    setFullscreenNotice(opened ? null : projectorFullscreenFailureMessage);
  }, []);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        void enterFullscreen();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [enterFullscreen]);

  let content;
  if (!sessionId) content = <ProjectorMessage title="Chybí session ID" text="Otevřete odkaz vytvořený v moderátorském panelu." />;
  else if (loading || (state !== null && state.sessionId !== sessionId)) content = <ProjectorMessage title="Načítám projektor…" />;
  else if (error) content = <ProjectorMessage error title="Projektor není připojen" text={error} />;
  else if (!state) content = <ProjectorMessage title="Session nenalezena" text="Zkontrolujte adresu projektoru." />;
  else content = (
    <LocalProjectorMediaContext.Provider value={state}>
    <ProjectorState
      state={state}
      onMediaFinished={(generation) => broadcastPlaybackState(channelRef.current, state.sessionId, generation, 'finished')}
      onMediaPlaybackState={(generation, playbackState) => broadcastPlaybackState(
        channelRef.current, state.sessionId, generation, playbackState,
      )}
      onMediaDiagnostic={(target, reason) => broadcastMediaDiagnostic(
        channelRef.current, state.sessionId, state.mediaGeneration, target, reason,
      )}
      onMediaTiming={measure ? (target, stage) => {
        const current = accepted.current;
        if (current?.sessionId === state.sessionId && current.mediaGeneration === state.mediaGeneration
          && (current.revision === state.revision || target === 'audio' || target === 'video')) emit(current, stage, target);
      } : undefined}
    />
    </LocalProjectorMediaContext.Provider>
  );

  return (
    <main className="projector-shell">
      <div className="projector-viewport">{content}</div>
      {fullscreenNotice && <p className="projector-fullscreen-notice" role="status">{fullscreenNotice}</p>}
      <button className="projector-fullscreen-button" onClick={() => void enterFullscreen()} title="Celá obrazovka (F)">Celá obrazovka · F</button>
    </main>
  );
}
