# Event form UX fix

Base: `chore/v2-staging-environment`, SHA
`81a24c85b0fc187876a6421c29c15b7d0101a5b3` (open PR #11).
This stacked PR intentionally targets that branch, not older main.

## Confirmed cause

Read-only inspection of HTTPS staging found title inputs 189 × 27 px, default
grey background and 1px/2px padding at 1280, 1024 and 390px widths.
The desktop heading was 64px at 1280px and 51.2px at 1024px.
The source uses `.editor-field`, which has no input/label style rules; the
existing shared rules are `.form-field`. The heading inherited the oversized
event heading rule, and the create header arranged its children in a flex row.
The observed deployed styles match these source rules; no new design system is needed.

## Change and verification

Both routes still use one EventForm. It now reuses form-field, groups basic
details and capacity into fieldsets, uses full-width title, 46px fields, two
desktop columns/one mobile column, compact headings and contextual pending text.
Technical revision was removed from the ordinary form, not from mutation requests.
Defaults, value mapping, expectedRevision, server validations and moderator
read-only behavior are unchanged. No backend, seed or staging records were written.

Six targeted Playwright checks render the actual routes with synthetic service
mocks on localhost, covering create/edit payloads, revision, failure retention,
native validation, moderator denial, keyboard focus and both layouts at
1280×720, 1024×768 and 390×844. Run from repository root:
`node node_modules/@playwright/test/cli.js test --config tests/browser/events-form-ux.config.ts`.
No emulator or cloud account is required. Mock injection exists only in the
dedicated test Vite config, not the application build configuration.

Before screenshots: main checkout `.local-data/events-form-ux/before/` (HTTPS staging).
After screenshots: fix worktree `.local-data/events-form-ux/after-local/` (local synthetic fixture).
Both sets include both forms at all three requested viewport sizes.
They are ignored and not committed. After images do NOT prove a deployed fix.

## Delivery follow-up

Observed staging release: `sites/filmovy-kviz-v2-staging/releases/1788779886011000`;
Hosting version `7a62b04cc6b9ef92`, released 2026-09-07T11:18:06.011Z.
This is the pre-fix release. Hosting-only deployment audit records the next release locally.

The operator explicitly authorized adding `--hosting-only` to the existing guarded
staging script and adding only `chore/v2-staging-environment` to the CI pull_request
base filter. main triggers, jobs, permissions and pinned actions remain unchanged.
No merge or retargeting is required. Deploy only after CI passes for the exact HEAD.
Read-only post-deploy screenshots belong in ignored `.local-data/events-form-ux/after-staging/`;
they are distinct from the earlier local fixture screenshots.
