import { onRequest } from 'firebase-functions/v2/https';

export {
  createLiveSession,
  endLiveSession,
  finishMedia,
  goToSlide,
  hideAnswer,
  nextSlide,
  playMedia,
  previousSlide,
  reportMediaPlayback,
  replayMedia,
  revealAnswer,
  selectRecapQuestion,
  startIntro,
  stopMedia,
} from './live/callables.js';

export {
  createQuiz,
  createQuizSlide,
  deleteQuizSlide,
  duplicateQuizSlide,
  duplicateQuizRound,
  moveQuizQuestionToRound,
  moveQuizRound,
  moveQuizSlide,
  removeQuizRound,
  reorderQuizQuestion,
  repairQuizPreflightIssue,
  updateQuizRound,
  updateQuizMetadata,
  updateQuizSlide,
} from './editor/callables.js';

export {
  archiveEvent,
  cancelEvent,
  createEvent,
  lockEventQuiz,
  updateEvent,
} from './events/callables.js';

export { generatePrintArtifact } from './print/endpoint.js';

export {
  adminCancelEventRegistration,
  adminAddEventTeam,
  adminUpdateEventTeam,
  cancelEventRegistration,
  configureEventRegistration,
  createEventRegistration,
  getEventRegistration,
  updateEventRegistration,
} from './registrations/callables.js';

/** Minimal endpoint that does not initialize Admin SDK or access data. */
export const health = onRequest(
  {
    region: 'europe-west1',
    cors: false,
  },
  (_request, response) => {
    response.status(200).json({ status: 'ok' });
  },
);
export { saveEventScore } from './scoring/callables.js';

export { listRefereeAccess, issueRefereeAccess, changeRefereeAccess, readRefereeEvent, readRefereeHistory, saveRefereeScore } from './referee/callables.js';

export { createEventLiveSession, previewInterimResults, controlInterimResults } from './leaderboard/callables.js';

export { previewFinalResults, controlFinalReveal } from './final-reveal/callables.js';
export { configureEventShow, readEventShowPreferences } from './show-mode/callables.js';

export { dispatchRegistrationEmail, deliverEmailTask } from './email/worker.js';

export { previewEventTeamMessage, createEventTeamMessage, listEventTeamMessages, getEventTeamMessage } from './email/team-callables.js';

export { beginQuizMediaUpload, finalizeQuizMediaUpload } from './media/callables.js';
export { readQuizMedia } from './media/endpoint.js';

export { createQuizRound } from './editor/callables.js';
export { getMyAccess, listAccessUsers, createAccessInvitation, changeAccessInvitation, acceptAccessInvitation, updateAccessMembership, listAccessAudit, revokeMySessions } from './access/callables.js';
export { readAccessData } from './access/reads.js';

export { completeEvent, trashEvent, restoreEvent } from './events/management.js';
export { deleteEvent } from './events/deletion.js';
export { trashQuiz, restoreQuiz } from './quizzes/management.js';
export { readDriveConnection, beginDriveConnection, completeDriveConnection, getDriveFolderPicker, selectDriveFolder, createDriveMediaFolder, disconnectDriveConnection } from './drive/callables.js';
export { requestDriveMediaImport, readDriveMediaImport, processDriveMediaImport } from './drive/import-callables.js';
export { configureDriveMediaCompanion, driveMediaCompanion } from './drive/local-companion.js';
