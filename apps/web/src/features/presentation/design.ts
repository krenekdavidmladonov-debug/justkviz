import { normalizeSlideDesign, type SlideDesign } from '@filmovy-kviz/quiz-domain';
import type { CSSProperties } from 'react';

const fonts = {
  sans: 'Inter, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  display: '"Arial Black", Impact, sans-serif',
} as const;

export const rendererDefaults = {
  backgroundColor: '#101722', textColor: '#fbf8f0', accentColor: '#f3b33d',
  backgroundOverlay: 0, fontFamily: 'sans', fontScale: 1, textAlign: 'left',
  layout: 'classic', textWidth: 55, mediaFit: 'contain', showLogo: true,
  showQuestionNumber: true, showRoundTitle: true, projectorAnimations: true,
} as const satisfies SlideDesign;

/** Native color inputs require six digits, while persisted designs also allow #rgb. */
export function colorInputValue(value: string): string {
  return /^#[0-9a-f]{3}$/i.test(value)
    ? '#' + value.slice(1).split('').map(channel => channel + channel).join('')
    : value;
}

/** The public and private preview renderer both consume the same bounded appearance. */
export function slideDesignStyle(value?: SlideDesign): CSSProperties {
  const design = normalizeSlideDesign(value) ?? {};
  return {
    ...(design.backgroundColor ? { background: design.backgroundColor } : {}),
    ...(design.textColor ? { '--slide-ink': design.textColor, '--slide-muted': design.textColor } : {}),
    ...(design.accentColor ? { '--slide-gold': design.accentColor } : {}),
    '--slide-scale': design.fontScale ?? 1,
    '--slide-text-width': `${design.textWidth ?? 55}%`,
    '--slide-text-ratio': `${design.textWidth ?? 55}fr`,
    '--slide-media-ratio': `${100 - (design.textWidth ?? 55)}fr`,
    '--slide-media-fit': design.mediaFit ?? 'contain',
    textAlign: design.textAlign ?? 'left',
    ...(design.fontFamily ? { fontFamily: fonts[design.fontFamily] } : {}),
  } as CSSProperties;
}
