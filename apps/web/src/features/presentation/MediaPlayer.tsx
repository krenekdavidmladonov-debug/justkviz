import { useContext, useEffect, useReducer, useRef, useState, type ComponentProps } from 'react';
import { SnapshotMediaContext } from '../media/SnapshotMediaContext';
import { parseQuizAsset, directMediaKind, validOwnedMedia } from '@filmovy-kviz/quiz-domain';
import { YouTubePlayer } from './YouTubePlayer';
import { initialMediaMachineState, reduceMediaMachine } from './mediaStateMachine';
import { recordPlayerLifecycle } from './performance';
import { quizMediaReadFailure, readQuizMediaBlob } from '../media/mediaApi';
import { mediaDiagnosticDelayMs, type MediaDiagnosticReason } from './mediaDiagnostics';
import { OfflineMediaContext } from '../media/OfflineMediaContext';

type PlayerProps = ComponentProps<typeof YouTubePlayer> & { readonly sessionId?: string | undefined };
type NativeResource = {
  player: HTMLMediaElement;
  source: string;
  sessionId?: string | undefined;
  snapshotId?: string | undefined;
  offlineEpoch: string | undefined;
  attempt: number;
  metadataReady: boolean;
};
const unavailable = 'Médium není dostupné nebo časování přesahuje délku souboru.';
function nativeMediaDiagnostic(code: number | undefined): MediaDiagnosticReason | undefined {
  switch (code) {
    case 1: return undefined; // A canceled load is not a transport failure.
    case 2: return 'network-error';
    case 3: return 'decode-failed';
    case 4: return 'source-unavailable';
    default: return 'load-failed';
  }
}

