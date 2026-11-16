import { brand, brandArtwork } from '@filmovy-kviz/quiz-domain';

/** Shared outlined artwork: scales cleanly without downloading or substituting fonts. */
export function Brand() {
  return <span className="brand-wordmark"><svg viewBox={`0 0 ${brandArtwork.viewBox.width} ${brandArtwork.viewBox.height}`} role="img" aria-label={brand.name} focusable="false"><title>{brand.name}</title>{brandArtwork.paths.map((path, index) => <path key={index} d={path.d} fill={path.ink === 'primary' ? 'var(--brand-ink, #F8FAFC)' : 'var(--brand-accent, #FFC107)'} />)}</svg></span>;
}
