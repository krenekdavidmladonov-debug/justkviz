import { buildSemanticQuizModel, questionRoundAtGap, generatedAgendaOptions, mapEditorSlide, mergeStoredDesign, normalizeSlideDesign, mergeStoredPrintTemplate } from '@filmovy-kviz/quiz-domain';
import { assertQuizAssets } from '../media/model.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { accessActor, authorize, authorizeOperation, freshIdentity, securedOnCall, runAccessTransaction, grantCreatedResource, currentMembership } from '../access/authorization.js';
import { preserveHiddenFields, protectPrivateMedia, protectSlideFields } from '../access/editor-fields.js';
import { assertQuizActive } from '../quizzes/guards.js';
import { driveRuntimeSecrets } from '../drive/runtime.js';
import { verifyDriveAssets } from '../drive/media-read.js';
import { materializeQuizCopyAsset, verifyQuizCopyAssetPin, type QuizCopyStoragePin } from '../media/quiz-copy-storage.js';

import { starterSlides } from './starter.js';
import { QuizEditorError } from './errors.js';
import {
  applyKnownSlideUpdate,
  assertRevision,
  createSlideData,
  duplicateSlideData,
  isQuestionKind,
  isRoundKind,
  questionTypeForKind,
  quizCreationIdentity,
  quizDuplicationIdentity,
  quizRevision,
  sortedSlides,
  moveSlidesBefore,
  mergeStoredResultTemplates,
  validateExistingRoundHeaderTarget,
  type StoredEditorSlide,
} from './model.js';
import type { EditorQuizMutationResponse, EditorSlideKind } from './types.js';
import { applyPreflightRepair, requestedPreflightRepair } from './repair.js';
import { quizCopyAssetBinding, readQuizCopyMedia, rebindQuizCopyMedia, unavailableQuizCopyMedia } from './quiz-copy-media.js';
import {
  expectedRevision,
  isObject,
  requestedDirection,
  requestedSlideMove,
  requestedPosition,
  requestedRoundRemovalMode,
  requestedRoundTitle,
  requestedQuizCreation,
  requestedQuizDuplication,
  requestedSlide,
  requiredId,
  validateQuizMetadata,
} from './validation.js';

if (getApps().length === 0) initializeApp();

const db = getFirestore();
const callableOptions = { region: 'europe-west1', cors: true } as const;
const maximumSlideCount = 400;
const maximumQuizWriteCount = 475;

interface AdminActor {
  readonly uid: string;
  readonly role: 'admin';
}

interface QuizState {
  readonly quizId: string;
  readonly quizRef: FirebaseFirestore.DocumentReference;
  readonly quiz: Record<string, unknown>;
  readonly revision: number;
  readonly slides: readonly StoredEditorSlide[];
}

export function authorizeEditorAdmin(auth: CallableRequest<unknown>['auth']): AdminActor {
  return accessActor(auth);
}

function snapshotData(snapshot: DocumentSnapshot, location: string): Record<string, unknown> {
  const value: unknown = snapshot.data();
  if (!isObject(value)) throw new QuizEditorError('failed-precondition', `${location} is malformed.`);
  return value;
}

function requiredStoredCount(quiz: Record<string, unknown>, field: string): number {
  const value = quiz[field];
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new QuizEditorError('failed-precondition', 'Quiz counters are malformed.');
  }
  return value as number;
}

async function loadQuizState(
  transaction: Transaction,
  quizId: string,
  revision: number,
): Promise<QuizState> {
  const quizRef = db.collection('quizzes').doc(quizId);
  const quizSnapshot = await transaction.get(quizRef);
  if (!quizSnapshot.exists) throw new QuizEditorError('not-found', 'Quiz was not found.');
  const quiz = snapshotData(quizSnapshot, 'Quiz');
  const currentRevision = assertRevision(quiz, revision);
  const slideSnapshot = await transaction.get(quizRef.collection('slides').orderBy('position').limit(maximumSlideCount + 1));
  const slides = sortedSlides(slideSnapshot.docs.map((document) => ({
    id: document.id,
    data: snapshotData(document, 'Quiz slide'),
  })));
  if (slides.length !== requiredStoredCount(quiz, 'slideCount')) {
    throw new QuizEditorError('failed-precondition', 'Quiz slideCount does not match its ordered slides.');
  }
  if (slides.length > maximumSlideCount) {
    throw new QuizEditorError('failed-precondition', 'Quiz is too large for one safe editor transaction.');
  }
  return { quizId, quizRef, quiz, revision: currentRevision, slides };
}

function storedKind(slide: StoredEditorSlide): EditorSlideKind {
  const value = slide.data.kind;
  if (typeof value !== 'string') throw new QuizEditorError('failed-precondition', 'Quiz slide kind is malformed.');
  return value as EditorSlideKind;
}

function slideRoundId(slide: StoredEditorSlide): string | undefined {
  return typeof slide.data.roundId === 'string' && slide.data.roundId.length > 0
    ? slide.data.roundId
    : undefined;
}

function isAutomaticScreen(slide: StoredEditorSlide): boolean {
  return isStoredRoundHeader(slide) || (slideRoundId(slide) !== undefined && storedKind(slide) === 'recap')
    || slide.data.generatedAgendaSlide === true || slide.data.automaticAgenda === true;
}

function isStoredRoundHeader(slide: StoredEditorSlide): boolean {
  return isRoundKind(storedKind(slide))
    || (slideRoundId(slide) !== undefined && storedKind(slide) === 'intro' && slide.data.isQuestion !== true);
}

function stateCounts(slides: readonly StoredEditorSlide[]) {
  const roundIds = new Set(slides.map(slideRoundId).filter((value): value is string => value !== undefined));
  return {
    slideCount: slides.length,
    questionCount: slides.filter((slide) => slide.data.isQuestion === true).length,
    roundCount: roundIds.size,
  };
}

function currentQuizResponse(quizId: string, quiz: Record<string, unknown>): EditorQuizMutationResponse {
  return {
    quizId,
    revision: quizRevision(quiz),
    slideCount: requiredStoredCount(quiz, 'slideCount'),
    questionCount: requiredStoredCount(quiz, 'questionCount'),
    roundCount: requiredStoredCount(quiz, 'roundCount'),
  };
}

function publicResponse(
  state: QuizState,
  slides: readonly StoredEditorSlide[],
  selectedSlideId?: string,
): EditorQuizMutationResponse {
  return {
    quizId: state.quizId,
    revision: state.revision + 1,
    ...stateCounts(slides),
    ...(selectedSlideId === undefined ? {} : { selectedSlideId }),
  };
}

