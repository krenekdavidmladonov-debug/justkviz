# Whole-evening authoring and presentation

This change extends the existing editor, private slide stream, immutable event snapshots and public allowlist. It creates no second source for questions, answers, team names, scores or ranks.

## Authoring contract

`quizzes.defaultDesign` contains sparse visual defaults. A round header's `design` overrides those defaults for its round; a slide's `design` overrides the inherited values. Question `answerDesign` is merged only for explicit answer preview/reveal. The editor identifies inherited and local settings; resetting removes known local visual overrides and leaves question content intact. Unknown private extension fields survive edits but are not published.

Questions use fixed geometry in the shared editor, projector and offline renderer. Image questions keep the prompt, alternatives and revealed answer in the left column and the full picture in the right column. Empty picture slides and information slides with only a background image use the whole canvas for the photograph. Photo frames are transparent and preserve the native aspect ratio. The surrounding slide background remains visible.

Quiz, round, question and answer appearance controls still edit colors, background, logo, fonts and display metadata. The renderer bypasses their stored layout, alignment, width and crop overrides for questions. Existing snapshots and saved designs retain their data. Standalone authored content and result templates still have their applicable layout controls. The server validates saved settings.

Legacy quiz defaults and local image/overlay/layout values use a shared precedence resolver in authoring, practice and live publication. Full reset sends an explicit transient mutation intent to clear the legacy local appearance too; resetting an individual new design field does not clear unrelated legacy values. Direct answer reveal/hide stops active media and advances its generation so an old playback callback cannot restart or finish the newly displayed state.

Introduction, rules, automatic or manual agenda, round introductions, questions, recap headings, information/break slides and ending use the same slide renderer in the editor and projector. Information slides can be created, duplicated and moved without rewriting questions. Hiding is restricted to standalone non-question information kinds; game questions and round/recap structure cannot be hidden. The ordered stream remains stored, and live navigation skips hidden entries.

`resultTemplates.interim` and `.final` contain optional title, subtitle and design only. Their editor previews use the real result components with labelled sample rows. Actual publication always derives rows from reviewed event result versions. Library template edits do not alter an event's frozen snapshot or confirmed result history.

The quiz `printTemplate` is frozen with the event. It controls paper-specific copy, branding and spacing rather than reproducing a dark projector canvas. Player sheets and the privileged answer key remain separate output types.

Paper templates support comfortable (15.5 mm answer rows, each round on a fresh page) and compact (12 mm rows) layouts. Uploaded logos must be verified PNG/JPEG assets owned by the snapshot's source quiz; the server downloads the exact validated Storage generation. External logo URLs and WebP receive an actionable error. Print generation rechecks both current authorization and the event's unchanged snapshot assignment before returning bytes.

## Boundaries

- Quiz design/template saves use the existing metadata callable, expected revision and current membership/permission/scope checks.
- Answer appearance is private answer data. Users without answer permissions cannot read or replace it.
- Owned background/logo references use existing quiz asset validation and media permissions. Public access is limited to references in the current public publication, including result screens.
- Round designs are maintained in the existing derived round document for a bounded live read. Ordinary next/previous reads only the adjacent slide; additional reads happen only when skipping hidden information.
- The moderator preview consumes the public session payload. Private answers and notes stay in a separately labelled panel. Preview players do not duplicate projector playback.
- Saving scores never publishes results. Snapshot relock and scoring protections remain unchanged.
- Event detail displays the prepared quiz revision and offers an explicit library comparison. An ongoing event does not automatically load the source library or adopt its newer revision.

## Deliberate limits

Technical waiting, disconnected, unavailable and ended-session fallback screens are operational states, not authored slides. The authored ending and finale remain editable. Legacy unknown slide extensions remain preserved; unsupported legacy rendering is not converted into a new question type. Layout editing uses bounded templates, not an unrestricted drawing canvas. Overflow and contrast advice is nonblocking.

Result templates expose the layouts and controls applicable to results, with eight sample rows for table previews. They never author score rows. Fixed navigational labels, rank numbers and the answer label are interface/generated text; editable headings and supporting text surround the authoritative content. Existing truth/false questions remain supported, without introducing a second creation flow for that legacy question type.

Physical projector, venue audio and paper-print acceptance require actual equipment. Browser screenshots and generated PDF checks do not establish those physical results.

## Verification

Implementation commits: backend/domain `2050d94`, integrated web `4de0247`, final browser-discovered corrections `2067f9b`, on `codex/whole-evening-slide-design`. Local work does not imply a staging deployment.

The local gate passed `pnpm check`, 557 unit tests across 53 files, and 50 Firestore Rules emulator tests. A first unrestricted-parallel unit run hit one five-second SDK-import timeout; its isolated 31-test suite passed, and the complete run with four workers passed. The browser journey found and prompted a fix for the same-device parser rejecting explicitly revealed answer recap screens. Regression tests retain authoritative-only answer publication and rejection of unrevealed/private/media leaks. Final UI corrections also cover shorthand color inputs, a nonblocking image-background readability advisory, prompt hierarchy and moderator status wrapping. No Rules source changed.

The five specialists actually ran GPT-6.1 Sol with high reasoning in successive waves, with at most three workers beside the lead. The lead integrated UX/navigation, moderator controls, preview parity and event-version comparison, reviewed the shared boundaries and inspected rendered evidence.

