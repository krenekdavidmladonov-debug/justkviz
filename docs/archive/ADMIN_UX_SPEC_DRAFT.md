# Admin and live UX specification draft — QUIZ PLATFORM

Status: **UX RECOMMENDATION**

Evidence: repository review plus isolated local emulator/browser audit; no production connection or production data copy

Date: 2026-09-02

## Confirmed owner workflow — 2026-09-18

This administration is primarily for its owner, with at most three users initially. Prioritize direct, intuitive daily work and few steps. Do not add screens, modes or settings to support speculative organizational complexity. This preference does not relax authorization or data protections.

Question ordering belongs directly in the existing editor's left outline; a separate storyboard was explicitly rejected. Section colors supplement labels: gold for the quiz library, teal for events, violet for the editor. Keep native scrolling and keyboard focus usable. Event actions should be compact and consistently styled, with destructive actions and unavailable reasons readable.

## Classification

- **CONFIRMED PRODUCT REQUIREMENT** — explicit product constraint or confirmed behavior.
- **UX RECOMMENDATION** — proposed direction based on observed UI/workflows.
- **HUMAN DECISION** — choice that changes product behavior.
- **FUTURE** — intentionally outside the current scope.

## Discovery method and limits

**CONFIRMED PRODUCT REQUIREMENT**

The audit covered login, admin home, quiz library, quiz detail, editor, live control, projector, recap, routes/navigation, and responsive behavior. It ran against a separate `demo-filmovy-kviz-v2` Emulator Suite with synthetic seed data. The existing `.local-data` export was not opened or copied because production-origin data was not explicitly authorized.

The audited base is commit `e7990df` (`feature/projector-behavior-foundation`). Other agents' branches and working changes were not read, modified, merged, or deployed.

## Executive UX diagnosis

**UX RECOMMENDATION**

The visual base is coherent and the projector/security foundations are strong, but the admin still communicates implementation status instead of user intent. The highest-impact problems are:

1. Mixed public/admin navigation and no product-level information architecture.
2. Dashboard dominated by authentication/Firebase explanations rather than work to continue.
3. Editor presents a flat, technical slide stream and universal debug-like forms.
4. Live control spends the first viewport on a large title/preview; correct answer and controls can fall below the fold.
5. Live status exposes English lifecycle values and revision numbers but has no connected/fullscreen/stale projector state.
6. Mobile live puts critical controls after the preview; audited controls began around y=920 on a 844 px viewport.
7. There is no readiness/preflight step; broken media/answer images become visible during the live run.
8. Human-facing errors sometimes mention Functions Emulator, ordered slides, or private session terminology.

## Page-by-page audit

### Login

| Verdict | Classification | Finding |
| --- | --- | --- |
| **KEEP** | UX RECOMMENDATION | Clear two-field form, persistent labels, strong contrast, straightforward submit state. |
| **IMPROVE** | CONFIRMED PRODUCT REQUIREMENT | Remove film-specific `FK`/copy and source brand from central config. |
| **REMOVE for non-dev builds** | UX RECOMMENDATION | `Firebase Authentication Emulator` and test-account language is development detail, not product copy. |
| **IMPROVE** | UX RECOMMENDATION | Reduce the oversized heading; add password reveal only if security/product standards accept it. |

Primary workflow is one submit after two field entries. No extra navigation should be added.

### Admin home

| Verdict | Classification | Finding |
| --- | --- | --- |
| **REMOVE from primary content** | UX RECOMMENDATION | `Role pochází z Firebase ID tokenu` and Firestore Rules explanation. |
| **REDESIGN** | CONFIRMED PRODUCT REQUIREMENT | Replace foundation/status messaging with next event, continue draft, recent quizzes, quick actions, and meaningful warnings. |
| **IMPROVE** | UX RECOMMENDATION | Move account/role/sign-out into global account menu; it should not occupy a dashboard quadrant. |

### Quiz library

| Verdict | Classification | Finding |
| --- | --- | --- |
| **KEEP** | UX RECOMMENDATION | Desktop comparison table; title, status, rounds, questions, updated time are scannable. |
| **KEEP** | UX RECOMMENDATION | Responsive table-to-card transformation is readable at 390 px. |
| **IMPROVE** | CONFIRMED PRODUCT REQUIREMENT | Add search, status filter, sort, optional themes, and safe row actions. |
| **REDESIGN** | UX RECOMMENDATION | Giant heading/count card consumes space while the primary `Nový kvíz` action is absent. |
| **REMOVE** | UX RECOMMENDATION | Arrow-only final column as the only explicit row action; use row title/open plus labelled overflow actions. |

