# Security

Original image URLs are derived only from bound private import receipts. Answer
image URLs retain explicit reveal and private editor permission checks; see
[ORIGINAL_IMAGE_SOURCES.md](ORIGINAL_IMAGE_SOURCES.md).

Media conditional reads and bounded browser retention preserve fresh authorization;
see [MEDIA_PLAYBACK_REVALIDATION.md](MEDIA_PLAYBACK_REVALIDATION.md).

## Private Drive media extension

The opt-in media pipeline retains default-deny Rules for jobs, credentials and
asset writes. Jobs are derived from saved private slides after fresh owner,
membership, concrete permissions and resource-scope checks; a private task
worker repeats them on each transaction and before attachment. Pinned source
fingerprints prevent delayed imports from replacing newer edits. Drive files
stay private; the existing media gateway rechecks the current authenticated
reader or exact revealed public field before and after verified IO. Answer
images and source provenance never enter unrevealed public projections.
HTTPS photo fetches reject private/reserved addresses and redirects, pin a
validated DNS address, and cap bytes/time. The YouTube tool accepts a video ID
and bounded interval, never browser-supplied command arguments or cookies.
See [GOOGLE_DRIVE_MEDIA.md](GOOGLE_DRIVE_MEDIA.md) for lifecycle and activation.

The optional local companion is a separate revocable device capability, not a
Firebase login or Drive credential. Its output is untrusted: server-side size,
format/codec/duration probing and the existing source/lease/authority checks
precede attachment. Pairing/device documents remain default-denied to all browser
roles. Device revocation is read inside import transactions, including after IO.
See [LOCAL_MEDIA_COMPANION.md](LOCAL_MEDIA_COMPANION.md).

## Live V2 address, 2026-10-16

The owner requested live publication at `https://justkviz-v2.web.app`, using the existing V2 project and accounts; see [LIVE_RELEASE.md](LIVE_RELEASE.md). Both that exact origin and the former V2 origin are permitted by the registration email origin guard for a reversible rollout. The private worker selects the new origin through its deployment environment. The existing project/app allowlist, activation cutoff, current-membership authorization, private data and public projection boundaries are unchanged. V1 remains out of scope. The owner explicitly requested no further test runs for this release.

## Core invariants

1. Correct answers never reach public/projector clients before reveal.
2. Public clients cannot read private quiz sources, registrations, contacts, or staff data.
3. `request.auth != null` is authentication, not administrative authorization.
4. Staff privileges require a current active server-managed membership, concrete permissions and resource scope. Legacy role claims grant no authority.
5. Sensitive state changes are validated and authorized server-side.
6. Firestore and Storage start deny-by-default; access is added narrowly and tested in emulators.
7. Production access and deployment require explicit user approval.

## Preventing answer leakage

Visual metadata follows the same boundary: `answerDesign` is private answer content and is merged into the public design only on explicit reveal. Public design/result copy uses bounded allowlists; unknown private extensions and private print templates are never published. Owned design images require current publication and existing quiz/media permissions. The full contract is in [WHOLE_EVENING_DESIGN.md](WHOLE_EVENING_DESIGN.md).

The projector reads only one `publicSessions/{sessionId}` document. The trusted `buildPublicSessionState` allowlist builds this projection from private quiz data. In ordinary question mode it copies only explicitly safe title/text/options, normalized visual media, and presentation controls; AUDIO source is omitted entirely. In explicit recap mode it adds only the selected question's display-form `revealedAnswer` and allowed answer image—not the private slide or question. Hiding an answer in React state, CSS, a network response, an error, or an unread UI branch is not acceptable.

The projector ignores inbound BroadcastChannel presentation state entirely. Only Firestore may supply a slide or an explicitly reviewed interim-results page. The projector rejects cache-only data, stale revisions and foreign sessions, invalidates old callbacks, and performs a fresh server read on reconnect. Channel player lifecycle reports contain only session ID, generation and an allowlisted state; authenticated staff and the trusted Function still validate them.

Every navigation, reveal, hide, and end operation replaces the entire public document in the same transaction as the private update. Navigation resets `answerRevealed`; therefore old answer fields cannot survive through merge semantics. The projector rejects Firestore cache-only snapshots and clears itself on browser offline events so a disconnected client does not continue showing an old revealed answer.

Private answer media must use protected paths or server-controlled delivery; prompt and answer media must not share guessable unrestricted URLs.

## Authorization

