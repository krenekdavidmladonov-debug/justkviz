# Event-night simplification: bounded release checklist

This checklist describes the integrated candidate, not a deployment receipt.
The standing owner approval in `AGENTS.md` applies after required checks pass.

## Exact target and resources

- Firebase project: `filmovy-kviz-v2-staging`, region `europe-west1`.
- Hosting site: `justkviz-v2`, address `https://justkviz-v2.web.app`.
- Existing Functions: `controlInterimResults`, `controlFinalReveal`,
  `deliverEmailTask`, `saveEventScore`, `saveRefereeScore`, `generatePrintArtifact`.
- Preserve every other deployed Function, current runtime identities, invoker
  policies, numeric secret bindings, Gmail activation policy/cutoff, queue settings
  and public-origin configuration.

Round batching uses an explicit alternate request shape on the **existing**
`saveEventScore`/`saveRefereeScore` callables. There must be no newly deployed
`saveEventRoundScores` or `saveRefereeRoundScores` service. A new Gen 2 callable
normally requires a new resource-local `allUsers → roles/run.invoker` binding;
standing approval excludes new access grants. Reusing the existing endpoint and
its existing ACL avoids that additional grant and keeps authorization in the
current membership/capability transaction. Do not disable invoker checks.

No Rules, indexes, database migrations, history rewrites, new secrets or DNS
changes are required. `previewInterimResults` retains its legacy contract;
`previewFinalResults` retains complete-results semantics. Their shared calculation
code's existing default scope remains unchanged. Other callers of the access
helper retain their existing operation policy. Build inclusion is not a reason to
redeploy unrelated endpoints.

## Before release

1. Review the integrated diff and record its committed SHA. Verify the source
   export inventory still has the expected existing endpoint names only.
2. Run `pnpm check`, focused email/current-results/finale/batch tests and
   `pnpm test:rules` on a local `demo-*` emulator project because trusted write and
   authorization code changes. Passing evidence must match the final source.
3. Build the exact clean release artifact. Confirm the callable metadata and
   Gmail worker secret bindings without invoking a handler or printing secrets.
4. Read the explicit V2 project/Hosting site and the six existing Function
   configurations. Save their compatible previous revisions, source artifacts,
   Hosting version and invoker/identity/secret metadata for limited rollback.
5. Verify that release tooling performs only targeted updates and does not add
   IAM bindings, enable APIs, delete resources or modify queue activation.

## After release

Verify the published HTML/hashed assets against the built artifact, the six
Function revisions/configuration and unchanged resource inventory. Use private
rehearsal or isolated synthetic emulator data for writes; do not edit real quiz
content, modify real scores or send real messages as a release probe.

Confirm the affected controls render and that current standings use a neutral
label, an explicit show/hide action and pages of at most six sanitized rows.
Check exact return from the overlay, incomplete-finals blocking and tied finalist
pagination in the local synthetic contracts. Batch writes must remain atomic,
revision checked and idempotent through the existing endpoints.

Gmail API acceptance cannot verify Email.cz inbox placement. The MIME correction
has offline evidence; received authentication/spam headers are still required to
establish the exact Seznam classification cause. Do not send diagnostic emails
or request wider Gmail scopes to close this gap.

Record deployed SHA, target, new/previous revisions, checks and observed limits.
If a critical regression appears, restore only affected Function/Hosting artifacts
from the recorded compatible release; preserve databases, media, secrets and IAM.
