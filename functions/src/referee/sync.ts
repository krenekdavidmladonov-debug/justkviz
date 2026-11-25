import { createHash } from 'node:crypto';
import { AggregateField, type CollectionReference, type Timestamp, type Transaction } from 'firebase-admin/firestore';

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

function version(time: Timestamp): string {
  // Lexicographic order, including changes committed in the same millisecond.
  return String(time.seconds).padStart(12, '0') + String(time.nanoseconds).padStart(9, '0');
}
const emptyVersion = '0'.repeat(21);

export function parseCursor(input: unknown) {
  if (typeof input !== 'string' || input.length !== 109) return;
  const match = /^([\w-]{43})\.(\d{21})\.([\w-]{43})$/u.exec(input);
  return match && { shape: match[1], version: match[2]!, metadata: match[3] };
}

type Row = { teamId: string; roundId: string; halfPoints: number | null; revision: number };
type Scores = { version: string; rows: { version: string; score: Row }[] };
type Cached = { count: number; sum: number; scores: Scores };
// The cache is optional. Cold instances derive the same delta from commit times.
// The aggregate includes cancelled teams and must stay on the server.
const cached = new Map<string, Cached>();

export async function currentScores(tx: Transaction, collection: CollectionReference, accepted: Set<string>, shape?: string): Promise<Scores> {
  let count = 0, sum: number | null = null;
  if (shape) {
    const aggregate = await tx.get(collection.aggregate({ count: AggregateField.count(), sum: AggregateField.sum('revision') }));
    ({ count, sum } = aggregate.data());
    // Every scoring writer advances a cell revision. Physical deletion/reset
    // advances the epoch, which is part of the shape. Clearing one cell advances its revision.
    const hit = cached.get(shape);
    if (hit && Number.isSafeInteger(sum) && hit.sum === sum && hit.count === count) return hit.scores;
  }
  const documents = await tx.get(collection.select('teamId', 'roundId', 'halfPoints', 'revision'));
  const scores: Scores = { version: emptyVersion, rows: [] };
  for (const document of documents.docs) {
    const data = document.data();
    if (!accepted.has(data.teamId as string)) continue;
    const updated = version(document.updateTime);
    if (updated > scores.version) scores.version = updated;
    scores.rows.push({ version: updated, score: { teamId: data.teamId as string, roundId: data.roundId as string,
      halfPoints: data.halfPoints as number | null, revision: data.revision as number } });
  }
  if (shape && sum !== null && Number.isSafeInteger(sum) && scores.rows.length <= 1000) {
    if (!cached.has(shape) && cached.size >= 32) cached.delete(cached.keys().next().value!);
    cached.set(shape, { count, sum, scores });
  }
  return scores;
}
