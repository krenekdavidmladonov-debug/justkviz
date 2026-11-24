import { preflightImageObservationEpoch, recordPreflightImageWidth } from '../preflight/imageObservations';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { SnapshotMediaContext } from './SnapshotMediaContext';
import { isSafeHttpUrl, parseQuizAsset } from '@filmovy-kviz/quiz-domain';
import { mediaDiagnosticDelayMs, type MediaDiagnosticReason } from '../presentation/mediaDiagnostics';
import { quizMediaReadFailure, readQuizMediaBlob } from './mediaApi';
import type { ImageTiming } from '../presentation/mediaTiming';
import { LocalProjectorMediaContext, localProjectorMediaEpoch } from './LocalProjectorMediaContext';
import { localProjectorImageEligible, watchProjectorQuestionImage } from './localProjectorMedia';
import { notifyLocalProjectorMediaUsed } from '../live/localMediaBackupRelay';
import type { LocalProjectorMediaAuthority } from '../live/localMediaBackupAuthority';
import type { PublicLiveState } from '../live/types';
import type { LocalImageAuthority, LocalImageRole } from '@filmovy-kviz/quiz-domain';
import { localImageEligible, watchProjectorImage } from './localImageProjector';
import { notifyLocalImageUsed } from '../live/localImageRelay';
import { OfflineMediaContext } from './OfflineMediaContext';

type AssetImageProps = {
  source: string;
  alt: string;
  sessionId?: string | undefined;
  diagnosticGeneration?: number | undefined;
  onDiagnostic?: ((reason: MediaDiagnosticReason) => void) | undefined;
  onDiagnosticResolved?: (() => void) | undefined;
  onTiming?: ((stage: ImageTiming) => void) | undefined;
  mediaRole?: LocalImageRole | undefined;
};

type ProjectorImagePilot = { kind: 'multi-image' | 'legacy'; state: PublicLiveState };

function selectProjectorImagePilot(state: PublicLiveState | null, { source, sessionId, mediaRole }: AssetImageProps): ProjectorImagePilot | undefined {
  if (!state || sessionId !== state.sessionId || !mediaRole || !parseQuizAsset(source)) return undefined;
  if (localImageEligible(state, source, mediaRole)) return { kind: 'multi-image', state };
  if (mediaRole === 'question-image' && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('backupPilot') === '1'
    && localProjectorImageEligible(state, source)) return { kind: 'legacy', state };
  return undefined;
}

export function AssetImage(props: AssetImageProps) {
  const state = useContext(LocalProjectorMediaContext);
  const offline = useContext(OfflineMediaContext);
  const pilot = offline ? undefined : selectProjectorImagePilot(state, props);
  const epoch = offline ? 'offline:' + offline.epoch : pilot ? pilot.kind + ':' + localProjectorMediaEpoch(pilot.state) : '';
  return <ResolvedAssetImage key={props.source + ':' + (props.sessionId ?? 'private') + ':' + epoch} {...props} pilot={pilot} />;
}

