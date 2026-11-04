import { securedOnCall } from '../access/authorization.js';
import { authorizeStaff } from '../live/callables.js';
import { parseScoreRequest, parseRoundScoreRequest } from './validation.js';
import { commitScore, commitRoundScores } from './core.js';

export const saveEventScore = securedOnCall('saveEventScore', { region: 'europe-west1', cors: true }, async request => {
  const actor = authorizeStaff(request.auth);
  if (typeof request.data === 'object' && request.data !== null && 'scores' in request.data) {
    return commitRoundScores(parseRoundScoreRequest(request.data), () => Promise.resolve({ key: actor.uid, audit: { actorUid: actor.uid } }));
  }
  return commitScore(parseScoreRequest(request.data), () => Promise.resolve({ key: actor.uid, audit: { actorUid: actor.uid } }));
});
