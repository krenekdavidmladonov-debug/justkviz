# Gmail delivery foundation


The registration intent is the durable outbox. A Firestore creation trigger enqueues one deterministic Cloud Tasks ID (SHA-256 of the intent path). Only eventId/intentId enter the task payload. Duplicate enqueue is acknowledged; other enqueue failures request trigger retry. Public registration commits its transaction without waiting for Tasks or Gmail.

The private `deliverEmailTask` invokes the existing `deliverRegistrationEmail`. It uses committed recipient/content snapshots and protected capabilities. There is no arbitrary-recipient relay, public worker, inbox reader, domain-wide delegation, bounce processing or second delivery system.

## Transport

`GmailEmailTransport` refreshes OAuth access with the configured offline refresh token and invokes only `users.messages.send` for `me`. Scope: `https://www.googleapis.com/auth/gmail.send`. No readonly/modify/compose scope is requested. A returned wider scope fails closed; operator setup must grant only send.

MIME is multipart/alternative: UTF-8 text/plain and text/html, CRLF, base64 parts wrapped at 76 characters, encoded-word subject and base64url raw encoding. Configured From/To/optional Reply-To accept a single validated ASCII mailbox, not display names or recipient lists. The server adds only the fixed encoded JustKvíz display name to From; the authorized mailbox stays unchanged. Subject/header injection is rejected. Czech content is preserved. The escaped HTML/plain-text templates use actual event data and the same protected capability for confirmation and new update messages; cancellation has no CTA. Legacy update intents without an envelope remain deliverable without a link.

RFC Message-ID and boundary derive from project + intent path; Date derives from intent creation. A retry has identical MIME while configuration is stable. Keep sender and public origin stable for pending intents.

## MIME and recipient deliverability