export function MediaPlayer(props: PlayerProps) {
  return parseQuizAsset(props.source) || directMediaKind(props.source) ? <NativeMediaPlayer {...props} /> : <YouTubePlayer {...props} />;
}
function NativeMediaPlayer({ source, command, generation, startSeconds, endSeconds, className, onFinished, onError, onDiagnostic, onPlaybackState, onResourceTiming, currentTimeRequest, onCurrentTime, sessionId }: PlayerProps) {
  const snapshotId = useContext(SnapshotMediaContext);
  const offline = useContext(OfflineMediaContext);
  const offlineEpoch = offline?.epoch;
  const host = useRef<HTMLDivElement>(null);
  const [resource, setResource] = useState<NativeResource>();
  const [attempt, setAttempt] = useState(0);
  // A render starting a new load must not select the resource being disposed.
  const currentResource = resource?.source === source && resource.sessionId === sessionId
    && resource.snapshotId === snapshotId && resource.offlineEpoch === offlineEpoch && resource.attempt === attempt ? resource : undefined;
  const failedLoad = useRef(false);
  const callbacks = useRef({ onFinished, onError, onDiagnostic, onPlaybackState, onResourceTiming, onCurrentTime, command, generation });
  const [machine, dispatch] = useReducer(reduceMediaMachine, initialMediaMachineState);
  useEffect(() => {
    callbacks.current = { onFinished, onError, onDiagnostic, onPlaybackState, onResourceTiming, onCurrentTime, command, generation };
  }, [onFinished, onError, onDiagnostic, onPlaybackState, onResourceTiming, onCurrentTime, command, generation]);
  useEffect(() => {
    // Keep the failed player fenced off until the resource effect starts a new attempt.
    if (failedLoad.current && (command === 'play' || command === 'replay')) setAttempt(value => value + 1);
  }, [command, generation]);
  useEffect(() => {
    if (currentResource && currentTimeRequest !== undefined && currentTimeRequest > 0) callbacks.current.onCurrentTime?.(currentResource.player.currentTime);
  }, [currentTimeRequest, currentResource]);

  // Fetch and decode once per mounted source. Commands operate on this same player.
  useEffect(() => {
    const abort = new AbortController();
    let active = true, objectUrl: string | undefined, player: HTMLMediaElement | undefined;
    failedLoad.current = false;
    setResource(undefined);
    const debug = (delta: 1 | -1) => {
      const value = window.__FILMOVY_KVIZ_MEDIA_DEBUG__ ?? { activePlayers: 0, peakPlayers: 0, createdPlayers: 0, destroyedPlayers: 0 };
      recordPlayerLifecycle(value, delta); window.__FILMOVY_KVIZ_MEDIA_DEBUG__ = value;
    };
    const fail = (reason?: MediaDiagnosticReason) => {
      if (!active || failedLoad.current) return;
      failedLoad.current = true;
      const current = callbacks.current;
      if (reason && current.command !== 'stop' && current.command !== 'finished') current.onDiagnostic?.(current.generation, reason);
      dispatch({ type: 'error', generation: current.generation, message: unavailable });
      current.onError?.(current.generation, unavailable);
    };
    const timeout = window.setTimeout(() => { fail('timeout'); abort.abort(); }, 15_000);
    const measure = callbacks.current.onResourceTiming;
    const loadGeneration = callbacks.current.generation;
    const load = parseQuizAsset(source) && offline ? offline.resolve(source,abort.signal) : parseQuizAsset(source) ? readQuizMediaBlob(source, abort.signal, sessionId, snapshotId, measure && (stage => {
      if (active && !abort.signal.aborted) measure(loadGeneration, stage);
    })) : Promise.resolve(null);
    void load.then(blob => {
      if (!active || abort.signal.aborted || !host.current) return;
      window.clearTimeout(timeout);
      const kind = blob ? (blob.type === 'video/mp4' ? 'video' : 'audio') : directMediaKind(source);
      if (blob && !validOwnedMedia(kind, blob.type, blob.size)) { fail('invalid-media'); return; }
      if (blob) objectUrl = URL.createObjectURL(blob);
      player = document.createElement(kind === 'video' ? 'video' : 'audio');
      player.controls = false; player.preload = 'auto'; player.src = objectUrl ?? source;
      player.setAttribute('aria-label', kind === 'video' ? 'Video ukázka' : 'Vlastní audio');
      if (player instanceof HTMLVideoElement) player.playsInline = true;
      host.current.replaceChildren(player); debug(1);
      callbacks.current.onResourceTiming?.(callbacks.current.generation, 'player-mounted');
      setResource({ player, source, sessionId, snapshotId, offlineEpoch, attempt, metadataReady: false });
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) fail(callbacks.current.onDiagnostic ? quizMediaReadFailure(error) : undefined);
    });
    return () => {
      active = false; abort.abort(); window.clearTimeout(timeout);
      if (player) {
        player.onloadedmetadata = null; player.onplaying = null; player.onpause = null;
        player.ontimeupdate = null; player.onended = null; player.onerror = null;
        player.onwaiting = null;
        player.oncanplay = null;
        player.pause(); player.removeAttribute('src'); player.load(); player.remove(); debug(-1);
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, sessionId, snapshotId, attempt, offlineEpoch]);

  useEffect(() => {
    const requestedPlay = command === 'play' || command === 'replay';
    dispatch({ type: requestedPlay ? 'play' : command === 'stop' ? 'stop' : command === 'finished' ? 'finished' : 'reset', generation });
    let active = true, terminal = false, started = false, prepared = false;
    let bufferTimer: number | undefined;
    const startupTimer = requestedPlay && callbacks.current.onDiagnostic ? window.setTimeout(() => {
      if (active && !terminal && !failedLoad.current) callbacks.current.onDiagnostic?.(generation, 'slow-load');
    }, mediaDiagnosticDelayMs) : undefined;
    const stopBufferTimer = () => { window.clearTimeout(bufferTimer); bufferTimer = undefined; };
    const stopDiagnosticTimers = () => { window.clearTimeout(startupTimer); stopBufferTimer(); };
    if (failedLoad.current || !currentResource) {
      return () => { active = false; stopDiagnosticTimers(); };
    }
    const { player } = currentResource;
    const fail = (reason?: MediaDiagnosticReason) => {
      if (!active || terminal) return;
      stopDiagnosticTimers();
      if (reason && command !== 'stop' && command !== 'finished') callbacks.current.onDiagnostic?.(generation, reason);
      terminal = true; failedLoad.current = true; player.controls = false; player.pause();
      dispatch({ type: 'error', generation, message: unavailable }); callbacks.current.onError?.(generation, unavailable);
    };
    const finish = () => {
      if (!active || terminal || !started) return;
      stopDiagnosticTimers();
      terminal = true; player.controls = false; player.pause();
      dispatch({ type: 'finished', generation }); callbacks.current.onFinished?.(generation);
    };
    const prepare = () => {
      if (!active || terminal || prepared) return;
      prepared = true;
      if (!Number.isFinite(player.duration) || startSeconds >= player.duration || (endSeconds !== undefined && endSeconds > player.duration + 0.1)) { fail('invalid-timing'); return; }
      currentResource.metadataReady = true;
      window.clearTimeout(timeout);
      player.currentTime = startSeconds;
      if (command === 'stop' || command === 'finished') return;
      dispatch({ type: 'ready', generation }); callbacks.current.onPlaybackState?.(generation, 'ready');
      if (requestedPlay) void player.play().catch((error: unknown) => {
        const name = error instanceof DOMException ? error.name : undefined;
        fail(name === 'NotAllowedError' ? 'autoplay-blocked' : name === 'AbortError' ? undefined : 'load-failed');
      });
    };
    player.controls = requestedPlay;
    player.onloadedmetadata = prepare;
    const onCanPlay = () => {
      if (active && prepared && !terminal && requestedPlay && !player.seeking
        && player.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) callbacks.current.onResourceTiming?.(generation, 'player-can-play');
    };
    if (callbacks.current.onResourceTiming) {
      player.oncanplay = onCanPlay;
    }
    player.onplaying = () => {
      if (!active) return;
      if (terminal || !requestedPlay) { player.pause(); return; }
      stopDiagnosticTimers();
      started = true; dispatch({ type: 'playing', generation }); callbacks.current.onPlaybackState?.(generation, 'playing');
    };
    player.onpause = () => {
      stopBufferTimer();
      if (active && !terminal && requestedPlay && started) {
        dispatch({ type: 'ready', generation });
        callbacks.current.onPlaybackState?.(generation, 'ready');
      }
    };
    player.onwaiting = () => {
      if (!active || terminal || !requestedPlay || !started || player.paused || bufferTimer !== undefined || !callbacks.current.onDiagnostic) return;
      bufferTimer = window.setTimeout(() => {
        if (active && !terminal && !player.paused) callbacks.current.onDiagnostic?.(generation, 'buffering');
      }, mediaDiagnosticDelayMs);
    };
    player.ontimeupdate = () => { if (endSeconds !== undefined && player.currentTime >= endSeconds) finish(); };
    player.onended = finish;
    player.onerror = () => fail(nativeMediaDiagnostic(player.error?.code));
    const timeout = window.setTimeout(() => fail('timeout'), 15_000);
    if (!requestedPlay) player.pause();
    if (command === 'stop' || command === 'finished') window.clearTimeout(timeout);
    if (command === 'error') { fail(); window.clearTimeout(timeout); }
    else if (player.error && command !== 'stop' && command !== 'finished') fail(nativeMediaDiagnostic(player.error.code));
    else if (currentResource.metadataReady || player.readyState >= 1) prepare();
    if (callbacks.current.onResourceTiming) onCanPlay();
    return () => { active = false; player.oncanplay = null; window.clearTimeout(timeout); stopDiagnosticTimers(); };
  }, [currentResource, source, sessionId, snapshotId, offlineEpoch, command, generation, startSeconds, endSeconds]);
  return <div className={className ?? 'youtube-player-shell'} data-media-lifecycle={machine.lifecycle} data-owned-media={Boolean(parseQuizAsset(source))}><div ref={host} />{machine.lifecycle === 'PREPARING' && <p className="projector-media-loading" role="status">Načítám médium…</p>}{machine.lifecycle === 'ERROR' && <p className="projector-media-error" role="status">{unavailable} Použijte Pustit znovu.</p>}</div>;
}
