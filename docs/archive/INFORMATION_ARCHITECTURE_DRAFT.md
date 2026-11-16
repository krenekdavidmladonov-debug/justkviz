# Information architecture draft — QUIZ PLATFORM

Status: **UX RECOMMENDATION**

Research branch: `research/admin-editor-ux`

Date: 2026-09-02

## Classification

- **CONFIRMED PRODUCT REQUIREMENT** — explicit product constraint from the discovery brief or an existing confirmed behavior.
- **UX RECOMMENDATION** — proposed product/design direction based on the local audit.
- **HUMAN DECISION** — a choice that changes product behavior and needs an owner.
- **FUTURE** — intentionally outside the current implementation scope.

## Navigation principles

**CONFIRMED PRODUCT REQUIREMENT**

Every screen must answer, without technical knowledge:

1. Where am I?
2. What is happening now?
3. What can I do next?

The product is topic-neutral. Navigation and route labels must use `QUIZ PLATFORM` / `Kvízová platforma`, not film-specific concepts. The final brand must be replaceable from one product configuration and theme boundary.

**UX RECOMMENDATION**

Use three shells, because the user's attention model differs substantially:

1. **Admin shell** for overview, quiz preparation, events, and results.
2. **Editor shell** with a focused workspace and a clear return to the quiz.
3. **Live shell** with no ordinary admin navigation, large operational controls, and a clear return that does not end the session.

The public projector remains a fourth, presentation-only shell with no admin chrome.

## Proposed product map

**UX RECOMMENDATION**

```text
QUIZ PLATFORM
├─ Přehled
│  ├─ Nejbližší akce
│  ├─ Pokračovat v rozpracovaném kvízu
│  └─ Poslední kvízy / upozornění
├─ Kvízy
│  ├─ Knihovna kvízů
│  ├─ Detail kvízu
│  └─ Editor [focused shell]
│     ├─ Úvod kvízu
│     │  ├─ Úvodní obrazovka
│     │  ├─ Harmonogram [generovaný]
│     │  └─ Pravidla [template + úpravy]
│     └─ Kola
│        ├─ Kolo
│        ├─ Otázky
│        └─ Rekapitulace [generovaná]
├─ Akce [až bude funkční]
│  ├─ Seznam / kalendář
│  ├─ Detail a připravenost
│  └─ Live moderování [focused shell]
├─ Výsledky [až bude funkční]
└─ Nastavení [až bude obsahovat skutečné volby]
```

Do globálního menu nepřidávat prázdné nebo disabled moduly. Route architecture si může `Akce` a `Výsledky` rezervovat, ale navigace je má zobrazit až s použitelným obsahem. Samostatná položka `Knihovna` není nutná: knihovna je výchozí stránka modulu `Kvízy`.

## Desktop and tablet navigation

**UX RECOMMENDATION**

- Desktop ≥ 1280 px: persistent left sidebar 224–248 px, product mark at top, primary modules in the middle, account/help at bottom.
- Tablet / smaller notebook 768–1279 px: collapsible 72 px rail; labels appear in a temporary drawer or on expansion.
- Context top bar: page title, optional status/context, one primary action, account menu. Do not repeat a giant marketing-style H1 on operational screens.
- The selected module is indicated by text, icon, background, and `aria-current`, not color alone.
- Global navigation contains product concepts. Projector launch is an action inside an event/live flow, not a global module.

Current top navigation mixes audiences (`Admin`, anonymous `Projektor`, public `Akce`) and does not tell a signed-in admin whether they are in preparation or operation. It should be **REDESIGN**.

## Mobile navigation

**UX RECOMMENDATION**

- Admin overview/library: compact top app bar plus bottom navigation for at most four implemented modules.
- More/Settings belongs in a menu, not a fifth permanent tab unless usage data justifies it.
- Editor: focused header with back, item title, save state, and tabs/drawers for `Struktura`, `Obsah`, and `Náhled`.
- Live: no bottom admin navigation. Use a focused shell with sticky previous/next and contextual media actions within thumb reach.
- Projector route never inherits mobile admin navigation.

## Breadcrumbs and return behavior

| Context | Classification | Recommendation |
| --- | --- | --- |
| Admin overview and module roots | UX RECOMMENDATION | No breadcrumbs; active sidebar item and page title are sufficient. |
| Quiz detail | UX RECOMMENDATION | `Kvízy / {název}` only if the sidebar is collapsed; otherwise a compact `← Kvízy`. |
| Editor | CONFIRMED PRODUCT REQUIREMENT | Always show `← Detail kvízu`; leaving with an unsaved local draft invokes the save/leave decision. |
| Live | CONFIRMED PRODUCT REQUIREMENT | Always provide `← Akce` or fallback `← Detail kvízu`. Leaving the screen must not silently end the session. |
| Projector | CONFIRMED PRODUCT REQUIREMENT | No breadcrumb or admin return link. |

Browser Back must follow the same unsaved-change policy as visible navigation. A full-screen live mode may expose `Opustit ovládání` in a menu; `Ukončit kvíz` remains a separate destructive lifecycle action.

## Route direction

**UX RECOMMENDATION**

```text
/admin                         Přehled
/admin/quizzes                 Knihovna kvízů
/admin/quizzes/:quizId         Detail kvízu
/admin/quizzes/:quizId/edit    Editor shell
/admin/events                  Akce (FUTURE until implemented)
/admin/events/:eventId         Detail a preflight (FUTURE)
/admin/live/:sessionId         Live shell
/admin/results                 Výsledky (FUTURE)
/projector/:sessionId          Public presentation shell
```

**HUMAN DECISION**

The future canonical start point must be chosen before events are implemented: either live sessions always belong to an event, or `Spustit zkušebně` may create an event-less practice session from quiz detail. Recommended: event-backed live for real operations plus an explicitly labelled practice mode from quiz detail.

## Location model by shell

**UX RECOMMENDATION**

| Shell | Where am I? | What is happening? | What next? |
| --- | --- | --- | --- |
| Admin | Active module + page title | Content/status summary | One primary CTA in header |
| Editor | Quiz title + selected round/question | Save state + validation state | Edit, preview, save/check readiness |
| Live | Quiz/event + round/question | Projector/media/session status | Contextual next/media action |
| Projector | Presentation content only | Waiting/slide/error state | No admin action; fullscreen control only |

## Delivery sequencing

**UX RECOMMENDATION**

1. Introduce brand-neutral config and navigation tokens without changing data boundaries.
2. Replace the mixed top navigation with the admin shell for implemented modules only.
3. Give editor and live routes their focused shells.
4. Add future modules only with working empty states and real workflows.

No route proposal authorizes Firebase, Functions, Security Rules, or production changes.
