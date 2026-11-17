# Tomorrow release hardening audit

Audit date: 2026-09-02

Hardened implementation commit: `4d99ca2fbe2a0f7092a427a4a234f3e56c745833`

Decision: **TOMORROW RELEASE BLOCKED pending human acceptance and one content-ready quiz.** Deterministic code gates are green; no production deployment, merge, tag, or production Firebase connection was performed.

## Release composition

Recommended branch: `release/v0.2.0-tomorrow`.

Verified ancestry starts at PR #3 HEAD `3553844813badad613e3f97dbd14069910b2652d` and therefore contains migration, projector/live fixes, UX foundation, round-first editor, and quiz preflight. It adds only the local QA launcher plus release-hardening tests, documentation, and a PowerShell compatibility correction. `feature/events-foundation` is not an ancestor and is intentionally outside this release.

PR #3 was verified OPEN, mergeable/CLEAN, based on `main`, with GitHub Quality gate SUCCESS at the start of hardening.

## P0 / P1 / P2

- P0: 0 open deterministic findings.
- P1: direct PowerShell 7 launcher reuse/stop originally compared a parsed timestamp through localized string formatting. It now compares UTC ticks while retaining PID, command-line, role, token, and start-time identity checks. Both PowerShell 7 and the documented `.cmd` flow pass start/reuse/stop.
- P1 operational: the four untouched migrated quizzes still contain 172 blockers. A selected quiz must reach zero blockers before live use.
- P1 human acceptance: real YouTube playback and physical HDMI/projector/audio output remain unverified by automation.
- P2: the main production JS chunk is 845.89 kB (258.66 kB gzip) and retains the Rollup 500 kB warning. Routes, all built assets, lazy chunks, load, and function are unaffected in the measured local preview; no late code-splitting refactor is recommended.

## Deterministic evidence

- Node 22 frozen install: PASS.
- `pnpm check`: PASS.
- Unit/component/migration: 12 files, 122 tests PASS.
- Functions: 2 files, 27 tests PASS.
- Firestore Rules: 1 file, 15 tests PASS.
- Production Hosting preview: 7 direct-reload routes and 15 built assets PASS.
- Live emulator E2E: PASS, including answer secrecy, navigation, recap, media generation/state, and session end.
- Editor emulator E2E: PASS, including save/reload, explicit trusted mutations, round/question ordering, lossless legacy round trip, and denied direct writes.
- Synthetic browser E2E: 9 PASS, 2 migrated-data scenarios correctly skipped.
- Fresh migrated editor E2E: PASS across 4 quizzes, 315 slides, 23 rounds, 263 questions, 11 legacy PL records, and all 10 observed slide kinds.
- Fresh migrated browser E2E: 2 PASS; sanitized preflight found 172 blockers and 72 warnings without rendering answers, media sources, or `legacy.raw`.
- Migration inspect, validate, dry-run, emulator write, and independent readback: PASS.

Migration totals remain 4 quizzes, 315 slides, 23 rounds, 263 questions, 263 correct answers, 56 images, 52 audio, 46 video, 154 total media references, and 11 legacy PL questions. Unknown slide types and invalid media URLs: 0. No known data loss.

Critical security checks remain PASS: correct answers stay private until authoritative recap publication; crafted answer-bearing BroadcastChannel data rendered zero unauthorized answers; Firestore remains authority; normal AUDIO state withholds its source; direct client writes to private quiz data are denied; and `legacy.raw` is absent from public state.

## READY quiz strategy

Use the readiness UI and its semantic deep links; do not run automated content repair. The lowest-current-effort migrated candidate is the quiz with 5 rounds and 50 questions: 16 blockers (15 ANSWER, 1 TIMING) and 26 warnings. Fix blockers in this order: correct answer, clip timing, media source, required image, remaining structure. Save explicitly and rerun readiness after each batch.

The release requirement is zero blockers on the saved revision. A media quiz will normally finish as `READY_WITH_WARNINGS` because static checks cannot certify YouTube availability; that is operationally acceptable only after the warning acknowledgement and the real-media checklist in `TOMORROW_RELEASE_CHECKLIST.md`.

## Exact merge and tag plan

1. Commit the reviewed hardening changes on `release/v0.2.0-tomorrow` and rerun the full deterministic gate on that exact tip.
2. With explicit approval, push only this branch and open one PR to `main`. Do not include or merge `feature/events-foundation`.
3. Run GitHub CI and perform the human YouTube plus physical venue checklist on the exact PR SHA.
4. When both human acceptance and a zero-blocker saved quiz are recorded, close PR #3 as superseded by the combined release PR; do not merge PR #3 separately.
5. Merge only the combined release PR after explicit approval. Do not deploy as part of the merge.
6. After the reviewed merge commit is on `main`, create tag `v0.2.0-tomorrow` only with explicit approval.

Outside this release: Events Foundation, registrations, scoring, referee QR, leaderboard, results, PDF, email, offline subsystem, Storage workflow, redesign, and new question types.
