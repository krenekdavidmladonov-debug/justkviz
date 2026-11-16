import { createContext } from 'react';
import type { PublicLiveState } from '../live/types';

/** Only the projector's server-confirmed ordinary question may opt into the pilot. */
export const LocalProjectorMediaContext = createContext<PublicLiveState | null>(null);

export function localProjectorMediaEpoch(state: PublicLiveState): string {
  return [state.sessionId, state.revision, state.slidePosition, state.mediaGeneration].join(':');
}
