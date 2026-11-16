# Staging rollout proposal for frozen ddb862f

This preserves the operator proposal for frozen **`ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac`**. The owner subsequently approved the exact pause/deployment scope with **Ano**, and execution is complete in [STAGING_EXECUTION_DDB862F.md](STAGING_EXECUTION_DDB862F.md). Do not repeat these commands or request the same approval. Later documentation/operator-tool commits do not replace the application SHA. QA provisioning/content, cleanup, collaboration resume and email remain separate scope.

The historical target was `filmovy-kviz-v2-staging` (`177615774316`), Functions region `europe-west1`. This project now serves production at https://justkviz.cz. [AGENTS.md](../AGENTS.md), [SECURITY.md](SECURITY.md), [PERSONAL_ACCESS.md](PERSONAL_ACCESS.md) and [EVENT_MANAGEMENT.md](EVENT_MANAGEMENT.md) require active membership, concrete permissions and resource scope independently of role labels/legacy claims. Public answers require explicit reveal; contacts and private quiz data remain protected.

## Frozen local evidence and remaining gates

| Evidence | Exact binding and limit |
| --- | --- |
| Artifact | `C:\Projects\filmovy-kviz-v2\.local-data\restart-release\ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac`; 118 checksum-listed files plus receipt. Installed `functions/node_modules` is local verification material outside those checksums. |
| Receipt SHA-256 | `3507ab5d2742e50ff1798dfb1ffa1a3c2a166d1643d3c7ec3cd700bdedc5d375`; mode `PREPARED_NOT_DEPLOYED`, no cloud-write approval. |
| Runtime report | `.local-data/completion-hardening/runtime-verification.json`, SHA-256 `2eac36ccb73aa3ff7aadee9f10a8b0fbaa2b678e23ef280bd5b0b857dfcdfd62`; bound to the same receipt/SHA. |
| Local discovery | Node 22.23.2; locked install of 260 packages with scripts disabled; exactly 70 Gen 2 HTTP/callable exports in europe-west1, zero declared params/secret bindings, four Noto fonts parsed, all 118 hashes and receipt stable. No handler invoked. Common network/process APIs were instrumented; this is not an OS network sandbox or cloud authorization proof. |
| Independent package review | Receipt/report hashes, complete artifact file set and all 118 hashes matched; packaged public registration revision fix, private domain marker and practice focus fix were present. |
| Current CI | PR #39 CI `38293925253` (33 steps) and Operator owner takeover `38293926292` (14 steps) succeeded. Raw logs confirm checkout `d30788ea2049802e43ed216f2ce06655888ae2b3`, with the frozen source tree and exact main/head parents. Receipt, URLs and independent verification are in [COMPLETION_VALIDATION.md](COMPLETION_VALIDATION.md). |

Do not rebuild this artifact from a documentation-only HEAD, reinstall dependencies, rerun passed local suites or overwrite these receipts as a routine rollout step. First validate existing hashes. Deploying requires explicit approval of the artifact, targets, allowed cloud operations and gates below.

## Historical cloud observations are not a fresh preflight

The 2026-10-12 read-only evidence in [RESTART_PREFLIGHT.md](RESTART_PREFLIGHT.md) found 71 ACTIVE Gen 2 functions in europe-west1: the proposed 70 plus unchanged `health`; no Gen 1 or excluded email functions in that region. Storage Rules and two READY indexes matched the candidate. Firestore Rules matched 8106c4a and lacked the replaced-snapshot authorization fix. The bucket had uniform access/public-access prevention, the expected Storage service-agent binding and runtime get/update role. Runtime project/bucket values matched staging without emulator variables. Two active verified memberships existed; the owner's permissions array omitted `event.delete`, but frozen `hasPermission` grants that permission to an active owner membership. No permission repair is inferred; online behavior remains untested. Collaboration was enabled at revision 18, updateTime `2026-09-16T06:11:29.023025Z`. Hosting version `752720637f78079b` was historical, not this artifact.

None of those values is permission to write or proof of today's cloud state. Re-read metadata immediately before a release and after each phase; stop on unknown differences. Do not automatically grant event.delete or replace owner identity. The previous inventory is bounded to europe-west1, not a claim about other regions.

