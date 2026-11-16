# Restart local validation — 2026-10-12

This is local synthetic validation evidence, not release approval. The frozen candidate is `8b6245608850c9cad959fb14ab6a754f485e1dad`, including the scoring navigation and isolated form test harness fixes. The lead verified by Git diff that application/runtime sources are identical to those represented by `3f703ad`; subsequent changes concern tests, documentation, CI and release inventory. Final exact-SHA acceptance completed with exit 0 at **2026-10-12 14:13 Europe/Prague**. Only documentation was dirty during that final run; no runtime, test, tool or CI source changed.

Final gates: `pnpm check` PASS; 48 unit files / 445 tests PASS; 50 standard Firestore Rules + 10 extended Firestore/Storage access tests PASS; 7 staging guard + 5 inventory checks PASS; the UI-authored event journey 1 PASS; scoring conflict/lost-response browser 1 PASS; isolated form browser 6 PASS. The final demo build retains the existing approximately 981 kB main-bundle warning.

## Lead-verified evidence

These results are supplied by the lead and the [development status](DEVELOPMENT_STATUS.md); no new logfile path is asserted for them.

| Suite | Result | Tested state / runtime |
| --- | --- | --- |
| `pnpm check` | PASS: typecheck, lint, workspace build | Same application code as `3f703ad`, before committing those source changes; Node 22.23.2, pnpm 11.19.0, JDK 21.0.12.1. |
| Unit / Firestore Rules / extended access Rules | PASS: 445 / 50 / 10 tests | Same pre-commit application code as `3f703ad`, same pinned runtime above. |
| Unit rerun | PASS: 445 tests | Exact `cdb147d`, 13:49 Europe/Prague. |
| Staging guards / release inventory | PASS: 7 / 5 tests | Node 22; no deployment. |
| Earlier targeted emulator chain | PASS: personal-access callables 24 (including 3 issuer regressions), personal-access browser 2, save-all browser 6, event-management browser 2, media/session contracts 3 | Integrated application code; chain exit 0. Output was partly truncated; no complete logfile reference is claimed. |

## Receipts and matching logs