### Quiz detail

| Verdict | Classification | Finding |
| --- | --- | --- |
| **KEEP / IMPROVE** | UX RECOMMENDATION | Summary, status, edit, and live launch belong together. Add readiness before live. |
| **REMOVE** | UX RECOMMENDATION | `updatedBy` technical seed/UID values; show a human name or omit. |
| **REDESIGN** | UX RECOMMENDATION | A seeded quiz showed `5 otázek` but `V tomto kole zatím nejsou otázky` because counters and loaded projection diverged. Never present an empty-state claim that contradicts metrics; show `Detail otázek není dostupný` plus recovery. |
| **IMPROVE** | CONFIRMED PRODUCT REQUIREMENT | `Spustit kvíz` must route through readiness/preflight rather than immediately creating a live session. |

### Editor

**UX RECOMMENDATION**

See `EDITOR_UX_SPEC_DRAFT.md`. Summary: keep shared realtime preview and safety boundaries; redesign the flat list, universal form, technical labels, save split, and responsive stacking.

### Live control

| Verdict | Classification | Finding |
| --- | --- | --- |
| **KEEP** | CONFIRMED PRODUCT REQUIREMENT | Relevant media controls are conditional; ordinary questions avoid a cockpit of buttons. |
| **KEEP** | CONFIRMED PRODUCT REQUIREMENT | Moderator sees private answer/note; projector receives only sanitized state. |
| **KEEP / IMPROVE** | CONFIRMED PRODUCT REQUIREMENT | Previous/Next and arbitrary recap selection are correct foundations. |
| **REDESIGN** | CONFIRMED PRODUCT REQUIREMENT | Use a focused live shell outside ordinary admin chrome. |
| **REMOVE from ordinary UI** | UX RECOMMENDATION | `waiting`, `active`, `recap`, technical kind names, revision, raw projector URL. |
| **REDESIGN** | CONFIRMED PRODUCT REQUIREMENT | Add explicit projector connected/fullscreen/stale/disconnected state. |
| **REDESIGN** | UX RECOMMENDATION | At 1280×720 the correct answer is below the preview fold; at 390×844 controls begin below the first viewport. Critical controls/answer must remain visible. |
| **IMPROVE** | UX RECOMMENDATION | Pending mutations currently disable buttons without action-specific feedback; show `Přecházím…`/`Spouštím…`. |

### Projector

| Verdict | Classification | Finding |
| --- | --- | --- |
| **KEEP** | CONFIRMED PRODUCT REQUIREMENT | Dedicated black responsive 16:9 shell, shared renderer, waiting state, fullscreen button/F shortcut. |
| **KEEP** | CONFIRMED PRODUCT REQUIREMENT | No admin navigation and no private data path. |
| **IMPROVE** | UX RECOMMENDATION | Loading text is briefly oversized/uncomposed before the projector state resolves; use the same centered message canvas from first paint. |
| **IMPROVE** | UX RECOMMENDATION | Broken answer image rendered visible alt text/bar in recap. Preflight plus renderer fallback must avoid a broken visual. |

### Recap

| Verdict | Classification | Finding |
| --- | --- | --- |
| **KEEP** | CONFIRMED PRODUCT REQUIREMENT | One selected answer at a time, arbitrary order, contextual media controls, no auto-play. |
| **REDESIGN** | CONFIRMED PRODUCT REQUIREMENT | Buttons used global slide positions (`2, 4, 5, 6`) in the synthetic round instead of clear question sequence. Use round-local 1…N. |
| **IMPROVE** | UX RECOMMENDATION | Add visited/current/unavailable states and `Zobrazeno n/N`. |
| **IMPROVE** | UX RECOMMENDATION | Replace generic `Další` with contextual `Pokračovat na další kolo` when leaving recap. |

## Dashboard specification

**CONFIRMED PRODUCT REQUIREMENT**

No vanity chart dashboard. Prioritize time-sensitive work and quick actions.

**UX RECOMMENDATION**

Priority order is dynamic:

1. If an event is live or within 24 hours: show it first with `Otevřít přípravu` / `Pokračovat v moderování`.
2. Otherwise: `Nový kvíz` is the primary CTA because quiz content is the prerequisite for events.
3. `Nová akce` is secondary and appears only after the events module is implemented.
4. Continue the most recently edited draft.
5. Show 3–5 recent quizzes and only actionable warnings.

### Text wireframe — dashboard

