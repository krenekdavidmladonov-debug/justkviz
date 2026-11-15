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

The separately entered offline event delegates bounded local authority for one signed event, snapshot and session. It encrypts private files and durable browser records. The projector receives neither the decryption key nor unrevealed answers. Sync requires current online Auth, scoped membership and an atomic baseline comparison. Cloud activation is disabled by default and requires the exact V2 environment, a server-managed event allowlist and a separate server signing key. Browser trust is bound to the deployed environment. The gateway rechecks the current event and the exported Storage generation before and after I/O. See [offline operation](OFFLINE_MODE.md) and [release controls](OFFLINE_RELEASE.md).

The local demo image backup reauthorizes the exact currently published image in the projector and the current scoped operator on every short lease. A pinned same-origin popup receives one already-authorized image through a one-use MessageChannel. Whole-file index integrity, every image digest, current snapshot/generation and expiry are independent checks. Exported answer images require `event.export`, `event.answers.read` and `event.answers.export`; the projector receives their bytes only after explicit server reveal. The confidential file stays under operator control. The implementation and limits are documented in [LOCAL_IMAGE_BACKUP.md](LOCAL_IMAGE_BACKUP.md).

1. Correct answers never reach public/projector clients before reveal.
2. Public clients cannot read private quiz sources, registrations, contacts, or staff data.
3. `request.auth != null` is authentication, not administrative authorization.
4. Staff privileges require a current active server-managed membership, concrete permissions and resource scope. Legacy role claims grant no authority.
5. Sensitive state changes are validated and authorized server-side.
6. Firestore and Storage start deny-by-default; access is added narrowly and tested in emulators.
7. Production access and deployment require explicit user approval.

## Preventing answer leakage

Visual metadata follows the same boundary: `answerDesign` is private answer content and is merged into the public design only on explicit reveal. Public design/result copy uses bounded allowlists; unknown private extensions and private print templates are never published. Owned design images require current publication and existing quiz/media permissions. The full contract is in [WHOLE_EVENING_DESIGN.md](WHOLE_EVENING_DESIGN.md).

The projector reads slide state from one `publicSessions/{sessionId}` document. The trusted `buildPublicSessionState` allowlist builds this projection from private quiz data. In ordinary question mode it copies only explicitly safe title/text/options, normalized visual media, and presentation controls; AUDIO source is omitted entirely. In explicit recap mode it adds only the selected question's display-form `revealedAnswer` and allowed answer image—not the private slide or question. Hiding an answer in React state, CSS, a network response, an error, or an unread UI branch is not acceptable.

While the optional thank-you screen is displayed online, a separate query
reads published `publicEvents` through the existing public Rules. The screen
displays event titles, dates and venues from server-confirmed snapshots.

The projector ignores inbound BroadcastChannel presentation state entirely. Only Firestore may supply a slide or an explicitly reviewed interim-results page. The projector rejects cache-only data, stale revisions and foreign sessions, invalidates old callbacks, and attempts a fresh server read on reconnect. If the read fails while the browser reports online, the listener waits for server-confirmed state. Channel player lifecycle reports contain only session ID, generation and an allowlisted state. Authenticated staff and the trusted Function still validate them.

Every navigation, reveal, hide, and end operation replaces the entire public document in the same transaction as the private update. Navigation resets `answerRevealed`, which removes the previous answer fields. The projector clears itself when Firestore reports cache-only state or the browser reports offline. Before either signal arrives during a silent transport failure, the last already authorized view may remain visible.

Private answer media must use protected paths or server-controlled delivery; prompt and answer media must not share guessable unrestricted URLs.

## Authorization

The integrated current membership must explicitly contain `event.read` and `event.delete` for permanent deletion, including the owner role. The owner preset contains the concrete permission; a legacy owner without it fails closed. Event authorship resolves only `own` scope. This correction does not migrate live memberships.

Older event snapshots may resolve frozen YouTube prompt clips to a verified ready
Drive import of the exact same source and interval. This narrow derived media
representation grants no access to current quiz content or other assets; all
event scope, answer redaction and gateway reauthorization checks remain active.
See [SNAPSHOT_DRIVE_CLIPS.md](SNAPSHOT_DRIVE_CLIPS.md).

