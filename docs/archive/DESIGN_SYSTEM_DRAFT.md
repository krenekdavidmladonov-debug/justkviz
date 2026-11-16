# Design system draft — QUIZ PLATFORM

Status: **UX RECOMMENDATION**

Date: 2026-09-02

## Classification

- **CONFIRMED PRODUCT REQUIREMENT** — explicit constraint or confirmed product behavior.
- **UX RECOMMENDATION** — proposed design direction.
- **HUMAN DECISION** — product owner choice required.
- **FUTURE** — deliberately deferred.

## Direction

**CONFIRMED PRODUCT REQUIREMENT**

The system must feel restrained, modern, professional, quick, slightly premium, responsive, and consistent. It must not feel childish, ornate, or tied to films. A subtle stage/game-night character is acceptable; reels, popcorn, cameras, and other film clichés are not a base visual language.

**UX RECOMMENDATION**

Use neutral dark ink surfaces, warm restrained accent color, high-clarity typography, and sparse elevation. The premium impression should come from hierarchy, spacing, motion discipline, and state clarity—not gradients on every surface or oversized marketing typography inside operational screens.

## Brand-neutral configuration

**CONFIRMED PRODUCT REQUIREMENT**

Brand copy and visual identity must be replaceable centrally. Do not rename repository, Firebase IDs, or technical identifiers.

**UX RECOMMENDATION**

One product/theme boundary should provide at least:

```ts
product = {
  name: 'QUIZ PLATFORM',
  shortName: 'QP',
  adminLabel: 'Kvízová platforma',
  logo: neutralMark,
  supportUrl: undefined,
}
```

The renderer receives brand display copy through configuration/props. No component should hardcode `FILMOVÝ KVÍZ`, `FK`, or film-specific help text.

## Color roles

**UX RECOMMENDATION**

The following values are an initial dark-theme reference, not a final brand palette. Components consume semantic roles only.

| Token | Reference | Purpose |
| --- | --- | --- |
| `--color-background` | `#0B0E12` | App canvas |
| `--color-surface` | `#141922` | Standard cards/panels |
| `--color-surface-elevated` | `#1B2230` | Menus, dialogs, sticky controls |
| `--color-surface-subtle` | `#10151C` | Secondary group background |
| `--color-border` | `#303A49` | Default boundaries |
| `--color-border-strong` | `#46536A` | Active/dividing boundaries |
| `--color-primary` | `#F0B44A` | Primary action and selected emphasis |
| `--color-primary-contrast` | `#171109` | Text/icons on primary |
| `--color-accent` | `#79A7FF` | Links, informational focus, secondary data |
| `--color-success` | `#4CCB82` | Ready, saved, connected |
| `--color-warning` | `#F3B957` | Incomplete, unsaved, not fullscreen |
| `--color-error` | `#F06F7B` | Failed/blocking/destructive |
| `--color-text` | `#F6F7F9` | Primary text |
| `--color-text-muted` | `#AAB3C0` | Secondary text |
| `--color-text-subtle` | `#7E8999` | Metadata that remains readable |
| `--color-focus` | `#8BB5FF` | Keyboard focus ring |

Status must never rely on color alone. Pair role color with icon/shape and plain Czech text.

**HUMAN DECISION**

Choose the eventual brand primary/accent after brand selection. The semantic role map and contrast requirements remain fixed.

## Typography

**UX RECOMMENDATION**

Use one UI family to minimize visual noise and loading cost: `Inter` or a metrically compatible system fallback. A separate display family is unnecessary until brand work proves its value.

| Role | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Display | `clamp(2rem, 3vw, 3.25rem)` / 1.05 | 750 | Dashboard greeting/empty state only |
| Heading 1 | 2rem / 1.15 | 750 | Operational page title |
| Heading 2 | 1.375rem / 1.25 | 700 | Panel/section title |
| Heading 3 | 1.05rem / 1.35 | 650 | Cards and grouped controls |
| Body | 1rem / 1.5 | 400–500 | Standard copy/forms |
| Body small | 0.875rem / 1.45 | 400–500 | Supporting text |
| Label | 0.8125rem / 1.3 | 650 | Form labels/status metadata |
| Projector display | container-scaled | 750–850 | Existing 16:9 renderer rules |

The current 4–5rem headings consume critical live/editor space and should be limited to public/marketing contexts. Avoid all-caps for sentences; use it only for short labels with adequate letter spacing.

## Spacing, radius, elevation

**UX RECOMMENDATION**

```text
Spacing: 4, 8, 12, 16, 24, 32, 48, 64
Control height: 40 compact, 44 standard, 48 critical/touch
Radius: 6 small, 10 control, 14 card, 18 modal; pill only for statuses
Border: 1px standard, 2px selected/focus reinforcement
```