```text
┌──────────── sidebar ────────────┬───────────────────────────────────────────┐
│ QUIZ PLATFORM                  │ Přehled                     [Nový kvíz]   │
│ ● Přehled                      ├───────────────────────────────────────────┤
│   Kvízy                        │ NEJBLIŽŠÍ AKCE                            │
│   Akce                         │ Dnes 19:00 · Název · Připravenost 8/10    │
│   Výsledky                     │ [Otevřít přípravu] [Otevřít projektor]    │
│                                ├──────────────────────┬────────────────────┤
│                                │ POKRAČOVAT           │ RYCHLÉ AKCE        │
│                                │ Rozpracovaný kvíz    │ + Nový kvíz        │
│                                │ 2 problémy           │ + Nová akce        │
│                                ├──────────────────────┴────────────────────┤
│ account                        │ POSLEDNÍ KVÍZY                            │
└────────────────────────────────┴───────────────────────────────────────────┘
```

Empty state: explain one next step (`Vytvořte první kvíz`) and one primary action. Do not show authentication architecture.

## Quiz library specification

**UX RECOMMENDATION**

Use an adaptive table, not a desktop card grid. Users compare structured metadata across many quizzes; tables are faster and denser. Below 720–768 px, each semantic row becomes a card.

Columns: title/optional theme, status, rounds, questions, last change. Optional owner is useful only if multiple editors become real. Search is immediate over title; filter status; default sort last changed descending.

Row actions: `Otevřít`, `Upravit`, `Duplikovat`, `Archivovat`. Archive is reversible; no permanent delete in the main menu. Archived items are excluded by default and available via filter.

### Text wireframe — quiz library

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Kvízy                                                [+ Nový kvíz]         │
│ [Hledat kvíz…________________] [Stav: Aktivní ▾] [Řadit: Změna ▾]          │
├──────────────────────────────┬───────────┬──────┬─────────┬───────────┬─────┤
│ NÁZEV / TÉMA                 │ STAV      │ KOLA │ OTÁZKY │ ZMĚNA     │  ⋯  │
├──────────────────────────────┼───────────┼──────┼─────────┼───────────┼─────┤
│ Název kvízu                  │ Připraven │  6   │   60    │ před 2 h  │  ⋯  │
│ Druhý kvíz                   │ Koncept   │  3   │   24    │ včera     │  ⋯  │
└──────────────────────────────┴───────────┴──────┴─────────┴───────────┴─────┘
```

## Recommended live moderator architecture

**CONFIRMED PRODUCT REQUIREMENT**

The moderator needs current question/number, correct answer, relevant controls, previous/next, projector state, media state, and fast recap. Only type-relevant controls appear.

**UX RECOMMENDATION**

### Focused shell

- Compact header: return, event/quiz name, round/question context, projector pill.
- Main left: compact projector-exact preview.
- Moderator info directly adjacent: correct answer and note never below the first-screen controls.
- Right control rail: projector status, previous/next, contextual intro/media/recap, separated end action.
- Sticky bottom controls on tablet/mobile; preview becomes smaller and collapsible.

### Text wireframe — live moderator

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Akce   Název akce · 2. kolo   Otázka 4 z 10     PROJEKTOR ● Připojen      │
├──────────────────────────────────────────────────┬───────────────────────────┤
│ CO VIDÍ PROJEKTOR                                │ CO MŮŽU UDĚLAT DÁL       │
│ ┌──────────────────── 16:9 ────────────────────┐ │ PROJEKTOR                │
│ │                    otázka                    │ │ ● Připojen · Celá obraz. │
│ └──────────────────────────────────────────────┘ │ [Aktivovat okno]          │
│                                                  ├───────────────────────────┤
│ SPRÁVNÁ ODPOVĚĎ                                  │ [← Předchozí] [Další →]  │
│ Martin Scorsese                                  │                           │
│ POZNÁMKA: ...                                    │ (jen relevantní media)    │
└──────────────────────────────────────────────────┴───────────────────────────┘
                                            [⋯] Ukončit kvíz
```

Normal question/image/free: previous + next only. Audio/video: add Play, Stop, Play again. Intro: add Start intro. Pending action preserves layout and changes label. End quiz remains visually separated and confirms consequence.

## Projector status model

**UX RECOMMENDATION**

