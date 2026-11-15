import { scopeAllows } from '@filmovy-kviz/quiz-domain';
import { FunctionsError } from 'firebase/functions';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { duplicateQuiz } from '../editor/editorApi';
import type { QuizSummary } from './types';

type Attempt = {
  readonly requestId: string;
  readonly revision: number;
  readonly title: string;
  readonly entryKey?: string;
  readonly destination?: string;
};
const confirmedEvent = 'justkviz:quiz-duplicate-confirmed';
const duplicationPermissions = [
  'quiz.read', 'quiz.export', 'quiz.answers.read', 'quiz.notes.read',
  'quiz.create', 'quiz.edit', 'quiz.answers.edit', 'quiz.notes.edit', 'quiz.media.attach',
] as const;

function pendingAttempt(key: string): Attempt | undefined {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<Attempt>;
    if (typeof value.requestId !== 'string' || !/^[a-z0-9-]{36}$/iu.test(value.requestId)
      || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0
      || typeof value.title !== 'string' || value.title.length > 300 || !value.title.trim()) return undefined;
    const destination = typeof value.destination === 'string' && /^quiz_[a-f0-9]{64}$/u.test(value.destination) ? value.destination : undefined;
    return {
      requestId: value.requestId, revision: value.revision, title: value.title,
      ...(typeof value.entryKey === 'string' ? { entryKey: value.entryKey } : {}),
      ...(destination ? { destination } : {}),
    };
  } catch { return undefined; }
}

function saveAttempt(key: string, attempt?: Attempt) {
  try {
    if (attempt) sessionStorage.setItem(key, JSON.stringify(attempt));
    else sessionStorage.removeItem(key);
    return true;
  } catch { return false; }
}

function DuplicateQuizDialog({ quiz, storageKey, entryKey, onClose }: {
  readonly quiz: QuizSummary;
  readonly storageKey: string;
  readonly entryKey: string;
  readonly onClose: () => void;
}) {
  const navigate = useNavigate();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [attempt, setAttempt] = useState(() => pendingAttempt(storageKey));
  const [title, setTitle] = useState(attempt?.title ?? `${quiz.title.slice(0, 292)} (kopie)`);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const modal = dialog.current;
    const previous = document.activeElement;
    modal?.showModal();
    return () => {
      modal?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = title.trim();
    if (!name || busy.current) return;
    const current = { ...(attempt ?? { title: name, revision: quiz.revision ?? 0, requestId: crypto.randomUUID() }), entryKey };
    busy.current = true;
    setPending(true);
    setAttempt(current);
    setError(undefined);
    saveAttempt(storageKey, current);
    try {
      const result = await duplicateQuiz(quiz.id, current.revision, current.title, current.requestId);
      if (pendingAttempt(storageKey)?.requestId === current.requestId && saveAttempt(storageKey, { ...current, destination: result.quizId })) {
        window.dispatchEvent(new CustomEvent(confirmedEvent, { detail: storageKey }));
      } else if (dialog.current?.isConnected) {
        await navigate(`/admin/quizzes/${encodeURIComponent(result.quizId)}/edit`);
      }
    } catch (reason) {
      const code = reason instanceof FunctionsError ? reason.code : '';
      if (['functions/permission-denied', 'functions/failed-precondition', 'functions/invalid-argument', 'functions/not-found',
        'functions/aborted', 'functions/resource-exhausted', 'functions/already-exists'].includes(code)) {
        if (pendingAttempt(storageKey)?.requestId === current.requestId) saveAttempt(storageKey);
        setAttempt(undefined);
      }
      if (code === 'functions/aborted') setError('Kvíz se mezitím změnil. Načtěte stránku znovu a zopakujte duplikování.');
      else if (code === 'functions/permission-denied') setError('Pro duplikování tohoto kvízu nemáte všechna potřebná oprávnění.');
      else if (reason instanceof FunctionsError && code === 'functions/failed-precondition' && reason.details === 'quiz-copy-media-unsupported') {
        setError('Kvíz obsahuje vlastní nebo soukromá média. Vytvoření úplné kopie pro tento typ médií zatím není dostupné.');
      } else if (code === 'functions/resource-exhausted') {
        setError('Volbu kopie teď nelze dokončit kvůli limitu velikosti kvízu nebo počtu povolených kvízů.');
      } else if (code === 'functions/already-exists') {
        setError('Tento pokus byl použit pro jinou kopii. Zkontrolujte knihovnu kvízů.');
      } else if (code === 'functions/failed-precondition' || code === 'functions/not-found' || code === 'functions/invalid-argument') {
        setError('Kvíz v této podobě nelze duplikovat.');
      } else setError('Kopii se nepodařilo potvrdit. Tlačítkem „Zkusit znovu“ můžete zopakovat stejný pokus.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <dialog ref={dialog} className="editor-dialog quiz-duplicate-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy.current) onClose(); }}>
    <form onSubmit={event => void submit(event)} aria-busy={pending}>
      <h2 id={titleId}>Duplikovat kvíz</h2>
      <p>Vytvoříte nový koncept z uloženého kvízu „{quiz.title}“.</p>
      <label className="form-field">
        Název kopie
        <input required autoFocus maxLength={300} value={title} readOnly={Boolean(attempt) || pending} onChange={event => setTitle(event.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="editor-dialog-actions">
        <button type="button" className="secondary-button" disabled={pending} onClick={onClose}>Zavřít</button>
        <button type="submit" className="primary-button" disabled={pending || !title.trim()}>{pending ? 'Vytvářím kopii…' : attempt ? 'Zkusit znovu' : 'Vytvořit kopii'}</button>
      </div>
    </form>
  </dialog>;
}

export function DuplicateQuizButton({ quiz }: { readonly quiz: QuizSummary }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { key: entryKey } = useLocation();
  const { can, membership } = useAuth();
  const eligible = membership !== null && membership !== undefined && quiz.disposition !== 'trash'
    && scopeAllows(membership.quizzes, quiz.id, membership.uid, quiz.createdBy) && duplicationPermissions.every(permission => can(permission));
  const storageKey = membership ? `justkviz.quizDuplicate.${encodeURIComponent(membership.uid)}.${encodeURIComponent(quiz.id)}` : null;
  useEffect(() => {
    if (!storageKey || !eligible) return;
    const openConfirmed = (event?: Event) => {
      if (event instanceof CustomEvent && event.detail !== storageKey) return;
      const attempt = pendingAttempt(storageKey);
      if (attempt?.entryKey === entryKey && attempt.destination) {
        saveAttempt(storageKey);
        void navigate(`/admin/quizzes/${encodeURIComponent(attempt.destination)}/edit`);
      }
    };
    // Creating a scoped copy can remount the authorization boundary.
    window.addEventListener(confirmedEvent, openConfirmed);
    openConfirmed();
    return () => window.removeEventListener(confirmedEvent, openConfirmed);
  }, [eligible, entryKey, navigate, storageKey]);
  if (!eligible || !storageKey) return null;
  return <>
    <button type="button" className="secondary-button" aria-label={`Duplikovat kvíz ${quiz.title}`} onClick={() => {
      const confirmed = pendingAttempt(storageKey)?.destination;
      if (confirmed) {
        saveAttempt(storageKey);
        void navigate(`/admin/quizzes/${encodeURIComponent(confirmed)}/edit`);
      } else setOpen(true);
    }}>Duplikovat kvíz</button>
    {open && <DuplicateQuizDialog key={storageKey} quiz={quiz} storageKey={storageKey} entryKey={entryKey} onClose={() => setOpen(false)} />}
  </>;
}
