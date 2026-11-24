import { beforeEach, expect, it, vi } from 'vitest';
import { createQuizSlide, updateQuizMetadata, updateQuizSlide } from '../apps/web/src/features/editor/editorApi';
import type { EditorSlide, SlideDesign } from '../apps/web/src/features/editor/types';

const transport = vi.hoisted(() => ({ callable: vi.fn(), invoke: vi.fn(), functions: { synthetic: true } }));
vi.mock('firebase/functions', () => ({ httpsCallable: transport.callable, FunctionsError: class extends Error {} }));
vi.mock('../apps/web/src/services/firebase/client', () => ({ getFirebaseServices: () => ({ functions: transport.functions }) }));

const legacyDesign: SlideDesign = Object.freeze({
  backgroundColor: '#112233', textColor: '#ffffff', accentColor: '#aabbcc',
  backgroundImage: 'quiz-asset:synthetic-quiz/' + 'a'.repeat(64), logoImage: '',
  backgroundOverlay: 35, fontFamily: 'serif', fontScale: 1.25, textAlign: 'right',
  layout: 'split', textWidth: 65, mediaFit: 'cover', showLogo: false,
  showQuestionNumber: true, showRoundTitle: false,
});

const draft = (patch: Partial<EditorSlide> = {}): EditorSlide => ({
  id: 'synthetic-slide', position: 2, kind: 'free', storedKind: 'free', isQuestion: true,
  title: '', text: 'Syntetická otázka', options: [], correctAnswer: 'Syntetická odpověď',
  moderatorNote: '', media: [], hasLegacyData: false, backgroundImage: '', questionImage: '',
  answerImage: '', mediaSource: '', backgroundOverlay: null, clipStartSeconds: null, clipEndSeconds: null,
  presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null },
  ...patch,
});

const save = (operation: 'create' | 'update', slide: EditorSlide) => operation === 'create'
  ? createQuizSlide('synthetic-quiz', 7, 2, slide)
  : updateQuizSlide('synthetic-quiz', 7, slide);

beforeEach(() => {
  vi.clearAllMocks();
  transport.callable.mockReturnValue(transport.invoke);
  transport.invoke.mockResolvedValue({ data: { quizId: 'synthetic-quiz', revision: 8, slideCount: 2, questionCount: 1, roundCount: 1 } });
});

it.each((['create', 'update'] as const).flatMap(operation => [true, false].map(flag => [operation, flag] as const)))('omits only the animation flag on %s with projectorAnimations=%s without changing the draft', async (operation, flag) => {
  const design = Object.freeze({ ...legacyDesign, projectorAnimations: flag });
  const answerDesign = Object.freeze({ ...legacyDesign, textColor: '#ddeeff', projectorAnimations: !flag });
  const slide = Object.freeze(draft({ design, answerDesign }));
  const before = structuredClone(slide);
  await save(operation, slide);
  expect(transport.callable).toHaveBeenCalledExactlyOnceWith(transport.functions, operation === 'create' ? 'createQuizSlide' : 'updateQuizSlide', undefined);
  const outgoing = transport.invoke.mock.calls[0]![0] as { expectedRevision: number; slide: Record<string, unknown> };
  expect(outgoing.expectedRevision).toBe(7);
  expect(outgoing.slide.design).toEqual(legacyDesign);
  expect(outgoing.slide.answerDesign).toEqual({ ...legacyDesign, textColor: '#ddeeff' });
  expect(outgoing.slide).toMatchObject({ text: slide.text, correctAnswer: slide.correctAnswer, options: slide.options, media: slide.media, presentation: slide.presentation });
  expect(slide).toEqual(before);
  expect(slide.design).toBe(design);
  expect(slide.answerDesign).toBe(answerDesign);
});

it.each(['create', 'update'] as const)('preserves absent, explicitly empty and animation-only designs on %s', async operation => {
  const slideWithoutDesign = draft();
  await save(operation, slideWithoutDesign);
  const absent = transport.invoke.mock.calls[0]![0] as { slide: Record<string, unknown> };
  expect(absent.slide).not.toHaveProperty('design');
  expect(absent.slide).not.toHaveProperty('answerDesign');

  const empty = Object.freeze({});
  await save(operation, draft({ design: empty, answerDesign: empty }));
  const explicit = transport.invoke.mock.calls[1]![0] as { slide: Record<string, unknown> };
  expect(explicit.slide).toMatchObject({ design: {}, answerDesign: {} });
  expect(Object.keys(explicit.slide.design as object)).toEqual([]);
  expect(Object.keys(explicit.slide.answerDesign as object)).toEqual([]);

  await save(operation, draft({ design: { projectorAnimations: true }, answerDesign: { projectorAnimations: false } }));
  const animationOnly = transport.invoke.mock.calls[2]![0] as { slide: Record<string, unknown> };
  expect(animationOnly.slide).toMatchObject({ design: {}, answerDesign: {} });
  expect(Object.keys(animationOnly.slide.design as object)).toEqual([]);
  expect(Object.keys(animationOnly.slide.answerDesign as object)).toEqual([]);
});

it.each([true, false])('retains projectorAnimations=%s in quiz defaultDesign metadata', async flag => {
  const defaultDesign = Object.freeze({ ...legacyDesign, projectorAnimations: flag });
  await updateQuizMetadata('synthetic-quiz', 7, 'Syntetický kvíz', '', undefined, defaultDesign);
  expect(transport.callable).toHaveBeenCalledExactlyOnceWith(transport.functions, 'updateQuizMetadata', undefined);
  expect(transport.invoke).toHaveBeenCalledExactlyOnceWith({
    quizId: 'synthetic-quiz', expectedRevision: 7,
    quiz: { title: 'Syntetický kvíz', description: '', defaultDesign },
  });
  expect(defaultDesign).toEqual({ ...legacyDesign, projectorAnimations: flag });
});