function insertNativeRound(state: QuizState, index: number, roundId: string, title: string, content?: StoredEditorSlide) {
  const screens = state.quizRef.collection('slides');
  const basic = { title, text: '', moderatorNote: '', options: [], media: [], correctAnswer: '', presentation: {}, roundId, isQuestion: false };
  const header = { id: screens.doc().id, data: { ...basic, kind: 'round' } };
  const members: StoredEditorSlide[] = [header];
  if (content) members.push(content);
  if (content?.data.kind !== 'recap') members.push({ id: screens.doc().id, data: { ...basic, kind: 'recap' } });
  const stream = [...state.slides.slice(0, index), ...members, ...state.slides.slice(index)];
  if (!stream.some(slide => slide.data.kind === 'agenda')) {
    const firstContent = stream.findIndex(slide => slide.data.kind !== 'intro');
    stream.splice(firstContent, 0, { id: screens.doc().id, data: {
      kind: 'agenda', title: 'Harmonogram', text: '', moderatorNote: '', options: [], correctAnswer: '', media: [],
      presentation: {}, isQuestion: false, automaticAgenda: true, generatedAgendaSlide: true,
    } });
  }
  if (stream.length > maximumSlideCount) throw new QuizEditorError('failed-precondition', 'Quiz slide limit reached.');
  return { slides: orderedWithPositions(stream), headerId: header.id };
}

function storedRoundName(members: readonly StoredEditorSlide[]): string | undefined {
  const header = members.find(slide => isRoundKind(storedKind(slide))) ?? members.find(isStoredRoundHeader);
  const heading = typeof header?.data.title === 'string' ? header.data.title : undefined;
  if (heading?.trim() && header?.data.customRoundHeading !== true) return heading;
  if (typeof header?.data.roundTitle === 'string' && header.data.roundTitle.trim()) return header.data.roundTitle;
  return members.map(slide => slide.data.roundTitle).find((name): name is string => typeof name === 'string' && !!name.trim()) ?? heading;
}

function orderedWithPositions(slides: readonly StoredEditorSlide[]): readonly StoredEditorSlide[] {
  const positioned: StoredEditorSlide[] = slides.map((slide, index) => ({
    id: slide.id,
    data: { ...slide.data, position: index + 1 },
  }));
  const groups = new Map<string, typeof positioned>();
  for (const slide of positioned) {
    const roundId = slideRoundId(slide);
    if (roundId === undefined) continue;
    const group = groups.get(roundId) ?? [];
    group.push(slide);
    groups.set(roundId, group);
  }
  for (const group of groups.values()) {
    const questions = group.filter((slide) => slide.data.isQuestion === true);
    const roundTitle = storedRoundName(group);
    group.forEach((slide) => {
      if (roundTitle !== undefined) slide.data.roundTitle = roundTitle;
      const questionIndex = questions.findIndex((question) => question.id === slide.id);
      if (questionIndex >= 0) {
        slide.data.questionNumber = questionIndex + 1;
        slide.data.questionCount = questions.length;
      } else {
        delete slide.data.questionNumber;
        delete slide.data.questionCount;
      }
    });
  }
  return positioned;
}

function derivedPresentation(data: Record<string, unknown>): Record<string, unknown> {
  return isObject(data.presentation) ? data.presentation : {};
}

function writeDerivedState(
  transaction: Transaction,
  state: Pick<QuizState, 'quizRef' | 'slides'>,
  slides: readonly StoredEditorSlide[],
): void {
  const storedRoundIds = new Set(state.slides.map(slideRoundId).filter((value): value is string => value !== undefined));
  const groups = new Map<string, StoredEditorSlide[]>();
  for (const slide of slides) {
    const roundId = slideRoundId(slide);
    if (roundId === undefined) continue;
    const group = groups.get(roundId) ?? [];
    group.push(slide);
    groups.set(roundId, group);
  }

  let roundPosition = 0;
  for (const [roundId, group] of groups) {
    roundPosition += 1;
    const header = group.find((slide) => isRoundKind(storedKind(slide))) ?? group.find((slide) => storedKind(slide) === 'intro' && slide.data.isQuestion !== true);
    const questions = group.filter((slide) => slide.data.isQuestion === true);
    const inferredType = questions.length > 0 && questions.every((slide) => ['audio', 'music'].includes(String(slide.data.kind)))
      ? 'audio'
      : questions.length > 0 && questions.every((slide) => ['image', 'picture', 'photo'].includes(String(slide.data.kind))) ? 'picture' : 'classic';
    transaction.set(state.quizRef.collection('rounds').doc(roundId), {
      position: roundPosition,
      ...(storedRoundIds.has(roundId) ? {} : { type: inferredType }),
      slideCount: group.length,
      questionCount: questions.length,
      design: isObject(header?.data.design) ? normalizeSlideDesign(header.data.design) : FieldValue.delete(),
      sourceSlideStart: group[0]?.data.position,
      sourceSlideEnd: group[group.length - 1]?.data.position,
      ...(header === undefined && storedRoundIds.has(roundId) ? {} : {
        title: header?.data.roundTitle ?? header?.data.title ?? group[0]?.data.roundTitle ?? `${roundPosition}. kolo`,
      }),
    }, { merge: true });

    questions.forEach((slide, index) => {
      const kind = storedKind(slide);
      const presentation = derivedPresentation(slide.data);
      const presentationField = (field: string): unknown => (
        Object.hasOwn(presentation, field) ? presentation[field] : FieldValue.delete()
      );
      const correctAnswer = Object.hasOwn(slide.data, 'correctAnswer')
        ? slide.data.correctAnswer
        : FieldValue.delete();
      const moderatorNote = Object.hasOwn(slide.data, 'moderatorNote')
        ? slide.data.moderatorNote
        : FieldValue.delete();
      transaction.set(state.quizRef.collection('rounds').doc(roundId).collection('questions').doc(slide.id), {
        position: index + 1,
        prompt: typeof slide.data.text === 'string' && slide.data.text.length > 0
          ? slide.data.text
          : typeof slide.data.title === 'string' ? slide.data.title : '',
        type: questionTypeForKind(kind),
        sourceSlideId: slide.id,
        sourceSlidePosition: slide.data.position,
        options: Array.isArray(slide.data.options) ? slide.data.options : [],
        media: Array.isArray(slide.data.media) ? slide.data.media : [],
        videoStart: presentationField('videoStart'),
        videoEnd: presentationField('videoEnd'),
        audioTrigger: presentationField('audioTrigger'),
        backgroundOverlay: presentationField('backgroundOverlay'),
        answerOverlay: presentationField('answerOverlay'),
        sourceQuestionNumber: presentationField('sourceQuestionNumber'),
        correctAnswer,
        ...(slide.data.authoringStatus === undefined ? {} : { authoringStatus: slide.data.authoringStatus }),
        ...(slide.data.answerMode === undefined ? {} : { answerMode: slide.data.answerMode }),
        moderatorNote,
      }, { merge: true });
    });
  }
}

