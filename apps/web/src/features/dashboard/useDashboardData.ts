import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { listEvents } from '../events/eventRepository';
import type { EventRecord } from '../events/types';
import { getQuizDataError } from '../quizzes/presentation';
import { listQuizzes } from '../quizzes/quizRepository';
import type { QuizSummary } from '../quizzes/types';

interface DashboardData {
  scope: string; quizzes: readonly QuizSummary[]; events: readonly EventRecord[];
  quizError: string | null; eventError: string | null; loading: boolean; updatedAt: Date | null;
}
const empty = { quizzes: [], events: [], quizError: null, eventError: null, loading: true, updatedAt: null };

export function useDashboardData() {
  const { can, currentUser, membership } = useAuth();
  const readQuizzes = can('quiz.read'), readEvents = can('event.read');
  const scope = `${currentUser?.uid ?? ''}:${membership?.version ?? 0}:${readQuizzes}:${readEvents}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(false);
  const generation = useRef(0), inFlight = useRef<string | null>(null), lastStarted = useRef(0);
  const [data, setData] = useState<DashboardData>({ ...empty, scope });
  const load = useCallback(async () => {
    if (inFlight.current === scope) return;
    const attempt = ++generation.current;
    inFlight.current = scope; lastStarted.current = Date.now();
    setData(previous => ({ ...(previous.scope === scope ? previous : empty), scope, loading: true, quizError: null, eventError: null }));
    const [quizzes, events] = await Promise.allSettled([
      readQuizzes ? listQuizzes() : Promise.resolve([] as readonly QuizSummary[]),
      readEvents ? listEvents() : Promise.resolve([] as readonly EventRecord[]),
    ]);
    if (attempt !== generation.current || currentScope.current !== scope) return;
    inFlight.current = null;
    setData(previous => {
      const existing = new Map((previous.scope === scope ? previous.events : []).map(event => [event.id, event]));
      return { scope, loading: false, updatedAt: new Date(),
        quizzes: quizzes.status === 'fulfilled' ? quizzes.value : [],
        events: events.status === 'fulfilled' ? events.value.map(event => {
          const current = existing.get(event.id);
          return current && current.revision > event.revision ? current : event;
        }) : [],
        quizError: quizzes.status === 'rejected' ? getQuizDataError(quizzes.reason) : null,
        eventError: events.status === 'rejected' ? 'Seznam akcí se nepodařilo načíst. Zkuste to prosím znovu.' : null };
    });
  }, [scope, readQuizzes, readEvents]);

  useEffect(() => {
    mounted.current = true;
    void load();
    // Refresh on return and once per visible minute, bounded and without roster reads.
    const onReturn = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastStarted.current >= 30_000) void load();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    const timer = readEvents ? window.setInterval(onReturn, 60_000) : undefined;
    return () => {
      mounted.current = false;
      generation.current++; inFlight.current = null;
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [load, readEvents]);

  const updateEvent = (event: EventRecord) => {
    if (!mounted.current || currentScope.current !== scope) return;
    setData(previous => previous.scope === scope
      ? { ...previous, events: previous.events.map(item => item.id === event.id && item.revision <= event.revision ? event : item) } : previous);
  };
  return { ...(data.scope === scope ? data : { ...empty, scope }), load, updateEvent };
}
