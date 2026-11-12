# Personal accounts and scoped access

## Listing users and granting access

The user list contains server-managed memberships, not the Firebase Auth account
directory. Signup grants no permissions and creates no administrator approval
request. To grant access to a new or existing verified account, an authorized
manager with current `users.manage` permission creates a same-email invitation,
shares its one-use link, and the user accepts it. The current issuer, permission
dependencies, resource scopes and
activation are checked again by the server. Accepting the invitation creates the
membership; registering or signing in alone does not.

Users/invitations and audit load and retry independently. A failed or delayed audit
request does not hide an available user list. Retrying reads preserves filters,
the access editor and a newly created invitation link. Responses from an earlier
identity or superseded request cannot restore protected data. An authorization
denial from the user-list request clears protected user and audit results.

Audit accepts stored Firestore timestamps and legacy ISO strings and normalizes
them to ISO strings without rewriting history; an invalid time is returned as
`null` and displayed as unavailable. Mixed stored types retain Firestore's existing
type-based query ordering, so the bounded audit query does not guarantee
chronological ordering across those types.

The overview reports the strict activation boolean; a paused/unconfirmed module
disables creation/reissue while existing memberships and revocation remain
manageable. Read/mutation errors identify the callable and error code; callable
errors retain their original type, code and details.

This module extends the existing JustKvíz Firebase Authentication, editor, event, projector and registration system. It adds no identity provider, email delivery infrastructure, organization hierarchy or GCP IAM role.

## Identity and personal setup

The staging identity inventory contained only the three synthetic `*-staging@example.test` accounts. The displayed nick is Firebase Auth `displayName`; login already uses email/password. A cloud operator is not an application owner.

The user creates their own personal account at `/account`, enters their own email/password there, and follows Firebase's verification email. Account creation grants no membership. The reviewed operator procedure in `tools/access/owner-handoff.mjs` can then add ownership for an exact approved, verified personal UID/email. It defaults to a dry-run and requires the exact reviewed plan hash to apply. No browser Function creates owners. The CLI leaves all old accounts, historical authors, quiz documents, media and immutable snapshots unchanged. Suspending shared accounts after verified handoff is a separate explicit decision.

**Actual personal handoff: ČEKÁ NA NASTAVENÍ OSOBNÍHO ÚČTU.** No approved personal identity has been supplied. Automated synthetic password tests cannot fulfill that step.

`/account` supports profile name, verification, Firebase password recovery, reauthentication, verified email change, password change and all-device signout. The latter invalidates the current session too. Passwords go through Firebase SDK APIs only. Reset and verification delivery use Firebase Auth; invitation links are copied manually and do not depend on team emails. Existing accounts sign in without a reset or duplicate identity.

## Current authority

`packages/quiz-domain/src/access.ts` defines every permission, dependency, role preset and scope. A label alone grants no content access. Every operation requires an active membership, its concrete permission and applicable resource scope. Claims are neither broadened nor used as staff authority.

| Preset | Default operations | Content scope |
| --- | --- | --- |
| Owner | All current permissions; managing managers | Whole space only through reviewed bootstrap |
| Manager | All current permissions; delegates ordinary collaborators within own grant | Explicit none/own/selected/all |
| Creator | Quiz create/read/edit, answers, notes, media, export; no deletion or people | Explicit quiz scope; no automatic event access |
| Moderator | Event read/live, snapshot answers/notes, answer-free print documents | Assigned events; no source-library permission |
| Referee | Event read and score | Assigned events |
| Viewer | Quiz/event read | Assigned content; no answers, notes, contacts or writes |

Presets remain editable. Choosing one changes permissions but retains the selected scopes visibly. Dependencies produce validation errors; they are never silently added. Only owners may delegate `users.manage` or manage a manager. Nobody changes their own membership through the API. Ownership creation is operator-only; removing an existing owner is serialized with owner-count checks.

`none` and empty `selected` mean no resources. `own` uses immutable `createdBy`; historical authors are not rewritten. An actor with only `own` scope cannot delegate someone else's `own` scope. Delegation of selected resources requires a subset of the actor's explicit selection, `all`, or transactionally verified ownership of every selected document. Ownership is rechecked again when an invitation is accepted. Creating a quiz/event with empty/selected scope atomically adds its ID to its creator's membership. Events authorize their assigned immutable snapshot, not arbitrary source quizzes or historical snapshots.