The 2026-11-03 RC stabilization removes the historical implicit owner exception
for `event.delete`. The current membership must explicitly contain both
`event.read` and `event.delete`, alongside the existing scope/recent-auth/title/
revision checks. The owner preset already contains the permission; a legacy
owner without it intentionally fails closed. Event authorship resolves only
`own` scope, and an infrastructure operator is not an application owner. This
local correction neither creates an owner nor migrates live grants. This contract is covered by the event-deletion unit and emulator suites.

Older event snapshots may resolve frozen YouTube prompt clips to a verified ready
Drive import of the exact same source and interval. This narrow derived media
representation grants no access to current quiz content or other assets; all
event scope, answer redaction and gateway reauthorization checks remain active.
See [SNAPSHOT_DRIVE_CLIPS.md](SNAPSHOT_DRIVE_CLIPS.md).

Quiz trash/restore requires current `quiz.read` + `quiz.delete` and quiz scope inside the transaction. Trashed sources cannot be edited or newly used; immutable event copies and retained media remain readable through their existing permissions. The library trash filter is not a new content confidentiality boundary. See [QUIZ_TRASH.md](QUIZ_TRASH.md).

The current policy is defined in [PERSONAL_ACCESS.md](PERSONAL_ACCESS.md) and the shared permission module. Firebase Auth verifies identity; current membership, permissions and resource scope authorize each operation. Role labels are editable presets. Legacy custom claims are preserved but ignored as authority.

Every legacy staff callable uses the explicit fail-closed policy wrapper. Permission and scope are reread inside each content transaction, so revocation conflicts with delayed saves. HTTP media and print gateways check the same current membership. Storage grants bind member version, quiz scope, MIME, size and expiry. No browser writes membership, content, snapshots or audit directly.

Limited clients use bounded server views; hidden answers, answer media, notes, raw legacy records and contacts are removed before transport. Saving redacted content preserves the authoritative protected fields. Raw Firestore reads require every sensitive permission contained in that document and its resource scope. Public projections remain explicit allowlists. Full inventories, invite activation gate, owner bootstrap and rollback are documented in PERSONAL_ACCESS.md.

Direct snapshot reads additionally require the snapshot to be the owning event's current `quizAssignment.snapshotId`. Relocking an event revokes direct get/list access to its previous snapshot; a retained `snapshot.eventId` does not preserve access. Historical final results use their separate confirmed-results records rather than this private source exception.

Invitation and membership changes serialize on accessControl/state, validate permission dependencies and delegation bounds, prohibit self changes and protect the last owner. Accepting an invitation also rechecks the issuer's current Auth identity on each transaction attempt: a missing, disabled or unverified issuer cannot activate a membership. Auth and Firestore are separate services; this check does not make their state changes atomic. Only owners manage managers. Audit entries contain safe before/after grants, never passwords, tokens or quiz answers. New Auth identities without membership have no private access. Browser caches and drafts are cleared on identity or membership-version transitions.

## Public registration

Event pricing uses the existing scoped `event.manage` mutation boundary; public
registration payloads confer no authority to change it. Explicit pricing accepts
only `mode`, `amountCzk` and optional boolean `hidden`, with bounded integer CZK or
null for agreement. Staff read adapters retain sanitized private pricing; public
projections redact hidden prices to agreement/null plus `hidden: true`, never the
actual amount or charging mode. Hiding is enforced before public transport, and
every registration/lifecycle writer uses the same redaction. Older omitted update
fields retain authoritative pricing and visibility. No new permissions,
Rules, collections, payment credentials or contact exposure are introduced.

Owner notifications use a separate default-off runtime recipient/UID/cutoff, not
browser fields or the membership's display email. Only successful new online
creates enqueue one private deterministic intent; receipt replays and manual
registrations cannot enqueue another. The private worker checks current active
membership, `event.read`, `event.contacts` and event scope before sending. It sends
only event/team/count/date and an authenticated admin URL, with no team contact or
management capability. Existing deny-all client access to email intents applies.
No new IAM, secret, client permission or public projection field is introduced.
See [TRANSACTIONAL_EMAIL.md](TRANSACTIONAL_EMAIL.md).

Manual team add/edit requires an active membership, `event.manage`, `event.contacts` and scope for the target event, rechecked in the mutation transaction. It shares transactional capacity and name reservations with online registrations. Its nullable token verifier never authorizes public access; manual records have no public management capability. Public requests cannot choose manual origin or bypass their email/window requirements. See `EVENT_TEAM_TOOLS.md`.

