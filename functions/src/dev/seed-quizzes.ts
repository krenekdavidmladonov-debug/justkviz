import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore, type WriteBatch } from 'firebase-admin/firestore';

interface SeedQuestion {
  readonly id: string;
  readonly type: 'text' | 'image' | 'audio';
  readonly prompt: string;
  readonly correctAnswer: string;
  readonly position: number;
}

interface SeedRound {
  readonly id: string;
  readonly title: string;
  readonly type: 'classic' | 'picture' | 'audio';
  readonly position: number;
  readonly questions: readonly SeedQuestion[];
}

interface SeedQuiz {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: 'draft' | 'ready' | 'archived';
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly rounds: readonly SeedRound[];
}

const seedActor = 'emulator-seed';

const quizzes: readonly SeedQuiz[] = [
  {
    id: 'filmovy-kviz-1',
    title: 'Filmový kvíz #1',
    description: 'Pestrý úvodní kvíz z českých i světových filmů.',
    status: 'ready',
    createdAt: new Date('2026-01-10T18:00:00.000Z'),
    updatedAt: new Date('2026-08-22T16:30:00.000Z'),
    rounds: [
      {
        id: 'klasika',
        title: 'Filmová klasika',
        type: 'classic',
        position: 1,
        questions: [
          { id: 'taxikar', type: 'text', prompt: 'Kdo režíroval film Taxikář z roku 1976?', correctAnswer: 'Martin Scorsese', position: 1 },
          { id: 'oscar', type: 'text', prompt: 'Který film získal Oscara za nejlepší film za rok 1994?', correctAnswer: 'Forrest Gump', position: 2 },
        ],
      },
      {
        id: 'obrazky',
        title: 'Poznej film podle záběru',
        type: 'picture',
        position: 2,
        questions: [
          { id: 'hotel', type: 'image', prompt: 'Ze kterého filmu pochází tento hotelový záběr?', correctAnswer: 'Osvícení', position: 1 },
          { id: 'vesmir', type: 'image', prompt: 'Poznejte sci-fi film podle záběru z vesmíru.', correctAnswer: 'Interstellar', position: 2 },
        ],
      },
    ],
  },
  {
    id: 'harry-potter-special',
    title: 'Harry Potter speciál',
    description: 'Tematický večer pro znalce kouzelnického světa.',
    status: 'draft',
    createdAt: new Date('2026-04-02T12:00:00.000Z'),
    updatedAt: new Date('2026-08-28T19:45:00.000Z'),
    rounds: [
      {
        id: 'bradavice',
        title: 'Bradavice',
        type: 'classic',
        position: 1,
        questions: [
          { id: 'kolej', type: 'text', prompt: 'Do které koleje patřila Lenka Láskorádová?', correctAnswer: 'Havraspár', position: 1 },
          { id: 'reditel', type: 'text', prompt: 'Jaké je celé jméno ředitele Brumbála?', correctAnswer: 'Albus Percival Wulfric Brian Brumbál', position: 2 },
          { id: 'patron', type: 'text', prompt: 'Jakou podobu má patron Severuse Snapea?', correctAnswer: 'Laň', position: 3 },
        ],
      },
      {
        id: 'hudba',
        title: 'Hudba a zvuky',
        type: 'audio',
        position: 2,
        questions: [
          { id: 'skladatel', type: 'audio', prompt: 'Kdo složil hlavní hudební motiv prvních filmů?', correctAnswer: 'John Williams', position: 1 },
        ],
      },
    ],
  },
  {
    id: 'vanocni-filmovy-kviz',
    title: 'Vánoční filmový kvíz',
    description: 'Sváteční klasiky, pohádky a filmy, které patří k prosinci.',
    status: 'archived',
    createdAt: new Date('2025-10-15T09:00:00.000Z'),
    updatedAt: new Date('2026-01-05T11:20:00.000Z'),
    rounds: [
      {
        id: 'vanoce-ve-filmu',
        title: 'Vánoce ve filmu',
        type: 'classic',
        position: 1,
        questions: [
          { id: 'sam-doma', type: 'text', prompt: 'Do kterého města odletí Kevinova rodina ve filmu Sám doma?', correctAnswer: 'Paříž', position: 1 },
          { id: 'laska-nebeska', type: 'text', prompt: 'Na kterém letišti začíná a končí film Láska nebeská?', correctAnswer: 'Heathrow', position: 2 },
        ],
      },
    ],
  },
];