## Data ownership

- `memberships/{uid}`: active/suspended, role label, permission array, quiz/event scopes, monotonically increasing version, sessionValidAfter cutoff, safe identity metadata. Only server writes; a user may get their own document to react to revocation.
- `accessInvites/{id}`: normalized email, validated grant, version, invited/accepted/revoked status, 7-day expiry, issuer and timestamps. Only a SHA-256 domain-separated random-token verifier is stored. Accepting compares the actual verified Auth email and consumes the verifier transactionally. Reissue invalidates the old link. Current issuer authority is rechecked inside the acceptance transaction.
- `accessControl/state`: global management transaction revision and `collaborationEnabled`. Invitation creation/acceptance/reissue fail closed until activation; revocation remains available. Updating the revision preserves the activation field.
- `accessAudit/{id}`: append-only server events with actor, target, timestamp and before/after grants or safe operation metadata. No passwords, invite tokens, quiz answers or team contacts. Clients cannot write or delete audit entries. Staging audit traces survive QA cleanup.
- Existing quiz media upload documents additionally bind `membershipVersion` to the upload grant.

Indexes: `accessInvites(email ASC, status ASC)` and `memberships(role ASC, status ASC)`. Other new queries use single-field indexes, document IDs or bounded explicit resource reads.

## Server boundaries and revocation

`functions/src/access/authorization.ts` enumerates legacy staff callable policies and fails closed for unknown names. It checks current Auth state, verified email, current membership and scopes; `runAccessTransaction` rereads membership in each transaction attempt, causing a concurrent permission change to conflict with a delayed save. Optimistic content revisions remain enforced. Client-supplied actor, role, scope and authority fields are not accepted as authority.

Private list/editor/event/roster/snapshot/media-picker reads use `readAccessData`, which queries only the permitted IDs/owner filter. It removes answers, answer media, notes, raw/legacy fields and contacts server-side according to permissions. Raw direct quiz reads require all sensitive quiz permissions plus scope; raw event reads additionally require contact/answer/note permissions. Event-only moderators never gain direct source/snapshot reads. Direct data writes remain denied. Idempotency records and unknown collection paths remain server-only.

The editor verifies answer edit, note edit and media attachment independently. Redacted saves restore protected fields and unchanged legacy placeholders from the authoritative server document, preserving exact hidden answers/notes and unknown legacy data. Existing question options, their order and question-kind changes require answer edit permission: otherwise validation could expose hidden answers or reinterpret legacy letter answers. Deletion and round removal require delete permission even with a forged `mode` field. Choice repair requires answer edit permission.

Locking a quiz into an event requires source quiz export, answer-read and note-read permissions, because the immutable snapshot contains both private fields. Event answer/note permissions alone cannot grant access to private source fields through a new snapshot.

Storage permits only a matching unexpired, create-only upload grant for a current member with the same membership version and scope. Downloads are denied in Storage Rules and served through `readQuizMedia`, which verifies Auth/membership/scope before and after byte IO. An event's media is restricted to its snapshot. Answer bytes require answer-read permission. The print endpoint independently requires event export and, for answer keys, both answer-read and answer-key-export. Public projector delivery still derives only from explicitly revealed publication state.

Anonymous registration and existing referee capabilities retain their original bounded authorization and limiters. An authenticated caller to referee capability Functions must also have current scoped event authority; a legacy capability does not broaden that logged-in user's membership.

Issuing or rotating a referee link requires both event management and scoring permission. Revoking one requires event management. Every bearer request also checks the current active, verified issuer and their management/scoring permissions and event scope in the scoring transaction. Old grants use `createdBy`; new grants record `issuedBy`, and rotation explicitly transfers issuance to the authorized rotator. Removing issuer authority therefore invalidates old anonymous links without waiting for expiry. Staging preflight must verify that any original grants have an identified compatible issuer before release.

Revocation changes membership immediately, without waiting for token expiry. All-device logout also records a server cutoff and revokes refresh tokens. Private UI watches its own server membership, stops pending polls and remounts on identity/version changes so drafts do not transfer to another user. There is no promise to erase data already downloaded by a user.

Private live subscriptions accept only server-confirmed snapshots. Subscription failure clears private session/slides; leaving the page or changing identity invalidates the command queue before any previously queued, unsent command can use a subsequent identity. A browser regression switches two accounts within the same SPA and checks cached private state and queued playback commands.

