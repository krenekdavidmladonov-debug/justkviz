import { assertPlayableQuizSource } from '../functions/src/quizzes/playable';
import { describe, expect, test } from 'vitest';

import type { EditorQuiz, EditorSlide } from '../packages/quiz-domain/src/index';
import {
  buildPublicEventProjection,
  canArchiveEvent,
  canCancelEvent,
  canLockQuiz,
  canMutateEvent,
  defaultScoringConfiguration,
  validateEventCapacity,
  validateEventConfiguration,
} from '../functions/src/events/model';
import {
  buildQuizSnapshotMetadata,
  snapshotWriteCount,
} from '../functions/src/events/snapshot-model';
import { requestedEventConfiguration } from '../functions/src/events/validation';

const validConfiguration = {
  title: 'Filmový večer',
  startsAt: new Date('2026-10-20T17:00:00.000Z'),
  timeZone: 'Europe/Prague',
  venue: { name: 'Kulturní dům', publicLocation: 'Hlavní sál' },
  teamCapacity: 20,
  peopleCapacity: 120,
  teamSizeMin: 2,
  teamSizeMax: 4,
} as const;

function slide(overrides: Partial<EditorSlide> = {}): EditorSlide {
  return {
    id: 'question-1', position: 1, storedKind: 'free', kind: 'free', isQuestion: true,
    roundId: 'round-1', roundTitle: 'Kolo 1', title: '', text: 'Otázka', moderatorNote: '',
    options: [], correctAnswer: 'Odpověď', media: [],
    presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null },
    backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '', backgroundOverlay: null,
    clipStartSeconds: null, clipEndSeconds: null, hasLegacyData: false,
    ...overrides,
  };
}

const quiz: EditorQuiz = {
  id: 'quiz-1', title: 'Kvíz', description: 'Popis', revision: 7,
  slideCount: 1, roundCount: 1, questionCount: 1, slides: [slide()],
};

test('immutable event source stores appearance and safe static result templates at lock time', () => {
  const authored: EditorQuiz = { ...quiz, printTemplate: { title: 'Team sheet', layout: 'compact', logoImage: 'https://example.test/logo.png' }, defaultDesign: { textColor: '#fff' }, defaultAppearance: { backgroundImage: '', backgroundOverlay: 30, imageLayout: 'split' }, resultTemplates: { final: { title: 'Winners', design: { accentColor: '#abc' } } } };
  const frozen = JSON.parse(JSON.stringify(buildQuizSnapshotMetadata(authored, { blockerCount: 0, warningCount: 0 }, 'admin', 'now'))) as Record<string, unknown>;
  const laterSource = { ...authored, defaultDesign: { textColor: '#000' }, resultTemplates: { final: { title: 'Changed later' } } };
  expect(laterSource.resultTemplates.final.title).toBe('Changed later');
  expect(frozen).toMatchObject({ quizRevision: 7, printTemplate: authored.printTemplate, defaultDesign: { textColor: '#fff' }, defaultAppearance: { backgroundOverlay: 30 }, resultTemplates: { final: { title: 'Winners', design: { accentColor: '#abc' } } } });
});

describe('event configuration', () => {
  test('accepts team limits and retains a nonbinding historical people limit', () => {
    expect(validateEventCapacity(validConfiguration)).toEqual([]);
    expect(validateEventConfiguration(validConfiguration)).toEqual([]);
    expect(validateEventCapacity({ ...validConfiguration, peopleCapacity: 1 })).toEqual([]);
  });

  test.each([
    [{ teamCapacity: 0 }, 'teamCapacity'],
    [{ peopleCapacity: 0 }, 'peopleCapacity'],
    [{ teamSizeMin: 0 }, 'teamSizeMin'],
    [{ teamSizeMin: 5, teamSizeMax: 4 }, 'teamSizeMax'],
    [{ teamSizeMax: 5 }, 'teamSizeMax'],
  ])('rejects malformed capacity configuration %o', (change, field) => {
    const issues = validateEventCapacity({ ...validConfiguration, ...change });
    expect(issues.some((item) => item.includes(field))).toBe(true);
  });

  test('permits retained team-size limits for publication without accepting new settings above four', () => {
    const request = { event: { ...validConfiguration, startsAt: validConfiguration.startsAt.toISOString(), teamSizeMax: 6 } };
    expect(() => requestedEventConfiguration(request)).toThrow('teamSizeMax');
    expect(requestedEventConfiguration(request, { allowLegacyTeamSize: true }).teamSizeMax).toBe(6);
    expect(() => requestedEventConfiguration({ event: { ...request.event, allowLegacyTeamSize: true } })).toThrow('teamSizeMax');
  });

  test('uses half-point integer units and dense ranking by default', () => {
    expect(defaultScoringConfiguration).toEqual({ unitScale: 2, rankingMode: 'dense', started: false });
  });
});

