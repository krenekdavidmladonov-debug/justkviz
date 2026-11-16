# Round-first quiz editor

## Documentation map

- This document is the canonical implemented behavior and persistence contract.
- [ROUND_FIRST_EDITOR_USER_GUIDE.md](ROUND_FIRST_EDITOR_USER_GUIDE.md) explains the administrator/moderator workflow.
- [ROUND_FIRST_EDITOR_DEVELOPER_GUIDE.md](ROUND_FIRST_EDITOR_DEVELOPER_GUIDE.md) maps the implementation and extension rules.
- [ROUND_FIRST_EDITOR_TESTING.md](ROUND_FIRST_EDITOR_TESTING.md) contains local operation, quality-gate, browser, migrated-data, and release procedures.
- [ROUND_FIRST_EDITOR_IMPLEMENTATION_REPORT.md](ROUND_FIRST_EDITOR_IMPLEMENTATION_REPORT.md) records the sanitized completion evidence.
- [QUIZ_PREFLIGHT.md](QUIZ_PREFLIGHT.md) defines the implemented whole-quiz readiness contract.
- [UX_IMPLEMENTATION_FOLLOWUPS.md](UX_IMPLEMENTATION_FOLLOWUPS.md) records intentionally deferred work.

## Product model

The focused editor at `/admin/quizzes/:quizId/edit` presents the private lossless slide stream as **quiz → rounds → questions**. The left outline contains the opening screen, generated agenda, editable rules, round settings, locally numbered questions, and one system recap entry per round. Positions, stored kind aliases, Firestore revisions, and legacy payloads stay out of the ordinary workflow.

The facade does not rewrite the 315 migrated source slides into a new schema. `buildSemanticQuizModel` derives indexed round and question views while keeping the globally ordered stream authoritative. Intro/outro and unknown records remain reachable as system or legacy content, so every source record remains represented.

Normal creation offers only choice, free answer, image, audio, and video. Existing `pl` records appear as locked-type **Legacy: Pravda / Lež** questions and remain editable. Unknown kinds use a conservative legacy form and are never converted automatically.

An admin can start at `/admin/quizzes/new`, enter a required title, and explicitly create one empty private draft. The trusted operation writes only the quiz root with `status: draft`, `revision: 0`, and zero counters, then opens the existing round-first editor so the admin can add a round and the first question. It creates no placeholder slides/questions and publishes no public document. Moderators can see the private library but cannot create a quiz.

## Forms and preview

Each question kind has a dedicated form:

- choice answers bind one radio selection directly to the option list and retain legacy fifth or sixth options;
- free answers do not expose option controls;
- image questions keep prompt image, optional choices, answer image, and background as distinct roles;
- audio and video require source, start, and end, use `mm:ss[.s]`, and provide a visible private test player with current-time capture;
- PL exposes only the existing true/false semantics and keeps its stored type locked.

The sticky preview receives the current local draft and uses the shared `SlideRenderer`; editing it neither saves nor publishes anything. Its answer toggle is explicitly a local private preview and defaults off. No editor action writes `publicSessions`.

Background rendering is already implemented in the normalized model and shared renderer: a valid HTTP(S) `backgroundImage` is cover-rendered behind slide content and `backgroundOverlay` controls the overlay. Authoring is only partial. Existing forms expose a URL field and overlay slider where `VisualFields` is mounted, but that block is currently hidden for Choice questions. The requested **Vybrat / Změnit / Odebrat** control and an owned-background asset picker/upload workflow are not implemented and remain a separate follow-up; this editor slice does not add a new media module.

## Save and navigation

The editor has one explicit **Uložit** action and Ctrl/Cmd+S; there is no autosave. A newly selected question kind creates only a local draft. The trusted create occurs on Save at the semantic insertion point immediately before the round recap/end boundary.