## Deployment gate and rollback

The only permitted cloud target is `filmovy-kviz-v2-staging`. `tools/access/staging-memberships.plan.json` is an additive dry-run plan for the exact existing synthetic identities; it promotes none to owner. Verify identity/email/provider/claims again before applying create-only membership records. Preserve unrelated claims and all content.

The existing synthetic moderator has a separately enumerated compatibility grant for its prior quiz/answer/note reads, live control, scoring, contacts and answer-free print. It gains no quiz writes, event management, answer-key export or people management. This is not the default preset for newly invited moderators.

The installed Firebase CLI creates each new callable service with a resource-local `allUsers → roles/run.invoker` binding. These nine IAM writes need an explicit exception to the user's cloud-IAM prohibition before deployment. They allow HTTP invocation of the callable transport; every data operation still checks Auth, current membership and scope. This is not a grant of project/console privileges to collaborators. Required APIs must already be enabled; do not enable additional APIs or change runtime service-account roles automatically.

1. Require local checks and complete regression suite, exact-head CI, and independent security review of every legacy path, direct query, Rules, media and print gateway.
2. Keep invitations disabled. Initialize only reviewed compatibility memberships. Do not create restricted active collaborators while any old unrestricted backend remains deployed.
3. Deploy the explicit Function inventory in `tools/access/deployment-manifest.json`, Firestore indexes, Firestore Rules, Storage Rules, then the matching frontend. Compare the actual deployed Function/source/build inventory, not just names in the new module. No blanket deploy; no team-email worker or infrastructure changes.
4. Verify allowed/denied online flows with isolated QA identities and restore original content fingerprints. Only then explicitly set `accessControl/state.collaborationEnabled=true` with an audited release action.

### Operator pause preparation

`tools/access/pause-collaboration.mjs` is a separate operator tool, not a deployed Function or permission grant. Its default action reads the fixed V2 staging control/audit documents and prints a plan. A reviewed JSON supplies `projectId`, `releaseSha`, `expectedRevision`, exact `expectedUpdateTime`, `operatorEmail`, `approvedBy` and `approvalReference`; `--approval <file> --out <new-ignored-jsonl>` is required. Application requires explicit `--apply --confirm-plan-sha256 <dry-run-hash>` after human approval. The tool permits only the pinned Firebase CLI and the exact signed-in operator email; it does not fall back to ADC or emulator credentials.

The single Firestore commit checks updateTime, changes only collaborationEnabled from true to false, revision +1 and server updatedAt, and creates a deterministic `accessAudit/collaboration-pause-<approval-digest>` document atomically. The audit binds the release, operator account, human review reference and before/after revision. Other fields, memberships, invitations and content remain untouched. Explicit mutation retries are disabled. The ignored append-only receipt records intent before the request; an unknown outcome must be reconciled using the same approval/audit, never by changing the expected revision. If state has advanced after a successful operation, reconciliation stops for review. This tool cannot resume invitations and does not itself provide human approval.
5. Preserve security audit history; remove only owned QA Auth identities, content, uploads, sessions and invitations. Do not delete original limiter or content documents.

If any gate fails, keep invitations disabled and do not announce release completion. After introducing restricted members, rollback must retain current membership enforcement: deploy a forward fix, or first suspend restricted accounts and disable invitations with current Rules in place. Never restore the old claim-only backend over active restricted users.

The owner handoff needs a local approval JSON containing exactly: `projectId`, `targetUid`, `targetEmail`, `expectedMembershipVersion` (0 if absent), `approvalReference`, `approvedBy`. It contains no password or credential. Run `node tools/access/owner-handoff.mjs --approval <reviewed-local-file>`; review the resulting identity/grant and plan hash before adding `--apply --confirm-plan-sha256 <hash>`. Cloud operator credentials stay external to the repository. This release does not create them or grant IAM.

An explicitly approved takeover of the original staging administrator is a separate operator-only procedure in [EXISTING_OWNER_TAKEOVER.md](EXISTING_OWNER_TAKEOVER.md). It preserves the normal denylist and additionally requires retired QA credentials, proven personal password rotation, session cutoff plus Auth revocation, transactional first-owner checks and a deterministic operator-attributed audit. It does not deploy code or create an alternate ownership model.
