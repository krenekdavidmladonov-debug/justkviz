import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { calculateOfflineResults, canHideInfoSlide, offlineResultsPageSize, type OfflineCommand, type OfflineSyncPreview, type OfflineSyncResolution } from '@filmovy-kviz/quiz-domain';
import { OfflineMediaContext } from '../media/OfflineMediaContext';
import { SlideRenderer } from '../presentation/SlideRenderer';
import { MediaPlayer } from '../presentation/MediaPlayer';
import { ShowModeRenderer } from '../show-mode/ShowModeRenderer';
import type { PublicLiveState } from '../live/types';
import type { SlideRenderInput } from '../presentation/types';
import { parseRoundPoints, pointsText } from '../scoring/model';
import { InterimResultsPreview } from '../leaderboard/InterimResultsPreview';
import { buildOfflineProjection } from './offlineProjection';
import { connectOfflineProjector, openOfflineProjector, type OfflineProjectorConnection } from './offlineProjector';
import { exportOfflineRecovery, exportStoredOfflineEvent, importOfflineEvent } from './offlinePreparation';
import { OfflinePreparationWizard } from './OfflinePreparationWizard';
import { openOfflineRuntime, type OfflineRuntime, type OfflineSynchronizationRequest } from './offlineRuntime';
import { checkOfflineShell, installOfflineShell, proveOfflineShellBoot, testOfflineShellBoot } from './offlineShell';
import { listOfflineSessions, verifyStoredOfflineStorage, type StoredOfflineSession } from './offlineStore';
import { currentOfflineMode } from './offlineAvailability';

interface ChromeInstallPrompt extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function errorText(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return 'Pro uložení offline dat není dostatek volného místa.';
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Prohlížeč tuto operaci nepovolil. Zkontrolujte nastavení offline aplikace.';
    if (error.name === 'AbortError') return 'Operace byla zrušena.';
    if (error.name === 'NetworkError' || error.name === 'TimeoutError') return 'Připojení se přerušilo nebo přenos trval příliš dlouho.';
    return 'Prohlížeč nedokončil čtení nebo zápis. Zkontrolujte soubor, heslo a volné místo.';
  }
  if (error instanceof TypeError) return 'Přenos nebo ověření dat selhaly. Zkontrolujte soubor či připojení a zkuste operaci znovu.';
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code);
    if (code === 'functions/internal') return 'Server při zpracování operace narazil na chybu. Zkuste operaci znovu; případný uložený průběh zůstává zachován.';
    if (code.includes('unauthenticated')) return 'Online přihlášení vypršelo. Přihlaste se znovu v administraci; místní průběh zůstává uložený.';
    if (code.includes('permission-denied')) return 'Aktuální oprávnění tuto operaci nepovolují. Místní průběh zůstává uložený.';
    if (code.includes('unavailable') || code.includes('deadline-exceeded')) return 'Server není dostupný nebo přenos trval příliš dlouho. Zkuste operaci znovu; místní data zůstávají uložená.';
  }
  return error instanceof Error ? error.message : 'Operaci se nepodařilo dokončit. Původní uložená data zůstala zachována.';
}

function OfflineShellSelfTest({ nonce }: { readonly nonce: string }) {
  useEffect(() => { void proveOfflineShellBoot(nonce); }, [nonce]);
  return <p>Ověřuji spuštění aplikace bez síťových spojení…</p>;
}

function PublicPresentation({ state, finished, mediaEnabled = true }: { readonly state: PublicLiveState; readonly finished?: (() => void) | undefined; readonly mediaEnabled?: boolean }) {
  const slide: SlideRenderInput = {
    ...state, kind: state.slideKind ?? 'question', title: state.title ?? '', text: state.text ?? '',
  };
  return <ShowModeRenderer state={state}>
    {state.status === 'waiting' ? <div className="offline-projector-message">Kvíz brzy začne</div>
      : state.status === 'ended' ? <div className="offline-projector-message">Děkujeme za hru</div>
      : <SlideRenderer slide={slide} quizTitle={state.quizTitle} mode={state.renderMode} liveEventsEnabled={false}
        mediaCommand={state.mediaCommand} mediaPlaybackState={state.mediaPlaybackState}
        mediaGeneration={state.mediaGeneration} mediaEnabled={mediaEnabled} onMediaFinished={finished} />}
  </ShowModeRenderer>;
}

