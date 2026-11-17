# UX product decisions required — QUIZ PLATFORM

Status: **HUMAN DECISION REGISTER**

Date: 2026-09-02

Historical discovery record. Later implemented contracts supersede the resolved choices here: [explicit Save all and conflict recovery](EDITOR_WORKING_COPY.md), [round-first complete editor](COMPLETE_EDITOR_RELEASE.md), [event preparation](EVENT_MANAGEMENT.md), [preflight](QUIZ_PREFLIGHT.md), and [JustKvíz branding](JUSTKVIZ_REBRAND.md). Do not request those decisions again or treat every old recommendation as missing work. Use [the current completion matrix](COMPLETION_MATRIX.md) for applicable remaining decisions and evidence.

## How to use this document

- **P0 — before redesign implementation:** changes information architecture, safety, persistence, or primary workflows.
- **P1 — during implementation:** affects component behavior and responsive scope.
- **P2 — polish:** can be deferred without invalidating the core workflow.

Recommendations are UX proposals, not silently confirmed requirements. Existing confirmed projector/security behavior remains authoritative.

- **UX RECOMMENDATION** — the preferred option stated under each question; it becomes binding only after human approval.
- **HUMAN DECISION** — the options themselves require a product owner choice.
- **CONFIRMED PRODUCT REQUIREMENT** — already settled behavior listed near the end of this document.
- **FUTURE** — a dependency or decision outside the current redesign scope.

## P0 — before redesign implementation

### P0.1 Save model

**HUMAN DECISION**

Should a question be saved:

- **A)** only with an explicit `Uložit` / `Ctrl+S`; or
- **B)** automatically after a short idle period, with visible `Ukládám / Uloženo` state?

**Recommendation:** A for the first redesign. Revisit B only with field validation, conflict recovery, and version history. The current research task does not change persistence.

### P0.2 Editor product model versus slide model

**HUMAN DECISION**

Should the normal editor present:

- **A)** `Kvíz → Kola → Otázky`, with system presentation records hidden behind friendly nodes; or
- **B)** the full global slide sequence as today, with improved labels?

**Recommendation:** A. Keep B only as a protected migration/diagnostic view. This is the main decision separating a product from a developer tool.

### P0.3 Agenda, rules, opening, and recap representation

**HUMAN DECISION**

For new quizzes, should these be:

- **A)** generated system sections (`Úvod kvízu`, agenda from rounds, rules template, recap per round) with friendly overrides; or
- **B)** manually created/reordered slides?

**Recommendation:** A. Migrated authored records remain lossless and can be wrapped by the same friendly UI.

### P0.4 Real event versus practice live

**HUMAN DECISION**

Should `Spustit kvíz`:

- **A)** always require/select an event; or
- **B)** allow a direct event-less live session from quiz detail?

**Recommendation:** A for real operation plus an explicitly separate `Spustit zkušebně` path implementing B. Coordinate with the events/scoring architecture research before route implementation.

### P0.5 Readiness enforcement

**HUMAN DECISION**

When preflight finds an issue, should live start:

- **A)** be blocked for missing question/answer, invalid timing, or unrenderable required content, while warnings can be overridden; or
- **B)** always allow `Spustit i tak`?

**Recommendation:** A. Never let the user discover structural blockers only during the event. YouTube best-effort availability and projector-not-open are warnings with explicit fallback/action.

### P0.6 Mobile live priority

**HUMAN DECISION**

On mobile, should the first viewport prioritize:

- **A)** sticky previous/next/contextual controls + correct answer, with a compact/collapsible preview; or
- **B)** full projector preview first, controls below?

**Recommendation:** A. The current B-like stacking places controls below a 844 px viewport and is not usable during a live event.

### P0.7 Multiple-choice correct answer

**HUMAN DECISION**

Should the correct answer be:

- **A)** selected directly from the authored options; or
- **B)** independently typed as free text?

**Recommendation:** A for the display/scored option, with optional accepted variants as a future advanced field. This prevents option/answer mismatches.

### P0.8 `Otestovat na projektoru`

**HUMAN DECISION**

Should the projector test window show:

- **A)** the current unsaved local draft; or
- **B)** only the last saved quiz state?

**Recommendation:** A using the shared renderer in a clearly labelled local preview channel/route, without writing `publicSessions`. Correct-answer preview stays off by default.

## P1 — during implementation

### P1.1 Empty clip end

**HUMAN DECISION**

For AUDIO/VIDEO should the end be:

- **A)** required; or
- **B)** optionally set to an explicit `Do konce média` mode?

