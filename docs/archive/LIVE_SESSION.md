# Live quiz session and projector publication

## Boundary

`sessions/{sessionId}` is the private control record. `quizzes/{quizId}/slides/{slideId}` remains the private source, including correct answers, moderator notes, and legacy raw data. Only staff can read those paths, and no client can write them.

`publicSessions/{sessionId}` is a replace-only, server-generated snapshot. The anonymous projector knows one random session ID and can get that document, but cannot list sessions or query private data.

```text
staff callable → transaction → private session
                            └→ allowlist sanitizer → public session → anonymous projector
```

## Lifecycle

| State | Position | Reveal | Allowed transitions |
|---|---:|---|---|
| `waiting` | 0 | false | next/go, end |
| `active` | 1…slideCount | false/true | next, previous, go, reveal/hide when valid, end |
| `ended` | last private position | false | none |

The first successful navigation sets `startedAt`. Navigation always sets `answerRevealed` to false. End sets `endedAt`, clears reveal state, and publishes an ended snapshot without slide payload.

## Callable API

- `createLiveSession({ quizId })`
- `goToSlide({ sessionId, position, expectedRevision })`
- `nextSlide({ sessionId, expectedRevision })`
- `previousSlide({ sessionId, expectedRevision })`
- `revealAnswer({ sessionId, expectedRevision })`
- `hideAnswer({ sessionId, expectedRevision })`
- `selectRecapQuestion({ sessionId, position, expectedRevision })`
- `playMedia({ sessionId, expectedRevision })`
- `stopMedia({ sessionId, expectedRevision })`
- `replayMedia({ sessionId, expectedRevision })`
- `finishMedia({ sessionId, mediaGeneration, expectedRevision })`
- `startIntro({ sessionId, expectedRevision })`
- `endLiveSession({ sessionId, expectedRevision })`

Every callable requires Firebase Auth plus an `admin` or `moderator` custom claim. The server validates all string IDs, slide bounds, authoritative quiz/slide existence, and session state. It never accepts a quiz ID during mutation and never returns a private slide or answer.

## Publication allowlist

Before reveal, the public document can contain only lifecycle metadata and these active-slide fields: `slideKind`, title, text, primitive options, prompt/background media references, and numeric/string presentation controls. Nested objects are reconstructed rather than copied.

After reveal, `revealedAnswer` is a display string derived from the private answer. An answer-role image may be published as `answerImage`. `correct`, `correctAnswer`, `moderatorNote`, `legacy`, `raw`, arbitrary media roles, recap overrides, and whole private objects are never copied.

The Firestore transaction uses a replacing `set`, not merge. Moving or ending therefore removes previously published answer fields. Projector subscriptions reject cache-only snapshots and clear on offline events to avoid showing a stale revealed answer after losing connectivity.

## Concurrency

Each private/public state carries a monotonic `revision`. A client must send the revision it rendered. The transaction rereads the authoritative session; only one concurrent action with that revision can commit. A double-click, second admin panel, or reveal/next race causes one transaction to win and the stale operation to return `aborted`. Firestore retries do not bypass the explicit revision check. Ended sessions reject all further mutations.

## UI workflow

Staff start a quiz from its private detail page through `/admin/quizzes/:quizId/readiness`. Blockers disable the normal start; warning-only results require explicit acknowledgement; a clean saved quiz starts normally after one fresh bounded recheck. The current practice gate is a staff UI policy and does not change the callable authorization/publication contract. After creation, staff are routed to `/admin/live/:sessionId`. The control subscribes to the private session/current slide, shows the current answer only to staff, and offers previous, next, reveal/hide, end, and a projector link.

`/projector/:sessionId` requires no login and subscribes only to the public document. It renders waiting, active slide, selected recap answer, ended, not-found, loading, and connection-safe states through the shared `SlideRenderer`. Normal AUDIO playback stays on the moderator device and publishes no source to the projector. VIDEO and recap media use the explicit revisioned PLAY/STOP/REPLAY lifecycle described in `MEDIA_ARCHITECTURE.md`. A media ownership/upload subsystem remains intentionally deferred.

Existing `pl` is presented to authorized editors as locked legacy **Pravda / Lež** content. Its storage shape and raw metadata remain private and are never published to the projector.


## Event-bound interim results

The event detail can create/open one snapshot-bound session through `createEventLiveSession`. `previewInterimResults` is private/read-only; `controlInterimResults` publishes a reviewed immutable version, selects a manual page, or hides it. The existing projector renders `ResultsTable`; regular navigation/media controls require hiding the table first, while END remains available. Event cancellation/archive also end the bound presentation atomically. The full contract and future deploy dependencies are in [INTERIM_RESULTS.md](INTERIM_RESULTS.md).
