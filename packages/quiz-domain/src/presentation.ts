import type { SemanticRound } from './semantic.js';
import type { EditorSlide } from './types.js';

type AgendaRound = Pick<SemanticRound, 'title'> & Partial<Pick<SemanticRound, 'id' | 'slides' | 'settingsSlide'>>;
type AgendaSlide = Pick<EditorSlide, 'id' | 'position' | 'kind' | 'roundId' | 'isQuestion' | 'hidden' | 'title' | 'text'>;

export function generatedAgendaOptions(rounds: readonly AgendaRound[], slides?: readonly AgendaSlide[]): readonly string[] {
  const roundLabel = (title: string, index: number) => `${index + 1}. KOLO${title.trim() === '' ? '' : ` – ${title.trim()}`}`;
  if (slides === undefined) return rounds.map((round, index) => roundLabel(round.title, index));
  const ordered = [...slides].sort((left, right) => left.position - right.position);
  const anchors = new Map<string, AgendaRound>();
  for (const round of rounds) {
    const id = round.settingsSlide?.id ?? round.slides?.[0]?.id ?? ordered.find(slide => slide.roundId === round.id && round.id !== undefined)?.id;
    if (id !== undefined) anchors.set(id, round);
  }
  if (rounds.length > 0 && anchors.size === 0) return rounds.map((round, index) => roundLabel(round.title, index));
  const openingId = ordered.find(slide => slide.roundId === undefined && !slide.isQuestion && slide.kind === 'intro')?.id;
  const options: string[] = [];
  let roundIndex = 0;
  for (const slide of ordered) {
    const round = anchors.get(slide.id);
    if (round !== undefined) {
      options.push(roundLabel(round.title, roundIndex++));
    } else if (slide.roundId === undefined && !slide.isQuestion && slide.hidden !== true && slide.id !== openingId
      && ['info', 'title', 'intro'].includes(slide.kind)) {
      const title = slide.title.trim() || slide.text.trim() || (slide.kind === 'info' ? 'Informační snímek' : 'Titulní snímek');
      options.push(title.slice(0, 1_000));
    }
  }
  return options;
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function youtubeVideoId(source: string): string | undefined {
  const trimmed = source.trim();
  if (/^[\w-]{11}$/u.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (!isSafeHttpUrl(trimmed)) return undefined;
    const host = parsed.hostname.toLowerCase().replace(/^www\./u, '');
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id && /^[\w-]{11}$/u.test(id) ? id : undefined;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      const candidate = parsed.searchParams.get('v')
        ?? (['embed', 'shorts', 'live'].includes(pathParts[0] ?? '') ? pathParts[1] : undefined);
      return candidate && /^[\w-]{11}$/u.test(candidate) ? candidate : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Direct file sources only, never HTML/iframe input or a server-side URL proxy. */
export function directMediaKind(source: string): 'audio' | 'video' | undefined {
  if (!isSafeHttpUrl(source)) return undefined;
  const path = new URL(source).pathname.toLowerCase();
  if (/\.(mp3|wav|ogg|m4a)$/.test(path)) return 'audio';
  if (/\.(mp4|webm|ogv)$/.test(path)) return 'video';
  return undefined;
}
