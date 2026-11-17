# Release candidate audit: core editor v0.2

Audit date: 2026-09-02

Audited implementation branch: `feature/round-first-editor`

Audited implementation HEAD: `45f40e362e48f66781d610da859ead9ac52838df`

Decision: **RELEASE CANDIDATE READY**

This is a sanitized, local-only audit. No deployment, merge, tag, release branch, production Firebase connection, or production configuration change was performed. Every Firebase-backed test used the Emulator Suite with project ID `demo-filmovy-kviz-v2`.

## 1. Audited HEAD

The deterministic gate covers `45f40e3`. That commit contains two audit-time corrections on top of the previously published implementation tip `ba4a081`:

- `0e06b50` aligns architecture, live-session, data-model, and migration documentation with implemented behavior;
- `45f40e3` gives the round-first browser suite its own seeded fixture, removing a real cross-suite order dependency.

The release proposal should be cut from the final `feature/round-first-editor` tip that contains this report and those corrections. The report-only commit does not alter runtime behavior.

## 2. Git ancestry map

Verified with `merge-base --is-ancestor`, not inferred from branch names:

```text
feature/v1-migration-framework (bf11c18)
  -> main (6ed4704)
     -> feature/quiz-editor-v1 (88c2e5e)
        -> research/quiz-behavior-discovery (82f7f9e)
           -> feature/projector-behavior-foundation (e7990df)
              -> fix/projector-behavior-blockers (3195ea7)
                 -> fix/projector-recap-authority (ccc060b)
                    -> feature/ux-foundation (3a388d4)
                       -> feature/round-first-editor (45f40e3)
```

`main...feature/round-first-editor` is `0 / 24`: main has no commit absent from the candidate, and the candidate is 24 commits ahead at the audited implementation HEAD. The implementation chain is linear. `research/events-scoring-architecture` is intentionally divergent and is not an ancestor. `research/admin-editor-ux` contains a patch-equivalent copy of UX discovery documentation already present in the candidate; it contains no missing implementation.

## 3. Main versus candidate

The audited range changes 109 files with 12,552 insertions and 585 deletions. The integrated scope is:

- **AUTH:** the secure main authentication foundation remains intact; only local seed and brand-neutral shell refinements are added.
- **MIGRATION:** sanitized V1 behavior inventory and normalized, lossless media mapping.
- **QUIZ MODEL:** private lossless slides plus derived semantic rounds/questions and native video fields.
- **EDITOR:** admin-only revisioned callables, explicit save, semantic round-first facade, typed forms, ordering, duplication, movement, and guarded deletion.
- **LIVE:** trusted live-session lifecycle, serialized mutations, authoritative recap selection, and Czech operational states.
- **PROJECTOR:** dedicated black presentation surface, shared renderer, fullscreen fallback, allowlisted Firestore state, and safe same-device fast path.
- **MEDIA:** manual audio/video lifecycle, generation-based stale-event rejection, normalized sources, recap handling, and single-heavy-player budget.
- **SECURITY:** least-privilege Rules remain the browser boundary; sensitive mutations remain trusted callable operations.
- **UX:** centralized placeholder brand, admin shell, focused moderator shell, responsive layouts, semantic design tokens, and hidden technical detail.
- **TESTS/DOCS:** unit, component, Functions, Rules, emulator, browser, migration, operator, architecture, editor, and user documentation.

No required foundation exists only on a non-ancestor implementation branch.

## 4. Branch and PR supersession

- PR #2 / `feature/quiz-editor-v1` has no patch that is unique relative to the candidate. It is an exact ancestor and can be closed as superseded after the future release merge. It must not be merged separately.
- `feature/projector-behavior-foundation`, both projector fix branches, and `feature/ux-foundation` are ancestors and are superseded by the candidate for integration purposes.
- `feature/v1-migration-framework` is already contained by main and therefore by the candidate.
- `research/admin-editor-ux` is superseded as an implementation input; its only tip patch is equivalent to the discovery patch already in the candidate.
- `research/events-scoring-architecture` remains research-only and must not be merged into this release.

## 5. P0 findings

**0 open.** No confidentiality, production-safety, authorization, or known data-loss blocker was found.

## 6. P1 findings

**0 open.** One test-isolation defect was discovered during the audit: the original round-first browser test mutated the same seed fixture expected at revision zero by editor E2E. It was corrected in `45f40e3`, regression-tested in both suite orders, and is no longer an open finding.

## 7. P2/P3 observations