function assertSafeEmulatorEnvironment(): string {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;

  const portMatch = /^(?:localhost|127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})$/u.exec(emulatorHost ?? '');
  if (portMatch === null || Number(portMatch[1]) > 65_535) {
    throw new Error('Refusing to seed: FIRESTORE_EMULATOR_HOST must use localhost with an explicit port.');
  }

  if (!projectId?.startsWith('demo-')) {
    throw new Error('Refusing to seed: the Firebase project ID must start with demo-.');
  }

  return projectId;
}

function writeQuiz(batch: WriteBatch, quiz: SeedQuiz): void {
  const db = getFirestore();
  const quizRef = db.collection('quizzes').doc(quiz.id);
  const questionCount = quiz.rounds.reduce((total, round) => total + round.questions.length, 0);
  const orderedQuestions = quiz.rounds.flatMap((round) => (
    round.questions.map((question) => ({ question, roundId: round.id }))
  ));

  batch.set(quizRef, {
    title: quiz.title,
    description: quiz.description,
    status: quiz.status,
    createdAt: Timestamp.fromDate(quiz.createdAt),
    updatedAt: Timestamp.fromDate(quiz.updatedAt),
    createdBy: seedActor,
    updatedBy: seedActor,
    slideCount: orderedQuestions.length,
    roundCount: quiz.rounds.length,
    questionCount,
  });

  orderedQuestions.forEach(({ question, roundId }, index) => {
    batch.set(quizRef.collection('slides').doc(`slide-${String(index + 1).padStart(3, '0')}`), {
      position: index + 1,
      kind: question.type === 'text' ? 'question' : question.type,
      isQuestion: true,
      title: `Otázka ${index + 1}`,
      text: question.prompt,
      options: [],
      media: [],
      presentation: {},
      roundId,
      correctAnswer: question.correctAnswer,
      legacy: { source: 'synthetic-emulator-seed', raw: {} },
    });
  });

  for (const round of quiz.rounds) {
    const roundRef = quizRef.collection('rounds').doc(round.id);
    batch.set(roundRef, {
      title: round.title,
      type: round.type,
      position: round.position,
      questionCount: round.questions.length,
    });

    for (const question of round.questions) {
      const globalIndex = orderedQuestions.findIndex((entry) => entry.roundId === round.id && entry.question.id === question.id);
      batch.set(roundRef.collection('questions').doc(`slide-${String(globalIndex + 1).padStart(3, '0')}`), {
        type: question.type,
        prompt: question.prompt,
        correctAnswer: question.correctAnswer,
        position: question.position,
      });
    }
  }
}

function writeLiveFlowQuiz(batch: WriteBatch, quizId: string, firstQuestionType: 'choice' | 'free' = 'choice'): void {
  const db = getFirestore();
  const quizRef = db.collection('quizzes').doc(quizId);
  const timestamp = Timestamp.fromDate(new Date('2026-09-01T08:00:00.000Z'));
  const slides = [
    { kind: 'intro', isQuestion: false, title: 'Začínáme', text: 'Syntetický úvod', options: [], media: [], presentation: {} },
    {
      kind: firstQuestionType === 'free' ? 'free' : 'question', isQuestion: true, title: 'Otázka', text: 'Syntetický veřejný prompt',
      options: firstQuestionType === 'free' ? [] : ['A', 'B', 'C'], correctAnswer: 'Syntetická odpověď',
      moderatorNote: 'Pouze moderátor',
      media: [
        { role: 'prompt', kind: 'image', value: 'https://example.test/prompt.jpg' },
        { role: 'answer', kind: 'image', value: 'https://example.test/answer.jpg' },
      ],
      presentation: { backgroundOverlay: 55 },
    },
    { kind: 'agenda', isQuestion: false, title: 'Program', text: 'Syntetická agenda', options: [], media: [], presentation: {} },
    { kind: 'image', isQuestion: true, title: 'Obrázek', text: 'Syntetická obrázková otázka', options: [], correctAnswer: 'Obrázek', media: [{ role: 'prompt', kind: 'image', value: 'https://example.test/image.jpg' }], presentation: {} },
    { kind: 'audio', isQuestion: true, title: 'Audio', text: 'Syntetická audio otázka', options: [], correctAnswer: 'Audio', media: [{ role: 'prompt', kind: 'audio', value: 'erroraudio1' }], presentation: { audioTrigger: 5 }, clipStartSeconds: 5, clipEndSeconds: 10 },
    { kind: 'video', isQuestion: true, title: 'Video', text: 'Syntetická video otázka', options: [], correctAnswer: 'Video', media: [{ role: 'prompt', kind: 'video', value: 'errorvideo1' }], presentation: { videoStart: 2, videoEnd: 8 } },
    { kind: 'recap', isQuestion: false, title: 'Rekapitulace', text: 'Syntetický přehled', options: [], media: [], presentation: {} },
    { kind: 'pl', isQuestion: true, title: 'Legacy slide', text: 'Bezpečný fallback', options: [], correctAnswer: 'Pravda', media: [], presentation: {} },
    { kind: 'end', isQuestion: false, title: 'Konec', text: 'Děkujeme', options: [], media: [], presentation: {} },
  ] as const;

  batch.set(quizRef, {
    title: 'Live session E2E',
    description: 'Syntetický lokální kvíz pro bezpečnostní ověření.',
    status: 'ready',
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: seedActor,
    updatedBy: seedActor,
    slideCount: slides.length,
    roundCount: 1,
    questionCount: slides.filter((slide) => slide.isQuestion).length,
  });

  slides.forEach((slide, index) => {
    batch.set(quizRef.collection('slides').doc(`slide-${String(index + 1).padStart(3, '0')}`), {
      ...slide,
      position: index + 1,
      roundId: 'live-round',
      legacy: {
        source: 'synthetic-emulator-seed',
        raw: { correct: 'Never publish this raw field', moderatorNote: 'Never publish this note' },
      },
    });
  });

  batch.set(quizRef.collection('rounds').doc('live-round'), {
    title: 'Syntetické kolo',
    type: 'classic',
    position: 1,
    slideCount: slides.length,
    questionCount: slides.filter((slide) => slide.isQuestion).length,
  });
}