## Firebase configuration and secrets

The prepared `REGISTRATION_EMAIL_RECIPIENT_POLICY=future-public-registration`
opt-in is restricted to the same exact V2 staging runtime and requires a valid
shared activation cutoff. Absence or `selected` retains the existing one-recipient
contract; unknown policy values fail closed. Future mode derives eligibility from
the canonical online registration's original creation time and management-token
verifier, excludes manual registrations, and writes private policy/time provenance
onto the intent. Browser-supplied provenance is ignored. The dispatch and worker
allowlist requires this marker and both creation times at/after the current cutoff
before enqueue or lease/secrets/provider access. Old tasks, fresh edits of old
registrations and organizational campaigns therefore cannot become mail solely
because the queue resumes. No historical outbox rewrite/backfill is introduced.


Automatic retries are restricted to known transient rejection or pre-send failure.
An uncertain Gmail send or expired processing lease becomes terminal failed with
outcome-unknown, requiring review before any new send. This avoids automatic
resubmission after ambiguous acceptance; it does not guarantee inbox delivery.
No new collections, client permissions, OAuth scopes or Rules are introduced.

Firebase web configuration is not a secret, but project selection is safety-critical. Local defaults use a `demo-*` project and emulators. Cloud access additionally requires explicit staging mode and the exact allowlisted V2 staging project/app/domain. Other cloud and production builds are rejected. Service-account keys and secrets are forbidden in Git. The isolated staging bootstrap uses only operator CLI OAuth in memory and synthetic data; its generated passwords/tokens remain under ignored `.local-data/staging`. See `STAGING.md`.

The local auth seed uses Admin SDK only after fail-closed checks for an explicit loopback Authentication Emulator host/valid port and a `demo-*` project. The accompanying membership seed also requires a loopback Firestore emulator. The standard launcher uses ports `9099` and `8080`. It creates three documented development accounts and their explicit emulator memberships.

The quiz seed applies the same fail-closed design to Firestore: it requires an explicit loopback host/valid port and a `demo-*` project. Stable IDs make it safely repeatable. Its Admin SDK access is strictly an emulator-only development tool and does not justify client writes in Rules.

The V1 migration tool follows the same fail-closed principle. Managed export bytes and extracted data stay under the Git-ignored `.local-data/` tree. Extraction and WRITE require an exact local emulator host (`localhost`, `127.0.0.1`, or `[::1]` plus a valid port) and a `demo-*` project ID; the emulator writer has no production override. The separately guarded staging-only cloud path is documented in tools/migration-v1/CLOUD_IMPORT.md, including read-only source IAM requirements and private root-last import journals. Emulator WRITE additionally requires a fresh emulator target with no quiz migration documents. Local inventories may contain document IDs and titles for operator reconciliation, while the committed report contains structural counts only. Neither form contains question text, answer values, notes, options, contacts, or raw documents.

## Rules and tests

Both print artifacts containing answers (`answer-key` and `organizer-sheets`) require active membership, `event.export`, `event.answers.read`, `event.answers.export` and scope for the concrete event. The binary endpoint repeats authorization and verifies the unchanged snapshot binding before returning bytes. The organizer artifact accepts no client answers, team list, mode or snapshot ID. The UI separates private materials from player sheets and requires deliberate confirmation; this never substitutes for endpoint authorization. The player's two-up layout never marks a correct option or inserts a private answer.

Firestore Rules tests run through `firebase emulators:exec` and `@firebase/rules-unit-testing`, not mocked SDK calls. The suite covers anonymous/unprivileged denial for private sessions and quiz sources, anonymous single-document public reads, public list/write denial, scoped member reads, direct member write denial, and default denial. Emulator E2E additionally invokes real callable emulators as anonymous and with ordinary-user, moderator and admin compatibility fixtures; the privileged fixtures now authorize through explicit current memberships rather than their legacy role claims. Editor coverage verifies authorized idempotent creation of one empty private draft, CRUD, collaborator read-only behavior, direct-write denial, stale/concurrent saves, exact legacy round-trip (including the imported `0/0` timing sentinel), contiguous ordering, guided Choice/Video repairs, invalid indices/timing rejection, sanitized repair responses, and that editor activity leaves sentinel public/session snapshot state unchanged.

