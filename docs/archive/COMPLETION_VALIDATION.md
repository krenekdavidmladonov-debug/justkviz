# Completion hardening — 2026-10-12

The locally integrated successor is **`ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac`**, tree `63e2dda958f2faf6ade85e780c9bdd28ad4bd52a`, on `codex/restart-integration`. It fast-forwards the existing accepted base through `codex/completion-hardening`; existing worktrees, frozen `aafeaa9` artifact and draft PR #39 are preserved. Later documentation commits do not change this frozen release source.

Following the owner's explicit approval, this same artifact was deployed to **V2 staging** on 2026-10-12: 70 Functions, exact Firestore Rules and Hosting version `5d6d0e6b0f400501`. The [execution record](STAGING_EXECUTION_DDB862F.md) contains independent metadata/hash verification and public static HTTP checks. The local/CI evidence below remains valid; deployment does not replace separate online user-journey acceptance. PR #39 remains draft and unmerged.

## Accepted fixes

| Commit | Behavior / review |
| --- | --- |
| `5be1f7e` | Actual public registration edits increment the private revision, so staff cannot rotate a link using a stale roster. Legacy absence means zero; no-op/replay does not increment. HIGH author, MEDIUM and lead review. |
| `9493aca` | Private rehearsal has initial focus, explicit boundary Tab/Shift+Tab wrapping, Escape close and focus restoration after editor remount; fullscreen uses its inner content. The private mapper preserves the existing automatic-agenda marker; manual options remain faithful through save and rehearsal. MEDIUM author, lead code/runtime review; separate screenshot review. |
| `8efcb05` | Interrupted event-night promotion records its exact previous backup before renames. Recovery validates and copies that backup without overwriting an existing canonical snapshot; invalid/missing evidence and reparse paths fail closed. HIGH author, MEDIUM/LOW and lead review. |

No new collection, Rules access, callable export, backfill or cloud infrastructure change is introduced. Public registration response fields stay unchanged. The recovery tool is local operation code, not a cloud recovery procedure.

## Exact-source verification

Seven final gates ran sequentially on the clean frozen SHA, with HEAD and clean-tree assertions before each gate and after completion. Node `22.23.2`, pnpm `11.19.0`, JDK `21.0.12.1`; emulators used only `demo-filmovy-kviz-v2` and synthetic data. No handler was invoked against staging or production.

| Gate | Result |
| --- | --- |
| `pnpm check` | PASS: typecheck, lint and production demo build. Existing approximately 981 kB main-bundle warning remains. |
| `pnpm test:unit` | PASS: 48 files, 448 tests, including actual Windows PowerShell 5 recovery fixture execution. |
| `pnpm test:rules` | PASS: 50 tests. |
| Registration boundaries + event team tools | PASS after synthetic auth and quiz seeds, including stale rotation, concurrent update/reissue, old-token denial, manual teams and PDF roster. |
| Minimal complete-editor browser journey | PASS: 1 case / 32.8 s; actual private DTO, automatic agenda, manual legacy content preserved across round save, rehearsal/live ordering, Tab/Escape/focus, fullscreen enter/close, desktop and 390 px views. |
| Offline staging guards, inventory, builder contracts | PASS: 19 tests. |
| Offline release builder | PASS: 118 checksum-listed deployment files, 70 targeted Functions. |

Receipt and complete logs: `.local-data/completion-hardening/frozen-ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac/`. Receipt SHA-256: **`ab8fd9d8ba22c1d4589903e639a898b3d4458aa8f2ed9b752e848885c826cf24`**. LOW independently recomputed all seven log hashes and the receipt hash. The receipt stores exact commands and UTC times (`18:37:09`–`18:41:09`). The worker also ran the 130-assertion recovery fixture under PowerShell 7 before freezing; that separate result is not a new Linux or full emulator restart claim.

Before the frozen run, the initial registration runner omitted a synthetic quiz required by an older lock test; the complete seeded rerun passed. Native modal behavior failed the first strict Tab-wrap browser assertion; explicit boundary handling fixed it, with no relaxed assertion or timeout. Those failures remain in the local logs. Screenshots under `.local-data/complete-editor/` were reviewed by the lead and MEDIUM; no clipping/overlap was found in the tested desktop/fullscreen/narrow scenario. This does not cover every media player or content length.

## Packaged candidate

Artifact: `C:\Projects\filmovy-kviz-v2\.local-data\restart-release\ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac`.

