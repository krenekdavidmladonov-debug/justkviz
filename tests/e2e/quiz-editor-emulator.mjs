import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getFirestore: getAdminFirestore } = require('firebase-admin/firestore');

import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

const { projectId, authEndpoint, firestoreEndpoint, functionsEndpoint } = requireFullEmulatorEnvironment(
  globalThis.process.env,
  'Editor E2E',
);

// Only the validated local emulator fixture inspector may fingerprint an unbound legacy snapshot.
const adminApp = initializeAdminApp({ projectId }, 'editor-sentinel-e2e');
const adminDb = getAdminFirestore(adminApp);
const app = initializeApp({
  apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId,
  appId: '1:123:web:quiz-editor-e2e',
}, 'quiz-editor-e2e');
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, 'europe-west1');
connectAuthEmulator(auth, `http://${authEndpoint.host}:${authEndpoint.port}`, { disableWarnings: true });
connectFirestoreEmulator(db, firestoreEndpoint.host, firestoreEndpoint.port);
connectFunctionsEmulator(functions, functionsEndpoint.host, functionsEndpoint.port);

const quizId = 'quiz-editor-e2e';
const quizRef = doc(db, 'quizzes', quizId);
const slideRef = (id) => doc(db, 'quizzes', quizId, 'slides', id);
const importedQuizId = 'editor-core-imported-e2e';
const importedQuizRef = doc(db, 'quizzes', importedQuizId);
const importedSlideRef = doc(db, 'quizzes', importedQuizId, 'slides', 'slide-002');
const snapshotRef = doc(db, 'quizSnapshots', 'editor-core-snapshot-sentinel');
const snapshotSlideRef = doc(db, 'quizSnapshots', 'editor-core-snapshot-sentinel', 'slides', 'slide-002');
const invoke = async (name, data) => (await httpsCallable(functions, name)(data)).data;

async function expectFunctionError(action, code) {
  try {
    await action();
    assert.fail(`Expected ${code}.`);
  } catch (error) {
    assert.equal(error.code, code);
  }
}

function editorSlide(overrides = {}) {
  return {
    kind: 'question', title: 'Syntetický slide', text: 'Syntetické zadání',
    moderatorNote: 'Soukromá syntetická poznámka',
    options: ['A', 'B', 'C', 'D'], correctAnswer: 'Syntetická správná odpověď',
    media: [],
    presentation: {
      videoStart: null, videoEnd: null, audioTrigger: null,
      backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null,
    },
    ...overrides,
  };
}

function importedEditorSlide(text) {
  return editorSlide({
    kind: 'video',
    title: 'Importovaná video otázka',
    text,
    moderatorNote: 'Soukromá importovaná poznámka',
    options: [],
    correctAnswer: 'Syntetická správná odpověď',
    media: [{
      sourceIndex: 0, role: 'prompt', kind: 'video', source: 'test__local',
    }],
    mediaSource: 'test__local',
    presentation: {
      videoStart: 0, videoEnd: 0, audioTrigger: null,
      backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: '1/1',
    },
    clipStartSeconds: null,
    clipEndSeconds: null,
  });
}

async function orderedSlides() {
  return (await getDocs(query(collection(quizRef, 'slides'), orderBy('position')))).docs;
}

async function assertRoundTitleConsistency(roundId, title) {
  const slides = (await orderedSlides()).map(item => item.data());
  const members = slides.filter(item => item.roundId === roundId);
  const header = members.find(item => item.kind === 'round')
    ?? members.find(item => item.kind === 'intro' && item.isQuestion !== true);
  assert.equal(header.title, title);
  assert.equal(members.every(item => item.roundTitle === title), true);
  const round = (await getDoc(doc(db, 'quizzes', quizId, 'rounds', roundId))).data();
  assert.equal(round.title, title);
  assert.equal(round.slideCount, members.length);
  assert.equal(round.questionCount, members.filter(item => item.isQuestion === true).length);
  const quiz = (await getDoc(quizRef)).data();
  assert.equal(quiz.slideCount, slides.length);
  assert.equal(quiz.questionCount, slides.filter(item => item.isQuestion === true).length);
  assert.equal(quiz.roundCount, new Set(slides.map(item => item.roundId).filter(Boolean)).size);
}

