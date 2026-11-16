import type { EditorQuiz, PreflightResult } from '@filmovy-kviz/quiz-domain';

export function snapshotWriteCount(slideCount: number, roundCount: number): number {
  return slideCount + roundCount + 4;
}

export function buildQuizSnapshotMetadata(
  quiz: EditorQuiz,
  preflight: Pick<PreflightResult, 'blockerCount' | 'warningCount'>,
  actorId: string,
  createdAt: unknown,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    status: 'ready',
    quizId: quiz.id,
    quizRevision: quiz.revision,
    quizTitle: quiz.title,
    description: quiz.description,
    ...(quiz.printTemplate ? { printTemplate: quiz.printTemplate } : {}),
    ...(quiz.defaultAppearance ? { defaultAppearance: quiz.defaultAppearance } : {}),
    ...(quiz.defaultDesign ? { defaultDesign: quiz.defaultDesign } : {}),
    ...(quiz.resultTemplates ? { resultTemplates: quiz.resultTemplates } : {}),
    slideCount: quiz.slideCount,
    roundCount: quiz.roundCount,
    questionCount: quiz.questionCount,
    preflight: {
      status: preflight.blockerCount > 0 ? 'BLOCKED' : preflight.warningCount > 0 ? 'READY_WITH_WARNINGS' : 'READY',
      blockerCount: preflight.blockerCount,
      warningCount: preflight.warningCount,
    },
    createdAt,
    createdBy: actorId,
  };
}
