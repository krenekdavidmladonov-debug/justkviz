# Registration transactional email

## Organizer notifications (25 October 2026)

The owner can separately enable an email for each newly accepted public online
registration. The existing private outbox stores one deterministic
`owner_{registrationId}` intent of type `registration-organizer-notification` in
the same transaction as the registration. Receipt replays, manual teams, edits,
cancellations and historical registrations create no organizer notification.
The message includes the event, date, team and member count plus an authenticated
admin roster link. It contains no team contact address or management capability.

The trusted runtime binds `REGISTRATION_OWNER_NOTIFICATION_MODE=staging`,
`REGISTRATION_OWNER_NOTIFICATION_RECIPIENT`,
`REGISTRATION_OWNER_NOTIFICATION_OWNER_UID` and an independent exact ISO
`REGISTRATION_OWNER_NOTIFICATION_ACTIVATED_AT` cutoff. Missing, disabled or invalid
configuration turns organizer notifications off without blocking registrations.
The existing V2 registration-email activation remains required. Local tests use
`emulator` mode only with a guarded localhost Firestore emulator and demo project.
The owner explicitly chooses the destination; the membership's historical email
field is not used as the recipient. Deployment verifies the current owner identity.

Dispatch and delivery recheck the exact recipient, UID, cutoff and trusted create
provenance. Delivery verifies the canonical registration and current active
membership with `event.read`, `event.contacts` and event scope, both while claiming
the intent and immediately before sending. The admin link grants no access by
itself. Organizer status stays on its own private intent and never overwrites the
participant's `emailDelivery` summary. Existing conservative retry, lease and
uncertain-outcome behavior applies independently to each message.

Deploy only `deliverEmailTask`, `dispatchRegistrationEmail`, then
`createEventRegistration`, enabling the producer last after both consumers are
verified. Preserve identities, secrets, IAM, queue and all existing environment
values. No client Rules, indexes, public data or Hosting release is required.
Rollback restores the producer first, then the two consumers, including each
recorded source and environment. It never rewrites registrations or replays mail.


## Domain operations

| Authorized operation | Logical message |
| --- | --- |
| New anonymous online registration | `registration-confirmed` |
| Actual normalized name/count/email self-service change with the management token | `registration-updated` |
| First successful self-service cancellation | `registration-cancelled` |
| No-op, failed operation, identical operation replay | None |
| Admin manual add/edit, with or without email; any admin cancellation | None |

In guarded local email runtime or eligible explicit staging mode, the transaction commits registration, name reservation, capacity counters, email intent and safe organizer summary together. Default-off cloud creates no email intents. Missing/`selected` recipient policy retains the old configured-recipient behavior. The active staging `future-public-registration` policy requires canonical original online registration creation at/after the cutoff, a management-token verifier and trusted private intent provenance; old registrations (including new edits), manual teams, old backlog and campaigns remain excluded by dispatch and the delivery lease guard. No backfill or historical enqueue is introduced. Recipient is the server-validated email from that completed operation (format validation, **not** proof of mailbox ownership). Templates use an immutable allowlist of event title/date/time zone/public venue, team name and member count from that operation. Admin, quiz, scoring and staff data never enter email content. Changed/cancelled messages go to the email current at the operation. Delivery does not rerun or roll back registration logic.

The prepared templates generate responsive HTML and plain text together in Czech, with subjects `JustKvíz | Registrace týmu … potvrzena`, `JustKvíz | Změna registrace týmu …`, and `JustKvíz | Registrace týmu … zrušena`. HTML escapes every untrusted display value; subjects remove controls. Dates use the actual event time zone; absent/invalid optional details are omitted rather than guessed. No organizer contact is invented: the event model has no such field. Confirmation and new update messages contain a private “Spravovat registraci” CTA using the existing management route; cancellation has none. Links reject credentials, unsafe protocols, remote HTTP and malformed capability fragments. No remote images, tracking or branding dependencies are needed. A message describes its completed operation; it is not a live view of subsequent team changes.

## Existing token and smallest persistence extension

