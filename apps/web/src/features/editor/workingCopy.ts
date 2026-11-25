import type { EditorAppearance, SlideDesign, ResultTemplates, PrintTemplate } from '@filmovy-kviz/quiz-domain';
import type { EditorMutationResponse, EditorQuiz, EditorSlide } from './types';
import { quizWithDraft } from '../preflight/validation';

export interface PendingEditorEntry {
  readonly draft: EditorSlide | null;
  readonly dirtySlide: boolean;
  readonly dirtyRound: boolean;
  readonly roundId?: string;
  readonly roundTitle: string;
  readonly pendingCreate: { readonly position: number; readonly semanticKey: string } | null;
}
export type EditorEntries = Readonly<Record<string, PendingEditorEntry>>;
export interface PendingMetadata {
  readonly title: string;
  readonly description: string;
  readonly appearance: EditorAppearance;
  readonly defaultDesign?: SlideDesign;
  readonly resultTemplates?: ResultTemplates;
  readonly printTemplate?: PrintTemplate;
}

export function overlayEntries(quiz: EditorQuiz, entries: EditorEntries): EditorQuiz {
  return Object.values(entries).reduce((current, entry) => {
    return quizWithDraft(current, {
    title: current.title, description: current.description,
    draft: entry.dirtySlide ? entry.draft : null,
    ...(entry.pendingCreate === null ? {} : { pendingPosition: entry.pendingCreate.position }),
    ...(entry.dirtyRound ? { roundId: entry.roundId, roundTitle: entry.roundTitle } : {}),
    });
  }, quiz);
}

interface SaveOperations {
  updateSlide(quizId: string, revision: number, slide: EditorSlide): Promise<EditorMutationResponse>;
  createSlide(quizId: string, revision: number, position: number, slide: EditorSlide, scope?: 'quiz', roundId?: string): Promise<EditorMutationResponse>;
  updateRound(quizId: string, revision: number, roundId: string, title: string): Promise<EditorMutationResponse>;
  updateMetadata(quizId: string, revision: number, title: string, description: string, appearance: EditorAppearance, defaultDesign?: SlideDesign, resultTemplates?: ResultTemplates, printTemplate?: PrintTemplate): Promise<EditorMutationResponse>;
}

/** Acknowledge each revision separately: a later failure must not resend earlier writes. */
export async function saveEditorEntries(base: EditorQuiz, pending: EditorEntries, metadata: PendingMetadata | null, operations: SaveOperations) {
  let quiz = base;
  const remaining = { ...pending };
  const created: Record<string, string> = {};
  let metadataPending = metadata !== null;
  let acknowledged = 0;
  try {
    for (const [key, original] of Object.entries(pending)) {
      let entry = original;
      if (entry.dirtySlide && entry.draft !== null) {
        const result = entry.pendingCreate === null
          ? await operations.updateSlide(quiz.id, quiz.revision, entry.draft)
          : await operations.createSlide(quiz.id, quiz.revision, entry.pendingCreate.position, entry.draft, entry.pendingCreate.semanticKey.startsWith('system:') ? 'quiz' : undefined, entry.pendingCreate.semanticKey.startsWith('round:') ? entry.roundId : entry.draft.isQuestion ? entry.draft.roundId : undefined);
        const slide = { ...entry.draft, id: result.selectedSlideId ?? entry.draft.id };
        quiz = { ...overlayEntries(quiz, { [key]: { ...entry, draft: slide, dirtyRound: false } }), ...result, id: quiz.id };
        if (entry.pendingCreate !== null) created[key] = slide.id;
        entry = { ...entry, draft: slide, dirtySlide: false, pendingCreate: null };
        remaining[key] = entry; acknowledged++;
      }
      if (entry.dirtyRound && entry.roundId !== undefined) {
        const result = await operations.updateRound(quiz.id, quiz.revision, entry.roundId, entry.roundTitle.trim());
        quiz = { ...overlayEntries(quiz, { [key]: entry }), ...result, id: quiz.id };
        entry = { ...entry, dirtyRound: false }; remaining[key] = entry; acknowledged++;
      }
      if (!entry.dirtySlide && !entry.dirtyRound) delete remaining[key];
    }
    if (metadata !== null) {
      const result = await operations.updateMetadata(quiz.id, quiz.revision, metadata.title.trim(), metadata.description, metadata.appearance, metadata.defaultDesign, metadata.resultTemplates, metadata.printTemplate);
      quiz = { ...quiz, ...result, title: metadata.title.trim(), description: metadata.description, defaultAppearance: metadata.appearance, ...(metadata.defaultDesign === undefined ? {} : { defaultDesign: metadata.defaultDesign }), ...(metadata.resultTemplates === undefined ? {} : { resultTemplates: metadata.resultTemplates }), ...(metadata.printTemplate === undefined ? {} : { printTemplate: metadata.printTemplate }) };
      metadataPending = false; acknowledged++;
    }
    return { quiz, remaining, metadataPending, created, acknowledged, error: null };
  } catch (error) {
    // An unacknowledged write keeps its old revision. Retrying cannot silently
    // overwrite another writer or duplicate a create after a lost response.
    return { quiz, remaining, metadataPending, created, acknowledged, error };
  }
}
