import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PublicLiveState } from '../live/types';

export const ProjectorMotionContext = createContext<{ animated: boolean; key: string } | undefined>(undefined);
export function useProjectorTransition(state: PublicLiveState, enabled: boolean) {
  const key = JSON.stringify([state.slidePosition, state.recapQuestionPosition, state.answerRevealed, state.renderMode, state.interimResults?.versionId, state.interimResults?.page, state.finalReveal?.versionId, state.finalReveal?.mode, state.finalReveal?.rank, state.finalReveal?.page]);
  const previous = useRef<{ session: string; revision: number; key: string } | undefined>(undefined);
  const [active, setActive] = useState<string>();
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = { session: state.sessionId, revision: state.revision, key };
    if (!enabled || reduced) { setActive(undefined); return; }
    if (last?.session !== state.sessionId) { setActive(undefined); return; }
    if (state.revision <= last.revision || last.key === key) return;
    setActive(key);
  }, [key, state.sessionId, state.revision, enabled, reduced]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setActive(undefined), 1500);
    return () => window.clearTimeout(timer);
  }, [active]);
  return { animated: enabled && !reduced && active === key, key };
}

/** Word spans keep a complete accessible label and use only opacity/transform. */
export function ProjectorWords({ text }: { readonly text: string }) {
  const motion = useContext(ProjectorMotionContext);
  if (!motion?.animated) return text;
  const words = text.split(/(\s+)/u), count = words.filter(word => word.trim()).length;
  let index = 0;
  const step = count > 1 ? Math.min(40, 480 / (count - 1)) : 0;
  return <span aria-label={text}>{words.map((word, i) => word.trim()
    ? <span aria-hidden="true" className="pm-word" key={i} style={{ animationDelay: `${index++ * step}ms` }}>{word}</span> : word)}</span>;
}