| State | User-facing display | Primary action |
| --- | --- | --- |
| Not opened | `PROJEKTOR ○ Není otevřen` | `Otevřít projektor` |
| Opening | `PROJEKTOR ◌ Připojuji…` | none |
| Connected + fullscreen | `PROJEKTOR ● Připojen` + `Celá obrazovka` | `Aktivovat okno` |
| Connected, not fullscreen | `PROJEKTOR ● Připojen` + warning `Není na celé obrazovce` | `Aktivovat okno` |
| Stale | `PROJEKTOR ! Bez odezvy` | `Znovu připojit` |
| Closed/disconnected | `PROJEKTOR × Odpojen` | `Otevřít znovu` |

Connection/fullscreen status needs a projector heartbeat/handshake in a future implementation. Revision and last heartbeat may appear under `Technické podrobnosti`, never as the main status.

**HUMAN DECISION**

Choose stale thresholds and cross-device guarantees. Recommended starting copy: stale after 10 s without acknowledgement, disconnected after 30 s/window-close signal, with conservative `Stav nelze ověřit` when the browser cannot know.

## Recap moderator specification

**CONFIRMED PRODUCT REQUIREMENT**

After answer sheets are handed in, recap lets the moderator choose any question. Projector shows the question and correct answer; audio/video uses normal visible player behavior and manual controls.

**UX RECOMMENDATION**

### Text wireframe — recap

```text
┌──────────────────────────────────────────┬──────────────────────────────────┐
│ REKAPITULACE · 2. KOLO                  │ OTÁZKY · Zobrazeno 3/10          │
│ ┌──────────── projector preview ───────┐ │ [✓1] [✓2] [ 3] [●4] [ 5]       │
│ │ otázka + správná odpověď             │ │ [ 6] [!7] [ 8] [ 9] [10]       │
│ └──────────────────────────────────────┘ │                                  │
│ SPRÁVNÁ ODPOVĚĎ: …                      │ Média pro otázku 4                │
│                                          │ [PLAY] [STOP] [PUSTIT ZNOVU]      │
└──────────────────────────────────────────┴──────────────────────────────────┘
                              [Pokračovat na 3. kolo →]
```

Question states: unvisited, selected, already shown, unavailable (missing answer/media blocker). Use local question numbers 1…N. Selecting another question replaces the complete public answer state as already guaranteed by architecture.

## Error UX model

**CONFIRMED PRODUCT REQUIREMENT**

Separate human message from technical detail.

**UX RECOMMENDATION**

Each error has:

1. Plain Czech title: what failed.
2. Short impact: what the moderator/audience sees now.
3. Safe primary action.
4. Optional secondary action.
5. Collapsed technical detail with code/correlation data and no private answer/media URL.

| Situation | Human message | Actions | Technical detail example |
| --- | --- | --- | --- |
| YouTube 150/embed denied | `Video nelze přehrát z YouTube.` | `Zkusit znovu`, `Pokračovat bez videa` | `YT_PLAYER_ERROR_150` |
| Network mutation failed | `Akci se nepodařilo odeslat. Projektor zůstal na předchozím slidu.` | `Zkusit znovu` | callable code, safe timestamp |
| Stale editor | `Kvíz mezitím upravil někdo jiný.` | `Načíst novější verzi`, `Zkopírovat moje změny` | revision only here |
| Missing media | `Otázka nemá zdroj média.` | `Opravit otázku`, `Pokračovat textově` | slide ID only in dev detail |
| Projector disconnected | `Projektor neodpovídá.` | `Otevřít znovu` | last acknowledgement |

Production copy must not say `Functions Emulator`, `ordered slides`, `privátní session`, or tell the user to understand Firebase.

## Preflight / quiz readiness concept

**UX RECOMMENDATION — product concept only**

Entry points: quiz detail, editor header, and required step before starting live. The screen groups issues, links directly to the affected item, and distinguishes blockers from warnings.

```text
PŘIPRAVENOST KVÍZU                                  Kontrola před 2 min
✓ Struktura: 6 kol / 60 otázek
✓ Správné odpovědi: 60/60
✓ Obrázky: 18/18 načteno
! Média: Video 2.4 nelze vložit z YouTube          [Opravit]
! Časování: Audio 3.7 má konec před začátkem       [Opravit]
○ Projektor není otevřen                           [Otevřít]

[Zkontrolovat znovu]                    [Spustit live] (disabled/blocker)
```

Recommended checks:

- quiz/round/question non-empty structure;
- correct answer for every question;
- unique derived round-local question numbering;
- image load and source-role validity;
- media source parse/embed/playability where technically possible;
- start/end validity and duration;
- unsupported legacy items needing review;
- projector open/connected/fullscreen as an operational check;
- unsaved local edits before start.

Blockers: missing question/answer, invalid timing, unsupported/unrenderable required content. Warnings: projector not open, best-effort media availability, optional background missing. `Spustit i tak` should be allowed only for warnings and should explain the fallback.