function writePreflightQuiz(batch: WriteBatch, quizId: string, state: 'ready' | 'warning' | 'blocked'): void {
  const db = getFirestore();
  const quizRef = db.collection('quizzes').doc(quizId);
  const timestamp = Timestamp.fromDate(new Date('2026-09-02T08:00:00.000Z'));
  const question = state === 'ready'
    ? {
      kind: 'free', title: '', text: 'Syntetická připravená otázka', options: [],
      correctAnswer: 'Syntetická odpověď', mediaSource: '', clipStartSeconds: null, clipEndSeconds: null,
    }
    : state === 'warning'
      ? {
        kind: 'video', title: '', text: 'Syntetická otázka s online médiem', options: [],
        correctAnswer: 'Syntetická odpověď', mediaSource: 'abcdefghijk', clipStartSeconds: 0, clipEndSeconds: 10,
      }
      : {
        kind: 'question', title: '', text: '', options: ['Jediná možnost', ''],
        correctAnswer: '', mediaSource: '', clipStartSeconds: null, clipEndSeconds: null,
      };
  const slides = [
    { kind: 'round', isQuestion: false, title: 'Syntetické kolo', text: '', options: [], correctAnswer: '', media: [], presentation: {} },
    { ...question, isQuestion: true, media: [], presentation: {} },
    { kind: 'recap', isQuestion: false, title: 'Rekapitulace', text: '', options: [], correctAnswer: '', media: [], presentation: {} },
  ] as const;

  batch.set(quizRef, {
    title: `Preflight ${state}`,
    description: 'Syntetický lokální kvíz pro kontrolu připravenosti.',
    status: 'ready',
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: seedActor,
    updatedBy: seedActor,
    slideCount: slides.length + 1,
    roundCount: 1,
    questionCount: 1,
  });
  batch.set(quizRef.collection('slides').doc('quiz-intro'), {
    kind: 'intro', isQuestion: false, position: 1, title: `Preflight ${state}`,
    text: '', options: [], correctAnswer: '', media: [], presentation: {},
  });
  slides.forEach((slide, index) => {
    batch.set(quizRef.collection('slides').doc(`slide-${String(index + 1).padStart(3, '0')}`), {
      ...slide,
      position: index + 2,
      roundId: 'preflight-round',
      roundTitle: 'Syntetické kolo',
      ...(slide.isQuestion ? { questionNumber: 1, questionCount: 1 } : {}),
    });
  });
  const roundRef = quizRef.collection('rounds').doc('preflight-round');
  batch.set(roundRef, {
    title: 'Syntetické kolo', type: 'classic', position: 1, slideCount: slides.length, questionCount: 1,
  });
  batch.set(roundRef.collection('questions').doc('slide-002'), {
    type: state === 'warning' ? 'video' : 'text',
    prompt: question.text,
    correctAnswer: question.correctAnswer,
    position: 1,
  });
}