function writeSlideDocuments(
  transaction: Transaction,
  state: Pick<QuizState, 'quizRef' | 'revision' | 'slides'>,
  slides: readonly StoredEditorSlide[],
) {
  if (slides.some(slide => slide.data.automaticAgenda === true)) {
    const mapped = slides.map(slide => mapEditorSlide(slide.id, slide.data));
    const model = buildSemanticQuizModel({ id: state.quizRef.id, title: '', description: '', revision: state.revision, slideCount: slides.length, roundCount: 0, questionCount: 0, slides: mapped });
    slides = slides.map(slide => slide.data.automaticAgenda === true ? { ...slide, data: { ...slide.data, options: generatedAgendaOptions(model.rounds, mapped) } } : slide);
  }
  const derivedRoundIds = new Set(slides.map(slideRoundId).filter((value): value is string => value !== undefined));
  const derivedQuestions = slides.filter((slide) => slide.data.isQuestion === true && slideRoundId(slide) !== undefined).length;
  const estimatedWrites = slides.length + derivedQuestions + derivedRoundIds.size + 3;
  if (estimatedWrites > maximumQuizWriteCount) {
    throw new QuizEditorError('failed-precondition', 'Quiz is too large for one safe editor transaction.');
  }
  for (const slide of slides) {
    transaction.set(state.quizRef.collection('slides').doc(slide.id), slide.data);
  }
  writeDerivedState(transaction, state, slides);
}

function writeQuizState(
  transaction: Transaction,
  state: QuizState,
  slides: readonly StoredEditorSlide[],
  actor: AdminActor,
): EditorQuizMutationResponse {
  writeSlideDocuments(transaction, state, slides);
  const now = Timestamp.now();
  const counts = stateCounts(slides);
  transaction.update(state.quizRef, {
    ...counts,
    revision: state.revision + 1,
    updatedAt: now,
    updatedBy: actor.uid,
  });
  return publicResponse(state, slides);
}

function deleteOldDerivedQuestion(
  transaction: Transaction,
  state: QuizState,
  slide: StoredEditorSlide,
): void {
  const roundId = slideRoundId(slide);
  if (roundId !== undefined && slide.data.isQuestion === true) {
    transaction.delete(state.quizRef.collection('rounds').doc(roundId).collection('questions').doc(slide.id));
  }
}

function mapError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof QuizEditorError) throw new HttpsError(error.code, error.message);
  throw new HttpsError('internal', 'Quiz editor operation failed.');
}

export const createQuiz = securedOnCall('createQuiz', callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const creation = requestedQuizCreation(request.data);
    const identity = quizCreationIdentity(actor.uid, creation.requestId, creation.title);
    const quizRef = db.collection('quizzes').doc(identity.quizId);
    return await runAccessTransaction(db, async (transaction) => {
      const existing = await transaction.get(quizRef);
      if (existing.exists) {
        const quiz = snapshotData(existing, 'Quiz');
        if (quiz.createdBy !== actor.uid || quiz.creationFingerprint !== identity.fingerprint) {
          throw new QuizEditorError('already-exists', 'requestId was already used for another quiz creation.');
        }
        await authorize(request.auth, ['quiz.read', 'quiz.create'], { kind: 'quiz', id: identity.quizId }, transaction);
        return currentQuizResponse(identity.quizId, quiz);
      }
      const now = Timestamp.now();
      grantCreatedResource(transaction, 'quiz', identity.quizId);
      const slides = orderedWithPositions(starterSlides(creation.title));
      const counts = stateCounts(slides);
      transaction.create(quizRef, {
        schemaVersion: 1,
        title: creation.title,
        description: '',
        status: 'draft',
        revision: 0,
        ...counts,
        creationFingerprint: identity.fingerprint,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.uid,
        updatedBy: actor.uid,
      });
      writeSlideDocuments(transaction, { quizRef, revision: 0, slides: [] }, slides);
      return { quizId: identity.quizId, revision: 0, ...counts };
    });
  } catch (error) {
    return mapError(error);
  }
});

async function readQuizCopyContent(transaction: Transaction, quizId: string, revision: number, targetId: string, actorUid: string) {
  const source = await loadQuizState(transaction, quizId, revision);
  const counts = stateCounts(source.slides);
  if (typeof source.quiz.description !== 'string' || counts.roundCount !== requiredStoredCount(source.quiz, 'roundCount')
    || counts.questionCount !== requiredStoredCount(source.quiz, 'questionCount')) {
    throw new QuizEditorError('failed-precondition', 'Quiz content does not match its stored metadata.');
  }
  const metadata = Object.fromEntries(['description', 'defaultAppearance', 'defaultDesign', 'resultTemplates', 'printTemplate']
    .filter(key => Object.hasOwn(source.quiz, key)).map(key => [key, source.quiz[key]]));
  const roundSnapshot = await transaction.get(source.quizRef.collection('rounds').limit(maximumSlideCount + 1));
  if (roundSnapshot.size !== counts.roundCount) {
    throw new QuizEditorError('failed-precondition', 'Quiz roundCount does not match its stored rounds.');
  }

  // Child IDs are local to the new root, so references between slides and
  // their derived round/question records continue to point into the copy.
  const roundIds = new Set(roundSnapshot.docs.map(round => round.id));
  const questionIds = new Map<string, Set<string>>();
  for (const slide of source.slides) {
    const roundId = slideRoundId(slide);
    if (roundId === undefined) continue;
    if (!roundIds.has(roundId)) throw new QuizEditorError('failed-precondition', 'Quiz slide does not match a stored round.');
    if (slide.data.isQuestion !== true) continue;
    const group = questionIds.get(roundId) ?? new Set<string>();
    group.add(slide.id);
    questionIds.set(roundId, group);
  }
  const linkedQuestionCount = [...questionIds.values()].reduce((total, group) => total + group.size, 0);
  const rounds = await Promise.all(roundSnapshot.docs.map(async (round) => {
    const data = snapshotData(round, 'Quiz round');
    const knownQuestions = questionIds.get(round.id);
    const count = knownQuestions?.size ?? 0;
    const questions = await transaction.get(round.ref.collection('questions').limit(count + 1));
    if (questions.size !== count || questions.docs.some(question => !knownQuestions?.has(question.id))) {
      throw new QuizEditorError('failed-precondition', 'Quiz round questions do not match its stored slides.');
    }
    return {
      id: round.id, data,
      questions: questions.docs.map(question => ({ id: question.id, data: snapshotData(question, 'Quiz question') })),
    };
  }));
  const assetIds = new Set<string>();
  const rebind = (data: Record<string, unknown>) => rebindQuizCopyMedia(data, quizId, targetId, assetIds);
  const content = {
    metadata: rebind(metadata),
    slides: source.slides.map(slide => ({ id: slide.id, data: rebind(slide.data) })),
    rounds: rounds.map(round => ({ id: round.id, data: rebind(round.data),
      questions: round.questions.map(question => ({ id: question.id, data: rebind(question.data) })) })),
  };
  if (counts.slideCount + counts.roundCount + linkedQuestionCount + assetIds.size + 4 > maximumQuizWriteCount) {
    throw new HttpsError('resource-exhausted', 'Kvíz je příliš velký pro vytvoření jedné úplné kopie.');
  }
  return { ...content, counts, ...await readQuizCopyMedia(transaction, db, quizId, actorUid, assetIds) };
}

type QuizCopyContent = Awaited<ReturnType<typeof readQuizCopyContent>>;
type QuizCopyAttempt = {
  fingerprint: string;
  mediaFingerprint: string;
  driveConnection: QuizCopyContent['driveConnection'];
  pins: Record<string, QuizCopyStoragePin>;
  completedAt?: Timestamp;
};

