import { resolveSlideDesign, resolveLegacySlideAppearance, type SlideDesign, type ResultTemplates, type PrintTemplate } from '@filmovy-kviz/quiz-domain';
import { SlideDesignFields, legacySlideDesign } from '../../features/editor/SlideDesignFields';
import { ResultTemplatePreview } from '../../features/editor/ResultTemplatePreview';
import { PrintTemplateFields } from '../../features/print/PrintTemplateFields';
import { QuizPractice, practiceSlides } from '../../features/editor/QuizPractice';
import { MediaAuthoringContext } from '../../features/media/MediaUploadField';
import { usePrivateMediaPrefetch } from '../../features/media/usePrivateMediaPrefetch';
import { DriveMediaImportStatus } from '../../features/drive/DriveMediaImportStatus';
import { useDriveMediaImports } from '../../features/drive/useDriveMediaImports';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useParams, useSearchParams } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { RemoveQuestionDialog, RemoveRoundDialog, UnsavedChangesDialog } from '../../features/editor/EditorDialogs';
import { EditorDeleteButton } from '../../features/editor/EditorDeleteButton';
import {
  EditorPreview,
  EditorDisclosure,
  QuestionForm,
  QuizSettingsForm,
  ReadinessSummary,
  RoundSettingsForm,
  SystemContentForm,
  SystemSectionForm,
} from '../../features/editor/EditorForms';
import { EditorOutline } from '../../features/editor/EditorOutline';
import { moveOutlineQuestion, moveOutlineRound } from '../../features/editor/outlineMoves';
import {
  createQuizSlide,
  createQuizRound,
  deleteQuizSlide,
  duplicateQuizRound,
  duplicateQuizSlide,
  moveQuizQuestionToRound,
  moveQuizRound,
  moveQuizSlide,
  removeQuizRound,
  reorderQuizQuestion,
  staleEditorMessage,
  updateQuizMetadata,
  updateQuizRound,
  updateQuizSlide,
} from '../../features/editor/editorApi';
import { getEditorQuiz } from '../../features/editor/editorRepository';
import {
  buildSemanticQuizModel,
  insertionPositionForRound,
  storageKindForQuestion,
  type SemanticQuizModel,
  type SemanticRound,
} from '../../features/editor/semanticModel';
import { editorSaveLabels, editorSaveStatus } from '../../features/editor/sessionState';
import { overlayEntries, saveEditorEntries, type EditorEntries, type PendingEditorEntry, type PendingMetadata } from '../../features/editor/workingCopy';
import type { CreatableQuestionType, EditableSlideKind, EditorQuiz, EditorSlide } from '../../features/editor/types';
import { hasSaveBlockingIssues, validateQuestion } from '../../features/editor/validation';
import { defaultRules, generatedAgendaOptions } from '../../features/presentation/model';
import { QuizPreflightPanel } from '../../features/preflight/QuizPreflightPanel';
import type { PreflightFixTarget } from '../../features/preflight/types';
import { quizWithDraft, runQuizPreflight } from '../../features/preflight/validation';
import { QuizErrorState } from '../../features/quizzes/QuizErrorState';
import { QuizLoading } from '../../features/quizzes/QuizLoading';
import { QuizStatusControl } from '../../features/quizzes/QuizStatusControl';
import { HumanError } from '../../ui/HumanError';
import { TechnicalDetails } from '../../ui/TechnicalDetails';
import '../../features/editor/editorWorkflow.css';

type EditorPanel = 'structure' | 'content' | 'preview';

interface PendingCreate {
  readonly position: number;
  readonly semanticKey: string;
}

interface PendingFixFocus {
  readonly selectionKey: string;
  readonly field: string;
  readonly questionId?: string;
}

const questionKinds = new Set<EditableSlideKind>([
  'question', 'text', 'classic', 'free', 'image', 'picture', 'photo', 'audio', 'music', 'video', 'youtube', 'pl', 'legacy',
]);

const emptyFields = {
  title: '', text: '', moderatorNote: '', options: [] as readonly string[], correctAnswer: '', media: [] as const,
  presentation: {
    videoStart: null, videoEnd: null, audioTrigger: null,
    backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null,
  },
  backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '',
  backgroundOverlay: null, clipStartSeconds: null, clipEndSeconds: null,
  hasLegacyData: false,
};

function localDraft(kind: EditableSlideKind, position: number, values: Partial<EditorSlide> = {}): EditorSlide {
  return {
    ...emptyFields,
    id: `local-${kind}`,
    position,
    storedKind: kind,
    kind,
    isQuestion: questionKinds.has(kind),
    ...values,
  };
}

function newQuestionDraft(type: CreatableQuestionType, round: SemanticRound): EditorSlide {
  const kind = storageKindForQuestion(type);
  const position = insertionPositionForRound(round);
  const questionNumber = round.questions.filter((question) => question.slide.position < position).length + 1;
  return localDraft(kind, position, {
    id: `local-question-${type}`,
    roundId: round.id,
    roundTitle: round.title,
    questionNumber,
    questionCount: round.questions.length + 1,
    authoringStatus: 'ready', answerMode: type === 'choice' ? 'choice' : 'open',
    options: type === 'choice' ? ['', '', '', ''] : [],
    clipStartSeconds: type === 'audio' || type === 'video' ? 0 : null,
  });
}

function systemDraft(key: string, model: SemanticQuizModel, position: number): EditorSlide {
  if (key === 'rules') return localDraft('rules', position, { options: [...defaultRules] });
  if (key === 'agenda') return localDraft('agenda', position, { automaticAgenda: true, options: generatedAgendaOptions(model.rounds) });
  return localDraft('intro', position);
}

function roundForSelection(key: string, model: SemanticQuizModel): SemanticRound | undefined {
  if (key.startsWith('round:')) return model.rounds.find((round) => round.id === key.slice('round:'.length));
  const slideId = key.startsWith('slide:') ? key.slice('slide:'.length) : undefined;
  return slideId === undefined ? undefined : model.rounds.find((round) => round.slides.some((slide) => slide.id === slideId));
}

function selectionForSlide(slideId: string | undefined, model: SemanticQuizModel, fallback = 'quiz'): string {
  if (slideId === undefined) return fallback;
  const round = model.rounds.find((item) => item.settingsSlide?.id === slideId);
  return round === undefined ? `slide:${slideId}` : `round:${round.id}`;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === driveConflictMessage) return driveConflictMessage;
  if ((error as { code?: string })?.code === 'functions/permission-denied') return 'K tomuto kvízu nebo požadované úpravě nemáte oprávnění. Kontaktujte správce přístupu.';
  if (error instanceof Error && (error.message === staleEditorMessage || /aborted|revision|newer|stale/iu.test(error.message))) {
    return 'Kvíz mezitím upravil někdo jiný. Načtěte aktuální verzi a změnu proveďte znovu.';
  }
  return 'Změnu se nepodařilo uložit. Rozepsané hodnoty zůstaly v editoru.';
}

const initialAppearance = { backgroundImage: '', backgroundOverlay: 0, imageLayout: 'split' as const };
const driveConflictMessage = 'Stejné údaje mezitím změnil někdo jiný. Rozepsané hodnoty zůstaly zachované; před uložením vyřešte souběžnou změnu nebo načtěte aktuální verzi.';

function sameEditorValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => sameEditorValue(a[key], b[key]));
}
/** Apply only local field deltas to a fresh server value; overlapping edits remain a visible conflict. */
function mergeEditorFields<T extends object>(base: T, local: T, remote: T): T | null {
  const merged = { ...remote };
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]) as Set<keyof T>) {
    if (sameEditorValue(local[key], base[key])) continue;
    if (!sameEditorValue(remote[key], base[key]) && !sameEditorValue(local[key], remote[key])) return null;
    merged[key] = local[key];
  }
  return merged;
}
function quizMetadata(quiz: EditorQuiz): PendingMetadata {
  return { title: quiz.title, description: quiz.description, appearance: quiz.defaultAppearance ?? initialAppearance,
    defaultDesign: quiz.defaultDesign ?? {}, resultTemplates: quiz.resultTemplates ?? {}, printTemplate: quiz.printTemplate ?? {} };
}
function rebaseDriveChanges(base: EditorQuiz, fresh: EditorQuiz, entries: EditorEntries, metadata: PendingMetadata | null) {
  const structure = (quiz: EditorQuiz) => quiz.slides.map(slide => [slide.id, slide.position, slide.roundId, slide.kind, slide.isQuestion]);
  if (base.id !== fresh.id || fresh.revision < base.revision || !sameEditorValue(structure(base), structure(fresh))) return null;
  const merged: Record<string, PendingEditorEntry> = {};
  for (const [key, entry] of Object.entries(entries)) {
    let draft = entry.draft;
    if (draft && entry.pendingCreate === null) {
      const original = base.slides.find(slide => slide.id === draft!.id), remote = fresh.slides.find(slide => slide.id === draft!.id);
      if (!original || !remote) return null;
      // Source and timing describe one clip. Never apply a local old-source offset to a newly trimmed file.
      const clip = (slide: EditorSlide) => [slide.kind, slide.mediaSource, slide.clipStartSeconds, slide.clipEndSeconds];
      if (!sameEditorValue(clip(draft), clip(original)) && !sameEditorValue(clip(remote), clip(original)) && !sameEditorValue(clip(draft), clip(remote))) return null;
      draft = mergeEditorFields(original, draft, remote);
      if (!draft) return null;
    }
    if (entry.dirtyRound && entry.roundId) {
      const before = buildSemanticQuizModel(base).rounds.find(round => round.id === entry.roundId)?.title;
      const after = buildSemanticQuizModel(fresh).rounds.find(round => round.id === entry.roundId)?.title;
      if (before === undefined || after === undefined || (before !== after && entry.roundTitle.trim() !== after)) return null;
    }
    merged[key] = { ...entry, draft };
  }
  const mergedMetadata = metadata === null ? null : mergeEditorFields(quizMetadata(base), metadata, quizMetadata(fresh));
  if (metadata !== null && mergedMetadata === null) return null;
  return { entries: merged as EditorEntries, metadata: mergedMetadata };
}
function revisionConflict(error: unknown): boolean {
  return error instanceof Error && (error.message === staleEditorMessage || /aborted|revision|newer|stale/iu.test(error.message));
}