The lead subsequently performed a new authorized read-only preflight in a fresh sandbox on 2026-10-12, without writes. Its normalized pre-pause summary is `.local-data/restart-rollout/20261012T190832342Z-b8521bcc00cb4c5498205bd1bcbfc380/.local-data/restart-preflight-20261012/verified-summary.json`, SHA-256 `27be368e2e94d57e4515302b2108c37158a23328d9de24b5fc92acc20f9b88cb`: 71 ACTIVE nodejs22/default-compute endpoints, matching runtime bucket metadata, two READY indexes and Storage Rules, and collaboration still true at revision 18 with its original updateTime. This fresh **pre-pause** evidence cannot satisfy the guard's false/current audited-control gate. Preserve it and obtain a distinct post-pause read; this reviewer did not execute cloud requests.

## Existing entrypoints and safe fresh read-only preflight

The four retained, ignored scripts below exist and were read during preparation. They use the operator's existing Firebase CLI OAuth session through [cloud.mjs](../tools/staging/cloud.mjs); they do not sign in application clients or mint custom/ID tokens. Normal CLI token refresh may update its external local cache. Credentials stay external; do not print tokens, credential files or SDK config.

Their original fixed relative output paths would overwrite historical evidence when run from the repository root. Instead use a **new repository-descendant sandbox cwd**, with their expected relative input/output layout. Imports resolve relative to the original script, while their outputs resolve inside the new sandbox. `complete.mjs`'s `git show 8106c4a` still resolves the enclosing repository. This preparation only copies frozen local config and makes a new local directory; it changes no application data.

```powershell
$repo = 'C:\Projects\filmovy-kviz-v2'
$artifact = Join-Path $repo '.local-data/restart-release/ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac'
$scripts = Join-Path $repo '.local-data/restart-preflight-20261012'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N')
$sandbox = Join-Path $repo ('.local-data/restart-rollout/' + $stamp)
$out = Join-Path $sandbox '.local-data/restart-preflight-20261012'
if (Test-Path -LiteralPath $sandbox) { throw 'Use a fresh evidence directory.' }
New-Item -ItemType Directory -Path $out | Out-Null
New-Item -ItemType Directory -Path (Join-Path $sandbox 'tools/staging') | Out-Null
Copy-Item -LiteralPath (Join-Path $artifact 'release-inventory.json') -Destination (Join-Path $sandbox 'tools/staging/restart-release-manifest.json')
foreach ($file in @('firestore.rules', 'storage.rules', 'firestore.indexes.json')) {
  Copy-Item -LiteralPath (Join-Path $artifact $file) -Destination (Join-Path $sandbox $file)
}
Push-Location $sandbox
try {
  # Execute only with fresh read-only staging inspection authorization.
  foreach ($script in @('read.mjs', 'inventory.mjs', 'extras.mjs', 'complete.mjs')) {
    node (Join-Path $scripts $script) *> (Join-Path $out ($script + '.log'))
    if ($LASTEXITCODE -ne 0) { throw "Preflight stopped: $script" }
  }
} finally { Pop-Location }
```

Validate Node 22, these retained script bytes and no emulator/endpoint overrides before execution. The scripts write only inside this new sandbox; do not run them from `$repo`. Keep logs ignored, with masked summaries only in the release record. No delete/move of historical receipts is needed.

The preflight is not complete merely because these processes exit 0. `inventory.mjs` records failed GETs rather than throwing; its index pageSize request and `extras.mjs`'s map-field projection were historically rejected with 400. Require the successful replacement index read and revision-matched public-runtime config inspection in `complete.json`. Every failure must be matched to that corrected evidence; any new/unresolved failure is a stop. The runtime inspection checks environment names before its value request, but a concurrent new variable could be transferred into memory and subsequently rejected; this is not a guaranteed field-level exclusion before transfer. Review the precise request projection first. No quiz/registration/contact documents or Storage objects are enumerated. `accounts:batchGet` returns only localId, verification/disabled flags and provider IDs, then hashes identities. Membership masks select status/role/permissions/scope modes/version/session cutoff, not contact/content fields. Error logs are not proved generally redacted: keep them ignored and never print them; report only request status/code and reviewed masked evidence.

