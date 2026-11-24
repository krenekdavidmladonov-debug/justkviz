import type * as EventApi from '../../apps/web/src/features/events/eventApi';
import type * as EventRepository from '../../apps/web/src/features/events/eventRepository';
import type * as QuizRepository from '../../apps/web/src/features/quizzes/quizRepository';
import type * as EditorRepository from '../../apps/web/src/features/editor/editorRepository';
import type { EventMutationResponse, EventRecord } from '../../apps/web/src/features/events/types';
import type { Permission } from '../../packages/quiz-domain/src/access';
import { createEventFormAuth } from './events-form-ux.auth';
import { createEventFormData, eventFormRecord } from './events-form-ux.data';

declare global {
  interface Window {
    uxCalls: unknown[];
    uxMutationResults: { operation: 'create' | 'update'; response: EventMutationResponse }[];
    uxEventReads: (EventRecord | null)[];
  }
}
window.uxCalls = [];
window.uxMutationResults = [];
window.uxEventReads = [];
const params = new URLSearchParams(window.location.search);
const auth = createEventFormAuth(params.get('role'));
export const useAuth = () => auth;
const initial = { ...eventFormRecord(), ...(params.has('lateAutumn') ? { startsAt: new Date('2026-10-25T01:30:00Z') } : {}) };
const data = createEventFormData(window.location.pathname === '/admin/events/new' ? null : initial, params.has('fail'));
function requirePermission(permission: Permission, eventId?: string) {
  if (!auth.can(permission) || (eventId !== undefined && !auth.membership?.events.ids.includes(eventId))) {
    throw new Error('K této změně nemáte oprávnění.');
  }
}
export const getEvent: typeof EventRepository.getEvent = id => Promise.resolve().then(() => {
  requirePermission('event.read', id);
  const record = data.getEvent(id);
  window.uxEventReads.push(structuredClone(record));
  return record;
});
export const listQuizzes: typeof QuizRepository.listQuizzes = () => Promise.resolve([]);
export const getEditorQuiz: typeof EditorRepository.getEditorQuiz = () => Promise.resolve(null);
export const eventActionError: typeof EventApi.eventActionError = error => error instanceof Error
  ? error.message : 'Akci se nepodařilo uložit. Zkuste to prosím znovu.';
async function pendingSave() {
  await new Promise((resolve) => setTimeout(resolve, 150));
}
export const createEvent: typeof EventApi.createEvent = async values => {
  requirePermission('event.create');
  window.uxCalls.push({ operation: 'create', values: structuredClone(values) });
  await pendingSave();
  const response = data.createEvent(values);
  window.uxMutationResults.push({ operation: 'create', response: structuredClone(response) });
  return response;
};
export const updateEvent: typeof EventApi.updateEvent = async (id, revision, values) => {
  requirePermission('event.manage', id);
  window.uxCalls.push({ operation: 'update', id, revision, values: structuredClone(values) });
  await pendingSave();
  const response = data.updateEvent(id, revision, values);
  window.uxMutationResults.push({ operation: 'update', response: structuredClone(response) });
  return response;
};
export function refereeCall(name: string, payload: unknown) {
  return Promise.resolve().then(() => {
    if (name !== 'listRefereeAccess' || payload === null || typeof payload !== 'object'
      || !('eventId' in payload) || typeof payload.eventId !== 'string') {
      throw new Error('Unsupported referee operation in the isolated form fixture.');
    }
    requirePermission('event.manage', payload.eventId);
    return data.listRefereeAccess(payload.eventId);
  });
}
const unsupportedMutation = (): Promise<never> => Promise.reject(new Error('Unsupported mutation in the isolated form fixture.'));
export const archiveEvent: typeof EventApi.archiveEvent = unsupportedMutation;
export const cancelEvent: typeof EventApi.cancelEvent = unsupportedMutation;
export const resetEventScores: typeof EventApi.resetEventScores = unsupportedMutation;
export const lockEventQuiz: typeof EventApi.lockEventQuiz = unsupportedMutation;
