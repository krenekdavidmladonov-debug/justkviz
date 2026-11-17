# Round-first editor user guide

## Purpose

The editor presents a quiz as **quiz → rounds → questions**. It deliberately hides slide positions, internal kinds, Firestore revisions, and legacy payloads from the normal workflow. The private ordered slide stream still exists underneath so migrated V1 quizzes remain lossless.

The editor route is:

```text
/admin/quizzes/:quizId/edit
```

Administrators can edit and save. Moderators can open the same private content in read-only mode. Anonymous and ordinary authenticated users cannot open private quizzes.

## Local access

For emulator-only development, open `http://localhost:5173/admin/login` and sign in with:

```text
admin@example.test
LocalQuiz123!
```

This is a local test account. The application must use the Firebase Emulator Suite and a `demo-*` project ID. Never reuse these instructions against a real Firebase project.

## Editor layout

The focused editor has four functional areas:

1. **Header** — returns to quiz detail, shows save state, runs readiness validation, and provides the single Save action.
2. **Structure** — the semantic outline of the quiz introduction, rounds, questions, and recap nodes.
3. **Content** — the form for the selected quiz, system section, round, or question.
4. **Preview** — a private, local 16:9 rendering of the current draft using the same renderer as the projector.

On a wide desktop all three panels are visible. Tablet and mobile layouts use panel tabs so the editor does not become one very long three-panel page.

## Structure outline

### Quiz introduction

The outline begins with:

- **Opening screen** — quiz title, optional presentation copy supported by the stored slide, background, and overlay.
- **Agenda** — generated from current round order and titles.
- **Rules** — editable rules with an action to restore the neutral default template.

These are system sections. Users do not create technical `intro` or `agenda` slides.

### Rounds

Each round contains:

- round settings;
- questions numbered from 1 inside that round;
- a system recap entry.

Question numbering is derived from order and cannot be typed manually. The outline displays a human question type, a short prompt summary, and validation status. It does not display global slide positions or legacy IDs.

### Legacy and roundless content

Existing content outside a normal round remains visible through a conservative system/legacy representation. The editor does not silently move, convert, or discard it. If a detail has no proven product meaning, the ordinary form reports that older settings are present and technical details remain secondary.

## Editing workflow

1. Select a system section, round, or question in **Structure**.
2. Edit its product-level fields in **Content**.
3. Review the unsaved result in **Preview**.
4. Select **Check readiness** when desired.
5. Select **Save** or press `Ctrl+S` / `Cmd+S`.
6. Wait for the state to return to **Saved** before leaving.

There is no autosave. A newly created question also remains a local draft until Save succeeds.

## Save states

The header exposes four states:

- **Saved** — local form and stored quiz agree.
- **Unsaved changes** — the current form contains a local draft.
- **Saving…** — a trusted server mutation is in progress.
- **Save failed** — the draft is still present and can be corrected or retried.

If another editor saved a newer revision first, the stale save is rejected. Reload the current quiz and deliberately repeat the intended edit; the application does not overwrite newer work automatically.

## Leaving with unsaved changes

Selecting another outline entry, following an editor route, using the editor Back action, or using normal browser Back while dirty opens a modal with:

- **Save and continue**;
- **Continue without saving**;
- **Cancel**.

Cancel is the safe default focus. A hard browser close or reload receives the browser's native unsaved-change warning. Continuing without saving discards only the current local draft; it does not delete stored quiz data.

## Creating questions

Select **Add question** inside the target round, then choose one of:

- Multiple choice;
- Free answer;
- Image;
- Audio;
- Video.

The question is inserted semantically before the round recap/end boundary when saved. `Pravda / Lez` is intentionally absent from this picker.

## Question forms

### Multiple choice

Required:

- non-empty question;
- at least two non-empty options;
- exactly one correct option selected directly in the option list.

The correct answer is not maintained in a second independent text field. Existing fifth and sixth legacy options remain supported and preserved.

### Free answer

Required:

- question;
- correct answer.

Optional product-level controls include background, overlay, and moderator note. There are no A/B/C/D option controls.

### Image

Required:

- question;
- question image source.

The question image is distinct from the background. It renders as contained media with black letterboxing rather than a generic full-screen cover. Multiple choice can be enabled; otherwise the correct answer is free text. An answer image, overlay, background, and moderator note are optional and separate.

### Audio and video

Required:

- question;
- correct answer;
- configured YouTube/media source;
- clip start;
- clip end.

Time accepts `mm:ss` and `mm:ss.s`, is stored as numeric seconds, and must satisfy:

```text
start >= 0
end > start
```

The private moderator player supports loading, capturing current time as start/end, playing the clip, stopping, and replaying. Duration is derived. An invalid or missing boundary blocks Save.

### Legacy: Pravda / Lež

Existing V1 PL questions remain editable as a locked legacy type with a question and one `Pravda`/`Lež` answer. A new PL question cannot be created, and its type cannot be converted in this phase because that could lose unclassified data.

## Round actions

Available round operations are:

- rename;
- duplicate, including questions;
- move up;
- move down;
- remove.

Duplicating creates fresh semantic identities and does not copy live-session runtime state. Moving uses explicit buttons; drag and drop is not required.

Removing a non-empty round never uses a generic confirmation. The dialog states the question count and requires one of:

- move questions into another round;
- remove the round and its questions;
- cancel.

Cancel is focused by default. The dialog remains open when the trusted operation fails.

## Question actions

Questions can be:

- duplicated immediately after the source;
- moved to another round;
- moved up or down within their semantic order;
- removed.

After every structural operation, positions and local numbers are derived again. Structural actions are disabled while a form draft is dirty so a local edit cannot be accidentally detached from its source.

## Validation and readiness

Validation appears after a field has been left, a Save is attempted, media is tested, or **Check readiness** is selected. The editor does not display errors on every keystroke.

The selected question receives inline validation for question content, answer, media, and timing as applicable. The outline displays an issue badge without displaying the private answer.

**Připravenost** in the editor header runs a whole-quiz check. For the selected item it uses the current local draft; the rest comes from the saved quiz. The panel states this source explicitly. Each question issue identifies its round, local question number, and type; **Opravit** selects that semantic question and focuses the relevant field when possible. Unsaved changes block live start until they are saved.

Quiz detail offers **Zkontrolovat připravenost**. **Spustit kvíz** goes through the same saved-quiz check: blockers disable start, warnings require an explicit acknowledgement and **Spustit i tak**, and a clean quiz offers the normal start action.

## Preview and answer privacy

Preview is local and reacts immediately to the current form. It does not save, start a live session, write a public session, or send the draft to a projector.

**Answer preview** is a private editor-only toggle and defaults off. Turning it on displays the answer only inside the authorized editor preview. It does not invoke the live reveal path.

## Responsive use

- `>=1280px`: Structure, Content, and Preview are visible together.
- `768–1279px`: Structure remains available; Content and Preview use a practical split/tab interaction.
- `<768px`: use the Structure, Content, and Preview tabs.

Mobile supports structure browsing, common question edits, readiness, saving, and preview. Media timing controls remain available in a compact arrangement.

## Current intentional limits

- Unsaved drafts cannot be opened in a separate projector window. A future design requires an isolated local transport and must not reuse `publicSessions`.
- Static readiness cannot guarantee external media availability, YouTube embed/playability, browser autoplay, projector presence, fullscreen, or offline operation.
- Media accepts the existing URL/reference mechanism; Storage upload and lifecycle management are separate work.
- Generated agenda is derived in the editor while authored legacy agenda payload is conservatively preserved.
- Quiz creation, events, registration, scoring, leaderboard, referee tools, PDF, and email are outside this editor phase.

See [UX_IMPLEMENTATION_FOLLOWUPS.md](UX_IMPLEMENTATION_FOLLOWUPS.md) for the maintained follow-up list.