**Recommendation:** B. Never use an ambiguous empty field; internal absence remains a deliberate no-limit value and is not guessed.

### P1.2 Projector stale/disconnected thresholds

**HUMAN DECISION**

Should the moderator status treat no acknowledgement as stale/disconnected after:

- **A)** approximately 10 s / 30 s; or
- **B)** different operational thresholds determined by venue testing?

**Recommendation:** Start with A, but phrase unknown browser states conservatively (`Stav nelze ověřit`). Cross-device presence needs technical validation.

### P1.3 Mobile editor scope

**HUMAN DECISION**

Should mobile support:

- **A)** browse/readiness/basic prompt-and-answer corrections, while complex media timing/reorder requires tablet/desktop; or
- **B)** full editor parity?

**Recommendation:** A for the first redesign. Live control remains fully mobile-usable; scoring is a separate future mobile-first surface.

### P1.4 Admin theme launch scope

**HUMAN DECISION**

Should phase 1 ship:

- **A)** one refined dark admin theme with semantic tokens; or
- **B)** system light/dark themes immediately?

**Recommendation:** A; projector keeps its own dark presentation theme. Prepare tokens for B and add a switcher only when both themes are production-ready.

### P1.5 Quiz archive and deletion

**HUMAN DECISION**

Should ordinary quiz lifecycle offer:

- **A)** reversible archive only; or
- **B)** archive plus permanent delete in an advanced danger area?

**Recommendation:** A for normal UX. B is future/admin-only only after retention, dependencies, audit, and recovery are defined.

### P1.6 Round removal with questions

**HUMAN DECISION**

When removing a non-empty round, should the UI:

- **A)** require moving questions or explicitly confirm removing the round and all included questions; or
- **B)** silently remove the full group after a generic confirm?

**Recommendation:** A, defaulting to Cancel and showing the affected count.

### P1.7 Live return target

**HUMAN DECISION**

Should leaving live return to:

- **A)** the event detail when event-backed, with quiz detail as practice fallback; or
- **B)** always quiz detail?

**Recommendation:** A. Leaving the live route must not end the session; ending is a separate confirmed action.

### P1.8 Recap entry

**HUMAN DECISION**

At the end of a round should recap start through:

- **A)** a contextual `Spustit rekapitulaci` action; or
- **B)** repeated ordinary `Další` navigation until an authored recap slide?

**Recommendation:** A, while preserving B-compatible source order internally. The contextual action should enter the same secure recap state.

## P2 — polish

### P2.1 Dashboard greeting

**HUMAN DECISION**

Should overview use:

- **A)** neutral `Přehled`; or
- **B)** a time-based personalized greeting?

**Recommendation:** A until reliable preferred names/localization exist. Operational content matters more than greeting copy.

### P2.2 Manual theme switcher

**HUMAN DECISION**

If light theme is later built, should choice be:

- **A)** system-only; or
- **B)** system/default plus manual override?

**Recommendation:** B only after both themes pass accessibility and projector theme remains independent.

### P2.3 Power-user shortcuts

**HUMAN DECISION**

Should the editor ship documented shortcuts for add/duplicate/reorder:

- **A)** after core keyboard navigation is stable; or
- **B)** not expose shortcuts beyond Save?

**Recommendation:** A as P2. Shortcuts supplement visible actions and never replace them.

## Confirmed requirements that are not decisions

**CONFIRMED PRODUCT REQUIREMENT**

- Brand-neutral `QUIZ PLATFORM`; central brand/theme configuration.
- Question types: multiple choice, free, image, audio, video; Pravda/Lež is legacy-only for existing data.
- Preview and projector use the same renderer.
- Correct answers never reach public/projector clients before explicit recap reveal.
- Audio/video controls are manual; no auto-advance or auto-reveal.
- Recap selects questions in arbitrary order and publishes one selected answer at a time.
- Human timing format supports tenths while persistence remains numeric seconds.
- Drag-and-drop is never the only reorder mechanism.
- No production deploy, production Firebase contact, scoring, registration, results, offline engine, PDF, or media-engine redesign in this research task.

## Dependencies / future decisions

**FUTURE**

- Owned media ingestion, offline readiness/cache policy, captions/alt-text authoring, results/scoring, registration, PDF, and referee workflows need separate specifications.
- Legacy `optionsStr`, `audioTrigger`, and `recapOverrides` meanings remain governed by `PRODUCT_DECISIONS_REQUIRED.md`; the friendly editor must preserve them without exposing or guessing them.
