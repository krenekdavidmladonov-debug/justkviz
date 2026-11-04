# JustKvíz: rebranding existing V2

## Vector logo update, 2026-10-16

The owner has selected the JK speech-bubble direction. The shared brand now uses outlined SVG artwork, including a permanent browser icon and exports for light/dark backgrounds and print. See [BRAND.md](BRAND.md) for the current assets and integration. The original rollout record below describes the earlier typographic placeholder and its historical approval scope; it does not authorize deployment of the vector logo update.

Public spelling is **JustKvíz**. This is the same application and data on the existing `filmovy-kviz-v2-staging` project, site and media bucket. The URL remains unchanged.

## Presentation

- `packages/quiz-domain/src/brand.ts` owns public name, JK monogram, description and optional author text. `apps/web/src/config/product.ts` retains the existing frontend configuration boundary and icon path.
- `Brand` is the shared typographic wordmark. There is no final supplied graphic logo. `justkviz-jk-temporary.svg` is a temporary JK favicon, not approved final artwork. CSS preserves the exact case inside existing uppercase projector captions.
- Existing public/admin navigation, login, projector captions, final/interim results and local launcher messages use the new name. No new watermark, page, navigation or footer was added. The optional author is not rendered in the wordmark, icon, page titles or projection.
- Browser titles use fixed route categories only: JustKvíz, Knihovna kvízů, Editor kvízu, Akce and Projekce. Private names, IDs, answer values and registration fragments never enter metadata.
- HTML title/description and application-name use JustKvíz. The baseline has no Open Graph/Twitter tags, apple-touch-icon, PWA manifest or service worker. No install identity, scope, start URL or cache-clearing mechanism was introduced.
- Existing PDF metadata changes to JustKvíz. The only affected deployed backend entry point is `generatePrintArtifact`, with the same HTTP contract and dependencies. Its release must use the deployed source as a baseline and verify that only the renderer and brand constant differ.
- `functions/src/email/templates.ts` changes the existing registration email brand. **NENASAZENO**: registration/team email functions remain excluded from the rollout and `VITE_ENABLE_TEAM_EMAIL=false` remains required for staging.

## Scope and release



## Deliberately retained names

- Project/site IDs, project number, appId, API config, web.app/firebaseapp.com addresses, authDomain and storage bucket.
- Repository URL/directory, package names and imports, Function names/regions, schema, document IDs, QR targets and existing links/tokens.
- localStorage/IndexedDB keys, projector window/channel identifiers, YouTube diagnostic identifiers and demo project IDs.
- User quiz/event/team/media titles, questions, answers, snapshots and synthetic fixture content, including film-themed titles.
- Historical reports, draft design/audit evidence, immutable release manifests, checksums and V1 references. They describe their original state rather than current branding.

Online QA must create only distinctly named new QA content, record exact document IDs and object generations, verify the pre-existing content fingerprint, and delete only that run's own records and exact uploaded generations. LOCAL / CI / ONLINE results are reported separately.
