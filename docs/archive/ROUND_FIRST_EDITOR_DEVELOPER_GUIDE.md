# Round-first editor developer guide

## Scope and invariants

The round-first editor is a UI and mutation facade over the existing private, lossless slide stream. It is not a destructive schema migration.

The implementation must preserve these invariants:

1. The global `quizzes/{quizId}/slides` stream remains authoritative for presentation order.
2. Every migrated source slide remains represented, including intro, agenda, recap, end, malformed future values, and unknown kinds.
3. `legacy.raw` and unknown extensions remain private and survive supported edits.
4. Correct answers remain private until an explicit trusted live reveal.
5. Editor preview never writes or publishes `publicSessions`.
6. Every editor write is an admin-only callable Function with an expected revision.
7. Firestore Rules deny direct client quiz writes for both admins and moderators.
8. Projector publication, BroadcastChannel authority, and media lifecycle semantics are outside this facade.
9. Whole-quiz preflight is derived and ephemeral; it never persists validation truth or publishes private findings.

## Architecture

```text
Private Firestore quiz + globally ordered slides
                       |
                       v
             editorRepository / mappers
                       |
                       v
              buildSemanticQuizModel
                       |
         +-------------+-------------+
         |             |             |
     Structure       Form       Local preview
         |             |        SlideRenderer
         +-------------+-------------+
                       |
                 explicit Save
                       |
              revisioned callable
                       |
             trusted transaction
                       |
       slides + derived rounds/questions
```

The semantic model is derived on read. The server mutates the stored lossless model and rebuilds known derived projections atomically inside the bounded transaction.

## Source map

### Web

| File | Responsibility |
| --- | --- |
| `apps/web/src/routes/admin/QuizCreatePage.tsx` | Admin-only titled empty-quiz creation and retry-safe handoff into the editor. |
| `apps/web/src/routes/admin/QuizEditorPage.tsx` | Focused shell, selection, draft lifecycle, Save, navigation blocking, and structural orchestration. |
| `apps/web/src/features/editor/semanticModel.ts` | Quiz/round/question facade, type mapping, indexing, local numbering, and insertion point. |
| `apps/web/src/features/editor/EditorOutline.tsx` | Human-readable structure and create picker. |
| `apps/web/src/features/editor/EditorForms.tsx` | Quiz, system, round, question, readiness, media timing, and preview forms. |
| `apps/web/src/features/editor/EditorDialogs.tsx` | Unsaved-change and round-removal native dialogs. |
| `apps/web/src/features/editor/validation.ts` | Client question validation and correct-option matching. |
| `apps/web/src/features/preflight/validation.ts` | Whole-quiz structure validation, shared issue aggregation, draft overlay, and semantic fix URLs. |
| `apps/web/src/features/preflight/QuizPreflightPanel.tsx` | Human Czech readiness summary and issue actions. |
| `apps/web/src/routes/admin/QuizPreflightPage.tsx` | Saved-quiz readiness route and normal practice/live start policy. |
| `apps/web/src/features/editor/time.ts` | Human timing parsing, formatting, and duration. |
| `apps/web/src/features/editor/sessionState.ts` | Save labels and navigation-decision predicate. |
| `apps/web/src/features/editor/editorRepository.ts` | Private Firestore reads. |
| `apps/web/src/features/editor/editorMappers.ts` | Runtime validation/mapping from Firestore to editor types. |
| `apps/web/src/features/editor/editorApi.ts` | Typed callable adapters and stale-revision error mapping. |
| `apps/web/src/features/presentation/SlideRenderer.tsx` | Shared type-aware projector/editor renderer. |
| `apps/web/src/features/presentation/YouTubePlayer.tsx` | Existing media player plus safe current-time access for the editor. |

### Functions

| File | Responsibility |
| --- | --- |
| `functions/src/editor/callables.ts` | Authorization, Firestore transactions, revision checks, and semantic structural operations. |
| `functions/src/editor/model.ts` | Known-field patches, lossless merging, ordering, and derived record generation. |
| `functions/src/editor/validation.ts` | Fail-closed callable input validation. |
| `functions/src/editor/types.ts` | Trusted editor input kinds and contracts. |

### Tests

| File | Coverage |
| --- | --- |
| `tests/roundFirstEditor.test.tsx` | Semantic outline, types, forms, timing, validation, save state, local preview, and legacy preservation. |
| `tests/quizEditor.test.ts` | Trusted model and callable unit coverage. |
| `tests/e2e/quiz-editor-emulator.mjs` | Roles, direct-write denial, revisions, CRUD, ordering, rounds, and public-state isolation. |
| `tests/e2e/quiz-editor-migrated-emulator.mjs` | Sanitized structural verification and safe round trips against all offline migrated quiz shapes. |
| `tests/browser/round-first-editor.spec.ts` | Human workflow and responsive synthetic browser QA. |
| `tests/browser/round-first-editor-migrated.spec.ts` | All four offline migrated quizzes through the real editor UI. |
| `tests/quizPreflight.test.ts` | Shared blocker/warning/status and private-value exclusion contract. |
| `tests/browser/quiz-preflight.spec.ts` | Detail/editor/live policy, semantic fix links, dirty drafts, and responsive QA. |
| `tests/browser/quiz-preflight-migrated.spec.ts` | Sanitized whole-quiz readiness and performance over all four offline migrated quizzes. |