Required comparisons against the frozen artifact:

1. Function/Auth/membership metadata lists are fully paginated; the europe-west1 inventory is exactly 70 expected ACTIVE Gen 2 endpoints plus unchanged health; Gen 1 and six excluded email endpoints are absent. Hosting uses pageSize 1 and records the latest returned release, not complete release history. Unknown/missing endpoints or unreachable inventory stops. Region-wide enumeration outside europe-west1 requires an explicit read-scope extension; absence elsewhere is not certified.
2. Service runtime metadata has the staging project/bucket/region and no emulator or credential override. Secret references/params/workers are absent from the candidate. Existing invoker policies must stay unchanged; the expected service-agent and bucket bindings/API states must already exist. No enabling APIs, creating service identities, setting IAM or bucket configuration is approved.
3. Storage Rules source and the two READY index definitions match the copied artifact. Firestore Rules currently differ in the known expected direction; capture current ruleset/release IDs and normalized source hash. Unknown differences require review before write approval.
4. Masked Auth/membership/control state is freshly compatible: active verified authorized operator, existing permissions/scopes unchanged, no implicit grants. Record accessControl revision, boolean and updateTime; do not reuse historical revision 18 as an assumed CAS input.
5. Capture Function updateTime, sourceProvenance/source generation, Cloud Run latestReadyRevision/image/service identity, Hosting release/version and file hashes, project/bucket IAM hashes and Rules releases as before-state. Names/source pointers alone do not prove authorization behavior.

Do not use `tools/event-management/inventory.mjs`: it recursively reads all documents and lists Storage objects. `tools/event-management/preflight.mjs` expects a historical 68-function state/new additions. Historical smoke/seed/qa-identity tools can create Auth identities, sign in clients, obtain tokens or mutate data; they are not read-only preflight. `owner-handoff.mjs`/takeover are not collaboration-pause helpers and would change membership/identity/session state.

## Audited invitation pause

The implemented entrypoint is [pause-collaboration.mjs](../tools/access/pause-collaboration.mjs), with [pure policy](../tools/access/pause-collaboration-core.mjs) and [pinned CLI/store adapter](../tools/access/pause-collaboration-store.mjs). It permits only staging and the default database, defaults to a read-only dry-run, checks the exact existing signed-in CLI operator with no ADC fallback, and commits two writes with no automatic retry: CAS update of collaborationEnabled=false/revision+1/server timestamp preserving all other fields, plus a deterministic create-only accessAudit record. The audit binds release SHA, operator, approving person/reference and before/after revision; the exact artifact receipt is separately bound in the deployment envelope. No identity, membership, invitation or content write is part of this operation.

Create the approval JSON only after explicit approval; never populate a fictitious approval reference. Its exact fields are `projectId`, `releaseSha`, `expectedRevision`, `expectedUpdateTime`, `operatorEmail`, `approvedBy`, `approvalReference`. Use fresh observed revision/updateTime, not the historical values above. The output parent must exist under ignored repository `.local-data`, without a redirecting link, and each output path must be new.

```powershell
$pauseTool = Join-Path $repo 'tools/access/pause-collaboration.mjs'
node $pauseTool --approval $pauseApproval --out $newDryRunJsonl
if ($LASTEXITCODE -ne 0) { throw 'Pause dry-run failed.' }
# Only after review and explicit permission for the two atomic writes:
node $pauseTool --approval $pauseApproval --out $newApplyJsonl --apply --confirm-plan-sha256 $reviewedPlanSha256
if ($LASTEXITCODE -ne 0) { throw 'Pause stopped; reconcile its receipt before any retry.' }
```

