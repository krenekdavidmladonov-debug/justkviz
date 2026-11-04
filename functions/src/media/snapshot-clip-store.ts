import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { snapshotClipFingerprint, type SnapshotClipAssetCandidate } from './snapshot-clips.js';

/** Call only after event authorization, with the source quiz ID from the frozen snapshot root.
 * Reads immutable import receipts, never the current quiz's slides or answers.
 */
export async function loadSnapshotClipAssets(
  tx: Transaction, db: Firestore, quizId: string, slides: readonly Record<string, unknown>[],
  requestedAssetId?: string,
): Promise<readonly SnapshotClipAssetCandidate[]> {
  if (!/^[A-Za-z0-9_-]{1,150}$/u.test(quizId)) return [];
  const fingerprints = [...new Set(slides.map(snapshotClipFingerprint).filter((value): value is string => value !== undefined))];
  if (!fingerprints.length || fingerprints.length > 400) return [];
  const assets: { id: string; data: Record<string, unknown> }[] = [];
  if (requestedAssetId !== undefined) {
    if (!/^[a-f0-9]{64}$/u.test(requestedAssetId)) return [];
    const asset = await tx.get(db.doc(`quizzes/${quizId}/mediaAssets/${requestedAssetId}`));
    const data = asset.data();
    if (!data) return [];
    assets.push({ id: asset.id, data });
  } else for (let offset = 0; offset < fingerprints.length; offset += 30) {
    const result = await tx.get(db.collection(`quizzes/${quizId}/mediaAssets`)
      .where('privateProvenance.sourceFingerprint', 'in', fingerprints.slice(offset, offset + 30)).limit(201));
    if (result.size > 200 || assets.length + result.size > 200) return [];
    assets.push(...result.docs.map(doc => ({ id: doc.id, data: doc.data() })));
  }
  const ids = [...new Set(assets.map(asset => asset.data.importJobId)
    .filter((value): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)))];
  if (!ids.length) return [];
  const jobs = new Map((await tx.getAll(...ids.map(id => db.doc(`driveMediaJobs/${id}`)))).map(doc => [doc.id, doc.data()]));
  return assets.map(asset => ({ ...asset, job: jobs.get(String(asset.data.importJobId)) }));
}
