import { parseQuizAsset } from './media-assets.js';
import { youtubeVideoId } from './presentation.js';

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Private read model only. Public publication requires a separate revealed play choice. */
export function originalYoutubeSource(slide: { readonly mediaSource?: unknown; readonly originalMediaSource?: unknown; readonly driveImportProvenance?: unknown }): string | undefined {
  const current = typeof slide.mediaSource === 'string' ? slide.mediaSource : '';
  const direct = youtubeVideoId(current);
  if (direct) return `https://www.youtube.com/watch?v=${direct}`;
  if (!parseQuizAsset(current)) return undefined;
  const mapped = typeof slide.originalMediaSource === 'string' ? youtubeVideoId(slide.originalMediaSource) : undefined;
  if (mapped) return `https://www.youtube.com/watch?v=${mapped}`;
  const provenance = object(object(slide.driveImportProvenance).mediaSource);
  const source = object(provenance.source);
  const id = typeof source.videoId === 'string' && /^[\w-]{11}$/u.test(source.videoId) ? source.videoId : undefined;
  return provenance.field === 'mediaSource' && source.type === 'youtube' && id ? `https://www.youtube.com/watch?v=${id}` : undefined;
}
