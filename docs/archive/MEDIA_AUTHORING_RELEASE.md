# Historical media integration record

Superseded for release by [COMPLETE_EDITOR_RELEASE.md](COMPLETE_EDITOR_RELEASE.md). The active integrated direction is `codex/complete-quiz-editor` on current main + PR #26; do not deploy the old staging-based branch or its seven-function manifest. Details below record the preserved earlier work.

# Media authoring candidate

## Provenance and diagnosis

Base: staging hotfix `10bea0de34d9939d02db374a0bbf8f2276fc9255` (PR #27), with the editor correction from PR #26 `c92a8b5211b11ce438498fb934a2ddff04c186bb`. The feature selectively applies the single PR #23 media commit `c4809e6d18d88c48c1aded5c12ff2c8e3a235c1c`, not its email ancestors. New branch: `codex/media-authoring`; worktree: `C:/Projects/filmovy-kviz-v2/.local-data/media-authoring`.

The staged hotfix had no file picker/upload backend. Image URL controls existed, but no upload or ready-asset selection. Audio/video could preserve imported sources, which did not establish a complete new-source authoring workflow. Background only exposed a plain source field. The foundation supplied grants, immutable objects, authenticated gateway, snapshots and player lifecycle, but its picker only attached question-image/audio assets and required an existing question. Answer/background roles were rejected. Cloud upload additionally cannot work while the staging bucket and media endpoints are absent.

Reused code: `functions/src/media/{callables,model,endpoint,storage,environment}.ts`, `storage.rules`, `apps/web/src/features/media/{mediaApi,MediaUploadField,AssetImage}.tsx` (API is `.ts`), `features/presentation/MediaPlayer.tsx`, editor create/update and event-lock validation, domain asset references. New authoring extends those same modules, `EditorForms.tsx`, shared `SlideRenderer.tsx`, lossless `editor/model.ts` and domain mappers. No second media subsystem or email/team feature was added.

V1 source was not located. The scoped search covered this repository, `git worktree list`, known V2 worktrees under `C:/Projects`, referenced archives, and source/archive filenames excluding dependency/build folders. `.local-data/v1-analysis` contained derived inventories, not the original UI source; V1 export/data directories were not treated as source or reopened for this task. No V1 application/API/storage was contacted. This implementation is based on the documented V2 contracts, not a claimed reproduction of V1 functions.

## Local verification and limits

All writes and uploads in this run use synthetic fixtures on `demo-filmovy-kviz-v2` with local Auth, Firestore, Functions and Storage endpoints. Fixtures fail closed before initialization if an emulator endpoint or demo project is missing.

- `pnpm check` includes typecheck, lint and production build; unit suite: 229 tests / 30 files.
- `pnpm test:e2e:media`: real grants, Storage writes, signatures, size/type/scope denials, pinned snapshot, image/background visibility, answer reveal, ordinary private audio, recap Range and navigation revocation.
- `pnpm test:e2e:media-browser`: two real Chromium workflows, new question create/save/read-back, image upload/link/library, separate answer/background, detach/reload, audio upload/link/manual playback, YouTube source variants and direct synthetic WebM playback, cancelled/rejected/interrupted protocol, transfer selection guard, retry, Save 503 and two-editor conflict. Browser network evidence contains endpoint names/status only; no trace, bearer token, URL query or request bodies.
- Hotfix emulator and seeded browser regressions exercise two lossless saves, unchanged sentinel timing, stale draft and createQuiz/first question. Separate empty-library and Rules runs are recorded in the final evidence report.
- Screenshot and sanitized request evidence are generated under `.local-data/media-authoring/`; they contain only synthetic content.

YouTube external requests are deliberately blocked in deterministic browser tests. URL recognition and failure handling are tested; actual online YouTube playback is **not verified**. MP4 upload, YouTube downloads, transcoding, automatic physical cleanup and a cross-quiz media browser are outside scope. MIME/signature checks are not full codec or malware validation. Direct links remain subject to their server, CORS and browser codec support. The picker lists at most 200 asset records. Cancelled/abandoned uploads may leave private objects/grants; no automatic sweep removes them.

## Read-only staging observations

Checked 2026-09-11 21:14 UTC. Hosting remains release `1789157941594000`, version `90df28ec3c46ec01`. Bucket GET for `filmovy-kviz-v2-staging.firebasestorage.app` returned 404; there is no region/CORS configuration to report for that absent bucket. Billing API returned `billingEnabled: true`; no billing account identifier is retained. Rules releases contain only `cloud.firestore`, ruleset `5a466537-7b8f-44e3-a142-d7e3353477bc`; no Storage Rules release exists. None of begin/finalize/readQuizMedia is deployed; 55 existing Functions were observed. Evidence: local `staging-readonly.json`.

The [Firebase Storage billing requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024) require Blaze for a new default bucket. Billing enabled is a prerequisite, not a promise of free usage. Storage operations/retention/egress, gateway invocations and Firestore authorization reads incur usage. The 25 MiB audio cap is below the 32 MB non-streaming second-generation response limit documented in [Functions quotas](https://firebase.google.com/docs/functions/quotas). This gateway buffers one object; cost/load testing for audience volume remains a deployment concern.

## Exact future rollout — NOT EXECUTED

A later explicitly authorized staging run must recheck remote heads, Hosting release, Functions generations, rules and bucket existence before any mutation. Build the reviewed clean SHA with `node tools/staging/build-media-authoring.mjs` and the allowlisted V2 staging VITE configuration from the existing read-only web config. The builder performs compilation and file packaging only, writes checksums and a seven-export Functions entry point under `.local-data/media-authoring-release/<SHA>/`, and rejects a dirty tree or mixed project configuration. No old blanket deploy wrapper is used.

Necessary components, in order:

1. **Default bucket**: Firebase console, exact project `filmovy-kviz-v2-staging` → Storage → Get started → default `filmovy-kviz-v2-staging.firebasestorage.app`, proposed region **europe-west1** to match Functions, production/locked rules. Confirm the displayed bucket/project/location before creation. This is a future configuration choice, not an observed existing region. Do not create a V1 bucket, public IAM grants, lifecycle deletions, or copy existing data.
2. **Storage authorization**: deploy this candidate's `storage.rules`, exact project and generated config, with `firebase deploy --project filmovy-kviz-v2-staging --config <artifact>/firebase.media-authoring.json --only storage`. Enable only the documented Firebase Storage service-agent cross-service Firestore lookup permission if prompted, after reviewing that concrete IAM change in the authorized run. See [cross-service Rules permissions](https://firebase.google.com/docs/rules/manage-deploy#manage_permissions_for_cross-service_cloud_storage_security_rules). Never grant public bucket read/list. Firestore Rules are unchanged: existing staff-only recursive quiz read covers asset metadata, client writes remain denied; no Firestore Rules/index deploy is required.
3. **Three new Functions**: `beginQuizMediaUpload`, `finalizeQuizMediaUpload`, `readQuizMedia`.
4. **Four changed Functions**: `createQuizSlide` and `updateQuizSlide` enforce ready/scope/type and explicit source timing; `lockEventQuiz` checks references before copying a snapshot; `reportMediaPlayback` accepts native pause/resume's playing→ready transition. Existing `createQuiz` remains the already deployed PR #27 hotfix. Public mapping already handles normalized roles/empty detachment and reveal, so no other live publication endpoint change is needed. The generated Functions entry point exports exactly these seven names.
5. **Frontend**: build from this same SHA and staging VITE config (project, app, bucket, `USE_EMULATORS=false`, explicit non-demo allow flag), deploy only Hosting after backend/Rules success. Retain the existing SPA rewrite; the gateway uses its region-qualified HTTPS URL directly, with CORS enabled and authenticated fetch→Blob. Firebase SDK uploads use the Firebase Storage endpoint; no public GCS URL or new Hosting rewrite is required. Verify OPTIONS/Authorization in staging after authorized deployment before broad use. Do not invent a bucket CORS policy for the absent bucket.

Targeted commands after separate approval (each uses generated config):

```
firebase deploy --project filmovy-kviz-v2-staging --config <artifact>/firebase.media-authoring.json --only functions:beginQuizMediaUpload,functions:finalizeQuizMediaUpload,functions:readQuizMedia,functions:createQuizSlide,functions:updateQuizSlide,functions:lockEventQuiz,functions:reportMediaPlayback
firebase deploy --project filmovy-kviz-v2-staging --config <artifact>/firebase.media-authoring.json --only hosting
```

Do not accept function deletions, change other exports, enable email functions, seed, migrate or upload existing user data. After later approval, use disposable synthetic staging content to verify create/upload/save/reopen plus authorized image/audio fetch, answer reveal and snapshot retention; that online write QA was not authorized in this run.

## Component recovery without deleting media

Record prior Hosting version, each existing Function source/generation, and Rules release before rollout. A failed backend step leaves old Hosting in place. Restore Hosting to `90df28ec3c46ec01` (or the newer pre-rollout version recorded then) if the UI must be withdrawn. Keep the gateway and compatible Storage Rules while any saved quiz/snapshot references an owned asset. Disable new grants or deploy a forward fix to stop new uploads; never delete the bucket, ready metadata, objects, generations or snapshots as rollback.

Restore an individual pre-rollout Function only after checking its compatibility with newly saved asset references. Old create/update/lock code may reject new authoring; a blanket backend rollback is therefore not a safe promise. Retain asset-aware validation/read support and the hotfix sentinel/conflict behavior until a compatible fix is deployed. No rollback reimports V1 or rolls back quiz data.

## Local main transfer proof

A separate local branch `codex/media-authoring-main-check` starts at main `0d452d8efe4cce9eb003fcce713d3b63c15bb0a4`, then applies PR #26 as local commit `fe54dbd`, then candidate implementation `8d05b46f225571bd5c415c3f363777257e6c8768` as local integration commit `1579c5dd70d45a73103942f50010a6ad7cc7fda0`. The worktree is `C:/Projects/filmovy-kviz-v2/.local-data/media-authoring-main-check`. No remote main/ref was changed.

Expected conflicts came from foundation files already on main. Resolution retained main's index exports, package scripts, existing Rules tests and unrelated documentation; media files use the authoring implementation, and the unit include list adds mediaAuthoring.test.ts. The resulting diff over main+PR26 is 34 files, 550 insertions / 129 deletions, not a replacement of main with the release tree. Main's existing email modules remain untouched in this local integration proof; they are absent from the staging candidate artifact.

Integration verification: `pnpm check` PASS, 323 unit tests / 35 files PASS, 44 Rules tests PASS, real media emulator contracts PASS, both media browser workflows PASS. Candidate verification also includes the separate empty-library browser (1 PASS), seeded hotfix browsers (3 PASS), 229 unit tests and 36 Rules tests. Candidate-only follow-up changes refine screenshot framing and make the upload cancellation test wait until finalization is actually in flight; they do not change application behavior.