- Artifact `receipt.json` SHA-256: **`3507ab5d2742e50ff1798dfb1ffa1a3c2a166d1643d3c7ec3cd700bdedc5d375`**.
- Locked `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` installed 260 packages with isolated, credential-free npm configuration. Installed `node_modules` is verification material excluded from source-file checksums.
- Local import discovery: exactly 70 Gen 2 HTTP/callable exports in `europe-west1`; no email workers, declared parameters or secret bindings; four packaged Noto fonts parsed. No handler invoked. All source-file and receipt hashes matched before/after.
- Runtime report `.local-data/completion-hardening/runtime-verification.json`, SHA-256 **`2eac36ccb73aa3ff7aadee9f10a8b0fbaa2b678e23ef280bd5b0b857dfcdfd62`**. Zero attempts through the instrumented common network APIs. This instrumentation is not an operating-system network sandbox and does not cover every DNS resolver API.
- HIGH independently recomputed all 118 deployment-file hashes and inspected the packaged registration fix, agenda marker, rehearsal changes, manifest and Rules/source binding; no release blocker was found in that review.

## Remaining release and acceptance boundary

The four demonstrated local gaps are closed. This is not a claim that the entire replacement project is 100% launched. [COMPLETION_MATRIX.md](COMPLETION_MATRIX.md) separates implemented capabilities from public-launch policy, actual email, migration, and physical venue acceptance.

The owner subsequently approved the successor publication. `codex/restart-release-aafeaa9` and existing draft PR #39 were fast-forwarded to **`ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac`** against unchanged `main`. [CI 38293925253](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/actions/runs/38293925253) succeeded at `2026-10-12T19:25:05Z` (all 33 steps); [Operator owner takeover 38293926292](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/actions/runs/38293926292) succeeded at `18:55:43Z` (all 14 steps). No failed, skipped or cancelled step is counted as PASS.

Complete raw logs confirm actual checkout **`d30788ea2049802e43ed216f2ce06655888ae2b3`**. GitHub commit metadata confirms parents `[0d452d8efe4cce9eb003fcce713d3b63c15bb0a4, ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac]` and tree **`63e2dda958f2faf6ade85e780c9bdd28ad4bd52a`**, identical to the frozen source. Receipt `.local-data/completion-hardening/remote-ci-ddb862f/ci-verification.json`, SHA-256 **`7f8395474d76be0203f2c0bf0b73c7114ddb1f823e639e243ef69b27bc5a8f02`**, binds complete logs, metadata, workflow steps and the artifact receipt. LOW independently rechecked the receipt, hashes, raw checkout and merge API record. This certifies workflow-listed scope, not online staging behavior. Earlier `aafeaa9` CI stays historical. PR #39 remains OPEN/DRAFT; no force push, merge, duplicate PR or deployment occurred.

Additional operator tools were prepared and reviewed locally in `4e6ba67` and `3e5d9ee`; they do not change this frozen PR/artifact. Their 23 targeted tests, actual CAS emulator, check, 50 Rules tests and fresh read-only cloud inventory are separately recorded in [OPERATOR_PREPARATION_VALIDATION.md](OPERATOR_PREPARATION_VALIDATION.md). The executable [rollout proposal](STAGING_ROLLOUT_DDB862F.md) is ready for concrete pause/deployment approval; QA identities/resources/cleanup retain their separate scope.

After successful current-source CI and the required cloud approval, [RESTART_RELEASE_PLAN.md](RESTART_RELEASE_PLAN.md) still applies: fresh read-only inventory/CAS comparison, approved audited collaboration pause, exact 70 Functions, then Firestore Rules, then Hosting from this same immutable artifact. Preserve `health`; compare unchanged Storage Rules/indexes only. No new IAM, APIs, identities, permission grants, email workers or production/V1 access belongs to that deployment scope. Synthetic online QA identities/resources/cleanup retain their separate exact approval boundary.

Add to the scoped online smoke: stale roster link reissue fails after a public edit; rotated token rejects old read/update/cancel; private editor correctly identifies automatic/manual agenda; rehearsal keyboard/fullscreen/focus works. Keep existing answer/contact isolation, snapshot revocation, scoring/live/history, media and print smoke checks.

Rollback must preserve membership/lifecycle/snapshot/private-data guards. Do not automatically revert to `aafeaa9`: that would restore the stale-reissue and rehearsal/agenda defects. Prefer a reviewed forward fix; reuse a previous frontend/backend only after proving compatible guards and persisted contracts. Local snapshot recovery tests do not certify hardware durability after power loss, real cloud recovery or physical HDMI/audio operation.
