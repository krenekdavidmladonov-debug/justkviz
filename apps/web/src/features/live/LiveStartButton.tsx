import { FirebaseError } from 'firebase/app';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { HumanError, type HumanErrorValue } from '../../ui/HumanError';
import { createLiveSession } from './liveApi';

/** Editorial checks are optional; the callable enforces technical launch safeguards. */
export function LiveStartButton({ quizId }: { readonly quizId: string }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const busy = useRef(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<HumanErrorValue | null>(null);

  async function start() {
    if (busy.current || !can('event.live')) return;
    busy.current = true; setStarting(true); setError(null);
    try {
      const session = await createLiveSession(quizId);
      void navigate(`/admin/live/${encodeURIComponent(session.sessionId)}`);
    } catch (failure) {
      setError({
        title: 'Kvíz se nepodařilo spustit',
        message: failure instanceof FirebaseError && failure.code === 'functions/failed-precondition'
          ? 'Kvíz nemá přehratelné stránky nebo je jeho struktura neúplná. Otevřete editor a zkontrolujte uložené slidy.' : 'Zkontrolujte připojení a oprávnění a zkuste to znovu.',
        technicalCode: failure instanceof FirebaseError ? failure.code.toUpperCase().replaceAll('/', '_').replaceAll('-', '_') : 'LIVE_SESSION_CREATE_FAILED',
      });
    } finally { busy.current = false; setStarting(false); }
  }

  if (!can('event.live')) return null;
  return <div className="quiz-start-control">
    <button type="button" className="primary-button" disabled={starting} aria-busy={starting} onClick={() => void start()}>{starting ? 'Spouštím…' : 'Spustit kvíz'}</button>
    {error && <HumanError error={error} onRetry={() => void start()} />}
  </div>;
}
