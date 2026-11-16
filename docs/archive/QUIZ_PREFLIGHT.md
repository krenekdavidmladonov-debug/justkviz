# Quiz preflight / readiness

## Purpose and scope

Quiz preflight answers one operational question before a live run: **is this saved quiz safe to start?** It inspects the complete private semantic model — quiz, every round, and every question — and returns a momentary derived result. It does not persist `isQuizValid`, mutate quiz data, create events, change scoring, probe production, or publish anything to a projector.

The staff-only screen is `/admin/quizzes/:quizId/readiness`. It is reachable from quiz detail, from the editor header, and through the normal live-start action. The editor can also run the same engine against its current selected local draft overlaid on the saved remainder of the quiz.

## Result contract

`runQuizPreflight` returns a typed `PreflightResult` containing:

- overall `BLOCKED`, `READY_WITH_WARNINGS`, or `READY` status;
- source `SAVED_QUIZ` or `LOCAL_DRAFT`;
- aggregate round, question, valid-answer, blocker, and warning counts;
- measured synchronous validation duration;
- category totals and structured issues with stable codes;
- semantic quiz/round/question references and an optional fix target.

Each issue has severity, code, category, a Czech human message, semantic reference, and optional fix target. Issue results never contain question copy, correct-answer values, media URLs, moderator notes, or `legacy.raw`.

Categories are `STRUCTURE`, `ANSWER`, `MEDIA`, `TIMING`, `IMAGE`, `LEGACY`, and the separately presented operational `PROJECTOR` area.

## Severity policy

### Blocker

A blocker prevents the normal live-start action. There is no “start anyway” bypass. Current blockers include:

- missing quiz/round/question structure, an unnamed real round, or roundless questions;
- empty question prompt;
- missing or invalid private correct answer;
- fewer than two non-empty Choice options or an answer that does not identify exactly one option;
- missing/invalid required question image;
- missing or renderer-unsupported Audio/Video source;
- missing, non-finite, negative, or non-increasing clip boundaries;
- a question kind the shared renderer cannot safely interpret;
- an invalid legacy Pravda/Lež answer;
- unsaved editor changes before a live start.

Local question numbering is derived from round order. Generated introduction/agenda/recap presentation is not treated as a missing authored slide.

### Warning

A warning permits live start only after an explicit acknowledgement. Current warnings include:

- YouTube availability/embed/playability is not guaranteed;
- an external question image may become unavailable;
- a stored agenda differs from current derived rounds;
- usable legacy content has limited editability;
- an optional answer/background image has invalid syntax.

Warnings never claim `OFFLINE READY` or `SPOILER SAFE GUARANTEED` for external media.

### Ready

`READY` means all implemented static checks passed. It is not a network, availability, browser-autoplay, projector-connectivity, or offline guarantee.

## Shared validation architecture

```text
private bounded quiz read
        |
        v
buildSemanticQuizModel
        |
        +--> editor field validation
        |
        +--> whole-quiz runQuizPreflight
                  |
                  +--> human issues + semantic fix targets
                  +--> live-start policy
```

Question rules live in `features/editor/validation.ts`; the editor and preflight both consume them. Whole-quiz structure, category aggregation, static online-source caveats, local-draft overlay, and deep-link construction live in `features/preflight/validation.ts`. React components render the result but do not own validation truth.

The saved readiness page performs one bounded quiz/slides/rounds load, not one Firestore read per question. Immediately before creating a practice live session it re-reads and revalidates the saved quiz. No preflight cache or duplicate Firestore truth exists.

## Fix deep links and drafts

Question issues link with semantic `roundId` and `questionId`, plus a non-authoritative field hint. The round-first editor selects the exact round/question and focuses the relevant field when practical. Product-facing copy uses the local round position and local question number, never global slide position.

When opened inside a dirty editor, preflight clearly labels `LOCAL_DRAFT`. It validates the current selected draft plus the saved remainder of the quiz. Dirty state adds a blocker: `Nejdříve uložte změny v editoru.` Preflight does not autosave or publish the draft.

## Live-start policy

- Blockers: start is disabled and the exact blocker count is shown.
- Warnings only: staff must acknowledge the limitations before `Spustit i tak` becomes available.
- No issues: the normal `Spustit kvíz` action is available.

This is the current normal practice/live UI gate. The existing callable remains responsible for authorization and safe publication. A future event-lock workflow should reuse the shared validation rules at its trusted boundary rather than creating a second policy.

## Projector and media boundaries

Quiz content readiness and projector operational readiness are separate. The readiness screen reports projector status as `Neověřeno`; it does not infer connectivity or fullscreen from a window handle. Reliable presence/fullscreen reporting requires an authenticated bounded acknowledgement protocol.

Version one implements static media validation only. It validates source syntax, supported provider parsing, required source, image URL syntax, and clip timing. It deliberately does not create batches of iframes or make external availability claims. A controlled one-player online probe may be added separately after policy, cleanup, rate-limit, and failure-semantics review.

## Security boundary

Preflight routes remain behind staff authorization and read private quiz data already available to the editor. No issue includes answer values or private raw fields. The feature does not write `publicSessions`, change Firestore Rules, change the publication allowlist, change BroadcastChannel transport, or change the media engine. Anonymous projector clients have no route or query path to preflight results.

## Intentional limitations

- Static validation cannot guarantee YouTube/embed availability, external image availability, browser autoplay, or offline operation.
- Projector connected/fullscreen state is not claimed.
- The current practice-start gate is enforced by the normal staff UI; event-backed locking and server-side event preflight remain future scoped work.
- Missing optional backgrounds/answer images are not cosmetic blockers.
- Preflight reports migrated data problems but never rewrites or repairs them automatically.
