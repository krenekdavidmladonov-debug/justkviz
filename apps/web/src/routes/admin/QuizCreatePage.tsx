import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { FunctionsError } from 'firebase/functions';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { createQuiz } from '../../features/editor/editorApi';
import { HumanError } from '../../ui/HumanError';
import { loadCreationAttempt, persistCreationAttempt, clearCreationAttempt, newCreationAttempt } from './quizCreationRecovery';

function creationError(error: unknown): { readonly message: string; readonly technicalCode: string } {
  if (error instanceof FunctionsError) {
    if (error.code === 'functions/invalid-argument') {
      return { message: 'Server odmítl údaje kvízu. Po kontrole knihovny začněte nový pokus s opraveným názvem.', technicalCode: error.code };
    }
    if (error.code === 'functions/permission-denied') {
      return { message: 'Kvíz může vytvořit pouze administrátor.', technicalCode: error.code };
    }
    if (error.code === 'functions/already-exists') {
      return { message: 'Tento pokus o vytvoření už byl použit s jiným názvem. Vraťte se do knihovny a zkontrolujte vytvořené kvízy.', technicalCode: error.code };
    }
    return { message: 'Kvíz se nepodařilo vytvořit. Zadaný název zůstal zachovaný.', technicalCode: error.code };
  }
  return { message: 'Kvíz se nepodařilo vytvořit. Zadaný název zůstal zachovaný.', technicalCode: 'QUIZ_CREATE_FAILED' };
}

interface CreationEntryProps { readonly isCurrentEntry: (entryKey: string) => boolean }
type CreateRequest = ReturnType<typeof createQuiz>;
// A selected-resource self-grant can remount the same submitted attempt.
const pendingCreates = new Map<string, CreateRequest>();

export function QuizCreatePage({ isCurrentEntry }: CreationEntryProps) {
  const { can, currentUser } = useAuth();
  if (!currentUser || !can('quiz.create')) return (
    <section className="quiz-state-card">
      <div><h2>Pouze pro administrátora</h2><p>Moderátor může kvízy prohlížet, ale nemůže vytvářet nový obsah.</p></div>
      <Link className="secondary-link" to="/admin/quizzes">Zpět na kvízy</Link>
    </section>
  );
  return <QuizCreationForm key={currentUser.uid} actorUid={currentUser.uid} isCurrentEntry={isCurrentEntry} />;
}

function QuizCreationForm({ actorUid, isCurrentEntry }: CreationEntryProps & { readonly actorUid: string }) {
  const navigate = useNavigate();
  const { key: entryKey } = useLocation();
  const [attempt, setAttempt] = useState(() => loadCreationAttempt(actorUid));
  const attemptRef = useRef(attempt); attemptRef.current = attempt;
  const [title, setTitle] = useState(attempt.submittedTitle ?? '');
  const [libraryChecked, setLibraryChecked] = useState(false);
  const busy = useRef(false);
  const active = useRef(false);
  const observeCreate = useRef<((request: CreateRequest) => Promise<void>) | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ readonly message: string; readonly technicalCode: string } | null>(null);
  const ownsAttempt = (requestId: string) => active.current && attemptRef.current.requestId === requestId && isCurrentEntry(entryKey);
  const scope = JSON.stringify([actorUid, attempt.requestId]);

  useLayoutEffect(() => {
    active.current = true;
    let observing = true;
    const observe = async (request: CreateRequest) => {
      const submitted = attemptRef.current;
      busy.current = true; setPending(true);
      try {
        const result = await request;
        if (!observing || !ownsAttempt(submitted.requestId)) return;
        clearCreationAttempt(submitted);
        await navigate(`/admin/quizzes/${encodeURIComponent(result.quizId)}/edit`);
      } catch (createError) {
        if (observing && ownsAttempt(submitted.requestId)) setError(creationError(createError));
      } finally {
        if (observing) { busy.current = false; setPending(false); }
      }
    };
    observeCreate.current = observe;
    const request = pendingCreates.get(scope);
    if (request) void observe(request);
    else { busy.current = false; setPending(false); }
    return () => { observing = false; active.current = false; observeCreate.current = null; };
  }, [entryKey, isCurrentEntry, navigate, scope]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const observe = observeCreate.current;
    if (!observe || busy.current || pendingCreates.has(scope) || !ownsAttempt(attempt.requestId)) return;
    const normalizedTitle = title.trim();
    if (normalizedTitle === '') {
      setError({ message: 'Zadejte název nového kvízu.', technicalCode: 'QUIZ_TITLE_REQUIRED' });
      return;
    }
    busy.current = true;
    const submitted = {...attempt, submittedTitle: attempt.submittedTitle ?? normalizedTitle};
    attemptRef.current = submitted;
    setAttempt(submitted); persistCreationAttempt(submitted);
    setPending(true);
    setError(null);
    try {
      const request = createQuiz(submitted.submittedTitle, submitted.requestId);
      pendingCreates.set(scope, request);
      const clear = () => { if (pendingCreates.get(scope) === request) pendingCreates.delete(scope); };
      void request.then(clear, clear);
      void observe(request);
    } catch (createError) {
      busy.current = false; setPending(false);
      if (ownsAttempt(submitted.requestId)) setError(creationError(createError));
    }
  };


  return (
    <section className="event-editor-page quiz-create-page">
      <Link className="back-link" to="/admin/quizzes">← Zpět na kvízy</Link>
      <header className="event-page-heading event-form-heading">
        <h1>Nový kvíz</h1>
        <p className="lead">Začněte názvem. Kolo a první otázku přidáte hned potom v editoru.</p>
      </header>
      {error && <HumanError error={{ title: 'Kvíz nelze vytvořit', ...error }} />}
      <form className="event-form" aria-busy={pending} onSubmit={(event) => void submit(event)}>
        <fieldset className="event-form-section" disabled={pending}>
          <legend>Základní údaje</legend>
          <label className="form-field">
            <span>Název kvízu</span>
            <input required autoFocus readOnly={attempt.submittedTitle !== null} maxLength={300} value={title} onChange={(event) => { setTitle(event.target.value); setError(null); }} />
          </label>
        </fieldset>
        <div className="event-form-actions">
          <button className="primary-button" type="submit" disabled={pending || title.trim() === ''}>{pending ? 'Vytvářím…' : attempt.submittedTitle === null ? 'Vytvořit' : 'Zkusit znovu'}</button>
        </div>
        {attempt.submittedTitle !== null && <div className="event-form-section">
          <p>Při nejasném výsledku opakujte stejný pokus. Před novým pokusem <Link to="/admin/quizzes">zkontrolujte knihovnu kvízů</Link>, zda už kvíz vznikl.</p>
          <label><input type="checkbox" checked={libraryChecked} disabled={pending} onChange={event => setLibraryChecked(event.target.checked)} /> Zkontroloval(a) jsem knihovnu a chci začít nový pokus.</label>
          <button type="button" className="secondary-button" disabled={pending || !libraryChecked} onClick={() => {
            if (busy.current || !ownsAttempt(attempt.requestId)) return;
            clearCreationAttempt(attempt);
            const fresh = newCreationAttempt(actorUid); attemptRef.current = fresh;
            persistCreationAttempt(fresh); setAttempt(fresh); setTitle(''); setLibraryChecked(false); setError(null);
          }}>Začít nový pokus</button>
        </div>}
      </form>
    </section>
  );
}