**HUMAN DECISION**

Approve the blocker/warning policy before implementing preflight. Offline/media caching readiness is **FUTURE** and must not be implied by a green online check.

## Click-cost audit

Counts start from the most relevant product root and exclude text typing unless stated.

| Workflow | Current observed cost | Recommended target | Finding |
| --- | --- | --- | --- |
| A. Create FREE question | Library → quiz → editor (2), type dropdown/option/Add/Save (~4): ~6 clicks + fields | From open editor: `+ Otázka`, type, Save = 3 + fields | Current type list is technical and round context implicit. |
| B. AUDIO + segment | Same navigation + ~4 editor clicks + URL/start/end entries; no current-time capture/test | From editor: 3 base + source/load + two capture actions + test + Save | More purposeful actions, much lower cognitive cost. |
| C. Add round | From editor: dropdown, choose header, Add, Save ≈4 + name | `+ Přidat kolo`, name, Save = 2 + entry | Remove slide terminology. |
| D. Start live | Library row → quiz detail → `Spustit kvíz` = 2 clicks, no readiness | Same 2 + one readiness confirmation when clean | One extra safety step has real event value. |
| E. Open projector | 1 click, but no reliable visible connected/fullscreen acknowledgement | 1 click; status changes in place | Keep click cost, improve confidence. |
| F. Enter recap | Repeated `Další` until authored recap; cost depends on slide distance | Contextual `Spustit rekapitulaci` at round end = 1 | Keep authored navigation compatibility but expose product action. |

## Responsive recommendations

**CONFIRMED PRODUCT REQUIREMENT**

Notebook, Full HD, smaller notebook, and tablet are full targets. Mobile must support basic access and live control.

**UX RECOMMENDATION**

- Desktop/admin: sidebar + content; maximum operational content width should not create unused black gutters.
- Tablet: rail/drawer; tables may remain scrollable only when card conversion loses comparison value.
- Mobile library: current card transformation is a good base; reduce header/count vertical cost and add sticky search/new action.
- Mobile editor: tabbed reduced mode per editor spec.
- Mobile live: projector status + previous/next/media controls sticky in the first viewport; compact preview above or collapsible; correct answer visible before optional note/preview detail.
- Touch targets ≥44 px; do not rely on hover or drag.

## Accessibility audit

| Topic | Current | Classification | Recommendation |
| --- | --- | --- | --- |
| Contrast | Strong dark base; most text/statuses readable | KEEP / VERIFY | Tokenize and test AA; do not rely on low-opacity fullscreen/status controls for essential actions. |
| Keyboard | Native controls and labels exist | IMPROVE | Shared `:focus-visible` for links/buttons; logical live/editor order; skip link. |
| Icon-only buttons | Some media buttons labelled; reorder/option delete use symbols/title | REDESIGN | Unique `aria-label`, tooltip, 40–44 px target. |
| Form labels | Persistent labels are mostly present | KEEP | Connect help/errors via `aria-describedby`; no internal field labels. |
| Modal focus | Unsaved warning is an `alertdialog` but not a modal/focus trap | REDESIGN | Dialog semantics, initial focus, Escape, restore focus. |
| Text sizes | Body generally adequate; metadata often 0.67–0.76rem | IMPROVE | Minimum 0.8125rem for functional metadata; critical live 1rem+. |
| Reduced motion | Projector has a reduced-motion rule | KEEP / IMPROVE | Stop decorative animations rather than only slowing them; cover all shell motion. |
| Status announcements | Errors use alerts; pending/save states inconsistent | IMPROVE | `aria-live` save/action/projector status; avoid noisy repeated announcements. |

## Recommended implementation order

**UX RECOMMENDATION**

1. P0 product decisions: save model, round/system-section facade, event-backed live/practice, preflight policy, mobile live priority.
2. Humanize current UI: remove revisions/internal kinds/emulator copy; add user-facing errors and status tokens.
3. Build focused live shell with projector status placeholder model, first-viewport controls/answer, and mobile sticky controls.
4. Build admin shell/dashboard/library actions and brand-neutral config.
5. Implement editor relevant-field filtering and unified save status.
6. Implement round-first editor outline and responsive preview dock.
7. Add preflight checks/deep links, then media timing capture/test.
8. Add events/results only with their own validated workflows; autosave/light theme/offline readiness remain separate work.

No item in this document authorizes production deployment, Firebase changes, scoring, registration, results implementation, offline engine, or a complete redesign in this research branch.
