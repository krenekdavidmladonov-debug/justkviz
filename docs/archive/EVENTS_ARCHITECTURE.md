# Events Foundation architecture

## Status and scope

This document is the implementation contract for the first Events Foundation slice. It supersedes conflicting recommendations in the research-only `research/events-scoring-architecture` branch.

Implemented:

- trusted event create/update/cancel/archive mutations;
- immutable quiz assignment snapshots;
- shared server-side quiz preflight during lock/relock;
- sanitized `publicEvents` projection;
- minimal staff and public event UI.

Explicitly deferred: registration forms and records, email, management links, teams, referee QR, score writes, leaderboards, results reveal, PDFs, and digital answering.

## Confirmed product decisions

- Registration closes at either capacity; the first version has no waitlist.
- Each event has both a maximum team count and maximum people count.
- Minimum and maximum team size are configurable per event.
- Future registration is automatically confirmed while both capacities allow it.
- One email may register different teams, while a team name is unique within one event.
- Email is the only required contact. Phone is optional and need not be collected in the first version.
- A secure management link may edit/cancel a registration until registration closes.
- Admin may create a replacement quiz snapshot before scoring. From the first stored score onward, relock is forbidden.
- Scores support half-points as integer units: `unitScale=2`, one point is two units.
- Ranking is dense: `1, 2, 2, 3`.
- END is an explicit moderator action.
- Revealing rank 1 starts winner music once for the complete co-winner group.

Only the event, snapshot, and scoring configuration foundations exist in this slice. The future policies above are recorded but not simulated with placeholder registration/scoring data.

## Domain boundary

```text
editable quizzes/{quizId} at revision R
          │
          │ admin lockEventQuiz(eventRevision, quizId, R)
          ▼
shared runQuizPreflight ── blocker ──> reject with no writes
          │
          │ READY or explicitly acknowledged warnings
          ▼
atomic private quizSnapshots/{snapshotId}
          │
          └── events/{eventId}.quizAssignment

events/{eventId} ── allowlist mapper ──> publicEvents/{eventId}
```

`QUIZ` is reusable editable content. `EVENT` is a scheduled performance. A single quiz can therefore produce independent immutable snapshots for multiple events.

## Event model

`events/{eventId}` is private and has:

- `schemaVersion: 1`;
- `title`, `startsAt`, `timeZone`;
- `venue: { name, publicLocation }`;
- `teamCapacity`, `peopleCapacity`, `teamSizeMin`, `teamSizeMax`;
- `registrationStatus`: `scheduled | open | paused | full | closed`;
- `lifecycleStatus`: `draft | scheduled | ready | live | finalizing | completed | cancelled | archived`;
- nullable `quizAssignment`;
- `scoring: { unitScale: 2, rankingMode: 'dense', started: boolean }`;
- monotonic `revision` and trusted create/update actor/timestamps.

The implemented creation flow starts at lifecycle `scheduled`, registration `scheduled`, scoring not started, and revision 1. This slice does not expose a browser operation that marks scoring started.

All capacity and team-size values are positive integers, `teamSizeMax >= teamSizeMin`, and `teamSizeMax <= peopleCapacity`. Counters are intentionally absent until the transactional registration slice owns them.

## Lifecycle semantics

- Normal configuration updates are allowed only in `draft`, `scheduled`, and `ready`.
- Lock/relock is allowed only in those states and only when server-owned `scoring.started` is false.
- Cancellation is allowed before `completed`, `cancelled`, or `archived`; it closes registration and removes the public projection.
- Archive is allowed only from `cancelled` or `completed` and removes the public projection.
- Browsers cannot directly set lifecycle, readiness, revisions, timestamps, actors, scoring state, or assignment.

## Immutable quiz snapshot

Every successful lock creates a new random `quizSnapshots/{snapshotId}`. It stores exact quiz ID/revision, title, counts, a non-sensitive preflight summary, and trusted audit fields. Its `slides` subcollection copies the complete private authoritative slide documents, including presentation data, correct answers, media references, and private legacy extensions. Its `rounds` subcollection copies the stored round structure.

The snapshot does not copy the derived nested question collection because the global private slide stream is the lossless presentation and answer source; snapshot round records plus question slides preserve the required structure without breaching Firestore's 500-write transaction limit for the verified 315-slide dataset. Lock fails closed if the bounded atomic snapshot would exceed the configured transaction budget.

There is no snapshot update/delete callable and all direct client writes are denied. Relock creates a new snapshot and changes only the event pointer. Old snapshots remain unchanged.

## Preflight and TOCTOU safety

The web editor and Functions import `runQuizPreflight`, semantic mapping, and question validation from `@filmovy-kviz/quiz-domain`. There is no second event-specific policy engine.

`lockEventQuiz` uses one Firestore transaction to read the event revision, quiz revision, ordered slides, and ordered rounds; run shared preflight; create the snapshot; attach it; set lifecycle `ready`; and replace the public projection. A blocker rejects the transaction. Warnings require `acknowledgeWarnings: true`. The exact quiz revision supplied by the reviewed client is reread inside the same transaction, so a concurrent quiz edit aborts rather than locking different content.

Readiness is server-derived. No request accepts `isReady` or `lifecycleStatus: ready`.

## Public projection

`publicEvents/{eventId}` contains only:

- title, start timestamp, time zone;
- venue name and public location;
- registration publication/status and opening/closing window;
- team-size minimum/maximum;
- aggregate accepted and maximum team/people counts under `capacity` (added by the registration slice);
- projection revision and update timestamp.

It excludes quiz assignment/snapshot data, answers, organizer secrets, contacts, individual registration records, emails, tokens, and every private extension. Exact aggregate capacity counts are intentionally public; this supersedes the original foundation's coarse-capacity-only design. The Function replaces the full known projection on create/update/lock. Anonymous clients may read/query it and cannot write it. It is presentation data, never event authority.

## Next slice

The next recommended slice is server-only public registration and capacity transactions. It must introduce accepted team/people counters, unique normalized team-name reservation, email-only contact records, no waitlist, and generic anti-enumeration responses under its own Rules and emulator tests.
