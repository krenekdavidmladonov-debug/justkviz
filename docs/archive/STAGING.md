# V2 staging (historical)

**Production today:** Firebase project `filmovy-kviz-v2-staging` and Hosting site `justkviz-v2` serve real data at https://justkviz.cz. All tests and seeds belong on local `demo-*` emulators. See [AGENTS.md](../AGENTS.md) for current rules.

The sections below record the former staging setup and procedures. Treat the deployment, seed, smoke and reset commands as historical references only.

Former Hosting URL: https://filmovy-kviz-v2-staging.web.app/

## Resources and safety

- Standard Firestore `(default)`, `europe-west1`, existing least-privilege Rules.
- Email/password Auth, custom-claim staff roles; no production accounts.
- Node 22 Functions in `europe-west1`; private PDF generation stays server-side.
- Hosting SPA, visible STAGING admin label, `X-Robots-Tag: noindex, nofollow`.
- No Firebase Storage bucket or uploads provisioned. The Storage API used by
  the Functions build infrastructure is distinct from application media storage.
- Blaze was enabled manually by the operator. This is not a zero-cost guarantee.
  Billing budgets and alerts should be configured by the operator; they are not spending caps.
- Staging `gcf-artifacts` build images have a 7-day cleanup policy. This affects
  rebuildable deployment images, not Firestore records or user PDF downloads.
- Noindex does not protect data. Rules, role checks, validated callables, and
  management-token verification remain the security boundaries.

## Deploy a reviewed main

### Hosting-only delivery

From a clean, reviewed commit with passing CI, run with Node 22:
`node tools/staging/deploy.mjs filmovy-kviz-v2-staging --hosting-only`.
This mode preserves all staging environment guards and rejects target/resource overrides,
hooks, backend rewrites and pinTag. It builds only the domain/frontend, checks the
frontend output, then gives Firebase CLI a generated configuration containing only
the fixed Hosting site and absolute frontend build directory, with `--only hosting`.
No Functions packaging, Rules/indexes, Storage, Auth or seed runs in this mode.
The ignored `.local-data/staging/hosting-<SHA>.json` records the exact commit and
previous/new release/version for rollback investigation. No automatic rollback runs.

### Full staging deployment

The former full deployment used Node 22, installed workspace dependencies and
an operator Firebase CLI login. It built in explicit staging mode, packaged
Functions locally and deployed Firestore Rules/indexes, Functions and Hosting.
The old launcher is now [DEPLOY_PRODUKCE_POZOR.cmd](../tools/legacy/DEPLOY_PRODUKCE_POZOR.cmd).
The underlying Hosting deploy path has been retired.

The generated Functions source is under `.local-data/staging/functions`. It contains
compiled application/domain code and dependency metadata, not the rest of `.local-data`.
`tools/staging/functions-package-lock.json` pins the cloud runtime dependencies;
the wrapper uses `npm ci`, and dependency changes require an intentional lock update.
No `.env.local` changes are needed. Production or mixed-target builds fail closed.
Do not bypass the wrapper with a generic `firebase deploy` or a production alias.

## Synthetic bootstrap and manual testing

After deployment, run `node tools/staging/seed.mjs filmovy-kviz-v2-staging` once.
It uses the operator OAuth session in memory, never exports a service-account key,
and refuses emulator credentials/hosts and any other project. Existing local seed
and migration guards are unchanged.

Credentials and one-time management tokens are saved only in Git-ignored
`.local-data/staging/seed.json`. Never paste this file into an issue, PR, or report.
Accounts: `admin-staging@example.test`, `moderator-staging@example.test`, and an
ordinary `user-staging@example.test` for negative security checks. Each has a
random password; local emulator passwords are not used in the cloud.

The seed creates two entirely invented quizzes, each 5 rounds × 10 questions,
two locked READY events, one open registration (20 teams, 100 people, 2–6 members),
two accepted teams and one cancelled team. No V1 exports or media IDs are read.
Registration opens for 29 days; the admin may adjust its window for later testing.

Run `node tools/staging/smoke.mjs filmovy-kviz-v2-staging` for bounded real-backend
checks. It creates only synthetic records and cancels its management/capacity cases.
Browser checks use the same HTTPS URL; do not run local tests against cloud by
changing `demo-*` environment values.

## Reset policy

There is deliberately no broad delete command. The seed refuses a second run.
For a reset, stop test activity, use the ignored seed manifest to identify exact
staging users/quizzes/events, and review a scoped cleanup of those IDs and their
snapshot/registration descendants before deleting anything. Never delete an entire
project or use V1 exports. Preserve an incomplete manifest to recover partial seeds;
do not remove it simply to bypass the duplicate guard.

## CI and preview channels (deferred)

The existing PR checks remain local/emulator-only. No cloud deployment workflow is
enabled and no credentials are created in this task. Future main → staging deployment
should use GitHub OIDC Workload Identity Federation with a dedicated least-privilege
staging service account and a protected `staging` GitHub environment. Suggested identity
configuration names: `STAGING_WIF_PROVIDER`, `STAGING_DEPLOY_SERVICE_ACCOUNT`;
project ID is a non-secret variable `STAGING_PROJECT_ID`, checked against the allowlist.
Do not store service-account JSON keys or Firebase refresh tokens in repository files.

Feature PR → temporary Hosting preview is optional future work. It must use the
same staging backend and never V1. Do not deploy untrusted fork code with credentials.

## Bootstrap verification — 2026-09-07

Hosting, all 40 exported Functions, Firestore Rules/indexes and synthetic bootstrap
were deployed to the dedicated staging project. An initial Cloud Run 500 for the
PDF Function succeeded on a targeted retry; no production service was contacted.

- `pnpm check`: PASS (typecheck, lint, workspace builds; no migration execution).
- Staging project/config guards: PASS.
- Firestore Rules emulator: 19 PASS.
- Targeted events/registrations/live/PDF security unit tests: 48 PASS.
- Real backend smoke: private access/direct-write denial, staff roles, publicEvents,
  immutable snapshots, registration min/max/name/capacity, management edit/cancel,
  private answer-key authorization, all PDF formats, NEXT/PREVIOUS and recap: PASS.
- Chromium on deployed HTTPS: public create/edit/cancel, admin event/registrations,
  five PDF previews/downloads, projector popup/navigation/recap: PASS. Test-only
  heading/button locator mismatches were corrected; completed areas were not rerun.
- All five downloaded PDF variants are free of test emails. Representative sheet,
  answer-key and score-table pages were visually checked with Poppler.

Full V1 migration and full local repository E2E were not rerun. Existing PR CI
continues its own synthetic/emulator gate; it has no staging deployment credentials.
