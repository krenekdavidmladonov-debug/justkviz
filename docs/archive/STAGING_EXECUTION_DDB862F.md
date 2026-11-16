# Staging execution record: frozen ddb862f

This records the explicitly approved staging rollout, not an online acceptance result. The user answered **Ano** to audited collaboration pause and **70 Functions → Firestore Rules → Hosting**; the lead executed cloud operations. Production, identity provisioning, grants, synthetic content/cleanup, email and collaboration resume are outside this execution approval. The earlier [rollout proposal](STAGING_ROLLOUT_DDB862F.md) predates this approval.

Evidence root: `.local-data/restart-rollout/20261012T193516745Z-9483853109af47358ce6632b13634203` (called **R** below), selected by `.local-data/completion-hardening/approved-rollout-path.txt`. Raw responses/logs remain ignored; this record contains no credentials or signed upload URLs.

## Immutable source and evidence bindings

| Binding | Value |
| --- | --- |
| Application SHA | `ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac` |
| Target | `filmovy-kviz-v2-staging`; Functions `europe-west1` |
| Artifact | `.local-data/restart-release/ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac`; 118 checksum-listed files plus receipt |
| Artifact receipt SHA-256 | `3507ab5d2742e50ff1798dfb1ffa1a3c2a166d1643d3c7ec3cd700bdedc5d375` |
| Runtime verification SHA-256 | `2eac36ccb73aa3ff7aadee9f10a8b0fbaa2b678e23ef280bd5b0b857dfcdfd62` |
| CI verification SHA-256 | `7f8395474d76be0203f2c0bf0b73c7114ddb1f823e639e243ef69b27bc5a8f02` |
| CI checkout / source tree | `d30788ea2049802e43ed216f2ce06655888ae2b3` / `63e2dda958f2faf6ade85e780c9bdd28ad4bd52a`; source-tree equality to frozen SHA verified |
| Successful CI | CI `38293925253` (33 steps); Operator owner takeover `38293926292` (14 steps); see [validation](COMPLETION_VALIDATION.md) |
| Operator tools at attempt 4 | `40fee6cbcfe009de44464d436396238b5bd57d5b`; Node 22.23.2 / firebase-tools 15.28.2 |

The artifact receipt's original `PREPARED_NOT_DEPLOYED` mode remains preserved historical packaging evidence. It is not rewritten into a deployment receipt. CI establishes the recorded source checkout and test conclusions, not deployment or online behavior.

## Completed collaboration pause

`R/authorization.json` records approval; `R/pause-apply.jsonl` ends in `APPLIED` at `2026-10-12T19:37:24.127Z`. The atomic operation updated collaboration from true/revision 18 to **false/revision 19**, and created the deterministic audit record. Control updateTime is `2026-10-12T19:37:23.045464Z`.

Plan SHA-256: `cb147198044030d2ba3d76fa5e582b5ba6aa8397a8bd7f641dbb13827508b414`; closed apply-receipt SHA-256: `64fab704da6fbfb82e8fd7dc59b6bf99159c35a157ca73bc95787307583bba0a`. Subsequent phase reads retained false/revision 19. Pause does not revoke active memberships or pause ordinary content operations; resume requires separate approval.

## Functions: stopped attempts and compatibility fixes

| Attempt | Observed outcome and narrowly corrected cause |
| --- | --- |
| 1 | Exit 2 before allowed writes: real CLI preparation supplied empty dynamic-extension metadata. Guard now accepts absent/exact empty plain object, still rejects extra or malformed metadata. |
| 2 | Exit 2 after generating an upload capability: upload rejected because CLI serializes URLSearchParams differently from the original URL. Capability comparison now uses that exact serialization, preserving ordered query pairs, host and path. |
| 3 | Exit 2 after source upload: all Function PATCH operations blocked on `buildConfig.sourceToken`, introduced even when undefined by the CLI's default build-reuse optimization. Only `functionsv2deployoptimizations` is explicitly disabled; sourceToken remains forbidden. |
| 4 | Exit 0 at `2026-10-12T20:00:26.3176373Z`: 70 unique Functions updated through 73 allowed PATCH requests. `removeQuizRound`, `reorderQuizQuestion`, `repairQuizPreflightIssue` each had one retry. |

Attempts 1–3 issued no Function PATCH; upload allocation/upload in attempts 2–3 are not Function updates. Preserve `R/functions-phase-{1,2,3}-exit.json`, matching guard JSONL and `R/after-functions-attempt-{1,2,3}.json`; do not describe the stopped attempts as successful deployment.

Operator-only commits `8dc0633`, `25777ce`, `40fee6c` implement the three fixes without changing frozen application bytes or approved scope. `R/operator-fixes-review.json` records 15 targeted offline real pinned-CLI tests, syntax/lint/diff checks and independent MEDIUM plus lead review. These tests use synthetic transport/polling; cloud results are separate evidence. Its SHA-256 is `a3398c19c327f97c55527573d5a42b2411dde766646b0588d8803779a7707c4a`.

