import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import {
  formatQuizDate,
  getQuizDataError,
  questionTypeLabels,
  roundTypeLabels,
} from '../../features/quizzes/presentation';
import { getQuizDetail } from '../../features/quizzes/quizRepository';
import type { QuizDetail } from '../../features/quizzes/types';
import { QuizStatusControl } from '../../features/quizzes/QuizStatusControl';
import { LiveStartButton } from '../../features/live/LiveStartButton';

export function QuizDetailPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const [quiz, setQuiz] = useState<QuizDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadQuiz = useCallback(async () => {
    if (!quizId) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const result = await getQuizDetail(quizId);
      setQuiz(result);
      setNotFound(result === null);
    } catch (loadError) {
      setError(getQuizDataError(loadError));
    } finally {
      setLoading(false);
    }
  }, [quizId]);

  useEffect(() => {
    void loadQuiz();
  }, [loadQuiz]);

  if (loading) {
    return <QuizLoading label="Načítám detail kvízu…" />;
  }

  if (error) {
    return <QuizErrorState message={error} onRetry={() => void loadQuiz()} />;
  }

  if (notFound || !quiz) {
    return (
      <section className="quiz-state-card">
        <span className="state-symbol" aria-hidden="true">?</span>
        <div>
          <h2>Kvíz neexistuje</h2>
          <p>Požadovaný kvíz nebyl v lokální knihovně nalezen.</p>
        </div>
        <Link className="secondary-link" to="/admin/quizzes">Zpět do knihovny</Link>
      </section>
    );
  }

  return (
    <article className="quiz-detail">
      <Link className="back-link" to="/admin/quizzes">← Zpět do knihovny</Link>

      <header className="quiz-detail-heading">
        <div>
          <div className="detail-kicker">
            <QuizStatusControl quiz={quiz} onChanged={loadQuiz} />
            <span>Poslední úprava {formatQuizDate(quiz.updatedAt)}</span>
          </div>
          <h1>{quiz.title}</h1>
          <p className="lead">{quiz.description}</p>
        </div>
        <div className="quiz-detail-side">
          <dl className="quiz-metrics">
            <div><dt>Kola</dt><dd>{quiz.roundCount}</dd></div>
            <div><dt>Otázky</dt><dd>{quiz.questionCount}</dd></div>
          </dl>
          <LiveStartButton quizId={quiz.id} />
          <Link className="secondary-link" to={`/admin/quizzes/${encodeURIComponent(quiz.id)}/readiness`}>Zkontrolovat připravenost</Link>
          <Link className="secondary-link" to={`/admin/quizzes/${encodeURIComponent(quiz.id)}/edit`}>Otevřít editor</Link>
        </div>
      </header>

      <section className="round-list" aria-label="Kola a otázky">
        {quiz.rounds.length === 0 ? (
          <div className="quiz-state-card compact">
            <div><h2>Kvíz zatím nemá kola</h2><p>Otevřete editor a přidejte první kolo.</p></div>
          </div>
        ) : quiz.rounds.map((round) => (
          <section className="round-card" key={round.id}>
            <header>
              <span className="round-number">{String(round.position).padStart(2, '0')}</span>
              <div>
                <p>{roundTypeLabels[round.type]}</p>
                <h2>{round.title}</h2>
              </div>
              <span className="question-count">{round.questionCount} {round.questionCount === 1 ? 'otázka' : round.questionCount < 5 ? 'otázky' : 'otázek'}</span>
            </header>

            {round.questions.length === 0 ? (
              <p className="round-empty">{round.questionCount > 0
                ? 'Detail otázek teď není dostupný. Zkuste stránku načíst znovu.'
                : 'V tomto kole zatím nejsou otázky.'}</p>
            ) : (
              <ol className="question-list">
                {round.questions.map((question) => (
                  <li key={question.id}>
                    <span className="question-position">{question.position}</span>
                    <div>
                      <span className="question-type">{questionTypeLabels[question.type]}</span>
                      <p>{question.prompt}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </section>
    </article>
  );
}