Storage allows create only for an active member with a verified token, a valid session cutoff, `quiz.media.upload`, quiz scope and an exact server-issued upload grant bound to the same UID and current membership version. All direct get/list/update/delete remain denied. The authenticated/current-publication read gateway, MIME/size/signature checks and immutable generation binding are covered by local Storage contracts and browser tests; see MEDIA_STORAGE.md. Further access still requires explicit boundary tests.

## Operational safeguards

Google Drive connection preparation uses a dedicated media OAuth/Picker project,
client and encryption keyring, separate from Gmail. A separate client alone does
not isolate Google's project-wide token revocation. The Firebase runtime remains
in V2. It requires current verified Firebase identity,
active server-managed owner membership and concrete `users.manage` and
`quiz.media.upload` permissions. Pending authorization is bound to that identity,
membership version, expiry and PKCE challenge, then consumed once. Token exchange
and folder assignment recheck authorization before persisting credentials.
The two Drive collections remain default-denied to every browser role. The
limited `drive.file` grant covers app-created or explicitly selected files; a
folder created through a chat connector grants no access to the deployed app.
No media export, YouTube download, public sharing or deployment is activated by
this preparation. See [GOOGLE_DRIVE_CONNECTION.md](GOOGLE_DRIVE_CONNECTION.md).

- Separate local, staging, and production Firebase projects.
- Use least-privilege CI identities and protected deployment environments.
- Require review for Rules, Functions authorization, and public projection changes.
- Log security-relevant mutations without secrets or unnecessary contact data.
- Define backup, retention, deletion, and incident-response procedures before launch.

### Internal event scoring
The saveEventScore callable checks the current Auth account's existence, disabled flag, verified email and token revocation cutoff at invocation, then requires an active membership, `event.score` and scope for the target event. `runAccessTransaction` rereads membership, permission and event scope on every transaction attempt, including idempotent receipt replay; legacy role claims grant no authority. Auth and Firestore state changes are not atomic. New writes require the event's current immutable snapshot, an existing snapshot round, an accepted canonical registration, an operational lifecycle, a safe half-point integer (or null), an exact score revision, and a reason for corrections/clearing. Score, history and actor/event-bound idempotency receipt commit atomically. Rules require `event.read`, event scope and event visibility for score/history reads and deny all client writes; scoreOperations is server-only. Management tokens grant no scoring authority. Scoring publishes no results and grants no contact access. Full contract and emulator tests: EVENT_SCORING.md.

## Referee capabilities

Referee access is a separate per-event bearer capability, not a staff role or Firestore claim. Grants and rate-limit counters remain server-only. Every protected transaction checks current grant validity and event state; revocation conflicts with in-flight score transactions. See [REFEREE_ACCESS.md](REFEREE_ACCESS.md) for delivery limits, payload allowlists, expiry and tests.


Interim result publication checks current Auth at invocation and rechecks active membership, `event.live` and event scope on every transaction attempt. It also validates event/session/snapshot binding, accepted roster, included scores and source fingerprint. Public output is a fresh allowlist of only the reviewed current page; private result versions require scoped `event.read`, scores follow the same scoped read boundary, and operation/audit records remain server-only. Every client write is denied. Referee and registration management capabilities confer no publication access. See [INTERIM_RESULTS.md](INTERIM_RESULTS.md).


Final reveal extends the same event-bound live session with private immutable finalVersions, revisioned finalOperations and an explicitly revealed public page. Staff confirmation, corrections, closure and moderator-only synthetic sound are documented in [FINAL_REVEAL.md](FINAL_REVEAL.md). No Rules, indexes or cloud data change is required by this implementation.

Show Mode retains these same result/version/revision boundaries. The interim
backdrop is rebuilt by the server as a static allowlist without answer fields,
answerDesign or audio/video sources. Private return intent cannot be supplied by
the browser. Restoring a formerly explicit answer/recap rereads the same current
snapshot binding and requires current `event.answers.read` in the transaction;
revocation falls back to the ordinary slide while allowing an authorized event.live
operator to hide results. It never resumes playback. Only explicitly revealed
groups enter final lower/current/history pages, each bounded by its server pageSize.
Stable team IDs used for movement stay private. Receipt replay neither changes
the public document nor grants a showCue/winner sound attempt.

