# AGENTS.md

## Scope and safe local development

JustKvíz is a quiz authoring, registration, scoring and presentation application. Existing production systems and live data are outside autonomous development scope.

- Local source changes, isolated tests and reversible local commits are allowed. Use a dedicated branch and preserve existing dirty work.
- Public push, pull requests, merge, deployment, cloud writes, IAM, secrets and real emails require explicit approval for the concrete action. Historical approvals or release reports are not authorization.
- Never commit secrets, credentials, environment files, personal or live data, private exports or internal operational records. Keep coordinator memory and evidence outside this public branch.
- Use explicit demo-* Firebase projects and loopback emulator endpoints. Seed scripts must fail closed before SDK initialization.
- Require current active server-managed membership, concrete permissions and matching resource scope. Role labels and legacy Auth claims grant no implicit authority.
- Never send unrevealed answers, private notes or team contacts to public/projector clients. Treat browser input as untrusted.
- Read architecture, data-model and security documentation before changing boundaries. Run pnpm check and relevant tests; authorization/Rules changes additionally require demo emulator Rules tests.
- Coordinate disjoint file ownership for implementation and independent read-only QA/security review. Preserve meaningful tests, reproduce real defects, and distinguish emulator/browser evidence from physical or live-cloud acceptance.
- Select the next feasible product task after each completed task. Skip unchanged completed work, record actual blocked inputs privately and continue independent work. Public source history must remain free of private automation, chat, worktree or claim records.

## Layout

apps/web contains the React/Vite client; functions contains the trusted Firebase boundary; packages contains shared domain modules. Public technical contracts are in docs.
