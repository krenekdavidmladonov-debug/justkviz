# Documentation index

Firebase project `filmovy-kviz-v2-staging` and Hosting site `justkviz-v2` are production at https://justkviz.cz. Older staging test procedures are historical. See [AGENTS.md](../AGENTS.md) for current rules.

This directory indexes JustKvíz V2 product, architecture, security, migration, editor, projector and event decisions. Implementation contracts describe local code; they do not establish current cloud readiness. Research and historical records do not override current implementation contracts or authorize deployment.

## Current local integration and release planning

- [COMPLETION_MATRIX.md](COMPLETION_MATRIX.md) — existing product completion conditions, concrete evidence, active gaps and external acceptance gates.
- [COMPLETION_VALIDATION.md](COMPLETION_VALIDATION.md) — successor `ddb862f`, four reviewed fixes, exact-SHA tests, offline artifact/runtime verification and the next concrete release boundary.
- [OPERATOR_PREPARATION_VALIDATION.md](OPERATOR_PREPARATION_VALIDATION.md) — locally reviewed CAS/deployment tools, 23 targeted tests, actual emulator and fresh read-only staging evidence.
- [STAGING_ROLLOUT_DDB862F.md](STAGING_ROLLOUT_DDB862F.md) — executable staging rollout proposal, exact artifact, operator inputs, phase gates and recovery limits.
- [STAGING_ACCEPTANCE_DDB862F.md](STAGING_ACCEPTANCE_DDB862F.md) — separate synthetic identity/resource/cleanup proposal and remaining online acceptance prerequisites.
- [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) — dated restart/integration evidence, validation results, remaining work and the 2026-10-12 owner approval aligning [AGENTS.md](../AGENTS.md) with active server-managed membership, concrete permissions and resource scope.
- [RESTART_VALIDATION.md](RESTART_VALIDATION.md) — tested commits, pinned runtime, local receipt/log paths, resolved test failures and remaining verification limits.
- [RESTART_PREFLIGHT.md](RESTART_PREFLIGHT.md) — approved read-only V2 staging inventory, current invitation state, cloud differences and remaining release prerequisites.
- [RESTART_RELEASE_PLAN.md](RESTART_RELEASE_PLAN.md) — unified staging scope, release inventory, approval prerequisites and fail-closed rollback; read-only V2 staging preflight was authorized on 2026-10-12, while cloud writes and deployment require separate approval.

Older branch names, cloud inventories and online receipts in individual release documents are historical context. Use the dated status and restart plan for current coordination; invitations, owner setup and actual email provisioning require their separate gates.

## IMPLEMENTED

### Development baseline

- [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md) — established branch, test and worktree conventions; current restart coordination is recorded above.

### Core, security, and V1 migration

- [ARCHITECTURE.md](ARCHITECTURE.md) — repository shape and trust boundaries.
- [DATA_MODEL.md](DATA_MODEL.md) — private and public Firestore models.
- [SECURITY.md](SECURITY.md) — authorization, answer secrecy, emulator safeguards, and Rules policy.
- [PERSONAL_ACCESS.md](PERSONAL_ACCESS.md) — current active membership, permission/scope, account, invitation and revocation contract; legacy claims are not authority.
- [PERSONAL_ACCESS_REVIEW.md](PERSONAL_ACCESS_REVIEW.md) — bounded review evidence and documented access limitations; not current cloud verification.
- [MIGRATION_V1.md](MIGRATION_V1.md) — fail-closed local V1 migration procedure and invariants.
- [V1_MIGRATION_REPORT.md](V1_MIGRATION_REPORT.md) — sanitized verification evidence for the lossless offline migration.

Managed exports and extracted documents are local-only under Git-ignored `.local-data/`. They are never CI fixtures or deployable assets.

### Editor and UX foundation

