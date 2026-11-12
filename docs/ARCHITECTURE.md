# Architecture


Images use their verified original web sources in editor and frozen event views;
Drive remains the video/audio backend. See [ORIGINAL_IMAGE_SOURCES.md](ORIGINAL_IMAGE_SOURCES.md).

Native player lifecycle and conditional private-media reads are documented in
[MEDIA_PLAYBACK_REVALIDATION.md](MEDIA_PLAYBACK_REVALIDATION.md).
Exact imported-clip resolution for older immutable event snapshots is documented
in [SNAPSHOT_DRIVE_CLIPS.md](SNAPSHOT_DRIVE_CLIPS.md).

The live V2 address is `https://justkviz-v2.web.app`. Its Hosting site uses the existing V2 Firebase project and its already deployed backend, without moving accounts or content. The technical project ID retains its historical `-staging` suffix. See [LIVE_RELEASE.md](LIVE_RELEASE.md) for the owner-directed transition and preserved old links.

## Goals

JustKvíz is a small but real application for preparing and running pub quizzes. The architecture favors clear boundaries and operational reliability over unnecessary layers.

## Repository layout

The repository is a pnpm workspace with two deployable units:

1. `apps/web` — one React/Vite single-page application with three route groups.
2. `functions` — Firebase Cloud Functions forming the trusted server boundary.

Local-only tooling lives outside deployable units. `tools/migration-v1` is a fail-closed V1 library migration pipeline and has no deployment role.

The optional Windows media companion in `tools/media-companion` prepares bounded
YouTube clips through an outbound, revocable device capability. Upload, private
Drive credentials, media validation and quiz attachment remain server-side.
See [LOCAL_MEDIA_COMPANION.md](LOCAL_MEDIA_COMPANION.md).

Keeping one web application avoids duplicated infrastructure while route-level modules preserve separation between audiences.

## Web route groups

### `/admin`

Authenticated working area for admins and moderators. Route guards improve UX, but Firestore Rules and Cloud Functions remain the authorization boundary.

### `/projector`

Public, read-only display for the active session. It consumes a deliberately sanitized projection document and never queries private quiz/question documents directly.

### `/events`

Public event list and registration surface. Public event data contains capacity/status information but no team contact details.

Event price configuration belongs to the authoritative event, with a 350 CZK per
team default for historical records. Trusted event mutations validate explicit
per-team, per-event or agreement pricing; legacy update clients preserve current
pricing when omitting it. Price visibility is independent: admins can hide a price
while retaining its amount privately. Scoped staff reads retain that value; all
public-event rebuilds replace hidden pricing with an agreement/null redaction and
`hidden: true`. Current public screens omit it, and cached clients can still parse
the redaction. Older editors omitting visibility preserve it. This changes no
payment processing.

## Data flow and trust boundaries

```text
Admin browser ── authenticated requests ──> Firestore / Cloud Functions
                                                  │
                                                  ├─ private quiz data
                                                  ├─ private registrations
                                                  └─ sanitized public projection

Projector browser ── read only ───────────────────> sanitized public projection
Public browser ───── public reads / validated call> public events / Cloud Function
```

Sensitive state transitions—quiz editing, team registration, quiz publication, live-state changes, answer reveal, role management, and result finalization—belong in Functions. The implemented editor and live-session callables use Firestore transactions and explicit optimistic revisions. The server derives authoritative fields such as timestamps, counters, ordering, revisions, derived round/question records, and public projection payloads.

## Frontend modules

- `app`: router and top-level application composition.
- `routes`: route-group screens and future nested routing.
- `services/firebase`: SDK initialization and emulator wiring.
- `styles`: global design tokens and base presentation.

Root routes have an eagerly loaded, public-safe error screen for failed route
modules and rendering errors. It never renders the underlying exception or URL;
refresh is explicit and retains the current URL, with no automatic reload loop.
The Hosting configuration revalidates HTML entry pages (including deep links) so
a new visit does not reuse a stale app entry point after a release. Already open
tabs can still need the explicit refresh if an older lazy module was replaced.
Hashed assets keep their existing cache behavior. The settings page contains
account/access controls only; quiz appearance remains in the quiz editor.

