# V0.3 roadmap

This is a historical V0.3 planning baseline, not the current backlog or a current completion percentage. Use [the completion matrix](COMPLETION_MATRIX.md) and [current development status](DEVELOPMENT_STATUS.md) for remaining work and exact evidence.

The planned PDF, registration, referee/scoring, ranking/history, owned media, JustKvíz branding, staging and local restart foundations below have since been implemented and verified within their documented scopes. The bounded staging registration-email deployment and one owner-confirmed delivery also completed on 2026-10-14; its queue remains paused. These results do not authorize general email dispatch, production migration or a public launch. Physical venue acceptance remains separate.

## Historical baseline

## Implemented

- Auth and admin/moderator roles
- Quiz Library
- lossless V1 migration
- round-first Editor
- Preflight and guided repair
- live moderator
- Projector
- audio/video lifecycle
- authoritative Recap
- Events Foundation
- immutable event quiz snapshots
- sanitized `publicEvents`
- local QA and event-night tooling

## Next

1. PDF Print Center
2. Registrations
3. registration-to-PDF integration
4. Referee and scoring
5. leaderboard and final results
6. email
7. media ownership and Storage
8. offline hardening
9. staging and production preparation
10. rebrand and domain

The next feature is **PDF Print Center**. It must keep answer keys private, omit contacts and answers from team sheets, and use the event's immutable quiz snapshot.

## Deferred and not implemented

- The current PDF foundation branch is not part of this baseline until separately reviewed and integrated.
- Registration, transactional capacity enforcement, team-to-PDF binding, referee workflow, scoring, half-points, dense ranking, leaderboard, and final results remain future implementation.
- Emailing, Storage/media ownership, and offline hardening remain deferred until the event workflow is complete.
- Staging, production deployment, rebrand, domain changes, and any V1 change remain deferred.
- Waitlist support is out of scope; registration must enforce both team and person capacity, with email as the only required contact.
- Research and QA branches are evidence or discovery inputs, not production implementation.
