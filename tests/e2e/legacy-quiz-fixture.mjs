import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';

// Older libraries can contain an empty draft. Scenario fixtures with a prescribed
// slide stream start from this historical record and use the real editor mutations.
export async function seedEmptyQuiz(db, title, { uid = 'synthetic-author', quizId, fingerprint } = {}) {
  const { projectId } = requireFullEmulatorEnvironment(process.env, 'Legacy quiz fixture');
  if (db.projectId !== projectId) throw new Error('Legacy quiz fixture requires the configured demo database.');
  const quizzes = db.collection('quizzes');
  const ref = quizId ? quizzes.doc(quizId) : quizzes.doc();
  const now = new Date();
  await ref.create({
    schemaVersion: 1, title, description: '', status: 'draft', revision: 0, slideCount: 0, questionCount: 0, roundCount: 0,
    createdAt: now, updatedAt: now, createdBy: uid, updatedBy: uid,
    ...(fingerprint ? { creationFingerprint: fingerprint } : {}),
  });
  return { quizId: ref.id, revision: 0 };
}
