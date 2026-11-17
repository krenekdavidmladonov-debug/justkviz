# UX implementation follow-ups

Historical discovery register. The current implementation supersedes several proposals below: [JustKvíz branding](JUSTKVIZ_REBRAND.md), [dark theme](JUSTKVIZ_DARK_MODE.md), [owned question/answer/background media](MEDIA_AUTHORING_RELEASE.md), [complete authoring/default appearance](COMPLETE_EDITOR_RELEASE.md) and [immutable event quiz preparation](EVENT_MANAGEMENT.md) are implemented. Do not reassign them from this list. [Current completion evidence](COMPLETION_MATRIX.md) is authoritative for the remaining delivery scope. Projector presence acknowledgements, cross-device draft preview, external media probes and offline synchronization are separate optional extensions, not silently added acceptance requirements.

The first UX foundation intentionally preserves current product behavior. The items below need either a product decision or a separate technical slice before the interface can represent them honestly.

The minimum quiz-creation foundation is now implemented: admins get **Nový kvíz** in the populated and empty library, creation writes one titled empty private draft through an idempotent trusted Function, and success continues in the existing round-first editor. Moderator creation remains disabled, and no placeholder or public content is generated.

## Product decisions

- **Final brand identity:** replace the provisional `QUIZ PLATFORM` / `QP` values only after the product name, visual identity, and tone are approved. The application now has a central configuration and semantic token boundary for that change.
- **Recap viewed state:** decide whether moderators need a persistent “already shown” indicator and whether that state belongs to the live session. The current selected answer remains visually identifiable without adding persistence.

## Technical follow-ups

- **Reliable projector presence:** add an authenticated, bounded heartbeat/acknowledgement protocol before showing “connected”, “unresponsive”, or “disconnected”. Opening/focusing a browser window does not prove that the projector client is healthy.
- **Fullscreen confirmation:** add a projector-to-moderator acknowledgement if fullscreen state must be visible in the moderator shell. The browser window reference cannot reliably inspect a separate projector client.
- **Window reactivation across reloads:** the current tab can focus the window reference it opened. After a moderator reload, browsers do not provide a safe reference to the old window; the UI therefore offers to open it again and does not claim stronger behavior.
- **Theme variants:** add a light theme only after contrast and brand decisions. Semantic tokens support a future variant; phase one deliberately ships one dark admin theme.
- **Unsaved-draft projector preview:** design a separate same-device preview route and bounded transport before adding `Otestovat na projektoru`. It must show only the chosen local draft, must keep private answers off unless the moderator explicitly enables them, and must never reuse or write live `publicSessions`.
- **Controlled online media probe:** static whole-quiz preflight is implemented. A future best-effort online check needs one controlled player, deterministic cleanup, explicit rate/policy handling, and copy that never guarantees embed, availability, spoiler safety, or offline readiness.
- **Trusted event lock:** the normal practice/live UI now gates start through saved-quiz preflight. A future event-backed lock must reuse the shared rules at the trusted boundary and define how a locked quiz version is selected.
- **Generated agenda persistence:** the round-first facade generates the agenda from current round order and titles for the editor. Decide whether authored agenda slides should also be synchronized on every structural mutation; this task conservatively preserves their stored legacy payload.
- **Background authoring:** the model and shared renderer already support a safe HTTP(S) background with cover layout and overlay. Current authoring is partial: the URL/overlay block is hidden for Choice questions, there is no **Vybrat / Změnit / Odebrat** control, and no owned-background selection/upload workflow. Address this in a separate media slice, without changing media sources as part of an editor-save repair.
- **Media upload:** quiz-scoped image/audio asset infrastructure exists, but the editor background field still accepts only its current validated URL mechanism. Background ownership, selection, upload progress, replacement, removal, and cleanup need a separate trusted workflow.

## Preserved boundaries

- No media engine, projector publication state machine, BroadcastChannel authority, migration, Firestore model, or persistence behavior was changed by the UX foundation.
- Correct answers remain moderator-private until the existing authoritative reveal path publishes them.
- The round-first editor adds only admin-authorized quiz mutations; every mutation of an existing quiz remains revision-checked. It does not alter projector publication, media lifecycle, or BroadcastChannel authority.
- Quiz creation adds only an admin-authorized private draft root; it does not create slides, snapshots, live sessions, or public projections.