## Semantic model

`buildSemanticQuizModel` scans the sorted slide stream once and produces:

- quiz-level system and legacy sections;
- explicit and safe implicit rounds;
- round-local questions;
- one recap node per round where applicable;
- direct slide and question maps for selection and editing.

The five creatable semantic question types are:

| Semantic type | Stored kind |
| --- | --- |
| `choice` | supported choice/question kind |
| `free` | supported free/question kind |
| `image` | image kind |
| `audio` | audio kind |
| `video` | video kind |

Existing PL maps to a locked `legacy-pl` semantic type. Unrecognized data maps to a locked legacy/system representation. Adding a label does not authorize conversion of its storage shape.

Question numbers are never stored as user input. They are derived from order inside each round. A new question uses the semantic round insertion position, immediately before recap or the next round boundary.

## Draft and Save lifecycle

The library's admin-only **Nový kvíz** action opens `/admin/quizzes/new`. One explicit submit calls `createQuiz` with a tab-session request ID that remains stable across retry, double-click, and a page reload after an ambiguous response. The Function derives the quiz ID from the actor and request ID, creates only an empty private draft root, and returns that same root for an identical retry. Reusing the request ID with a different title fails closed. The token is removed after confirmed success; no quiz content is stored with it. Success navigates to the existing editor; the first round and question still use the normal revisioned slide workflow. No placeholder content or public state is created.

The page holds one selected entity and one mutable local draft. Changes update the preview immediately and mark the session dirty. Nothing persists until the explicit Save action.

Save dispatch depends on selection:

- quiz root → `updateQuizMetadata`;
- existing slide/question/system content → `updateQuizSlide`;
- unsaved question → `createQuizSlide` at the derived insertion point;
- round settings → `updateQuizRound`.

On success, the returned revision becomes current and repository state reloads. On failure, the draft remains intact and the failure state is visible. Stale `expectedRevision` returns `aborted`; no last-write-wins fallback exists.

Navigation follows a small state machine:

```text
clean -> navigate immediately
dirty -> Save and continue | discard and continue | cancel
save failure -> remain on current draft
```

The router blocker handles ordinary SPA navigation and browser Back. `beforeunload` covers hard reload/close, subject to browser-native wording.

## Callable mutation matrix

| Callable | Effect |
| --- | --- |
| `createQuiz` | Idempotently creates one titled, empty private draft root for an admin/request pair. |
| `updateQuizMetadata` | Updates validated quiz title/description. |
| `updateQuizSlide` | Applies a known-field patch to one authoritative stored slide. |
| `createQuizSlide` | Creates a fresh slide identity at a validated position. |
| `duplicateQuizSlide` | Copies authored slide data to a fresh identity immediately after the source. |
| `deleteQuizSlide` | Removes one selected slide and normalizes order. |
| `moveQuizSlide` | Compatibility/global slide move operation. |
| `updateQuizRound` | Updates the product round title and related known round representation. |
| `reorderQuizQuestion` | Moves a question inside semantic order without exposing global positions. |
| `moveQuizQuestionToRound` | Moves a question into the target round and cleans safe empty source structure. |
| `duplicateQuizRound` | Duplicates the round group with fresh round/slide identities. |
| `moveQuizRound` | Moves the complete semantic round group. |
| `removeQuizRound` | Explicitly deletes questions or moves them to a chosen round before removal. |

Every callable:

- requires an authenticated `admin` custom claim;
- validates its strict input shape and bounded fields;
- reads the authoritative server snapshot inside a transaction;
- returns only IDs, counters, and revision—not slide content or answers.

Structural mutations reject oversized unsafe transactions. Existing-quiz mutations also require the caller's exact revision, increment it, and refresh counters/order. `createQuiz` has no prior revision to compare: it creates `revision: 0` and zero counters, or returns the same already-created root only when the actor-bound request ID and title fingerprint match.

Moderators have private read access for their disabled editor view but cannot call these mutations.

## Lossless write rules

Known-field patching must start from the current server document. Do not rebuild a slide exclusively from the browser payload.

The merge behavior preserves:

- unknown top-level properties;
- `legacy.raw` and quiz/round legacy metadata;
- unknown or malformed future values when the user did not edit them;
- unedited media records and unknown media roles;
- presentation extensions including recap overrides;
- explicit empty V1 fields where their presence is meaningful;
- correct-answer values unless the authorized form explicitly changes them.