function sameQuizCopyConnection(a: QuizCopyContent['driveConnection'], b: QuizCopyContent['driveConnection']) {
  return a?.generation === b?.generation && a?.account === b?.account;
}

function assertQuizCopyDriveAuthority(connection: QuizCopyContent['driveConnection']) {
  if (!connection) return;
  const member = currentMembership();
  if (member.role !== 'owner' || !member.permissions.includes('users.manage')) {
    throw new HttpsError('permission-denied', 'Kopírování soukromých médií vyžaduje aktuální oprávnění vlastníka Disku.', 'quiz-copy-drive-owner-required');
  }
}

function writeQuizCopy(
  transaction: Transaction, target: FirebaseFirestore.DocumentReference, content: QuizCopyContent,
  pins: ReadonlyMap<string, QuizCopyStoragePin>, title: string, fingerprint: string, actorUid: string,
): EditorQuizMutationResponse {
  const now = Timestamp.now();
  grantCreatedResource(transaction, 'quiz', target.id);
  transaction.create(target, {
    ...content.metadata,
    ...content.counts,
    schemaVersion: 1,
    title,
    status: 'draft',
    revision: 0,
    creationFingerprint: fingerprint,
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    updatedBy: actorUid,
  });
  for (const slide of content.slides) transaction.create(target.collection('slides').doc(slide.id), slide.data);
  for (const round of content.rounds) {
    const roundRef = target.collection('rounds').doc(round.id);
    transaction.create(roundRef, round.data);
    for (const question of round.questions) transaction.create(roundRef.collection('questions').doc(question.id), question.data);
  }
  for (const asset of content.assets) {
    const pin = pins.get(asset.assetId);
    if (!pin) throw unavailableQuizCopyMedia();
    transaction.create(target.collection('mediaAssets').doc(asset.assetId), {
      quizId: target.id, assetId: asset.assetId, kind: asset.kind, contentType: asset.contentType, size: asset.size,
      status: 'ready', storageBackend: 'storage', createdBy: actorUid, createdAt: now, readyAt: now, ...pin,
    });
  }
  return { quizId: target.id, revision: 0, ...content.counts };
}

const duplicateQuizOptions = { ...callableOptions, timeoutSeconds: 540, memory: '512MiB', cpu: 1, concurrency: 1, maxInstances: 4,
  ...(driveRuntimeSecrets.length ? { secrets: driveRuntimeSecrets } : {}) } as const;

export const createDuplicateQuizCallable = (materialize = materializeQuizCopyAsset, verifyResumedDrive = verifyDriveAssets) => securedOnCall(
  'duplicateQuiz', duplicateQuizOptions, async (request): Promise<EditorQuizMutationResponse> => {
  request.rawRequest.res?.setHeader('Cache-Control', 'no-store');
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const input = requestedQuizDuplication(request.data);
    const identity = quizDuplicationIdentity(actor.uid, input.requestId, input.quizId, input.expectedRevision, input.title);
    const target = db.collection('quizzes').doc(identity.quizId);
    const attempt = db.collection('quizDuplicationAttempts').doc(identity.quizId);
    const sourceScope = { kind: 'quiz', id: input.quizId } as const;
    const started = Date.now();

    async function existingCopy(transaction: Transaction) {
      const existing = await transaction.get(target);
      if (!existing.exists) return undefined;
      const quiz = snapshotData(existing, 'Quiz');
      if (quiz.createdBy !== actor.uid || quiz.creationFingerprint !== identity.fingerprint) {
        throw new QuizEditorError('already-exists', 'requestId was already used for another quiz duplication.');
      }
      await authorize(request.auth, ['quiz.read', 'quiz.edit'], { kind: 'quiz', id: identity.quizId }, transaction);
      assertQuizActive(quiz);
      return currentQuizResponse(identity.quizId, quiz);
    }

    async function readAttempt(transaction: Transaction) {
      const stored = (await transaction.get(attempt)).data() as QuizCopyAttempt | undefined;
      if (stored && stored.fingerprint !== identity.fingerprint) {
        throw new QuizEditorError('already-exists', 'requestId was already used for another quiz duplication.');
      }
      if (stored?.completedAt) throw new QuizEditorError('failed-precondition', 'Completed copy is no longer available.');
      return stored;
    }

    const plan = await runAccessTransaction(db, async transaction => {
      const existing = await existingCopy(transaction);
      if (existing) return { result: existing };
      const stored = await readAttempt(transaction);
      const content = await readQuizCopyContent(transaction, input.quizId, input.expectedRevision, target.id, actor.uid);
      if (stored && stored.mediaFingerprint !== content.mediaFingerprint) {
        throw new QuizEditorError('aborted', 'Source media changed during quiz duplication.');
      }
      if (!content.assets.length) return { result: writeQuizCopy(transaction, target, content, new Map(), input.title, identity.fingerprint, actor.uid) };
      await authorize(request.auth, ['quiz.media.upload'], sourceScope, transaction);
      assertQuizCopyDriveAuthority(content.driveConnection);
      const progress = stored && sameQuizCopyConnection(stored.driveConnection, content.driveConnection) ? stored.pins : {};
      if (!stored) transaction.create(attempt, { fingerprint: identity.fingerprint, mediaFingerprint: content.mediaFingerprint,
        driveConnection: content.driveConnection, pins: progress, createdAt: Timestamp.now() });
      else if (progress !== stored.pins) transaction.update(attempt, { driveConnection: content.driveConnection, pins: progress });
      return { content, progress };
    });
    if (plan.result) return plan.result;

    const prepared = plan.content;
    const pins = new Map<string, QuizCopyStoragePin>();
    const destinationFor = (assetId: string) => ({ quizId: target.id, assetId,
      binding: quizCopyAssetBinding(identity.fingerprint, prepared.mediaFingerprint, assetId) });
    const savedAssets = prepared.assets.filter(asset => plan.progress[asset.assetId] !== undefined);
    // Verified generations are immutable. Confirm their metadata in parallel
    // so an interrupted large transfer spends its next window on new files.
    for (let start = 0; start < savedAssets.length; start += 12) {
      await Promise.all(savedAssets.slice(start, start + 12).map(async asset => {
        const pin = plan.progress[asset.assetId]!;
        if (await verifyQuizCopyAssetPin(asset, destinationFor(asset.assetId), pin)) pins.set(asset.assetId, pin);
      }));
    }
    const resumedDrive = savedAssets.flatMap(asset => asset.raw && pins.has(asset.assetId) ? [asset.raw] : []);
    if (resumedDrive.length) await verifyResumedDrive(resumedDrive, input.quizId);
    for (const asset of prepared.assets) {
      if (pins.has(asset.assetId)) continue;
      if (Date.now() - started > 420_000) {
        throw new HttpsError('unavailable', 'Přenos médií ještě není dokončený. Zopakujte stejný pokus.', 'quiz-copy-media-retry');
      }
      await freshIdentity(request.auth);
      await Promise.all([authorizeOperation('duplicateQuiz', request), authorize(request.auth, ['quiz.media.upload'], sourceScope)]);
      const pin = await materialize(asset, destinationFor(asset.assetId));
      await freshIdentity(request.auth);
      const concurrentCopy = await runAccessTransaction(db, async transaction => {
        const existing = await existingCopy(transaction);
        if (existing) return existing;
        const stored = await readAttempt(transaction);
        await authorize(request.auth, ['quiz.media.upload'], sourceScope, transaction);
        assertQuizCopyDriveAuthority(prepared.driveConnection);
        if (!stored || stored.mediaFingerprint !== prepared.mediaFingerprint
          || !sameQuizCopyConnection(stored.driveConnection, prepared.driveConnection)) {
          throw new QuizEditorError('aborted', 'Source media changed during quiz duplication.');
        }
        transaction.update(attempt, { [`pins.${asset.assetId}`]: pin });
        return undefined;
      });
      if (concurrentCopy) return concurrentCopy;
      pins.set(asset.assetId, pin);
    }

    await freshIdentity(request.auth);
    return await runAccessTransaction(db, async transaction => {
      const existing = await existingCopy(transaction);
      if (existing) return existing;
      const stored = await readAttempt(transaction);
      await authorize(request.auth, ['quiz.media.upload'], sourceScope, transaction);
      const current = await readQuizCopyContent(transaction, input.quizId, input.expectedRevision, target.id, actor.uid);
      assertQuizCopyDriveAuthority(current.driveConnection);
      if (!stored || stored.mediaFingerprint !== prepared.mediaFingerprint || current.mediaFingerprint !== prepared.mediaFingerprint
        || !sameQuizCopyConnection(stored.driveConnection, prepared.driveConnection)
        || !sameQuizCopyConnection(current.driveConnection, prepared.driveConnection)
        || current.assets.some(({ assetId }) => {
          const pin = pins.get(assetId), saved = stored.pins[assetId];
          return !pin || !saved || pin.generation !== saved.generation || pin.sha256 !== saved.sha256;
        })) {
        throw new QuizEditorError('aborted', 'Source media changed during quiz duplication.');
      }
      const result = writeQuizCopy(transaction, target, current, pins, input.title, identity.fingerprint, actor.uid);
      transaction.set(attempt, { fingerprint: identity.fingerprint, mediaFingerprint: current.mediaFingerprint, completedAt: Timestamp.now() });
      return result;
    });
  } catch (error) {
    return mapError(error);
  }
});
export const duplicateQuiz = createDuplicateQuizCallable();

