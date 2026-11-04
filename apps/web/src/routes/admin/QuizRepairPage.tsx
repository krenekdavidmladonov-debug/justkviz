import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import {
  repairQuizChoiceAnswer,
  repairQuizVideoTiming,
  staleEditorMessage,
} from '../../features/editor/editorApi';
import { getEditorQuiz } from '../../features/editor/editorRepository';
import { questionPrompt } from '../../features/editor/semanticModel';
import { clipDuration, formatHumanTime, parseHumanTime } from '../../features/editor/time';
import type { EditorQuiz, EditorSlide } from '../../features/editor/types';
import { YouTubePlayer } from '../../features/presentation/YouTubePlayer';
import type { MediaPlaybackCommand } from '../../features/presentation/types';
import {
  buildRepairQueue,
  humanRepairType,
  nextRepairKey,
  repairIssueKey,
  type RepairQueueItem,
} from '../../features/preflight/repairQueue';
import { preflightFixUrl, runQuizPreflight } from '../../features/preflight/validation';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';

const unsavedWarning = 'Máte neuloženou volbu. Opravdu ji chcete zahodit?';

function TimingRepair({ slide, disabled, startText, endText, onStartText, onEndText }: {
  readonly slide: EditorSlide;
  readonly disabled: boolean;
  readonly startText: string;
  readonly endText: string;
  readonly onStartText: (value: string) => void;
  readonly onEndText: (value: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [command, setCommand] = useState<MediaPlaybackCommand>('idle');
  const [generation, setGeneration] = useState(0);
  const [currentTimeRequest, setCurrentTimeRequest] = useState(0);
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const captureTarget = useRef<'start' | 'end' | null>(null);
  const parsedStart = parseHumanTime(startText);
  const parsedEnd = parseHumanTime(endText);
  const safeStart = typeof parsedStart === 'number' && parsedStart >= 0 ? parsedStart : 0;
  const safeEnd = typeof parsedEnd === 'number' && parsedEnd > safeStart ? parsedEnd : undefined;
  const duration = typeof parsedStart === 'number' && typeof parsedEnd === 'number'
    ? clipDuration(parsedStart, parsedEnd)
    : null;

  useEffect(() => {
    if (!loaded) return undefined;
    const timer = window.setInterval(() => setCurrentTimeRequest((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [loaded]);

  const run = (next: MediaPlaybackCommand) => {
    setLoaded(true);
    setGeneration((value) => value + 1);
    setCommand(next);
  };
  const capture = (target: 'start' | 'end') => {
    captureTarget.current = target;
    setCurrentTimeRequest((value) => value + 1);
  };

  return (
    <div className="repair-video-panel">
      <dl className="repair-private-summary">
        <div><dt>Současný zdroj</dt><dd className="repair-media-source">{slide.mediaSource}</dd></div>
        <div><dt>Současný START</dt><dd>{formatHumanTime(slide.clipStartSeconds) || 'není nastaven'}</dd></div>
        <div><dt>Současný END</dt><dd>{formatHumanTime(slide.clipEndSeconds) || 'není nastaven'}</dd></div>
        <div><dt>Aktuální čas playeru</dt><dd>{currentTime === null ? '—' : formatHumanTime(currentTime)}</dd></div>
      </dl>
      <div className="media-time-grid">
        <label className="form-field">START *
          <input
            value={startText}
            disabled={disabled}
            inputMode="decimal"
            placeholder="mm:ss nebo mm:ss.s"
            onChange={(event) => onStartText(event.target.value)}
          />
        </label>
        <label className="form-field">END *
          <input
            value={endText}
            disabled={disabled}
            inputMode="decimal"
            placeholder="mm:ss nebo mm:ss.s"
            onChange={(event) => onEndText(event.target.value)}
          />
        </label>
      </div>
      <p className="clip-duration">Délka klipu: <strong>{duration === null ? '—' : formatHumanTime(duration)}</strong></p>
      {loaded && (
        <YouTubePlayer
          className="youtube-player-shell editor-test-player"
          source={slide.mediaSource}
          command={command}
          generation={generation}
          startSeconds={safeStart}
          {...(safeEnd === undefined ? {} : { endSeconds: safeEnd })}
          currentTimeRequest={currentTimeRequest}
          onCurrentTime={(seconds) => {
            const rounded = Math.round(seconds * 10) / 10;
            setCurrentTime(rounded);
            if (captureTarget.current === 'start') onStartText(formatHumanTime(rounded));
            if (captureTarget.current === 'end') onEndText(formatHumanTime(rounded));
            captureTarget.current = null;
          }}
        />
      )}
      <div className="media-test-controls">
        <button type="button" className="secondary-button" disabled={disabled} onClick={() => run('idle')}>Načíst video</button>
        <button type="button" className="secondary-button" disabled={disabled || !loaded} onClick={() => capture('start')}>Použít aktuální čas jako START</button>
        <button type="button" className="secondary-button" disabled={disabled || !loaded} onClick={() => capture('end')}>Použít aktuální čas jako END</button>
        <button type="button" className="primary-button" disabled={disabled} onClick={() => run('play')}>Přehrát ukázku</button>
        <button type="button" className="secondary-button" disabled={disabled} onClick={() => run('stop')}>STOP</button>
        <button type="button" className="secondary-button" disabled={disabled} onClick={() => run('replay')}>PUSTIT ZNOVU</button>
      </div>
    </div>
  );
}

function issueLocation(item: RepairQueueItem): string {
  const round = item.issue.reference.roundPosition;
  const question = item.issue.reference.questionNumber;
  if (round !== undefined && question !== undefined) return `${round}. kolo · otázka ${question}`;
  if (round !== undefined) return `${round}. kolo`;
  return 'Kvíz';
}

export function QuizRepairPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const readOnly = !can('quiz.edit') || !can('quiz.answers.edit');
  const [quiz, setQuiz] = useState<EditorQuiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);
  const [initialBlockers, setInitialBlockers] = useState<number | null>(null);
  const [activeKey, setActiveKey] = useState<string>();
  const [choiceSelection, setChoiceSelection] = useState<number | null>(null);
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const [initialLoadMs, setInitialLoadMs] = useState<number | null>(null);
  const [lastRevalidateMs, setLastRevalidateMs] = useState<number | null>(null);
  const savedTimer = useRef<number | undefined>(undefined);
  const result = useMemo(() => quiz === null ? null : runQuizPreflight(quiz), [quiz]);
  const queue = useMemo(() => quiz === null || result === null ? [] : buildRepairQueue(quiz, result), [quiz, result]);
  const activeIndex = Math.max(0, queue.findIndex((item) => item.key === activeKey));
  const item = queue[activeIndex];
  const parsedStart = parseHumanTime(startText);
  const parsedEnd = parseHumanTime(endText);
  const timingValid = typeof parsedStart === 'number' && typeof parsedEnd === 'number'
    && parsedStart >= 0 && parsedEnd > parsedStart;
  const dirty = item?.kind === 'choice-answer'
    ? choiceSelection !== null
    : item?.kind === 'video-timing' && item.slide !== undefined
      ? startText !== formatHumanTime(item.slide.clipStartSeconds) || endText !== formatHumanTime(item.slide.clipEndSeconds)
      : false;
  const blocker = useBlocker(dirty);

  const load = useCallback(async () => {
    if (!quizId) {
      setLoadError('Kvíz nelze otevřít, protože chybí jeho identifikátor.');
      setLoading(false);
      return null;
    }
    const startedAt = performance.now();
    setLoadError(null);
    try {
      const loaded = await getEditorQuiz(quizId);
      if (loaded === null) {
        setLoadError('Kvíz nebyl nalezen.');
        return null;
      }
      const loadedResult = runQuizPreflight(loaded);
      const loadedQueue = buildRepairQueue(loaded, loadedResult);
      setQuiz(loaded);
      setInitialBlockers((value) => value ?? loadedResult.blockerCount);
      setActiveKey((value) => loadedQueue.some((entry) => entry.key === value) ? value : loadedQueue[0]?.key);
      setInitialLoadMs(performance.now() - startedAt);
      setStale(false);
      setSaveError(null);
      return loaded;
    } catch {
      setLoadError('Seznam oprav se nepodařilo načíst. Zkontrolujte připojení a zkuste to znovu.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [quizId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (savedTimer.current !== undefined) window.clearTimeout(savedTimer.current); }, []);
  useEffect(() => {
    setChoiceSelection(null);
    setStartText(formatHumanTime(item?.slide?.clipStartSeconds ?? null));
    setEndText(formatHumanTime(item?.slide?.clipEndSeconds ?? null));
    setSaveError(null);
    setStale(false);
  }, [item?.key, item?.slide?.clipEndSeconds, item?.slide?.clipStartSeconds]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const saveCurrent = useCallback(async () => {
    if (quiz === null || item?.slide === undefined || readOnly || saving) return;
    if (item.kind === 'choice-answer' && choiceSelection === null) return;
    if (item.kind === 'video-timing' && !timingValid) return;
    const issueKey = repairIssueKey(item.issue);
    const priorQueue = queue;
    const startedAt = performance.now();
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    setStale(false);
    try {
      if (item.kind === 'choice-answer' && choiceSelection !== null) {
        await repairQuizChoiceAnswer(quiz.id, quiz.revision, item.slide.id, choiceSelection);
      } else if (item.kind === 'video-timing' && typeof parsedStart === 'number' && typeof parsedEnd === 'number') {
        await repairQuizVideoTiming(quiz.id, quiz.revision, item.slide.id, parsedStart, parsedEnd);
      } else return;
      const latest = await getEditorQuiz(quiz.id);
      if (latest === null) throw new Error('Kvíz po uložení nebyl nalezen.');
      const latestResult = runQuizPreflight(latest);
      if (latestResult.issues.some((issue) => repairIssueKey(issue) === issueKey)) {
        throw new Error('Autoritativní kontrola stále hlásí stejný problém. Změna nebyla označena jako hotová.');
      }
      const latestQueue = buildRepairQueue(latest, latestResult);
      setQuiz(latest);
      setActiveKey(nextRepairKey(priorQueue, item.key, latestQueue));
      setLastRevalidateMs(performance.now() - startedAt);
      setSaved(true);
      if (savedTimer.current !== undefined) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 1_300);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === staleEditorMessage) {
        setStale(true);
        setSaveError('Kvíz byl mezitím změněn.');
      } else {
        setSaveError(message || 'Změnu se nepodařilo bezpečně uložit. Kvíz zůstal v autoritativním stavu.');
      }
    } finally {
      setSaving(false);
    }
  }, [choiceSelection, item, parsedEnd, parsedStart, queue, quiz, readOnly, saving, timingValid]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void saveCurrent();
        return;
      }
      if (readOnly || item?.kind !== 'choice-answer' || item.slide === undefined) return;
      const key = event.key.toLowerCase();
      const index = /^[1-6]$/u.test(key) ? Number(key) - 1 : /^[a-f]$/u.test(key) ? key.codePointAt(0)! - 97 : -1;
      if (index >= 0 && index < item.slide.options.length) {
        event.preventDefault();
        setChoiceSelection(index);
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [item, readOnly, saveCurrent]);

  const move = (offset: -1 | 1) => {
    if (dirty && !window.confirm(unsavedWarning)) return;
    const next = queue[activeIndex + offset];
    if (next !== undefined) setActiveKey(next.key);
  };
  const selectIssue = (key: string) => {
    if (dirty && !window.confirm(unsavedWarning)) return;
    setActiveKey(key);
  };

  if (loading && quiz === null) return <QuizLoading label="Načítám opravárenskou frontu…" />;
  if (loadError || quiz === null || result === null) {
    return <QuizErrorState message={loadError ?? 'Kvíz nebyl nalezen.'} onRetry={() => void load()} />;
  }

  const resolved = Math.max(0, (initialBlockers ?? result.blockerCount) - result.blockerCount);
  const canSave = !readOnly && !saving && item?.slide !== undefined
    && ((item.kind === 'choice-answer' && choiceSelection !== null) || (item.kind === 'video-timing' && timingValid));

  return (
    <article
      className="quiz-repair-page"
      data-repair-status={result.status}
      data-blocker-count={result.blockerCount}
      data-warning-count={result.warningCount}
      data-initial-load-ms={initialLoadMs === null ? undefined : initialLoadMs.toFixed(1)}
      data-last-revalidate-ms={lastRevalidateMs === null ? undefined : lastRevalidateMs.toFixed(1)}
    >
      <Link className="back-link" to={`/admin/quizzes/${encodeURIComponent(quiz.id)}/readiness`}>← Kontrola kvízu</Link>
      <header className="repair-header">
        <div>
          <p className="eyebrow">Dobrovolná kontrola obsahu</p>
          <h1>{quiz.title}</h1>
          <p>{result.blockerCount} {result.blockerCount === 1 ? 'problém zbývá' : 'problémů zbývá'}</p>
        </div>
        {readOnly && <span className="read-only-badge">Pouze pro čtení — moderátor</span>}
      </header>

      <section className="repair-progress" aria-label="Připravenost">
        <strong>{resolved} z {initialBlockers ?? result.blockerCount} opraveno</strong>
        <span>Zbývá {result.blockerCount}</span>
        <span>Upozornění {result.warningCount}</span>
        <span>Stav: {result.status === 'BLOCKED' ? 'čeká na opravy' : 'obsahová kontrola dokončena'}</span>
      </section>

      {queue.length > 0 && (
        <nav className="repair-queue-nav" aria-label="Nevyřešené problémy">
          <ol>
            {queue.map((entry, index) => (
              <li key={entry.key}>
                <button
                  type="button"
                  className={entry.key === item?.key ? 'active' : ''}
                  data-repair-issue-code={entry.issue.code}
                  data-round-position={entry.issue.reference.roundPosition}
                  data-question-number={entry.issue.reference.questionNumber}
                  data-repair-kind={entry.kind}
                  aria-current={entry.key === item?.key ? 'step' : undefined}
                  onClick={() => selectIssue(entry.key)}
                >
                  <span>{index + 1}</span>
                  <strong>{issueLocation(entry)}</strong>
                  <small>{humanRepairType(entry)}</small>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {result.blockerCount === 0 ? (
        <section className="repair-complete" aria-live="polite">
          <p className="eyebrow">Kontrola nenašla další nedostatky</p>
          <h2>Obsahová kontrola dokončena.</h2>
          <p>Před večerem proveďte fyzický test projektoru a zvuku.</p>
          <p>{result.warningCount} upozornění zůstává k ruční kontrole. YouTube, HDMI ani fyzický zvuk tímto nejsou garantované.</p>
          <Link className="button-link" to={`/admin/quizzes/${encodeURIComponent(quiz.id)}/readiness`}>Zpět na kontrolu</Link>
        </section>
      ) : item === undefined ? (
        <QuizErrorState message="Položky kontroly se nepodařilo sestavit do fronty." onRetry={() => void load()} />
      ) : (
        <section className="repair-card" aria-labelledby="repair-issue-title">
          <div className="repair-card-heading">
            <div>
              <span>{activeIndex + 1} z {queue.length} · {issueLocation(item)}</span>
              <h2 id="repair-issue-title">{humanRepairType(item)}</h2>
            </div>
            <span className="repair-save-state" role="status" aria-live="polite">{saving ? 'Ukládám…' : saved ? 'Uloženo ✓' : 'Neuloženo'}</span>
          </div>

          {item.slide !== undefined && (
            <div className="repair-question">
              <span>Otázka</span>
              <p>{questionPrompt(item.slide)}</p>
            </div>
          )}

          {item.kind === 'choice-answer' && item.slide !== undefined && (
            <div className="repair-choice-panel">
              <div className="repair-original-answer">
                <strong>Původní odpověď z V1</strong>
                <p>{item.slide.correctAnswer || 'Prázdná hodnota'}</p>
                <small>Tato hodnota se neshoduje jednoznačně s možnostmi. Vyberte správnou možnost:</small>
              </div>
              <fieldset className="repair-options" disabled={readOnly || saving}>
                <legend>Správná možnost</legend>
                {item.slide.options.map((option, index) => (
                  <label key={`${item.slide?.id ?? ''}-${index}`} className="repair-option">
                    <input
                      type="radio"
                      name={`repair-${item.slide?.id ?? ''}`}
                      checked={choiceSelection === index}
                      onChange={() => setChoiceSelection(index)}
                    />
                    <strong>{String.fromCodePoint(65 + index)}</strong>
                    <span>{option}</span>
                    {index < 6 && <kbd>{index + 1}/{String.fromCodePoint(65 + index)}</kbd>}
                  </label>
                ))}
              </fieldset>
              {choiceSelection === null && <p className="repair-hint">Žádná možnost není předem vybraná. Rozhodnutí musí udělat člověk.</p>}
            </div>
          )}

          {item.kind === 'video-timing' && item.slide !== undefined && (
            <>
              <TimingRepair
                slide={item.slide}
                disabled={readOnly || saving}
                startText={startText}
                endText={endText}
                onStartText={setStartText}
                onEndText={setEndText}
              />
              {!timingValid && <p className="field-validation error" role="alert">Vyplňte START a END ve formátu mm:ss nebo mm:ss.s; END musí být po START.</p>}
            </>
          )}

          {item.kind === 'unsupported' && (
            <div className="repair-unsupported">
              <p>{item.issue.message}</p>
              {item.issue.fixTarget !== undefined && (
                <button type="button" className="secondary-button" onClick={() => void navigate(preflightFixUrl(quiz.id, item.issue.fixTarget!))}>Otevřít v editoru</button>
              )}
              <button type="button" className="secondary-button" onClick={() => void load()}>Znovu zkontrolovat</button>
            </div>
          )}

          {saveError && (
            <div className="repair-error" role="alert">
              <strong>{saveError}</strong>
              {stale && <button type="button" className="secondary-button" onClick={() => void load()}>Načíst aktuální stav</button>}
            </div>
          )}

          <div className="repair-actions">
            <button type="button" className="secondary-button" disabled={activeIndex === 0 || saving} onClick={() => move(-1)}>Předchozí problém</button>
            {item.kind !== 'unsupported' && (
              <button type="button" className="primary-button" disabled={!canSave} onClick={() => void saveCurrent()}>Uložit a pokračovat</button>
            )}
            <button type="button" className="secondary-button" disabled={activeIndex >= queue.length - 1 || saving} onClick={() => move(1)}>Další problém</button>
          </div>
          <p className="repair-shortcut-hint">Volbu lze vybrat klávesami 1–6 nebo A–F. Uložení: Ctrl/Cmd+Enter. Automatické ukládání je vypnuté.</p>
        </section>
      )}

      {blocker.state === 'blocked' && (
        <div className="repair-leave-dialog" role="alertdialog" aria-modal="true" aria-labelledby="repair-leave-title">
          <div>
            <h2 id="repair-leave-title">Zahodit neuloženou volbu?</h2>
            <p>Aktuální výběr ani časování ještě nejsou uložené.</p>
            <button type="button" className="secondary-button" onClick={() => blocker.reset()}>Zůstat</button>
            <button type="button" className="danger-button" onClick={() => blocker.proceed()}>Zahodit a odejít</button>
          </div>
        </div>
      )}
    </article>
  );
}
