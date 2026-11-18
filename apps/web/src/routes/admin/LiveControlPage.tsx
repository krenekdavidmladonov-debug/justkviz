import { warmEventFunctionsOnce } from '../../features/events/eventWarmup';
import { EventNightControls, type EventNightNavigation } from '../../features/live/EventNightControls';
import { visibleSlidePosition } from '@filmovy-kviz/quiz-domain';
import { FirebaseError } from 'firebase/app';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { doc, runTransaction } from 'firebase/firestore';
import { Link, useLocation, useParams } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { SnapshotMediaContext } from '../../features/media/SnapshotMediaContext';
import {
  endLiveSession,
  goToSlide,
  revealAnswer,
  hideAnswer,
  nextSlide,
  playMedia,
  previousSlide,
  reportMediaPlayback,
  replayMedia,
  selectRecapQuestion,
  stopMedia,
} from '../../features/live/liveApi';
import { LiveModeratorView, type LivePendingAction } from '../../features/live/LiveModeratorView';
import { LiveDiagnostics, LiveMediaAlerts, type LiveDiagnosticObservation } from '../../features/live/LiveDiagnostics';
import { LiveLatencyDetails } from '../../features/live/LiveLatencyDetails';
import { LocalMediaBackupControl } from '../../features/live/LocalMediaBackupControl';
import { localEventMediaAvailable } from '../../features/events/localEventMediaApi';
import { LiveLatencyCapture, latencyEnabled, latencyNow, openLatencyChannel, type LatencyAction, type LatencyTrace } from '../../features/live/liveLatency';
import { LiveMutationQueue } from '../../features/live/mutationQueue';
import { isAudioSlide, recapQuestionChoices } from '../../features/live/livePresentation';
import { broadcastPublicState, openProjectorChannel, parseProjectorChannelMessage, type ProjectorChannel } from '../../features/live/projectorChannel';
import { openOrFocusProjector, projectorPopupBlockedMessage } from '../../features/live/projectorWindow';
import { subscribeLiveControl, subscribeLiveControlSlides, subscribePublicLiveState } from '../../features/live/liveRepository';
import type { LiveActionResponse, LiveControlSlide, LiveControlState, PublicLiveState } from '../../features/live/types';
import { indexSlidesByPosition } from '../../features/presentation/performance';
import type { MediaDiagnosticSignal, MediaDiagnosticTarget } from '../../features/presentation/mediaDiagnostics';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import { HumanError, type HumanErrorValue } from '../../ui/HumanError';
import { ShowCommandContext, type RevisionedResult, type ShowAudioCue } from '../../features/live/ShowCommandContext';
import type { ShowAudioController } from '../../features/show-audio/controller';
import { getFirebaseFirestore } from '../../services/firebase/firestore';
import { mapLiveControlState } from '../../features/live/liveMappers';
import '../../features/live/show-control.css';

type PendingObservation = Omit<LiveDiagnosticObservation, 'position' | 'reason'> & { reason: MediaDiagnosticSignal };
const observationLimit = 6;

function technicalErrorCode(error: FirebaseError): string {
  return error.code.toUpperCase().replaceAll('/', '_').replaceAll('-', '_');
}

function operationError(error: unknown): HumanErrorValue {
  if (error instanceof FirebaseError && error.code === 'functions/aborted') {
    return {
      title: 'Stav se mezitím změnil',
      message: 'Načetli jsme aktuální stav. Zkontrolujte projektor a akci případně zopakujte.',
      technicalCode: technicalErrorCode(error),
    };
  }
  if (error instanceof FirebaseError && error.code === 'functions/failed-precondition') {
    return {
      title: 'Tuto akci teď nelze provést',
      message: 'Projektor zůstal na posledním potvrzeném obsahu.',
      technicalCode: technicalErrorCode(error),
    };
  }
  if (error instanceof FirebaseError && ['functions/permission-denied', 'functions/unauthenticated'].includes(error.code)) {
    return {
      title: 'Server odmítl oprávnění k akci',
      message: 'Zkontrolujte přihlášení a oprávnění k moderování tohoto kvízu.',
      technicalCode: technicalErrorCode(error),
    };
  }
  if (error instanceof FirebaseError && ['functions/unavailable', 'functions/deadline-exceeded'].includes(error.code)) {
    return {
      title: 'Server akci nepotvrdil včas',
      message: 'Otestujte připojení v technické diagnostice a před opakováním zkontrolujte stav projekce.',
      technicalCode: technicalErrorCode(error),
    };
  }
  return {
    title: 'Akci se nepodařilo dokončit',
    message: 'Zkontrolujte stav projekce a případně akci zopakujte.',
    technicalCode: error instanceof FirebaseError ? technicalErrorCode(error) : 'LIVE_ACTION_FAILED',
  };
}

