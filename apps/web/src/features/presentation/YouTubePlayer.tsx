import { useEffect, useId, useReducer, useRef, useState } from 'react';

import { initialMediaMachineState, reduceMediaMachine } from './mediaStateMachine';
import { youtubeVideoId } from './model';
import { recordPlayerLifecycle } from './performance';
import type { MediaPlaybackCommand, MediaPlaybackState } from './types';

interface YouTubePlayerInstance {
  cueVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  loadVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  setVolume(volume: number): void;
  unMute(): void;
  addEventListener?(event: string, listener: string): void;
  removeEventListener?(event: string, listener: string): void;
  destroy(): void;
}

interface YouTubeNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady: () => void;
        onStateChange: (event: { data: number }) => void;
        onError: () => void;
        onAutoplayBlocked?: () => void;
      };
    },
  ) => YouTubePlayerInstance;
  PlayerState: { readonly ENDED: number; readonly PLAYING: number };
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
    __FILMOVY_KVIZ_MEDIA_DEBUG__?: {
      activePlayers: number;
      peakPlayers: number;
      createdPlayers: number;
      destroyedPlayers: number;
    };
  }
}

let apiPromise: Promise<YouTubeNamespace> | undefined;
let listenerSequence = 0;
type PlaybackEvent = 'onStateChange' | 'onError' | 'onAutoplayBlocked';
type PlaybackListener = (event?: { data: number }) => void;
interface YouTubeResource {
  readonly videoId: string;
  readonly player: YouTubePlayerInstance;
  readonly namespace: YouTubeNamespace;
  ready: boolean;
  configured: boolean;
  endSeconds: number | undefined;
  readonly listeners: Partial<Record<PlaybackEvent, PlaybackListener>>;
  activate?: (() => void) | undefined;
  deactivate?: (() => void) | undefined;
}
function listen(resource: YouTubeResource, event: PlaybackEvent, callback: PlaybackListener): () => void {
  const { player } = resource;
  // Some live SDK instances lack dynamic removal. Constructor callbacks remain
  // available without registering callbacks that cannot later be detached.
  const remove = typeof player.removeEventListener === 'function' ? player.removeEventListener.bind(player) : undefined;
  if (typeof player.addEventListener !== 'function' || typeof remove !== 'function') {
    resource.listeners[event] = callback;
    return () => { if (resource.listeners[event] === callback) delete resource.listeners[event]; };
  }
  const name = '__filmovyKvizYouTubeListener' + ++listenerSequence;
  const target = window as unknown as Record<string, unknown>;
  target[name] = callback;
  player.addEventListener(event, name);
  return () => {
    try { remove(event, name); }
    catch { /* Epoch guards already invalidate callbacks; cleanup must still release the iframe. */ }
    finally { delete target[name]; }
  };
}

function mediaDebug(delta: 1 | -1): void {
  const current = window.__FILMOVY_KVIZ_MEDIA_DEBUG__ ?? {
    activePlayers: 0,
    peakPlayers: 0,
    createdPlayers: 0,
    destroyedPlayers: 0,
  };
  recordPlayerLifecycle(current, delta);
  window.__FILMOVY_KVIZ_MEDIA_DEBUG__ = current;
}

function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise !== undefined) return apiPromise;
  const pending = new Promise<YouTubeNamespace>((resolve, reject) => {
    const prior = window.onYouTubeIframeAPIReady;
    const staleScript = document.querySelector<HTMLScriptElement>('script[data-filmovy-kviz-youtube-api]');
    staleScript?.remove();
    const script = document.createElement('script');
    const fail = (error: Error) => {
      script.remove();
      reject(error);
    };
    window.onYouTubeIframeAPIReady = () => {
      prior?.();
      if (window.YT?.Player) resolve(window.YT);
      else fail(new Error('YouTube API is unavailable.'));
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.dataset.filmovyKvizYoutubeApi = 'true';
    script.onerror = () => fail(new Error('YouTube API could not be loaded.'));
    document.head.append(script);
  });
  const retryable = pending.catch((error: unknown) => {
    if (apiPromise === retryable) apiPromise = undefined;
    throw error;
  });
  apiPromise = retryable;
  return apiPromise;
}