- **P2 / future:** the main Vite chunk still triggers the existing Rollup 500 kB warning. It did not grow relative to the immediate UX baseline, so it is not an RC blocker. Address it later with measured code splitting.
- **P2 / future:** the Functions emulator warns that `firebase-functions` `^6.4.0` is behind the latest release and that upgrading may be breaking. The current Node 22 build and all Functions/emulator tests pass; upgrade separately with focused regression work.
- **P3 / future:** one internal developer diagnostic namespace retains the historical repository name. It is not product-shell copy, is not user-visible, and renaming it would touch test/debug contracts without release value.

## 8. Migration verdict

**PASS — no known data loss.** Offline inspect, validate, dry-run, fresh emulator write, and independent emulator readback all passed on the audited HEAD.

| Metric | V1 before | V2 after / verified |
|---|---:|---:|
| Quizzes | 4 | 4 |
| Slides | 315 | 315 |
| Rounds | 23 | 23 |
| Questions | 263 | 263 |
| Correct answers | 263 | 263 |
| Images | 56 | 56 |
| Audio | 52 | 52 |
| Video | 46 | 46 |
| Media references | 154 | 154 |
| Legacy PL questions | 11 | 11 |

Unknown slide types: 0. Unknown fields reported by validation: 0. The 11 legacy PL questions remain losslessly preserved and are now understood by the editor as locked legacy Pravda/Lež records. Private answers and `legacy.raw` remain private.

The migrated-editor API suite opened all 4 quizzes, all 315 slides, 23 represented rounds, 263 questions, and all 10 observed slide kinds. It performed a safe save/reload/restore in every quiz and verified legacy preservation. The dedicated migrated browser test also passed.

## 9. Security verdict

**PASS.** Deterministic tests and code/document review confirm:

- anonymous and ordinary users cannot read private quizzes or sessions;
- projector answers appear only after authoritative Firestore publication;
- crafted answer-bearing BroadcastChannel state produced zero unauthorized renders across two projectors;
- BroadcastChannel carries a strictly parsed allowlisted projection and is only a latency fast path;
- ordinary AUDIO public state withholds the source, so the projector cannot mount a YouTube player;
- `legacy.raw` and moderator notes are absent from public projections;
- browser writes to private quizzes are denied by Rules, including staff clients;
- editor mutations require the admin claim in trusted callable Functions; moderator is read-only;
- local tools fail closed around emulator hosts and `demo-*` project IDs.

## 10. Projector and media verdict

**PASS for deterministic scope.** Covered behavior includes:

- manual PLAY, STOP, and REPLAY for audio and video;
- vinyl state only after confirmed PLAYING and cleanup on stop/end/error;
- no normal-audio iframe on the projector;
- video start/end semantics, stable question fallback on errors, and stale-generation event rejection;
- one active heavy player at most and zero after cleanup;
- dedicated named projector window, black initial/background state, reuse/focus behavior, and graceful fullscreen/popup fallback;
- authoritative recap selection with ordinary recap audio/video behavior preserved.

External YouTube behavior and physical projector output remain HUMAN QA, not deterministic PASS.

## 11. Round-first editor verdict

**PASS.** The candidate provides semantic Kvíz → Kola → Otázky navigation, exactly five creatable question types, locked legacy PL display/editing, explicit Save, dirty route and unload protection, a local draft preview through shared `SlideRenderer`, type-specific forms, required START and END values for audio/video question clips, separate IMAGE question/background fields, 5/6-option preservation, and lossless unknown/legacy fallback. Preview does not create or mutate `publicSessions`.

## 12. UX foundation verdict

**PASS for deterministic scope.** `QUIZ PLATFORM` is intentionally centralized placeholder branding. Admin and focused moderator shells use Czech operational copy, semantic tokens, responsive layouts, and collapsible technical detail. Revisions and internal IDs are not part of the ordinary workflow. Searches found no inappropriate hardcoded film brand in product-shell copy; historical repository titles and internal technical identifiers are not final-brand commitments.

Subjective editor usability and full visual acceptance remain HUMAN QA.

## 13. Clean-checkout verdict

**PASS.** A detached worktree was created at the audited commit with no `node_modules`, no emulator state, and no `.local-data` at entry. With Node `22.23.2`, pnpm `11.19.0`, Java 21, and the documented demo `.env.local` setup:

- `pnpm install --frozen-lockfile` passed with the lockfile unchanged and no downloads required from the populated local cache;
- build and all deterministic suites passed;
- the only extra input was the explicitly documented, ignored `.local-data/v1-export/library.json` for real-data migration tests;
- Playwright browser installation or `PLAYWRIGHT_EXECUTABLE_PATH` is now explicitly documented as a browser-test prerequisite;
- tracked status remained clean after install/build/test.

Host sandbox permission errors encountered by Firebase CLI access to its user-level config were rerun outside the filesystem sandbox; they were host tooling constraints, not repository failures.

