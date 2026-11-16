import { createHash } from 'node:crypto';
import { originalYoutubeSource, parseQuizAsset } from '@filmovy-kviz/quiz-domain';

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Bind private provenance to the currently attached immutable import output. */
export function verifiedOriginalYoutubeSource(data: Record<string, unknown>): string | undefined {
  const asset = parseQuizAsset(data.mediaSource);
  const { originalMediaSource, ...source } = data; void originalMediaSource;
  if (!asset) return originalYoutubeSource(source);
  const provenance = object(object(data.driveImportProvenance).mediaSource);
  if (typeof provenance.importJobId !== 'string' || !/^[a-f0-9]{64}$/u.test(provenance.importJobId)) return undefined;
  const assetId = createHash('sha256').update(JSON.stringify(['drive-asset-v1', provenance.importJobId])).digest('hex');
  return asset.assetId === assetId ? originalYoutubeSource(source) : undefined;
}