function OfflineProjector({ sessionId }: { readonly sessionId: string }) {
  const [state, setState] = useState<PublicLiveState | null>(null);
  const [error, setError] = useState('Čekám na offline moderování…');
  const connection = useRef<ReturnType<typeof connectOfflineProjector> | null>(null);
  useEffect(() => {
    try {
      connection.current = connectOfflineProjector(sessionId, next => setState(next));
    } catch (caught) {
      setError(errorText(caught));
    }
    return () => { connection.current?.close(); connection.current = null; };
  }, [sessionId]);
  const resolver = useMemo(() => ({
    epoch: `${sessionId}:${state?.mediaGeneration ?? 0}`,
    resolve: (reference: string, signal: AbortSignal) => connection.current
      ? connection.current.resolve(reference, signal)
      : Promise.reject(new Error('Offline moderování není připojeno.')),
  }), [sessionId, state?.mediaGeneration]);
  return <main className="offline-projector" data-offline-projector>
    <OfflineMediaContext.Provider value={resolver}>
      {state ? <PublicPresentation state={state} finished={() => connection.current?.finished(state.mediaGeneration)} /> : <div className="offline-projector-message">{error}<p>Otevřete projektor z odemčeného moderování.</p></div>}
    </OfflineMediaContext.Provider>
  </main>;
}

export function OfflineApp() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const changed = () => setHash(location.hash);
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const projector = /^#\/projector\/([A-Za-z0-9_-]{1,150})$/u.exec(hash);
  const selfTest = /^#\/self-test\/([A-Za-z0-9_-]{1,150})$/u.exec(hash);
  if (selfTest) return <OfflineShellSelfTest key={selfTest[1]} nonce={selfTest[1]!} />;
  if (projector) return <OfflineProjector key={projector[1]} sessionId={projector[1]!} />;
  const params = new URLSearchParams(hash.split('?')[1] ?? '');
  const eventId = params.get('eventId') ?? '';
  if (/^#\/prepare(?:\?|$)/u.test(hash) && currentOfflineMode() !== 'recovery') {
    return <div className="offline-app offline-wizard-app">
      <header><a href="/offline.html" className="offline-wizard-brand">JustKvíz <span>Offline</span></a>
        <a href={eventId ? '/admin/events/' + encodeURIComponent(eventId) : '/admin'}>Zpět do administrace</a></header>
      <main><OfflinePreparationWizard key={hash} eventId={eventId} transferTarget={params.get('transfer') === '1'} /></main>
    </div>;
  }
  const importEventId = /^#\/import(?:\?|$)/u.test(hash) ? eventId : undefined;
  return <OfflineHome key={hash} importEventId={importEventId} />;
}