- [QUIZ_EDITOR.md](QUIZ_EDITOR.md) — canonical product and persistence contract for the implemented editor.
- [COMPLETE_EDITOR_RELEASE.md](COMPLETE_EDITOR_RELEASE.md) — integrated draft/ready authoring, independent answer mode, media and private rehearsal contract; earlier online evidence and branch-specific release tooling are historical.
- [EDITOR_WORKING_COPY.md](EDITOR_WORKING_COPY.md) — shared in-memory edits, Save all, sequential revisioned writes, partial retry and explicit conflict reload.
- [EDITOR_OUTLINE.md](EDITOR_OUTLINE.md) — question movement within/between rounds, keyboard alternative and recovery from partly applied moves.
- [ROUND_FIRST_EDITOR_USER_GUIDE.md](ROUND_FIRST_EDITOR_USER_GUIDE.md) — moderator/admin workflow and field behavior.
- [ROUND_FIRST_EDITOR_DEVELOPER_GUIDE.md](ROUND_FIRST_EDITOR_DEVELOPER_GUIDE.md) — semantic model, mutation boundary, and lossless extension rules.
- [ROUND_FIRST_EDITOR_TESTING.md](ROUND_FIRST_EDITOR_TESTING.md) — local setup and verification matrix.
- [ROUND_FIRST_EDITOR_IMPLEMENTATION_REPORT.md](ROUND_FIRST_EDITOR_IMPLEMENTATION_REPORT.md) — sanitized implementation evidence.
- [UX_IMPLEMENTATION_FOLLOWUPS.md](UX_IMPLEMENTATION_FOLLOWUPS.md) — explicitly deferred follow-ups around the implemented UX foundation.

### Projector and media

- [LIVE_SESSION.md](LIVE_SESSION.md) — trusted live-session lifecycle.
- [PROJECTOR_ARCHITECTURE.md](PROJECTOR_ARCHITECTURE.md) — projector renderer, recap, and public-state authority.
- [MEDIA_ARCHITECTURE.md](MEDIA_ARCHITECTURE.md) — audio/video commands and player lifecycle.
- [MEDIA_STORAGE.md](MEDIA_STORAGE.md) — implemented quiz-owned image/audio uploads, immutable asset references, protected reads, and deployment prerequisites.
- [MEDIA_AUTHORING_RELEASE.md](MEDIA_AUTHORING_RELEASE.md) — media picker/authoring contract and release scope; historical cloud assumptions require fresh verification.

### Preflight and guided repair

- [QUIZ_PREFLIGHT.md](QUIZ_PREFLIGHT.md) — canonical readiness, blocker/warning, editor/live, media, and security contract.
- [QUIZ_PREFLIGHT_IMPLEMENTATION_REPORT.md](QUIZ_PREFLIGHT_IMPLEMENTATION_REPORT.md) — sanitized implementation and verification evidence.

### Events Foundation

- [EVENTS_ARCHITECTURE.md](EVENTS_ARCHITECTURE.md) — event CRUD/lifecycle, capacity configuration, immutable snapshots, preflight lock/relock, and public projection contract.
- [EVENTS_SECURITY.md](EVENTS_SECURITY.md) — event, snapshot, `publicEvents`, Rules, and trusted Function boundary.
- [EVENTS_FOUNDATION_IMPLEMENTATION_REPORT.md](EVENTS_FOUNDATION_IMPLEMENTATION_REPORT.md) — sanitized implementation and verification evidence.
- [EVENT_MANAGEMENT.md](EVENT_MANAGEMENT.md) — lifecycle/disposition, archive/trash/restore, transactional guards, capability revocation and bounded deletion ownership.
- [EVENT_MANAGEMENT_REVIEW.md](EVENT_MANAGEMENT_REVIEW.md) — historical independent review of the event-management release; not a fresh cloud inventory or current acceptance result.
- [EVENT_FORM_UX.md](EVENT_FORM_UX.md) — event form layout correction and its historical verification evidence.

- [REGISTRATIONS.md](REGISTRATIONS.md) — implemented public registration, management links, staff workflow, capacities, and PDF roster contract.
- [EVENT_TEAM_TOOLS.md](EVENT_TEAM_TOOLS.md) — admin-only manual teams, canonical PDF roster and public registration link/QR.
- [REGISTRATION_SECURITY.md](REGISTRATION_SECURITY.md) — transaction, token, privacy, and Rules invariants.

### Scoring, referee access, and results

- [EVENT_SCORING.md](EVENT_SCORING.md) — internal round scoring, stable registration/team binding, half-points, revisions, and score history.
- [REFEREE_ACCESS.md](REFEREE_ACCESS.md) — event-scoped referee capabilities, minimal read models, revocation, and scoring authorization.
- [INTERIM_RESULTS.md](INTERIM_RESULTS.md) — moderator-reviewed interim ranking and explicit sanitized projector publication.
- [FINAL_REVEAL.md](FINAL_REVEAL.md) — confirmed final ranking, staged placement reveal, and manual session end.
- [HISTORICAL_RESULTS.md](HISTORICAL_RESULTS.md) — read-only completed-event results from the exact confirmed `finalVersions` document, without recomputing scores.

### Email