function ResolvedAssetImage({
  source, alt, sessionId, diagnosticGeneration, onDiagnostic, onDiagnosticResolved, onTiming, mediaRole, pilot,
}: AssetImageProps & { pilot: ProjectorImagePilot | undefined }) {
  const observationEpoch = useRef(preflightImageObservationEpoch());
  const snapshotId = useContext(SnapshotMediaContext);
  const offline = useContext(OfflineMediaContext);
  const imageState = pilot?.kind === 'multi-image' ? pilot.state : null;
  const localState = pilot?.kind === 'legacy' ? pilot.state : null;
  const localEpoch = pilot ? localProjectorMediaEpoch(pilot.state) : undefined;
  const [loaded, setLoaded] = useState<{ source: string; sessionId?: string | undefined; snapshotId?: string | undefined; url: string; mediaSource?: 'online' | 'local'; authority?: LocalProjectorMediaAuthority | LocalImageAuthority | undefined }>();
  const [failure, setFailure] = useState<string>();
  const [retry, setRetry] = useState(0);
  const image = useRef<HTMLImageElement>(null);
  const request = useRef<AbortController | undefined>(undefined);
  const slowTimer = useRef<number | undefined>(undefined);
  const diagnostic = useRef(onDiagnostic);
  const timing = useRef(onTiming);
  const lastDiagnostic = useRef<MediaDiagnosticReason | undefined>(undefined);
  const lastGeneration = useRef(diagnosticGeneration);
  const owned = Boolean(parseQuizAsset(source));

  const reportDiagnostic = useCallback((reason: MediaDiagnosticReason) => {
    lastDiagnostic.current = reason;
    diagnostic.current?.(reason);
  }, []);
  useEffect(() => { diagnostic.current = onDiagnostic; }, [onDiagnostic]);
  useEffect(() => { timing.current = onTiming; }, [onTiming]);
  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth > 0) timing.current?.('image-ready');
  }, [diagnosticGeneration]);
  useEffect(() => {
    if (lastGeneration.current === diagnosticGeneration) return;
    lastGeneration.current = diagnosticGeneration;
    // The same visible asset can remain failed across adjacent slides.
    if (diagnosticGeneration !== undefined && lastDiagnostic.current) diagnostic.current?.(lastDiagnostic.current);
  }, [diagnosticGeneration]);
  useEffect(() => {
    const abort = new AbortController();
    request.current = abort;
    const measure = timing.current;
    let objectUrl: string | undefined;
    if (diagnostic.current) {
      if (!owned && !isSafeHttpUrl(source)) { reportDiagnostic('source-unavailable'); measure?.('image-error'); }
      else if (!image.current?.complete) slowTimer.current = window.setTimeout(() => {
        reportDiagnostic('slow-load');
      }, mediaDiagnosticDelayMs);
    }
    const timeout = owned && !localState && !imageState ? window.setTimeout(() => {
      window.clearTimeout(slowTimer.current);
      abort.abort();
      if (request.current === abort) request.current = undefined;
      setFailure(source);
      reportDiagnostic(navigator.onLine === false ? 'offline' : 'timeout');
      measure?.('image-error');
    }, 15_000) : undefined;
    const acceptBlob = (blob: Blob, mediaSource: 'online' | 'local' = 'online', authority?: LocalProjectorMediaAuthority | LocalImageAuthority) => {
      if (abort.signal.aborted) return;
      window.clearTimeout(timeout);
      setFailure(undefined);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      setLoaded({ source, sessionId, snapshotId, url: objectUrl, mediaSource, authority });
    };
    const rejectBlob = (error: unknown) => {
      window.clearTimeout(timeout);
      if (abort.signal.aborted) return;
      abort.abort();
      window.clearTimeout(slowTimer.current);
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = undefined; }
      setLoaded(undefined);
      setFailure(source);
      if (diagnostic.current) reportDiagnostic(quizMediaReadFailure(error));
      measure?.('image-error');
    };
    if (owned && offline) void offline.resolve(source,abort.signal).then(blob=>acceptBlob(blob,'local')).catch(rejectBlob);
    else if (owned && imageState && mediaRole) watchProjectorImage({
      state: imageState, reference: source, role: mediaRole, signal: abort.signal,
      onImage: acceptBlob, onFailure: rejectBlob,
      onTiming: measure && (stage => { if (!abort.signal.aborted) measure(stage); }),
    });
    else if (owned && localState) watchProjectorQuestionImage({
      state: localState, reference: source, signal: abort.signal, onImage: acceptBlob, onFailure: rejectBlob,
      onTiming: measure && (stage => { if (!abort.signal.aborted) measure(stage); }),
    });
    else if (owned) void readQuizMediaBlob(source, abort.signal, sessionId, snapshotId, measure && (stage => {
      if (!abort.signal.aborted) measure(stage);
    })).then(blob => acceptBlob(blob)).catch(rejectBlob);
    return () => {
      abort.abort();
      if (request.current === abort) request.current = undefined;
      window.clearTimeout(timeout);
      window.clearTimeout(slowTimer.current);
      lastDiagnostic.current = undefined;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [owned, source, sessionId, snapshotId, retry, reportDiagnostic, localEpoch, offline?.epoch]);

  const resolveDiagnostic = () => {
    lastDiagnostic.current = undefined;
    onDiagnosticResolved?.();
  };

  const url = owned ? loaded?.source === source && loaded.sessionId === sessionId && loaded.snapshotId === snapshotId ? loaded.url : undefined : isSafeHttpUrl(source) ? source : undefined;
  if (failure === source) return <span role="status">Obrázek není dostupný. <button type="button" onClick={() => {
    resolveDiagnostic();
    setFailure(undefined); setLoaded(undefined); setRetry(n => n + 1);
  }}>Zkusit načíst znovu</button></span>;
  if (!url) return <span role="status">Načítám obrázek…</span>;
  return <><img key={url + retry} ref={image} src={url} alt={alt}
    data-role={mediaRole} data-local-media-source={mediaRole ? loaded?.mediaSource ?? 'online' : undefined}
    onLoad={() => {
      if (owned && (!request.current || request.current.signal.aborted)) return;
      if (!sessionId && !offline && image.current) recordPreflightImageWidth(source, image.current.naturalWidth, observationEpoch.current);
      window.clearTimeout(slowTimer.current);
      resolveDiagnostic();
      onTiming?.('image-ready');
      if (loaded?.mediaSource === 'local' && loaded.authority && loaded.authority.expiresAtMs > Date.now()) {
        if (loaded.authority.schemaVersion === 3) notifyLocalImageUsed(loaded.authority);
        else notifyLocalProjectorMediaUsed(loaded.authority);
      }
    }}
    onError={() => {
      if (owned && (!request.current || request.current.signal.aborted)) return;
      request.current?.abort();
      if (owned) URL.revokeObjectURL(url);
      setLoaded(undefined);
      window.clearTimeout(slowTimer.current);
      setFailure(source);
      reportDiagnostic(owned ? 'decode-failed' : navigator.onLine === false ? 'offline' : 'load-failed');
      onTiming?.('image-error');
    }}
  />{loaded?.mediaSource === 'local' && <span className="local-projector-media-source" role="status"
    style={{ position: 'absolute', bottom: '0.5em', left: '0.5em', zIndex: 2, padding: '0.3em 0.5em', background: '#000c', color: '#fff', fontSize: '0.75em' }}
  >Místní zkušební kopie obrázku</span>}</>;
}