code already contains both text and HTML alternatives and authenticated Gmail API
submission. It did contain a concrete MIME defect: `justkviz_` plus a 64-character
digest made a 73-character boundary, exceeding the 70-character maximum in
[RFC 2046 section 5.1.1](https://www.rfc-editor.org/rfc/rfc2046#section-5.1.1).
The boundary now uses 60 digest characters (69 total, 240 digest bits). Message-ID,
mailbox, Reply-To, secret bindings, send-only OAuth scope and capability links are
preserved. The fixed From display name identifies JustKvíz consistently. This
removes a verified format defect; it does **not** establish the cause of Seznam's
spam decision or guarantee inbox placement.

[Seznam's authentication guidance](https://o-seznam.cz/napoveda/email/pro-odesilatele-hromadnych-zprav/povinne-technicke-nalezitosti/)
requires valid SPF and DKIM and recommends DMARC. The existing sender uses Gmail,
so authentication must be checked on the message actually received; adding DNS
records to the Firebase Hosting domain cannot fix authentication of `gmail.com`.
The worker's send-only grant, sender identity and DNS are unchanged by this fix.


Remaining diagnostic evidence is Seznam's actual authentication verdict or spam
classification explanation, if available in an original message export or from
Seznam support. The relevant fields are `Authentication-Results`, `Received-SPF`
and `X-Spam-Status` if present; their absence in the displayed view is not a fail
verdict.
[Seznam's header instructions](https://o-seznam.cz/napoveda/email/mohlo-by-se-hodit/hlavicka-e-mailu/)
place this under **Další → Zobrazit hlavičku** at the end of the message. Share only
those headers with personal mailbox local parts redacted; do not share the body or
management URL. The send-only worker cannot inspect recipient headers. Valid
authentication still leaves content, reputation and mailbox rules as possible
causes; Seznam does not expose its complete internal scoring.

For the owner's mailbox, Seznam documents moving a legitimate message from Spam
to Doručené or adding the sender to contacts as a trust signal in its
[spam help](https://o-seznam.cz/napoveda/email/zasady-bezpecnosti/nevyzadana-posta-spam/).
That is a mailbox-specific remedy, not proof of global deliverability. Longer-term
dedicated transactional-domain routing would require a separately configured
sender and verified DNS; Seznam's
[domain guidance](https://o-seznam.cz/napoveda/email/pro-odesilatele-hromadnych-zprav/doporucene-nastaveni-odesilacich-domen/)
recommends separating transactional and bulk streams. Do not add `Precedence: bulk`
or fictitious unsubscribe headers to registration confirmations.

Deployment scope for this format change is only `deliverEmailTask` in the existing
V2 project. No live message was sent for verification. Offline tests cover the
boundary limit/delimiters, Czech sender/subject decoding, text/HTML round trips,
unchanged retry identity, injection rejection and transport outcome handling.

## Delivery and recovery

- pending → processing → sent / failed; only known temporary non-acceptance or pre-send failures return to pending.
- Five persisted submission attempts maximum; intent age limit 24 hours.
- Backoff starts at 30 seconds, doubles per attempt and caps at 10 minutes.
- A two-minute lease protects concurrency. Active lease/early retry produces a retry response, not ACK. An expired **processing** lease becomes terminal `failed/outcome-unknown` without another provider call: its worker may have crashed after acceptance. A finishing worker must still own its exact lease.
- Cloud Tasks allows 20 dispatch attempts, 120–600 second backoff, 24-hour retry duration and at most two concurrent dispatches / one dispatch per second. A later dispatch can terminalize a crashed claim without another send. Both OAuth and send have 15-second timeouts; function timeout is 60 seconds.
- Known send rejection 429 / retryable quota 403, OAuth refresh 5xx/network/timeouts and transient protected-envelope reads before send retain bounded retries. Revoked/invalid OAuth grants, permanent permission/configuration errors, missing required envelopes/keys and invalid payloads fail permanently.
- Send network loss/timeout, 408/5xx or a successful response without an accepted message ID are terminal `outcome-unknown`, never automatically resubmitted. A 5xx is conservative because it does not prove non-acceptance. Safe allowlisted error codes are stored; response bodies, bearer tokens, MIME and nested exceptions are not.
- Legacy pending intents already marked `outcome-unknown` terminalize before a new send/backoff wait. Legacy `provider-unavailable` cannot distinguish OAuth failure from Gmail send 5xx; release preflight must inspect outstanding attempts with the queue paused, without replaying or rewriting them.
- This stops the old automatic duplicate path after Gmail acceptance followed by response loss, process death or failed Firestore finalization. **Message-ID is not an exactly-once guarantee.** A crash before send or a rejected 5xx can now leave mail unsent and require manual provider/mailbox verification. No automated resend or inbox reconciliation is available with send-only access. Prefer this explicit tradeoff to silently submitting an uncertain message again.
- Sent means Gmail API accepted the request. It does not mean delivered, read or bounce-free.
- Queue/Firestore infrastructure can exhaust its own retry retention during sustained outages. Monitoring must flag old pending/processing intents; this foundation does not claim guaranteed eventual delivery during indefinite outages and performs no automatic historical backfill.
- Email snapshots can arrive out of order. Old completion cannot replace a newer registration summary.

## Local activation preparation — names only, no values

| Name | Storage / binding |
| --- | --- |
| GMAIL_OAUTH_CLIENT_ID | Secret Manager; Gmail worker only |
| GMAIL_OAUTH_CLIENT_SECRET | Secret Manager; Gmail worker only |
| GMAIL_OAUTH_REFRESH_TOKEN | Secret Manager; Gmail worker only |
| EMAIL_TOKEN_KEYRING | Secret Manager; create/replay + prepared update callable and Gmail worker |
| GMAIL_SENDER_EMAIL | Invocation environment: dedicated authorized Gmail sender (consumer or Workspace) |
| GMAIL_REPLY_TO | Optional invocation environment: one mailbox |
| EMAIL_PUBLIC_ORIGIN | Invocation environment: exact V2 staging origin |

EMAIL_TOKEN_KEYRING is a JSON object with activeKeyId and keys, a mapping of key IDs to canonical base64-encoded 32-byte AES keys. Keys are generated and provisioned by an authorized operator later, never committed. Retain old key entries for existing envelopes/receipts; seal new messages with activeKeyId. Rotation cannot delete old keys merely because mail was sent: create-response recovery also depends on them. No plaintext fallback exists.

Discovery remains default-off with no parameter declarations or secret bindings when off. Exact V2 staging activation requires `REGISTRATION_EMAIL_MODE=staging` and canonical UTC `REGISTRATION_EMAIL_ACTIVATED_AT`; mismatched projects/emulator signals fail closed. Missing recipient policy or `selected` requires `REGISTRATION_EMAIL_ALLOWED_RECIPIENT`. The active `future-public-registration` policy instead requires trusted original online-registration creation and intent provenance at/after the shared cutoff. Old backlog, fresh edits of old registrations, manual teams and team-message intents are rejected before lease/secrets/provider access. On mode binds the keyring to create (and the prepared update extension) and four secrets to the private worker; values are resolved only at invocation. No backfill or queue sweep exists. Actual fixture use additionally requires demo project plus explicit local Firestore host. A cloud project with an emulator host still fails that guard. The real Gmail/Tasks path refuses emulator execution; local tests inject a fake HTTP provider.

## Subsequent release checklist — explicit authorization required

1. Preserve the existing authorized Gmail sender, optional Reply-To and send-only consent. Current sender domain is `gmail.com`; do not invent a custom From domain. No new account is created by this code.
2. Reuse the existing OAuth client and numeric secret versions. No new login, API enablement, mailbox read scope or refresh token is needed for this change.
3. Preserve the named secrets, current cutoff/recipient policy and old key IDs/receipts; never paste values into Git, logs, PRs or this report. The prepared update binding uses the existing keyring. Its current runtime identity has no direct keyring accessor; the release proposal must explicitly switch update to the existing dedicated create identity and verify that identity covers the update Firestore operations. This avoids a new IAM grant/secret.
4. Review required Functions/Cloud Tasks/Eventarc APIs and existing billing/quota readiness. No service was purchased/enabled in this task. Confirm least-privilege per-resource task enqueue, service-account act-as, private worker invocation and secret access. The endpoint must remain non-public; no public/allUsers invoker is configured. No IAM change is made here.
7. Existing evidence does not verify automatic monitoring alerts/log metrics; this source creates none. Inspect organizer failures and long pending states without exposing contacts/capabilities. Any later alert configuration needs explicit authorization. Review provider capacity before expanding beyond low volume.
8. Plan SPF/DKIM/DMARC and sender-domain checks with the domain administrator. DNS changes, bounce processing, contact/envelope/receipt retention and live abuse policy are future administrative decisions.

No deploy, real OAuth login, actual credentials, Gmail send, DNS/IAM mutation, cloud data change, migration or V1 access occurs during development or CI.

## Offline verification

Unit cases cover MIME/diacritics/raw encoding, headers, scope, success, retryable 429/OAuth failures, terminal send 5xx/timeout/network/malformed responses, keyring rotation, fail-closed configuration, queue dedup and bounded backoff. Prepared emulator cases verify registration/update/cancel, token-bound update envelopes and legacy fallback, leases/concurrency, known-rejection retries, terminal uncertain sends, actual adapter timeout, and a crash after acceptance before Firestore finalization: repeated task delivery must not make a second send. The existing browser flow uses the shared task wrapper with fake Gmail and verifies organizer status and the real management CTA.

Official references: [Gmail MIME sending](https://developers.google.com/workspace/gmail/api/guides/sending), [users.messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send), [OAuth offline access](https://developers.google.com/identity/protocols/oauth2/web-server#offline), [Firebase task functions](https://firebase.google.com/docs/functions/task-functions).

Historical local evidence is in [EMAIL_ACTIVATION_VALIDATION.md](EMAIL_ACTIVATION_VALIDATION.md); actual activation and the later three-message acceptance are separate live evidence described above. The OAuth consent publishing status and remaining account quota are not established by those sends. External OAuth apps in Testing can have seven-day refresh-token expiry for this scope; verify appropriate consent status before relying on ongoing delivery. [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [OAuth overview](https://developers.google.com/identity/protocols/oauth2), [Functions environment configuration](https://firebase.google.com/docs/functions/config-env).
