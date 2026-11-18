import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { promptImagePlan } from './publication.js';
import type { PrivateLiveSession } from './types.js';

type Plan = ReturnType<typeof promptImagePlan>;
const snapshots = new Map<string, { storedAt: number; plan: Plan }>();
const maximumSnapshots = 8, maximumAgeMs = 5 * 60 * 1000;

/** Caches derived immutable prompt structure only. Callers still authorize the current session/event. */
export async function loadUpcomingImages(db: Firestore, transaction: Transaction, session: PrivateLiveSession): Promise<readonly string[]> {
  if (session.status !== 'active' || session.presentationMode !== 'slide' || session.answerRevealed || session.interimResults || session.finalReveal?.visible) return [];
  const now = Date.now();
  for (const [key, item] of snapshots) if (now - item.storedAt >= maximumAgeMs) snapshots.delete(key);
  const key = session.snapshotId ? session.quizId + ':' + session.snapshotId : undefined;
  let plan = key ? snapshots.get(key)?.plan : undefined;
  if (!plan) {
    const rootRef = db.collection(session.snapshotId ? 'quizSnapshots' : 'quizzes').doc(session.snapshotId ?? session.quizId);
    const [root, slides] = await Promise.all([transaction.get(rootRef), transaction.get(rootRef.collection('slides').limit(401))]);
    const data = root.data();
    if (!data || (session.snapshotId && (data.quizId !== session.quizId || data.status !== 'ready'))) return [];
    plan = promptImagePlan(session.quizId, data, slides.docs.map(doc => ({ id: doc.id, data: doc.data() })));
    if (key && slides.docs.length <= 400) {
      snapshots.set(key, { storedAt: now, plan });
      while (snapshots.size > maximumSnapshots) snapshots.delete(snapshots.keys().next().value!);
    }
  }
  return [...new Set(plan.filter(slide => slide.position > session.currentSlidePosition).slice(0, 3).flatMap(slide => slide.images))].slice(0, 9);
}