Imported V1 data may use `presentation.videoStart: 0` and `presentation.videoEnd: 0` as an unset sentinel while retaining a top-level zero start and no top-level end. The shared mapper must expose that exact shape as `clipStartSeconds: null` / `clipEndSeconds: null`; on an unrelated edit the server must leave the existing stored timing-key presence and legacy presentation object unchanged. Do not reinterpret arbitrary invalid media ranges as this sentinel.

Do not guess the meaning of an unknown field. Preserve it privately, expose a conservative warning if needed, and add a synthetic regression fixture before introducing a supported mapping.

## Choice answer consistency

The UI selects the correct answer directly from the option list. `correctOptionIndex` supports the preserved legacy representations accepted by the mapper, including a stored option value or compatible letter representation. Saving materializes one consistent answer selection. Validation blocks an empty prompt, fewer than two non-empty options, or a missing/ambiguous correct option.

Five- and six-option migrated questions are intentionally supported; new UX assumptions must not truncate them.

## Media timing

Human time parsing accepts minutes and seconds in `mm:ss` or `mm:ss.s` form and returns numeric seconds. Parsing distinguishes:

- a valid number;
- a blank value;
- an invalid value.

Audio/video question mode requires finite start and end values with `start >= 0` and `end > start`. Invalid new or edited timing must not fall back to old stored timing and must block Save. A persisted imported slide with the exact legacy `0/0` unset sentinel may save an unrelated text/answer edit while its media source and timing remain unchanged; this does not relax preflight, which continues to block live readiness until valid timing is supplied. The test player is private moderator UI; it does not change the projector media protocol.

## Background support boundary

The normalized slide model and shared `SlideRenderer` already support a safe HTTP(S) `backgroundImage` rendered with cover semantics behind content plus `backgroundOverlay`. Editor authoring currently exposes only a URL field and overlay slider through `VisualFields`, and Choice questions do not mount that block. There is no **Vybrat / Změnit / Odebrat** background control and no owned-background picker/upload flow. Treat those as a separately designed media/ownership slice; do not widen the editor save fix into a new media module.

## Preview boundary

Editor preview converts the authorized private draft into `SlideRenderer` input in memory. It may supply a revealed-answer field only when the local answer toggle is explicitly on. This object is not written to Firestore, posted to a Function, placed in URL state/localStorage, or sent over the live BroadcastChannel.

A separate projector window for unsaved drafts must use a new bounded same-device protocol. Reusing live `publicSessions` or its BroadcastChannel would violate the trust boundary.

## Responsive and performance behavior

CSS breakpoints implement:

- three visible panels at 1280 px and above;
- outline plus practical Content/Preview tabs between 768 and 1279 px;
- Structure/Content/Preview tabs below 768 px.

Interactive mobile targets are at least 44 px. The current migrated quizzes contain 63–91 source rows each, so virtualization is not required. Semantic model construction is memoized per quiz load and direct maps avoid scanning the entire stream on every draft keystroke.

If later quizzes grow materially larger, measure load, selection, and preview update cost before choosing virtualization. Do not sacrifice semantic keyboard/focus behavior based on speculation.

## Adding a supported question type

Before adding a new creatable type:

1. Establish its product meaning and private/public data classification.
2. Add a lossless mapper and trusted validation.
3. Define its semantic label and storage kind.
4. Add a dedicated form and renderer behavior.
5. Prove correct-answer secrecy in projector/public models.
6. Add synthetic unit fixtures, Functions coverage, Rules expectations, callable E2E, and browser QA.
7. Add a migrated-data round-trip fixture if the shape exists in V1.
8. Update `QUIZ_EDITOR.md`, `DATA_MODEL.md`, `SECURITY.md`, and the user/testing guides.

Do not make an existing legacy type creatable merely because it can be displayed.

## Failure diagnosis

### Save reports a concurrent change

The expected revision is stale. Reload the quiz and repeat the edit deliberately. Do not weaken the revision check.

### A migrated value disappears after Save

Treat this as a data-loss defect. Reproduce with a sanitized synthetic fixture, inspect known-field merge behavior, and stop migrated writes until validate/dry-run/round-trip checks pass again.

For imported `0/0` timing, verify all three layers: the browser model must treat the exact legacy sentinel as unset, the editor save gate may ignore only the two missing-timing issues for the same persisted slide with unchanged media/timing, and the trusted patch must preserve the original key presence on unrelated saves. Preflight must remain blocked, and accepting zero-length clips globally would hide other invalid data rather than fix compatibility.

### Preview differs from projector

Confirm both use `SlideRenderer` and the same normalized presentation semantics. Do not copy private editor fields into `PublicLiveState` to make them match.

### Emulator command points elsewhere

Stop. All local write tools must have exact localhost emulator endpoints and a `demo-*` project ID. There is no supported production override.
