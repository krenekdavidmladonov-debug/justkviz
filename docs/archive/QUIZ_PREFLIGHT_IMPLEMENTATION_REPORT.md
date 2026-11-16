# Quiz preflight implementation report

## Result

**QUIZ PREFLIGHT READY**

The `feature/quiz-preflight` branch adds a derived, staff-only readiness check without changing the public projector contract, media engine, Firestore Rules, or persisted quiz schema. The branch was created from the verified `feature/round-first-editor` tip at `b898c1c`. It has not been merged or deployed.

## Delivered behavior

- One whole-quiz static check covers every authored round and question from a bounded private quiz load.
- Results are typed as `BLOCKED`, `READY_WITH_WARNINGS`, or `READY` and grouped into `STRUCTURE`, `ANSWER`, `MEDIA`, `TIMING`, `IMAGE`, and `LEGACY` categories.
- Every question issue carries semantic round/question references and a Czech human message. Fix actions open the round-first editor at the exact round and question and focus the relevant field when practical.
- Quiz detail, the editor header, and the normal practice/live-start action expose readiness.
- A blocker disables live start with no bypass. Warning-only quizzes require an explicit acknowledgement; issue-free quizzes use the normal start action.
- An editor check evaluates the current selected local draft over the saved remainder of the quiz. A dirty draft is clearly identified and blocks live start until saved.
- Projector operational state is presented separately as `Neověřeno`; the feature does not invent presence or fullscreen status.
- The result is ephemeral. No `isQuizValid` duplicate truth is stored in Firestore.

## Validation architecture

Question-level rules live in the shared editor/domain validation module. The whole-quiz preflight engine composes those rules with structural, media, timing, legacy, aggregation, draft-overlay, and semantic deep-link logic. React pages and panels only render the typed result and apply the live-start policy.

The saved readiness page performs one bounded quiz load and validates it synchronously in memory. Immediately before session creation it re-reads the saved quiz and reruns preflight. A warning acknowledgement is tied to that quiz revision, so it cannot silently authorize a changed quiz.

## Static media policy

Version one validates required sources, supported source syntax/provider parsing, image syntax, and finite increasing clip boundaries. External and YouTube availability remain warnings rather than guarantees. No bulk iframe probe, online playability guarantee, offline-ready claim, or spoiler-safety guarantee was added. A controlled one-player online probe remains a separately reviewed follow-up.

## Migrated-data evidence

All results below are aggregate and intentionally omit quiz identifiers, titles, question text, correct-answer values, media locations, moderator notes, and legacy raw content.

| Measure | Result |
| --- | ---: |
| Quizzes checked | 4 |
| Rounds checked | 23 |
| Questions checked | 263 |
| Preflight blockers | 172 |
| Preflight warnings | 72 |
| Largest quiz | 79 questions |
| Largest-quiz synchronous validation | 0.7 ms observed |

| Category | Blockers | Warnings |
| --- | ---: | ---: |
| Structure | 0 | 1 |
| Answer | 55 | 0 |
| Media | 47 | 51 |
| Timing | 52 | 0 |
| Image | 18 | 12 |
| Legacy | 0 | 8 |

The findings are the intended outcome of applying the new readiness policy to historical content; the migration and preflight did not repair or mutate those quizzes. The migration read-back independently preserved 4 quizzes, 315 slides, 23 rounds, 263 questions, 263 private answers, and 154 media references.

## Performance and browser QA

Whole-quiz validation is synchronous and uses the already bounded semantic quiz model; it does not issue one Firestore read per question. The largest migrated quiz completed in 0.7 ms in the recorded browser run, below the 50 ms regression threshold.

Browser coverage verifies:

- quiz detail to readiness;
- editor draft readiness and semantic issue-to-fix navigation;
- blockers preventing live start;
- warning acknowledgement before `Spustit i tak`;
- issue-free normal live start;
- layouts at 1280 x 720, 1024 x 768, and 390 x 844;
- all four migrated quizzes opening in the round-first editor and producing bounded, sanitised readiness results.

## Quality gate

Executed with Node 22 and local Firebase emulators using `demo-filmovy-kviz-v2` only.

| Gate | Result |
| --- | --- |
| TypeScript, ESLint, production build (`pnpm check`) | PASS |
| Unit/component tests | PASS — 119 tests |
| Functions tests | PASS — 27 tests |
| Firestore Rules tests | PASS — 15 tests |
| Migration inspect | PASS |
| Migration validate | PASS |
| Migration dry-run | PASS |
| Migration emulator write and independent read-back | PASS |
| Live/editor emulator regression | PASS |
| Browser projector/media/recap/editor/UX/preflight suite | PASS |
| Migrated editor emulator verification | PASS |
| Migrated editor and preflight browser verification | PASS |

The production build retains the existing non-blocking main-bundle size warning; no new failing gate is hidden by it.

## Security regression result

- Preflight stays behind the existing staff authorization boundary and reads private data only through the bounded staff quiz load.
- Structured results and browser logs are tested not to contain correct-answer values, question copy, notes, media locations, or `legacy.raw`.
- No preflight result is written to `publicSessions`; the public allowlist, Firestore answer authority, Rules, BroadcastChannel transport, and reveal flow remain unchanged.
- Anonymous projector clients receive no validation details or private answer data.
- All emulator writes failed closed behind both an emulator host and a `demo-*` project identifier.
- No production Firebase service, credential, deploy, merge, or production data mutation was used.

## Intentional limitations

- Static checks cannot guarantee external availability, YouTube embed/playability, browser autoplay, or offline use.
- Projector presence/fullscreen is not reported without a trustworthy acknowledgement protocol.
- This slice gates the normal staff practice/live UI. Future event-backed locking should reuse the same shared rules at a trusted server boundary.
- Historical migrated quizzes currently contain readiness findings and require human content repair; no data was changed automatically.
- The existing build-size warning and the existing Firebase Functions dependency upgrade notice remain follow-up maintenance, not preflight blockers.

## Recommendation

**READY FOR HUMAN PREFLIGHT REVIEW**
