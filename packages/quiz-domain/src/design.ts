import { parseQuizAsset } from './media-assets.js';
import { isSafeHttpUrl } from './presentation.js';

/** Sparse, bounded visual overrides. Unknown stored extensions never cross a public boundary. */
export interface SlideDesign {
  readonly projectorAnimations?: boolean;
  readonly backgroundColor?: string;
  readonly textColor?: string;
  readonly accentColor?: string;
  readonly backgroundImage?: string;
  readonly logoImage?: string;
  readonly backgroundOverlay?: number;
  readonly fontFamily?: 'sans' | 'serif' | 'display';
  readonly fontScale?: number;
  readonly textAlign?: 'left' | 'center' | 'right';
  readonly layout?: 'classic' | 'centered' | 'split' | 'image-first';
  readonly textWidth?: number;
  readonly mediaFit?: 'contain' | 'cover';
  readonly showLogo?: boolean;
  readonly showQuestionNumber?: boolean;
  readonly showRoundTitle?: boolean;
}
export interface ResultTemplate {
  readonly title?: string;
  readonly subtitle?: string;
  readonly design?: SlideDesign;
}
export interface ResultTemplates {
  readonly interim?: ResultTemplate;
  readonly final?: ResultTemplate;
}
export interface PrintTemplate {
  readonly title?: string;
  readonly instructions?: string;
  readonly footer?: string;
  readonly logoText?: string;
  readonly logoImage?: string;
  readonly accentColor?: string;
  readonly layout?: 'comfortable' | 'compact';
  readonly showLogo?: boolean;
}
export const printTemplateKeys = ['title', 'instructions', 'footer', 'logoText', 'logoImage', 'accentColor', 'layout', 'showLogo'] as const;
export const slideDesignKeys = ['backgroundColor', 'textColor', 'accentColor', 'backgroundImage', 'logoImage', 'backgroundOverlay', 'fontFamily', 'fontScale', 'textAlign', 'layout', 'textWidth', 'mediaFit', 'showLogo', 'showQuestionNumber', 'showRoundTitle', 'projectorAnimations'] as const;
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
export function safeDesignImage(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && (value === '' || parseQuizAsset(value) !== undefined || isSafeHttpUrl(value));
}
export function normalizeSlideDesign(value: unknown): SlideDesign {
  const data = record(value) ?? {}, result: Record<string, unknown> = {};
  for (const field of ['backgroundColor', 'textColor', 'accentColor']) if (typeof data[field] === 'string' && /^#(?:[a-f\d]{3}|[a-f\d]{6})$/iu.test(data[field])) result[field] = data[field];
  for (const field of ['backgroundImage', 'logoImage']) if (safeDesignImage(data[field])) result[field] = data[field];
  for (const [field, minimum, maximum] of [['backgroundOverlay', 0, 100], ['fontScale', .75, 1.5], ['textWidth', 35, 75]] as const) {
    const candidate = data[field];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= minimum && candidate <= maximum) result[field] = candidate;
  }
  for (const [field, allowed] of Object.entries({ fontFamily: ['sans', 'serif', 'display'], textAlign: ['left', 'center', 'right'], layout: ['classic', 'centered', 'split', 'image-first'], mediaFit: ['contain', 'cover'] })) if (typeof data[field] === 'string' && allowed.includes(data[field])) result[field] = data[field];
  for (const field of ['showLogo', 'showQuestionNumber', 'showRoundTitle', 'projectorAnimations']) if (typeof data[field] === 'boolean') result[field] = data[field];
  return result;
}
export function resolveSlideDesign(defaultDesign?: unknown, roundDesign?: unknown, slideDesign?: unknown, answerDesign?: unknown, answerRevealed = false): SlideDesign {
  return { ...normalizeSlideDesign(defaultDesign), ...normalizeSlideDesign(roundDesign), ...normalizeSlideDesign(slideDesign), ...(answerRevealed ? normalizeSlideDesign(answerDesign) : {}) };
}
export function normalizeResultTemplates(value: unknown): ResultTemplates {
  const source = record(value) ?? {}, result: Record<string, ResultTemplate> = {};
  for (const key of ['interim', 'final']) {
    const template = record(source[key]);
    if (!template) continue;
    result[key] = { ...(typeof template.title === 'string' ? { title: template.title.slice(0, 500) } : {}), ...(typeof template.subtitle === 'string' ? { subtitle: template.subtitle.slice(0, 2000) } : {}), ...(record(template.design) ? { design: normalizeSlideDesign(template.design) } : {}) };
  }
  return result;
}
export function normalizePrintTemplate(value: unknown): PrintTemplate {
  const data = record(value) ?? {}, result: Record<string, unknown> = {};
  for (const [field, maximum] of [['title', 120], ['instructions', 400], ['footer', 160], ['logoText', 40]] as const) if (typeof data[field] === 'string') result[field] = data[field].slice(0, maximum);
  if (safeDesignImage(data.logoImage)) result.logoImage = data.logoImage;
  if (typeof data.accentColor === 'string' && /^#(?:[a-f\d]{3}|[a-f\d]{6})$/iu.test(data.accentColor)) result.accentColor = data.accentColor;
  if (data.layout === 'comfortable' || data.layout === 'compact') result.layout = data.layout;
  if (typeof data.showLogo === 'boolean') result.showLogo = data.showLogo;
  return result;
}
export function mergeStoredPrintTemplate(current: unknown, input: PrintTemplate): Record<string, unknown> {
  const result = { ...record(current) };
  for (const key of printTemplateKeys) delete result[key];
  return { ...result, ...normalizePrintTemplate(input) };
}

/** A provided override replaces known fields while retaining private future extension data. */
export function mergeStoredDesign(current: unknown, input: SlideDesign): Record<string, unknown> {
  const result = { ...record(current) };
  for (const key of slideDesignKeys) delete result[key];
  return { ...result, ...normalizeSlideDesign(input) };
}

export function canHideInfoSlide(slide: { readonly kind: string; readonly isQuestion?: boolean; readonly roundId?: string }): boolean {
  return slide.isQuestion !== true && slide.roundId === undefined && ['intro', 'agenda', 'rules', 'thank-you', 'end', 'title', 'info'].includes(slide.kind.toLowerCase());
}
/** Legacy defaults are fallbacks; new design overrides are resolved separately. */
export function resolveLegacySlideAppearance(defaultAppearance: unknown, slide: { readonly backgroundImage?: unknown; readonly backgroundOverlay?: unknown; readonly imageLayout?: unknown; readonly presentation?: unknown; readonly media?: readonly unknown[] }): { backgroundImage: string; backgroundOverlay: number; imageLayout: 'split' | 'stacked' } {
  const defaults = record(defaultAppearance) ?? {}, presentation = record(slide.presentation) ?? {};
  const finiteOverlay = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(100, value) : undefined;
  const legacyBackground = slide.backgroundImage === undefined ? slide.media?.flatMap(item => {
    const media = record(item);
    if (media?.role !== 'background' || media.kind !== 'image') return [];
    const value = [media.source, media.value, media.url].find(source => typeof source === 'string');
    return typeof value === 'string' ? [value] : [];
  })[0] : undefined;
  return {
    backgroundImage: (typeof slide.backgroundImage === 'string' && slide.backgroundImage !== '' ? slide.backgroundImage : legacyBackground) ?? (typeof defaults.backgroundImage === 'string' ? defaults.backgroundImage : ''),
    backgroundOverlay: finiteOverlay(slide.backgroundOverlay) ?? finiteOverlay(presentation.backgroundOverlay) ?? finiteOverlay(defaults.backgroundOverlay) ?? 0,
    imageLayout: slide.imageLayout === 'stacked' || slide.imageLayout === 'split' ? slide.imageLayout : defaults.imageLayout === 'stacked' ? 'stacked' : 'split',
  };
}
/** Hidden standalone information retains its stored position and never alters game structure. */
export function visibleSlidePosition(slides: readonly { readonly position: number; readonly kind: string; readonly isQuestion?: boolean; readonly roundId?: string; readonly hidden?: boolean }[], current: number, direction: -1 | 1): number | undefined {
  return [...slides].filter(slide => (direction === 1 ? slide.position > current : slide.position < current) && !(slide.hidden === true && canHideInfoSlide(slide))).sort((a, b) => direction * (a.position - b.position))[0]?.position;
}
