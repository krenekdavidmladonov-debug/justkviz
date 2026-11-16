# Events Foundation security

## Trust model

- `events` and `quizSnapshots` are private.
- `publicEvents` is an allowlisted, disposable public view.
- Authentication is not authorization. Functions require the `admin` claim for every event mutation.
- Moderators may read event roots and snapshots for operations, but cannot change configuration or lifecycle.
- Every direct browser write to event roots, unknown event subpaths, snapshots, and public events is denied.

## Rules boundary

| Path | Anonymous | Ordinary auth | Moderator | Admin | Direct writes |
| --- | --- | --- | --- | --- | --- |
| `events/{eventId}` | deny | deny | read | read | deny all |
| `events/{eventId}/{document=**}` | deny | deny | deny | deny | deny all |
| `quizSnapshots/{document=**}` | deny | deny | read | read | deny all |
| `publicEvents/{eventId}` | read/query | read/query | read/query | read/query | deny all |

Unknown event child paths are denied deliberately. Registration, teams, scores, audit, and results must receive separate narrow rules only when implemented.

## Callable controls

`createEvent`, `updateEvent`, `cancelEvent`, `archiveEvent`, and `lockEventQuiz` independently require `admin`. They validate request shapes and bounds and never accept browser actors, timestamps, revisions to store, readiness flags, assignment objects, scoring state, capacity counters, or public projection fields.

Every callable uses an expected revision. Stale event operations abort. Lock additionally binds warning acknowledgement and the immutable snapshot to the exact expected quiz revision.

## Answer privacy

Snapshots intentionally contain private correct answers because future live/recap must use stable event content. They are never copied into `publicEvents`, never read by `/events`, and never available to anonymous or ordinary authenticated users. Existing `publicSessions` publication and answer-reveal rules are unchanged.

The public sanitizer is a construction allowlist, not a deletion filter. The registration slice explicitly added exact aggregate accepted/maximum team and people counts under `capacity`; `tests/events.test.ts` checks this complete public shape. Quiz assignment, snapshot references, answer-like fields, individual registrations and contacts remain excluded. No client can write the projection.

## Deferred private data

This slice creates no registrations, email/phone fields, management tokens, teams, referee capabilities, scores, leaderboards, results, jobs, or PDFs. No retention claim is made before those data types exist.

## Required regression evidence

- anonymous and ordinary-auth private denial;
- moderator/admin read and direct-write denial;
- public query/read and write denial;
- unknown event subpath denial;
- snapshot privacy and immutability;
- blocker/warning/revision lock behavior;
- existing projector, recap, editor, preflight, migration, and default-deny tests.
