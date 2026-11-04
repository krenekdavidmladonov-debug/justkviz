import { scopeAllows } from '@filmovy-kviz/quiz-domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import { formatQuizDate, getQuizDataError } from '../../features/quizzes/presentation';
import { QuizStatusControl } from '../../features/quizzes/QuizStatusControl';
import { listQuizzes } from '../../features/quizzes/quizRepository';
import type { QuizSummary } from '../../features/quizzes/types';
import { QuizTrashDialog } from '../../features/quizzes/QuizTrashDialog';
import { quizTrashError, restoreQuiz, type QuizTrashResult } from '../../features/quizzes/quizTrashApi';

function TrashIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>;
}

export function QuizLibraryPage() {
  const { can, membership } = useAuth();
  const canDelete = can('quiz.delete');
  const [quizzes, setQuizzes] = useState<readonly QuizSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'active' | 'trash'>('active');
  const [deleting, setDeleting] = useState<QuizSummary | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const restoringBusy = useRef(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadQuizzes = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setQuizzes(await listQuizzes(canDelete ? { includeTrash: true } : undefined));
    } catch (loadError) {
      setError(getQuizDataError(loadError));
    } finally {
      setLoading(false);
    }
  }, [canDelete]);

  useEffect(() => {
    void loadQuizzes();
  }, [loadQuizzes]);

  const inScope = (quiz: QuizSummary) => Boolean(membership && scopeAllows(membership.quizzes, quiz.id, membership.uid, quiz.createdBy));
  const changed = (result: QuizTrashResult, title: string) => {
    setQuizzes(current => current.map(quiz => quiz.id === result.quizId ? { ...quiz, disposition: result.disposition, revision: result.revision } : quiz));
    setActionError(null);
    setNotice(result.disposition === 'trash' ? `Kvíz „${title}“ byl přesunut do koše.` : `Kvíz „${title}“ byl obnoven do knihovny.`);
    requestAnimationFrame(() => noticeRef.current?.focus());
  };
  const restore = async (quiz: QuizSummary) => {
    if (restoringBusy.current) return;
    restoringBusy.current = true;
    setRestoring(quiz.id);
    setActionError(null);
    try { changed(await restoreQuiz(quiz.id, quiz.revision ?? 0), quiz.title); }
    catch (reason) { setActionError(quizTrashError(reason)); }
    finally { restoringBusy.current = false; setRestoring(null); }
  };
  const visibleQuizzes = quizzes.filter(quiz => (quiz.disposition ?? 'active') === view);

  if (loading) {
    return <QuizLoading />;
  }

  if (error) {
    return <QuizErrorState message={error} onRetry={() => void loadQuizzes()} />;
  }

  return (
    <section className="quiz-library">
      <header className="section-heading">
        <div>
          <p className="eyebrow">Administrace</p>
          <h1>Kvízy</h1>
          <p className="lead">Připravené, rozpracované a archivované kvízy na jednom místě.</p>
        </div>
        <div className="quiz-library-actions">
          {can('quiz.create') && <Link className="primary-button" to="/admin/quizzes/new">+ Nový kvíz</Link>}
          <p className="section-count" aria-label="Souhrn knihovny">
            {visibleQuizzes.length} {visibleQuizzes.length === 1 ? 'kvíz' : visibleQuizzes.length < 5 ? 'kvízy' : 'kvízů'}
          </p>
        </div>
      </header>

      {canDelete && <nav className="quiz-library-filters" aria-label="Přehled kvízů">
        <button className="secondary-button" aria-pressed={view === 'active'} onClick={() => setView('active')}>Knihovna</button>
        <button className="secondary-button" aria-pressed={view === 'trash'} onClick={() => setView('trash')}>Koš</button>
      </nav>}
      {notice && <p ref={noticeRef} tabIndex={-1} role="status">{notice}</p>}
      {actionError && <div role="alert"><p>{actionError}</p><button className="secondary-button" onClick={() => void loadQuizzes()}>Načíst knihovnu znovu</button></div>}
      {visibleQuizzes.length === 0 ? (
        <div className="quiz-state-card">
          <div>
            <h2>{view === 'trash' ? 'Koš je prázdný' : 'Zatím tu nejsou žádné kvízy'}</h2>
            <p>{view === 'trash' ? 'Smazané kvízy zde můžete obnovit do knihovny.' : 'Jakmile bude kvíz vytvořený, objeví se v této knihovně.'}</p>
          </div>
          <div className="quiz-empty-actions">
            {can('quiz.create') && <Link className="primary-button" to="/admin/quizzes/new">+ Nový kvíz</Link>}
            <button className="secondary-button" type="button" onClick={() => void loadQuizzes()}>Načíst znovu</button>
          </div>
        </div>
      ) : (
        <div className="quiz-table-wrap">
          <table className="quiz-table">
            <thead>
              <tr>
                <th>Kvíz</th>
                <th>Stav</th>
                <th>Kola</th>
                <th>Otázky</th>
                <th>Poslední úprava</th>
                <th><span className="visually-hidden">Akce</span></th>
              </tr>
            </thead>
            <tbody>
              {visibleQuizzes.map((quiz) => (
                <tr key={quiz.id}>
                  <td data-label="Kvíz">
                    <Link className="quiz-title-link" to={`/admin/quizzes/${quiz.id}`}>{quiz.title}</Link>
                    <span className="quiz-description">{quiz.description}</span>
                  </td>
                  <td data-label="Stav"><QuizStatusControl quiz={quiz} disabled={view !== 'active' || !inScope(quiz)} onChanged={loadQuizzes} /></td>
                  <td data-label="Kola">{quiz.roundCount}</td>
                  <td data-label="Otázky">{quiz.questionCount}</td>
                  <td data-label="Poslední úprava">{formatQuizDate(quiz.updatedAt)}</td>
                  <td className="quiz-library-row-actions">
                    <div className="quiz-library-row-actions-group">
                    {view === 'active' ? <>
                      <Link className="secondary-link" to={`/admin/quizzes/${quiz.id}`} aria-label={`Otevřít kvíz ${quiz.title}`}>Otevřít</Link>
                      {can('quiz.edit') && inScope(quiz) && <Link className="secondary-link" to={`/admin/quizzes/${quiz.id}/edit`} aria-label={`Upravit kvíz ${quiz.title}`}>Upravit</Link>}
                      {canDelete && inScope(quiz) && <button className="danger-button" aria-label={`Smazat kvíz ${quiz.title}`} onClick={() => { setNotice(null); setActionError(null); setDeleting(quiz); }}><TrashIcon /> Smazat</button>}
                    </> : canDelete && inScope(quiz) && <button className="secondary-button" disabled={restoring !== null} aria-label={`Obnovit kvíz ${quiz.title}`} onClick={() => void restore(quiz)}>{restoring === quiz.id ? 'Obnovuji…' : 'Obnovit'}</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {deleting && <QuizTrashDialog quiz={deleting} onClose={() => setDeleting(null)} onDeleted={result => changed(result, deleting.title)} onReload={() => void loadQuizzes()} />}
    </section>
  );
}
