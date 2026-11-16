# Editor UX specification draft — QUIZ PLATFORM

Status: **UX RECOMMENDATION**

Evidence: local `demo-filmovy-kviz-v2` audit at 1280×720, 1024×768, and 390×844; repository/data/security review

Date: 2026-09-02

## Classification

- **CONFIRMED PRODUCT REQUIREMENT** — explicit requirement or confirmed behavior.
- **UX RECOMMENDATION** — design proposal based on the audit.
- **HUMAN DECISION** — choice needed before implementation.
- **FUTURE** — deliberately deferred.

## Product outcome

**CONFIRMED PRODUCT REQUIREMENT**

The editor must let a non-developer prepare `QUIZ → KOLA → OTÁZKY` without understanding Firebase, revisions, raw media fields, slide state machines, or migration internals. Preview is a first-class part of editing and must use the same renderer as the projector.

**UX RECOMMENDATION**

The normal mental model is a quiz document, not a flat presentation database. Preserve the authoritative slide stream internally, while presenting a round-first content tree and derived system sections to the user.

## Current editor audit

| Area | Verdict | Classification | Evidence and direction |
| --- | --- | --- | --- |
| Shared `SlideRenderer` preview | **KEEP** | CONFIRMED PRODUCT REQUIREMENT | Local draft preview and projector share rendering; this prevents visual drift. |
| Local draft updates preview immediately | **KEEP** | CONFIRMED PRODUCT REQUIREMENT | Preview responds before persistence and does not publish a live session. |
| Explicit dirty/navigation protection | **KEEP / IMPROVE** | UX RECOMMENDATION | Useful safety, but the custom `alertdialog` needs modal focus behavior and one unified save model. |
| Flat list of 9 technical slides | **REDESIGN** | UX RECOMMENDATION | It shows `intro`, `question`, `agenda`, `pl`, `end` and position numbers rather than quiz/round/question hierarchy. |
| Type selector containing 26 normalized/legacy kinds | **REMOVE from normal flow** | UX RECOMMENDATION | Duplicate and internal labels (`roundheader`, `classic`, `music`, `youtube`, `legacy`) expose data-model history. |
| One universal form for every kind | **REDESIGN** | UX RECOMMENDATION | Intro and audio display answer options, correct answer, raw media roles, `audioTrigger`, `answerOverlay`, and source question number even when irrelevant. |
| `Normalizovaná prezentace` and raw media-role editor | **REMOVE from normal flow** | UX RECOMMENDATION | These are implementation terms. Retain a protected diagnostic/legacy inspector only when necessary. |
| Human time formatting (`mm:ss`, tenths) | **KEEP / IMPROVE** | CONFIRMED PRODUCT REQUIREMENT | Parsing exists, but the controls are far below the fold and lack player-current-time capture/test segment. |
| Three visual regions at wide width | **IMPROVE** | UX RECOMMENDATION | Structure/form/preview is sound at Full HD, but current minimum widths leave only 421 px for form at 1024 px and make all panels ~1593 px tall. |
| Quiz title/description always above editor | **REDESIGN** | UX RECOMMENDATION | It consumes persistent vertical space and creates a second `Uložit údaje` action. Put metadata on the quiz root/settings panel. |
| Correct-answer preview toggle | **KEEP / IMPROVE** | UX RECOMMENDATION | Useful and private; relabel as `Náhled odpovědi`, default off, and make its local-only scope clear in help. |
| Move up/down and duplicate | **KEEP / IMPROVE** | CONFIRMED PRODUCT REQUIREMENT | They provide a non-drag alternative. Add text/tooltips/accessible names and move-to-round. |
| Delete slide as a prominent peer action | **REDESIGN** | UX RECOMMENDATION | Move into overflow; use contextual `Odstranit otázku` / `Odstranit kolo` with consequences and recovery. |
| `Uloženo · revize 0` | **REMOVE from primary status** | UX RECOMMENDATION | Show `Uloženo`; keep revision only under technical details. |
| Brand copy `FILMOVÝ KVÍZ` in preview | **REMOVE / CONFIGURE** | CONFIRMED PRODUCT REQUIREMENT | Brand-neutral display copy must come from central config/theme. |

## Recommended editor architecture

**UX RECOMMENDATION**

### Wide layout (≥ 1280 px)

1. **Focused header**: back, quiz name, save/readiness status, `Zkontrolovat připravenost`, one save action.
2. **Outline (280–320 px)**: semantic hierarchy, collapsed rounds, contextual add actions.
3. **Workspace**: type-specific form, 600–760 px ideal reading width.
4. **Preview dock (360–480 px)**: sticky 16:9 preview, enlarge/test actions, never an empty full-height column.