Use at most three shadows:

- `--shadow-sm`: menu/sticky edge;
- `--shadow-md`: elevated dialog;
- `--shadow-lg`: modal only.

Standard cards should primarily use border and surface contrast. Repeated strong gradients and large shadows make dense admin UI feel slower and less professional.

## Motion

**UX RECOMMENDATION**

- Micro transitions: 120–180 ms.
- Drawer/dialog: 180–240 ms.
- Use opacity/transform only; never delay an operational state update for animation.
- Loading buttons keep their width and replace label with action-specific progress (`Ukládám…`, `Přecházím…`).
- Respect `prefers-reduced-motion`; decorative projector animations become static, not merely slower.
- Never animate live controls away from the pointer after a state change.

## Iconography

**UX RECOMMENDATION**

Use one outline icon set with 1.75–2 px stroke, neutral metaphors, and consistent 20/24 px sizes. Text labels remain visible for primary and destructive actions. Icon-only controls require:

- at least 40 × 40 px target (44 × 44 in live/mobile),
- `aria-label`,
- tooltip on hover/focus,
- visible focus ring.

Do not use bare `↑`, `↓`, `×`, or a right-arrow as the only explanation when multiple similar controls exist.

## Component state contract

**UX RECOMMENDATION**

Every interactive component specifies default, hover, focus-visible, active, disabled, loading, validation error, and success when applicable. Form help and error text must be programmatically associated with the field. Disabled is not a substitute for explaining why an action is unavailable.

Save status uses four explicit states:

| State | Visual/copy | Accessibility |
| --- | --- | --- |
| Saved | check + `Uloženo` | polite status, no repeated announcement |
| Saving | spinner + `Ukládám…` | `aria-live="polite"` |
| Dirty | amber dot + `Neuložené změny` | persistent text |
| Error | error icon + `Uložení se nezdařilo` + retry | `role="alert"`; details optional |

Revision numbers belong under `Technické podrobnosti`, not in ordinary saved/live status.

## Light, dark, and projector themes

**UX RECOMMENDATION**

- Admin/editor phase 1: keep a refined dark theme because live operation occurs in dim venues and the current implementation already has a viable base.
- Tokens must be theme-ready; do not encode raw colors in feature components.
- Projector: independent fixed presentation theme, usually dark, passed through the shared renderer.
- A manual theme switcher is not part of the first redesign. Add it only after a usable light token set and a demonstrated need.

**HUMAN DECISION**

Before a full design implementation choose either: A) dark admin only for phase 1, or B) system light/dark from launch. Recommendation: A, with token structure prepared for B.

## Responsive rules

**UX RECOMMENDATION**

| Range | Behavior |
| --- | --- |
| ≥ 1440 px | Full sidebar; editor outline + form + sticky preview |
| 1200–1439 px | Narrow sidebar/rail; preview 360–420 px |
| 768–1199 px | Collapsed rail; editor preview becomes dock/tab; no three minimum-width columns |
| < 768 px | Mobile admin cards; focused editor tabs; live sticky controls before/over compact preview |

Breakpoints follow content pressure rather than device names. At 1024 px the audited editor currently forces 220 + 421 + 340 px columns and creates a 1593 px-tall three-panel surface; the proposed system must switch layout before this point.

## Accessibility baseline

**CONFIRMED PRODUCT REQUIREMENT**

Professional baseline: contrast, keyboard navigation, focus, labelled forms, modal focus, meaningful icon buttons, readable text, and reduced motion.

**UX RECOMMENDATION**

- WCAG AA contrast minimum: 4.5:1 normal text, 3:1 large text and component boundaries.
- Never remove outlines without an equal or stronger `:focus-visible` replacement.
- Provide skip link to main content in standard admin shell.
- Dialogs use `role="dialog"`, `aria-modal="true"`, labelled title, initial focus, focus trap, Escape/Cancel, and focus restoration.
- All fields have persistent visible labels; placeholder is example only.
- Errors are summarized at the top and linked to invalid fields.
- Table-to-card transformations retain semantic heading/label relationships.
- Minimum body text 14 px; critical live controls 16 px or more.

Current strengths to keep: visible form labels, high base contrast, semantic table markup, and a reduced-motion media rule. Current gaps: no shared button/link focus-visible token, repeated `×` controls without unique accessible names, symbol-only reorder controls, and an unsaved-change `alertdialog` without modal focus management.

## Token implementation rule

**CONFIRMED PRODUCT REQUIREMENT**

New UI styling must consume semantic tokens. Scattered feature-level hex values and film-specific CSS variable names are **REMOVE / MIGRATE** during implementation, without changing the projector's confirmed rendering behavior.