async function run() {
  await expectFunctionError(
    () => invoke('createQuiz', { title: 'Denied', requestId: 'anonymous-create' }),
    'functions/unauthenticated',
  );
  await expectFunctionError(
    () => invoke('updateQuizMetadata', { quizId, expectedRevision: 0, quiz: { title: 'Denied', description: '' } }),
    'functions/unauthenticated',
  );
  await expectFunctionError(
    () => invoke('repairQuizPreflightIssue', {
      quizId, slideId: 'slide-002', expectedRevision: 0, kind: 'choice-answer', optionIndex: 0,
    }),
    'functions/unauthenticated',
  );

  await signInWithEmailAndPassword(auth, 'user@example.test', 'LocalQuiz123!');
  await expectFunctionError(
    () => invoke('createQuiz', { title: 'Denied', requestId: 'normal-user-create' }),
    'functions/permission-denied',
  );
  await expectFunctionError(
    () => invoke('updateQuizMetadata', { quizId, expectedRevision: 0, quiz: { title: 'Denied', description: '' } }),
    'functions/permission-denied',
  );
  await signOut(auth);

  await signInWithEmailAndPassword(auth, 'moderator@example.test', 'LocalQuiz123!');
  assert.equal((await getDoc(quizRef)).exists(), true);
  assert.equal((await getDoc(slideRef('slide-002'))).exists(), true);
  await expectFunctionError(
    () => invoke('createQuiz', { title: 'Denied', requestId: 'moderator-create' }),
    'functions/permission-denied',
  );
  await expectFunctionError(
    () => invoke('updateQuizSlide', { quizId, slideId: 'slide-002', expectedRevision: 0, slide: editorSlide() }),
    'functions/permission-denied',
  );
  await expectFunctionError(
    () => invoke('repairQuizPreflightIssue', {
      quizId, slideId: 'slide-002', expectedRevision: 0, kind: 'choice-answer', optionIndex: 0,
    }),
    'functions/permission-denied',
  );
  await signOut(auth);

  await signInWithEmailAndPassword(auth, 'admin@example.test', 'LocalQuiz123!');
  await assert.rejects(updateDoc(quizRef, { title: 'Direct write must fail' }), /permission-denied/u);
  const publicBefore = await getDoc(doc(db, 'publicSessions', 'quiz-editor-e2e'));
  assert.equal(publicBefore.exists(), false);
  await assert.rejects(getDoc(snapshotRef), /permission-denied/u);
  await assert.rejects(getDoc(snapshotSlideRef), /permission-denied/u);
  const snapshotBefore = JSON.stringify({
    root: (await adminDb.doc(snapshotRef.path).get()).data(),
    slide: (await adminDb.doc(snapshotSlideRef.path).get()).data(),
  });

  const importedBefore = (await getDoc(importedSlideRef)).data();
  const importedAnswerBefore = importedBefore.correctAnswer;
  const importedMediaBefore = JSON.parse(JSON.stringify(importedBefore.media));
  const importedLegacyBefore = JSON.parse(JSON.stringify(importedBefore.legacy));
  const importedPresentationBefore = JSON.parse(JSON.stringify(importedBefore.presentation));
  const importedFirstSave = await invoke('updateQuizSlide', {
    quizId: importedQuizId,
    slideId: 'slide-002',
    expectedRevision: 0,
    slide: importedEditorSlide('První bezpečně uložené syntetické zadání'),
  });
  assert.equal(importedFirstSave.revision, 1);
  const importedAfterFirstReload = (await getDoc(importedSlideRef)).data();
  assert.equal(importedAfterFirstReload.text, 'První bezpečně uložené syntetické zadání');
  assert.equal(importedAfterFirstReload.correctAnswer, importedAnswerBefore);
  assert.deepEqual(importedAfterFirstReload.media, importedMediaBefore);
  assert.deepEqual(importedAfterFirstReload.legacy, importedLegacyBefore);
  assert.deepEqual(importedAfterFirstReload.presentation, importedPresentationBefore);
  assert.equal(importedAfterFirstReload.clipStartSeconds, 0);
  assert.equal(Object.hasOwn(importedAfterFirstReload, 'clipEndSeconds'), false);
  const importedSecondSave = await invoke('updateQuizSlide', {
    quizId: importedQuizId,
    slideId: 'slide-002',
    expectedRevision: 1,
    slide: importedEditorSlide('Druhé bezpečně uložené syntetické zadání'),
  });
  assert.equal(importedSecondSave.revision, 2);
  assert.equal((await getDoc(importedSlideRef)).data().text, 'Druhé bezpečně uložené syntetické zadání');
  assert.equal(
    (await getDoc(doc(db, 'quizzes', importedQuizId, 'rounds', 'imported-round', 'questions', 'slide-002'))).data().prompt,
    'Druhé bezpečně uložené syntetické zadání',
  );
  await expectFunctionError(
    () => invoke('updateQuizSlide', {
      quizId: importedQuizId,
      slideId: 'slide-002',
      expectedRevision: 1,
      slide: importedEditorSlide('Konfliktní syntetické zadání'),
    }),
    'functions/aborted',
  );

  const createRequestId = `editor-core-create-${Date.now().toString(36)}`;
  const [createdQuiz, concurrentCreateRetry] = await Promise.all([
    invoke('createQuiz', {
      title: '  Nový syntetický kvíz  ',
      requestId: createRequestId,
    }),
    invoke('createQuiz', {
      title: 'Nový syntetický kvíz',
      requestId: createRequestId,
    }),
  ]);
  assert.deepEqual(concurrentCreateRetry, createdQuiz);
  const createdQuizId = createdQuiz.quizId;
  const createdQuizRef = doc(db, 'quizzes', createdQuizId);
  assert.deepEqual(createdQuiz, {
    quizId: createdQuizId, revision: 0, slideCount: 0, questionCount: 0, roundCount: 0,
  });
  const createdRoot = (await getDoc(createdQuizRef)).data();
  assert.equal(createdRoot.title, 'Nový syntetický kvíz');
  assert.equal(createdRoot.description, '');
  assert.equal(createdRoot.status, 'draft');
  assert.equal(createdRoot.schemaVersion, 1);
  assert.equal(createdRoot.createdBy, auth.currentUser.uid);
  assert.equal(createdRoot.updatedBy, auth.currentUser.uid);
  assert.equal(typeof createdRoot.creationFingerprint, 'string');
  assert.equal((await getDocs(collection(createdQuizRef, 'slides'))).empty, true);
  assert.equal((await getDocs(collection(createdQuizRef, 'rounds'))).empty, true);

  const createdQuizRetry = await invoke('createQuiz', {
    title: 'Nový syntetický kvíz',
    requestId: createRequestId,
  });
  assert.deepEqual(createdQuizRetry, createdQuiz);
  await expectFunctionError(
    () => invoke('createQuiz', { title: 'Jiný syntetický kvíz', requestId: createRequestId }),
    'functions/already-exists',
  );

  const newRound = await invoke('createQuizSlide', {
    quizId: createdQuizId,
    expectedRevision: 0,
    position: 1,
    slide: editorSlide({
      kind: 'round', title: 'První syntetické kolo', text: '',
      moderatorNote: '', options: [], correctAnswer: '',
    }),
  });
  assert.equal(newRound.revision, 1);
  assert.equal(newRound.slideCount, 1);
  assert.equal(newRound.roundCount, 1);
  const newRoundData = (await getDoc(doc(createdQuizRef, 'slides', newRound.selectedSlideId))).data();
  assert.equal(typeof newRoundData.roundId, 'string');

  const newQuestion = await invoke('createQuizSlide', {
    quizId: createdQuizId,
    expectedRevision: 1,
    position: 2,
    slide: editorSlide({
      kind: 'free', title: 'První syntetická otázka', text: 'Rozpracované zadání',
      options: [], correctAnswer: 'Soukromá syntetická odpověď',
    }),
  });
  assert.equal(newQuestion.revision, 2);
  assert.equal(newQuestion.slideCount, 2);
  assert.equal(newQuestion.questionCount, 1);
  const newQuestionRef = doc(createdQuizRef, 'slides', newQuestion.selectedSlideId);
  const derivedNewQuestionRef = doc(
    createdQuizRef, 'rounds', newRoundData.roundId, 'questions', newQuestion.selectedSlideId,
  );
  assert.equal((await getDoc(derivedNewQuestionRef)).exists(), true);

  const newQuestionFirstSave = await invoke('updateQuizSlide', {
    quizId: createdQuizId,
    slideId: newQuestion.selectedSlideId,
    expectedRevision: 2,
    slide: editorSlide({
      kind: 'free', title: 'První syntetická otázka', text: 'První uložené zadání',
      options: [], correctAnswer: 'Soukromá syntetická odpověď',
    }),
  });
  assert.equal(newQuestionFirstSave.revision, 3);
  assert.equal((await getDoc(newQuestionRef)).data().text, 'První uložené zadání');
  const newQuestionSecondSave = await invoke('updateQuizSlide', {
    quizId: createdQuizId,
    slideId: newQuestion.selectedSlideId,
    expectedRevision: 3,
    slide: editorSlide({
      kind: 'free', title: 'První syntetická otázka', text: 'Druhé uložené zadání',
      options: [], correctAnswer: 'Soukromá syntetická odpověď',
    }),
  });
  assert.equal(newQuestionSecondSave.revision, 4);
  assert.equal((await getDoc(newQuestionRef)).data().text, 'Druhé uložené zadání');
  assert.equal((await getDoc(derivedNewQuestionRef)).data().prompt, 'Druhé uložené zadání');
  await expectFunctionError(
    () => invoke('updateQuizSlide', {
      quizId: createdQuizId,
      slideId: newQuestion.selectedSlideId,
      expectedRevision: 3,
      slide: editorSlide({
        kind: 'free', title: 'První syntetická otázka', text: 'Konfliktní zadání',
        options: [], correctAnswer: 'Soukromá syntetická odpověď',
      }),
    }),
    'functions/aborted',
  );
  const createdQuizLateRetry = await invoke('createQuiz', {
    title: 'Nový syntetický kvíz',
    requestId: createRequestId,
  });
  assert.deepEqual(createdQuizLateRetry, {
    quizId: createdQuizId, revision: 4, slideCount: 2, questionCount: 1, roundCount: 1,
  });

  // The original request key must not expose current private counters after the
  // creator's selected quiz grant is removed while global create stays allowed.
  const memberRef = adminDb.doc('memberships/' + auth.currentUser.uid);
  const membershipBeforeReplayTest = (await memberRef.get()).data();
  const createdPrivateRef = adminDb.doc('quizzes/' + createdQuizId);
  const rootBeforeRevokedRetry = (await createdPrivateRef.get()).data();
  const grantCountBefore = (await adminDb.collection('accessAudit').where('resourceId', '==', createdQuizId).get()).size;
  try {
    await memberRef.update({ quizzes: { mode: 'selected', ids: [] }, version: membershipBeforeReplayTest.version + 1 });
    await assert.rejects(getDocFromServer(createdQuizRef), error => error.code === 'permission-denied');
    await expectFunctionError(() => invoke('createQuiz', { title: 'Nový syntetický kvíz', requestId: createRequestId }), 'functions/permission-denied');
    assert.deepEqual((await createdPrivateRef.get()).data(), rootBeforeRevokedRetry);
    assert.deepEqual((await memberRef.get()).data().quizzes, { mode: 'selected', ids: [] });
    assert.equal((await adminDb.collection('accessAudit').where('resourceId', '==', createdQuizId).get()).size, grantCountBefore);
  } finally {
    await memberRef.set({ ...membershipBeforeReplayTest, version: membershipBeforeReplayTest.version + 2 });
  }
  assert.deepEqual(await invoke('createQuiz', { title: 'Nový syntetický kvíz', requestId: createRequestId }), createdQuizLateRetry);

  const originalSlide = (await getDoc(slideRef('slide-002'))).data();
  const originalLegacy = JSON.parse(JSON.stringify(originalSlide.legacy));
  const updated = await invoke('updateQuizSlide', {
    quizId, slideId: 'slide-002', expectedRevision: 0,
    slide: editorSlide({
      title: 'Upravený syntetický slide',
      options: ['A', 'B', 'C', 'D', 'E'],
      media: [
        { sourceIndex: 0, role: 'prompt', kind: 'image', source: 'https://example.test/replaced.jpg' },
        { sourceIndex: 1, role: 'answer', kind: 'image', source: 'https://example.test/answer-replaced.jpg' },
        { role: 'prompt', kind: 'audio', source: 'synthetic-audio-reference' },
      ],
      presentation: {
        videoStart: 2, videoEnd: 8, audioTrigger: 1,
        backgroundOverlay: 55, answerOverlay: 20, sourceQuestionNumber: '2/9',
      },
    }),
  });
  assert.equal(updated.revision, 1);
  const storedUpdated = (await getDoc(slideRef('slide-002'))).data();
  assert.deepEqual(storedUpdated.legacy, originalLegacy);
  assert.equal(storedUpdated.options.length, 5);
  assert.equal(storedUpdated.media.length, 3);

  await expectFunctionError(
    () => invoke('updateQuizSlide', { quizId, slideId: 'slide-002', expectedRevision: 0, slide: editorSlide() }),
    'functions/aborted',
  );

  const duplicateRace = await Promise.allSettled([
    invoke('duplicateQuizSlide', { quizId, slideId: 'slide-002', expectedRevision: 1 }),
    invoke('duplicateQuizSlide', { quizId, slideId: 'slide-002', expectedRevision: 1 }),
  ]);
  assert.equal(duplicateRace.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(duplicateRace.filter((result) => result.status === 'rejected').length, 1);
  const duplicateResult = duplicateRace.find((result) => result.status === 'fulfilled').value;
  const duplicateId = duplicateResult.selectedSlideId;
  assert.equal(duplicateResult.revision, 2);

  const moved = await invoke('moveQuizSlide', {
    quizId, slideId: duplicateId, direction: 1, expectedRevision: 2,
  });
  assert.equal(moved.revision, 3);

  const beforeRoundCount = moved.roundCount;
  const createdRound = await invoke('createQuizSlide', {
    quizId, expectedRevision: 3, position: moved.slideCount + 1,
    slide: editorSlide({ kind: 'round', title: 'Syntetické nové kolo', moderatorNote: '', correctAnswer: '', options: [] }),
  });
  assert.equal(createdRound.roundCount, beforeRoundCount + 1);
  const roundHeader = (await getDoc(slideRef(createdRound.selectedSlideId))).data();
  assert.equal(typeof roundHeader.roundId, 'string');

  const createdQuestion = await invoke('createQuizSlide', {
    quizId, expectedRevision: 4, position: createdRound.slideCount + 1,
    slide: editorSlide({
      kind: 'video', options: ['1', '2', '3', '4', '5', '6'],
      media: [
        { role: 'prompt', kind: 'video', source: 'https://example.test/video' },
        { role: 'background', kind: 'image', source: 'https://example.test/background.jpg' },
      ],
      presentation: { videoStart: 3, videoEnd: 12, audioTrigger: null, backgroundOverlay: 40, answerOverlay: null, sourceQuestionNumber: null },
    }),
  });
  assert.equal(createdQuestion.questionCount, updated.questionCount + 2);
  const derivedQuestion = await getDoc(doc(db, 'quizzes', quizId, 'rounds', roundHeader.roundId, 'questions', createdQuestion.selectedSlideId));
  assert.equal(derivedQuestion.exists(), true);
  assert.equal(derivedQuestion.data().options.length, 6);

  const deleted = await invoke('deleteQuizSlide', {
    quizId, slideId: duplicateId, expectedRevision: 5,
  });
  assert.equal(deleted.revision, 6);
  const finalSlides = await orderedSlides();
  assert.deepEqual(finalSlides.map((slide) => slide.data().position), Array.from({ length: finalSlides.length }, (_, index) => index + 1));
  assert.equal((await getDoc(slideRef(duplicateId))).exists(), false);
  assert.deepEqual((await getDoc(slideRef('slide-002'))).data().legacy, originalLegacy);

  const implicitQuestion = await invoke('createQuizSlide', {
    quizId, expectedRevision: 6, position: 1,
    slide: editorSlide({ kind: 'free', title: 'Syntetická otázka bez předchozího kola' }),
  });
  const implicitSlide = (await getDoc(slideRef(implicitQuestion.selectedSlideId))).data();
  assert.equal(typeof implicitSlide.roundId, 'string');
  assert.equal((await getDoc(doc(db, 'quizzes', quizId, 'rounds', implicitSlide.roundId, 'questions', implicitQuestion.selectedSlideId))).exists(), true);
  const removedImplicitQuestion = await invoke('deleteQuizSlide', {
    quizId, slideId: implicitQuestion.selectedSlideId, expectedRevision: 7,
  });
  assert.equal(removedImplicitQuestion.revision, 8);
  assert.equal((await getDoc(doc(db, 'quizzes', quizId, 'rounds', implicitSlide.roundId))).exists(), false);

  const renamedRound = await invoke('updateQuizRound', {
    quizId, roundId: 'live-round', title: 'Přejmenované syntetické kolo', expectedRevision: 8,
  });
  assert.equal(renamedRound.revision, 9);
  assert.equal((await getDoc(doc(db, 'quizzes', quizId, 'rounds', 'live-round'))).data().title, 'Přejmenované syntetické kolo');
  assert.equal((await getDoc(slideRef('slide-001'))).data().kind, 'intro');
  await assertRoundTitleConsistency('live-round', 'Přejmenované syntetické kolo');

  const reorderedQuestion = await invoke('reorderQuizQuestion', {
    quizId, slideId: 'slide-002', direction: 1, expectedRevision: 9,
  });
  assert.equal(reorderedQuestion.revision, 10);
  const reorderedLiveQuestions = (await getDocs(query(collection(quizRef, 'slides'), orderBy('position')))).docs
    .filter((item) => item.data().roundId === 'live-round' && item.data().isQuestion === true);
  assert.equal(reorderedLiveQuestions[1].id, 'slide-002');
  await assertRoundTitleConsistency('live-round', 'Přejmenované syntetické kolo');

  const movedQuestion = await invoke('moveQuizQuestionToRound', {
    quizId, slideId: 'slide-002', targetRoundId: roundHeader.roundId, expectedRevision: 10,
  });
  assert.equal(movedQuestion.revision, 11);
  assert.equal((await getDoc(slideRef('slide-002'))).data().roundId, roundHeader.roundId);
  assert.equal((await getDoc(doc(db, 'quizzes', quizId, 'rounds', 'live-round', 'questions', 'slide-002'))).exists(), false);
  assert.equal((await getDoc(doc(db, 'quizzes', quizId, 'rounds', roundHeader.roundId, 'questions', 'slide-002'))).exists(), true);

  const duplicatedRound = await invoke('duplicateQuizRound', {
    quizId, roundId: 'live-round', expectedRevision: 11,
  });
  assert.equal(duplicatedRound.revision, 12);
  const duplicatedRoundId = (await getDoc(slideRef(duplicatedRound.selectedSlideId))).data().roundId;
  assert.notEqual(duplicatedRoundId, 'live-round');
  assert.notEqual(duplicatedRoundId, roundHeader.roundId);
  const duplicatedRoundSlides = (await getDocs(query(collection(quizRef, 'slides'), orderBy('position')))).docs
    .filter((item) => item.data().roundId === duplicatedRoundId);
  assert.equal(duplicatedRoundSlides.length > 0, true);
  assert.equal(duplicatedRoundSlides.every((item) => item.data().roundTitle.endsWith('– kopie')), true);
  await assertRoundTitleConsistency(duplicatedRoundId, 'Přejmenované syntetické kolo – kopie');
  await assertRoundTitleConsistency('live-round', 'Přejmenované syntetické kolo');

  const movedRound = await invoke('moveQuizRound', {
    quizId, roundId: duplicatedRoundId, direction: 1, expectedRevision: 12,
  });
  assert.equal(movedRound.revision, 13);
  const roundOrderAfterMove = (await getDocs(query(collection(quizRef, 'rounds'), orderBy('position')))).docs.map((item) => item.id);
  assert.deepEqual(roundOrderAfterMove, ['live-round', roundHeader.roundId, duplicatedRoundId]);

  const deletedRound = await invoke('removeQuizRound', {
    quizId, roundId: duplicatedRoundId, mode: 'delete', expectedRevision: 13,
  });
  assert.equal(deletedRound.revision, 14);
  assert.equal((await getDoc(doc(db, 'quizzes', quizId, 'rounds', duplicatedRoundId))).exists(), false);

  const removedRoundWithMove = await invoke('removeQuizRound', {
    quizId, roundId: roundHeader.roundId, mode: 'move', targetRoundId: 'live-round', expectedRevision: 14,
  });
  assert.equal(removedRoundWithMove.revision, 15);
  assert.equal((await getDoc(doc(db, 'quizzes', quizId, 'rounds', roundHeader.roundId))).exists(), false);
  assert.equal((await getDoc(slideRef('slide-002'))).data().roundId, 'live-round');

  await expectFunctionError(
    () => invoke('repairQuizPreflightIssue', {
      quizId, slideId: 'slide-002', expectedRevision: 15, kind: 'choice-answer', optionIndex: 99,
    }),
    'functions/invalid-argument',
  );
  const beforeRepair = (await getDoc(slideRef('slide-002'))).data();
  const selectedStoredOption = beforeRepair.options[4];
  const repairedChoice = await invoke('repairQuizPreflightIssue', {
    quizId, slideId: 'slide-002', expectedRevision: 15, kind: 'choice-answer', optionIndex: 4,
  });
  assert.equal(repairedChoice.revision, 16);
  assert.equal(JSON.stringify(repairedChoice).includes(selectedStoredOption), false);
  assert.equal(Object.hasOwn(repairedChoice, 'correctAnswer'), false);
  const afterChoiceRepair = (await getDoc(slideRef('slide-002'))).data();
  assert.equal(afterChoiceRepair.correctAnswer, selectedStoredOption);
  assert.deepEqual(afterChoiceRepair.legacy, originalLegacy);
  assert.equal(
    (await getDoc(doc(db, 'quizzes', quizId, 'rounds', 'live-round', 'questions', 'slide-002'))).data().correctAnswer,
    selectedStoredOption,
  );
  await expectFunctionError(
    () => invoke('repairQuizPreflightIssue', {
      quizId, slideId: 'slide-002', expectedRevision: 15, kind: 'choice-answer', optionIndex: 0,
    }),
    'functions/aborted',
  );
  await expectFunctionError(
    () => invoke('repairQuizPreflightIssue', {
      quizId, slideId: createdQuestion.selectedSlideId, expectedRevision: 16, kind: 'video-timing',
      clipStartSeconds: 12, clipEndSeconds: 12,
    }),
    'functions/invalid-argument',
  );
  const repairedTiming = await invoke('repairQuizPreflightIssue', {
    quizId, slideId: createdQuestion.selectedSlideId, expectedRevision: 16, kind: 'video-timing',
    clipStartSeconds: 4.5, clipEndSeconds: 11,
  });
  assert.equal(repairedTiming.revision, 17);
  assert.equal(Object.hasOwn(repairedTiming, 'clipStartSeconds'), false);
  const repairedVideoSlide = (await getDoc(slideRef(createdQuestion.selectedSlideId))).data();
  assert.deepEqual(
    { clipStartSeconds: repairedVideoSlide.clipStartSeconds, clipEndSeconds: repairedVideoSlide.clipEndSeconds },
    { clipStartSeconds: 4.5, clipEndSeconds: 11 },
  );

  const finalQuiz = (await getDoc(quizRef)).data();
  const finalOrderedSlides = await orderedSlides();
  assert.equal(finalQuiz.slideCount, finalOrderedSlides.length);
  assert.deepEqual(finalOrderedSlides.map((slide) => slide.data().position), Array.from({ length: finalOrderedSlides.length }, (_, index) => index + 1));
  assert.equal(finalQuiz.revision, 17);
  assert.equal((await getDoc(doc(db, 'publicSessions', 'quiz-editor-e2e'))).exists(), false);
  assert.equal((await getDoc(importedQuizRef)).data().revision, 2);
  assert.equal(JSON.stringify({
    root: (await adminDb.doc(snapshotRef.path).get()).data(),
    slide: (await adminDb.doc(snapshotSlideRef.path).get()).data(),
  }), snapshotBefore);

  const thankYouSlide = editorSlide({
    kind: 'thank-you', title: 'Děkujeme, že jste hráli!', text: '', options: [], correctAnswer: '',
  });
  const newQuizProgram = () => getDocs(query(collection(createdQuizRef, 'slides'), orderBy('position')));
  await expectFunctionError(
    () => invoke('createQuizSlide', { quizId: createdQuizId, expectedRevision: 4, position: 1, slide: thankYouSlide }),
    'functions/invalid-argument',
  );
  const thankYou = await invoke('createQuizSlide', {
    quizId: createdQuizId, expectedRevision: 4, position: 1, scope: 'quiz', slide: thankYouSlide,
  });
  const savedThankYou = (await newQuizProgram()).docs[0];
  assert.equal(savedThankYou.id, thankYou.selectedSlideId);
  assert.equal(savedThankYou.data().roundId, undefined);
  assert.equal(savedThankYou.data().isQuestion, false);
  assert.equal(thankYou.questionCount, 1);
  await expectFunctionError(
    () => invoke('createQuizSlide', { quizId: createdQuizId, expectedRevision: thankYou.revision, position: 1, scope: 'quiz', slide: thankYouSlide }),
    'functions/failed-precondition',
  );
  const info = await invoke('createQuizSlide', {
    quizId: createdQuizId, expectedRevision: thankYou.revision, position: thankYou.slideCount + 1, scope: 'quiz',
    slide: { ...thankYouSlide, kind: 'info', title: 'Organizační sdělení' },
  });
  assert.equal((await newQuizProgram()).docs.at(-1).id, info.selectedSlideId);
  const closing = await invoke('createQuizSlide', {
    quizId: createdQuizId, expectedRevision: info.revision, position: info.slideCount + 1, scope: 'quiz',
    slide: { ...thankYouSlide, kind: 'end', title: 'Závěr' },
  });
  assert.deepEqual((await newQuizProgram()).docs.slice(-2).map(slide => slide.id), [info.selectedSlideId, closing.selectedSlideId]);
  const lastRound = await invoke('createQuizRound', {
    quizId: createdQuizId, expectedRevision: closing.revision, position: closing.slideCount, title: 'Kolo před vyhlášením',
  });
  const program = (await newQuizProgram()).docs;
  assert.deepEqual(program.slice(-4).map(slide => slide.data().kind), ['info', 'round', 'recap', 'end']);
  assert.equal(program.at(-3).id, lastRound.selectedSlideId);

  const sourceBeforeCopy = (await getDoc(createdQuizRef)).data();
  const sourceProgramBefore = program.map(slide => ({ id: slide.id, data: slide.data() }));
  const copyRequest = {
    quizId: createdQuizId, expectedRevision: lastRound.revision,
    title: 'Samostatná kopie syntetického kvízu', requestId: 'editor-e2e-duplicate-whole-1',
  };
  await expectFunctionError(
    () => invoke('duplicateQuiz', { ...copyRequest, requestId: 'editor-e2e-duplicate-stale', expectedRevision: lastRound.revision - 1 }),
    'functions/aborted',
  );
  const [copy, replay] = await Promise.all([
    invoke('duplicateQuiz', copyRequest),
    invoke('duplicateQuiz', copyRequest),
  ]);
  assert.deepEqual(copy, replay);
  assert.notEqual(copy.quizId, createdQuizId);
  assert.equal(copy.roundCount, lastRound.roundCount);
  assert.equal(copy.questionCount, lastRound.questionCount);
  assert.equal(copy.slideCount, lastRound.slideCount);
  const copyRef = doc(db, 'quizzes', copy.quizId);
  const copied = (await getDoc(copyRef)).data();
  assert.equal(copied.status, 'draft');
  assert.equal(copied.title, copyRequest.title);
  assert.equal(copied.createdBy, auth.currentUser.uid);
  const copiedSlides = (await getDocs(query(collection(copyRef, 'slides'), orderBy('position')))).docs;
  const outline = items => items.map(item => ({
    position: item.position, kind: item.kind, title: item.title, text: item.text,
    correctAnswer: item.correctAnswer, moderatorNote: item.moderatorNote,
  }));
  assert.deepEqual(outline(copiedSlides.map(slide => slide.data())), outline(program.map(slide => slide.data())));
  await invoke('updateQuizMetadata', {
    quizId: copy.quizId, expectedRevision: copy.revision,
    quiz: { title: 'Upravená kopie', description: copied.description },
  });
  assert.equal((await getDoc(copyRef)).data().title, 'Upravená kopie');
  assert.deepEqual((await getDoc(createdQuizRef)).data(), sourceBeforeCopy);
  assert.deepEqual((await newQuizProgram()).docs.map(slide => ({ id: slide.id, data: slide.data() })), sourceProgramBefore);
  assert.equal((await invoke('duplicateQuiz', copyRequest)).quizId, copy.quizId);
  await expectFunctionError(
    () => invoke('duplicateQuiz', { ...copyRequest, title: 'Změněný požadavek' }),
    'functions/already-exists',
  );
  const copyMembership = (await memberRef.get()).data();
  try {
    await memberRef.update({ quizzes: { mode: 'selected', ids: [copy.quizId] }, version: copyMembership.version + 1 });
    await expectFunctionError(() => invoke('duplicateQuiz', copyRequest), 'functions/permission-denied');
  } finally {
    await memberRef.set({ ...copyMembership, version: copyMembership.version + 2 });
  }

  // Use the independent copy to exercise explicit gaps without changing the source or its snapshot.
  const copyProgram = async () => (await getDocs(query(collection(copyRef, 'slides'), orderBy('position')))).docs;
  let copyRevision = (await getDoc(copyRef)).data().revision;
  const added = await invoke('createQuizRound', { quizId: copy.quizId, expectedRevision: copyRevision, position: 1, title: 'Výchozí jméno' });
  copyRevision = added.revision;
  const introduced = (await copyProgram()).find(slide => slide.id === added.selectedSlideId);
  const editedRoundId = introduced.data().roundId;
  const recap = (await copyProgram()).find(slide => slide.data().roundId === editedRoundId && slide.data().kind === 'recap');
  const rename = async title => { copyRevision = (await invoke('updateQuizRound', { quizId: copy.quizId, expectedRevision: copyRevision, roundId: editedRoundId, title })).revision; };
  await rename('Nový název');
  for (const slide of [introduced, recap]) assert.equal((await getDoc(slide.ref)).data().title, 'Nový název');
  for (const [slide, title] of [[introduced, 'Program pro diváky'], [recap, 'Vzpomínáte si?']]) {
    copyRevision = (await invoke('updateQuizSlide', { quizId: copy.quizId, expectedRevision: copyRevision, slideId: slide.id,
      slide: editorSlide({ kind: slide.data().kind, title, options: [], text: '', correctAnswer: '' }) })).revision;
  }
  await rename('Poslední název');
  assert.equal((await getDoc(introduced.ref)).data().title, 'Program pro diváky');
  assert.equal((await getDoc(recap.ref)).data().title, 'Vzpomínáte si?');
  for (const slide of [introduced, recap]) {
    const data = (await getDoc(slide.ref)).data();
    assert.equal(data.roundId, editedRoundId); assert.equal(data.roundTitle, 'Poslední název');
    await expectFunctionError(() => invoke('deleteQuizSlide', { quizId: copy.quizId, expectedRevision: copyRevision, slideId: slide.id }), 'functions/failed-precondition');
  }
  copyRevision = (await invoke('updateQuizSlide', { quizId: copy.quizId, expectedRevision: copyRevision,
    slideId: recap.id, slide: editorSlide({ kind: 'recap', title: '', text: 'Pouze doprovodný text', options: [], correctAnswer: '' }) })).revision;
  await rename('Název bez změny prázdného nadpisu');
  assert.equal((await getDoc(recap.ref)).data().title, '');
  const questionInput = editorSlide({ kind: 'free', title: 'Nová otázka', correctAnswer: 'Odpověď', options: [] });
  for (const gap of ['first', 'middle', 'last']) {
    const before = await copyProgram();
    const index = gap === 'first' ? 0 : gap === 'last' ? before.length : before.findIndex(slide => slide.id === recap.id);
    const target = before.slice(0, index).reverse().find(slide => slide.data().roundId) ?? before.slice(index).find(slide => slide.data().roundId);
    const roundId = target.data().roundId;
    const request = { quizId: copy.quizId, expectedRevision: copyRevision, position: index + 1, roundId, slide: questionInput };
    await expectFunctionError(() => invoke('createQuizSlide', { ...request, roundId: 'neexistujici-kolo' }), 'functions/failed-precondition');
    const result = await invoke('createQuizSlide', request); copyRevision = result.revision;
    const expected = before.map(slide => slide.id); expected.splice(index, 0, result.selectedSlideId);
    const after = await copyProgram();
    assert.deepEqual(after.map(slide => slide.id), expected);
    assert.equal(after[index].data().roundId, roundId);
    const members = after.filter(slide => slide.data().roundId === roundId && slide.data().isQuestion);
    assert.deepEqual(members.map(slide => slide.data().questionNumber), members.map((_, offset) => offset + 1));
    assert(members.every(slide => slide.data().questionCount === members.length));
  }

  // Split an existing round immediately before its last question. The gap before
  // the inserted header belongs to the preceding round, and the gap following
  // its recap belongs to the next question even though that recap is nearer.
  const lastQuestion = (await copyProgram()).at(-1);
  const lastRoundId = lastQuestion.data().roundId;
  const inner = await invoke('createQuizRound', { quizId: copy.quizId, expectedRevision: copyRevision,
    position: lastQuestion.data().position, title: 'Vložené kolo' });
  copyRevision = inner.revision;
  for (const beforeId of [inner.selectedSlideId, lastQuestion.id]) {
    const stream = await copyProgram();
    const index = stream.findIndex(slide => slide.id === beforeId);
    const precedingId = stream.slice(0, index).reverse().find(slide => slide.data().roundId).data().roundId;
    const roundId = beforeId === lastQuestion.id ? lastRoundId : precedingId;
    if (beforeId === lastQuestion.id) assert.notEqual(precedingId, roundId);
    const result = await invoke('createQuizSlide', { quizId: copy.quizId, expectedRevision: copyRevision,
      position: index + 1, roundId, slide: questionInput });
    copyRevision = result.revision;
    const updated = await copyProgram();
    assert.equal(updated[index].id, result.selectedSlideId);
    assert.equal(updated[index].data().roundId, roundId);
    assert.equal(updated[index + 1].id, beforeId);
  }

  const recapQuiz = await invoke('createQuiz', { title: 'Začátek rekapitulací', requestId: 'recap-' + createRequestId });
  const firstRecap = { quizId: recapQuiz.quizId, expectedRevision: recapQuiz.revision, position: 1, scope: 'first-round',
    slide: editorSlide({ kind: 'recap', title: '1. kolo', text: '', options: [], correctAnswer: '' }) };
  const firstResult = await invoke('createQuizSlide', firstRecap);
  assert.equal(firstResult.roundCount, 1);
  assert.equal(firstResult.questionCount, 0);
  const firstSlides = (await getDocs(query(collection(db, 'quizzes', recapQuiz.quizId, 'slides'), orderBy('position')))).docs;
  assert.deepEqual(firstSlides.map(slide => slide.data().kind), ['agenda', 'round', 'recap']);
  assert.equal(firstSlides[2].id, firstResult.selectedSlideId);
  assert.equal(firstSlides[1].data().roundId, firstSlides[2].data().roundId);
  await expectFunctionError(() => invoke('createQuizSlide', { ...firstRecap, expectedRevision: firstResult.revision }), 'functions/failed-precondition');

  const sourceAssetFixture = adminDb.doc(`quizzes/${createdQuizId}/slides/${savedThankYou.id}`);
  await sourceAssetFixture.update({ backgroundImage: `quiz-asset:${createdQuizId}/${'a'.repeat(64)}` });
  const assetCopyRequest = { ...copyRequest, requestId: 'editor-e2e-duplicate-owned', title: 'Neúplná kopie nesmí vzniknout' };
  await expectFunctionError(() => invoke('duplicateQuiz', assetCopyRequest), 'functions/failed-precondition');
  assert.equal((await adminDb.collection('quizzes').where('title', '==', assetCopyRequest.title).get()).empty, true);

  await signOut(auth);
  await signInWithEmailAndPassword(auth, 'moderator@example.test', 'LocalQuiz123!');
  await expectFunctionError(() => invoke('duplicateQuiz', copyRequest), 'functions/permission-denied');

  globalThis.console.log(JSON.stringify({
    status: 'PASS', adminMutations: true, moderatorReadOnly: true, normalUserDenied: true,
    directWritesDenied: true, staleAndConcurrentWritesVerified: true,
    legacyRoundTripPreserved: true, orderedCrudVerified: true,
    implicitRoundCreatedAndCleaned: true, semanticRoundAndQuestionOperationsVerified: true,
    legacyIntroRoundRenameAndDuplicateConsistencyVerified: true,
    guidedChoiceAndTimingRepairVerified: true, repairAuthorizationAndStaleRevisionVerified: true,
    repairResponseSanitized: true,
    safeRoundRemovalModesVerified: true, publicSessionUntouched: true,
    importedZeroTimingRoundTripVerified: true, importedPrivateFieldsPreserved: true,
    createQuizAuthorizationAndIdempotenceVerified: true, newQuizRoundQuestionSaveReloadVerified: true,
    newQuizConflictVerified: true, historicalSnapshotUntouched: true,
    thankYouAtRequestedPositionVerified: true,
    wholeQuizCopyIsolationAndRetryVerified: true, missingMediaCannotCreatePartialCopy: true,
  }, null, 2));
}

try {
  await run();
} finally {
  await deleteApp(app);
  await deleteAdminApp(adminApp);
}
