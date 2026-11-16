# Round-first editor testing and local operations

## Safety prerequisites

Use only local Firebase emulators and a project ID beginning with `demo-`. Do not load service-account credentials, production configuration, or production exports.

Required tools:

- Node.js 22 or newer;
- pnpm 11;
- Java 21 recommended for current Firebase emulators;
- a Playwright-supported browser for browser QA.

Create the local web environment from the committed safe example:

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
pnpm install --frozen-lockfile
```

`.env.local` is uncommitted. The example enables emulators, uses `demo-filmovy-kviz-v2`, and disables non-demo Firebase projects.

Browser QA also needs an executable browser. Either install the lockfile-compatible Playwright Chromium once:

```powershell
pnpm exec playwright install chromium
```

or point Playwright at an already installed compatible Chrome/Chromium binary:

```powershell
$env:PLAYWRIGHT_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
```

The browser binary is an explicit machine prerequisite and is not installed by `pnpm install`.

## Local editor for human review

Terminal 1:

```powershell
pnpm emulators
```

Terminal 2:

```powershell
pnpm seed:emulators
pnpm dev
```

Open:

- application: `http://localhost:5173`;
- admin login: `http://localhost:5173/admin/login`;
- Emulator UI: `http://localhost:4000`.

Local admin credentials:

```text
admin@example.test
LocalQuiz123!
```

The seed commands fail closed unless the Auth/Firestore endpoints are local and the project is `demo-*`.

## Static and unit quality gate

```powershell
pnpm check
pnpm test:unit
pnpm test:functions
pnpm test:rules
```

`pnpm check` runs TypeScript checks, ESLint with zero warnings allowed, and the production build. `test:rules` manages its own Firestore Emulator lifecycle and should run while a manually started Emulator Suite is stopped to avoid a port conflict.

Unit/component coverage includes:

- intro, rounds, local question numbering, and recap nodes;
- exactly five creatable types and locked existing PL;
- Choice, Free, Image, Audio, and Video form behavior;
- 5/6-option preservation and correct-option consistency;
- timing parsing, formatting, duration, invalid ranges, and the narrow persisted-import save exception without weakening preflight;
- dirty/save/failure/navigation state;
- immediate local preview without public publication;
- preservation of unknown and legacy shapes, including the imported `0/0` timing sentinel;
- strict creation validation and deterministic retry identity;
- whole-quiz preflight severity, structure, answer, image, media/timing, PL, draft, and private-value exclusion rules.

## Synthetic emulator E2E

Start Auth, Firestore, Functions, and Hosting emulators in one terminal. Build/seed and run the suites from another:

```powershell
pnpm check
pnpm seed:emulators
pnpm test:e2e:live
pnpm test:e2e:editor
pnpm test:e2e:browser
```

The editor E2E verifies:

- anonymous and ordinary-user denial;
- moderator read-only access;
- admin callable access, including idempotent creation of one empty private draft;
- identical create-request retry and conflicting-title rejection;
- denial of direct client writes;
- stale revision rejection;
- create/update/duplicate/move/delete behavior;
- contiguous ordering and derived counters;
- round rename/duplicate/move/removal modes;
- preservation of legacy fields and the exact imported `0/0` timing storage shape;
- absence of editor writes to sentinel `publicSessions` and immutable snapshot documents.

Synthetic browser and script-based E2E use distinct quiz fixture IDs. This allows `live → editor → browser` and `browser → editor → live` to run against the same fresh emulator seed without a suite inheriting another suite's quiz revision.

The complete browser suite also protects projector media lifecycle, recap answer authority, focused-shell behavior, responsive editor behavior, and the preflight detail/editor/live-start workflow.

## Browser QA matrix

The round-first browser specification covers these viewports:

| Viewport | Expected layout |
| --- | --- |
| `1280x720` | Structure, Content, and sticky Preview together. |
| `1024x768` | Structure plus usable Content/Preview navigation. |
| `390x844` | Separate Structure, Content, and Preview tabs with touch-sized controls. |

The tested workflow includes:

- create a named empty quiz from the library, then add its first round and question and reopen it;
- open quiz and editor;
- select a round and questions;
- edit Free, Choice, Image, Audio, and Video drafts;
- verify immediate local preview;
- reject invalid media timing and capture current player time;
- create without autosave and then save explicitly;
- duplicate and reorder content;
- exercise dirty outline navigation and browser Back;
- preserve a failed/stale save draft and keep the human-readable error visible;
- open legacy PL and system recap;
- verify responsive panel availability.

Playwright attaches screenshots for the three requested viewports during the dedicated round-first test. The line reporter may not retain successful attachments outside its run output; DOM and semantic assertions are authoritative in automation.

