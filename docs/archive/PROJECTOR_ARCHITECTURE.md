# Projector architecture

## Window and rendering boundary

`/projector/:sessionId` is routed outside `AppLayout`. Its first paint, viewport outside the canvas, error state, and fullscreen state are black and contain no admin navigation. The presentation is one centered 16:9 canvas sized by the smaller viewport dimension; it scales as a unit instead of reflowing like a mobile page. Fullscreen is requested only after the user's button click or `F` key press. `Esc` remains the browser default. A rejected or unsupported request leaves the projector functional and displays a small browser-fullscreen fallback message. A blocked popup is reported in the moderator panel rather than silently ignored.

The moderator opens a named browser window from an explicit click. Repeated clicks reuse and focus it. The Window Management API is not required; where multi-screen placement is unavailable, the supported fallback is to drag the dedicated window to the projector and then enter fullscreen.

## Shared renderer

`SlideRenderer` is the only type-aware presentation component. The public projector and editor draft preview use it with different explicit modes. It supports question, recap, editor preview, round intro, agenda, rules, and end. The renderer input has no `correctAnswer` property: editor code must intentionally convert a private answer to `revealedAnswer` only for its local recap-style preview, and the public route receives that field only from the trusted publication allowlist.

The normalized roles are distinct:

- `backgroundImage`: cover background behind a black 0–100 overlay;
- `questionImage`: contained image region with black bars, used by IMAGE;
- `answerImage`: recap answer media;
- `mediaSource`: AUDIO/VIDEO source interpreted by a provider adapter;
- `clipStartSeconds` / `clipEndSeconds`: ordinary question segment bounds.

## Public state and player reports

Firestore `publicSessions/{sessionId}` remains authoritative. A callable transaction replaces the complete document whenever slide, recap selection, media command, intro command, reveal compatibility state, or lifecycle state changes.

The projector ignores inbound `BroadcastChannel` presentation messages. It renders only server-confirmed Firestore state, including reviewed interim result pages. On reconnect it attempts a server read before subscribing again, even when the revision has not changed. If the read fails while the browser reports online, the listener can recover without a browser connectivity event. Its cache-only snapshots leave the projector cleared. The route excludes content from a different session before render and ignores obsolete callbacks and lower revisions. Browser offline events and reported Firestore connectivity loss clear the visible state. A silent break may leave previously authorized content visible until the SDK reports the loss.

Projector playback reports are non-sensitive channel events containing only session ID, media generation, and an allowlisted lifecycle value. An authenticated moderator tab validates them against current state and invokes the trusted Function. On different devices, local VIDEO error fallback still protects the audience view, while the moderator retains explicit REPLAY/STOP/next controls.

The moderator serializes command mutations and player-state reports per live session. Each queued mutation advances from the newest server-confirmed revision, so an immediate REPLAY cannot race the preceding error report or erase its user-visible failure.

## Recap security invariant

Entering an authored recap slide creates an explicit recap mode with no answer selected. A selection callable loads exactly one prior question in the same round, verifies its private display answer, and republishes one public snapshot. The projector never queries private quiz, round, question, session, or answer collections. Choosing another recap question replaces the complete public document, so an older answer/image/source cannot remain.

Legacy reveal/hide callables remain only for compatibility. They are absent from the main moderator UX; recap is the normal answer-publication workflow.

## Future modules

Interim cumulative results now use the existing projector and shared `ResultsTable` with manual pages; see [INTERIM_RESULTS.md](INTERIM_RESULTS.md). Final results will separately need manual last-to-first reveal, winner music, and explicit END. Events/registration, print/PDF, referee tooling, live scoring, digital answering without speed bonus, media upload, and full offline operation are separate future modules and are not implied by this foundation.
