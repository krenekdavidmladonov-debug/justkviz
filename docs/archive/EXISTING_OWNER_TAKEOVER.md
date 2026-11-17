# Explicit takeover of the existing staging administrator

This is an operator-only procedure. It is never imported by the app or exported by Functions and requires no deployment. The normal `owner-handoff.mjs` still rejects every historical staging fixture identity. The shared historical denylist was moved without broadening it; the exception CLI permits only its original administrator, whose exact current personal email must be supplied privately.

The old prohibition existed because the administrator was a shared staging fixture with saved test credentials. Verified email is not proof that its old password or sessions have been replaced. Changing email keeps the Firebase UID and its history. There is no nickname login: the application calls Firebase email/password sign-in directly.

## Prerequisites

- Fresh server confirmation of the exact staging project, unique approved UID/email, verified/enabled Auth account, password-only provider and no additional custom-token, phone, tenant or email-link route.
- The exact active manager membership, full permissions and all quiz/event scopes, including its expected version and canonical data digest.
- No existing owner in the canonical `memberships` collection. This is rechecked transactionally, alongside `accessControl/state`, when writing.
- Legacy QA credentials retired. Current smoke tools refuse old manifests and require isolated `staging-qa-*` identities. Old ignored scripts must not be given the person's new password. Local dev/CI seed resets remain restricted to localhost and `demo-*`; the historical cloud seed creates new users only and does not reset existing accounts.
- A server-recorded password baseline and observation timestamp. The account holder must change their password in `/account`; the operator must never read, generate, enter or transmit it. Apply requires `passwordUpdatedAt` later than both recorded values. If an already completed personal rotation is established, use its pre-rotation baseline evidence rather than requesting another rotation.
- Targeted tests, independent review and CI for the exact operator-tool SHA. No application-wide rollout or personal login impersonation is necessary.

## Private inputs and commands

Store input files outside Git. The approval has exactly these fields: `mode` (`take-over-existing-staging-admin`), `projectId`, `targetUid`, `targetEmail`, `expectedMembershipVersion`, `expectedMembershipDigest`, `passwordBaselineUpdatedAt`, `passwordObservedAt`, `qaRetirementDigest`, `approvalReference`, and `reason`. Identity values are never examples or public fixtures. The retirement report contains `retired: true`, `protectedUidDigest`, and the path/SHA256 of each retired local seed manifest. The CLI verifies those files still contain only a retired administrator slot, without email/password.

Run `node tools/access/existing-owner-takeover.mjs --approval <private-file> --qa-retirement <private-report>` for a read-only plan. An unchanged password returns `WAITING_FOR_PASSWORD_CHANGE`; no sessions or access are changed. Review the complete plan and its SHA256. Apply the same command with `--apply --confirm-plan-sha256 <reviewed-hash>` only after all conditions are met. There is no force or skip option. The operator's existing Firebase CLI OAuth session is used in memory and its actual subject/email is verified with Google before audit attribution. No new IAM role, key, ADC file, user token or secret is created.

Keep stdout/evidence private: plans include access state and the verified operator identity. No password, password hash, refresh token or ID token is requested by the metadata lookup or written to evidence.

## Ordering, concurrency and partial failure

1. Recheck current Auth, reviewed membership and password rotation. A Firestore transaction rereads the member, all owners, canonical control and deterministic operation audit. It writes only the target's `sessionValidAfter`, increments its version and control revision, and creates an append-only cutoff intent.
2. Call Firebase Auth `revokeRefreshTokens` only for that UID, then read back Auth validity and identity. The existing server and Rules reject `auth_time <= sessionValidAfter`; refresh revocation alone is not treated as proof that captured ID tokens are rejected. These two stores are **not one atomic transaction**.
3. A second Firestore transaction repeats the owner query/control and exact member-state checks, assigns the existing `owner` grant, increments version/control revision, and creates one deterministic `approved-owner-bootstrap` audit. The audit attributes the action to the actual Google operator and records the private approval reference and reason.

The target remains an active manager if the process fails after step1. The intent identifies that Auth revocation might still be incomplete. Retry the same approval/plan; changed identity, password or membership requires a fresh review. The final audit proves completed Auth revocation. Competing first-owner transactions share canonical control, so only one can complete. A completed retry reads the owner/audit state and is a true no-op. A concurrent run that already attempted Auth revocation explicitly reports that attempt, even if another run completed ownership first.

No other membership, claims, profile, password, email, quiz, media, author or snapshot is written. Existing access scope is retained. Audit is append-only. Do not roll back to claim-only authorization or delete audit to retry.

## Validation and handoff

`node --test tests/access/owner-takeover.test.mjs` covers approval/identity/project failures, enabled/verified state, other login routes, incomplete security, existing owner, read-only planning, partial recovery, concurrency, idempotence and QA retirement guards. `tests/access/owner-takeover-emulator.mjs` uses only new synthetic identities: it rotates a synthetic password, captures an old ID token, executes this mechanism with actual Firestore transactions/Auth revocation, and proves old-token denial by existing server handlers and direct Firestore Rules after promotion. Fresh synthetic password sign-in succeeds. It also tests two competing first-owner operations. The focused CI workflow runs these checks and existing Rules tests.

After a real operation independently read the target membership, Auth revocation state, final audit and preservation fingerprints. Tell the account holder to sign in again with their own personal credentials. Do not claim that the operator's server read or synthetic test proves their real interactive login.