At 1200–1279 px, outline remains but preview becomes a docked tab or top drawer. At tablet/mobile, use `Struktura | Obsah | Náhled` rather than stacking a 2500+ px page.

### Text wireframe — quiz editor

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Detail kvízu   Název kvízu     ● Neuložené změny   [Připravenost] [Uložit]│
├──────────────────┬───────────────────────────────────┬───────────────────────┤
│ STRUKTURA        │ OTÁZKA 4 · Výběr z možností      │ NÁHLED PROJEKTORU     │
│                  │                                   │ ┌───────────────────┐ │
│ Úvod kvízu       │ Otázka *                          │ │      16 : 9       │ │
│  Úvodní obrazovka│ [_______________________________] │ │ shared renderer   │ │
│  Harmonogram auto│                                   │ └───────────────────┘ │
│  Pravidla        │ Odpovědi                          │ [Zvětšit] [Odpověď]   │
│                  │ (●) A [________________________]  │ [Otestovat projektor] │
│ ▼ 1. kolo        │ ( ) B [________________________]  │                       │
│   Nastavení kola │ ( ) C [________________________]  │ KONTROLA              │
│   1 Otázka       │ [+ Přidat odpověď]               │ ✓ otázka               │
│   2 Obrázek      │                                   │ ! médium chybí         │
│   3 Audio        │ Pozadí a vzhled ▸                 │                       │
│   Rekapitulace   │ Poznámka moderátora ▸            │                       │
│   [+ Otázka]     │                                   │                       │
│                  │                                   │                       │
│ [+ Přidat kolo]  │                                   │                       │
└──────────────────┴───────────────────────────────────┴───────────────────────┘
```

## Semantic outline

**CONFIRMED PRODUCT REQUIREMENT**

The hierarchy is `Kvíz → Kola → Otázky`; round and question operations include add, duplicate, move/reorder, and considered removal. Drag-and-drop cannot be the only reorder method.

**UX RECOMMENDATION**

- Root `Úvod kvízu` groups opening, generated agenda, and editable rules.
- Each round row shows number, name, question count, and issue badge.
- Round children use question number, type icon, short prompt, and validation badge.
- `Rekapitulace` appears as a generated child of every enabled round, not an arbitrary global slide.
- Add question lives inside its round. Type picker offers only: `Výběr z možností`, `Volná odpověď`, `Obrázek`, `Audio`, `Video`.
- Legacy `Pravda / Lež` can be selected and edited when it exists, but cannot be created.
- Advanced migration metadata is hidden unless a legacy conflict needs attention.

**HUMAN DECISION**

Choose whether generated agenda/recap become virtual editor nodes backed by existing slide data, or remain authored slides with a friendly facade. Recommendation: virtual system nodes for new quizzes, lossless friendly wrappers for migrated quizzes.

## Type-specific forms

**CONFIRMED PRODUCT REQUIREMENT**

Show only relevant fields. Internal identifiers such as `mediaRaw`, `legacy.raw`, `videoStart`, `revision`, `audioTrigger`, and stored kind names are not ordinary form copy.

| Type | Primary form | Optional/secondary | Validation |
| --- | --- | --- | --- |
| Výběr z možností | Question text; answer rows; correct answer selection | background; overlay; moderator note | non-empty question; ≥2 non-empty options; exactly one correct option |
| Volná odpověď | Question text; correct answer | background; overlay; moderator note | non-empty question and answer |
| Obrázek | Question text; question image; correct answer | toggle + options; answer image; overlay; moderator note | image loads; answer present; option rule if enabled |
| Audio | Question text; correct answer; source; segment start/end; test player | moderator note | source parse/embed; end > start; segment playable |
| Video | Question text; correct answer; source; segment start/end; test player | moderator note | source parse/embed; end > start; segment playable |
| Pravda / Lež (legacy) | Question; fixed True/False answer control | background; moderator note | existing only; type locked |

**UX RECOMMENDATION**

For multiple choice, do not ask the user to retype the correct answer into an unrelated text box. Select the correct answer directly on an option row. If scoring needs accepted variants later, expose them under `Další uznávané odpovědi` rather than overloading the display answer.

Fields should use human labels: `Otázka`, `Správná odpověď`, `Obrázek otázky`, `Obrázek odpovědi`, `Pozadí`, `Ztmavení pozadí`, `Zdroj z YouTube`, `Začátek ukázky`, `Konec ukázky`.

## Media timing UX

**CONFIRMED PRODUCT REQUIREMENT**

Timing is stored as numeric seconds but edited in a human time format with tenths supported. YouTube is best effort; missing/failed media keeps a stable text question.

**UX RECOMMENDATION**

```text
Zdroj z YouTube
[ https://youtube.com/watch?v=…                          ] [Načíst]

┌──────────────────────────── visible test player ───────────────────────────┐
└─────────────────────────────────────────────────────────────────────────────┘
Aktuální čas 01:23.5

Začátek ukázky [01:23.5] [Použít aktuální čas]
Konec ukázky   [01:37.0] [Použít aktuální čas]
Délka ukázky: 00:13.5

[Přehrát ukázku] [Zastavit] [Pustit znovu]
```

- Accept `1:23`, `01:23.5`, and pasteable raw seconds; normalize on blur.
- Show derived duration immediately; negative/zero duration is an inline blocker.
- `Použít aktuální čas` reads the visible test player's current time.
- Test playback uses the same provider adapter/media behavior as the product, not a second rendering engine.
- Controls stay next to the player; no long scroll between source, timing, and test action.
- Display a clear embed/playability result and YouTube limitation notice after load, not only during live.

**HUMAN DECISION**

Choose empty-end semantics in the UI: A) require an explicit end for quiz clips, or B) allow `Do konce média` as an explicit mode. Recommendation: B, never represent it as an ambiguous blank field.

## Preview

**CONFIRMED PRODUCT REQUIREMENT**

What the editor preview shows must match what the projector shows. Local draft preview updates in real time and must not publish correct answers to a public session.

**UX RECOMMENDATION**

- Keep `SlideRenderer` as the only type-aware renderer.
- Give preview a stable 16:9 area; 360 px minimum wide dock, enlarge to a modal/full workspace.
- Preview header: `Náhled projektoru`, current viewport scale, `Zvětšit`, `Náhled odpovědi`.
- Audio preview shows the question state plus the visible test player/control group nearby; video preview tests question → player → question behavior.
- `Otestovat na projektoru` opens a separate local preview route/window with the same renderer and local draft snapshot. It is visually distinct from live publication and shows prompt-only by default.
- Never create a second CSS/HTML preview implementation.

**HUMAN DECISION**

Should `Otestovat na projektoru` show A) the unsaved local draft immediately, or B) only the last saved version? Recommendation: A with an explicit `Lokální náhled — nepublikováno` banner on the moderator screen and no `publicSessions` write.

## Save-state behavior

**CONFIRMED PRODUCT REQUIREMENT**

Persistence behavior is not changed in this research task. The user must clearly see `Uloženo`, `Ukládám`, `Neuložené změny`, or `Chyba`.

**UX RECOMMENDATION — current explicit-save model**

- One editor-level `Uložit` action saves the current logical change set; do not expose separate `Uložit slide` and `Uložit údaje` in the main header.
- `Ctrl/Cmd+S` triggers the same action.
- Selecting another question with dirty content opens a real modal: `Uložit a pokračovat`, `Pokračovat bez uložení`, `Zrušit`.
- A save error keeps the draft, focuses the error summary, and offers `Zkusit znovu`; optimistic conflict explains that a newer version exists without exposing revision numbers.
- Save status uses text + icon and `aria-live` as specified in `DESIGN_SYSTEM_DRAFT.md`.

**HUMAN DECISION**

Before implementation choose: A) explicit save, or B) autosave after a short idle period with version-safe conflict handling. Recommendation for the first redesign: A, then evaluate autosave after field-level validation and recovery/version history exist.

## Quiz, round, and question operations

**UX RECOMMENDATION**

### Quiz

- Metadata lives on root `Kvíz` / `Základní údaje`.
- `Duplikovat kvíz` is available from quiz detail/library, not as an editor field action.
- `Archivovat` is preferred to delete; restore remains possible.

### Round

- `+ Přidat kolo` creates a round, focuses name, and creates derived intro/recap behavior without asking for technical slides.
- Context menu: Rename, Duplicate including questions, Move up, Move down, Archive/remove.
- Reorder supports drag handle on pointer devices plus explicit move actions and keyboard shortcuts.
- Removing a non-empty round states the question count and offers `Přesunout otázky` or guarded removal; default is Cancel.

### Question

- Add inside selected round; type picker is one lightweight step.
- Context menu: Duplicate, Move to round, Move up/down, Remove.
- Duplicate is inserted immediately after source and selected.
- Question numbers are derived from order. The UI never lets users create duplicate numbers manually.

## Opening, agenda, rules, recap

**CONFIRMED PRODUCT REQUIREMENT**

Agenda is generated from rounds. Rules start from a template and are editable. Opening uses quiz title and optional background. Users should not feel they are manually manufacturing technical slides.

**UX RECOMMENDATION**

`Úvod kvízu` contains:

- `Úvodní obrazovka`: title, optional subtitle/background/overlay.
- `Harmonogram`: live generated preview from ordered round names; optional include/exclude toggles only if a real use case appears.
- `Pravidla`: editable list with `Obnovit výchozí pravidla`.

Each round contains a generated `Úvod kola` and `Rekapitulace`. Existing authored/migrated data remains lossless behind the friendly model. `Rekapitulace` exposes readiness and optional round-level copy, not a raw list of override records.

## Human-error prevention and inline readiness

| Error | Classification | Editor behavior |
| --- | --- | --- |
| Empty question | UX RECOMMENDATION | Required inline error; appears in outline and preflight. |
| Missing correct answer | CONFIRMED PRODUCT REQUIREMENT | Block ready/live state; direct fix link. |
| `end <= start` | CONFIRMED PRODUCT REQUIREMENT | Inline blocker beside timing; test disabled. |
| Missing media source | CONFIRMED PRODUCT REQUIREMENT | Block media test; text fallback explained; preflight warning/blocker by policy. |
| Media unavailable/embed denied | UX RECOMMENDATION | Human message + retry/replace + optional technical detail. |
| Duplicate question number | UX RECOMMENDATION | Prevent by deriving number from order; migration anomaly becomes preflight issue. |
| Unsaved edit | CONFIRMED PRODUCT REQUIREMENT | Persistent status and navigation decision; never silently discard. |
| Projector not opened | UX RECOMMENDATION | Live preflight warns and provides `Otevřít projektor`. |

Validation runs as the user edits, but errors are not announced on every keystroke. Show after blur, save, preview test, or preflight.

## Responsive editor

**CONFIRMED PRODUCT REQUIREMENT**

The full editor targets notebook, Full HD, smaller notebook, and tablet. Mobile needs basic access but may have reduced editing scope.

**UX RECOMMENDATION**

- ≥1280 px: semantic outline + form + sticky preview.
- 768–1279 px: outline drawer/rail; `Obsah` and `Náhled` split or tabbed; sticky save header.
- <768 px: default to browse/quick-fix mode with tabs `Struktura`, `Obsah`, `Náhled`; one question at a time; no three stacked panels.
- Mobile supports prompt/answer correction, readiness review, and preview. Complex media timing/reorder may route to `Dokončete na větší obrazovce` only if product owner accepts the limitation.

The audited 390 px layout stacks navigator (512 px), form (~1696 px), and preview at ~2394 px, so preview is not practically part of editing. This is **REDESIGN**, not polish.

## Editor click cost

Counts below start inside an open editor and separate clicks from data entry.

| Workflow | Current | Recommended target | Main waste removed |
| --- | --- | --- | --- |
| Create FREE question | type dropdown + option + Add + Save = ~4 clicks, then fields | `+ Otázka` + type + Save = 3 clicks, then question/answer | no technical kind list; created inside round |
| Create AUDIO + segment | ~4 base clicks + URL/start/end entries; long scroll; no segment-test action | 3 base clicks + 3 field/capture actions + `Přehrát ukázku` | capture current time; grouped player/timing |
| Add round | dropdown + `Hlavička kola` + Add + Save = ~4 clicks, then fields | `+ Přidat kolo`, name, Save = 2 clicks + entry | round is a product object, not slide kind |
| Reorder question | one up/down click per position | drag or up/down; move-to-round dialog for long moves | keep touch/keyboard alternative |

**UX RECOMMENDATION**

Optimize for comprehension and error prevention, not the absolute minimum click count. A type choice is valuable; choosing among 26 internal kinds is not.

## Accessibility specifics

**UX RECOMMENDATION**

- Outline is a labelled tree/list with visible selection and logical keyboard order.
- Reorder controls expose `Přesunout otázku 4 nahoru/dolů` and announce the new position.
- Every remove-option button has a unique accessible name.
- Preview controls are reachable without tabbing through every form field again.
- Modal focus follows the design-system contract.
- Errors link to fields and selected outline nodes.
- No essential action is hover-only or drag-only.

## Implementation sequence

**UX RECOMMENDATION**

1. Friendly labels, relevant-field filtering, unified save status, technical-detail disclosure.
2. Round-first outline facade over existing model; quiz metadata moves to root panel.
3. Responsive preview dock and focused editor shell.
4. Media timing/test workflow using the existing media adapter.
5. Generated system sections and local projector-test route after the associated human decisions.
6. Autosave/version history only as a later independently tested change.

No recommendation here authorizes changes to media engine, persistence, Firebase, Security Rules, public answer projection, or production data.
