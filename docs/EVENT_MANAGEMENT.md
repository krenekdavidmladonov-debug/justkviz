# Event management


## State and permission contract

`lifecycleStatus` retains the outcome. Independent `disposition` is active, archived, trash or deleting. Missing disposition defaults to active; legacy lifecycle archived maps to archived without a backfill. Unarchiving a legacy document cannot reconstruct a lost outcome, so its terminal archived lifecycle remains read-only.

| Operation | Permission in current scoped membership | Allowed starting state | Result |
| --- | --- | --- | --- |
| Read | event.read, additional contacts/answers/notes permissions for those fields | active/archive | redacted current reads |
| Edit / registration settings | event.manage (contacts also for teams) | operational active action | expected revision; safe organizational fields during live |
| Cancel | event.manage | draft/scheduled/ready/live/finalizing | cancelled, closed registration, revoked capability epoch |
| End all runs and cancel | event.manage + event.live | same, with active sessions | explicit confirmation, atomic closure and neutral public sessions |
| Return to preparation | event.manage | cancelled, no scores or played session | ready/scheduled, registration closed, no session resurrection |
| Archive | event.manage | completed/cancelled or legacy archived, no active session | archived disposition; outcome and data preserved |
| Unarchive | event.manage | archived | active disposition; terminal outcome preserved |
| Trash | event.manage | active/archive, no active session | trash, public event removed, capability epoch advanced |
| Restore | event.manage | trash only | previous disposition/outcome, registration closed, live pointer removed |
| Permanently delete / resume | event.read + event.delete | trash/deleting | recent Auth authentication, exact title and revision; server batches |

`event.delete` is the existing deletion permission. The owner preset includes it explicitly; manager/moderator/referee presets do not. Every role requires this concrete permission in its current membership. The current coordinator policy supersedes the former implicit owner exception: an older owner membership without the explicit permission now fails closed. This local correction does not migrate live memberships. An event organizer or immutable `createdBy` identity supplies no extra permission; `createdBy` only resolves an `own` resource scope. A cloud operator is not an application owner. Explicit delegation uses the existing grant parser and scope rules. No legacy admin claim grants authority. Trash metadata/inventory is available only with event.manage or event.delete, within event scope; ordinary private reads, export and snapshot/media reads reject trash/deleting. Membership is reread in write transactions, so revocation conflicts with writes even for an old ID token. Permanent deletion still requires event.read, active membership, matching event scope, recent authentication, exact title and revision.

## Actual event relationships and deletion allowlist

- `events/{id}` owns registrations, registrationNames, registrationOperations, scores (with history), scoreOperations, refereeAccess, emailIntents, emailSecrets, emailCampaigns and eventOperations.
- `sessions` are discovered by exact eventId and checked against the event's liveSessionId. Each owns interimVersions/interimOperations/finalVersions/finalOperations and its exact publicSessions copy.
- `quizSnapshots` are discovered by owner eventId, exact assignment and session references. Both existing and missing roots require an exclusive-reference check. Shared snapshots remain. Snapshot slides/rounds are deleted only with proven ownership.
- `publicEvents/{id}` is the event's public projection. Library quizzes, source questions, library media, Auth users, memberships and global referee limiters are never deletion targets.
- Current media assets are library-owned; generated PDFs are response bytes. The deletion implementation has **zero Storage mutations**. Any future event file type requires a reviewed exact-reference/generation contract before entering this allowlist.

Deletion stores a server-created plan and cursor in eventDeletions, first locks the event as deleting, and removes content in batches of at most 100 documents. Missing parent documents are discovered with listDocuments; unknown descendants stop the job. Each transaction rereads membership, event lock and phase/count to serialize concurrent resume requests. Root deletion happens last. A reload exposes persisted progress; the next authorized call resumes. There is no cron, browser deletion loop or bulk trash command.

Completed jobs retain only event ID, counts, completion time and retained-snapshot count. eventTombstones retains ID, original creator, revision and deletion time; eventAudit retains operation/actor/time. Contacts, title, answers and deleted content are not copied into these records. “Deleted” means removed from the application's active data; provider backup/soft-delete retention is unchanged.

## Concurrency, compatibility and links

Transitions use expected revision and an actor/event/request receipt; repeated requests do not repeat the audit. Operational writers read the same event in their transaction: registration, team updates, scoring, snapshot lock, live creation/control, referee access and delayed email work. Completed/cancelled/archive/trash/deleting cannot be bypassed through old handlers. Date fields use Europe/Prague, reject nonexistent DST times and require an explicit offset for repeated autumn times. Conflict handling retains the form and merges untouched fields from the newer version before a second explicit save.

Cancellation and trash increment capabilityVersion. Old team/referee links stay revoked after restore; issuing a new link rotates the token. Registration create retry also checks the recovered token against the current hash, preventing a revoked retry capability from reading data after rotation. Cloud registration has no email secret dependency, stores only token hashes and derives retry tokens from a 256-bit random client retry capability with a domain-separated SHA-256. Emulator-only fake email tests retain their vault. Cloud email endpoints remain absent and no messages are queued.

The existing event list now uses scoped document-ID pages (100 at a time), includes legacy documents without new fields, and computes filter counts only from permitted data. The UI displays 20 per page. There is no global count or cross-scope audit feed.

## Release and rollback

Any infrastructure binding for callable endpoints requires separate concrete review and approval. Transport reachability does not grant application permission.

Deploy backend guards first, verify them, then Rules and Hosting. Do not roll back to a pre-disposition backend after trash data exists: that could reopen content. A safe UI rollback keeps the protective backend/Rules; backend repair is a reviewed forward fix. No backfill or original-content writes are part of this release.

Bounds fail closed: 200 sessions per event and 1000 owned snapshots per plan; unknown child schemas or corrupt/ambiguous live pointers require an explicit repair before continuing. Already downloaded or photographed data cannot be recalled. Reauthentication currently uses the existing email/password provider.

## Manual completion and presentation END, 2026-10-20

Ending a presentation changes only that private session and its sanitized public session. It neither completes the event nor changes its revision, registration settings, publication, scores, confirmed results or other presentations. The same operational event can start another presentation.

The explicit settings action completeEvent accepts eventId, expectedRevision, an optional requestId/reason and optional endLive. It requires current scoped event.manage; endLive: true additionally requires event.live. Ready/live/finalizing events in active disposition may complete. Every waiting/active event session requires explicit endLive: true and is then closed atomically. Completion records a private trusted actor/time/reason, advances the capability epoch and event revision, closes/unpublishes registrations and removes publicEvents. Source snapshots, scores/history, finalVersions and interimVersions are retained. Actor/event/request receipts are revisioned and idempotent; stale state, revoked authority and foreign scope fail closed.