function writeRepairFlowQuiz(batch: WriteBatch, quizId: string): void {
  const db = getFirestore();
  const quizRef = db.collection('quizzes').doc(quizId);
  const timestamp = Timestamp.fromDate(new Date('2026-09-03T08:00:00.000Z'));
  const slides = [
    {
      id: 'slide-001', kind: 'round', isQuestion: false, title: 'Syntetické repair kolo', text: '',
      options: [], correctAnswer: '', media: [], presentation: {},
    },
    {
      id: 'slide-002', kind: 'question', isQuestion: true, title: '', text: 'Syntetická Choice otázka',
      options: ['Syntetická možnost A', 'Syntetická možnost B', 'Syntetická možnost C', 'Syntetická možnost D', 'Syntetická možnost E'],
      correctAnswer: 'Historická syntetická hodnota', media: [], presentation: {},
    },
    {
      id: 'slide-003', kind: 'video', isQuestion: true, title: '', text: 'Syntetická Video otázka',
      options: [], correctAnswer: 'Syntetická odpověď', media: [{ role: 'prompt', kind: 'video', value: 'abcdefghijk' }],
      presentation: { videoStart: 8, videoEnd: 4 }, mediaSource: 'abcdefghijk', clipStartSeconds: 8, clipEndSeconds: 4,
    },
    {
      id: 'slide-004', kind: 'recap', isQuestion: false, title: 'Rekapitulace', text: '',
      options: [], correctAnswer: '', media: [], presentation: {},
    },
  ] as const;
  batch.set(quizRef, {
    title: 'Syntetický guided repair', description: 'Pouze lokální fixture.', status: 'ready', revision: 0,
    createdAt: timestamp, updatedAt: timestamp, createdBy: seedActor, updatedBy: seedActor,
    slideCount: slides.length, roundCount: 1, questionCount: 2,
  });
  slides.forEach((slide, index) => {
    batch.set(quizRef.collection('slides').doc(slide.id), {
      ...slide, position: index + 1, roundId: 'repair-round', roundTitle: 'Syntetické repair kolo',
      legacy: { source: 'synthetic-emulator-seed', raw: { opaque: 'preserve-only' } },
    });
  });
  const roundRef = quizRef.collection('rounds').doc('repair-round');
  batch.set(roundRef, {
    title: 'Syntetické repair kolo', type: 'classic', position: 1, slideCount: slides.length, questionCount: 2,
  });
  batch.set(roundRef.collection('questions').doc('slide-002'), {
    type: 'text', prompt: 'Syntetická Choice otázka', options: slides[1].options,
    correctAnswer: slides[1].correctAnswer, position: 1, sourceSlideId: 'slide-002',
  });
  batch.set(roundRef.collection('questions').doc('slide-003'), {
    type: 'video', prompt: 'Syntetická Video otázka', correctAnswer: slides[2].correctAnswer,
    position: 2, sourceSlideId: 'slide-003',
  });
}

