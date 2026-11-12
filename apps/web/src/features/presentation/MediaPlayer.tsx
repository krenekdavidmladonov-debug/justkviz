import { useContext, useEffect, useReducer, useRef, useState, type ComponentProps } from 'react';
import { SnapshotMediaContext } from '../media/SnapshotMediaContext';
import { parseQuizAsset, directMediaKind, validOwnedMedia } from '@filmovy-kviz/quiz-domain';
import { YouTubePlayer } from './YouTubePlayer';
import { initialMediaMachineState, reduceMediaMachine } from './mediaStateMachine';
import { recordPlayerLifecycle } from './performance';
import { readQuizMediaBlob } from '../media/mediaApi';

type PlayerProps = ComponentProps<typeof YouTubePlayer> & { readonly sessionId?: string | undefined };
type NativeResource = { player: HTMLMediaElement; source: string; sessionId?: string | undefined; snapshotId?: string | undefined; metadataReady: boolean };
const unavailable = 'Médium není dostupné nebo časování přesahuje délku souboru.';
export function MediaPlayer(props: PlayerProps) {
  return parseQuizAsset(props.source) || directMediaKind(props.source) ? <NativeMediaPlayer {...props} /> : <YouTubePlayer {...props} />;
}
function NativeMediaPlayer({ source, command, generation, startSeconds, endSeconds, className, onFinished, onError, onPlaybackState, currentTimeRequest, onCurrentTime, sessionId }: PlayerProps) {
  const snapshotId = useContext(SnapshotMediaContext);
  const host = useRef<HTMLDivElement>(null);
  const [resource, setResource] = useState<NativeResource>();
  const [attempt, setAttempt] = useState(0);
  const failedLoad = useRef(false);
  const callbacks = useRef({ onFinished, onError, onPlaybackState, onCurrentTime, generation });
  const [machine, dispatch] = useReducer(reduceMediaMachine, initialMediaMachineState);
  useEffect(() => { callbacks.current = { onFinished, onError, onPlaybackState, onCurrentTime, generation }; }, [onFinished, onError, onPlaybackState, onCurrentTime, generation]);
  useEffect(() => {
    if (failedLoad.current && (command === 'play' || command === 'replay')) setAttempt(value => value + 1);
  }, [command, generation]);
  useEffect(() => {
    if (resource && currentTimeRequest !== undefined && currentTimeRequest > 0) callbacks.current.onCurrentTime?.(resource.player.currentTime);
  }, [currentTimeRequest, resource]);

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
    const fail = () => {
      if (!active || failedLoad.current) return;
      failedLoad.current = true;
      dispatch({ type: 'error', generation: callbacks.current.generation, message: unavailable });
      callbacks.current.onError?.(callbacks.current.generation, unavailable);
    };
    const timeout = window.setTimeout(() => { fail(); abort.abort(); }, 15000);
    const load = parseQuizAsset(source) ? readQuizMediaBlob(source, abort.signal, sessionId, snapshotId) : Promise.resolve(null);
    void load.then(blob => {
      if (!active || abort.signal.aborted || !host.current) return;
      window.clearTimeout(timeout);
      const kind = blob ? (blob.type === 'video/mp4' ? 'video' : 'audio') : directMediaKind(source);
      if (blob && !validOwnedMedia(kind, blob.type, blob.size)) { fail(); return; }
      if (blob) objectUrl = URL.createObjectURL(blob);
      player = document.createElement(kind === 'video' ? 'video' : 'audio');
      player.controls = false; player.preload = 'auto'; player.src = objectUrl ?? source;
      player.setAttribute('aria-label', kind === 'video' ? 'Video ukázka' : 'Vlastní audio');
      if (player instanceof HTMLVideoElement) player.playsInline = true;
      host.current.replaceChildren(player); debug(1);
      setResource({ player, source, sessionId, snapshotId, metadataReady: false });
    }).catch(() => { if (!abort.signal.aborted) fail(); });
    return () => {
      active = false; abort.abort(); window.clearTimeout(timeout);
      if (player) {
        player.onloadedmetadata = null; player.onplaying = null; player.onpause = null;
        player.ontimeupdate = null; player.onended = null; player.onerror = null;
        player.pause(); player.removeAttribute('src'); player.load(); player.remove(); debug(-1);
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, sessionId, snapshotId, attempt]);

  useEffect(() => {
    const requestedPlay = command === 'play' || command === 'replay';
    dispatch({ type: requestedPlay ? 'play' : command === 'stop' ? 'stop' : command === 'finished' ? 'finished' : 'reset', generation });
    if (failedLoad.current || !resource || resource.source !== source || resource.sessionId !== sessionId || resource.snapshotId !== snapshotId) return;
    const { player } = resource;
    let active = true, terminal = false, started = false, prepared = false;
    const fail = () => {
      if (!active || terminal) return;
      terminal = true; failedLoad.current = true; player.controls = false; player.pause();
      dispatch({ type: 'error', generation, message: unavailable }); callbacks.current.onError?.(generation, unavailable);
    };
    const finish = () => {
      if (!active || terminal || !started) return;
      terminal = true; player.controls = false; player.pause();
      dispatch({ type: 'finished', generation }); callbacks.current.onFinished?.(generation);
    };
    const prepare = () => {
      if (!active || terminal || prepared) return;
      prepared = true;
      if (!Number.isFinite(player.duration) || startSeconds >= player.duration || (endSeconds !== undefined && endSeconds > player.duration + 0.1)) { fail(); return; }
      resource.metadataReady = true;
      window.clearTimeout(timeout);
      player.currentTime = startSeconds;
      if (command === 'stop' || command === 'finished') return;
      dispatch({ type: 'ready', generation }); callbacks.current.onPlaybackState?.(generation, 'ready');
      if (requestedPlay) void player.play().catch(fail);
    };
    player.controls = requestedPlay;
    player.onloadedmetadata = prepare;
    player.onplaying = () => {
      if (!active) return;
      if (terminal || !requestedPlay) { player.pause(); return; }
      started = true; dispatch({ type: 'playing', generation }); callbacks.current.onPlaybackState?.(generation, 'playing');
    };
    player.onpause = () => { if (active && !terminal && requestedPlay && started) { dispatch({ type: 'ready', generation }); callbacks.current.onPlaybackState?.(generation, 'ready'); } };
    player.ontimeupdate = () => { if (endSeconds !== undefined && player.currentTime >= endSeconds) finish(); };
    player.onended = finish; player.onerror = fail;
    const timeout = window.setTimeout(fail, 15000);
    if (!requestedPlay) player.pause();
    if (command === 'stop' || command === 'finished') window.clearTimeout(timeout);
    if (command === 'error') { fail(); window.clearTimeout(timeout); }
    else if (resource.metadataReady || player.readyState >= 1) prepare();
    return () => { active = false; window.clearTimeout(timeout); };
  }, [resource, source, sessionId, snapshotId, command, generation, startSeconds, endSeconds]);
  return <div className={className ?? 'youtube-player-shell'} data-media-lifecycle={machine.lifecycle} data-owned-media={Boolean(parseQuizAsset(source))}><div ref={host} />{machine.lifecycle === 'PREPARING' && <p className="projector-media-loading" role="status">Načítám médium…</p>}{machine.lifecycle === 'ERROR' && <p className="projector-media-error" role="status">{unavailable} Použijte Pustit znovu.</p>}</div>;
}
