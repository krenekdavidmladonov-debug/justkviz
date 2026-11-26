import { youtubeVideoId } from './presentation.js';

export interface AnswerYoutubeClip {
  readonly videoId: string;
  readonly startSeconds?: number;
  readonly endSeconds?: number;
}

/** An answer clip has no external URL or unvalidated ancillary fields. */
export function parseAnswerYoutubeClip(value: unknown): AnswerYoutubeClip | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const clip = value as Record<string, unknown>;
  if (Object.keys(clip).some(key => !['videoId', 'startSeconds', 'endSeconds'].includes(key))
    || typeof clip.videoId !== 'string' || !/^[\w-]{11}$/u.test(clip.videoId)) return undefined;
  for (const field of ['startSeconds', 'endSeconds']) {
    const seconds = clip[field];
    if (seconds !== undefined && (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > 86_400)) return undefined;
  }
  if (clip.endSeconds !== undefined && (clip.endSeconds as number) <= ((clip.startSeconds as number | undefined) ?? 0)) return undefined;
  return { videoId: clip.videoId,
    ...(clip.startSeconds === undefined ? {} : { startSeconds: clip.startSeconds as number }),
    ...(clip.endSeconds === undefined ? {} : { endSeconds: clip.endSeconds as number }) };
}

export function answerYoutubeVideoId(source: string): string | undefined {
  try {
    const url = new URL(source.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return undefined;
    const host = url.hostname.toLowerCase().replace(/^www\./u, '');
    const parts = url.pathname.split('/').filter(Boolean);
    const id = host === 'youtu.be' && parts.length === 1 ? parts[0]
      : ['youtube.com', 'm.youtube.com'].includes(host)
        ? url.pathname === '/watch' ? url.searchParams.get('v') : parts.length === 2 && parts[0] === 'shorts' ? parts[1] : undefined
        : undefined;
    return id && /^[\w-]{11}$/u.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export function answerYoutubeMatchesPublicMedia(clip: AnswerYoutubeClip, slide: {
  readonly mediaSource?: string;
  readonly media?: readonly { readonly role: string; readonly source: string }[];
}): boolean {
  if (slide.mediaSource && youtubeVideoId(slide.mediaSource) === clip.videoId) return true;
  return slide.media?.some(item => (item.role === 'prompt' || item.role === 'background')
    && youtubeVideoId(item.source) === clip.videoId) ?? false;
}
