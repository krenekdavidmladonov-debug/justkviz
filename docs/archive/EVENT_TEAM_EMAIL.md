# Organizational messages to event teams

Admins can open **Napsat týmům** in event detail, enter a subject and plain-text body, review the server preview and recipient count, explicitly confirm, then inspect total/pending/sent/failed. History shows the latest 20 messages. Status refresh is explicit; sent means provider acceptance, never delivered.

## Scope and authorization

The existing global admin model is preserved. Every callable checks both the presented admin claim and the current Auth user's admin claim/disabled flag. Moderator, referee capability/role, ordinary and public clients cannot preview, create or inspect messages. No new event ownership model is introduced. New messages require the same operational lifecycle as manual team operations: draft/scheduled/ready/live. History remains inspectable after completion. No recipient address list, contact document, token, score or staff record is returned to the UI.

The server reads this event's accepted registrations and filters absent emails. Cancelled/unaccepted registrations are excluded. A manual team without email is skipped. Each accepted registration receives one message, including distinct teams sharing a mailbox, following existing registration-specific communication. No personalization or management CTA is added. Subject/body are bounded plain text; HTML rendering escapes all content and private capability patterns/header controls are rejected. Authors remain responsible for the free text they enter; the system never loads scores, staff data or management tokens into this template.

## Durable immutable snapshot and idempotence

- events/{eventId}/emailCampaigns/{campaignId}: eventId, immutable content {subject,message,eventTitle}, total, createdBy, createdAt and normalized-content fingerprint.
- Existing emailIntents contain a discriminated event-team-message variant: campaignId, registrationId, immutable recipient address, and the same bounded delivery state as registration intents. Long body content is stored once in the immutable campaign.
- Campaign ID hashes event + admin UID + request ID. Intent ID hashes campaign + registration ID. All documents commit together. The campaign is also the receipt; a retry with different content is rejected.
- Preview fingerprints event/admin/content and the complete sorted recipient snapshot. Confirm rechecks it transactionally; an address/roster/title change requires another preview. After commit, later cancellation or email changes do not alter recipients. Receipt replay checks fresh authorization before returning the existing operation, without reselecting today's roster/lifecycle.
- One atomic message supports at most **450 actual recipients**, leaving headroom below the repository's existing 475-write snapshot budget. An oversized request fails entirely with no partial campaign. The accepted roster is read up to the existing event ceiling of 10,000 before filtering; recipients are never silently truncated. The event capacity is unchanged.
- The UI retains the same request/payload through uncertain send errors, disables editing and offers receipt retry. The unresolved payload/ID is retained in tab sessionStorage scoped to event and admin UID, including across page reload and later authorization denial. It is removed after receipt recovery or a definitive non-commit error. Closing the tab clears this session state; history can identify accepted messages. It does not claim exactly-once physical delivery.

## Shared delivery and privacy

The existing Firestore trigger, private task endpoint, lease/backoff/attempt ceiling and Gmail transport handle both variants. Organizational messages load only their immutable campaign and do not resolve a token vault/public origin or read emailSecrets. They do not overwrite registration.emailDelivery (the latest registration confirmation). The admin status callable derives a bounded aggregate from the campaign's own intents; processing counts as pending. Unknown/missing states fail closed.

Campaigns/intents remain denied to every Firestore client role under existing default-deny rules. Only narrow authenticated callables return safe metadata/status. There is no second mail system, HTML editor, arbitrary-recipient relay, attachment, schedule, segmentation, tracking or marketing preference flow. Retention, automatic deletion and bulk limits above 450 are future decisions, not silently implemented.

## Verification and deployment boundary

Unit tests exercise parsing, escaping, recipient selection and limits. Auth/Firestore/Functions emulator contracts exercise roles including revoked claims, roster changes, concurrent replay, immutable recipients, atomic 450/451 limits and shared fake Gmail/status. Browser E2E covers plain-text preview, explicit confirmation, lost create response and receipt recovery, fake sends and refreshed history/status. CI remains offline to Gmail and preserves all previous browser suites.

No deploy, real email, credentials, cloud data writes or V1 access. Future email setup and the separately authorized staging checklist remain in [GMAIL_DELIVERY.md](GMAIL_DELIVERY.md). Deploying this feature later also requires the four event-team message callables and the updated shared worker; smoke testing must cover preview, confirm and status using an explicitly approved recipient set. Estimate remains **88%**.