Feature folders may be added when real behavior arrives. A generic repository/service abstraction is not required until repeated use proves it valuable.

The first implemented feature is the read-only admin quiz library. `features/quizzes/quizRepository.ts` is a small query and runtime-mapping boundary. It reads only private `quizzes`, nested `rounds`, and nested `questions`; its UI view model deliberately omits correct answers. V1-migrated quizzes additionally keep a private, globally ordered `slides` source stream so intro, agenda, recap, end, and other presentation records are not forced into question documents. That stream is not a projector API; trusted Functions derive the deliberately sanitized `publicSessions` state from private source data.

The live feature now provides that trusted boundary. Staff control `/admin/live/:sessionId`, while anonymous `/projector/:sessionId` subscribes only to one `publicSessions` document. `functions/src/live/publication.ts` allowlists slide publication; the interim-results boundary independently publishes only a reviewed page of rank/name/total rows. The dedicated projector route is outside admin layout and renders a responsive 16:9 canvas through the same `SlideRenderer` used by editor draft preview. The projector refuses cached snapshots and clears visible state when the browser goes offline, preventing an old recap answer from lingering after a disconnected slide transition.

Media and recap commands are revisioned trusted mutations with monotonic media-generation tokens. Moderator command intent is separate from confirmed player lifecycle. Normal AUDIO deliberately omits its source from the public projector model and plays from a visible moderator player; its vinyl moves only after confirmed PLAYING. VIDEO mounts one projector player only while preparing/playing and falls back to the question on error. Recap publishes one selected answer at a time. The projector accepts presentation state only from Firestore; inbound BroadcastChannel presentation messages are ignored. The channel retains only player lifecycle reporting to the moderator. Details are in `PROJECTOR_ARCHITECTURE.md` and `MEDIA_ARCHITECTURE.md`.

The round-first quiz editor lives at `/admin/quizzes/:quizId/edit`. A memoized semantic facade turns the private global slide stream into quiz, introduction, rounds, locally numbered questions, and system recap nodes without rewriting migrated records. Its focused responsive shell provides structure, type-specific form, and local projector-style preview panels. Admins can mutate; moderators receive the same private read model in a disabled read-only UI. Every write calls `functions/src/editor/callables.ts`; Firestore Rules continue to reject all direct quiz writes. The client sends the quiz revision it rendered, and a stale editor receives `aborted` instead of overwriting another save. New-question drafts and form changes remain local until the one explicit Save action; there is no autosave.

Quiz readiness is a derived domain layer over that same bounded semantic model. Shared question validation feeds both editor feedback and the whole-quiz `/admin/quizzes/:quizId/readiness` route; structure and static media checks add typed human issues and semantic fix targets. The result is ephemeral and staff-only. It performs no per-question Firestore reads, writes no validity flag, does not publish to `publicSessions`, and is an optional editorial review, independent of the author-controlled draft/ready library status. Starting rehearsal and preparing an event do not require running or passing it.

The simplified editor checks the complete working copy after a short typing pause and hides results while that copy is changing. Opening an absent optional section does not create content for validation. Unsaved changes remain a start blocker, but are displayed separately from content defects. Basic authoring shows the prompt, answer and media first; appearance controls mount when opened. Creating another question or round explicitly saves pending work before continuing; ordinary typing does not write. The collapsible outline uses separate selection and drag handles, with keyboard/menu alternatives through the existing revision-protected move operations. Event preparation rereads the selected source immediately before locking its exact revision; authoritative counts, contiguous positions, a visible slide, model mapping and owned media validity remain mandatory technical checks. Event-list removal calls the existing `trashEvent` after one confirmation and applies the acknowledged disposition locally; permanent deletion retains its separate safeguards. No data model, permission, snapshot or public projection contract changes.