function OfflineHome({ importEventId }: { readonly importEventId: string | undefined }) {
  const [sessions, setSessions] = useState<StoredOfflineSession[]>([]);
  const [password, setPassword] = useState('');
  const [restore, setRestore] = useState(false);
  const [previousPassword, setPreviousPassword] = useState('');
  const [runtime, setRuntime] = useState<OfflineRuntime | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [installed, setInstalled] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<ChromeInstallPrompt | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const mounted = useRef(false);
  const taskLifetime = useRef({ active: false, pending: false });
  const activeRuntime = useRef<OfflineRuntime | null>(null);
  const unlocking = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => setSessions(await listOfflineSessions()), []);
  useEffect(() => {
    const offerInstallation = (event: Event) => { event.preventDefault(); setInstallPrompt(event as ChromeInstallPrompt); };
    const installedApp = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', offerInstallation);
    window.addEventListener('appinstalled', installedApp);
    return () => {
      window.removeEventListener('beforeinstallprompt', offerInstallation);
      window.removeEventListener('appinstalled', installedApp);
    };
  }, []);
  useEffect(() => {
    mounted.current = true;
    const connectivity = () => setOnline(navigator.onLine);
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    void refresh().catch(caught => setError(errorText(caught)));
    void checkOfflineShell().then(proof => setInstalled(proof.ready)).catch(() => setInstalled(false));
    return () => {
      mounted.current = false;
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
      unlocking.current?.abort();
      activeRuntime.current?.close();
    };
  }, [refresh]);
  useLayoutEffect(() => {
    const lifetime = { active: true, pending: false };
    taskLifetime.current = lifetime;
    return () => { lifetime.active = false; };
  }, []);
  const task = async (work: () => Promise<void>) => {
    const lifetime = taskLifetime.current;
    if (!lifetime.active || lifetime.pending) return;
    lifetime.pending = true;
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (caught) { if (lifetime.active) setError(errorText(caught)); }
    finally { lifetime.pending = false; if (lifetime.active) setBusy(false); }
  };
  const unlock = async (sessionId: string, verifiedArchiveId?: string) => {
    if (!mounted.current) return undefined;
    unlocking.current?.abort();
    const controller = new AbortController();
    unlocking.current = controller;
    activeRuntime.current?.close();
    activeRuntime.current = null;
    setRuntime(null);
    try {
      const opened = await openOfflineRuntime(sessionId, password, () => setRevision(value => value + 1), {
        signal: controller.signal, verifiedArchiveId,
        verifyEnvironment: async () => {
          setMessage('Ověřuji offline spuštění a trvalé úložiště…');
          await testOfflineShellBoot();
          controller.signal.throwIfAborted();
          await verifyStoredOfflineStorage();
        },
        progress: (index, total) => setMessage(`Ověřuji místní média: ${index} / ${total}`),
      });
      if (!mounted.current || controller.signal.aborted) {
        opened.close();
        return undefined;
      }
      activeRuntime.current = opened;
      setRuntime(opened);
      setPassword(''); setMessage('');
      return opened;
    } finally {
      if (unlocking.current === controller) unlocking.current = null;
    }
  };
  const visibleSessions = importEventId === undefined ? sessions : sessions.filter(session => session.eventId === importEventId);
  return <div className="offline-app">
    <header><a href="/offline.html">JustKvíz · Offline</a><span data-offline-connectivity>{online ? 'Síť je dostupná' : 'Bez připojení'}</span><a href="/admin">Online administrace</a></header>
    <main>
      {runtime ? <OfflineOperator key={runtime.manifest.sessionId} runtime={runtime} revision={revision} task={task} busy={busy} progress={setMessage}
        lock={() => { runtime.close(); activeRuntime.current = null; setRuntime(null); void refresh(); }} /> : <>
        <h1>{importEventId === undefined ? 'Spustit offline kvíz' : 'Otevřít offline kvíz této akce'}</h1>
        <p>Večer běží na tomto počítači. Soubor obsahuje také správné odpovědi a poznámky; chraňte jej i heslo.</p>
        <section>
          <h2>Aplikace pro hraní bez internetu</h2>
          <p data-offline-shell-status>{installed ? 'Aplikace je uložená pro spuštění bez internetu.' : 'Nejprve uložte offline aplikaci na tento počítač.'}</p>
          <button disabled={busy} onClick={() => void task(async () => { const proof = await installOfflineShell(); await testOfflineShellBoot(); setInstalled(proof.ready); setMessage('Aplikace se úspěšně spustila s blokovanými síťovými spojeními.'); })}>Uložit aplikaci pro offline spuštění</button>
          <button disabled={busy || !installed} onClick={() => void task(async () => { await testOfflineShellBoot(); setMessage('Předakcová zkouška: celá aplikace se spustila bez síťových spojení.'); })}>Ověřit spuštění bez internetu</button>
          {installPrompt && <button disabled={busy} onClick={() => void task(async () => {
            setInstallPrompt(null);
            const { outcome } = await installPrompt.prompt();
            if (outcome === 'accepted') setMessage('Otevřete JustKvíz Offline z nové ikony a ověřte přípravu tohoto notebooku.');
          })}>Nainstalovat aplikaci v Chrome</button>}
          <p>Pokud tlačítko instalace nevidíte, otevřete nabídku Chrome a zvolte instalaci aplikace. Potom otevřete JustKvíz Offline z jeho ikony a proveďte zkoušku s vypnutou sítí.</p>
        </section>
        <section>
          <h2>Odemčení soukromých dat</h2>
          <label>Heslo offline souboru<input type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} minLength={10} maxLength={200} /></label>
          <label><input type="checkbox" checked={restore} onChange={event => setRestore(event.target.checked)} />Obnovit existující večer z novějšího nouzového souboru</label>
          {restore && <label>Heslo původních místních dat, pokud se liší<input type="password" autoComplete="off" value={previousPassword} onChange={event => setPreviousPassword(event.target.value)} /></label>}
          <label className="offline-file-label">Načíst offline kvíz<input type="file" accept=".justkvizoffline" disabled={busy || password.length < 10 || importEventId === ''} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (file) void task(async () => {
              const stored = await importOfflineEvent(file, password, setMessage, restore, previousPassword || password, importEventId);
              await refresh();
              const opened = await unlock(stored.sessionId, stored.archiveId);
              setPreviousPassword('');
              if (opened) setMessage('Soubor byl ověřen a uložen.');
            });
          }} /></label>
          <p>Na jiném počítači nejprve online připravte aplikaci u své akce, aby si ověřila důvěryhodný podpisový klíč. Importovaný soubor tento klíč nikdy nemění.</p>
        </section>
        <section><h2>Uložené večery na tomto počítači</h2>
          {visibleSessions.length === 0 && <p>Zatím zde není připravený offline kvíz.</p>}
          <ul>{visibleSessions.map(session => <li key={session.sessionId} data-offline-session={session.sessionId}><strong>{session.title}</strong> · {session.sequence} uložených kroků <button disabled={busy || password.length < 10} onClick={() => void task(async () => { await unlock(session.sessionId); })}>Odemknout a pokračovat</button><button disabled={busy} onClick={() => void task(() => exportStoredOfflineEvent(session))}>Uložit původní offline soubor</button><button disabled={busy} onClick={() => void task(() => exportStoredOfflineEvent(session, true))}>Stáhnout původní offline soubor</button></li>)}</ul>
        </section>
      </>}
      {busy && <p role="status">Probíhá ověřování nebo odolné ukládání…</p>}
      {message && <p role="status" data-offline-status>{message}</p>}
      {error && <p role="alert" data-offline-error className="offline-error">{error}</p>}
    </main>
  </div>;
}