function writeEditorCoreImportedQuiz(batch: WriteBatch, quizId: string): void {
  const db = getFirestore();
  const quizRef = db.collection('quizzes').doc(quizId);
  const timestamp = Timestamp.fromDate(new Date('2026-09-04T08:00:00.000Z'));
  const round = {
    kind: 'round', isQuestion: false, title: 'Syntetické importované kolo', text: '',
    options: [], correctAnswer: '', media: [], presentation: {},
  };
  const question = {
    kind: 'video', isQuestion: true, title: 'Importovaná video otázka', text: 'Původní syntetické zadání',
    moderatorNote: 'Soukromá importovaná poznámka',
    options: [],
    correctAnswer: 'Syntetická správná odpověď',
    media: [{
      role: 'prompt', kind: 'video', value: 'test__local', opaqueVendorField: 'preserve-only',
    }],
    presentation: {
      videoStart: 0, videoEnd: 0, sourceQuestionNumber: '1/1',
      opaquePresentationField: { preserve: true },
    },
    mediaSource: 'test__local',
    clipStartSeconds: 0,
    legacy: {
      source: 'synthetic-import-fixture',
      raw: { privateAnswerSentinel: 'preserve-only', unknownArray: [1, 2, 3] },
    },
    opaqueTopLevelField: { preserve: true },
  };

  batch.set(quizRef, {
    schemaVersion: 1,
    title: 'Syntetický importní editor E2E',
    description: 'Lokální fixture s historickým timing sentinel tvarem.',
    status: 'draft',
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: seedActor,
    updatedBy: seedActor,
    slideCount: 2,
    roundCount: 1,
    questionCount: 1,
  });
  batch.set(quizRef.collection('slides').doc('slide-001'), {
    ...round, position: 1, roundId: 'imported-round', roundTitle: round.title,
  });
  batch.set(quizRef.collection('slides').doc('slide-002'), {
    ...question, position: 2, roundId: 'imported-round', roundTitle: round.title,
    questionNumber: 1, questionCount: 1,
  });
  const roundRef = quizRef.collection('rounds').doc('imported-round');
  batch.set(roundRef, {
    title: round.title, type: 'classic', position: 1, slideCount: 2, questionCount: 1,
  });
  batch.set(roundRef.collection('questions').doc('slide-002'), {
    type: 'video', prompt: question.text, options: question.options,
    correctAnswer: question.correctAnswer, position: 1, sourceSlideId: 'slide-002',
  });

  const snapshotRef = db.collection('quizSnapshots').doc('editor-core-snapshot-sentinel');
  batch.set(snapshotRef, {
    sourceQuizId: quizId,
    sourceQuizRevision: 0,
    title: 'Neměnný syntetický snapshot',
    slideCount: 1,
    roundCount: 1,
    questionCount: 1,
    createdAt: timestamp,
    immutableSentinel: { preserve: ['root', 42] },
  });
  batch.set(snapshotRef.collection('slides').doc('slide-002'), {
    ...question, position: 1, roundId: 'imported-round', roundTitle: round.title,
    immutableSentinel: { preserve: ['slide', 84] },
  });
}

async function clearLiveFlowFixture(db: Firestore, quizId: string): Promise<void> {
  const quizRef = db.collection('quizzes').doc(quizId);
  const [rounds, slides] = await Promise.all([
    quizRef.collection('rounds').get(),
    quizRef.collection('slides').get(),
  ]);
  const batch = db.batch();
  rounds.docs.forEach((round) => batch.delete(round.ref));
  slides.docs.forEach((slide) => batch.delete(slide.ref));
  batch.delete(quizRef);
  await batch.commit();
}

async function seed(): Promise<void> {
  const projectId = assertSafeEmulatorEnvironment();
  const app = initializeApp({ projectId });

  try {
    const db = getFirestore();
    await clearLiveFlowFixture(db, 'live-session-e2e');
    await clearLiveFlowFixture(db, 'quiz-editor-e2e');
    await clearLiveFlowFixture(db, 'projector-lifecycle-e2e');
    await clearLiveFlowFixture(db, 'round-first-editor-browser-e2e');
    await clearLiveFlowFixture(db, 'preflight-ready-e2e');
    await clearLiveFlowFixture(db, 'preflight-warning-e2e');
    await clearLiveFlowFixture(db, 'preflight-blocked-e2e');
    await clearLiveFlowFixture(db, 'preflight-repair-flow-e2e');
    await clearLiveFlowFixture(db, 'preflight-repair-readonly-e2e');
    await clearLiveFlowFixture(db, 'events-toctou-e2e');
    await clearLiveFlowFixture(db, 'editor-core-imported-e2e');
    const batch = db.batch();
    for (const quiz of quizzes) {
      writeQuiz(batch, quiz);
    }
    writeLiveFlowQuiz(batch, 'live-session-e2e', 'free');
    writeLiveFlowQuiz(batch, 'quiz-editor-e2e');
    writeLiveFlowQuiz(batch, 'projector-lifecycle-e2e', 'free');
    writeLiveFlowQuiz(batch, 'round-first-editor-browser-e2e');
    writePreflightQuiz(batch, 'preflight-ready-e2e', 'ready');
    writePreflightQuiz(batch, 'preflight-warning-e2e', 'warning');
    writePreflightQuiz(batch, 'preflight-blocked-e2e', 'blocked');
    writeRepairFlowQuiz(batch, 'preflight-repair-flow-e2e');
    writeRepairFlowQuiz(batch, 'preflight-repair-readonly-e2e');
    writePreflightQuiz(batch, 'events-toctou-e2e', 'ready');
    writeEditorCoreImportedQuiz(batch, 'editor-core-imported-e2e');
    await batch.commit();
    console.log(`Seeded ${quizzes.length} library quizzes and 11 isolated E2E fixtures into ${projectId}.`);
  } finally {
    await deleteApp(app);
  }
}

void seed().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