The server still issues a random 256-bit management token. Existing authorization compares its SHA-256 verifier timing-safely. The public create response still contains only that team's event/registration IDs, team name, member count, contact email, status and raw token. Management get/update/cancel responses omit the token. Neither staff login nor an email status grants management access. Legacy registrations and manual null-token records retain their behavior.

Previously the raw token existed only at issuance, so a delivery retry could not reconstruct the same CTA. We now seal that **same token**, without issuing a second kind of management capability, into AES-256-GCM ciphertext in `events/{eventId}/emailSecrets/{intentId}`. A fresh 96-bit nonce and the exact intent path as authenticated additional data bind the envelope to its intended event/message. The envelope contains only version, key ID, nonce, ciphertext and authentication tag. It is separate from registration records and email audit and denied to **all** Firestore client roles. Only the trusted vault reconstructs the transient link. Its fragment keeps the token out of HTTP request paths and referrers.

Provider credentials require explicitly approved secret/vault bindings. Verify allowed scope and key identity/version when decrypting; plaintext credentials must never enter browser payloads, repository files, diagnostics or receipts.

The prepared update-link extension binds the **existing** `EMAIL_TOKEN_KEYRING` to `updateEventRegistration` too. Only after valid token verification and a genuine eligible change does its transaction seal the same token under the new intent path and create an `emailSecrets` envelope atomically. Replays, no-ops, rejected tokens and ineligible registrations create none. No capability is rotated and no raw token/URL enters an intent, receipt or log. The worker reconstructs the update CTA in memory. Old update intents without an envelope still send without a CTA, using the same intent; malformed existing envelopes fail closed rather than silently removing their link. Confirmation still requires its envelope. Existing client Rules remain unchanged and deny every direct envelope read.

Deployment of that extension requires an explicit reviewed release. Fresh metadata confirms create and update have different runtime service accounts and update lacks a direct keyring accessor. The release proposal switches update to the existing dedicated create identity and adds the existing keyring binding, without a new secret or IAM grant. Prior IAM evidence gives that identity `roles/datastore.user`; its continued access must be verified against the update contract before deployment. No broader recipient policy or automatic campaign is required. Deploying the compatible worker before the update handler avoids introducing update envelopes before their consumer; preserve the existing cutoff, sender and numeric secret versions.

## Operation idempotence and response loss

New public forms generate a random 256-bit `requestKey` and retain it only in component memory across failure/retry. Treat it as a short-lived retry capability: never log, persist in browser storage or include it in telemetry. Firestore stores only its hash as the create receipt key in the server-only `registrationOperations` collection. The receipt binds the original normalized payload fingerprint, registration and confirmation intent. An identical concurrent/later replay returns the existing registration and the same token; a changed payload is rejected. With a vault, an existing envelope is decrypted and malformed ciphertext fails closed. A historical receipt whose secret document is absent can recover its deterministic token from the supplied retry key; the current capability version and management-token verifier must still match. This permits pre-email receipts to survive later vault activation without reviving revoked or rotated capabilities. Replay never writes another team, intent or secret, even after a rename or cancellation. The protected envelope remains after sending so a lost create response can still be recovered. Reload loses this in-memory retry key. Availability still requires the explicit runtime policy, cutoff and operational queue.

New management forms send stable `requestId` values for failed/retried updates. Receipts are bound to event, registration and normalized payload, and every replay **first re-verifies the management token**. A delayed replay returns current registration state without overwriting newer state. A no-op also records a receipt, with no intent. Cancellation's accepted-to-cancelled transition itself is transactionally idempotent.

Old callers may omit the new optional retry fields: create retains unique-name protection and update retains equality/no-op protection, but these old requests cannot identify a delayed replay after intervening edits. The updated application uses the explicit retry fields. No historical registration migration or backfill occurs.

## Audit and delivery

`events/{eventId}/emailIntents/{intentId}` is server-only. It holds type, event/registration binding, operation-time recipient/content snapshot, `pending | processing | sent | failed`, attempt count, generic last error, creation/update/sent timestamps and an expiring worker lease. There is **no raw management token, full management URL, provider payload, key or full provider response** in this audit.