function loadingError(area: 'session' | 'slides'): HumanErrorValue {
  return area === 'session'
    ? { title: 'Moderování nelze načíst', message: 'Vraťte se na detail kvízu a zkuste ho spustit znovu.', technicalCode: 'LIVE_SESSION_LOAD_FAILED' }
    : { title: 'Obsah kvízu nelze načíst', message: 'Projektor zůstal na posledním potvrzeném obsahu.', technicalCode: 'LIVE_SLIDES_LOAD_FAILED' };
}

export function LiveControlPage() {
  useEffect(() => { void warmEventFunctionsOnce().catch(() => undefined); }, []);
  const { sessionId } = useParams<{ sessionId: string }>();
  const routeSearch = useLocation().search;
  return <LiveSessionControl key={sessionId} sessionId={sessionId} routeSearch={routeSearch} />;
}

function LiveSessionControl({ sessionId, routeSearch }: { readonly sessionId: string | undefined; readonly routeSearch: string }) {
  const { can } = useAuth();
  const measure = latencyEnabled(routeSearch);
  const [latencyTrace, setLatencyTrace] = useState<LatencyTrace>();
  const latency = useMemo(() => new LiveLatencyCapture(setLatencyTrace), [sessionId]);
  const [session, setSession] = useState<LiveControlState | null>(null);
  const [publicState, setPublicState] = useState<PublicLiveState | null>(null);
  const [publicReadFailed, setPublicReadFailed] = useState(false);
  const [mediaObservations, setMediaObservations] = useState<readonly LiveDiagnosticObservation[]>([]);
  const [activeMediaObservations, setActiveMediaObservations] = useState<readonly LiveDiagnosticObservation[]>([]);
  const pendingMediaObservations = useRef<readonly PendingObservation[]>([]);
  const [slides, setSlides] = useState<readonly LiveControlSlide[]>([]);
  const [loadedSlideSource, setLoadedSlideSource] = useState<string | null>(null);
  const [slideReadAttempt, setSlideReadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<LivePendingAction | null>(null);
  const [error, setError] = useState<HumanErrorValue | null>(null);
  const [projectorOpened, setProjectorOpened] = useState(false);
  const showEnabled = true;
  const eventNavigation = useRef<EventNightNavigation | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const [audioSuppressed, setAudioSuppressed] = useState(false);
  const suppressedAudioGeneration = useRef<{ sessionId: string; generation: number } | null>(null);
  const questionAudioPending = useRef(false);
  const audioController = useRef<ShowAudioController | null>(null);
  const audioRevision = useRef<number | null>(null);
  const remoteMediaActive = useRef(false);
  const automaticAudioPreparedAt = useRef(0);
  const sessionRef = useRef<LiveControlState | null>(null);
  const mounted = useRef(false);
  const navigationInFlight = useRef(false);
  const channelRef = useRef<ProjectorChannel | undefined>(undefined);
  const operationIdRef = useRef(0);
  const confirmedRevisionRef = useRef(-1);
  const mutationQueueRef = useRef(new LiveMutationQueue());
  const accessGenerationRef = useRef(0);
  const slideSource = session ? JSON.stringify([session.sessionId, session.quizId, session.snapshotId ?? null]) : null;
  const slidesReady = slideSource !== null && loadedSlideSource === slideSource;

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function isCurrentSession(generation = accessGenerationRef.current) {
    return sessionId !== undefined && mounted.current && generation === accessGenerationRef.current
      && sessionRef.current?.sessionId === sessionId;
  }

  useEffect(() => {
    const generation = ++accessGenerationRef.current;
    const invalidate = () => {
      audioController.current?.stopImmediate(); audioRevision.current = null;
      suppressedAudioGeneration.current = null; questionAudioPending.current = false;
      accessGenerationRef.current++; operationIdRef.current++; sessionRef.current = null;
      confirmedRevisionRef.current = -1; mutationQueueRef.current = new LiveMutationQueue();
      navigationInFlight.current = false;
      setQueueCount(0);
      setPublicState(null);
      setMediaObservations([]);
      setActiveMediaObservations([]);
      pendingMediaObservations.current = [];
      latency.clear();
    };
    confirmedRevisionRef.current = -1;
    mutationQueueRef.current = new LiveMutationQueue();
    sessionRef.current = null; setSession(null); setSlides([]); setPendingAction(null); setError(null); setLoading(true);
    if (!sessionId) { setLoading(false); return; }
    const unsubscribe = subscribeLiveControl(sessionId, (value) => {
      if (generation !== accessGenerationRef.current) return;
      const previousGeneration = sessionRef.current?.mediaGeneration;
      sessionRef.current = value;
      const suppressed = suppressedAudioGeneration.current;
      if (!value || suppressed?.sessionId !== value.sessionId || suppressed.generation !== value.mediaGeneration) {
        suppressedAudioGeneration.current = null; setAudioSuppressed(false);
        if (value && ['preparing', 'playing', 'ready'].includes(value.mediaPlaybackState)) stopShowAudio();
      }
      if (value) {
        confirmedRevisionRef.current = Math.max(confirmedRevisionRef.current, value.revision);
        if (value.mediaGeneration !== previousGeneration) setActiveMediaObservations([]);
        const recent = pendingMediaObservations.current.filter(item => Date.now() - item.observedAt <= 3000);
        pendingMediaObservations.current = recent.filter(item => item.mediaGeneration > value.mediaGeneration);
        for (const item of recent.reverse()) recordMediaObservation(item);
      } else { invalidate(); setSlides([]); setPendingAction(null); }
      setSession(value);
      setLoading(false);
    }, () => {
      if (generation !== accessGenerationRef.current) return;
      invalidate(); setSession(null); setSlides([]); setPendingAction(null);
      setError(loadingError('session')); setLoading(false);
    });
    return () => { invalidate(); unsubscribe(); };
  }, [sessionId, latency]);

  useEffect(() => {
    if (!measure || !sessionId) return;
    const channel = openLatencyChannel(sessionId);
    if (channel) channel.onmessage = ({ data }) => latency.receive(data);
    return () => { channel?.close(); latency.clear(); };
  }, [sessionId, measure, latency]);

  useEffect(() => {
    setSlides([]); setLoadedSlideSource(null);
    if (!session?.quizId) return;
    let active = true;
    const source = JSON.stringify([session.sessionId, session.quizId, session.snapshotId ?? null]);
    const unsubscribe = subscribeLiveControlSlides(session.quizId, value => {
      if (!active) return;
      setSlides(value); setLoadedSlideSource(source);
    }, () => {
      if (!active) return;
      setSlides([]); setLoadedSlideSource(null); setError(loadingError('slides'));
    }, session.snapshotId);
    return () => { active = false; unsubscribe(); };
  }, [session?.sessionId, session?.quizId, session?.snapshotId, slideReadAttempt]);

  useEffect(() => {
    if (!sessionId) return;
    setPublicReadFailed(false);
    const channel = openProjectorChannel(sessionId);
    channelRef.current = channel;
    if (channel) {
      channel.setMessageHandler((data) => {
        const message = parseProjectorChannelMessage(data);
        if (message?.type === 'media-diagnostic') {
          if (message.sessionId === sessionId) receiveMediaObservation('projector', message.mediaGeneration, message.target, message.reason);
          return;
        }
        if (message?.type !== 'playback-state') return;
        const current = sessionRef.current;
        if (!current || message.sessionId !== current.sessionId
          || message.mediaGeneration !== current.mediaGeneration) return;
        if (message.playbackState === 'error') {
          setError({
            title: 'Médium se na projektoru nepřehrálo',
            message: 'Otázka zůstala zobrazená. Můžete přehrávání pustit znovu.',
            technicalCode: 'PROJECTOR_MEDIA_PLAYBACK_FAILED',
          });
        }
        void enqueuePlaybackReport(message.mediaGeneration, message.playbackState).catch((playbackError) => {
          if (message.playbackState === 'error') setError(operationError(playbackError));
        });
      });
    }
    const unsubscribe = subscribePublicLiveState(sessionId, (value) => {
      setPublicReadFailed(false);
      setPublicState(value);
      if (value) broadcastPublicState(channel, value);
    }, () => { setPublicReadFailed(true); setPublicState(null); });
    return () => { unsubscribe(); channel?.close(); channelRef.current = undefined; };
  }, [sessionId]);

  function receiveMediaObservation(
    device: LiveDiagnosticObservation['device'],
    mediaGeneration: number,
    target: MediaDiagnosticTarget,
    reason: MediaDiagnosticSignal,
  ) {
    const current = sessionRef.current;
    if (!current || current.sessionId !== sessionId) return;
    const observation = { device, mediaGeneration, target, reason, observedAt: Date.now() };
    if (mediaGeneration > current.mediaGeneration) {
      // Public state can reach the projector or preview before the private listener.
      pendingMediaObservations.current = [observation, ...pendingMediaObservations.current].slice(0, observationLimit);
    } else recordMediaObservation(observation);
  }

  function recordMediaObservation({ device, mediaGeneration, target, reason, observedAt }: PendingObservation) {
    const current = sessionRef.current;
    if (!current || current.sessionId !== sessionId || current.status !== 'active' || current.mediaGeneration !== mediaGeneration
      || current.interimResults || current.finalReveal?.visible || (target === 'answer-image' && !current.answerRevealed)) return;
    const matchesTarget = (item: LiveDiagnosticObservation) => item.device === device && item.target === target
      && item.mediaGeneration === mediaGeneration;
    if (reason === 'recovered') {
      setActiveMediaObservations(previous => previous.some(matchesTarget)
        ? previous.filter(item => !matchesTarget(item)) : previous);
      return;
    }
    const position = current.recapQuestionPosition ?? current.currentSlidePosition;
    const observation = { device, target, reason, position, mediaGeneration, observedAt };
    setActiveMediaObservations(previous => previous.some(item => matchesTarget(item) && item.reason === reason)
      ? previous : [observation, ...previous.filter(item => !matchesTarget(item))]);
    setMediaObservations(previous => previous.some(item => matchesTarget(item) && item.reason === reason)
      ? previous : [observation, ...previous].slice(0, observationLimit));
  }

  const slideIndex = useMemo(() => indexSlidesByPosition(slides), [slides]);
  const currentSlide = session ? slideIndex.get(session.currentSlidePosition) : undefined;
  const presentedSlide = useMemo(() => (
    session?.presentationMode === 'recap' && session.recapQuestionPosition
      ? slideIndex.get(session.recapQuestionPosition)
      : currentSlide
  ), [currentSlide, session?.presentationMode, session?.recapQuestionPosition, slideIndex]);
  const recap = useMemo(() => currentSlide?.kind.toLowerCase() === 'recap'
    ? recapQuestionChoices(currentSlide, slides) : [], [currentSlide, slides]);
  const projectorUrl = useMemo(() => sessionId
    ? `${window.location.origin}/projector/${encodeURIComponent(sessionId)}?${new URLSearchParams({...(measure?{latency:'1'}:{}),...(new URLSearchParams(routeSearch).get('backupPilot')==='1'?{backupPilot:'1'}:{imageBackup:'3'})})}`
    : '', [sessionId, measure, routeSearch]);

  useEffect(() => {
    if (audioRevision.current !== null && session?.revision !== audioRevision.current) stopShowAudio();
    if (session?.status === 'ended') stopShowAudio();
  }, [session?.revision, session?.status]);

  function stopShowAudio() { audioController.current?.stopImmediate(); audioRevision.current = null; }
  function prepareShowAudio() {
    automaticAudioPreparedAt.current = performance.now();
    const current = sessionRef.current;
    // A server stop does not acknowledge a remote projector's physical video output.
    remoteMediaActive.current = Boolean(current && ['playing', 'preparing', 'ready'].includes(current.mediaPlaybackState)
      && (!isAudioSlide(presentedSlide) || current.presentationMode === 'recap'));
    suppressedAudioGeneration.current = current && !remoteMediaActive.current
      ? { sessionId: current.sessionId, generation: current.mediaGeneration } : null;
    setAudioSuppressed(true);
    return audioController.current?.prepareGesture() ?? -1;
  }
  async function playShowAudio(cue: ShowAudioCue, result: RevisionedResult, ticket: number) {
    const controller = audioController.current, generation = accessGenerationRef.current;
    const deadline = automaticAudioPreparedAt.current + 3000;
    if (!controller || result.replayed || ticket < 0 || remoteMediaActive.current || !sessionId) return;
    try {
      const db = getFirebaseFirestore();
      const snapshot = await runTransaction(db, transaction => transaction.get(doc(db, 'sessions', sessionId)));
      const fresh = snapshot.exists() ? mapLiveControlState(snapshot.id, snapshot.data()) : null;
      const valid = () => generation === accessGenerationRef.current && controller === audioController.current
        && performance.now() <= deadline && navigator.onLine && sessionRef.current?.sessionId === sessionId
        && sessionRef.current.revision <= result.revision;
      if (!valid() || fresh?.revision !== result.revision || fresh.status !== 'active'
        || (cue !== 'intro' && (!result.showCue || fresh.showCue?.id !== result.showCue.id))
        || (cue === 'interim' ? !fresh.interimResults : cue !== 'intro' && !fresh.finalReveal?.visible)
        || (result.versionId && result.versionId !== (cue === 'interim' ? fresh.interimResults?.versionId : fresh.finalReveal?.versionId))) return;
      audioRevision.current = result.revision;
      await controller.playCue(cue, ticket, valid);
    } catch { /* Visual publication succeeded. Manual audio remains available after reconnect. */ }
  }

  function enqueueMutation<T extends { revision: number } | undefined>(
    action: (current: LiveControlState) => Promise<T>,
  ): Promise<T> {
    const generation = accessGenerationRef.current;
    if (!isCurrentSession(generation)) return Promise.reject(new Error('Přístup se změnil.'));
    setQueueCount(count => count + 1);
    const execute = mutationQueueRef.current.enqueueCommand(async () => {
      if (!isCurrentSession(generation)) throw new Error('Přístup se změnil.');
      const current = sessionRef.current;
      if (!current) throw new Error('Session není dostupná.');
      const result = await action(current);
      if (result && isCurrentSession(generation)) confirmedRevisionRef.current = Math.max(confirmedRevisionRef.current, result.revision);
      return result;
    });
    return execute.finally(() => { if (isCurrentSession(generation)) setQueueCount(count => Math.max(0, count - 1)); });
  }

  function enqueuePlaybackReport(mediaGeneration: number, playbackState: 'ready' | 'playing' | 'error' | 'finished') {
    const accessGeneration = accessGenerationRef.current;
    const sessionId = sessionRef.current?.sessionId;
    return mutationQueueRef.current.enqueueReport(`${sessionId}:${mediaGeneration}`, async () => {
      const latest = sessionRef.current;
      if (!isCurrentSession(accessGeneration) || !latest || latest.sessionId !== sessionId
        || latest.status !== 'active' || latest.mediaGeneration !== mediaGeneration
        || !['play', 'replay'].includes(latest.mediaCommand) || latest.mediaPlaybackState === playbackState) return undefined;
      const result = await reportMediaPlayback(latest.sessionId, mediaGeneration, playbackState);
      if (isCurrentSession(accessGeneration)) confirmedRevisionRef.current = Math.max(confirmedRevisionRef.current, result.revision);
      return result;
    });
  }

  async function run(
    action: (id: string, revision: number) => Promise<LiveActionResponse>,
    actionName: LivePendingAction,
    acceptedAt?: number,
  ) {
    const generation = accessGenerationRef.current;
    if (!sessionId || !isCurrentSession(generation)) return;
    const measuredActions: readonly LivePendingAction[] = ['next', 'previous', 'jump', 'recap', 'play', 'replay'];
    const traceId = measure && measuredActions.includes(actionName) ? latency.begin(actionName as LatencyAction, acceptedAt) : undefined;
    stopShowAudio();
    if (actionName === 'play' || actionName === 'replay') {
      questionAudioPending.current = true; suppressedAudioGeneration.current = null; setAudioSuppressed(false);
    }
    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    setPendingAction(actionName);
    setError(null);
    try {
      const result = await enqueueMutation((latest) => {
        if (traceId !== undefined) latency.dispatch(traceId);
        return action(latest.sessionId, Math.max(latest.revision, confirmedRevisionRef.current));
      });
      if (traceId !== undefined) latency.settle(traceId, result);
    } catch (actionError) {
      if (traceId !== undefined) latency.settle(traceId);
      if (isCurrentSession(generation) && operationIdRef.current === operationId) setError(operationError(actionError));
    } finally {
      if (isCurrentSession(generation) && operationIdRef.current === operationId) { questionAudioPending.current = false; setPendingAction(null); }
    }
  }

  function endQuiz(id: string, revision: number) {
    return endLiveSession(id, revision);
  }

  async function reportPlayback(
    generation: number,
    playbackState: 'ready' | 'playing' | 'error' | 'finished',
  ) {
    const current = sessionRef.current;
    if (!current || current.mediaGeneration !== generation) return;
    if (playbackState === 'error') {
      setError({
        title: 'Audio se na tomto zařízení nepřehrálo',
        message: 'Podrobnosti najdete v technické diagnostice. Přehrávání můžete spustit znovu.',
        technicalCode: 'MODERATOR_AUDIO_PLAYBACK_FAILED',
      });
    }
    try {
      await enqueuePlaybackReport(generation, playbackState);
    } catch (playbackError) {
      if (playbackState === 'error') setError(operationError(playbackError));
    }
  }

  function openProjector() {
    if (openOrFocusProjector(projectorUrl) === null) {
      setProjectorOpened(false);
      setError({ title: 'Projektor se nepodařilo otevřít', message: projectorPopupBlockedMessage, technicalCode: 'PROJECTOR_POPUP_BLOCKED' });
      return;
    }
    setProjectorOpened(true);
  }

  async function navigate(direction: 1 | -1) {
    const generation = accessGenerationRef.current;
    if (!isCurrentSession(generation) || !slidesReady || pendingAction || queueCount > 0 || navigationInFlight.current) return;
    const acceptedAt = measure ? latencyNow() : undefined;
    // A click and a shortcut can both arrive before pendingAction renders.
    navigationInFlight.current = true;
    const operationId = ++operationIdRef.current;
    setPendingAction(direction === 1 ? 'next' : 'previous');
    try {
      const handled = await eventNavigation.current?.navigate(direction);
      if (!handled && isCurrentSession(generation) && operationIdRef.current === operationId) {
        if (direction === 1 && session?.eventId && visibleSlidePosition(slides, session.currentSlidePosition, 1) === undefined) await run(endQuiz, 'end');
        else await run(direction === 1 ? nextSlide : previousSlide, direction === 1 ? 'next' : 'previous', acceptedAt);
      }
    } finally {
      if (isCurrentSession(generation)) {
        navigationInFlight.current = false;
        if (operationIdRef.current === operationId) setPendingAction(null);
      }
    }
  }

  if (loading) return (
    <>
      <QuizLoading label="Načítám moderování…" />
      <LiveDiagnostics projection="unconfirmed" />
    </>
  );
  if (!sessionId || !session) {
    return (
      <section className="focused-live-state">
        <h1>Moderování nebylo nalezeno</h1>
        <p>Vraťte se na detail kvízu a spusťte ho znovu.</p>
        <Link className="secondary-link" to="/admin/quizzes">Otevřít kvízy</Link>
        <LiveDiagnostics projection={publicReadFailed ? 'failed' : 'unconfirmed'} />
      </section>
    );
  }
  // An empty array before the private read completes does not mean the show is
  // over. Keep both pointer and keyboard navigation unavailable until confirmed.
  if (!slidesReady) {
    if (error?.technicalCode === 'LIVE_SLIDES_LOAD_FAILED') return <section className="focused-live-state">
      <HumanError error={error} />
      <button type="button" className="secondary-button" onClick={() => { setError(null); setSlideReadAttempt(attempt => attempt + 1); }}>Načíst obsah znovu</button>
    </section>;
    return <QuizLoading label="Načítám obsah kvízu…" />;
  }

  const mediaAlerts = activeMediaObservations.filter(item => item.mediaGeneration === session.mediaGeneration
    && !(item.device === 'preview' && activeMediaObservations.some(other => other.device === 'projector'
      && other.mediaGeneration === item.mediaGeneration && other.target === item.target && other.reason === item.reason)));
  const detailedMediaError = mediaAlerts.some(item => (
    (item.target === 'audio' || item.target === 'video')
    && (item.device === 'projector' && error?.technicalCode === 'PROJECTOR_MEDIA_PLAYBACK_FAILED'
      || item.device === 'moderator' && error?.technicalCode === 'MODERATOR_AUDIO_PLAYBACK_FAILED')
  ));

  return (
    <ShowCommandContext.Provider value={{
      busy: queueCount > 0 || pendingAction !== null, enabled: showEnabled,
      execute: action => enqueueMutation(current => action(current, Math.max(current.revision, confirmedRevisionRef.current))),
      prepareAudio: prepareShowAudio, playAudio: playShowAudio, stopAudio: stopShowAudio,
    }}>
    <SnapshotMediaContext.Provider value={session.snapshotId}>
    <LiveModeratorView
      session={session}
      publicState={publicState}
      slides={slides}
      currentSlide={currentSlide}
      presentedSlide={presentedSlide}
      recapChoices={recap}
      pendingAction={pendingAction ?? (queueCount > 0 ? 'show' : null)}
      audioSuppressed={audioSuppressed}
      error={detailedMediaError ? null : error}
      projectorOpened={projectorOpened}
      onOpenProjector={openProjector}
      onPrevious={() => void navigate(-1)}
      onNext={() => void navigate(1)}
      onReveal={() => void run(revealAnswer, 'reveal')}
      onHide={() => void run(hideAnswer, 'hide')}
      onGoToSlide={position => { if (!pendingAction && queueCount === 0) void run((id, revision) => goToSlide(id, revision, position), 'jump'); }}
      onFinale={session.eventId && session.snapshotId ? () => { if (!pendingAction && queueCount === 0) void eventNavigation.current?.openFinale(); } : undefined}
      onSelectRecap={(position) => void run((id, revision) => selectRecapQuestion(id, revision, position), 'recap')}
      onPlay={() => void run(playMedia, 'play')}
      onPlayOriginal={() => void run((id, revision) => playMedia(id, revision, 'original'), 'play')}
      onStop={() => void run(stopMedia, 'stop')}
      onReplay={() => void run(replayMedia, 'replay')}
      onEnd={() => void run(endQuiz, 'end')}
      onCompleteEvent={session.eventId && can('event.manage') ? () => void run((id, revision) => endLiveSession(id, revision, true), 'end') : undefined}
      onMediaFinished={(generation) => void reportPlayback(generation, 'finished')}
      onMediaError={(generation) => {
        if (measure) latency.audio(generation, 'player-error');
        void reportPlayback(generation, 'error');
      }}
      onMediaPlayback={(generation, playbackState) => {
        if (measure) latency.audio(generation, playbackState === 'ready' ? 'player-ready' : 'player-playing');
        if (playbackState === 'playing') receiveMediaObservation('moderator', generation, 'audio', 'recovered');
        void reportPlayback(generation, playbackState);
      }}
      onAudioDiagnostic={(generation, reason) => receiveMediaObservation('moderator', generation, 'audio', reason)}
      onAudioResourceTiming={measure ? (generation, stage) => latency.audio(generation, stage) : undefined}
      onPreviewDiagnostic={(generation, target, reason) => receiveMediaObservation('preview', generation, target, reason)}
      mediaAlerts={<LiveMediaAlerts observations={mediaAlerts} />}
      diagnostics={<LiveDiagnostics
        key={session.sessionId}
        projection={publicReadFailed ? 'failed' : publicState && publicState.revision >= session.revision ? 'confirmed' : 'loading'}
        observations={mediaObservations}
        latency={measure && <LiveLatencyDetails trace={latencyTrace} />}
      />}
      eventControls={session.eventId && session.snapshotId ? <>
        {localEventMediaAvailable() && <LocalMediaBackupControl session={session} state={publicState} projectorOpened={projectorOpened} />}
        <EventNightControls key={session.sessionId} session={session} slides={slides} navigation={eventNavigation} />
      </> : undefined}
    />
    </SnapshotMediaContext.Provider>
    </ShowCommandContext.Provider>
  );
}
