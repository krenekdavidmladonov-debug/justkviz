import { useContext, useLayoutEffect, useState, type CSSProperties } from 'react';
import { ProjectorMotionContext } from './ProjectorMotion';

export function useProjectorPoints(halfPoints: number, animated: boolean, delay = 0) {
  const [points, setPoints] = useState(halfPoints);
  useLayoutEffect(() => {
    if (!animated) { setPoints(halfPoints); return; }
    setPoints(0);
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - started - delay) / (1470 - delay)));
      setPoints(Math.round(halfPoints * progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animated, halfPoints, delay]);
  return animated ? points : halfPoints;
}

export function projectorRowDelay(rank: number, rows: readonly { rank: number }[]): number {
  const ranks = [...new Set(rows.map(row => row.rank))].sort((a, b) => b - a);
  return Math.max(0, ranks.indexOf(rank)) * Math.min(100, 400 / Math.max(1, ranks.length - 1));
}
export function projectorRowStyle(rank: number, rows: readonly { rank: number; halfPoints: number }[]): CSSProperties {
  return { '--pm-row-delay': `${projectorRowDelay(rank, rows)}ms`,
    '--pm-bar': Math.max(0, rows.find(row => row.rank === rank)?.halfPoints ?? 0) / Math.max(1, ...rows.map(row => row.halfPoints)) } as CSSProperties;
}
export function ProjectorResultPoints({ halfPoints, delay = 0 }: { readonly halfPoints: number; readonly delay?: number }) {
  const motion = useContext(ProjectorMotionContext);
  const points = useProjectorPoints(halfPoints, Boolean(motion?.animated), delay);
  return Number(points / 2).toLocaleString('cs-CZ');
}