The registration's `emailDelivery` contains only the latest intent ID/type/status/server timestamp. Existing staff-only registration reads expose it to the organizer UI; the mapper/UI show status and time. Legacy/manual teams without a message show a dash. No public resend/recipient override/relay API exists. All direct client status/intent writes and audit/secret reads are denied, including to admins and moderators.

`deliverRegistrationEmail` remains the one injected worker primitive. A Firestore creation trigger enqueues an ID-only task; the private task function loads the committed intent. The worker claims a two-minute lease, records processing, increments attempts and reconstructs MIME in memory. Gmail acceptance records sent. The prepared conservative policy retries only known temporary non-acceptance (429/limit 403) or failures before send (such as OAuth refresh); permanent configuration/credentials failures become terminal failed. Send timeout/network loss, send 408/5xx or a success body without an accepted message ID become `failed` + `outcome-unknown`, with no automatic resubmission. At most five attempts and a 24-hour intent age are allowed. Provider exception text is never logged or persisted. Queue replays cannot resend terminal intents. Active leases request task retry; an expired **processing** lease becomes `failed/outcome-unknown` without another send, because its crashed worker may already have sent. Older workers cannot finalize a newer lease or replace the latest organizer summary.

Disabled delivery must fail closed before any provider call. Retry attempts preserve the original intent identity and duplicate suppression; enabling requires explicit project/environment agreement and current authorization.

## Local verification

`CaptureEmailTransport` is a development module with no deployment export or endpoint. It keeps recipient/subject/text/HTML in memory only, makes no network request and simulates failure before acceptance or after acceptance with response loss. It requires the same demo/local guard and rejects different payloads for an already accepted idempotency key.

Unit tests cover templates, HTML/header injection, authenticated encryption and emulator guards. Rules tests cover all client roles. The emulator contract suite invokes real callable transactions, tests concurrent/delayed retries, wrong tokens, admin exclusions, delivery failure/retry/leases and scans persisted documents/runtime logs for raw capabilities. The versioned browser scenario registers a synthetic team, captures confirmation, opens its real CTA, edits, captures the update, cancels and captures cancellation. It also verifies organizer pending/failed/sent states.

The standard Quality gate runs registration contracts, Gmail worker contracts and the browser scenario through a fake Gmail HTTP adapter on local Auth/Firestore/Functions emulators. Prepared cases additionally cover update ciphertext binding, legacy updates without envelopes, malformed ciphertext, send timeout, ambiguous accepted responses and failure between provider acceptance and Firestore finalization; they assert terminal replay performs no second send. CaptureEmailTransport remains available for its deterministic local dedup tests, but its extra guarantee is not attributed to Gmail. No internet provider, SMTP, cloud credentials or deploy step is used. Browser trace/video/screenshots are disabled for capability-bearing flows; secret-phase errors are replaced with stage-only diagnostics and captured messages are never attached to reports.

## Completed bounded staging and wider rollout boundary


The existing sender uses `gmail.com`, not a custom JustKvíz domain. [Personal Gmail limits](https://support.google.com/mail/answer/22839?hl=en) can block sending after more than 500 messages/day; application rate limits are not a daily allowance or delivery SLA. [Gmail API quotas](https://developers.google.com/workspace/gmail/api/reference/quota) also apply and may differ for projects grandfathered into older limits. Remaining account quota and SPF/DKIM/DMARC result headers have not been measured here; a custom From domain would require separate sender/DNS verification under [Google's sender guidelines](https://support.google.com/mail/answer/81126?hl=en).

Organizer status and safe server-only intent error/attempt metadata provide operational diagnosis. Automatic Cloud Monitoring alert policies/log metrics are **not verified by existing evidence**; this source adds none. Operators should inspect failed or persistently pending statuses and the queue, without replaying registrations/outbox or logging contact data. Pausing a queue or changing policy requires the release's explicit authorization; sent mail cannot be recalled by rollback.