describe('event lifecycle', () => {
  test('limits normal edits, cancellation, archive, and relock explicitly', () => {
    expect(canMutateEvent('scheduled')).toBe(true);
    expect(canMutateEvent('live')).toBe(false);
    expect(canCancelEvent('live')).toBe(true);
    expect(canCancelEvent('completed')).toBe(false);
    expect(canArchiveEvent('cancelled')).toBe(true);
    expect(canArchiveEvent('ready')).toBe(false);
    expect(canLockQuiz('ready', false)).toBe(true);
    expect(canLockQuiz('ready', true)).toBe(false);
  });
});

describe('public event projection', () => {
  test('contains only the explicit public allowlist', () => {
    const projection = buildPublicEventProjection({
      ...validConfiguration,
      description: 'Veřejný popis večera',
      lifecycleStatus: 'ready',
      startsAt: 'timestamp',
      registrationStatus: 'scheduled',
      registrationPublished: false,
      acceptedTeams: 0,
      acceptedPeople: 0,
      registrationOpensAt: null,
      registrationClosesAt: null,
      revision: 3,
      updatedAt: 'updated',
    });
    expect(projection).toEqual({
      title: 'Filmový večer', startsAt: 'timestamp', timeZone: 'Europe/Prague',
      pricing: { mode: 'per-team', amountCzk: 350 },
      description: 'Veřejný popis večera', lifecycleStatus: 'ready',
      venueName: 'Kulturní dům', publicLocation: 'Hlavní sál',
      registrationStatus: 'scheduled', registrationPublished: false, availability: 'scheduled',
      teamSize: { min: 2, max: 4 }, revision: 3, updatedAt: 'updated',
      capacity: { teams: { accepted: 0, maximum: 20 }, people: { accepted: 0, maximum: 120 } },
      registrationWindow: { opensAt: null, closesAt: null },
    });
    expect(projection).not.toHaveProperty('quizAssignment');
    expect(JSON.stringify(projection)).not.toMatch(/answer|email|organizer|contact/iu);
  });
});

describe('quiz snapshot and advisory preflight summary', () => {
  test('stores optional editorial findings without claiming the snapshot passed review', () => {
    expect(buildQuizSnapshotMetadata(quiz, { blockerCount: 2, warningCount: 3 }, 'admin', 'now')).toMatchObject({ status: 'ready', preflight: { status: 'BLOCKED', blockerCount: 2, warningCount: 3 } });
  });

  test('builds immutable snapshot metadata for the exact quiz revision', () => {
    const metadata = buildQuizSnapshotMetadata(quiz, { blockerCount: 0, warningCount: 0 }, 'admin-1', 'now');
    expect(metadata).toMatchObject({
      status: 'ready', quizId: 'quiz-1', quizRevision: 7, slideCount: 1,
      roundCount: 1, questionCount: 1, createdBy: 'admin-1', createdAt: 'now',
      preflight: { status: 'READY', blockerCount: 0, warningCount: 0 },
    });
  });

  test('accounts for root, event, and public writes in the transaction budget', () => {
    expect(snapshotWriteCount(315, 23)).toBe(342);
  });
});


test('editorial drafts, missing answers and incomplete media do not gate technical navigation', () => {
  expect(() => assertPlayableQuizSource(2, [
    { position: 2, kind: 'video', isQuestion: true, authoringStatus: 'draft', correctAnswer: '', mediaSource: '' },
    { position: 1, kind: 'intro' },
  ])).not.toThrow();
});

test.each([
  [0, []], [1, []], [2, [{ position: 1, kind: 'intro' }]],
  [1, [{ position: 2, kind: 'intro' }]],
  [2, [{ position: 1, kind: 'intro' }, { position: 1, kind: 'question' }]],
  [1, [{ position: '1', kind: 'intro' }]], [1, [{ position: 1, kind: '' }]],
  [1, [{ position: 1, kind: 'info', hidden: true }]],
])('rejects an empty, inconsistent, ambiguous or entirely hidden source (%j)', (count, slides) => {
  expect(() => assertPlayableQuizSource(count, slides as Record<string, unknown>[])).toThrow();
});

test('hidden flags cannot hide question slides from technical navigation', () => {
  expect(() => assertPlayableQuizSource(1, [{ position: 1, kind: 'free', isQuestion: true, hidden: true }])).not.toThrow();
});