The guided repair layer lives at `/admin/quizzes/:quizId/readiness/repair`. It consumes the same bounded quiz load and `PreflightResult`, orders current blockers by their semantic references, and supports only two intentionally narrow repairs: an explicit Choice option index and explicit Video START/END seconds. Moderators can inspect the queue but cannot save. Admin saves call `repairQuizPreflightIssue`, which reloads the authoritative slide in a revision-checked transaction, derives the selected answer from the current stored options, or validates the explicit timing pair, and returns only the normal sanitized mutation counters. After every save the browser reloads the whole authoritative quiz and reruns shared preflight before removing an item from the queue. Unsupported blockers retain their severity and deep-link to the full editor.

Registration email delivery uses a trusted server-only outbox with bounded idempotent intents, encrypted provider material and explicit activation. Public registration capabilities never grant direct provider or private contact access. Disabled or unapproved transport must fail closed before provider calls. See the transactional-email and Gmail-delivery contracts.

Event team tools add two admin-only manual-team callables over that same registration ledger (not a parallel team store), plus shared manual-team and public-link/QR UI. See `EVENT_TEAM_TOOLS.md` for idempotency and delivery scope.

The PDF Print Center adds `/admin/events/:eventId/print` and a binary HTTPS Function. The Function resolves the event's immutable snapshot and accepted registration roster, maps them into minimal typed print models, and passes those models to a deterministic Firestore-independent renderer. `PrintTeam` contains only a stable registration ID and display name. Admins can generate all document types; moderators can generate team sheets and score tables but not answer keys. The browser owns only Blob preview/download lifecycle and never supplies answer-bearing content, team contacts, or roster contents.

The print redesign retains that boundary and derives answer mode independently of media from shared domain semantics. Player sheets draw only response labels/counts, while the separate privileged answer key uses answer content. Standard/compact A4 and transient color/grayscale options share the same real PDF preview/download. The editor's undefined inline field classes were replaced with scoped responsive fields. Implementation, verification and release scope: [PRINT_CENTER_REDESIGN.md](PRINT_CENTER_REDESIGN.md).

Player and organizer sheets are now laid out directly as two independent half-A4 portrait panels on one landscape A4, with a central cut guide and per-panel identity/pagination. The new `organizer-sheets` artifact uses the same current answer-read/export permissions as the separate answer key. Both private choices require an explicit UI confirmation before generation and carry conspicuous private labels and distinct filenames; that confirmation is only a UX safeguard, never server authority. Player rendering remains answer-independent. No stored document, roster or Rules schema changes.

`functions/src/editor/model.ts` applies known-field patches to an authoritative server snapshot. Unknown top-level values, malformed future values, unedited media records, presentation extensions, and `legacy.raw` remain private and are preserved. Trusted round/question mutations duplicate, move, reorder, or remove semantic groups while normalizing global positions and refreshing the derived round/question projection in the same bounded transaction. The shared `SlideRenderer` renders both public projector state and the editor's private local preview; the editor reaches it through `SlidePreview`, which may receive a correct answer only for an explicit local answer preview and never writes `publicSessions`.

## Firebase services

Whole-evening visual authoring adds bounded quiz/round/slide design inheritance and frozen result/print templates to these same boundaries. The moderator preview consumes the actual public payload; questions, scores and results retain their original authoritative sources. See [WHOLE_EVENING_DESIGN.md](WHOLE_EVENING_DESIGN.md).

- Authentication: staff sign-in; authorization through current server-managed membership, permissions and resource scopes.
- Firestore: operational and public projection data.
- Storage: quiz media, with metadata/access controlled by Firestore and Rules.
- Functions: validation, explicit staff authorization, revision-checked live transactions, sanitized publication, and other trusted operations.
- Hosting: Vite static build with SPA rewrites.

## Environments

