# V0.3 development workflow

This is a historical workflow. Follow [AGENTS.md](../AGENTS.md) for current branch, worktree, testing and release rules.

This document defines the normal development workflow after the human merge of PR #8. Until that merge, `integration/v0.3-development` is the reviewed candidate; after it, `main` is the only canonical V2 integration base.

## Branch roles

- **MAIN** — canonical integrated V2 base. Start every new feature from the current `main` after PR #8 is merged by a human.
- **FEATURE** — `feature/<scope>` for production implementation with a bounded product scope.
- **QA** — `qa/<scope>` for temporary audit or validation tooling. Do not treat QA-only output as product code or merge private artifacts.
- **RELEASE** — `release/<version>` only when an actual release is being prepared.
- **RESEARCH** — `research/<scope>` for discovery and architecture work without production implementation.

Keep changes reviewable, preserve unrelated work, and integrate completed features through a PR. Never use branch names as evidence of ancestry or implementation status.

## Test policy

### Level A — Quick

Use for documentation, small fixes, and narrow implementation changes:

- targeted tests;
- typecheck and lint relevant to the change.

### Level B — Feature

Use for normal feature delivery:

- targeted feature tests;
- relevant security tests;
- production build;
- CI.

### Level C — Full release

Use for release preparation or changes to foundational persisted-data contracts:

- complete test suites;
- full migration verification;
- extended browser and projector QA.

Run full migration verification only when at least one of these conditions applies:

- the migration mapper changed;
- the persisted quiz schema changed;
- the legacy-preservation contract changed;
- the shared migration/domain model changed;
- a significant release is being prepared.

Do not run full migration verification for ordinary feature work.

## Codex reasoning policy

- **LOW** — repository housekeeping, documentation, and trivial fixes.
- **MEDIUM** — standard UI and CRUD work.
- **HIGH** — substantial features, trusted Functions, PDF, registration transactions, and scoring.
- **XHIGH** — architecture or security redesign, a serious production incident, or major migration redesign.

Choose the lowest level appropriate to the risk and ambiguity of the task. Under the owner-directed coordination policy agreed on 2026-10-12, worker agents use LOW, MEDIUM, or HIGH; XHIGH, MAX, and ULTRA are reserved for the lead. The owner's preferred lead setting is GPT-6 Astra Ultra or GPT-6.1 Sol Ultra. This is a preference, not evidence of the model actually selected in a chat; the lead must not claim to have changed its own setting without tool confirmation.

## Coordinated agent development

The lead owns priorities, architecture decisions, task assignment, review, integration, and release preparation. The owner communicates with the lead rather than supervising individual workers. See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) for the dated baseline, current evidence, and next work.

- Start workers with an explicit model and reasoning effort. Default to GPT-6.1 Sol MEDIUM for normal implementation and bounded audits; use LOW for small documentation work and HIGH for trusted Functions or complex security work. Workers do not independently increase their effort or create more workers.
- Give every task an exact base commit, objective, owned files or isolated worktree, dependencies, forbidden operations, acceptance criteria, and required checks. A branch name alone is not an implementation baseline.
- Begin an uncertain or resumed project with read-only inspection. Distinguish code already implemented, code integrated into `main`, code tested at a particular SHA, and code actually deployed. Do not infer any one of these from another.
- Keep concurrent writes in separate worktrees or explicitly disjoint files. The lead performs integrations serially and preserves existing user work. Workers report conflicts rather than resolving ownership by overwriting another worker.
- Workers may perform their assigned local edits and checks. They may not deploy, access production, send real email, push, merge remote PRs, delete user data, or change unrelated files unless the lead passes through the necessary user authorization and explicitly assigns that action.
- A worker returns changed files, the behavior fixed, exact checks and results, and remaining limits. The lead reviews the diff and rejects stale, unverified, or out-of-scope conclusions before accepting the task.
- Merge through the existing PR workflow after the applicable checks. Agent completion is not a release approval. Cloud deployment still requires explicit owner approval in the current conversation under `AGENTS.md`, with the exact target and candidate prepared for review first.
- Scale concurrency to the available slots and independent work. Do not create an indefinite monitor or claim unattended background work unless an appropriate automation has actually been configured at the owner's request.

## Worktree convention

Store future isolated worktrees under `C:\Projects\filmovy-kviz-worktrees\`, for example:

- `C:\Projects\filmovy-kviz-worktrees\pdf`
- `C:\Projects\filmovy-kviz-worktrees\registrations`
- `C:\Projects\filmovy-kviz-worktrees\scoring`

Create a worktree only when its task starts. Do not commit local data, credentials, browser profiles, emulator exports, private screenshots, or production configuration.