export function YouTubePlayer({
  source,
  command,
  generation,
  startSeconds,
  endSeconds,
  className,
  onFinished,
  onError,
  onPlaybackState,
  currentTimeRequest,
  onCurrentTime,
  onPlayRequest,
  allowManualAutoplay = false,
  fadeInSeconds,
}: {
  readonly source: string;
  readonly command: MediaPlaybackCommand;
  readonly generation: number;
  readonly startSeconds: number;
  readonly endSeconds?: number;
  readonly className?: string;
  readonly onFinished?: (generation: number) => void;
  readonly onError?: (generation: number, message: string) => void;
  readonly onPlaybackState?: (generation: number, state: Extract<MediaPlaybackState, 'ready' | 'playing'>) => void;
  readonly currentTimeRequest?: number;
  readonly onCurrentTime?: (seconds: number) => void;
  /** Editor-only: turn an iframe play gesture into a fresh bounded playback command. */
  readonly onPlayRequest?: () => void;
  readonly allowManualAutoplay?: boolean;
  /** Opt-in volume ramp; counted only while the official player reports PLAYING. */
  readonly fadeInSeconds?: number;
}) {
  const reactId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | undefined>(undefined);
  const epochSequenceRef = useRef(0);
  const activeEpochRef = useRef<number | undefined>(undefined);
  const onFinishedRef = useRef(onFinished);
  const onErrorRef = useRef(onError);
  const onPlaybackStateRef = useRef(onPlaybackState);
  const onCurrentTimeRef = useRef(onCurrentTime);
  const onPlayRequestRef = useRef(onPlayRequest);
  const [machine, dispatch] = useReducer(reduceMediaMachine, initialMediaMachineState);
  const [visibleError, setVisibleError] = useState<string>();
  const [blockedEpoch, setBlockedEpoch] = useState<number>();
  const [resource, setResource] = useState<YouTubeResource>();
  const [attempt, setAttempt] = useState(0);
  const failedSetup = useRef(false);
  const generationRef = useRef(generation);
  const videoId = youtubeVideoId(source);

  useEffect(() => { onFinishedRef.current = onFinished; }, [onFinished]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onPlaybackStateRef.current = onPlaybackState; }, [onPlaybackState]);
  useEffect(() => { onCurrentTimeRef.current = onCurrentTime; }, [onCurrentTime]);
  useEffect(() => { onPlayRequestRef.current = onPlayRequest; }, [onPlayRequest]);
  useEffect(() => { generationRef.current = generation; }, [generation]);
  useEffect(() => {
    if (failedSetup.current && (command === 'play' || command === 'replay')) { failedSetup.current = false; setAttempt(value => value + 1); }
  }, [command, generation]);
  useEffect(() => {
    if (currentTimeRequest === undefined || currentTimeRequest <= 0 || playerRef.current === undefined) return;
    try {
      const seconds = playerRef.current.getCurrentTime();
      if (Number.isFinite(seconds) && seconds >= 0) onCurrentTimeRef.current?.(seconds);
    } catch {
      // The iframe API can briefly reject reads while a newly mounted player is still preparing.
    }
  }, [currentTimeRequest]);

  useEffect(() => {
    let cancelled = false, ready = false, mounted: YouTubeResource | undefined;
    failedSetup.current = false;
    setResource(undefined);
    hostRef.current?.replaceChildren();
    if (videoId === undefined || hostRef.current === null) return;
    void loadYouTubeApi().then(namespace => {
      if (cancelled || hostRef.current === null) return;
      const mountPoint = document.createElement('div');
      hostRef.current.append(mountPoint);
      const player = new namespace.Player(mountPoint, {
        videoId,
        playerVars: { controls: 1, rel: 0, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: () => {
            if (cancelled) return;
            ready = true;
            if (mounted) { mounted.ready = true; mounted.activate?.(); }
          },
          onStateChange: event => { if (!cancelled) mounted?.listeners.onStateChange?.(event); },
          onError: () => { if (!cancelled) mounted?.listeners.onError?.(); },
          onAutoplayBlocked: () => { if (!cancelled) mounted?.listeners.onAutoplayBlocked?.(); },
        },
      });
      mounted = { player, namespace, videoId, ready, configured: false, endSeconds: undefined, listeners: {} };
      playerRef.current = player;
      mediaDebug(1);
      setResource(mounted);
    }).catch(() => {
      if (cancelled) return;
      failedSetup.current = true;
      const message = 'YouTube přehrávač se nepodařilo načíst.';
      dispatch({ type: 'error', generation: generationRef.current, message });
      setVisibleError(message); onErrorRef.current?.(generationRef.current, message);
    });
    return () => {
      cancelled = true;
      if (mounted) {
        mounted.deactivate?.();
        mounted.activate = undefined; mounted.player.destroy(); mediaDebug(-1);
        if (playerRef.current === mounted.player) playerRef.current = undefined;
      }
      hostRef.current?.replaceChildren();
    };
  }, [videoId, attempt]);

  useEffect(() => {
    const epoch = ++epochSequenceRef.current;
    activeEpochRef.current = epoch;
    let cancelled = false, terminal = false, started = false, applied = false;
    const active = () => !cancelled && activeEpochRef.current === epoch;
    const requestedPlay = command === 'play' || command === 'replay';
    setVisibleError(undefined); setBlockedEpoch(undefined);
    if (videoId === undefined || command === 'error') {
      const message = videoId === undefined ? 'Zdroj není podporovaný YouTube odkaz ani video ID.' : 'Médium je ve stavu chyby. Použijte REPLAY pro nový pokus.';
      dispatch({ type: 'error', generation, message }); setVisibleError(message);
      if (videoId === undefined) onErrorRef.current?.(generation, message);
      if (resource?.ready && resource.videoId === videoId) resource.player.pauseVideo();
      return () => { cancelled = true; };
    }
    dispatch({ type: requestedPlay ? 'play' : command === 'stop' ? 'stop' : command === 'finished' ? 'finished' : 'reset', generation });
    if (!resource || resource.videoId !== videoId) return () => { cancelled = true; };
    const { player, namespace } = resource;
    const fadeDuration = fadeInSeconds !== undefined && Number.isFinite(fadeInSeconds) && fadeInSeconds > 0 ? fadeInSeconds * 1000 : 0;
    let fadeTimer: ReturnType<typeof setInterval> | undefined, fadeStartedAt: number | undefined, fadeElapsed = 0;
    const stopFade = (recordElapsed = false) => {
      if (recordElapsed && fadeStartedAt !== undefined) fadeElapsed = Math.min(fadeDuration, fadeElapsed + performance.now() - fadeStartedAt);
      fadeStartedAt = undefined;
      clearInterval(fadeTimer); fadeTimer = undefined;
    };
    const fail = (message: string) => {
      if (!active() || terminal) return;
      stopFade();
      terminal = true; setBlockedEpoch(undefined); if (resource.ready) player.pauseVideo();
      dispatch({ type: 'error', generation, message }); setVisibleError(message); onErrorRef.current?.(generation, message);
    };
    const startFade = () => {
      if (!fadeDuration || fadeElapsed >= fadeDuration || fadeTimer !== undefined) return;
      fadeStartedAt = performance.now();
      const tick = () => {
        if (!active() || terminal || fadeStartedAt === undefined) { stopFade(); return; }
        const elapsed = Math.min(fadeDuration, fadeElapsed + performance.now() - fadeStartedAt);
        try { player.setVolume(Math.round(100 * elapsed / fadeDuration)); }
        catch { fail('Hlasitost YouTube hudby se nepodařilo nastavit.'); return; }
        if (elapsed >= fadeDuration) stopFade(true);
      };
      tick();
      if (active() && !terminal && fadeStartedAt !== undefined) fadeTimer = setInterval(tick, 50);
    };
    const removeState = listen(resource, 'onStateChange', event => {
      if (!active()) return;
      if (event?.data === namespace.PlayerState.PLAYING && (!requestedPlay || terminal)) {
        player.pauseVideo();
        onPlayRequestRef.current?.();
        return;
      }
      if (terminal) return;
      if (event?.data === namespace.PlayerState.PLAYING) {
        started = true; setVisibleError(undefined); setBlockedEpoch(undefined);
        startFade();
        if (terminal) return;
        dispatch({ type: 'playing', generation }); onPlaybackStateRef.current?.(generation, 'playing');
      } else stopFade(true);
      if (event?.data === namespace.PlayerState.ENDED && requestedPlay && started) {
        terminal = true; dispatch({ type: 'finished', generation }); onFinishedRef.current?.(generation);
      }
    });
    const removeError = listen(resource, 'onError', () => fail('YouTube médium se nepodařilo přehrát.'));
    const removeBlocked = listen(resource, 'onAutoplayBlocked', () => {
      if (!active() || terminal || !requestedPlay) return;
      stopFade(true);
      const message = 'Prohlížeč zablokoval automatické přehrání. Spusťte video ručně na tomto zařízení.';
      if (!allowManualAutoplay) { fail(message); return; }
      dispatch({ type: 'ready', generation }); onPlaybackStateRef.current?.(generation, 'ready');
      setBlockedEpoch(epoch); setVisibleError(message);
    });
    const prepare = () => {
      if (!active() || terminal || applied) return;
      applied = true;
      if (command === 'stop' || command === 'finished') { player.pauseVideo(); return; }
      const options = { videoId, startSeconds, ...(endSeconds === undefined ? {} : { endSeconds }) };
      if (requestedPlay) {
        if (fadeDuration) {
          try { player.setVolume(0); player.unMute(); }
          catch { fail('Hlasitost YouTube hudby se nepodařilo nastavit.'); return; }
        }
        dispatch({ type: 'ready', generation }); onPlaybackStateRef.current?.(generation, 'ready');
        // YouTube drops cue/load endSeconds after seekTo. Bounded clips must be loaded with their end again.
        if (resource.configured && resource.endSeconds === undefined && endSeconds === undefined) { player.seekTo(startSeconds, true); player.playVideo(); }
        else player.loadVideoById(options);
      } else {
        if (resource.configured && resource.endSeconds === undefined && endSeconds === undefined) { player.pauseVideo(); player.seekTo(startSeconds, true); }
        else player.cueVideoById(options);
        dispatch({ type: 'ready', generation });
      }
      resource.configured = true; resource.endSeconds = endSeconds;
    };
    resource.activate = prepare;
    if (resource.ready) prepare();
    const deactivate = () => {
      if (cancelled) return;
      stopFade();
      cancelled = true; removeState(); removeError(); removeBlocked();
      if (resource.activate === prepare) resource.activate = undefined;
      if (activeEpochRef.current === epoch) activeEpochRef.current = undefined;
    };
    resource.deactivate = deactivate;
    return deactivate;
  }, [allowManualAutoplay, command, endSeconds, fadeInSeconds, generation, resource, startSeconds, videoId]);

  return (
    <div className={className ?? 'youtube-player-shell'} data-media-lifecycle={machine.lifecycle} data-player-id={reactId}>
      <div ref={hostRef} className="youtube-player-host" />
      {visibleError && <p className="projector-media-error" role="status">{visibleError}</p>}
      {blockedEpoch !== undefined && (command === 'play' || command === 'replay') && <button type="button" className="secondary-button" onClick={() => {
        if (activeEpochRef.current !== blockedEpoch) return;
        try { playerRef.current?.playVideo(); }
        catch { setVisibleError('Video se nepodařilo spustit. Zkuste ovládání přehrávače nebo pokračujte otázkou.'); }
      }}>Spustit video ručně</button>}
    </div>
  );
}