## Functions metadata verification and image resolution

The preserved original `R/functions-metadata-verification.json` verified 68 updates and reported exactly two `RUN_IMAGE_NOT_NEW` failures (`deleteEvent`, `generatePrintArtifact`), with no missing projections. Its SHA-256 is `e16e35a83e00e47ce2ad7b23be81031e0adc64b5ee6772b1651f3a5e42a50332`.

`R/functions-metadata-resolved.json` resolves **70 metadata updates**, without replacing the original report; SHA-256 `b3f735858690c68d86cbfecb6e95f40c1f434e0742e79a1775185475810c3dca`. Both unchanged `:version_1` image tags resolve to different immutable `@sha256` digests in the same respective repository. Saved Function build pointers and latestReadyRevision names match the four provenance projections; all four Cloud Builds are SUCCESS and both new Run revisions have Ready/Active succeeded. `R/image-provenance.json` SHA-256 is `c86ca48e40c018af37fb6d806f5e7de1db6bc3b41a51ffbb8ca21c5c6c4ab516`.

The original comparisons retain health, Cloud Run IAM policy, runtime identity/ingress and requested environment/secret metadata. Before/after raw projections are under `R/post-pause/.local-data/restart-preflight-20261012` and `R/post-functions/.local-data/restart-preflight-20261012`. Lead-reported independent LOW review confirmed the 13 evidence bindings and three additional API states unchanged at `2026-10-12T20:10:15Z`; its report is not substituted for the retained raw projections.

Cloud Build `sourceProvenance` and `results.images` are absent in all four saved responses. No source-to-image proof beyond the Function build pointer is asserted. Changed immutable Run image metadata does not prove exact executing artifact bytes, handler behavior or authorization behavior; IAM comparison covers the retained Run policies, not all project/bucket IAM.

## Firestore Rules and Hosting verified

Rules phase exited 0. `R/rules-verification.json` observed `2026-10-12T20:12:24.772Z` verifies active ruleset `12dc6212-e401-4abd-8031-9e42ff8db00a` and exact frozen source SHA-256 `58d1f6e57f9fb72a12806839670a01b36812cf5eda708ba59eceaff92310b8e5`. Storage Rules, indexes and collaboration false/revision 19 remained unchanged. Verification receipt SHA-256: `ff2e599bb640208e407c99849c9063d8b45e582006e016e1997f96a74a5e378a`. This is source/metadata equality, not exercised online allow/deny behavior.

Hosting phase exited 0 at `2026-10-12T20:13:18.6697618+00:00`. Live DEPLOY release at `20:13:16.385Z` points to FINALIZED version **`5d6d0e6b0f400501`**. The initial strict comparison stopped on two extra Firebase-reserved paths; all 37 application gzip9 hashes already matched. The corrected offline verifier requires exactly `/__/firebase/init.js` and `/__/firebase/init.json` with their captured pre-Hosting ACTIVE hashes, and exact equality for the complete remaining 37-file application set. It does not ignore arbitrary extra files. `R/hosting-verification-resolved.jsonl` SHA-256 is `3369ab0948500ca6c97af9d0bf13a053837ae33b408c5e93e0a9dd6175c913cd`; MEDIUM and LOW independently verified the result. Headers and static SPA rewrite match the artifact. Post-Hosting Rules, Storage Rules, READY indexes and control false/revision 19 are unchanged.

Five public GETs (`/`, `/admin/quizzes`, `/projector`, primary script and stylesheet) returned HTTP 200, exact artifact byte hashes and expected noindex/nosniff/referrer headers. `R/public-static-verification.json` SHA-256: `0f7c1ecf7d13ec75a8b3a01b9055fe62d7a3d7d4c8399a1470587c0e53195681`. This is static availability evidence: no browser JavaScript, sign-in or authenticated workflow was exercised.

## Completed scope and next boundary

Consolidated **`R/execution-verification.json`**, mode `APPROVED_STAGING_DEPLOYMENT_VERIFIED`, SHA-256 **`aad20b5aee3a4482cffdd7dddc3df82faaee5bb23684ec7399fc06503f2935c0`**, binds 234 source/evidence files. LOW independently verified every hash and the summary. It records all three successful phases, preserved metadata projections and 13 API states. The application artifact remains byte-identical; PR #39 remains draft and unmerged. Rules and Hosting ran through reviewed pinned CLI phases, not the Functions mechanical write allowlist.

The approved staging rollout is complete. Do not repeat deployment, rebuild this artifact or reapply the pause. Keep invitations paused pending separately approved restoration after online verification. Use the compatible forward-fix/stop strategy in the rollout plan if a real defect is found; an old frontend rollback has no compatibility proof.

No online synthetic QA identities, grants, content, cleanup, production/V1 action or real email were performed. Follow the [staging acceptance proposal](STAGING_ACCEPTANCE_DDB862F.md) for the next separately approved scope. Deployment/static success does not establish complete online or venue acceptance.
