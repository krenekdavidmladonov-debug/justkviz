# Events Foundation implementation report

## Result

Status: **READY FOR HUMAN REVIEW**

Branch `feature/events-foundation` is based directly on release candidate SHA `3553844813badad613e3f97dbd14069910b2652d`. PR #3 remains open and was not merged.

## Delivered scope

- trusted admin-only event create/update/cancel/archive Functions;
- revisioned event model with team and people capacities;
- shared web/server quiz-domain and preflight package;
- atomic immutable snapshot lock/relock for exact quiz revisions;
- server-derived event readiness;
- sanitized `publicEvents` replacement projection;
- deny-by-default event and snapshot Rules;
- minimal staff event list/create/detail/edit/quiz-lock UI;
- public safe event list;
- unit, Functions, Rules, emulator, and browser test coverage.

No registration, email, phone, waitlist, management token, team, referee QR, scoring write, leaderboard, result, PDF, or digital-answer feature was added.

## Verification

The complete gate ran on Node.js 22.23.2 and JDK 21, using only Firebase Emulator Suite with project ID `demo-filmovy-kviz-v2`:

| Gate | Result |
| --- | --- |
| Frozen-lockfile install | PASS |
| Typecheck, ESLint, production build | PASS |
| Unit/component/migration tests | PASS — 12 files, 131 tests |
| Functions-focused tests | PASS — 3 files, 39 tests |
| Firestore Rules tests | PASS — 1 file, 19 tests |
| Synthetic live emulator E2E | PASS |
| Synthetic editor emulator E2E | PASS |
| Synthetic events emulator E2E | PASS |
| Synthetic browser E2E | PASS — 11 passed, 2 migrated-only tests skipped as designed |
| Migration inspect, validate, dry-run | PASS |
| Fresh emulator migration and independent readback | PASS |
| Migrated editor emulator E2E | PASS |
| Migrated event lock E2E | PASS — all 4 blocked quizzes rejected |
| Migrated editor/preflight browser E2E | PASS — 2 passed |

Fresh migration verification preserved 4 quizzes, 315 slides, 23 rounds, 263 questions, 263 correct answers, and 154 media references. Readiness reported the unchanged historical 172 blockers and 72 warnings; no content was automatically repaired.

Existing live/projector, media, authoritative recap, editor, preflight, migration, Rules, correct-answer secrecy, legacy preservation, and `publicSessions` regression scenarios passed.

Known non-blocking findings: Vite retains its existing large-chunk warning and Firebase Emulator reports that the current `firebase-functions` dependency is behind the latest release. Dependency upgrades are deliberately excluded from this slice because they require a separate compatibility review.

Production Firebase access and deploy were not used. External YouTube playback, physical HDMI/projector operation, and subjective event UX remain human-QA items.