export const updateQuizMetadata = securedOnCall('updateQuizMetadata', callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const revision = expectedRevision(request.data);
    if (!isObject(request.data)) throw new HttpsError('invalid-argument', 'Request data is required.');
    const metadata = validateQuizMetadata(request.data.quiz);
    return await runAccessTransaction(db, async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      if (metadata.status !== undefined && state.quiz.status === 'archived') throw new QuizEditorError('failed-precondition', 'Archivovaný kvíz nelze změnou stavu obnovit.');
      if (metadata.defaultAppearance) {
        protectPrivateMedia(state.slides, [metadata.defaultAppearance]);
        if (!currentMembership().permissions.includes('quiz.media.attach') && metadata.defaultAppearance.backgroundImage !== (state.quiz.defaultAppearance as { backgroundImage?: string } | undefined)?.backgroundImage) throw new HttpsError('permission-denied', 'Změna pozadí vyžaduje připojování médií.');
        await assertQuizAssets(transaction, db, quizId, [metadata.defaultAppearance]);
      }
      const designs = [metadata.defaultDesign, metadata.resultTemplates?.interim?.design, metadata.resultTemplates?.final?.design, ...(metadata.printTemplate?.logoImage === undefined ? [] : [{ logoImage: metadata.printTemplate.logoImage }])].filter(value => value !== undefined);
      protectPrivateMedia(state.slides, designs.map(design => ({ design })));
      if (!currentMembership().permissions.includes('quiz.media.attach')) {
        if (metadata.printTemplate !== undefined && (metadata.printTemplate.logoImage ?? '') !== ((state.quiz.printTemplate as { logoImage?: unknown } | undefined)?.logoImage ?? '')) throw new HttpsError('permission-denied', 'Změna loga vyžaduje připojování médií.');
        const previous = [state.quiz.defaultDesign, (state.quiz.resultTemplates as { interim?: { design?: unknown } } | undefined)?.interim?.design, (state.quiz.resultTemplates as { final?: { design?: unknown } } | undefined)?.final?.design];
        const next = [metadata.defaultDesign, metadata.resultTemplates?.interim?.design, metadata.resultTemplates?.final?.design];
        next.forEach((design, index) => {
          if (index === 0 ? metadata.defaultDesign === undefined : metadata.resultTemplates === undefined) return;
          for (const field of ['backgroundImage', 'logoImage'] as const) if ((design?.[field] ?? '') !== ((previous[index] as Record<string, unknown> | undefined)?.[field] ?? '')) throw new HttpsError('permission-denied', 'Změna obrázku vyžaduje připojování médií.');
        });
      }
      await assertQuizAssets(transaction, db, quizId, designs.map(design => ({ design })));
      transaction.update(state.quizRef, {
        ...metadata,
        ...(metadata.printTemplate === undefined ? {} : { printTemplate: mergeStoredPrintTemplate(state.quiz.printTemplate, metadata.printTemplate) }),
        ...(metadata.defaultDesign === undefined ? {} : { defaultDesign: mergeStoredDesign(state.quiz.defaultDesign, metadata.defaultDesign) }),
        ...(metadata.resultTemplates === undefined ? {} : { resultTemplates: mergeStoredResultTemplates(state.quiz.resultTemplates, metadata.resultTemplates) }),
        revision: state.revision + 1,
        updatedAt: Timestamp.now(),
        updatedBy: actor.uid,
      });
      return publicResponse(state, state.slides);
    });
  } catch (error) {
    return mapError(error);
  }
});