Review the dry-run's exact `planSha256`, writes and attribution before apply. `STARTED`/`COMMIT_OUTCOME_PENDING` are not completion. Require the terminal `APPLIED` or reconciled `ALREADY_APPLIED`, exact plan hash/audit name, and `controlUpdateTime`. `OUTCOME_UNCONFIRMED` means inspect the same audit and state with the **same approval**, never change expected revision to force a retry. The adapter verifies audit and control have identical updateTime; a later control write rejects reconciliation even if it restored the same boolean/revision. Close and hash the append-only JSONL before deployment evidence binding. Re-read masked current control metadata after the pause; require false, expectedRevision+1, and exact equality to the receipt's controlUpdateTime. The post-pause read must be at most 30 minutes old when the guard starts. Restoring collaboration is a separate approval, never an automatic finally block.

Pause blocks new invitation creation/acceptance/rotation through the existing activation gate. It does not revoke active memberships, delete pending invites or pause normal content operations. Continue to enforce fresh authorization independently.

## Artifact checksums and exact deployment phases

This existing read-only PowerShell check does not import the runtime or repeat suites:

```powershell
$receiptPath = Join-Path $artifact 'receipt.json'
if ((Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne '3507ab5d2742e50ff1798dfb1ffa1a3c2a166d1643d3c7ec3cd700bdedc5d375') { throw 'Receipt changed.' }
$receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($receipt.releaseSha -ne 'ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac' -or $receipt.projectId -ne 'filmovy-kviz-v2-staging' -or @($receipt.functions).Count -ne 70) { throw 'Target/release mismatch.' }
foreach ($entry in $receipt.checksums.PSObject.Properties) {
  if ((Get-FileHash -LiteralPath (Join-Path $artifact $entry.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) { throw "Artifact changed: $($entry.Name)" }
}
```

Also compare the complete file set excluding receipt and verification node_modules before the first phase, reject extra files/reparse links, and verify the runtime report's receipt/SHA/hash binding. Later phase checks account only for the CLI's local `.firebase` cache and `firebase-debug.log`, as described below; these are not deployable source exceptions. Preserve receipt bytes. The prepared package uses Node 22, codebase default, an exact 70-export entrypoint and no lifecycle scripts. It vendors domain from the frozen SHA. No migration/backfill is required: missing registration revision defaults to zero and increments lazily on real update; optional private automaticAgenda reflects the existing server marker, with unmarked manual content retained.

The artifact's existing `receipt.phases` are the source of arguments, with cwd exactly `$artifact`. There are three phases, not a combined deploy:

| Phase | Existing command after separate approval and gates |
| --- | --- |
| 0 Functions | Node-preloaded [restart-deploy-guard.cjs](../tools/staging/restart-deploy-guard.cjs) + absolute `node_modules/firebase-tools/lib/bin/firebase.js`, passing exactly `$receipt.phases[0]`: deploy, explicit staging/config, `--only` all 70 individual functions, non-interactive. Final operator-tool review remains a gate; raw CLI is not approved as a substitute. |
| 1 Rules | `node $firebase @($receipt.phases[1])`, exactly `deploy --project filmovy-kviz-v2-staging --config firebase.restart.json --only firestore:rules --non-interactive`. |
| 2 Hosting | `node $firebase @($receipt.phases[2])`, exactly `deploy --project filmovy-kviz-v2-staging --config firebase.restart.json --only hosting --non-interactive`. |

Here `$firebase = Join-Path $repo 'node_modules/firebase-tools/lib/bin/firebase.js'`; the installed CLI is pinned to **15.28.2**. `Push-Location $artifact`/`finally Pop-Location` brackets only a single approved phase. Check `$LASTEXITCODE` and evidence after each command; do not automatically run the next phase.

`firebase.restart.json` includes Storage/index paths for comparison, but the only write proposal is the above targets. Do not invoke blanket functions/firestore deploy, pass force, replace the config, deploy health/email, run old `tools/staging/deploy.mjs` (rebuilds and has broad targets), or use old `tools/event-management/deploy-guard.cjs` (49 endpoints, three creates and different receipts).