All paths below are relative to `C:\Projects\filmovy-kviz-v2\.local-data\restart-verification\`. Group directories contain `receipt.json` and matching `output.log`; the final orchestration/check rows explicitly use receipt evidence instead. These ignored local receipts are not committed artifacts. All receipt runtimes are Node 22.23.2. A full emulator group PASS requires both its terminal `GATE_PASS` results and receipt exit 0.

SHA aliases: **A** = `3f703adfc36afe11e321355c2ae34f0d7acbf7be`; **B** = `adf1b77103eb2c100a35b1ffded4f8c6236705a8`; **C** = `9cb20c3f5ad098fcd316c986a9fede6b7c823da4`; **D** = `cdb147d3f21e973c26de3d300da34a021136b8ca`; **E** = `8b6245608850c9cad959fb14ab6a754f485e1dad`.

Dirty-state aliases describe the receipt at run start, not a clean committed tree:

- **d1:** modified migration fixture test; untracked release plan.
- **d2:** d1 plus untracked inventory test and manifest.
- **d3:** d2 plus untracked authored-event browser config.
- **d4:** untracked authored-event browser config and spec.
- **d5:** d4 plus modified development status and event contract test.
- **d6:** d4 plus modified development status.
- **d7:** modified `README.md`, `docs/DEVELOPMENT_STATUS.md`, `docs/README.md` only.
- **d8:** d7 plus modified scoring browser test and untracked validation document.
- **d9:** d8 plus modified form browser config.
- **d10:** d7 plus untracked validation document.
- **d11:** d10 plus modified security documentation.
- **d12:** d11 plus modified restart release plan.

| Local receipt/log directory | SHA / dirty | Observed result |
| --- | --- | --- |
| `core-2026-10-12T11-35-10-527Z` | A / d1 | Exit 2; no completed gate. Historical setup failure. |
| `core-2026-10-12T11-35-48-750Z` | A / d2 | Seed auth PASS; editor-empty started; no terminal receipt. Incomplete historical attempt. |
| `core-2026-10-12T11-37-07-967Z` | A / d2 | Exit 1; no completed gate. Historical setup failure. |
| `core-2026-10-12T11-37-39-841Z` | A / d2 | Partial: editor-empty 1, editor-seeded 2, editor-outline 3 and live-session PASS; quiz-editor FAIL; group exit 1. |
| `contracts-2026-10-12T11-39-39-065Z` | A / d3 | Partial: seeds and quiz-editor PASS; events FAIL; group exit 1. |
| `complete-2026-10-12T11-41-15-170Z` | B / d4 | PASS, exit 0: complete-editor 2, editor-boundaries, editor-performance 1, dark-theme 3. |
| `migration-2026-10-12T11-44-21-615Z` | B / d5 | PASS, exit 0: 7 synthetic migration contracts. |
| `contracts-2026-10-12T11-44-31-854Z` | B / d5 | PASS, exit 0: seeds, events, event-scoring, registrations, registration-boundaries, event-team-tools, print-center. |
| `acceptance-2026-10-12T11-46-22-203Z` | B / d5 | PASS, exit 0: authored-event browser 1. |
| `extended-2026-10-12T11-47-19-458Z` | C / d6 | Partial, exit 1: seed, referee contract/browser (1), interim contract/browser (1), final contract/browser (13), historical browser (2), media-contract PASS. Combined media-browser FAIL: storage browser passed, authoring failed. |
| `media_recovery-2026-10-12T11-54-39-735Z` | D / d7 | PASS, exit 0: isolated media-authoring browser 1 and event-management-contract. |
| `email-2026-10-12T11-56-14-749Z` | D / d7 | PASS, exit 0: registration-email, gmail-delivery, event-team-email, registration-email browser 1, event-team-email browser 1. Synthetic capture only. |
| `hosting-2026-10-12T11-57-34-719Z` | D / d7 | Partial, exit 1: seeds, print-browser 2, registration-browser 5, team-tools-browser 2 PASS; scoring-browser FAIL at `locator.fill` 15-second timeout. |
| `scoring_recovery-2026-10-12T12-04-17-082Z` | D / d8 | PASS, exit 0: seed and scoring-browser 1 with navigation-wait harness fix. |
| `form-2026-10-12T12-04-51-523Z` | D / d8 | Interrupted after navigation timeout; lead observed 3 passing cases. No terminal receipt or group PASS; cause not established. |
| `form-2026-10-12T12-08-11-781Z` | D / d9 | PASS, exit 0: isolated events-form-browser 6 with config fix. |
| `final-check-2026-10-12T14-02-54` | D / d10 | Receipt: `pnpm check` PASS, exit 0; pnpm 11.19.0. |
| `final-2026-10-12T12-09-52-077Z` | E / d11 → d12 | PASS, all 7 gates and orchestration exit 0. Per-gate logs: `check.log`, `unit.log`, `offline-guards.log`, `rules.log`, `extended-access-rules.log`, `final-acceptance.log`, `isolated-form.log`; receipt includes commands, runtime, start/end SHA and times. |
| `final_acceptance-2026-10-12T12-11-04-354Z` | E / d11 | PASS, exit 0: authored-event browser 1 (49.1 s), seed, scoring browser 1 (14.5 s). |
| `form-2026-10-12T12-12-27-437Z` | E / d12 | PASS, exit 0: isolated form browser 6 (38.0 s). |

Historical failed groups remain failed groups. The status records setup restrictions and mutation-heavy fixture isolation issues in initial runs; the event contract also needed its obsolete superseded-snapshot expectation changed to denial. Subsequent successful gates establish only their stated coverage. The isolated media recovery does not retroactively turn the extended group into a full PASS.

The final-authoring test uses real browser UI for quiz/event authoring, registration, scoring, public reveal and history, with only isolated Auth/membership fixture setup. The broader complete-editor evidence is under `.local-data/complete-editor/`; the lead inspected desktop and narrow-viewport screenshots. This is synthetic local browser evidence, not physical venue acceptance.

## Remaining limits

- Broader feature runs above have their actual earlier SHA/dirty states recorded. Git comparison proves unchanged application code at E; they are not misrepresented as fresh complete suite runs on E. Failed hosting and interrupted form attempts remain partial records.
- No cloud inspection, deployment, production access or real email delivery was performed; synthetic Gmail/email capture does not establish delivery.
- GitHub CI is unverified. Local Windows results do not establish Linux CI behavior.
- Physical projector, HDMI and audio acceptance remains unverified.
- Migration coverage used synthetic fixtures; no migration with real data was performed.
- Bounded review and local tests are not a security certification or authorization to release. See the [release plan](RESTART_RELEASE_PLAN.md) for approval prerequisites.