`configureEventShow` and `readEventShowPreferences` require fresh Auth, active
membership, `event.live` and event scope with transaction rechecks. Attaching a
new owned audio reference additionally checks current source-quiz read scope and
answer-media visibility. Upload permission remains a separate quiz grant. The
authenticated eventId media gateway accepts only an exact currently attached
MP3/WAV reference with matching pinned generation and validated MIME/size, and repeats current
authorization/attachment checks after IO. Event scope grants no arbitrary source
quiz or Storage access. Public gateway access is extended only to images actually
present in the current sanitized interimBackdrop. Show audio references, bindings,
contacts and future result rows never enter publicSessions/publicEvents.
See [SHOW_MODE_IMPLEMENTATION.md](SHOW_MODE_IMPLEMENTATION.md).

## Event organizational email

The organizational email source requires current Auth, active membership, `event.manage`, `event.contacts` and event scope for preview, confirmation and safe history/status callables. Confirmation creates an immutable emailCampaigns record and recipient snapshots in the existing emailIntents outbox. The worker source sends plain-text organizational messages without management capabilities or changes to registration confirmation status. All direct client campaign/intent access remains denied. These endpoints and the worker are excluded from the current restart release inventory; this describes their source authorization contract, not an activated cloud email service. Atomic recipient limits, snapshot/idempotence contracts and offline tests: [EVENT_TEAM_EMAIL.md](EVENT_TEAM_EMAIL.md).

Media authoring extends the shared picker/gateway/renderer to question, private answer and background roles. Explicit empty fields detach without deleting legacy data or snapshot assets. See MEDIA_AUTHORING_RELEASE.md for the complete contract and deployment scope.


Complete editor extends the same private ordered stream with explicit draft/ready authoring, independent answer mode, default appearance, atomic round/recap creation and private in-memory rehearsal. Drafts remain editorial findings in optional preflight; saved drafts can be used for rehearsal and event snapshots through the same sanitized publication boundary. See [COMPLETE_EDITOR_RELEASE.md](COMPLETE_EDITOR_RELEASE.md) for field compatibility, authorization, verification and the integrated deployment manifest.

## Event management extension

`publicEvents` reads require `registrationPublished == true`; anonymous lists
must constrain this field explicitly. Hidden projection documents remain stored
but cannot be read by clients. Publication changes retain current membership,
concrete event permissions and resource scope checks. See
[EVENT_PUBLICATION.md](EVENT_PUBLICATION.md).

See [EVENT_MANAGEMENT.md](EVENT_MANAGEMENT.md) for the independent disposition overlay, scoped permission mapping, shared transactional guards, capability revocation and exact server-side deletion ownership/allowlist. No content backfill or Storage cleanup is introduced. Cloud team email remains disabled.

Optional quiz review separates editorial completeness from authority. Root draft/ready status and question authoring status grant no access. Live creation and event locking accept saved editorial drafts and missing answers; they still require current scoped permission checks and valid ordered visible sources. Event locking retains exact revision, immutable copy and ready owned-asset checks. Public answer allowlists and explicit reveal are unchanged; readiness summaries stay private.

Manual completeEvent requires current active event.manage and event scope on each invocation/transaction attempt; explicit endLive additionally requires event.live. Active sessions require that explicit closure intent. Presentation END authorizes only a session mutation and never completes or unpublishes its event. Explicit slide jumps during results clear answer/media/overlay intent and rebuild the existing public allowlist from the current bound snapshot. No client input can supply public answer or result rows.

## Basic public registration abuse budget

New successful online creates debit one server-side token in the same Firestore transaction as the registration, name reservation, counters and idempotency receipt. Each event and normalized submitted contact has an independent budget: three immediate creates, then one token per ten minutes, capped at three. Replay, invalid input, a duplicate name and a capacity failure do not debit. Cancellation does not refund. Staff manual-team entry, valid management reads/edits/cancellation retain their existing authorization and are not gated by the create budget.

This is a small-volume throttle, not identity or e-mail verification. Rotating addresses can bypass it; there is no claim of complete capacity-squatting prevention. No mandatory App Check/CAPTCHA, IP address, forwarded header or browser-provided clock is used. Keep the existing publication/window and transactional capacity checks and manual review. A stronger anti-abuse rollout requires evidence of abuse and a separate proportional decision.

Only the static marker `justkviz.registration.throttled` and fixed operation/code are logged after the transaction rejects; no input, e-mail, team, token, IP, event/contact identifiers or exception object is logged. The budget collection has no client access under the existing deny-by-default Rules, including staff. Malformed stored budget state fails closed. `deleteEvent` includes this exact server-owned child collection in its existing bounded cleanup; permissions, confirmation and root-last behavior are unchanged. Retention follows the event until explicit deletion, without a new TTL or cloud configuration.
