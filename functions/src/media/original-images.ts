import { createHash } from 'node:crypto';
import { parseQuizAsset } from '@filmovy-kviz/quiz-domain';

const imageFields = ['questionImage', 'answerImage', 'backgroundImage'] as const;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Derive only the original of the currently attached import, never a legacy guess or newer quiz field. */
export function resolveOriginalImages(raw: Record<string, unknown>): Record<string, unknown> {
  const provenance = object(raw.driveImportProvenance), replacements = new Map<string, string>();
  for (const field of imageFields) {
    const asset = parseQuizAsset(raw[field]), receipt = object(provenance[field]), source = object(receipt.source);
    if (!asset || receipt.field !== field || source.type !== 'https-image' || source.kind !== 'image'
      || typeof receipt.importJobId !== 'string' || !/^[a-f0-9]{64}$/u.test(receipt.importJobId)
      || asset.assetId !== digest(['drive-asset-v1', receipt.importJobId])
      || receipt.sourceFingerprint !== digest({ type: 'https-image', kind: 'image', url: source.url }) || !Number.isSafeInteger(receipt.sourceQuizRevision)
      || (receipt.sourceQuizRevision as number) < 0 || typeof source.url !== 'string' || source.url.length > 4096) continue;
    try {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) continue;
      replacements.set(raw[field] as string, url.href);
    } catch { /* Preserve the existing asset when original provenance is unavailable or invalid. */ }
  }
  if (!replacements.size) return raw;
  const replace = (value: unknown) => typeof value === 'string' ? replacements.get(value) ?? value : value;
  const result = { ...raw };
  for (const field of imageFields) if (Object.hasOwn(raw, field)) result[field] = replace(raw[field]);
  // Imported slides can retain duplicate image references in their private legacy stream/designs.
  if (Array.isArray(raw.media)) result.media = raw.media.map((value: unknown) => {
    const media = object(value);
    if (media.kind !== 'image') return value;
    return Object.fromEntries(Object.entries(media).map(([key, entry]) => [key, ['source', 'url', 'value'].includes(key) ? replace(entry) : entry]));
  });
  for (const key of ['design', 'answerDesign']) if (Object.hasOwn(raw, key)) {
    const design = object(raw[key]);
    result[key] = Object.fromEntries(Object.entries(design).map(([field, value]) => [field, ['backgroundImage', 'logoImage'].includes(field) ? replace(value) : value]));
  }
  return result;
}