- Local: Firebase Emulator Suite with `demo-filmovy-kviz-v2`.
- Staging: isolated `filmovy-kviz-v2-staging`, configured through the guarded staging tools; see `STAGING.md`.
- Production: never targeted without explicit approval.

No production project identifiers or credentials are stored in this repository.

## Testing strategy

The quality gate includes static checks, production builds, unit/migration tests, Firestore Rules emulator tests, and Auth/Firestore/Functions emulator E2E flows for live control, editor CRUD, guided repair, and trusted event/snapshot workflows. Separate local-only migrated-data checks open all 4 offline V1 quizzes and 315 slides through the editor read shape, round-trip one representative of each observed slide kind, and run whole-quiz readiness over all 263 questions without printing private values. The real export is never available to CI. Event-night repair reports and progress live only below Git-ignored `.local-data/tonight-repair/` and contain semantic references/counts, never question copy, options, answers, media URLs, notes, or raw legacy values.

Internal scoring lives at /admin/events/:eventId/scoring, linked from the event detail. It uses the existing registration roster and immutable snapshot round IDs. Revision-checked score changes, append-only history, idempotency receipts, and the first scoring.started transition share one transaction. Current membership and event scope are rechecked on every callable invocation and inside the score transaction. Private subscriptions preserve local drafts; there is no publication or BroadcastChannel path. See EVENT_SCORING.md for the data and lifecycle contract.

## Referee access

The separate /referee/:eventId surface uses event-scoped bearer grants and minimal callable read models. It shares the staff scoring transaction and never receives private snapshots or registration contacts. See [REFEREE_ACCESS.md](REFEREE_ACCESS.md) for the authorization, lifecycle and deployment contract.


Event-bound moderation and explicitly reviewed cumulative result versions use the existing live/projector routes. See [INTERIM_RESULTS.md](INTERIM_RESULTS.md) for binding, transactional confirmation, pagination, closure and deployment dependencies.


Final reveal extends the same event-bound live session with private immutable finalVersions, revisioned finalOperations and an explicitly revealed public page. Staff confirmation, corrections, closure and moderator-only synthetic sound are documented in [FINAL_REVEAL.md](FINAL_REVEAL.md). No Rules, indexes or cloud data change is required by this implementation.

Show Mode extends these same confirmed-result transactions and public session
allowlist; it does not create another score or ranking source. New show versions
use six-row server pages, while missing historical pagination metadata continues
to mean classic eight-row pages. Interim entry captures a private return intent
and publishes an answer-free static slide backdrop; hide reconstructs the previous
explicit answer/recap from the same authoritative snapshot only with current
answer permission, always with media stopped and a new generation. Final lower-rank
bulk reveal and separately paged revealed history contain only explicitly released
groups. Server cue metadata authorizes visual presentation, never future rows or
client-driven navigation. Event-scoped show preferences/audio bindings and a narrow
authenticated media gateway let moderators play linked owned MP3/WAV locally.
The integrated moderator queue serializes live and result commands. Details and
verification are in [SHOW_MODE_IMPLEMENTATION.md](SHOW_MODE_IMPLEMENTATION.md);
the deployment inventory is a local plan, not deployment authorization.

## Event organizational email

Owner registration notifications share the existing private email outbox and
Cloud Tasks worker. A successful new public registration atomically creates one
separate organizer intent, enabled only by trusted recipient/owner UID/cutoff
configuration. Current membership and event scope are rechecked at delivery;
participant mail remains independent. See [TRANSACTIONAL_EMAIL.md](TRANSACTIONAL_EMAIL.md).

Registration email has a backward-compatible, explicit recipient policy in the
trusted runtime. Missing `REGISTRATION_EMAIL_RECIPIENT_POLICY` means `selected`,
preserving the existing single-recipient staging activation. The opt-in
`future-public-registration` policy admits only the three transactional
registration message types for canonical online registrations created at or after
one shared activation cutoff. The server records the registration creation time
and policy on each new intent; dispatch and every delivery claim reject unmarked
backlog and pre-cutoff registrations before queueing/lease/provider access. Public
create/update/cancel receipts and management capabilities retain their existing
contract. No email is added for no-op/replay/manual staff operations.