The new guard uses [restart-deploy-policy.cjs](../tools/staging/restart-deploy-policy.cjs) with the actual pinned CLI planner/build/request formats. It verifies all 70 desired and existing ACTIVE Gen 2 endpoints, preserving health outside the plan; zero creates/deletes/recreates/skips; no params/secret bindings/hooks/non-HTTP triggers; default compute runtime account. It checks the real planner **before source upload**, again before apply, and rechecks receipt/file hashes. The permitted API writes are a fixed staging/west1 generateUploadUrl, PUT to that exact returned signed source capability, and PATCH of the exact 70 known functions using that returned storageSource. API enablement, service identity, IAM/invoker, cleanup and other writes are blocked. Pub/Sub/Eventarc's unused service-identity preparation is skipped only after verified HTTP-only discovery; this neither creates nor proves those identities. Required API checks never enable an API. The explicit deployment CLI account must equal the pause approval operatorEmail; there is no ADC/token fallback.

The frozen config lacks `disallowLegacyRuntimeConfig:true`, and CLI 15.28.2 otherwise reads/materializes legacy Runtime Config when its API is enabled. The operational guard explicitly overrides `functions/projectConfig.shouldUseRuntimeConfig` to false **only for the exact normalized frozen `{codebase:default,source:functions,runtime:nodejs22}` config**, exercising the CLI's supported no-legacy-config branch without editing artifact bytes. It additionally blocks `prepareFunctionsUpload.getFunctionsConfig` and rejects the Runtime Config origin at transport. No legacy config is read or added to the uploaded archive; unexpected config stops. This is a reviewed operator policy override, not a claim the artifact itself contains that setting. Fresh read-only API metadata at 2026-10-12T19:15:05.196Z found RuntimeConfig, Pub/Sub and Eventarc enabled; no API state was changed. Existing public Firebase project metadata is still read as required by CLI preparation.

The guard envelope is a reviewed ignored JSON with exact keys `schemaVersion:1`, `mode:APPROVED_RESTART_FUNCTIONS_UPDATE`, `projectId`, `region`, `releaseSha`, `receiptSha256`, `approvalReference`, `ci`, `preflight`, `pause`. `ci` and `preflight` contain absolute ignored `path` plus SHA-256; `pause` additionally contains `approvalPath` and `approvalSha256`. It validates the recorder's `REMOTE_SUCCESSOR_CI_VERIFIED_NOT_MERGED_OR_DEPLOYED` result, both successful exact-source workflows, frozen workflow hashes and adjacent raw metadata/log hashes. A manually reviewed normalized preflight must use `RESTART_PREFLIGHT_VERIFIED`, release/target, fresh `observedAt`, actual `accessControl`, exact 70+health function name/state/platform/region/serviceAccount metadata, and true `checks` for `apisAlreadyEnabled`, `storageRulesMatch`, `indexesReadyMatch`, `runtimeConfigMatches`, `noEmailEndpoints`, `failuresResolved`. Normalize masked evidence honestly; no implemented entrypoint automatically creates or approves this envelope. Hash its source evidence separately and preserve it. The guard binds the normalized file, not an independent live read or proof that an approver's reference is authentic.

```powershell
$firebase = Join-Path $repo 'node_modules/firebase-tools/lib/bin/firebase.js'
$guard = Join-Path $repo 'tools/staging/restart-deploy-guard.cjs'
# Set paths only after separate Functions write approval and all gates above.
$env:RESTART_ARTIFACT_DIR = $artifact
$env:RESTART_DEPLOY_EVIDENCE = $reviewedDeployEnvelope
Push-Location $artifact
try {
  node --require $guard $firebase @($receipt.phases[0]) *> $newIgnoredFunctionsLog
  if ($LASTEXITCODE -ne 0) { throw 'Functions phase stopped; inspect masked per-endpoint outcome.' }
} finally {
  Pop-Location
  Remove-Item Env:RESTART_ARTIFACT_DIR, Env:RESTART_DEPLOY_EVIDENCE -ErrorAction SilentlyContinue
}
```

Use a new ignored stdout/stderr log path; do not print raw CLI diagnostics. The guard also opens its own new fsynced JSONL next to the envelope, without query signatures/request bodies/tokens. Offline adversarial tests exercise actual planner/conversion/requestURL APIs through synthetic network sinks; they are not cloud runtime/invoker proof. The policy guards Firebase CLI's apiv2 transport, not every possible OS process/network primitive; fixed CLI/config/imports and artifact hashes remain prerequisites. Locally generated CLI `.firebase` cache and `firebase-debug.log` are excluded from immutable artifact enumeration, not from credential/log-handling obligations.