## 14. Full quality gate

All final deterministic gates passed:

| Gate | Result |
|---|---|
| Frozen-lockfile install | PASS |
| Typecheck + ESLint + production build (`pnpm check`) | PASS |
| Unit/component/migration tests | PASS — 10 files, 100 tests |
| Functions tests | PASS — 2 files, 27 tests |
| Firestore Rules tests | PASS — 1 file, 15 tests |
| Migration inspect | PASS |
| Migration validate | PASS |
| Migration dry-run | PASS |
| Fresh emulator migration + independent verification | PASS |
| Live emulator E2E | PASS |
| Editor emulator E2E | PASS |
| Browser E2E | PASS — 4 passed, migrated-data case intentionally skipped in synthetic run |
| Migrated-editor emulator E2E | PASS |
| Migrated-editor browser E2E | PASS — 1 passed |

## 15. Test isolation

**PASS after audit correction.** Both required directions passed in fresh emulator runs:

```text
live -> editor -> browser
browser -> editor -> live
```

Synthetic live, editor, projector, round-first browser, and migration fixtures use distinct IDs. The real-data migrated suite runs in a separate fresh emulator and performs save/reload/restore rather than leaving intentional content mutations.

## 16. Repository hygiene

**PASS.** The final tracked set contains:

- 0 `.local-data` files;
- 0 non-example `.env` files;
- 0 Firestore export metadata or `output-0` files;
- 0 generated emulator-state/log paths;
- 0 screenshots or image fixtures;
- 0 private-key, service-account, or Firebase API-key markers;
- 0 non-demo Firebase app/bucket configurations;
- 0 real export document-ID matches;
- 0 tracked files larger than 1 MiB.

`.local-data`, its migration input, and `apps/web/.env.local` all pass `git check-ignore`. The only non-test email-like string found outside the allowlisted emulator domain is public third-party package metadata embedded in `pnpm-lock.yaml`; it is not project, user, or production data.

## 17. Bundle observation

**Non-blocking; P2/future.** Production-build comparison against the immediate `feature/ux-foundation` parent:

| Asset | UX baseline | Candidate | Observation |
|---|---:|---:|---|
| Main JS | 844.69 kB / 258.17 kB gzip | 844.69 kB / 258.17 kB gzip | unchanged |
| Lazy editor JS | 21.29 kB / 6.99 kB gzip | 46.11 kB / 13.49 kB gzip | +24.82 kB raw, isolated to editor route |
| CSS | 46.21 kB / 9.83 kB gzip | 59.71 kB / 11.80 kB gzip | +13.50 kB raw, +1.97 kB gzip |

The editor chunk grew meaningfully because it now contains the actual round-first workflow, but it remains lazy-loaded and did not enlarge the main chunk. The pre-existing Rollup warning therefore remains a performance backlog item, not an integration blocker.

## 18. Remaining HUMAN QA

These items are explicitly unverified by deterministic automation:

1. real external YouTube network/API behavior and autoplay policies;
2. physical HDMI/projector placement and fullscreen behavior;
3. full visual QA across target displays, browsers, resolutions, and font rendering;
4. a long real quiz-night rehearsal, including operator recovery;
5. subjective moderator/admin editor usability with representative users;
6. browser heap, listener, and long-session profiling.

## 19. Exact merge plan

No merge was performed by this audit. Recommended sequence:

1. Create `release/quiz-core-v0.2` from the final audited `feature/round-first-editor` tip. Do not cherry-pick individual ancestor branches.
2. Run the same required CI gate on that exact release tip and perform the HUMAN QA checklist above.
3. If no blocking defect is found, open one reviewed PR from `release/quiz-core-v0.2` to `main` and merge it without force-push or history rewriting. This single branch already contains the migration, PR #2 prototype ancestry, projector foundation and both fixes, UX foundation, and round-first editor.
4. Do not merge PR #2 or any older implementation branch separately. After the release PR lands, close PR #2 as superseded and optionally archive/delete superseded remote branches according to repository policy.
5. Keep `research/events-scoring-architecture` research-only. Events, registration, scoring, referee, preflight, PDF/email, uploads, offline support, rebrand, and projector protocol changes belong to later explicitly scoped work.

## 20. Recommended milestone and tag

- Proposed integration branch: `release/quiz-core-v0.2` — not created by this audit.
- Proposed milestone: **Quiz Core v0.2 — Core + Projector + Live + UX + Round-first Editor**.
- Proposed tag after successful HUMAN QA and main merge: `v0.2.0-core-editor`.

Do not create the tag before the reviewed release commit is on `main` and the remaining human checks are accepted.