interface OperatorProps {
  readonly runtime: OfflineRuntime;
  readonly revision: number;
  readonly busy: boolean;
  readonly task: (work: () => Promise<void>) => Promise<void>;
  readonly progress: (message: string) => void;
  readonly lock: () => void;
}

function OfflineOperator({ runtime, revision, busy, task, progress, lock }: OperatorProps) {
  const { manifest, state } = runtime;
  const [roundId, setRoundId] = useState(manifest.rounds[0]!.id);
  const [interimPreview, setInterimPreview] = useState<{ roundId: string; page: number; head: string } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [loadedPreview, setPreview] = useState<OfflineSyncPreview | null>(null);
  const previewHead = useRef<string | null>(null);
  const preview = !runtime.pendingSynchronization && previewHead.current === state.headHash ? loadedPreview : null;
  const [resolutions, setResolutions] = useState<OfflineSyncResolution[]>([]);
  const [completeRecovery, setCompleteRecovery] = useState(false);
  const [previewRecovery, setPreviewRecovery] = useState(false);
  const [recapPosition, setRecapPosition] = useState('');
  const [mediaCompletionError, setMediaCompletionError] = useState('');
  const completionBlocked = Boolean(runtime.syncedReceipt || runtime.pendingSynchronization || runtime.playBlock);
  useEffect(() => { setMediaCompletionError(''); }, [runtime, state.mediaGeneration, completionBlocked]);
  const [lastPlayBlock, setLastPlayBlock] = useState(() => runtime.playBlock);
  const playBlock = runtime.playBlock ?? lastPlayBlock;
  useEffect(() => {
    const refresh = () => setLastPlayBlock(runtime.playBlock);
    const timer = window.setInterval(refresh, 1000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [runtime]);
  const popup = useRef<OfflineProjectorConnection | null>(null);
  const projection = useMemo(() => buildOfflineProjection(manifest, runtime.syncedReceipt
    ? { ...runtime.state, status: 'ended', revealPosition: null, recap: false, results: null, mediaCommand: 'idle' }
    : runtime.state), [manifest, runtime, revision]);
  const latest = useRef(projection);
  latest.current = projection;
  useEffect(() => {
    if (playBlock) {
      popup.current?.close();
      popup.current = null;
    } else popup.current?.publish(projection);
  }, [playBlock, projection]);
  useEffect(() => () => popup.current?.close(), []);
  const resolver = useMemo(() => ({ epoch: `${manifest.sessionId}:${state.mediaGeneration}`, resolve: async (reference: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (runtime.playBlock) throw new Error(runtime.playBlock);
    const blob = await runtime.asset(reference);
    signal.throwIfAborted();
    if (runtime.playBlock) throw new Error(runtime.playBlock);
    return blob;
  } }), [runtime, manifest.sessionId, state.mediaGeneration]);
  const command = (value: OfflineCommand) => void task(async () => { await runtime.append(value); setPreview(null); progress('Změna je odolně uložená na tomto počítači.'); });
  const completionFailed = (generation: number) => {
    if (runtime.state.mediaGeneration === generation && !runtime.playBlock && !runtime.pendingSynchronization && !runtime.syncedReceipt) {
      setMediaCompletionError('Dokončení ukázky se nepodařilo uložit. Zkontrolujte místní úložiště a ukázku znovu zastavte.');
    }
  };
  const reportCompletion = (generation: number) => {
    void runtime.reportMediaFinished(generation).catch(() => completionFailed(generation));
  };
  const compare = async (choices: readonly OfflineSyncResolution[] | undefined, recovery: boolean) => {
    const head = runtime.state.headHash;
    const online = await import('./offlineOnline');
    if (head !== runtime.state.headHash) throw new Error('Místní průběh se změnil. Zkontrolujte jej a porovnání zopakujte.');
    const result = await online.previewOfflineSynchronization(manifest.event.id, manifest.exportId, runtime.operations, choices, recovery);
    if (head !== runtime.state.headHash) throw new Error('Místní průběh se změnil. Zkontrolujte jej a porovnání zopakujte.');
    previewHead.current = head;
    setPreview(result);
  };
  const synchronize = async (request: OfflineSynchronizationRequest) => {
    await runtime.synchronize(request, async (operations, intent) => {
      const online = await import('./offlineOnline');
      return online.commitOfflineSynchronization(manifest.event.id, manifest.exportId, operations, intent.previewDigest, intent.resolutions, intent.completeRecovery);
    });
    setPreview(null);
    progress('Výsledky byly potvrzeny serverem. Opakování nevytvoří další zápisy.');
  };
  const pendingSynchronization = runtime.pendingSynchronization;
  const playable = manifest.slides.filter(slide => !slide.hidden || !canHideInfoSlide(slide));
  const index = playable.findIndex(slide => slide.position === state.slidePosition);
  const current = manifest.slides.find(slide => slide.position === (state.revealPosition ?? state.slidePosition));
  const disabled = busy || Boolean(playBlock) || Boolean(runtime.syncedReceipt) || state.status === 'ended';
  const results = calculateOfflineResults(manifest, state.scores, roundId);
  const selectedRound = manifest.rounds.find(round => round.id === roundId)!;
  const final = selectedRound.id === [...manifest.rounds].sort((a, b) => a.position - b.position).at(-1)!.id;
  const allScoresComplete = calculateOfflineResults(manifest, state.scores, [...manifest.rounds].sort((a, b) => a.position - b.position).at(-1)!.id).complete;
  const privateAudio = !runtime.syncedReceipt && current && !state.recap && ['audio', 'music'].includes(current.kind.toLowerCase())
    ? current.mediaSource || current.media.find(media => media.kind === 'audio' && media.role === 'prompt')?.source : undefined;
  return <>
    {interimPreview?.head === state.headHash && interimPreview.roundId === roundId && <InterimResultsPreview
      rows={results.rows} missing={results.missing.map(cell => ({ ...cell, teamName: manifest.teams.find(team => team.id === cell.teamId)!.name }))}
      disabled={disabled || !results.complete} onClose={() => setInterimPreview(null)} onPublish={() => {
        setInterimPreview(null);
        if (runtime.state.headHash === interimPreview.head) {
          command({ type: 'results', payload: { throughRoundId: roundId, final: false, page: interimPreview.page } });
        }
      }} />}
    <h1>{manifest.event.title}</h1>
    <p data-offline-runtime-state>{runtime.syncedReceipt ? 'Výsledky bezpečně synchronizovány' : state.status === 'ended' ? 'Výsledky čekají na synchronizaci' : playBlock ? 'Uložený průběh je otevřený pro obnovu' : state.status === 'active' ? 'Offline režim aktivní' : 'Offline kvíz připraven'} · {state.sequence} potvrzených kroků</p>
    <p>Platnost hraní do {new Date(manifest.expiresAtMs).toLocaleString('cs-CZ')}.</p>
    {playBlock && <p role="alert" data-offline-readiness-error>{playBlock} Potvrzený průběh zůstává uložený pro obnovu nebo synchronizaci.</p>}
    <div className="offline-actions"><button disabled={busy || Boolean(playBlock)} onClick={() => void task(() => { popup.current?.close(); popup.current = openOfflineProjector(runtime, () => latest.current, completionFailed); return Promise.resolve(); })}>Otevřít offline projektor</button><button disabled={busy} onClick={lock}>Zamknout soukromá data</button></div>
    {mediaCompletionError && !completionBlocked && <p role="alert" data-offline-media-completion-error>{mediaCompletionError}</p>}
    <section aria-label="Offline moderování"><h2>Moderování</h2>
      <div className="offline-actions">
        {state.status === 'waiting' && <button disabled={disabled} onClick={() => command({ type: 'start', payload: {} })}>Zahájit offline kvíz</button>}
        <button disabled={disabled || index <= 0 || state.status !== 'active'} onClick={() => command({ type: 'navigate', payload: { position: playable[index - 1]!.position } })}>Předchozí snímek</button>
        <button disabled={disabled || index < 0 || index >= playable.length - 1 || state.status !== 'active'} onClick={() => command({ type: 'navigate', payload: { position: playable[index + 1]!.position } })}>Další snímek</button>
        <label>Snímek<select value={state.slidePosition} disabled={disabled || state.status !== 'active'} onChange={event => command({ type: 'navigate', payload: { position: Number(event.target.value) } })}><option value={0}>Nezahájeno</option>{playable.map(slide => <option key={slide.id} value={slide.position}>{slide.position}. {slide.title || slide.kind}</option>)}</select></label>
        <button disabled={disabled || !current?.isQuestion || state.status !== 'active'} onClick={() => command({ type: 'reveal', payload: { position: state.slidePosition } })}>Odhalit odpověď</button>
        <button disabled={disabled || state.status !== 'active'} onClick={() => command({ type: 'hide', payload: {} })}>Skrýt odpověď a výsledky</button>
      </div>
      <div className="offline-actions"><label>Otázka pro rekapitulaci<select value={recapPosition} onChange={event => setRecapPosition(event.target.value)}><option value="">Vyberte předchozí otázku</option>{manifest.slides.filter(slide => slide.isQuestion && slide.position < state.slidePosition).map(slide => <option key={slide.id} value={slide.position}>{slide.position}. {slide.title}</option>)}</select></label><button disabled={disabled || !recapPosition || state.status !== 'active'} onClick={() => command({ type: 'recap', payload: { position: Number(recapPosition) } })}>Odhalit vybranou rekapitulaci</button></div>
      {current && <aside className="offline-private" data-offline-private><h3>Pouze pro moderátora</h3><p><strong>Správná odpověď:</strong> {current.correctAnswer}</p><p><strong>Poznámka:</strong> {current.moderatorNote || '—'}</p></aside>}
      {!playBlock && <OfflineMediaContext.Provider value={resolver}>
        <div className="offline-preview"><PublicPresentation state={projection} mediaEnabled={false} /></div>
        {privateAudio && <div className="offline-private"><p>Zvuková ukázka hraje na počítači moderátora.</p><MediaPlayer source={privateAudio} command={state.mediaCommand} generation={state.mediaGeneration} startSeconds={current?.clipStartSeconds ?? 0}
          {...(current?.clipEndSeconds != null && current.clipEndSeconds > (current.clipStartSeconds ?? 0) ? { endSeconds: current.clipEndSeconds } : {})}
          onFinished={reportCompletion} onError={() => progress('Ukázku nelze přehrát. Zkontrolujte výstup zvuku.')} /></div>}
      </OfflineMediaContext.Provider>}
      <div className="offline-actions">{(['play', 'replay', 'stop'] as const).map((mediaCommand, mediaIndex) => <button key={mediaCommand} disabled={disabled || state.status !== 'active'} onClick={() => command({ type: 'media', payload: { command: mediaCommand } })}>{['Přehrát ukázku', 'Přehrát znovu', 'Zastavit ukázku'][mediaIndex]}</button>)}</div>
    </section>
    <section aria-label="Offline bodování"><h2>Bodování</h2>
      <label>Kolo<select value={roundId} onChange={event => { setRoundId(event.target.value); setDrafts({}); setReason(''); }}>{manifest.rounds.map(round => <option key={round.id} value={round.id}>{round.title}</option>)}</select></label>
      <table><thead><tr><th>Tým</th><th>Potvrzené body</th><th>Nové body</th></tr></thead><tbody>{manifest.teams.map(team => {
        const score = state.scores.find(score => score.teamId === team.id && score.roundId === roundId);
        return <tr key={team.id}><th>{team.name}</th><td>{score?.halfPoints == null ? 'Nezadáno' : pointsText(score.halfPoints)}</td><td><input aria-label={`Body — ${team.name}`} inputMode="decimal" disabled={disabled} value={drafts[team.id] ?? pointsText(score?.halfPoints ?? null)} onChange={event => setDrafts(values => ({ ...values, [team.id]: event.target.value }))} /></td></tr>;
      })}</tbody></table>
      <label>Důvod opravy nebo vymazání<input value={reason} disabled={disabled} onChange={event => setReason(event.target.value)} maxLength={1000} /></label>
      <button disabled={disabled || Object.keys(drafts).length === 0} onClick={() => void task(async () => {
        const changes = Object.entries(drafts).map(([teamId, text]) => {
          const previous = state.scores.find(score => score.teamId === teamId && score.roundId === roundId);
          return { teamId, expectedRevision: previous?.revision ?? 0, halfPoints: text.trim() === '' ? null : parseRoundPoints(text), reason };
        }).filter(change => change.halfPoints !== (state.scores.find(score => score.teamId === change.teamId && score.roundId === roundId)?.halfPoints ?? null));
        if (changes.length) await runtime.append({ type: 'round-scores', payload: { roundId, changes } });
        setDrafts({}); setReason(''); setPreview(null); progress('Body jsou odolně uložené na tomto počítači.');
      })}>Uložit body kola</button>
      <p>Body zadáváte místně na moderátorském počítači. Nepotvrzené úpravy nejsou uložené; úspěch se zobrazí až po dokončení odolného zápisu.</p>
      <details data-offline-score-history><summary>Historie bodování</summary>
        <ol>{runtime.operations.filter(operation => operation.type === 'round-scores').map(operation => <li key={operation.operationId}>
          <strong>{new Date(operation.observedAtMs).toLocaleString('cs-CZ')} · {manifest.rounds.find(round => round.id === operation.payload.roundId)?.title}</strong>
          <ul>{operation.payload.changes.map(change => <li key={change.teamId}>{manifest.teams.find(team => team.id === change.teamId)?.name} — {change.halfPoints === null ? 'vymazáno' : `${pointsText(change.halfPoints)} b.`} · revize {change.expectedRevision + 1}{change.reason ? ` · ${change.reason}` : ''}</li>)}</ul>
        </li>)}</ol>
      </details>
      <p data-offline-results-complete>{results.complete ? 'Všechna zahrnutá kola mají body.' : `Chybí ${results.missing.length} hodnot. Nula je zadaný výsledek.`}</p>
      <ol data-offline-ranking>{results.rows.map((row, rowIndex) => <li key={rowIndex}>{row.rank}. {row.teamName} — {pointsText(row.halfPoints)} b.</li>)}</ol>
      <div className="offline-actions">{Array.from({ length: Math.ceil(manifest.teams.length / offlineResultsPageSize) }, (_, page) => <button key={page} disabled={disabled || (final && !results.complete) || state.status !== 'active'} onClick={() => {
        if (final) command({ type: 'results', payload: { throughRoundId: roundId, final, page } });
        else setInterimPreview({ roundId, page, head: state.headHash });
      }}>{final ? 'Konečné pořadí' : 'Průběžné výsledky'} · strana {page + 1}</button>)}</div>
    </section>
    <section><h2>Obnova a dokončení</h2>
      <label>Heslo pro nový nouzový soubor<input type="password" autoComplete="off" value={recoveryPassword} onChange={event => setRecoveryPassword(event.target.value)} minLength={10} maxLength={200} /></label>
      <button disabled={busy || recoveryPassword.length < 10} onClick={() => void task(async () => { await exportOfflineRecovery(runtime, recoveryPassword, progress); setRecoveryPassword(''); progress('Nouzový soubor obsahuje i poslední potvrzené body a historii.'); })}>Exportovat nouzovou obnovu</button>
      <button disabled={busy || recoveryPassword.length < 10} onClick={() => void task(async () => { await exportOfflineRecovery(runtime, recoveryPassword, progress, true); setRecoveryPassword(''); progress('Nouzový soubor byl předán ke stažení v prohlížeči. Ověřte dokončení stahování.'); })}>Stáhnout nouzovou obnovu</button>
      <button disabled={disabled || state.status !== 'active'} onClick={() => command({ type: 'end', payload: {} })}>Ukončit offline kvíz</button>
    </section>
    <section aria-label="Synchronizace offline výsledků"><h2>Synchronizovat výsledky</h2>
      <p>Synchronizace vyžaduje připojení a aktuální online přihlášení. Online změny nikdy nepřepíše automaticky.</p>
      {pendingSynchronization && !runtime.syncedReceipt && <div role="status" data-offline-sync-pending>
        <p>Předchozí synchronizace čeká na potvrzení. Ověření použije stejnou historii a původní rozhodnutí; další změny jsou do té doby uzamčené.</p>
        <button disabled={busy} onClick={() => void task(() => synchronize({
          previewDigest: pendingSynchronization.previewDigest,
          resolutions: pendingSynchronization.resolutions,
          completeRecovery: pendingSynchronization.completeRecovery,
        }))}>Znovu ověřit synchronizaci</button>
      </div>}
      {state.status === 'active' && allScoresComplete && !runtime.syncedReceipt && !pendingSynchronization && <label><input type="checkbox" checked={completeRecovery} disabled={busy} onChange={event => { setCompleteRecovery(event.target.checked); setPreview(null); }} />Dokončit uložený průběh při synchronizaci</label>}
      <button disabled={busy || Boolean(pendingSynchronization) || (state.status !== 'ended' && !(state.status === 'active' && allScoresComplete && completeRecovery)) || Boolean(runtime.syncedReceipt)} onClick={() => void task(async () => {
        setResolutions([]);
        setPreviewRecovery(completeRecovery);
        await compare(undefined, completeRecovery);
      })}>Porovnat s online stavem</button>
      {preview && <div data-offline-sync-preview>
        <p>Místně: {preview.local.operationCount} kroků, {preview.local.scoreChanges} změn bodů. Online: {preview.server.scoreChanges} změn bodů.</p>
        {preview.conflicts.length > 0 ? <>
          <p role="alert">Online stav se od přípravy změnil. Místní data zůstávají zachovaná.</p>
          <ul>{preview.conflicts.map((conflict, conflictIndex) => {
            const resolution = resolutions.find(value => value.teamId === conflict.teamId && value.roundId === conflict.roundId);
            const changeResolution = (choice: '' | 'online' | 'offline', text: string) => {
              if (!conflict.teamId || !conflict.roundId) return;
              const { teamId, roundId } = conflict;
              setResolutions(values => [...values.filter(value => value.teamId !== teamId || value.roundId !== roundId),
                ...(choice ? [{ teamId, roundId, choice, reason: text }] : [])]);
            };
            return <li key={conflictIndex}>
              <p>{conflict.reason}{conflict.teamId ? ` · ${manifest.teams.find(team => team.id === conflict.teamId)?.name ?? 'Tým'}` : ''}{conflict.roundId ? ` · ${manifest.rounds.find(round => round.id === conflict.roundId)?.title ?? 'Kolo'}` : ''}
                {conflict.local ? ` · místně ${conflict.local.halfPoints === null ? 'nezadáno' : pointsText(conflict.local.halfPoints)}` : ''}
                {conflict.online ? ` · online ${conflict.online.halfPoints === null ? 'nezadáno' : pointsText(conflict.online.halfPoints)}` : ''}</p>
              {preview.resolutionAllowed && conflict.teamId && conflict.roundId && <>
                <label>Řešení konfliktu<select disabled={busy} value={resolution?.choice ?? ''} onChange={event => changeResolution(event.target.value as '' | 'online' | 'offline', resolution?.reason ?? '')}>
                  <option value="">Výslovně vyberte výsledek</option><option value="online">Ponechat online body</option><option value="offline">Použít offline body</option>
                </select></label>
                <label>Důvod rozhodnutí<input disabled={busy} value={resolution?.reason ?? ''} maxLength={1000} onChange={event => changeResolution(resolution?.choice ?? '', event.target.value)} /></label>
              </>}
            </li>;
          })}</ul>
          {preview.resolutionAllowed ? <button disabled={busy || preview.conflicts.some(conflict => !resolutions.some(value => value.teamId === conflict.teamId && value.roundId === conflict.roundId && value.reason.trim()))} onClick={() => void task(async () => {
            await compare(resolutions, previewRecovery);
          })}>Zkontrolovat zvolené řešení konfliktů</button> : <p>Změnu kvízu, týmů nebo oprávnění nelze sloučit bodovou opravou. Exportujte nouzový soubor a zkontrolujte akci online.</p>}
        </> : <>
          {preview.merged && <div data-offline-sync-merged><h3>Výsledky po zvoleném řešení</h3><ol>{preview.merged.rows.map((row, rowIndex) => <li key={rowIndex}>{row.rank}. {row.teamName} — {pointsText(row.halfPoints)} b.</li>)}</ol><p>{preview.resolutions?.length ?? 0} výslovně zvolených oprav. Původní offline historie zůstane uchována.</p></div>}
          {previewRecovery && <p>Server po novém ověření oprávnění dokončí uložený průběh. Do offline historie se nedopisuje zpětně datovaný příkaz.</p>}
          <button disabled={busy} onClick={() => void task(async () => {
            if (previewHead.current !== runtime.state.headHash) throw new Error('Místní průběh se změnil. Porovnejte jej znovu s online stavem.');
            await synchronize({ previewDigest: preview.previewDigest, resolutions: preview.resolutions, completeRecovery: previewRecovery });
          })}>Potvrdit synchronizaci výsledků</button>
        </>}
        <button disabled={busy} onClick={() => setPreview(null)}>Zrušit porovnání</button>
      </div>}
      {Boolean(runtime.syncedReceipt) && <p role="status" data-offline-sync-receipt>Výsledky bezpečně synchronizovány a potvrzení je uložené.</p>}
    </section>
  </>;
}