Quiz trash/restore requires current `quiz.read` + `quiz.delete` and quiz scope inside the transaction. Trashed sources cannot be edited or newly used; immutable event copies and retained media remain readable through their existing permissions. The library trash filter is not a new content confidentiality boundary. See [QUIZ_TRASH.md](QUIZ_TRASH.md).

Whole-quiz duplication checks source scope and full quiz export, answer and
note read permissions through the current membership. The same transaction
checks quiz creation and editing permissions, including writes to answers,
notes and media attachments, and grants access only to the new draft. A
replayed request rechecks source authority and access to the destination. The
operation sends only the destination ID and counters to the client.

Media duplication additionally requires `quiz.media.upload` in source scope.
Only the owner of the connected Drive account may copy its private assets.
The server verifies the current connection, private file access and recorded
digest, then creates a separate private Storage object under the copy. The new
object carries no source Drive binding or bearer token. The draft and access
grant become visible only when every file is verified and the current source
revision, media pins and permissions pass the final transaction. A transfer
interrupted before publication can leave private objects for idempotent retry.
Resuming a Drive transfer rechecks the private file access for completed
objects along with the current account and connection.

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

Registration uses callable Functions rather than direct Firestore writes. It validates fields/types, normalization/limits, contact format, team-size bounds (at most four members for new or edited registrations), server-time window, unique names, and team capacity transactionally. The legacy total-person limit no longer rejects registrations; accepted-person counters remain internal bookkeeping for compatible historical records. Management tokens are random bearer capabilities; registration records store only SHA-256 verifiers and invalid combinations are non-enumerating. Guarded local email and eligible explicit staging mode use a separate authenticated ciphertext envelope denied to every client role. Default-off cloud creates no intents/envelopes, binds no email secrets and does not require the vault. Local vault/fake-provider access requires both a demo project and a localhost emulator, and the real Gmail adapter refuses emulator execution. Email intents/receipts remain server-only. The six email endpoints remain excluded from the frozen [70-target restart inventory](../tools/staging/restart-release-manifest.json); the separately approved five-Function staging activation now binds the create keyring and private worker's OAuth/keyring secrets with dedicated identities. [Actual execution evidence](EMAIL_ACTIVATION_EXECUTION.md) verifies private invocation, selected-recipient/cutoff restrictions and one owner-confirmed message. That selected-recipient run is historical. The separately approved 972ed71 activation now has a RUNNING queue for canonical online registrations created at or after 2026-10-15T15:26:19.550Z; the owner confirmed all three registration messages. Organizational campaigns, older registrations and production remain excluded. Responses reveal no other teams or contacts. Production abuse controls remain a launch prerequisite. See [TRANSACTIONAL_EMAIL.md](TRANSACTIONAL_EMAIL.md).

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

A fresh 2026-10-15 check confirms the approved 972ed71 activation: the five email
functions share future-public-registration policy and cutoff, and the queue is
RUNNING. The private worker, sender and secret versions remain unchanged. The
new source adds encrypted capability envelopes for eligible registration updates,
using the existing event/intent-bound vault; legacy updates without an envelope
remain deliverable without a management link. Raw capabilities are never logged.
Deployment must explicitly bind the existing keyring to updateEventRegistration
and verify its runtime identity has only the necessary access. This is part of
the new exact-release proposal, not implicit permission to change cloud IAM.

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

Storage allows create only for an active member with a verified token, a valid session cutoff, `quiz.media.upload`, quiz scope and an exact server-issued upload grant bound to the same UID and current membership version. Rules deny direct get/list/update/delete. Owned MP4 uses the same scoped grant with exact `video/mp4` MIME, a 25 MiB limit and an absent temporary upload destination; the rule still reads only the membership and upload documents. The server makes a fresh canonical object without a bearer token and removes the exact temporary object before marking the video ready. Firebase bearer tokens are a separate capability outside Rules; the app never exposes them through the offline archive or projector. The legacy image/audio path is not migrated by this change. The authenticated/current-publication read gateway, MIME/size/signature checks and immutable generation binding are covered by local Storage contracts and browser tests; see MEDIA_STORAGE.md. Further access still requires explicit boundary tests.

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