The final integrated Chromium journey passed on `2067f9b` (2026-10-14, receipt `browser-integrated4-result.json`, 1.4 minutes of browser testing, no page errors). The remaining dirty files were the QA harness and documentation. It exercised design editing through the real UI, save/reopen, quiz/round/slide/answer inheritance, information slide create/duplicate/move/hide, forward/backward hidden-slide skipping, event snapshot freezing after later library edits, synthetic teams and scoring, media play/stop, explicit answer reveal/hide, result publication, confirmed-history reload and both authenticated PDF endpoints. Twelve actual anonymous public-document HTTP responses contained no pre-reveal answer, note or answer-image canaries. Known interim totals displayed 3/1 points and final totals 6/2 points, corresponding to stored half-points 6/2 and 12/4.

Actual screenshots cover 12 canonical kinds (including free-answer questions), explicit answer reveal, interim/finale screens, eight-row result-template previews, editor widths 1440/1366/390 and moderator widths 1366/390. The lead and viewer specialist reviewed the generated images; a clipped preview kicker in an earlier capture was caused by scroll position and is fully visible in the final top-of-pane capture. One immediate-after-resize full-page mobile capture showed an unpainted preview. A same-source `integrated5` rerun, which also passed the complete functional journey, scrolls the preview into view, verifies visible text and a decoded image, waits for paint and records geometry/styles. Its final mobile capture is populated and contained (372 × 209 px), accepted by both reviewers. No product change was needed for that capture issue. Flat bright image backgrounds remain a user-controlled contrast risk: the editor advises a visual check/overlay without blocking saving. Venue readability still requires real equipment.

Evidence is local and ignored by Git under `.local-data/whole-evening/`: final `check-final-channel-result.json`, `unit-final-channel-result.json`, unchanged-rules `rules-integration1-result.json`, `browser-integrated4-result.json`, `browser-integrated5-result.json`, plus `evidence/design-evidence.json`, `public-unrevealed-network.json`, `pdf-evidence.json`, `moderator-390-dom.json` and the PNG/PDF samples. Earlier failed runs are retained separately rather than represented as passing. No real quiz data was used or changed.

### Comparable local performance

Archived source `03476da` versus the integrated implementation, on the same machine, a 60-question synthetic quiz, production Vite preview and demo emulators. Times are milliseconds, medians. Cold browser means a fresh authenticated context with an empty browser cache; later contexts still benefit from an already started backend. Warm navigation reloads the document; selection/preview operate inside the open editor. These measurements are not V1 or staging latency claims.

The baseline archives the old web and Functions source. Both backend runs resolve the current shared domain dependency; the fixture deliberately contains only common legacy fields and no new design settings. This is a controlled comparison of those user flows, not a complete reproduction of an old release environment. Both performance runs used the same Playwright Chromium 1234 configuration; `browser-provenance.json` records paths, distribution version and executable hashes. Later visual-only corrections were followed by acceptance, not relabelled as a new performance measurement.

| Action | Samples | Before | After |
| --- | ---: | ---: | ---: |
| Fresh-browser admin | 3 | 188 | 178 |
| Fresh-browser editor | 3 | 297 | 290 |
| Warm admin navigation | 5 | 87 | 88 |
| Warm editor navigation | 5 | 264 | 277 |
| Select question | 24 | 77 | 79 |
| Switch to faithful preview | 24 | 39 | 38 |
| Edit and save all | 6 | 357 | 364 |
| Moderator Next to projector content | 12 | 402 | 434 |

Worst samples before/after: editor 2,503/2,449 ms, save 2,426/2,414 ms, live transition 2,094/2,134 ms. These include first callable/module startup. The added live metadata initially produced a 446 ms median; batching quiz/round metadata into one transaction read produced 434 ms in the follow-up. The remaining 32 ms difference and run-to-run selection variability are disclosed; no blanket speedup is claimed. Raw distributions and earlier runs are retained under `.local-data/whole-evening/evidence/performance-*.json`.

### Repeating acceptance

Use the repository's demo emulator setup and Node 22. With Auth, Firestore and Functions emulators available, run `pnpm test:e2e:whole-evening` or `pnpm test:e2e:whole-evening-performance`. The tracked preview helper makes a production web build with explicit demo configuration. Set `PLAYWRIGHT_EXECUTABLE_PATH` for the chosen Chromium binary. PDF acceptance needs Python with `pypdf` and Poppler; `WHOLE_EVENING_PYTHON` and `WHOLE_EVENING_PDFTOPPM` select their executable paths. The fixture rejects non-demo/nonlocal emulator connections and removes only the synthetic records it creates.

The print generator `node tools/pdf-qa/generate-whole-evening.mjs` uses the compiled renderer with synthetic data. Its five PDFs contain 18 rendered pages, including comfortable/compact player sheets, a private answer key, score table and long-text stress fixture. No physical printing or venue audio/projector test was performed.

The browser journey additionally fetched actual `team-sheets.pdf` (two pages) and `answer-key.pdf` (one page) from the local secured HTTP endpoint. Text extraction verified frozen template copy and the absence of private answers from player sheets; Poppler rendered all three pages for inspection.

## Owner trial and deployment state

After this version is made available in the chosen environment: open a quiz, edit its common appearance and one question/answer override, then save and reopen. Add an information slide and edit both result templates and print copy. Prepare a test event, inspect its frozen revision, open moderator/projector views, reveal an answer and try media. Add known scores, explicitly publish interim/final results, then inspect history and export player sheets. Changes to the library should leave the prepared event version intact.

No staging deployment or online acceptance was performed for this branch. Historical grants in this repository concern earlier frozen releases or expired temporary access. A current approval must identify this source version and the `filmovy-kviz-v2-staging` Hosting/Functions deployment; existing deployment safeguards and a fresh compatibility preflight still apply. This change requires no Rules/index change or data migration. Physical projector, venue sound and paper printing remain owner acceptance steps.
