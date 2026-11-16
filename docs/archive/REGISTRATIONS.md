# Event Registrations V1

## Implemented scope

An administrator configures `registrationOpensAt`, `registrationClosesAt`, and publication on an event. Server time decides whether creation, management-link edits, and management-link cancellation are available. There is no waitlist: a transaction rejects any request that would exceed either the team or people capacity.

The public form requires only team name, member count, and email. Team names are NFC-normalized, trimmed, whitespace-collapsed, and compared case-insensitively within the event. A SHA-256 name reservation document makes uniqueness transaction-safe.

Accepted registrations can be edited or soft-cancelled with the unguessable management link while the registration window is open. The raw token is placed in the URL fragment, which is not sent to Hosting or in HTTP referrers. Cancellation releases both counters atomically and is idempotent. The guarded local demo/emulator email path can create private transactional email intents and use capture transport; the current cloud runtime creates neither email intents nor token envelopes. New forms retain in-memory operation retry identifiers, while server-only receipts prevent duplicate operations after response loss. See [TRANSACTIONAL_EMAIL.md](TRANSACTIONAL_EMAIL.md) and [SECURITY.md](SECURITY.md) for the local envelope/delivery contract and separate cloud prerequisites.

Every actual public update increments the registration's private revision, treating a missing legacy revision as zero. No-op updates and operation replays leave it unchanged; a delayed replay returns current data without reverting a later edit. Staff link reissue checks that same revision, so a previously loaded team cannot receive a new link after its contact, name or size changes without first reloading. Rotation revokes the old token. Public response fields remain unchanged, and revisions are not added to public DTOs.

Staff use `/admin/events/:eventId/registrations`; current membership, concrete permissions and event scope authorize each read or mutation as described in [PERSONAL_ACCESS.md](PERSONAL_ACCESS.md). Authentication or a role label alone grants no access. Contacts never enter `publicEvents` or the PDF `PrintTeam` adapter.

## PDF contract

Management forms load the event's actual team-size limits through `publicEvents`; server validation remains authoritative. Public failures are mapped to Czech messages without displaying raw server exceptions. A full event still permits existing teams to reduce their size or cancel while the window is open. Manual closure means unpublishing registration; cancellation does not reopen it. Expired windows likewise deny self-service changes.

`accepted Registration -> PrintTeam` maps only the registration document ID and display team name. The server resolves one or all accepted teams; cancelled teams and contact fields cannot be supplied by the browser or rendered.