## Offline migrated-data verification

The real V1 library input must remain under:

```text
.local-data/v1-export/library.json
```

Never commit, print, or upload it. Run the read-only migration checks first:

```powershell
pnpm migration:v1:inspect
pnpm migration:v1:validate
pnpm migration:v1:dry-run
```

Then use a fresh local emulator target only:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:GCLOUD_PROJECT = 'demo-filmovy-kviz-v2'
pnpm migration:v1:emulator
pnpm migration:v1:verify-emulator
pnpm seed:auth
pnpm test:e2e:editor-migrated
$env:MIGRATED_EDITOR_E2E = '1'
pnpm exec playwright test tests/browser/round-first-editor-migrated.spec.ts tests/browser/quiz-preflight-migrated.spec.ts --config playwright.config.ts
Remove-Item Env:MIGRATED_EDITOR_E2E
Remove-Item Env:FIRESTORE_EMULATOR_HOST
Remove-Item Env:GCLOUD_PROJECT
```

The writer refuses non-local Firestore endpoints, non-`demo-*` project IDs, and a target containing prior migration documents. If a run is interrupted, restart with a fresh emulator data directory rather than bypassing its guard.

The committed expected structural inventory is:

| Metric | Expected |
| --- | ---: |
| Quizzes | 4 |
| Source slides | 315 |
| Rounds | 23 |
| Questions | 263 |
| Preserved correct answers | 263 |
| Images | 56 |
| Audio references | 52 |
| Video references | 46 |
| Legacy PL questions | 11 |

Verification may compare answer presence and exact values in memory, but logs and committed reports must never print those values, full questions, notes, options, contacts, or raw documents.

For every migrated quiz the E2E contract is:

```text
open -> edit one safe field -> save -> reload -> verify -> restore
```

A sanitized imported fixture must additionally cover the historical `presentation.videoStart/videoEnd = 0/0` sentinel with top-level start `0` and no end. Editing an unrelated field twice must succeed across reloads without changing the answer, media array, `legacy.raw`, presentation timing, top-level timing-key presence, or immutable snapshot sentinel.

The independent emulator verifier must still pass afterward. The migrated browser suites verify that all four quizzes open through the real editor facade, all rounds/questions are accessible, PL is represented, the largest quiz remains responsive, and all 263 questions produce a sanitised readiness result without answer values, question copy, media URLs, notes, or raw legacy data in the report.

## Security regression checklist

Before editor review or merge, verify:

- no unauthorized correct-answer render;
- Firestore remains the answer/publication authority;
- BroadcastChannel accepts only sanitized next-revision public state;
- normal Audio sends no source to the projector;
- Video error fallback still returns to a safe question view;
- media generation/player lifecycle remains monotonic;
- recap publishes only one explicitly selected answer;
- Rules deny private quiz reads to public users and all direct quiz writes;
- editor operations create no `publicSessions` writes;
- `.local-data/`, `.env.local`, secrets, and raw export data are absent from Git.

## Performance checks

The supported migrated dataset currently contains 63–91 source rows per quiz. Test:

- initial open of the largest quiz;
- first-to-last and last-to-first question selection;
- repeated draft edits;
- preview updates;
- direct semantic lookup under repetition.

Virtualization is not a release requirement at this scale unless measurement shows a regression. A new mapper must not introduce an O(N-squared) scan per keystroke.

## Release evidence checklist

Record only pass/fail state and sanitized structural counts:

1. current branch and base;
2. logical commit list;
3. clean `git status`;
4. `git diff --check` and staged-diff review;
5. `git check-ignore .local-data`;
6. static/unit/Functions/Rules results;
7. migration inspect/validate/dry-run results;
8. synthetic live/editor/browser E2E results;
9. migrated writer/verifier/editor/browser results;
10. security regression result;
11. explicit statement that no merge, deploy, or production Firebase access occurred.

## Troubleshooting

### Emulator port is already in use

Stop the other local emulator process or use the already running suite. Do not redirect a command to a remote Firebase project.

### Rules tests fail to start

`pnpm test:rules` owns its Firestore emulator. Stop the manually running suite before executing it.

### Browser suite cannot reach the app

Confirm the built Hosting emulator is available at the configured `BROWSER_E2E_BASE_URL` (default `http://localhost:5000`) and that the Auth, Firestore, and Functions emulators are running and seeded.

### Migrated writer says the target is not empty

This is the expected safety guard. Start a fresh emulator target. Never add a production override and never delete or mutate the source export.

### A test would need private values in output

Change the assertion/reporting approach. Compare in process and print only IDs already allowed by the migration tooling, counts, kinds, and pass/fail summaries.
