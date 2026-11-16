# Event team tools

Built on `b13322b` (staging PR #11 and form UX PR #12; not merged by this task).

## Manual teams

`adminAddEventTeam` and `adminUpdateEventTeam` are admin-only callables. They use the canonical private `events/{id}/registrations` records, the existing normalized-name reservations and event capacity counters in one transaction. Direct writes and roles are unchanged.

Manual records carry server-owned `source: manual`, `createdBy`, `updatedBy`, a nullable contact email and **null managementTokenHash**. They have no Auth account or bearer management link. Public operations still require a valid token and required email/window; caller-supplied source/actor does not grant authority. Old online records without a source remain Online and work unchanged.

The add request ID is scoped to the staff UID and event. Its deterministic registration ID and immutable normalized-payload fingerprint survive edits and cancellation. Identical replay returns the existing record, even if cancelled; changed payload with the same ID is rejected. Updating requires the current manual record revision. Existing admin cancellation releases capacity/name without deletion.

Manual add/edit is allowed for draft, scheduled, ready and live events, independently of the public registration window or immutable quiz lock. Finalizing/completed/cancelled/archived and unknown lifecycle states fail closed. No separate roster lock exists in the current implementation; this feature introduces neither scoring nor a roster-lock bypass.

One shared dialog is used from event detail and registrations. Errors retain inputs and the same add request ID; an in-flight latch prevents duplicate submit. Success is server-confirmed; the registrations row is highlighted. The details page preserves unsaved event form values when refreshing capacity.

## Sharing and QR

The top-of-page panel links only to `/events/{eventId}`. Cloud origin is the exact configured V2 staging origin, while demo emulator use is restricted to localhost origins. It never copies admin/management links. The availability/window/capacity display follows current registration rules; share actions perform no writes and do not publish/open registrations.

The local `qrcode` library generates PNG and SVG with opaque white background and a four-module margin. Clipboard failure offers selected text for manual copy. Both formats are decoded in targeted browser tests. No external QR service, redirects, referee QR, or poster feature is involved.

## PDF and compatibility

The frontend registration mapper accepts null/missing email only for manual records. The existing trusted PrintTeam adapter still exposes **only ID and name** of accepted registrations. Single/all team sheets and the score table consume the current roster. Cancelled records are omitted. Already downloaded files do not update automatically. The PDF engine and quiz/snapshot/migration contracts are unchanged.

## Delivery

Only `functions:adminAddEventTeam,functions:adminUpdateEventTeam` may be deployed through `tools/staging/deploy.mjs filmovy-kviz-v2-staging --team-tools-functions`. The fixed mode rejects scope overrides, other targets, hooks and backend Hosting rewrites. Backend goes first, followed by existing guarded `--hosting-only` for the same verified commit.

No other Functions, Rules, indexes, Auth configuration, Storage, billing, DNS, production or V1 deploy is required. Online QA must use one dedicated synthetic event and cancel/archive only that event through the existing workflow.

Validation: targeted registration/QR unit tests, team-tools emulator tests (including real PDFs), relevant Rules tests, two browser viewports, one final `pnpm check`, CI and dedicated staging smoke. Full V1 migration is not rerun: quiz schema and migration contracts are out of scope.
