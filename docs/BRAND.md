# JustKvíz vector identity

The approved direction is a yellow speech bubble with a white J/yellow K monogram and the horizontal **JustKvíz** wordmark. The production artwork is constructed from clean vector paths, rather than the imperfect transparent bitmap generated during concept exploration.

## Master and exports

`packages/quiz-domain/src/brand-artwork.ts` is the shared, outlined geometry used by React and the PDF renderer. There are no external images, script, runtime font dependencies, or editable text inside the SVG exports. The acute accent is part of the outlined í. `tools/brand/generate.mjs` reproducibly builds the master and SVG exports using the repository's existing Noto Sans Black dependency plus custom J/monogram geometry. Run from the repository root with Node 22. Font attribution and the SIL Open Font License are included beside the exports.

Files in `apps/web/public/brand/`:

- `justkviz-dark.svg`: white/yellow logo for dark backgrounds.
- `justkviz-light.svg`: navy/deep gold logo for white backgrounds.
- `justkviz-mono.svg`: navy one-color logo for economical printing.
- `justkviz-white.svg`: white one-color logo for dark backgrounds.
- `justkviz-mark.svg`: standalone transparent monogram.
- `justkviz-icon.svg`: small icon with a navy backing for browser tabs.
- `justkviz-email.png`: raster export on navy, for email clients that do not support SVG.

Primary colors: navy `#0B1220`, yellow `#FFC107`, white `#F8FAFC`. The light-background export uses deep gold `#B87900` for clearer edges on white. Keep the logo proportions; never stretch individual letters. Leave clear space of at least half the mark's width around a standalone logo where possible. Use the standalone mark for small square icons; do not compress the full wordmark into a favicon.

## Application

The shared `Brand` component carries an accessible JustKvíz label and uses the same paths everywhere: public navigation, the public homepage's main heading, administration, error screens, projector/results and the referee interface. The homepage replaces the old two-line slogan and decorative question tile with the logo. Existing event browsing and registration behavior is unchanged.

Presentation canvases retain their established ink overrides, custom organizer logos, and hide-logo switches. Existing user-authored quiz/event/team names and text mentions of the product are not replaced with images. Print uses vector paths for the default brand while respecting user logos, custom logo text and grayscale settings. Email uses the static PNG with alt text; plain-text email stays readable without images.

The preview uses isolated synthetic event data. This change does not authorize deployment or email delivery; the owner reviews the preview before any live release.
