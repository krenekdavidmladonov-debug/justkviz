# Event overview and manual publication

## Team capacity simplification

Capacity is now the number of teams only. New or edited team registrations may
contain at most four members; any lower per-event maximum and the event minimum
still apply. Existing registrations and snapshots are never rewritten. Legacy
`peopleCapacity` and accepted-person counters remain in stored records/projections
for compatibility, but the aggregate person limit is neither a registration gate
nor an editable or displayed capacity in the event UI. Cancellation can still
remove a historical larger team without first changing its size.

The public detail removes the generic "Společně na kvíz" panel and shows a visual
summary of occupied/free team places. The registration form remains the primary
action on mobile. There is no data migration, new collection or Rules change.

The compact dashboard at `/admin` shows each published upcoming/current event with
its own team attendance, remaining team capacity, countdown and team occupancy
bar. Unpublished events remain in event management and never appear here. Draft quizzes,
ordered by actual `updatedAt`, appear below the statistics. Event management,
publication, history and snapshot details remain available through event details.

Publication reuses `registrationPublished`; lifecycle and registration windows
retain their existing meanings. Locking a quiz snapshot does not publish an event.
The normal admin action explicitly publishes and opens registration together.
It sends `published: true, openRegistrationsNow: true` to the existing
`configureEventRegistration` callable. Inside the authorized, revision-checked
transaction, the server sets the opening time to its current time and the closing
time to the event start. The start must still be in the future. No prepared quiz
is required for accepting teams. The team capacity remains authoritative.

For an already published future event with closed or scheduled registration,
the same explicit action is offered as "Otevřít registrace". It never runs on a
page read and never silently reopens a previous event. The confirmation names
the event and explains the closing time. The response returns canonical opening
and closing instants so the admin view immediately reflects the saved window.

The callable retains its visibility-only contract for older clients and explicit
window configuration for advanced scheduling. A window-only change preserves
visibility; combining explicit dates with `openRegistrationsNow` is rejected.
Revision checks prevent overwriting concurrent work. Hiding preserves the window.

`publicEvents` is an allowlisted projection, now also carrying public description
and lifecycle when available. It never contains private quiz content, team contact
data or permissions. Rules allow reads only for published projections; the public
repository queries `registrationPublished == true` and sorts by date locally.
An unrestricted collection query and direct hidden-document reads are denied.
No backfill, new collection, automatic publication or index is required.

Hiding retains canonical registrations, snapshots and history. Public registration
mutations still enforce visibility, operational lifecycle, time window, capacity
and management-token checks on the server. A narrow hide-only operation can remove
an already published historical event without reopening it or changing its window.

Dashboard statistics use canonical accepted-team counters for
each event separately, identified by its title and date. Cancelled
registrations are removed by the existing transactional counter updates. One bounded event-summary read and one
quiz-summary read (with pagination when needed) avoid per-event roster queries.

Quiz labels describe the event's immutable assignment. The current source quiz
revision is compared only when available through the caller's existing quiz read
scope. A newer source never silently changes the snapshot; the event detail keeps
the existing explicit prepare/update workflow. Missing assignment means no quiz
is prepared for this event; no separate draft-assignment state is invented.

Dates and calendar-day countdowns use the event time zone, including DST. Public
registration controls derive availability from the existing window and counters
instead of trusting a stale stored status. Dashboard data refreshes on returning
to the page, once per visible minute, and through an explicit refresh. Overlapping
loads are prevented; an older read cannot overwrite a newer publication revision.

The public list and detail present the date, venue and team occupancy
with distinct status accents. Open registration has a prominent
"Přihlásit tým" action. Closed, scheduled and full states keep their actual
availability; visual changes never bypass server validation.

Verification uses synthetic emulator data, Rules tests, publication/permission
contracts and browser coverage on desktop and mobile. The release manifest includes
V2 Hosting and the affected event/registration Functions. No Rules,
indexes, new collections or automatic data migration are required. Deployment
and any repair of an existing live event are separately recorded in the release
proposal. V1 is excluded.