export const updateQuizSlide = securedOnCall('updateQuizSlide', callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const slideId = requiredId(request.data, 'slideId');
    const revision = expectedRevision(request.data);
    const input = requestedSlide(request.data);
    return await runAccessTransaction(db, async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      await assertQuizAssets(transaction, db, quizId, [input as unknown as Record<string, unknown>]);
      protectPrivateMedia(state.slides, [input as unknown as Record<string, unknown>]);
      const current = state.slides.find((slide) => slide.id === slideId);
      if (current === undefined) throw new QuizEditorError('not-found', 'Quiz slide was not found.');
      const protectedInput = protectSlideFields(current.data, input);
      const currentKind = storedKind(current);
      if (isAutomaticScreen(current) && currentKind !== input.kind) throw new QuizEditorError('invalid-argument', 'Automatic slides must keep their type.');
      const currentIsRound = isRoundKind(currentKind);
      if (currentIsRound !== isRoundKind(input.kind)) {
        throw new QuizEditorError('invalid-argument', 'Round headers cannot be converted to another slide type.');
      }
      if (input.kind !== 'legacy' && (currentKind === 'thank-you') !== (input.kind === 'thank-you')) {
        throw new QuizEditorError('invalid-argument', 'A thank-you slide cannot be converted to or from another slide type.');
      }
      const updated = orderedWithPositions(state.slides.map((slide) => {
        if (slide.id !== slideId) return slide;
        const data = preserveHiddenFields(slide.data, applyKnownSlideUpdate(slide.data, protectedInput));
        if (slideRoundId(slide) !== undefined && (isStoredRoundHeader(slide) || storedKind(slide) === 'recap') && data.title !== slide.data.title) {
          const name = storedRoundName(state.slides.filter(member => slideRoundId(member) === slideRoundId(slide)));
          if (name !== undefined) {
            data.roundTitle = name;
            data.customRoundHeading = data.title !== name;
          }
        }
        if (slideRoundId(slide) === undefined && data.isQuestion === true) {
          data.roundId = state.quizRef.collection('rounds').doc().id;
        }
        return { id: slide.id, data };
      }));
      if (current.data.isQuestion === true && !updated.find((slide) => slide.id === slideId)?.data.isQuestion) {
        if (!currentMembership().permissions.includes('quiz.delete')) throw new HttpsError('permission-denied', 'Odstranění otázky vyžaduje právo mazat.');
        deleteOldDerivedQuestion(transaction, state, current);
      }
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: slideId };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const repairQuizPreflightIssue = securedOnCall('repairQuizPreflightIssue', callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const slideId = requiredId(request.data, 'slideId');
    const revision = expectedRevision(request.data);
    const repair = requestedPreflightRepair(request.data);
    return await runAccessTransaction(db, async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const current = state.slides.find((slide) => slide.id === slideId);
      if (current === undefined) throw new QuizEditorError('not-found', 'Quiz slide was not found.');
      const applied = applyPreflightRepair(current, repair);
      transaction.set(state.quizRef.collection('slides').doc(slideId), applied.slide.data);
      const roundId = slideRoundId(current);
      if (applied.kind === 'choice-answer' && roundId !== undefined && applied.privateCorrectAnswer !== undefined) {
        transaction.set(
          state.quizRef.collection('rounds').doc(roundId).collection('questions').doc(slideId),
          { correctAnswer: applied.privateCorrectAnswer },
          { merge: true },
        );
      }
      transaction.update(state.quizRef, {
        revision: state.revision + 1,
        updatedAt: Timestamp.now(),
        updatedBy: actor.uid,
      });
      return { ...publicResponse(state, state.slides, slideId) };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const createQuizSlide = securedOnCall('createQuizSlide', callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const revision = expectedRevision(request.data);
    const position = requestedPosition(request.data);
    const input = requestedSlide(request.data);
    if (!isObject(request.data)) throw new HttpsError('invalid-argument', 'Request data is required.');
    const globalSection = request.data.scope === 'quiz';
    const firstRound = request.data.scope === 'first-round';
    const thankYou = input.kind === 'thank-you';
    if ((request.data.scope !== undefined && !globalSection && !firstRound) || (thankYou && !globalSection)
      || (globalSection && !['intro', 'agenda', 'rules', 'thank-you', 'end', 'title', 'info'].includes(input.kind))) {
      throw new HttpsError('invalid-argument', 'Invalid quiz-level section.');
    }
    const existingRoundId = request.data.roundId === undefined ? undefined : requiredId(request.data, 'roundId');
    const roundContent = isQuestionKind(input.kind) || input.kind === 'recap';
    if (existingRoundId !== undefined && (globalSection || !(isRoundKind(input.kind) || roundContent))) throw new HttpsError('invalid-argument', 'Existing round target requires a question, recap or round introduction.');
    if (firstRound && (!roundContent || existingRoundId !== undefined)) throw new HttpsError('invalid-argument', 'The first round needs a question or recap.');
    const quizRef = db.collection('quizzes').doc(quizId);
    const slideRef = quizRef.collection('slides').doc();
    return await runAccessTransaction(db, async (transaction) => {
      protectSlideFields(undefined, input);
      const state = await loadQuizState(transaction, quizId, revision);
      protectPrivateMedia(state.slides, [input as unknown as Record<string, unknown>]);
      await assertQuizAssets(transaction, db, quizId, [input as unknown as Record<string, unknown>]);
      if (state.slides.length >= maximumSlideCount || position > state.slides.length + 1) {
        throw new QuizEditorError('invalid-argument', 'Slide position is outside the quiz range.');
      }
      if (thankYou && state.slides.some(slide => storedKind(slide) === 'thank-you')) {
        throw new QuizEditorError('failed-precondition', 'The quiz already has a thank-you slide.');
      }
      if (firstRound && state.slides.some(slide => slideRoundId(slide) !== undefined)) {
        throw new QuizEditorError('failed-precondition', 'The quiz already has a round.');
      }
      const before = state.slides[position - 2];
      const inheritedRoundId = globalSection || before === undefined ? undefined : slideRoundId(before);
      if (existingRoundId !== undefined && isRoundKind(input.kind)) validateExistingRoundHeaderTarget(state.slides, existingRoundId, position);
      if (existingRoundId !== undefined && roundContent) {
        const next = state.slides[position - 1];
        const gapRound = questionRoundAtGap(state.slides.map(slideRoundId), position - 1, next?.data.isQuestion === true || next?.data.kind === 'recap');
        if (existingRoundId !== gapRound) {
          const members = state.slides.filter(slide => slideRoundId(slide) === existingRoundId);
          const recap = members.find(slide => storedKind(slide) === 'recap');
          const appendPosition = recap?.data.position ?? (Number(members.at(-1)?.data.position) + 1);
          if (position !== appendPosition) throw new QuizEditorError('failed-precondition', 'Question target does not match the insertion position.');
        }
      }
      const roundId = existingRoundId ?? (isRoundKind(input.kind) || (inheritedRoundId === undefined && roundContent)
        ? quizRef.collection('rounds').doc().id
        : inheritedRoundId);
      const created: StoredEditorSlide = {
        id: slideRef.id,
        data: createSlideData(input, position, roundId),
      };
      const updated = firstRound && roundId !== undefined
        ? insertNativeRound(state, position - 1, roundId, '1. kolo', created).slides
        : orderedWithPositions([...state.slides.slice(0, position - 1), created, ...state.slides.slice(position - 1)]);
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: slideRef.id };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const duplicateQuizSlide = securedOnCall('duplicateQuizSlide', callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const slideId = requiredId(request.data, 'slideId');
    const revision = expectedRevision(request.data);
    const quizRef = db.collection('quizzes').doc(quizId);
    const duplicateRef = quizRef.collection('slides').doc();
    return await runAccessTransaction(db, async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      if (state.slides.length >= maximumSlideCount) {
        throw new QuizEditorError('failed-precondition', 'Quiz reached the safe slide limit.');
      }
      const index = state.slides.findIndex((slide) => slide.id === slideId);
      const source = state.slides[index];
      if (source === undefined) throw new QuizEditorError('not-found', 'Quiz slide was not found.');
      if (storedKind(source) === 'thank-you') throw new QuizEditorError('failed-precondition', 'The quiz already has a thank-you slide.');
      const data = duplicateSlideData(source.data, index + 2);
      if (isRoundKind(storedKind(source))) data.roundId = quizRef.collection('rounds').doc().id;
      const duplicate: StoredEditorSlide = { id: duplicateRef.id, data };
      const updated = orderedWithPositions([
        ...state.slides.slice(0, index + 1), duplicate, ...state.slides.slice(index + 1),
      ]);
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: duplicateRef.id };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const deleteQuizSlide = securedOnCall('deleteQuizSlide', callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const slideId = requiredId(request.data, 'slideId');
    const revision = expectedRevision(request.data);
    return await runAccessTransaction(db, async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const current = state.slides.find((slide) => slide.id === slideId);
      if (current === undefined) throw new QuizEditorError('not-found', 'Quiz slide was not found.');
      if (state.slides.length === 1 && storedKind(current) !== 'thank-you') {
        throw new QuizEditorError('failed-precondition', 'A quiz must keep at least one slide.');
      }
      const roundId = slideRoundId(current);
      if (isAutomaticScreen(current)) throw new QuizEditorError('failed-precondition', 'Automatic slides cannot be deleted individually.');
      deleteOldDerivedQuestion(transaction, state, current);
      transaction.delete(state.quizRef.collection('slides').doc(slideId));
      const updated = orderedWithPositions(state.slides.filter((slide) => slide.id !== slideId));
      if (roundId !== undefined && !updated.some((slide) => slideRoundId(slide) === roundId)) {
        transaction.delete(state.quizRef.collection('rounds').doc(roundId));
      }
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: updated[Math.min((current.data.position as number) - 1, updated.length - 1)]?.id };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const moveQuizSlide = securedOnCall('moveQuizSlide', callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const slideId = requiredId(request.data, 'slideId');
    const revision = expectedRevision(request.data);
    const move = requestedSlideMove(request.data);
    return await runAccessTransaction(db, async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      if ('beforeSlideId' in move) {
        const updated = orderedWithPositions(moveSlidesBefore(state.slides, slideId, move.beforeSlideId, move.moveRound));
        const result = writeQuizState(transaction, state, updated, actor);
        return { ...result, selectedSlideId: slideId };
      }
      const { direction } = move;
      const index = state.slides.findIndex((slide) => slide.id === slideId);
      if (index < 0) throw new QuizEditorError('not-found', 'Quiz slide was not found.');
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= state.slides.length) {
        throw new QuizEditorError('invalid-argument', 'Slide cannot move outside the quiz.');
      }
      const reordered = [...state.slides];
      const target = reordered[targetIndex];
      const current = reordered[index];
      if (target === undefined || current === undefined) throw new QuizEditorError('failed-precondition', 'Slide order is malformed.');
      reordered[index] = target;
      reordered[targetIndex] = current;
      const updated = orderedWithPositions(reordered);
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: slideId };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const updateQuizRound = securedOnCall('updateQuizRound', callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const roundId = requiredId(request.data, 'roundId');
    const title = requestedRoundTitle(request.data);
    const revision = expectedRevision(request.data);
    return await runAccessTransaction(db, async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const members = state.slides.filter((slide) => slideRoundId(slide) === roundId);
      if (members.length === 0) throw new QuizEditorError('not-found', 'Quiz round was not found.');
      const previous = storedRoundName(members);
      const updated = orderedWithPositions(state.slides.map((slide) => {
        if (slideRoundId(slide) !== roundId) return slide;
        const data: Record<string, unknown> = { ...slide.data, roundTitle: title };
        if (isStoredRoundHeader(slide) || storedKind(slide) === 'recap') {
          if (slide.data.customRoundHeading === true || (slide.data.title && slide.data.title !== previous)) data.customRoundHeading = true;
          else data.title = title;
        }
        return { ...slide, data };
      }));
      const result = writeQuizState(transaction, state, updated, actor);
      transaction.set(state.quizRef.collection('rounds').doc(roundId), { title }, { merge: true });
      return { ...result, selectedSlideId: members[0]?.id };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const reorderQuizQuestion = securedOnCall('reorderQuizQuestion', callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const slideId = requiredId(request.data, 'slideId');
    const direction = requestedDirection(request.data);
    const revision = expectedRevision(request.data);
    return await runAccessTransaction(db, async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const current = state.slides.find((slide) => slide.id === slideId);
      const roundId = current === undefined ? undefined : slideRoundId(current);
      if (current === undefined || current.data.isQuestion !== true) {
        throw new QuizEditorError('not-found', 'Quiz question was not found.');
      }
      const questions = state.slides.filter((slide) => slideRoundId(slide) === roundId && slide.data.isQuestion === true);
      const questionIndex = questions.findIndex((slide) => slide.id === slideId);
      const target = questions[questionIndex + direction];
      if (target === undefined) throw new QuizEditorError('invalid-argument', 'Question cannot move outside its round.');
      const currentIndex = state.slides.findIndex((slide) => slide.id === current.id);
      const targetIndex = state.slides.findIndex((slide) => slide.id === target.id);
      const reordered = [...state.slides];
      reordered[currentIndex] = target;
      reordered[targetIndex] = current;
      const updated = orderedWithPositions(reordered);
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: slideId };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const moveQuizQuestionToRound = securedOnCall('moveQuizQuestionToRound', callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const slideId = requiredId(request.data, 'slideId');
    const targetRoundId = requiredId(request.data, 'targetRoundId');
    const revision = expectedRevision(request.data);
    return await runAccessTransaction(db, async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const current = state.slides.find((slide) => slide.id === slideId);
      const sourceRoundId = current === undefined ? undefined : slideRoundId(current);
      if (current === undefined || current.data.isQuestion !== true) {
        throw new QuizEditorError('not-found', 'Quiz question was not found.');
      }
      if (sourceRoundId !== undefined && sourceRoundId === targetRoundId) throw new QuizEditorError('invalid-argument', 'Question is already in this round.');
      const targetMembers = state.slides.filter((slide) => slideRoundId(slide) === targetRoundId);
      if (targetMembers.length === 0) throw new QuizEditorError('not-found', 'Target quiz round was not found.');
      const targetTitle = targetMembers.find((slide) => typeof slide.data.roundTitle === 'string')?.data.roundTitle;
      const moved: StoredEditorSlide = {
        ...current,
        data: {
          ...current.data,
          roundId: targetRoundId,
          ...(typeof targetTitle === 'string' ? { roundTitle: targetTitle } : {}),
        },
      };
      const without = state.slides.filter((slide) => slide.id !== slideId);
      const recapIndex = without.findIndex((slide) => slideRoundId(slide) === targetRoundId && storedKind(slide) === 'recap');
      const lastTargetIndex = without.reduce((found, slide, index) => slideRoundId(slide) === targetRoundId ? index : found, -1);
      const insertIndex = recapIndex >= 0 ? recapIndex : lastTargetIndex + 1;
      without.splice(insertIndex, 0, moved);
      deleteOldDerivedQuestion(transaction, state, current);
      const updated = orderedWithPositions(without);
      if (sourceRoundId !== undefined && !updated.some((slide) => slideRoundId(slide) === sourceRoundId)) {
        transaction.delete(state.quizRef.collection('rounds').doc(sourceRoundId));
      }
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: slideId };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const duplicateQuizRound = securedOnCall('duplicateQuizRound', callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const roundId = requiredId(request.data, 'roundId');
    const revision = expectedRevision(request.data);
    return await runAccessTransaction(db, async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const source = state.slides.filter((slide) => slideRoundId(slide) === roundId);
      if (source.length === 0) throw new QuizEditorError('not-found', 'Quiz round was not found.');
      if (state.slides.length + source.length > maximumSlideCount) {
        throw new QuizEditorError('failed-precondition', 'Duplicated round would make the quiz too large.');
      }
      const newRoundId = state.quizRef.collection('rounds').doc().id;
      const currentTitle = storedRoundName(source);
      const copiedTitle = typeof currentTitle === 'string' && currentTitle.trim() !== '' ? `${currentTitle} – kopie` : 'Kopie kola';
      const copies = source.map((slide) => ({
        id: state.quizRef.collection('slides').doc().id,
        data: {
          ...slide.data,
          roundId: newRoundId,
          roundTitle: copiedTitle,
          ...((isStoredRoundHeader(slide) || storedKind(slide) === 'recap') && !slide.data.customRoundHeading && (!slide.data.title || slide.data.title === currentTitle) ? { title: copiedTitle } : {}),
        },
      }));
      const sourceLastIndex = state.slides.reduce((found, slide, index) => slideRoundId(slide) === roundId ? index : found, -1);
      const combined = [...state.slides];
      combined.splice(sourceLastIndex + 1, 0, ...copies);
      const updated = orderedWithPositions(combined);
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: copies[0]?.id };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const moveQuizRound = securedOnCall('moveQuizRound', callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const roundId = requiredId(request.data, 'roundId');
    const direction = requestedDirection(request.data);
    const revision = expectedRevision(request.data);
    return await runAccessTransaction(db, async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const roundIds = [...new Set(state.slides.map(slideRoundId).filter((value): value is string => value !== undefined))];
      const roundIndex = roundIds.indexOf(roundId);
      const targetRoundId = roundIds[roundIndex + direction];
      if (roundIndex < 0 || targetRoundId === undefined) throw new QuizEditorError('invalid-argument', 'Round cannot move further.');
      const selected = state.slides.filter((slide) => slideRoundId(slide) === roundId);
      const target = state.slides.filter((slide) => slideRoundId(slide) === targetRoundId);
      const replacement = direction === -1 ? [...selected, ...target] : [...target, ...selected];
      const involvedIds = new Set(replacement.map((slide) => slide.id));
      let replacementIndex = 0;
      const reordered = state.slides.map((slide) => involvedIds.has(slide.id) ? replacement[replacementIndex++]! : slide);
      const updated = orderedWithPositions(reordered);
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: selected[0]?.id };
    });
  } catch (error) {
    return mapError(error);
  }
});

export const removeQuizRound = securedOnCall('removeQuizRound', callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth);
    const quizId = requiredId(request.data, 'quizId');
    const roundId = requiredId(request.data, 'roundId');
    const revision = expectedRevision(request.data);
    const mode = requestedRoundRemovalMode(request.data);
    const targetRoundId = mode === 'move' ? requiredId(request.data, 'targetRoundId') : undefined;
    return await runAccessTransaction(db, async (transaction) => {
      const state = await loadQuizState(transaction, quizId, revision);
      const source = state.slides.filter((slide) => slideRoundId(slide) === roundId);
      if (source.length === 0) throw new QuizEditorError('not-found', 'Quiz round was not found.');
      const questions = source.filter((slide) => slide.data.isQuestion === true);
      if (targetRoundId === roundId) throw new QuizEditorError('invalid-argument', 'Target round must be different.');
      const target = targetRoundId === undefined ? [] : state.slides.filter((slide) => slideRoundId(slide) === targetRoundId);
      if (mode === 'move' && target.length === 0) throw new QuizEditorError('not-found', 'Target quiz round was not found.');
      const movedTitle = target.find((slide) => typeof slide.data.roundTitle === 'string')?.data.roundTitle;
      const sourceIds = new Set(source.map((slide) => slide.id));
      const kept = state.slides.filter((slide) => !sourceIds.has(slide.id));
      let movedQuestions: StoredEditorSlide[] = [];
      if (mode === 'move' && targetRoundId !== undefined) {
        movedQuestions = questions.map((slide) => ({
          ...slide,
          data: {
            ...slide.data,
            roundId: targetRoundId,
            ...(typeof movedTitle === 'string' ? { roundTitle: movedTitle } : {}),
          },
        }));
        const recapIndex = kept.findIndex((slide) => slideRoundId(slide) === targetRoundId && storedKind(slide) === 'recap');
        const lastTargetIndex = kept.reduce((found, slide, index) => slideRoundId(slide) === targetRoundId ? index : found, -1);
        kept.splice(recapIndex >= 0 ? recapIndex : lastTargetIndex + 1, 0, ...movedQuestions);
      }
      if (kept.length === 0) throw new QuizEditorError('failed-precondition', 'A quiz must keep at least one slide.');
      for (const slide of source) {
        deleteOldDerivedQuestion(transaction, state, slide);
        if (!movedQuestions.some((moved) => moved.id === slide.id)) {
          transaction.delete(state.quizRef.collection('slides').doc(slide.id));
        }
      }
      transaction.delete(state.quizRef.collection('rounds').doc(roundId));
      const updated = orderedWithPositions(kept);
      const result = writeQuizState(transaction, state, updated, actor);
      return { ...result, selectedSlideId: movedQuestions[0]?.id ?? updated[0]?.id };
    });
  } catch (error) {
    return mapError(error);
  }
});

/** Native round creation keeps its header and recap in the same bounded transaction. */
export const createQuizRound = securedOnCall('createQuizRound', callableOptions, async (request): Promise<EditorQuizMutationResponse> => {
  try {
    const actor = authorizeEditorAdmin(request.auth), quizId = requiredId(request.data, 'quizId');
    const revision = expectedRevision(request.data), title = requestedRoundTitle(request.data);
    return await runAccessTransaction(db, async transaction => {
      const state = await loadQuizState(transaction, quizId, revision);
      const roundId = state.quizRef.collection('rounds').doc().id;
      const closing = state.slides.findIndex(slide => slide.data.kind === 'thank-you' || slide.data.kind === 'end');
      const at = isObject(request.data) && request.data.position !== undefined ? requestedPosition(request.data) - 1
        : closing < 0 ? state.slides.length : closing;
      if (at > state.slides.length) throw new QuizEditorError('invalid-argument', 'Round position is outside the quiz range.');
      const { slides, headerId } = insertNativeRound(state, at, roundId, title);
      const result = writeQuizState(transaction, state, slides, actor);
      return { ...result, selectedSlideId: headerId };
    });
  } catch (error) { return mapError(error); }
});
