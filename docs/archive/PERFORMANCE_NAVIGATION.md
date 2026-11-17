# Admin navigation performance — stage 3A

The first visit to an admin route previously loaded its component through React.lazy/Suspense. In the production baseline, the library module finished at click +19 ms, but its mounting effect started the data request at +320 ms. React's fallback transition delayed the read even though the code was available.

Admin pages now use React Router route.lazy. The old page stays mounted while its destination module loads; RequireStaff announces the pending navigation through a fixed, accessible status. The router commits the destination when its module is ready, and its normal data-loading UI takes over. A cold admin deep link has an initial fallback. RequireStaff and every existing PermissionGate remain in place; importing a module does not mount private content. Server authorization is unchanged.

Event detail loads its own record independently of the optional quiz picker. It reads the library and selected source only when the current event permits quiz selection: all existing permissions, operational disposition/lifecycle, no live session, and scoring not started. A slow or failed library no longer hides the event. The picker has loading/error/retry feedback; preflight and warning confirmation still govern snapshot preparation. Obsolete event/library responses are ignored after navigation.

## Measured result

17 September 2026; base db0c6f70ec14356bdeae8cb12d3709cbd632eb4f. Production Vite builds, Chromium 1440×1000, local demo Auth/Firestore/Functions, synthetic 18-question/3-round and 180-question/12-round quizzes, four teams. Click capture to the usable target DOM plus the next animation frame, with identical readiness conditions before and after. Each main row is the median of three runs.

| Interaction | Before (ms) | After (ms) | Before +150 ms/call | After +150 ms/call |
| --- | ---: | ---: | ---: | ---: |
| Overview → library | 381 | 80 | 531 | 231 |
| Quiz detail → editor (18 questions) | 399 | 99 | 564 | 266 |
| Overview → events | 380 | 81 | 531 | 233 |
| Events → event detail | 98 | 96 | 264 | 247 |
| Event detail → teams | 98 | 97 | 248 | 249 |
| Event detail → scoring | 164 | 166 | 498 | 483 |

The new library trace starts readAccessData at +18 ms, after the module completes at +8 ms. Immediate feedback remains about 13–16 ms. The existing-session detail → live transition falls from 449 to 148 ms (three runs). Opening the 180-question editor falls from 424 to 115 ms; question selection stays about 32 ms with zero calls.

For an event with an existing live session, the detail trace changes from event + quizzes + editor + listRefereeAccess to event + listRefereeAccess. This reduces unnecessary data transfer; its already-fast critical path is largely unchanged.

Limitations: these are local comparisons, not staging/WAN timings or an SLA. A 150 ms delay is injected per callable, not a network simulation. The new run has first-use endpoint outliers (save 1,863 ms, teams 2,115 ms, projector 1,665 ms); they remain in the raw data. Save median is 197 vs 164 ms locally and 513 vs 497 ms with added latency; this stage does not optimize saving. Projector median is 148 ms across nine samples, vs the prior precise 147 ms. Cold browser /admin observed-ready time is 264 vs 261 ms. Idle polling is unchanged: six scoring calls and three live snapshot calls per 6.5 seconds. Those costs need separate work with revocation/reconnect guarantees.

## Verification and evidence

- pnpm check: typecheck, lint, production builds pass.
- pnpm test:unit: 436 tests pass, including 16 new navigation/detail-loading regressions.
- pnpm test:rules: 50 tests pass against demo Firestore.
- Event form browser suite: six tests pass (create/edit/revisions, failure retention, read-only moderator, desktop/mobile widths).
- Historical results browser suite: two tests pass, including completed-detail navigation, reload, read-only scoped access and unchanged final data.
- Production comparison: 89 interaction samples, three cold browser loads, six idle observations. Desktop/mobile screenshots inspected; no browser errors or mobile horizontal overflow in the production visual check. The pending-navigation screenshot deliberately delays only the route module by one second to make the status observable; it is separate from timing samples.

Local reproducible evidence is in the main workspace's ignored .local-data/performance-navigation-evidence: baseline.mjs, baseline.json, summary.json, summarize.mjs, visual-check.mjs, screenshots and test logs. The original .local-data/performance-baseline remains intact. The harness uses the checked-in fail-closed emulator helper, blocks browser requests outside localhost, and seeds synthetic data only. Run it from this worktree with demo emulators running and its production build copied to the evidence dist: node tools/local-emulator-environment.mjs full ../performance-navigation-evidence/baseline.mjs. A full run replaces that directory's baseline.json; preserve it before rerunning. AUDIT_SUPPLEMENT=1 appends warm-navigation and live samples.

No Functions, rules, collections, private cache, polling interval or deployment configuration changes. No cloud deployment or migration. The candidate remains stacked on historical results; release requires review/integration of that dependency and separately approved Hosting deployment. Revert this change to restore the previous navigation behavior; no data rollback is needed.