For Rules and Hosting, inspect pinned CLI/config paths and target arguments separately before approval. The Functions guard must not be reused for them; it intentionally rejects those phases. No Rules/Hosting guard or deployment-source-to-Cloud-Build verifier exists in this proposal. Do not describe their execution as mechanically equivalent to the Functions write allowlist.

## Gates between phases and stop conditions

After the approved pause, record/re-read the control state and atomic audit without contacts. Before Functions writes, require exact-source CI and fresh inventory, matching artifact hashes, successful dry-run policy tests and reviewed current execution guard. The plan must show exactly 70 safe updates to existing Gen 2 endpoints, zero create/delete/recreate/skips; health remains outside the plan. Any forbidden write, target drift, missing prerequisite, changed endpoint or hook stops.

After Functions completes, obtain a fresh metadata receipt before Rules. Each of the 70 functions must be ACTIVE at a new recorded updateTime/source generation/build and corresponding ready Cloud Run revision; health metadata must remain unchanged. Compare actual uploaded source/Cloud Build provenance to the intended package through metadata and any separately approved source verification; neither source pointers nor upload hashes alone prove executing source. Verify invoker policies, secret/trigger metadata, APIs and runtime service identities unchanged. Partial deployment must be recorded endpoint by endpoint; stop downstream phases.

After Rules, require the active Firestore release's source equals the frozen artifact, including current event snapshot binding. Keep unchanged Storage Rules/index hashes and READY status. Capture ruleset/release IDs. Rules source equality is a prerequisite, not an allowed/denied runtime proof.

After Hosting, record FINALIZED release/version and compare deployed application file hashes with artifact Hosting files using the Hosting API's SHA-256 of **gzip level 9 bytes**, not the receipt's raw-byte SHA-256. Exactly two Firebase-reserved files (`/__/firebase/init.js`, `/__/firebase/init.json`) are service-generated outside the artifact; bind their hashes to the captured pre-Hosting version, not a blanket exception for extra files. The static-only rewrite, staging label/noindex and email-disabled configuration must match. Ordinary public static HTTP verification is part of approved deployment verification; sign-in and synthetic user journeys require the separate QA scope. Do not use mutation-heavy smoke tools as metadata checks.

Any failure means stop, preserve evidence and keep invitations paused after a successful approved pause. Never claim complete online acceptance from local suites, CI, source provenance or metadata. Concrete post-deploy negative/positive checks and synthetic QA writes need a separately approved identity/resource/cleanup plan. Current tools do not provide a unified read-only 70-function deployed-revision comparison command; the preflight scripts return the metadata for reviewed comparison. Referee grants' active verified issuer compatibility is a separate data-mask/read-scope check if existing grants must continue; do not silently read grants or infer compatibility from global membership counts.

## Compatible recovery, not an automatic rollback

Prefer a reviewed forward fix preserving current membership/resource-scope/lifecycle/snapshot/private-media guards. Returning to aafeaa9 automatically would restore the public-registration revision race and private practice focus bug. Earlier claim-only or pre-disposition backends are incompatible with active restricted memberships/trash data. Old Hosting version 752720637f78079b has no approved compatibility proof.

Keep protective backend and Rules during any separately approved compatible frontend rollback. Do not restore superseded snapshot access, reset registration revisions/tokens, backfill content, erase bucket objects/memberships/audit, reactivate email or unpause invitations as rollback. Record partial Functions/Rules/Hosting state and the exact forward-fix source/artifact/CI gate. Invitation restoration requires a new audited CAS approval after online verification.

Event-night promotion recovery (`Restore-EventNightSnapshot` and its journal) only operates on local demo emulator snapshots. It is not a staging/cloud restore command and must not be run for rollout. Real email, physical projector/audio acceptance, retention/abuse/recovery policy and public launch remain separate completion/approval decisions.