export function QuizEditorPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const [searchParams] = useSearchParams();
  const { can, currentUser, membership, loading: authLoading } = useAuth();
  const readOnly = !can('quiz.edit');
  const driveEnabled = !readOnly && !authLoading && !!currentUser && membership?.role === 'owner' && can('users.manage') && can('quiz.media.upload');
  const [quiz, setQuiz] = useState<EditorQuiz | null>(null);
  const [practicing, setPracticing] = useState(false);
  const practiceButtonRef = useRef<HTMLButtonElement>(null), restorePracticeFocus = useRef(false);
  useEffect(() => {
    if (!practicing && restorePracticeFocus.current && practiceButtonRef.current) {
      restorePracticeFocus.current = false;
      practiceButtonRef.current.focus({ preventScroll: true });
    }
  }, [practicing]);
  const [selectedKey, setSelectedKey] = useState('quiz');
  const [draft, setDraft] = useState<EditorSlide | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [appearance, setAppearance] = useState<import('@filmovy-kviz/quiz-domain').EditorAppearance>(initialAppearance);
  const [roundTitle, setRoundTitle] = useState('');
  const [defaultDesign, setDefaultDesign] = useState<SlideDesign>({});
  const [resultTemplates, setResultTemplates] = useState<ResultTemplates>({});
  const [printTemplate, setPrintTemplate] = useState<PrintTemplate>({});
  const [dirtySlide, setDirtySlide] = useState(false);
  const [dirtyQuiz, setDirtyQuiz] = useState(false);
  const [dirtyRound, setDirtyRound] = useState(false);
  const [parked, setParkedState] = useState<EditorEntries>({});
  const parkedRef = useRef<EditorEntries>({});
  const setParked = useCallback((entries: EditorEntries) => {
    const previous = parkedRef.current;
    if (Object.keys(previous).length === Object.keys(entries).length && Object.keys(entries).every(key => previous[key] === entries[key])) return;
    parkedRef.current = entries; setParkedState(entries);
  }, []);
  const savePending = useRef(false);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [removeRound, setRemoveRound] = useState<SemanticRound | null>(null);
  const [removeQuestion, setRemoveQuestion] = useState<EditorSlide | null>(null);
  useEffect(() => { setRemoveRound(null); setRemoveQuestion(null); }, [quizId]);
  const [pickerRoundId, setPickerRoundId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<EditorPanel>('content');
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [showReadiness, setShowReadiness] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [pendingFixFocus, setPendingFixFocus] = useState<PendingFixFocus | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadPending = useRef(false);
  const onUploadPending = useCallback((pending: boolean) => { uploadPending.current = pending; setUploading(pending); }, []);
  const [saveFailed, setSaveFailed] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  useEffect(() => { setLastSavedAt(null); }, [quizId, readOnly]);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const handledDeepLink = useRef<string | undefined>(undefined);
  const loadGeneration = useRef(0);
  const dirty = dirtySlide || dirtyQuiz || dirtyRound || Object.keys(parked).length > 0;
  const [driveRefreshNeeded, setDriveRefreshNeeded] = useState(0);
  const driveRefreshApplied = useRef(0);
  const driveReady = useCallback(() => setDriveRefreshNeeded(value => value + 1), []);
  const driveIdentity = `${currentUser?.uid ?? ''}:${membership?.version ?? ''}`;
  usePrivateMediaPrefetch(quiz, selectedKey.startsWith('slide:') ? selectedKey.slice(6) : draft?.id,
    !authLoading && !!currentUser && can('quiz.read') && !practicing, driveIdentity);
  const driveImports = useDriveMediaImports(driveIdentity, quizId, driveEnabled, driveReady);
  const deferredDriveSlides = useRef(new Map<string, EditorSlide>());
  useEffect(() => { deferredDriveSlides.current.clear(); }, [driveIdentity, quizId]);
  const editorState = useRef({ dirty, quizId, driveEnabled });
  editorState.current = { dirty, quizId, driveEnabled };
  const blocker = useBlocker(dirty || uploading || saving);
  const semantic = useMemo(() => quiz === null ? null : buildSemanticQuizModel(quiz), [quiz]);
  const selectedRoundForDraft = semantic === null ? undefined : roundForSelection(selectedKey, semantic)
    ?? (selectedKey === 'draft' ? semantic.rounds.find((round) => round.id === draft?.roundId) : undefined);
  const driveWorkingCopy = useRef({ quiz, draft, dirtySlide, dirtyRound, dirtyQuiz, selectedKey, roundTitle, pendingCreate,
    roundId: selectedRoundForDraft?.id, metadata: { title, description, appearance, defaultDesign, resultTemplates, printTemplate } });
  driveWorkingCopy.current = { quiz, draft, dirtySlide, dirtyRound, dirtyQuiz, selectedKey, roundTitle, pendingCreate,
    roundId: selectedRoundForDraft?.id, metadata: { title, description, appearance, defaultDesign, resultTemplates, printTemplate } };
  const preflightQuiz = useMemo(() => {
    if (quiz === null) return null;
    // Selection is UI state. Keep the saved validation snapshot stable while
    // browsing, including pristine virtual system sections and round settings.
    if (!dirtyQuiz && !dirtySlide && !dirtyRound && Object.keys(parked).length === 0) return quiz;
    return quizWithDraft({ ...overlayEntries(quiz, parked), defaultAppearance: appearance, defaultDesign, resultTemplates, printTemplate }, {
      title,
      description,
      draft: dirtySlide || dirtyRound ? draft : null,
      ...(pendingCreate === null || !dirtySlide ? {} : { pendingPosition: pendingCreate.position }),
      ...(dirtyRound && selectedRoundForDraft !== undefined
        ? { roundId: selectedRoundForDraft.id, roundTitle }
        : {}),
    });
  }, [appearance, defaultDesign, description, dirtyQuiz, dirtyRound, dirtySlide, draft, parked, pendingCreate, printTemplate, quiz, resultTemplates, roundTitle, selectedRoundForDraft, title]);
  const outlineModel = useMemo(() => quiz === null ? null : buildSemanticQuizModel(overlayEntries(quiz,
    Object.fromEntries(Object.entries(parked).filter(([, entry]) => entry.pendingCreate === null)))), [quiz, parked]);
  const validationSnapshot = useMemo(() => preflightQuiz === null ? null : { quiz: preflightQuiz, dirty }, [preflightQuiz, dirty]);
  const [checkedSnapshot, setCheckedSnapshot] = useState<typeof validationSnapshot>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setCheckedSnapshot(validationSnapshot), 220);
    return () => window.clearTimeout(timer);
  }, [validationSnapshot]);
  const validationPending = validationSnapshot !== checkedSnapshot;
  const preflightResult = useMemo(() => checkedSnapshot === null ? null : runQuizPreflight(checkedSnapshot.quiz, {
    source: checkedSnapshot.dirty ? 'LOCAL_DRAFT' : 'SAVED_QUIZ',
    hasUnsavedChanges: checkedSnapshot.dirty,
  }), [checkedSnapshot]);

  const reload = useCallback(async (preferredKey = 'quiz', preferredSlideId?: string): Promise<EditorQuiz | null> => {
    const attempt = ++loadGeneration.current;
    if (!quizId) {
      setError('Kvíz nelze otevřít, protože chybí jeho identifikátor.');
      setLoading(false);
      return null;
    }
    try {
      const loaded = await getEditorQuiz(quizId);
      if (attempt !== loadGeneration.current) return null;
      if (loaded === null) {
        setError('Kvíz nebyl nalezen.');
        return null;
      }
      const model = buildSemanticQuizModel(loaded);
      setQuiz(loaded);
      setTitle(loaded.title);
      setDescription(loaded.description);
      setAppearance(loaded.defaultAppearance ?? initialAppearance);
      setDefaultDesign(loaded.defaultDesign ?? {});
      setResultTemplates(loaded.resultTemplates ?? {});
      setPrintTemplate(loaded.printTemplate ?? {});
      setSelectedKey(preferredSlideId === undefined ? preferredKey : selectionForSlide(preferredSlideId, model, preferredKey));
      setDirtySlide(false);
      setDirtyQuiz(false);
      setDirtyRound(false);
      setParked({});
      setPendingCreate(null);
      setTouched(new Set());
      setShowReadiness(false);
      setPreflightOpen(false);
      setSaveFailed(false);
      setError(null);
      return loaded;
    } catch (loadError) {
      if (attempt === loadGeneration.current) setError(safeErrorMessage(loadError));
      return null;
    } finally {
      if (attempt === loadGeneration.current) setLoading(false);
    }
  }, [quizId, setParked]);

  useEffect(() => {
    void reload();
    // StrictMode and route changes can leave an earlier request in flight.
    return () => { loadGeneration.current++; };
  }, [reload]);

  useEffect(() => {
    if (!driveEnabled || !quizId || loading || quiz?.id !== quizId || saving || uploading || driveRefreshNeeded === driveRefreshApplied.current) return;
    const attempt = ++loadGeneration.current;
    void getEditorQuiz(quizId).then(loaded => {
      // Use the latest draft at response time, including typing that began while this read was in flight.
      if (!loaded || attempt !== loadGeneration.current || editorState.current.quizId !== quizId
        || !editorState.current.driveEnabled || savePending.current || uploadPending.current) return;
      const current = driveWorkingCopy.current;
      if (!current.quiz) return;
      const entries: Record<string, PendingEditorEntry> = { ...parkedRef.current };
      delete entries[current.selectedKey];
      if (current.dirtySlide || current.dirtyRound) entries[current.selectedKey] = {
        draft: current.draft, dirtySlide: current.dirtySlide, dirtyRound: current.dirtyRound, roundTitle: current.roundTitle,
        roundId: current.roundId, pendingCreate: current.pendingCreate,
      };
      const rebased = rebaseDriveChanges(current.quiz, loaded, entries, current.dirtyQuiz ? current.metadata : null);
      if (!rebased) { setError(driveConflictMessage); setSaveFailed(true); return; }
      driveRefreshApplied.current = driveRefreshNeeded;
      const metadata = rebased.metadata ?? quizMetadata(loaded);
      setParked(rebased.entries); setQuiz(loaded); setTitle(metadata.title); setDescription(metadata.description);
      setAppearance(metadata.appearance); setDefaultDesign(metadata.defaultDesign ?? {});
      setResultTemplates(metadata.resultTemplates ?? {}); setPrintTemplate(metadata.printTemplate ?? {});
    }).catch(() => { /* A background read must not replace the editor's save/error state. */ });
  }, [dirty, driveEnabled, driveRefreshNeeded, loading, quiz?.id, quizId, saving, setParked, uploading]);

  useEffect(() => {
    if (semantic === null || quiz?.id !== quizId) return;
    const deepLinkKey = `${quizId ?? ''}?${searchParams.toString()}`;
    if (handledDeepLink.current === deepLinkKey) return;
    const questionId = searchParams.get('questionId');
    const roundId = searchParams.get('roundId');
    const section = searchParams.get('section');
    const field = searchParams.get('field');
    let selectionKey: string | undefined;
    if (questionId !== null && semantic.questionBySlideId.has(questionId)) selectionKey = `slide:${questionId}`;
    else if (roundId !== null && semantic.rounds.some((round) => round.id === roundId)) selectionKey = `round:${roundId}`;
    else if (section === 'agenda') selectionKey = 'system:agenda';
    else if (field === 'quizTitle') selectionKey = 'quiz';
    handledDeepLink.current = deepLinkKey;
    if (selectionKey === undefined) return;
    setSelectedKey(selectionKey);
    setActivePanel('content');
    if (field !== null) setPendingFixFocus({ selectionKey, field, ...(questionId === null ? {} : { questionId }) });
  }, [quiz?.id, quizId, searchParams, semantic]);

  useEffect(() => {
    if (quiz === null || semantic === null) return;
    const stored = parkedRef.current[selectedKey];
    if (stored !== undefined) {
      setDraft(stored.draft); setRoundTitle(stored.roundTitle);
      setDirtySlide(stored.dirtySlide); setDirtyRound(stored.dirtyRound); setPendingCreate(stored.pendingCreate);
      setShowAnswer(false); setTouched(new Set()); setShowReadiness(false);
      return;
    }
    if (selectedKey === 'draft') return;
    setDirtySlide(false); setDirtyRound(false);
    setShowAnswer(false);
    setTouched(new Set());
    setShowReadiness(false);
    setPendingCreate(null);
    if (selectedKey === 'quiz' || selectedKey.startsWith('results:')) {
      setDraft(null);
      setRoundTitle('');
      return;
    }
    if (selectedKey.startsWith('system:')) {
      const key = selectedKey.slice('system:'.length) as 'opening' | 'agenda' | 'rules';
      const section = semantic.introduction.find((item) => item.key === key);
      if (section?.slide !== undefined) setDraft(section.slide);
      else {
        const previous = semantic.introduction.slice(0, ['opening','agenda','rules'].indexOf(key)).flatMap(item => item.slide ? [item.slide.position] : []);
        const position = previous.length ? Math.max(...previous) + 1 : 1;
        setDraft(systemDraft(key, semantic, position));
        setPendingCreate({ position, semanticKey: selectedKey });
      }
      setRoundTitle('');
      return;
    }
    if (selectedKey.startsWith('round:')) {
      const round = roundForSelection(selectedKey, semantic);
      if (round !== undefined && round.id !== 'roundless' && round.settingsSlide === undefined) {
        setDraft(localDraft('round', round.firstPosition, { roundId: round.id, roundTitle: round.title, title: round.title }));
        setPendingCreate({ position: round.firstPosition, semanticKey: selectedKey });
      } else setDraft(round?.settingsSlide ?? null);
      setRoundTitle(round?.title ?? '');
      return;
    }
    const slideId = selectedKey.startsWith('slide:') ? selectedKey.slice('slide:'.length) : '';
    setDraft(semantic.slideById.get(slideId) ?? null);
    setRoundTitle('');
  }, [quiz, selectedKey, semantic]);

  useEffect(() => {
    if (pendingFixFocus === null || pendingFixFocus.selectionKey !== selectedKey) return;
    if (pendingFixFocus.questionId !== undefined && draft?.id !== pendingFixFocus.questionId) return;
    setShowReadiness(true);
    const field = pendingFixFocus.field;
    setPendingFixFocus(null);
    requestAnimationFrame(() => {
      const fieldElement = document.querySelector<HTMLElement>(`[data-preflight-field="${field}"]`);
      let disclosure = fieldElement?.closest('details');
      while (disclosure) { disclosure.open = true; disclosure = disclosure.parentElement?.closest('details') ?? null; }
      const focusable = fieldElement?.matches('input:not([hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)')
        ? fieldElement
        : fieldElement?.querySelector<HTMLElement>('summary, input:not([hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)');
      focusable?.focus();
      fieldElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [draft, pendingFixFocus, selectedKey]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty && !uploadPending.current && !savePending.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const saveAll = useCallback(async (afterKey = selectedKey, saveAs?: 'draft' | 'ready'): Promise<EditorQuiz | null> => {
    if (quiz === null || readOnly || semantic === null || uploadPending.current || savePending.current) return null;
    let entries: Record<string, PendingEditorEntry> = { ...parkedRef.current };
    delete entries[selectedKey];
    if (dirtySlide || dirtyRound || saveAs !== undefined) entries[selectedKey] = {
      draft: draft !== null && saveAs !== undefined ? { ...draft, authoringStatus: saveAs } : draft,
      dirtySlide: dirtySlide || saveAs !== undefined, dirtyRound, roundTitle,
      roundId: selectedRoundForDraft?.id, pendingCreate,
    };
    for (const [key, entry] of Object.entries(entries)) {
      const persisted = quiz.slides.find(slide => slide.id === entry.draft?.id);
      if (entry.dirtySlide && entry.draft?.isQuestion && entry.draft.authoringStatus !== 'draft'
        && hasSaveBlockingIssues(entry.draft, persisted, !can('quiz.answers.read'))) {
        setParked(entries); setSelectedKey(key); setShowReadiness(true);
        const issue = validateQuestion(entry.draft).find(item => item.severity === 'error' && (can('quiz.answers.read') || item.field !== 'correctAnswer'));
        setPendingFixFocus({ selectionKey: key, field: issue?.field ?? 'prompt', questionId: entry.draft.id });
        setError('Před uložením opravte označené údaje. Ostatní rozepsané změny zůstávají zachované.');
        requestAnimationFrame(() => errorRef.current?.focus()); return null;
      }
      if (entry.dirtyRound && entry.roundTitle.trim() === '') {
        setParked(entries); setSelectedKey(key); setError('Název kola nesmí být prázdný.'); return null;
      }
    }
    if (dirtyQuiz && title.trim() === '') { setError('Název kvízu nesmí být prázdný.'); return null; }
    savePending.current = true; setSaving(true); setError(null); setSaveFailed(false);
    try {
      const operations = {
        updateSlide: updateQuizSlide, createSlide: createQuizSlide,
        updateRound: updateQuizRound, updateMetadata: updateQuizMetadata,
      };
      let base = quiz;
      let metadata: PendingMetadata | null = dirtyQuiz ? { title, description, appearance, defaultDesign, resultTemplates, printTemplate } : null;
      const importing = driveEnabled && driveImports.entries.length > 0;
      if (importing) {
        const fresh = await getEditorQuiz(quiz.id);
        const rebased = fresh && rebaseDriveChanges(base, fresh, entries, metadata);
        if (!fresh || !rebased) { setError(fresh ? driveConflictMessage : 'Aktuální verzi se nepodařilo načíst. Rozepsané hodnoty zůstaly zachované.'); setSaveFailed(true); return null; }
        base = fresh; entries = { ...rebased.entries }; metadata = rebased.metadata;
      }
      let result = await saveEditorEntries(base, entries, metadata, operations);
      if (importing && revisionConflict(result.error)) {
        // A job can attach after the pre-save read. Retry once only after another conflict-checked rebase.
        let fresh: EditorQuiz | null = null;
        try { fresh = await getEditorQuiz(quiz.id); }
        catch (loadError) { result = { ...result, error: loadError }; }
        const rebased = fresh && rebaseDriveChanges(result.quiz, fresh, result.remaining, result.metadataPending ? metadata : null);
        if (fresh && rebased) {
          metadata = rebased.metadata;
          const retried = await saveEditorEntries(fresh, rebased.entries, rebased.metadata, operations);
          result = { ...retried, acknowledged: result.acknowledged + retried.acknowledged, created: { ...result.created, ...retried.created } };
        } else if (fresh) result = { ...result, error: new Error(driveConflictMessage) };
      }
      setParked(result.remaining);
      setQuiz(result.quiz);
      setDirtyQuiz(result.metadataPending);
      const retainedMetadata = result.metadataPending && metadata ? metadata : quizMetadata(result.quiz);
      setTitle(retainedMetadata.title); setDescription(retainedMetadata.description); setAppearance(retainedMetadata.appearance);
      setDefaultDesign(retainedMetadata.defaultDesign ?? {}); setResultTemplates(retainedMetadata.resultTemplates ?? {}); setPrintTemplate(retainedMetadata.printTemplate ?? {});
      const active = result.remaining[selectedKey];
      setDirtySlide(active?.dirtySlide ?? false); setDirtyRound(active?.dirtyRound ?? false);
      setPendingCreate(active?.pendingCreate ?? null);
      if (selectedKey === 'draft' && result.created[selectedKey]) setSelectedKey(`slide:${result.created[selectedKey]}`);
      for (const [entryKey, entry] of Object.entries(entries)) {
        if (!entry.dirtySlide || !entry.draft || result.remaining[entryKey]?.dirtySlide) continue;
        const id = result.created[entryKey] ?? entry.draft.id;
        const saved = result.quiz.slides.find(slide => slide.id === id);
        if (saved) deferredDriveSlides.current.set(id, saved);
      }
      if (result.error !== null) {
        setSaveFailed(true);
        const remainingScopes = Object.values(result.remaining).map(entry => entry.dirtyRound ? `kolo ${entry.roundTitle || 'bez názvu'}` : entry.draft?.text || entry.draft?.title || 'slide bez názvu').map(label => label.length > 65 ? label.slice(0, 62) + '…' : label);
        if (result.metadataPending) remainingScopes.push('společný vzhled, údaje kvízu a šablony');
        setError((result.acknowledged > 0 ? 'Část změn je uložená. ' : '') + `Zbývá uložit: ${remainingScopes.join('; ')}. ` + safeErrorMessage(result.error));
        requestAnimationFrame(() => errorRef.current?.focus()); return null;
      }
      if (result.acknowledged > 0) setLastSavedAt(new Date());
      const createdId = result.created[selectedKey];
      const key = pendingCreate?.semanticKey ?? afterKey;
      const refreshed = await reload(key, pendingCreate?.semanticKey.startsWith('system:') ? undefined : createdId);
      if (refreshed === null) setError('Změny jsou uložené, ale nový náhled se nepodařilo načíst. Obnovte stránku.');
      // A partial save retains acknowledged slides for the next successful retry;
      // background attachment must not add revision conflicts to a failed save.
      driveImports.queueSavedSlides([...deferredDriveSlides.current.values()]);
      deferredDriveSlides.current.clear();
      return refreshed ?? result.quiz;
    } catch (saveError) {
      setSaveFailed(true); setError(safeErrorMessage(saveError)); return null;
    } finally { savePending.current = false; setSaving(false); }
  }, [appearance, defaultDesign, resultTemplates, printTemplate, can, description, dirtyQuiz, dirtyRound, dirtySlide, draft, driveEnabled, driveImports.entries.length, driveImports.queueSavedSlides, pendingCreate, quiz, readOnly, reload, roundTitle, selectedKey, selectedRoundForDraft, semantic, setParked, title]);

  useEffect(() => {
    const keyboardSave = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (dirty && !saving && !readOnly) void saveAll();
      }
    };
    window.addEventListener('keydown', keyboardSave);
    return () => window.removeEventListener('keydown', keyboardSave);
  }, [dirty, readOnly, saveAll, saving]);

  function discardDraft() {
    if (quiz === null) return;
    setTitle(quiz.title);
    setDescription(quiz.description);
    setAppearance(quiz.defaultAppearance ?? initialAppearance);
    setDefaultDesign(quiz.defaultDesign ?? {});
    setResultTemplates(quiz.resultTemplates ?? {});
    setPrintTemplate(quiz.printTemplate ?? {});
    setDirtySlide(false);
    setDirtyQuiz(false);
    setDirtyRound(false);
    setParked({});
    setQuiz({ ...quiz });
    if (selectedKey === 'draft') {
      setDraft(null);
      setSelectedKey(draft?.roundId ? `round:${draft.roundId}` : 'quiz');
    }
    setPendingCreate(null);
    setSaveFailed(false);
    setError(null);
  }

  async function discardAndReload() {
    if (uploadPending.current || savePending.current) return;
    if (!window.confirm('Zahodit všechny zbývající rozepsané změny a načíst aktuální verzi kvízu?')) return;
    savePending.current = true;
    setSaving(true);
    try {
      if (await reload() === null) setSaveFailed(true);
    } catch (loadError) {
      setSaveFailed(true);
      setError(safeErrorMessage(loadError));
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }

  function select(key: string) {
    if (key === selectedKey || uploadPending.current || savePending.current) return;
    setPickerRoundId(null);
    if (pendingCreate !== null && dirtySlide) { setPendingSelection(key); return; }
    const entries = { ...parkedRef.current };
    delete entries[selectedKey];
    if (dirtySlide || dirtyRound) entries[selectedKey] = { draft, dirtySlide, dirtyRound, roundTitle,
      roundId: selectedRoundForDraft?.id, pendingCreate };
    setParked(entries);
    setSelectedKey(key);
    if (window.matchMedia('(max-width: 767px)').matches) setActivePanel('content');
  }

  function openPreflightFix(target: PreflightFixTarget) {
    let selectionKey = 'quiz';
    if (target.kind === 'question' && target.questionId !== undefined) {
      selectionKey = pendingCreate !== null && draft?.id === target.questionId ? 'draft' : `slide:${target.questionId}`;
    } else if (target.kind === 'round' && target.roundId !== undefined) {
      selectionKey = `round:${target.roundId}`;
    } else if (target.kind === 'system' && target.systemKey !== undefined) {
      selectionKey = `system:${target.systemKey}`;
    }
    setPreflightOpen(false);
    setActivePanel('content');
    if (target.field !== undefined) {
      setPendingFixFocus({
        selectionKey,
        field: target.field,
        ...(target.questionId === undefined ? {} : { questionId: target.questionId }),
      });
    }
    select(selectionKey);
  }

  async function mutate(action: (current: EditorQuiz) => Promise<{ readonly selectedSlideId?: string }>, preferredKey?: string, saveWorkingCopy = false): Promise<boolean> {
    if (quiz === null || readOnly || (dirty && !saveWorkingCopy) || uploadPending.current || savePending.current) return false;
    const current = dirty ? await saveAll() : quiz;
    if (current === null) return false;
    savePending.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await action(current);
      return await reload(preferredKey ?? selectedKey, result.selectedSlideId) !== null;
    } catch (mutationError) {
      setError(safeErrorMessage(mutationError));
      requestAnimationFrame(() => errorRef.current?.focus());
      return false;
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }

  async function createQuestion(roundId: string, type: CreatableQuestionType = 'free') {
    if (quiz === null || readOnly || uploadPending.current || savePending.current) return;
    const opener = document.activeElement;
    const current = dirty ? await saveAll() : quiz;
    if (current === null) return;
    const round = buildSemanticQuizModel(current).rounds.find(item => item.id === roundId);
    if (round === undefined) return;
    // Empty slide overrides inherit the quiz defaults through the shared renderer.
    const next = newQuestionDraft(type, round);
    setDraft(next); setPendingCreate({ position: next.position, semanticKey: 'draft' });
    setSelectedKey('draft'); setDirtySlide(true); setDirtyRound(false);
    setPickerRoundId(null); setTouched(new Set()); setShowAnswer(false); setShowReadiness(false); setActivePanel('content');
    requestAnimationFrame(() => {
      const working = driveWorkingCopy.current;
      if (editorState.current.quizId !== current.id || working.quiz?.id !== current.id
        || working.selectedKey !== 'draft' || working.draft !== next || !editorRef.current?.isConnected) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement && active !== opener) return;
      editorRef.current.querySelector<HTMLTextAreaElement>('[data-preflight-field="prompt"] textarea')?.focus();
    });
  }

  async function moveRoundInOutline(id: string, beforeId?: string): Promise<boolean> {
    if (quiz === null || readOnly || dirty || uploadPending.current || savePending.current) return false;
    savePending.current = true; setSaving(true); setError(null);
    try {
      await moveOutlineRound(quiz, id, beforeId);
      return await reload(`round:${id}`) !== null;
    } catch (moveError) {
      const refreshed = await reload(`round:${id}`);
      setError('Přesun kola nebyl dokončen. ' + (refreshed === null ? 'Aktuální pořadí se nepodařilo načíst. Před dalším přesouváním obnovte stránku. ' : 'Zobrazené pořadí odpovídá uloženým změnám. ') + safeErrorMessage(moveError));
      return false;
    } finally { savePending.current = false; setSaving(false); }
  }

  async function moveInOutline(id: string, roundId: string | undefined, beforeId?: string): Promise<boolean> {
    if (quiz === null || readOnly || dirty || uploadPending.current || savePending.current) return false;
    savePending.current = true; setSaving(true); setError(null);
    try {
      await moveOutlineQuestion(quiz, id, roundId, beforeId);
      return await reload(`slide:${id}`) !== null;
    } catch (moveError) {
      // Several revision-protected steps may have succeeded; read the actual order.
      await reload(`slide:${id}`);
      setError('Přesun nebyl dokončen. Některé kroky už mohou být uložené. ' + safeErrorMessage(moveError));
      return false;
    } finally { savePending.current = false; setSaving(false); }
  }

  if (loading && quiz === null) return <QuizLoading label="Načítám editor kvízu…" />;
  if (quiz === null || semantic === null) return <QuizErrorState message={error ?? 'Kvíz se nepodařilo otevřít.'} onRetry={() => void reload()} />;

  if (practicing) return <QuizPractice quiz={quiz} onClose={() => { restorePracticeFocus.current = true; setPracticing(false); }} />;

  const selectedRound = roundForSelection(selectedKey, semantic)
    ?? (selectedKey === 'draft' ? semantic.rounds.find((round) => round.id === draft?.roundId) : undefined);
  const selectedQuestion = draft === null ? undefined : semantic.questionBySlideId.get(draft.id);
  const isLocalQuestion = selectedKey === 'draft' && draft?.isQuestion === true;
  const questionNumber = selectedQuestion?.number ?? draft?.questionNumber ?? 1;
  const selectedSection = selectedKey.startsWith('system:')
    ? semantic.introduction.find((item) => item.key === selectedKey.slice('system:'.length))
    : undefined;
  const selectedTemplate = selectedKey.startsWith('results:') ? selectedKey.slice('results:'.length) as 'interim' | 'final' : undefined;
  const template = selectedTemplate ? resultTemplates[selectedTemplate] : undefined;
  const inheritedRound = selectedRound === undefined ? undefined : (parked[`round:${selectedRound.id}`]?.draft ?? selectedRound.settingsSlide)?.design;
  const inheritedDesign = resolveSlideDesign(defaultDesign, selectedKey.startsWith('round:') ? undefined : inheritedRound);
  const previewBase = selectedTemplate ? localDraft('end', 0, { title: template?.title ?? (selectedTemplate === 'final' ? 'Finální výsledky' : 'Průběžné pořadí'), text: template?.subtitle ?? 'Pořadí a body se doplní z publikovaných výsledků.', ...(template?.design ? { design: template.design } : {}) }) : draft ?? selectedRound?.settingsSlide ?? semantic.introduction.find((item) => item.slide)?.slide ?? quiz.slides[0];
  const previewSlide = previewBase === undefined ? undefined : {
    ...previewBase, ...resolveLegacySlideAppearance(appearance, previewBase), design: resolveSlideDesign(defaultDesign, selectedKey.startsWith('round:') || selectedTemplate ? undefined : inheritedRound, previewBase.design),
    ...(selectedKey.startsWith('round:') && dirtyRound ? { title: roundTitle } : {}),
    ...(selectedSection?.key === 'agenda' && previewBase.automaticAgenda === true ? { options: generatedAgendaOptions(semantic.rounds) } : {}),
  };
  const saveLabel = uploading ? 'Nejdřív dokončete nahrávání média.' : editorSaveLabels[editorSaveStatus(dirty, saving, saveFailed)];
  const structuralDisabled = readOnly || saving || dirty || uploading;
  const deletionDisabled = structuralDisabled || !can('quiz.delete');
  const deletionReason = readOnly || !can('quiz.delete') ? 'Smazání vyžaduje oprávnění upravovat a mazat obsah kvízu.' : dirty ? 'Nejprve uložte nebo zahoďte rozepsané změny.' : uploading ? 'Nejprve dokončete nahrávání média.' : saving ? 'Právě probíhá změna kvízu.' : undefined;
  const navigationAsDraft = draft?.isQuestion === true && (draft.authoringStatus === 'draft' || hasSaveBlockingIssues(draft, quiz.slides.find(slide => slide.id === draft.id), !can('quiz.answers.read')));

  return (
    <MediaAuthoringContext.Provider value={{ quizId: quiz.id, onPending: onUploadPending, canUpload: can('quiz.media.upload'), canAttach: can('quiz.media.attach') }}><article ref={editorRef} className="round-first-editor">
      {(pendingSelection !== null || blocker.state === 'blocked') && (
        <UnsavedChangesDialog
          saveLabel={navigationAsDraft ? "Uložit koncept a pokračovat" : "Uložit a pokračovat"}
          busy={saving || uploading}
          onSave={() => void saveAll(pendingSelection ?? selectedKey, navigationAsDraft ? 'draft' : undefined).then((loaded) => {
            if (loaded === null) return;
            if (blocker.state === 'blocked') blocker.proceed();
            else if (pendingSelection !== null) setSelectedKey(pendingSelection);
            setPendingSelection(null);
          })}
          onDiscard={() => {
            discardDraft();
            if (blocker.state === 'blocked') blocker.proceed();
            else if (pendingSelection !== null && pendingSelection !== 'draft') setSelectedKey(pendingSelection);
            setPendingSelection(null);
          }}
          onCancel={() => {
            if (blocker.state === 'blocked') blocker.reset();
            setPendingSelection(null);
            setPendingFixFocus(null);
          }}
        />
      )}
      {removeQuestion !== null && <RemoveQuestionDialog question={removeQuestion} busy={saving || uploading} error={error}
        onDelete={() => void mutate(current => deleteQuizSlide(current.id, current.revision, removeQuestion.id), removeQuestion.roundId ? `round:${removeQuestion.roundId}` : 'quiz').then(success => { if (success) setRemoveQuestion(null); })}
        onCancel={() => setRemoveQuestion(null)} />}
      {removeRound !== null && (
        <RemoveRoundDialog
          round={removeRound}
          rounds={semantic.rounds}
          busy={saving || uploading}
          error={error}
          onMove={(targetRoundId) => void mutate((current) => removeQuizRound(current.id, current.revision, removeRound.id, 'move', targetRoundId), 'quiz').then((success) => { if (success) setRemoveRound(null); })}
          onDelete={() => void mutate((current) => removeQuizRound(current.id, current.revision, removeRound.id, 'delete'), 'quiz').then((success) => { if (success) setRemoveRound(null); })}
          onCancel={() => setRemoveRound(null)}
        />
      )}

      <header className="round-editor-header">
        <div className="round-editor-title">
          <Link className="back-link" to="/admin/quizzes">← Knihovna kvízů</Link>
          <span className="editor-context-label">Editor kvízu</span>
          <strong>{title || quiz.title}</strong>
        </div>
        <div className="round-editor-save">
          {readOnly && <span className="read-only-badge">Pouze pro čtení</span>}
          <QuizStatusControl quiz={quiz} disabled={dirty || saving || uploading} onChanged={() => reload()} />
          <span className={`save-state ${dirty ? 'dirty' : ''} ${saveFailed ? 'failed' : ''}`} role="status" aria-live="polite">{saveLabel}</span>
          {!dirty && !saving && !saveFailed && lastSavedAt && <time className="working-copy-count" dateTime={lastSavedAt.toISOString()}>Vše uloženo v {lastSavedAt.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}</time>}
          {dirty && <span className="working-copy-count">Rozpracované položky: {new Set([...Object.keys(parked), ...(dirtySlide || dirtyRound ? [selectedKey] : []), ...(dirtyQuiz ? ['quiz'] : [])]).size}</span>}
          <button type="button" className="secondary-button preflight-header-button readiness-chip" aria-expanded={preflightOpen} onClick={() => setPreflightOpen((value) => !value)}>Zkontrolovat kvíz</button><button type="button" ref={practiceButtonRef} className="secondary-button practice-button" disabled={dirty || saving || uploading || practiceSlides(quiz).length === 0} title={dirty ? 'Nejprve uložte rozepsané změny.' : undefined} onClick={() => setPracticing(true)}>Soukromá zkouška</button>
          <button type="button" className="primary-button" disabled={readOnly || saving || uploading || !dirty} onClick={() => void saveAll()}>Uložit vše</button>
          {dirty && <button type="button" className="text-button" disabled={saving || uploading} onClick={() => setPendingSelection(selectedKey)}>Zahodit změny…</button>}
          {draft?.isQuestion && <button type="button" className="secondary-button draft-save-button" disabled={readOnly || saving || uploading} onClick={() => void saveAll(selectedKey, 'draft')}>Uložit koncept</button>}
          <TechnicalDetails><code>Revize: {quiz.revision}<br />Výběr: {selectedKey}</code></TechnicalDetails>
        </div>
      </header>

      {error && <div ref={errorRef} tabIndex={-1} className="round-editor-error"><HumanError error={{ title: 'Změnu nelze dokončit', message: error, technicalCode: saveFailed ? 'EDITOR_SAVE_FAILED' : 'EDITOR_ACTION_FAILED' }} onRetry={saveFailed ? () => void saveAll() : undefined} /></div>}
      {saveFailed && <button type="button" className="secondary-button" disabled={saving || uploading} onClick={() => void discardAndReload()}>Zahodit rozepsané změny a načíst aktuální verzi</button>}

      {preflightOpen && (
        <div className="editor-preflight-shell">
          {validationPending || preflightResult === null ? <p role="status">Aktualizuji připravenost podle rozepsaných změn…</p> : <QuizPreflightPanel
            quizId={quiz.id}
            result={preflightResult}
            onFix={openPreflightFix}
          />}
        </div>
      )}

      <nav className="editor-panel-tabs" aria-label="Část editoru">
        <button type="button" className={activePanel === 'structure' ? 'active' : ''} onClick={() => setActivePanel('structure')}>Struktura</button>
        <button type="button" className={activePanel === 'content' ? 'active' : ''} onClick={() => setActivePanel('content')}>Obsah</button>
        <button type="button" className={activePanel === 'preview' ? 'active' : ''} onClick={() => setActivePanel('preview')}>Náhled</button>
      </nav>

      <section className="round-editor-workspace" data-active-panel={activePanel}>
        <EditorOutline
          model={outlineModel ?? semantic}
          selectedKey={selectedKey}
          activeDraft={draft}
          disabled={structuralDisabled}
          creationDisabled={readOnly || saving || uploading}
          disabledReason={readOnly ? 'Máte oprávnění pouze ke čtení.' : uploading ? 'Nejdříve dokončete nahrávání média.' : saving ? 'Právě ukládám změny…' : 'Pro přesouvání nejprve uložte nebo zahoďte rozepsané změny.'}
          onMove={moveInOutline}
          onMoveRound={moveRoundInOutline}
          deleteDisabled={deletionDisabled}
          questionDeleteDisabled={deletionDisabled || quiz.slideCount <= 1}
          deleteDisabledReason={deletionReason}
          onDeleteQuestion={question => { setError(null); setRemoveQuestion(question); }}
          onDeleteRound={round => { setError(null); setRemoveRound(round); }}
          pickerRoundId={pickerRoundId}
          onSelect={select}
          onOpenPicker={setPickerRoundId}
          onClosePicker={() => setPickerRoundId(null)}
          onCreateQuestion={(round, type) => void createQuestion(round.id, type)}
          onAddInfo={() => void mutate(current => createQuizSlide(current.id, current.revision, current.slideCount + 1, localDraft('info', current.slideCount + 1, { title: 'Organizační sdělení', text: 'Napište oznámení, poděkování nebo pokyny k přestávce.' }), 'quiz'))}
          onAddClosing={() => void mutate(current => createQuizSlide(current.id, current.revision, current.slideCount + 1, localDraft('end', current.slideCount + 1, { title: 'Děkujeme za hru' }), 'quiz'))}
          onAddRound={() => {
            void mutate(current => createQuizRound(current.id, current.revision, `${buildSemanticQuizModel(current).rounds.length + 1}. kolo`), undefined, true);
          }}
        />

        <main className="round-editor-content editor-panel-content">
          {driveEnabled && draft && pendingCreate === null && <DriveMediaImportStatus slide={draft} entries={driveImports.entries} dirty={dirty || saving || uploading} onRetry={field => {
            const saved = quiz.slides.find(slide => slide.id === draft.id);
            if (!dirty && saved) driveImports.retry(saved, field);
          }} />}
          {selectedKey === 'quiz' && (
            <QuizSettingsForm appearance={appearance} onAppearance={value => {setAppearance(value);setDirtyQuiz(true);}} quiz={quiz} title={title} description={description} disabled={readOnly || saving}
              onTitle={(value) => { setTitle(value); setDirtyQuiz(true); }}
              onDescription={(value) => { setDescription(value); setDirtyQuiz(true); }} />
          )}
          {selectedKey === 'quiz' && <div className="editor-get-started"><button type="button" className="primary-button" disabled={readOnly || saving || uploading} onClick={() => void mutate(current => createQuizRound(current.id, current.revision, `${buildSemanticQuizModel(current).rounds.length + 1}. kolo`), undefined, true)}>{semantic.rounds.length === 0 ? 'Přidat první kolo' : 'Přidat kolo'}</button><p className="field-help">Do kola pak přidáte otázky. Další nastavení můžete nechat na později.</p></div>}
          {selectedKey === 'quiz' && <EditorDisclosure title="Vzhled celého kvízu" busy={uploading}>{() => <SlideDesignFields scope="quiz" value={defaultDesign} disabled={readOnly || saving || uploading} onChange={value => { setDefaultDesign(value); setDirtyQuiz(true); }} />}</EditorDisclosure>}
          {selectedKey === 'quiz' && <EditorDisclosure title="Tiskové materiály" busy={uploading}>{() => <PrintTemplateFields quizId={quiz.id} value={printTemplate} disabled={readOnly || saving || uploading} onChange={value => { setPrintTemplate(value); setDirtyQuiz(true); }} />}</EditorDisclosure>}
          {selectedTemplate && <section className="editor-form-stack">
            <header className="content-form-heading"><span>Šablona výsledků</span><h2>{selectedTemplate === 'final' ? 'Finální vyhlášení' : 'Průběžné pořadí'}</h2></header>
            <p className="field-help">Názvy týmů, body a pořadí doplní aplikace z publikovaných výsledků. Zde připravujete jejich vzhled.</p>
            <label className="form-field">Nadpis<input disabled={readOnly || saving} maxLength={500} value={template?.title ?? ''} placeholder={selectedTemplate === 'final' ? 'Finální výsledky' : 'Průběžné pořadí'} onChange={event => { setResultTemplates({ ...resultTemplates, [selectedTemplate]: { ...template, title: event.target.value } }); setDirtyQuiz(true); }} /></label>
            <label className="form-field">Doprovodný text<textarea disabled={readOnly || saving} maxLength={2000} value={template?.subtitle ?? ''} onChange={event => { setResultTemplates({ ...resultTemplates, [selectedTemplate]: { ...template, subtitle: event.target.value } }); setDirtyQuiz(true); }} /></label>
            <SlideDesignFields scope="results" value={template?.design ?? {}} inherited={defaultDesign} disabled={readOnly || saving || uploading} onChange={value => { setResultTemplates({ ...resultTemplates, [selectedTemplate]: { ...template, design: value } }); setDirtyQuiz(true); }} />
          </section>}
          {selectedSection !== undefined && draft !== null && draft.id === (selectedSection.slide?.id ?? `local-${selectedSection.key === 'opening' ? 'intro' : selectedSection.key}`) && (
            <SystemSectionForm section={selectedSection} slide={draft} model={semantic} disabled={readOnly || saving}
              onChange={(value) => { setDraft(value); setDirtySlide(true); }} />
          )}
          {selectedKey.startsWith('round:') && selectedRound !== undefined && (draft?.id === selectedRound.settingsSlide?.id || draft?.roundId === selectedRound.id) && (
            <>
              {selectedRound.id !== 'roundless' && <div className="editor-selection-actions"><span>{selectedRound.position}. kolo · {selectedRound.title}</span><EditorDeleteButton label="Smazat kolo…" disabled={deletionDisabled} reason={deletionReason} onClick={() => { setError(null); setRemoveRound(selectedRound); }} /></div>}
              <RoundSettingsForm round={selectedRound} title={roundTitle} slide={draft ?? undefined} disabled={readOnly || saving}
                onTitle={(value) => { setRoundTitle(value); setDirtyRound(true); if (draft?.id === 'local-round') { setDraft({ ...draft, title: value }); setDirtySlide(true); } }}
                onChange={(value) => { setDraft(value); setDirtySlide(true); }} />
              {selectedRound.id !== 'roundless' && <div className="editor-get-started"><button type="button" className="primary-button" disabled={readOnly || saving || uploading} onClick={() => void createQuestion(selectedRound.id)}>Přidat otázku</button><p className="field-help">Stačí zadání a správná odpověď. Média přidáte podle potřeby.</p></div>}
              {selectedRound.id !== 'roundless' ? <details className="editor-extra"><summary>Další akce kola</summary><div className="semantic-actions round-actions">
                <button type="button" className="secondary-button" disabled={structuralDisabled || selectedRound.position === 1} onClick={() => void mutate((current) => moveQuizRound(current.id, current.revision, selectedRound.id, -1), `round:${selectedRound.id}`)}>Přesunout nahoru</button>
                <button type="button" className="secondary-button" disabled={structuralDisabled || selectedRound.position === semantic.rounds.length} onClick={() => void mutate((current) => moveQuizRound(current.id, current.revision, selectedRound.id, 1), `round:${selectedRound.id}`)}>Přesunout dolů</button>
                <button type="button" className="secondary-button" disabled={structuralDisabled} onClick={() => void mutate((current) => duplicateQuizRound(current.id, current.revision, selectedRound.id))}>Duplikovat včetně otázek</button>
              </div></details> : <p className="field-help">Toto je bezpečný přehled starších otázek bez přiřazeného kola. Otázky můžete jednotlivě přesunout.</p>}
            </>
          )}
          {draft?.isQuestion && (selectedKey === 'draft' || selectedKey === `slide:${draft.id}`) && (
            <>
              {!isLocalQuestion && <div className="editor-selection-actions"><span>{questionNumber}. otázka{selectedRound ? ` · ${selectedRound.title}` : ''}</span><EditorDeleteButton label="Smazat otázku…" disabled={deletionDisabled || quiz.slideCount <= 1} reason={deletionReason ?? (quiz.slideCount <= 1 ? 'Poslední slide kvízu nelze tímto způsobem smazat.' : undefined)} onClick={() => { setError(null); setRemoveQuestion(draft); }} /></div>}
              <QuestionForm answersReadable={can('quiz.answers.read')} answersEditable={can('quiz.answers.edit')} notesReadable={can('quiz.notes.read')} notesEditable={can('quiz.notes.edit')} key={draft.id} defaultAppearance={quiz.defaultAppearance ?? initialAppearance} onUploadPending={onUploadPending} quizId={quiz.id} slide={draft} number={questionNumber} disabled={readOnly || saving || uploading} showAllIssues={showReadiness} touched={touched}
                onNext={selectedRound === undefined ? undefined : () => void createQuestion(selectedRound.id)}
                onTouch={(field) => setTouched((current) => new Set(current).add(field))}
                onChange={(value) => { setDraft(value); setDirtySlide(true); setSaveFailed(false); }} />
              <div className="question-save-actions" data-preflight-field="authoringStatus">
                {draft.authoringStatus === 'draft' && <><p role="status">Koncept otázky — zatím není označená jako dokončená.</p><button type="button" className="primary-button" disabled={readOnly || saving || uploading} onClick={() => void saveAll(selectedKey, 'ready')}>Dokončit otázku</button></>}
              </div>
              {!isLocalQuestion && selectedRound !== undefined && (
                <details className="editor-extra" data-preflight-field="order"><summary>Duplikovat nebo přesunout otázku</summary><div className="semantic-actions question-actions">
                  <button type="button" className="secondary-button" disabled={structuralDisabled || questionNumber === 1} onClick={() => void mutate((current) => reorderQuizQuestion(current.id, current.revision, draft.id, -1))}>Posunout nahoru</button>
                  <button type="button" className="secondary-button" disabled={structuralDisabled || questionNumber === selectedRound.questions.length} onClick={() => void mutate((current) => reorderQuizQuestion(current.id, current.revision, draft.id, 1))}>Posunout dolů</button>
                  <button type="button" className="secondary-button" disabled={structuralDisabled} onClick={() => void mutate((current) => duplicateQuizSlide(current.id, current.revision, draft.id))}>Duplikovat</button>
                  {semantic.rounds.filter((round) => round.id !== selectedRound.id && round.id !== 'roundless').length > 0 && (
                    <label className="move-to-round">Přesunout do kola
                      <select aria-label="Přesunout do kola" disabled={structuralDisabled} defaultValue="" onChange={(event) => {
                        if (event.target.value !== '') void mutate((current) => moveQuizQuestionToRound(current.id, current.revision, draft.id, event.target.value));
                      }}>
                        <option value="" disabled>Vyberte…</option>
                        {semantic.rounds.filter((round) => round.id !== selectedRound.id && round.id !== 'roundless').map((round) => <option key={round.id} value={round.id}>{round.position}. kolo – {round.title}</option>)}
                      </select>
                    </label>
                  )}
                </div></details>
              )}
              {isLocalQuestion && <button type="button" disabled={uploading} className="text-button" onClick={() => { discardDraft(); setSelectedKey(`round:${selectedRound?.id ?? ''}`); }}>Zrušit novou otázku</button>}
            </>
          )}
          {draft !== null && !draft.isQuestion && !selectedKey.startsWith('system:') && !selectedKey.startsWith('round:') && (
            <SystemContentForm slide={draft} disabled={readOnly || saving} onChange={(value) => { setDraft(value); setDirtySlide(true); }} />
          )}
          {draft !== null && <EditorDisclosure key={`design:${selectedKey}`} field="backgroundImage" title={`Vzhled ${selectedKey.startsWith('round:') ? 'celého kola' : 'otázky nebo slidu'}`} busy={uploading}>{() => <SlideDesignFields scope={selectedKey.startsWith('round:') ? 'round' : 'slide'} value={draft.design ?? {}} legacy={legacySlideDesign({ ...draft, ...resolveLegacySlideAppearance(appearance, draft) })} legacyResetAvailable={Boolean(draft.backgroundImage) || (draft.backgroundOverlay ?? draft.presentation.backgroundOverlay ?? 0) > 0 || draft.imageLayout !== undefined} inherited={inheritedDesign} disabled={readOnly || saving || uploading} onChange={value => { setDraft({ ...draft, design: value }); setDirtySlide(true); }} onReset={() => { setDraft({ ...draft, design: {}, resetAppearance: true, backgroundImage: '', backgroundOverlay: null, imageLayout: undefined, presentation: { ...draft.presentation, backgroundOverlay: null } }); setDirtySlide(true); }} />}</EditorDisclosure>}
          {draft?.isQuestion && can('quiz.answers.read') && <EditorDisclosure key={`answer-design:${selectedKey}`} title="Vzhled odhalené odpovědi" busy={uploading}>{() => <SlideDesignFields scope="answer" value={draft.answerDesign ?? {}} inherited={resolveSlideDesign(legacySlideDesign(draft), inheritedDesign, draft.design)} disabled={readOnly || saving || uploading || !can('quiz.answers.edit')} onChange={value => { setDraft({ ...draft, answerDesign: value }); setDirtySlide(true); }} />}</EditorDisclosure>}
          {draft !== null && !draft.isQuestion && ['info', 'end', 'title'].includes(draft.kind) && !pendingCreate && <div className="semantic-actions">
            <button type="button" className="secondary-button" disabled={structuralDisabled} onClick={() => void mutate(current => duplicateQuizSlide(current.id, current.revision, draft.id))}>Duplikovat slide</button>
            <button type="button" className="secondary-button" disabled={structuralDisabled || draft.position <= 1} onClick={() => void mutate(current => moveQuizSlide(current.id, current.revision, draft.id, -1))}>Posunout před předchozí slide</button>
            <button type="button" className="secondary-button" disabled={structuralDisabled || draft.position >= quiz.slideCount} onClick={() => void mutate(current => moveQuizSlide(current.id, current.revision, draft.id, 1))}>Posunout za následující slide</button>
            <button type="button" className="danger-button" disabled={structuralDisabled || !can('quiz.delete') || quiz.slideCount <= 1} onClick={() => { if (window.confirm('Odstranit tento informační slide?')) void mutate(current => deleteQuizSlide(current.id, current.revision, draft.id)); }}>Odstranit slide</button>
          </div>}
          {draft !== null && !draft.isQuestion && !draft.roundId && ['intro', 'agenda', 'rules', 'end', 'title', 'info'].includes(draft.kind) && <label className="binary-answer"><input type="checkbox" checked={draft.hidden === true} disabled={readOnly || saving} onChange={event => { setDraft({ ...draft, hidden: event.target.checked }); setDirtySlide(true); }} /> Skrýt při moderování <span className="field-help">Obsah zůstane uložený, průběh jej přeskočí.</span></label>}
          {showReadiness && draft?.isQuestion && <ReadinessSummary slide={draft} />}
          {dirty && <p className="structure-save-hint">Strukturální operace budou dostupné po uložení nebo zahození rozepsaných změn.</p>}
        </main>

        {selectedTemplate ? <ResultTemplatePreview key={selectedTemplate} kind={selectedTemplate} template={{ ...template, design: resolveSlideDesign(defaultDesign, undefined, template?.design) }} onEdit={() => setActivePanel('content')} /> : previewSlide === undefined ? (
          <aside className="round-editor-preview editor-panel-preview editor-empty-preview">
            <header className="preview-heading"><span>Náhled</span><strong>Zatím není co promítnout</strong></header>
            <p>Nejdřív přidejte kolo a otázku. Prázdný rozpracovaný kvíz zůstává bezpečně uložený.</p>
          </aside>
        ) : (
          <EditorPreview onEdit={() => { setActivePanel('content'); requestAnimationFrame(() => document.querySelector<HTMLElement>('.round-editor-content input, .round-editor-content textarea, .round-editor-content summary')?.focus()); }} slide={previewSlide} quizTitle={title || quiz.title} showAnswer={showAnswer && can('quiz.answers.read')} onShowAnswer={value => { if (can('quiz.answers.read')) setShowAnswer(value); }} />
        )}
      </section>
    </article></MediaAuthoringContext.Provider>
  );
}