The visible states are Uloženo, Ukládám…, Neuložené změny, and Uložení se nezdařilo. Failed saves retain the draft. Outline changes, router navigation, the editor back link, and normal browser Back navigation are blocked while dirty by a modal with save, discard, and cancel choices; cancel receives default focus. A hard page unload also receives the browser's native unload guard.

Inline validation appears after a touched field, Save, media testing, or the local readiness action. Blocking rules cover required prompts/answers, option consistency, image source, media source, and finite ordered clip timing. The one compatibility exception is an unrelated edit to a persisted imported audio/video slide whose exact legacy `0/0` unset timing has not changed: Save may preserve that existing shape, while preflight still reports the missing timing as a blocker. New slides, changed media sources, and partially edited timing remain strictly blocked. The outline shows issue status without revealing answer data.

The editor header also opens a whole-quiz preflight panel. It overlays the currently selected local draft on the saved remainder of the quiz, identifies that source explicitly, and blocks live start while any editor draft is dirty. Issue actions use semantic round/question IDs and focus the relevant editor field when practical.

## Round and question operations

Admins can rename, duplicate, move, and remove rounds, and duplicate, move, reorder, or remove questions. Reordering always derives question numbering from authoritative order. A non-empty round removal names its question count and requires either an explicit destination round or an explicit delete choice; cancel is focused by default.

All structural operations are explicit user actions and remain disabled while a form draft is dirty. They call admin-only, revision-checked transactions. Round duplication creates fresh slide/round identities and copies authored data, not live-session state.

## Authorization and lossless writes

- Admin: private read plus callable mutations.
- Moderator: the same private editor read model in a disabled read-only UI.
- Ordinary authenticated user and anonymous client: no private read or write access.

Firestore Rules deny every direct client write below `quizzes`. Editor mutations are limited to the trusted callable boundary: empty quiz-root creation, metadata/slide update, slide create/duplicate/delete/move, round update/duplicate/move/remove, and question reorder/move-to-round. Each callable rechecks the `admin` custom claim, validates all input, and returns identifiers/counters rather than private content. Existing-quiz mutations require `expectedRevision`; root creation instead uses its actor-bound idempotency request because no quiz revision exists yet.

The server starts from the stored slide and overwrites only validated known fields. It preserves unknown top-level properties, unknown or malformed future values when left untouched, unedited media records, presentation extensions such as recap overrides, explicit empty V1 fields, and `legacy.raw`. The imported legacy `videoStart: 0` / `videoEnd: 0` sentinel is presented as unset normalized timing; an unrelated save preserves its existing stored top-level timing shape instead of materializing an invalid `0/0` range. Private correct answers are never logged or returned in mutation responses.

## Responsive behavior

- `>=1280px`: outline, form, and sticky 16:9 preview are visible together.
- `768–1279px`: outline remains available and the form/preview uses practical panel tabs.
- `<768px`: Struktura, Obsah, and Náhled tabs prevent a three-panel vertical stack; primary targets are at least 44 px.

The current 63–91-row quizzes do not require virtualization. Semantic indexing is memoized per loaded quiz, and direct maps provide question/slide lookup while a draft is edited.

## Verification and intentional follow-ups

Synthetic unit, Functions, Rules, callable E2E, browser, live/projector regression, and migrated-data suites cover the editor. Coverage includes admin-only idempotent empty-quiz creation, repeat creation requests, first round/question authoring, stale-revision draft preservation, and the imported legacy `0/0` timing sentinel. The local-only migrated check opens all 4 offline V1 quizzes / 315 slides / 23 rounds / 263 questions, round-trips a safe representative of all 10 observed kinds, restores each changed value, and reruns the independent migration verifier without printing private content.

Projecting an unsaved local draft is intentionally deferred. It needs a separate isolated preview-window protocol and must never reuse live `publicSessions`. Controlled online media probing and Storage upload are also separate features. Whole-quiz static preflight is implemented as documented in [QUIZ_PREFLIGHT.md](QUIZ_PREFLIGHT.md).
