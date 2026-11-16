import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { getEditorQuiz } from '../../features/editor/editorRepository';
import type { EditorQuiz } from '../../features/editor/types';
import { LiveStartButton } from '../../features/live/LiveStartButton';
import { QuizPreflightPanel } from '../../features/preflight/QuizPreflightPanel';
import { runQuizPreflight } from '../../features/preflight/validation';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';

export function QuizPreflightPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const [quiz, setQuiz] = useState<EditorQuiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const result = useMemo(() => quiz === null ? null : runQuizPreflight(quiz), [quiz]);

  const load = useCallback(async () => {
    if (!quizId) { setNotFound(true); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const loaded = await getEditorQuiz(quizId);
      setQuiz(loaded); setNotFound(loaded === null);
    } catch {
      setError('Kontrolu kvízu se nepodařilo načíst. Zkontrolujte připojení a zkuste to znovu.');
    } finally { setLoading(false); }
  }, [quizId]);
  useEffect(() => { void load(); }, [load]);

  if (loading && quiz === null) return <QuizLoading label="Kontroluji celý kvíz…" />;
  if (error) return <QuizErrorState message={error} onRetry={() => void load()} />;
  if (notFound || quiz === null || result === null) return <QuizErrorState message="Kvíz nebyl nalezen." onRetry={() => void load()} />;

  return <article className="quiz-preflight-page">
    <Link className="back-link" to={`/admin/quizzes/${encodeURIComponent(quiz.id)}`}>← Detail kvízu</Link>
    <QuizPreflightPanel quizId={quiz.id} result={result} onRecheck={() => void load()} />
    <section className="preflight-start-card" aria-label="Spuštění kvízu">
      <strong>Kontrola je dobrovolná.</strong>
      <p>Nalezené položky si můžete projít a opravit. Spuštění nevyžaduje dokončení kontroly ani potvrzení doporučení.</p>
      {result.blockerCount > 0 && <Link className="button-link repair-entry-link" to={`/admin/quizzes/${encodeURIComponent(quiz.id)}/readiness/repair`}>Projít nalezené položky</Link>}
      <LiveStartButton quizId={quiz.id} />
    </section>
  </article>;
}
