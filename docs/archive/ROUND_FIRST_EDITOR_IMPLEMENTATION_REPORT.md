# Round-first editor implementation report

## Status

**ROUND-FIRST EDITOR READY**

Recommendation: **READY FOR HUMAN EDITOR REVIEW**

This report records sanitized evidence for `feature/round-first-editor`. It contains no raw V1 export, question text, option values, correct-answer values, moderator notes, contact details, secrets, or production configuration.

## Git scope

Base branch: `feature/ux-foundation`

Feature branch: `feature/round-first-editor`

Logical commits:

| Commit | Purpose |
| --- | --- |
| `4dd7745` | Add semantic quiz/round/question facade and trusted structural mutation model. |
| `aa7a3f9` | Add focused responsive editor workflow, type-specific forms, explicit Save, and local preview. |
| `a8aeab2` | Add unit, emulator, browser, and migrated-data regression coverage. |
| `95020d2` | Document editor behavior, data boundaries, security, and follow-ups. |

The branch was pushed without force. It was not merged and no deployment was performed.

## Delivered product behavior

- Focused editor route with desktop Structure/Content/Preview layout and tablet/mobile panel navigation.
- Human quiz → rounds → questions outline derived from the private lossless stream.
- Opening screen, generated agenda, editable/default rules, round settings, and system recap nodes.
- Five creatable question types: Multiple choice, Free answer, Image, Audio, and Video.
- Existing legacy PL displayed and edited as a locked `Legacy: Pravda / Lež` type.
- Local round numbering and question numbering derived from authoritative order.
- Explicit Save and `Ctrl`/`Cmd` + `S`; no autosave.
- Dirty-navigation modal for outline, route, editor Back, and normal browser Back transitions.
- Local draft preview through the existing shared `SlideRenderer` without public publication.
- Private answer-preview toggle, off by default.
- Human media timing input, current-time capture, duration, and private moderator test player.
- Revision-checked question and round update, create, duplicate, reorder, move, and remove operations.
- Safe non-empty round removal with explicit move/delete/cancel semantics.
- Inline validation and selected-content readiness summary.

## Data model result

The editor does not replace or destructively rewrite migrated slide records. `quizzes/{quizId}/slides` remains the authoritative private source for global presentation order. The round-first model is derived for the UI, while trusted transactions refresh known nested round/question projections after structural mutations.

Known fields receive validated patches. Unknown fields, future/malformed values left untouched, unedited media data, presentation extensions, `legacy.raw`, and private correct answers remain preserved. Unknown semantics are not guessed.

## Migrated-data verification

The complete offline V1 library was validated only against a local `demo-*` emulator:

| Metric | Verified |
| --- | ---: |
| Quizzes | 4 |
| Source slides | 315 |
| Rounds | 23 |
| Questions | 263 |
| Preserved correct answers | 263 |
| Image references | 56 |
| Audio references | 52 |
| Video references | 46 |
| Legacy PL questions | 11 |
| Observed source kinds represented | 10 |

All four quizzes opened in the round-first editor. Each quiz completed a safe edit → Save → reload → verify → restore cycle. Representatives of all observed kinds completed private round-trip verification. The independent emulator verifier passed afterward.

## Responsive and performance result

Browser QA passed at:

- `1280x720` — simultaneous outline, form, and sticky preview;
- `1024x768` — outline plus practical Content/Preview navigation;
- `390x844` — Structure/Content/Preview tabs and touch-sized actions.

The largest migrated quiz contained 91 source rows. Initial load, first/last question switching, repeated edits, preview refresh, and repeated direct semantic lookups completed without a detected behavioral regression. Virtualization was not needed at the current scale.

## Quality gate result

| Gate | Result |
| --- | --- |
| TypeScript | PASS |
| ESLint | PASS |
| Production build | PASS; existing Rollup chunk-size warning only |
| Unit/component | PASS — 100 tests |
| Functions | PASS — 27 tests |
| Firestore Rules | PASS — 15 tests |
| V1 inspect | PASS |
| V1 validate | PASS |
| V1 dry run | PASS |
| Emulator migration write/read-back verification | PASS |
| Live emulator E2E | PASS |
| Editor emulator E2E | PASS |
| Browser E2E | PASS — 4 tests |
| Migrated editor emulator E2E | PASS |
| Migrated editor browser E2E | PASS — 1 test |

## Security regression result

- No unauthorized correct-answer render was observed.
- Public/projector clients retained no private quiz read path.
- Firestore remained authoritative for answer publication.
- Direct browser writes to private quiz data remained denied.
- Editor callables required `admin`; moderator remained read-only.
- Normal Audio continued to withhold its source from the projector.
- Video fallback and player lifecycle tests passed.
- BroadcastChannel remained a strictly parsed sanitized fast path.
- Editor and local draft preview performed no `publicSessions` writes.
- `.local-data/` remained Git-ignored.
- No production Firebase project was contacted and no deploy occurred.

## Intentional follow-ups

These are not blockers for human editor review:

1. Design an isolated same-device transport/route before showing an unsaved draft in a separate projector window.
2. Define publication requirements before implementing whole-quiz preflight.
3. Decide whether generated agenda content should synchronize authored legacy agenda slides.
4. Implement Storage upload/ownership/cleanup as a separate trusted media workflow.
5. Address final brand identity and unrelated event/scoring/registration product phases separately.

The authoritative follow-up list is [UX_IMPLEMENTATION_FOLLOWUPS.md](UX_IMPLEMENTATION_FOLLOWUPS.md).

## Release boundary

Human review may evaluate the editor UX and report findings. Merge, Firebase deployment, any production connection, and changes to projector/publication security remain separate explicitly authorized actions.
