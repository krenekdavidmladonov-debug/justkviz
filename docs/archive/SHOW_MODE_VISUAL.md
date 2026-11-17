# SHOW MODE — visual proposal, phase 1

Three real React proposal screens live at `/show-mode-preview.html`. This is an isolated Vite development HTML entry with synthetic fixtures, not a production route or implemented scoring feature. Design approval is required before production implementation.

- `/show-mode-preview.html?scene=interim&capture=1`: an opaque surface overlay above a dimmed real question, six readable rows per page, score and movement from a fixture explicitly representing a previously confirmed publication.
- `/show-mode-preview.html?scene=finale&capture=1`: newly revealed third place plus already revealed lower places. No unrevealed first/second-place name or score is mounted in the DOM.
- `/show-mode-preview.html?scene=winner&capture=1`: signature winner typography with quiet yellow emphasis. Co-winner fixture preserves joint first place.

Capture canvases are proportional 16:9 at 1920×1080 and 1280×720. Add `&static=1` for motion-free capture. Without `capture=1`, the moderator prototype offers scene selection, pages, one-rank-at-a-time reveal (ties together), winner reveal, skip animation, static mode and return to the exact same question. The sound control is explicitly labelled unconnected; there is no simulated working playback.

For comparison only, `?scene=slide&capture=1` renders the unmodified question renderer and `?scene=baseline-results&capture=1` renders the existing `ResultsTable` with the same six fixture rows. These are baselines, not additional proposals.

## Identity and rendering

Identity comes directly from `apps/web/src/styles/theme.css`: background #0B1220, surface #111C2E, accent #FFC107, and the existing Inter/system stack. `Brand` is the repository's current typographic JustKvíz wordmark. No final logo artwork exists in the repository; `justkviz-jk-temporary.svg` is labelled a temporary monogram and is used only as the existing browser icon. No new logo, font download, gradients, particles, confetti or decorative 3D is introduced.

The backdrop uses the actual existing `SlideRenderer` with synthetic text, choices and safe appearance, without answer, answer explanation, image or media properties. No asset or media component mounts. Its transitive imports include existing media modules, but this entry does not initialize Firebase, subscribe to anything, fetch data, play audio, or invoke any server operation. The only requests are ordinary local Vite/module loading. The existing renderer is imported as-is; production components and renderer CSS are not modified. Inter is used if installed; the established system fallback remains available without network font loading.

## Motion

- Overlay opacity: 260 ms; panel translate/opacity: 360 ms.
- Table rows: 300 ms opacity/translation, 40 ms stagger for up to six visible rows.
- Rank/team reveal: 420 ms, 80 ms delay, small vertical movement.
- Winner name: 520 ms, 100 ms delay, subtle translation and 0.985→1 scale.
- No automatic rank advance or looping motion. Moderator actions drive each state.
- Skip animation immediately removes current CSS animation. Static mode and `prefers-reduced-motion` remove animation throughout. Numbers do not count through invented intermediate scores.

## Production contract to retain after approval

The trusted server remains authoritative for ranks, integer `halfPoints`, tie groups, publication baseline, reveal state and page. Czech scores are formatted from `halfPoints / 2`. Prototype dense ranking is 1/2/2/3, with tied rows revealed together. A future projector receives only its explicitly revealed/page subset; never ship a full final table and conceal names with CSS, DOM attributes or local state. The full synthetic fixture here exists only to exercise the local prototype controls and is not a proposed public data shape.

A future interim backdrop must be a server-published sanitized current slide, not an admin/private slide document. Correct answers and answer assets must remain absent until an explicit reveal. Returning from the overlay resumes the unchanged slide. The phase-1 prototype intentionally has no production publication, persistence, authorization or audio integration.