Admin-only preview/confirmation creates an immutable emailCampaigns record and recipient snapshots in the existing emailIntents outbox. The shared task worker delivers plain-text organizational messages without management capabilities or changes to registration confirmation status. All client campaign/intent access remains denied; safe history and status are exposed only through fresh-admin callables. Atomic recipient limits, snapshot/idempotence contracts and offline tests: [EVENT_TEAM_EMAIL.md](EVENT_TEAM_EMAIL.md).

## Owned media foundation

The separately prepared Google Drive connection adds owner-only OAuth and a private
folder selection in Settings. It is disabled until its dedicated media OAuth
project/client, secret bindings and Picker configuration are activated. The
OAuth/Picker project is separate from the existing V2 Firebase runtime and Gmail
project because Google revocation applies across a project's OAuth clients. Connection credentials
never use the existing Gmail grant or the chat connector. This initial slice does
not change media playback by itself. The separately gated media extension adds
private Drive-backed assets and import jobs; see [GOOGLE_DRIVE_MEDIA.md](GOOGLE_DRIVE_MEDIA.md).
Connection lifecycle remains in [GOOGLE_DRIVE_CONNECTION.md](GOOGLE_DRIVE_CONNECTION.md).

Quiz-scoped image/audio uploads use private asset metadata, create-only Storage grants and a current-role/current-publication HTTP read gateway. Immutable event snapshots keep stable asset references and generations; no cleanup runs. The existing MediaPlayer lifecycle selects YouTube or native audio while retaining the one-player budget. See [MEDIA_STORAGE.md](MEDIA_STORAGE.md) for boundaries and future deployment checks.

Media authoring extends the shared picker/gateway/renderer to question, private answer and background roles. Explicit empty fields detach without deleting legacy data or snapshot assets. See MEDIA_AUTHORING_RELEASE.md for the complete contract and deployment scope.


Complete editor extends the same private ordered stream with explicit draft/ready authoring, independent answer mode, default appearance, atomic round/recap creation and private in-memory rehearsal. Drafts remain editorial findings in optional preflight; saved drafts can be used for rehearsal and event snapshots through the same sanitized publication boundary. See [COMPLETE_EDITOR_RELEASE.md](COMPLETE_EDITOR_RELEASE.md) for field compatibility, authorization, verification and the integrated deployment manifest.

## Current personal access boundary

[PERSONAL_ACCESS.md](PERSONAL_ACCESS.md) supersedes the historical admin/moderator descriptions above. Private repositories use scoped server views; raw data is available only with all sensitive permissions. Every existing staff callable and gateway enforces current membership independently. Preset labels do not authorize access. AuthProvider watches its own server membership and remounts private views on identity/version changes. See the release document for the explicit deployment inventory and invitation activation gate.

## Event management extension

The main dashboard uses the existing scoped event and quiz summary reads. It does
not fetch registration rosters or snapshot contents to calculate attendance.
Manual publication and the anonymous event boundary are described in
[EVENT_PUBLICATION.md](EVENT_PUBLICATION.md).

See [EVENT_MANAGEMENT.md](EVENT_MANAGEMENT.md) for the independent disposition overlay, scoped permission mapping, shared transactional guards, capability revocation and exact server-side deletion ownership/allowlist. No content backfill or Storage cleanup is introduced. Cloud team email remains disabled.

Moderator presentation END and event completion are independent. END only closes the selected presentation; explicit completeEvent in event settings applies current scoped manage/live checks, closes sessions when explicitly requested, and retains scores/snapshots/confirmed result history. Explicit question jumps can atomically dismiss result overlays into an unrevealed snapshot slide; finale publication remains reviewed and revision-protected. See EVENT_MANAGEMENT.md and FINAL_REVEAL.md.