- [TRANSACTIONAL_EMAIL.md](TRANSACTIONAL_EMAIL.md) — durable registration email intents, templates, replay handling, and organizer status.
- [GMAIL_DELIVERY.md](GMAIL_DELIVERY.md) — implemented delivery worker, fake local transport, and prerequisites for real cloud delivery.
- [EVENT_TEAM_EMAIL.md](EVENT_TEAM_EMAIL.md) — admin-confirmed organizational messages, recipient snapshots, and delivery history.

These documents describe email code and prior verification. The restart candidate keeps team email disabled and excludes real email worker provisioning/activation; see [RESTART_RELEASE_PLAN.md](RESTART_RELEASE_PLAN.md).

### PDF Print Center

- [PRINT_CENTER.md](PRINT_CENTER.md) — immutable-snapshot print flow, deterministic engine, layouts, and limits.
- [PDF_SECURITY.md](PDF_SECURITY.md) — authorization matrix, request allowlist, privacy, logging, and abuse controls.

Print rosters use the accepted registrations and manual teams documented in [REGISTRATIONS.md](REGISTRATIONS.md) and [EVENT_TEAM_TOOLS.md](EVENT_TEAM_TOOLS.md). Internal scoring uses those same stable team IDs; publication follows the separate results contracts above.

### Local QA and event-night tooling

- [LOCAL_QA.md](LOCAL_QA.md) — one-click Windows QA launcher, tool discovery, localhost ports, and identity-checked process handling.
- [EVENT_NIGHT_LOCAL.md](EVENT_NIGHT_LOCAL.md) — reusable production-build localhost preview, persistence, backup, stop, and recovery tooling.

`OPEN_V1_FALLBACK.cmd` remains a manual-only link to the untouched V1 fallback. Automated tests must not open it or contact V1. Candidate manifests, repair progress, emulator snapshots, real-question screenshots, and media audit data remain under `.local-data/` or on historical branches.

## RESEARCH — NOT IMPLEMENTED

The discovery documents below remain research rather than shipped behavior or authorization contracts. Registration, team binding, scoring, referee access, results, email, and owned media now have implemented contracts linked above. Remaining research includes offline operation and media retention/cleanup; implemented email and media code still has explicit cloud setup prerequisites.

Supporting product and UX discovery documents:

- [ADMIN_UX_SPEC_DRAFT.md](ADMIN_UX_SPEC_DRAFT.md)
- [DESIGN_SYSTEM_DRAFT.md](DESIGN_SYSTEM_DRAFT.md)
- [EDITOR_UX_SPEC_DRAFT.md](EDITOR_UX_SPEC_DRAFT.md)
- [INFORMATION_ARCHITECTURE_DRAFT.md](INFORMATION_ARCHITECTURE_DRAFT.md)
- [QUIZ_BEHAVIOR_SPEC_DRAFT.md](QUIZ_BEHAVIOR_SPEC_DRAFT.md)
- [PRODUCT_DECISIONS_REQUIRED.md](PRODUCT_DECISIONS_REQUIRED.md)
- [UX_PRODUCT_DECISIONS_REQUIRED.md](UX_PRODUCT_DECISIONS_REQUIRED.md)

The separate research branches are intentionally not part of `integration/v0.3-development`.

## HISTORICAL — NOT THE CURRENT DEVELOPMENT CONTRACT

These records preserve earlier planning, staging bootstrap and release/operational evidence. They do not establish today's cloud configuration, authorize deployment or override current implementation contracts:

- [STAGING.md](STAGING.md) — historical staging bootstrap/runbook, including legacy claim roles and then-observed infrastructure.
- [ROADMAP_V03.md](ROADMAP_V03.md) — 2026-09-03 planning baseline, not the current implementation inventory.

- [TOMORROW_RELEASE_CHECKLIST.md](TOMORROW_RELEASE_CHECKLIST.md)
- [TOMORROW_RELEASE_AUDIT.md](TOMORROW_RELEASE_AUDIT.md)
- [TOMORROW_5_MINUTE_GO_NO_GO.md](TOMORROW_5_MINUTE_GO_NO_GO.md)
- [TOMORROW_MANUAL_ACTIONS.md](TOMORROW_MANUAL_ACTIONS.md)
- [TOMORROW_FALLBACK_PLAN.md](TOMORROW_FALLBACK_PLAN.md)
- [EVENT_NIGHT_5_MINUTE_CHECK.md](EVENT_NIGHT_5_MINUTE_CHECK.md)
- [EVENT_NIGHT_FAILURE_CARD.md](EVENT_NIGHT_FAILURE_CARD.md)
- [RELEASE_CANDIDATE_AUDIT.md](RELEASE_CANDIDATE_AUDIT.md)

V1 remains the production fallback. No V2 deployment is implied by any historical document.
