# Synthetic event-night restart acceptance

This checks actual local Auth, Firestore and Storage export/import, plus continued revisioned scoring through the existing Functions boundary. It never reads or overwrites the operator's `.local-data/event-night/`, migrated V1 exports or existing snapshots.

## Run

Build the current domain and Functions sources first, using Node 22 and Java 21 on PATH:

```powershell
pnpm --filter @filmovy-kviz/functions... build
node --test tools/event-night/restart-acceptance.test.mjs
node tools/event-night/restart-acceptance.mjs --powershell C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
```

On Linux, pass the absolute installed `pwsh` executable instead. Reserve these loopback ports exclusively for the acceptance: Auth 9399, Functions 5301, Firestore 8380, Storage 9398, Emulator Hub 4503 and Logging 4603. There is no Hosting or Emulator UI in this profile. Port conflicts fail before starting another Suite.

The harness creates one unique `.local-data/en-restart/run-*` and one `demo-restart-*` project. The short directory keeps actual Firestore backup paths within Windows PowerShell 5 limits. Each Suite runs through pinned Firebase CLI 15.28.2 `emulators:exec`, which shuts down its own processes when its script completes. The child environment excludes credential overrides, pins `CLOUDSDK_CONFIG`, `APPDATA` and `XDG_CONFIG_HOME` to an empty owned CLI configuration directory, removes inherited `HOME`/`CLOUD_RUNTIME_CONFIG`, and loads an HTTP/fetch guard that rejects non-loopback destinations, including telemetry. Missing cached emulator binaries therefore fail rather than downloading. The isolated Functions runtime copies only `lib` and `package.json`, with a local link to installed `node_modules`; no existing `.env*` or `.runtimeconfig.json` files are copied or read. The CLI may materialize its own demo parameter defaults in that runtime. Rules and indexes are copied into the isolated CLI project because Firebase CLI rejects rules paths outside its project directory. These copies use the exact current bytes.

## Actual sequence

1. Start a fresh isolated Suite; use existing demo-only synthetic Auth and quiz seeds. Create one event, one contact-free manual team and an immutable snapshot through the normal callables. Save score revision 1, plus a small synthetic Storage object, and capture all private synthetic Firestore documents and safe Auth identity fields.
2. Export Auth/Firestore/Storage through `firebase emulators:export` to a new checkpoint. Exit the script, wait for the CLI Suite to stop and confirm the assigned ports are free. Record every checkpoint file's SHA-256.
3. Start a new Suite with `--import` from that checkpoint, without seeding. Before login, verify the exact Firestore content, Auth identities and Storage bytes/metadata. Sign in again; verify the persisted original score receipt, save revision 2 and reject a stale score mutation. Export a second checkpoint and stop.
4. Copy only these two owned exports into a synthetic repository. Use the existing `Promote-EventNightSnapshot` with a fault immediately after the real canonical-to-backup rename. Use `Restore-EventNightSnapshot` twice; verify the exact prior contents and unchanged retained backup bytes.
5. Start a third Suite importing that restored prior checkpoint. Verify its contents and persisted receipt again, then demonstrate scoring continuation from revision 1 to 2 with stale-CAS rejection. Stop after a new owned export.

All data and logs remain in the unique run directory for audit; no automatic cleanup or broad process termination is used. An unsuccessful run remains unsuccessful: there is no reset/retry that turns an ambiguous mutation into a claimed pass. A new invocation creates another separate synthetic run.

## Evidence and limits

Only `acceptance-result.json` with `SYNTHETIC_EVENT_NIGHT_RESTART_RECOVERY_PASS` confirms the whole sequence. It binds helper/recovery/seed source hashes, exported checkpoint hashes and the three phase results; the plan also records the Functions/domain build hashes, which must remain unchanged. The source must have been built before running: a hash alone does not establish that compiled code corresponds to current TypeScript.

The restored checkpoint deliberately precedes the second score change. This proves recovery of the last known-good checkpoint and the ability to continue; changes after that checkpoint must be entered again. The simulated interruption is a caught exception after an actual rename. It is not an OS crash, power-loss, disk-durability, browser, fixed-port launcher or real-venue rehearsal certification. Existing promotion guard tests cover malformed journals, corruption and path escapes separately. Do not substitute this synthetic result for an operator's own checkpoint and venue rehearsal.

## Observed acceptance — 2026-10-13

At source base `4a71cf0a1bf36d5e782a1327db58acb7d011091d`, the final isolated run `.local-data/en-restart/run-jBrlMA` completed at `2026-10-13T10:10:47.458Z` with `SYNTHETIC_EVENT_NIGHT_RESTART_RECOVERY_PASS`, exit 0, on `demo-restart-900d0c0b03b5`. All three Suite phases passed; the two imports verified exact synthetic content, persisted score receipts, continued scoring to revision 2 and stale-CAS rejection. Windows PowerShell 5 performed the actual interrupted renames and idempotent recovery with retained backup identity. Each Suite released the six assigned ports. Earlier unsuccessful runs remain retained and are not counted as passing evidence.

The final 13 offline guard tests, Node 22 syntax check and targeted ESLint passed. The initial sandbox could not create a junction; the actual junction regression passed with normal local permissions. Domain/Functions had been built by the lead before the run; the run checked their unchanged build hashes. The helper and test remained frozen through the successful run. No existing event-night snapshot or root `.env` contents were used.

SHA-256 bindings:

| Input/evidence | SHA-256 |
| --- | --- |
| `tools/event-night/restart-acceptance.mjs` | `5486b9e1f70cd540b0146df1c7b8b05fdeb3da6182ccd3a3ba44ebb7b3e5b62f` |
| `tools/event-night/restart-acceptance.test.mjs` | `e49158b0845798e5616f97de060b59baf0117e3d981ab32af6978308dd36a1d4` |
| `acceptance-result.json` | `6b50059cfa2d82271e10646b64091255e228dfcb9b17ee0a68e74976b542b7ce` |
| `plan.json` | `7466fd5eb38baa4598b9004f6a76e7d10309e273fb7d0df66392269a3b7a3b3c` |
| `fresh-suite.log` | `e253a66fd9cd6353fac351a5f92a0fae561afffc56b416285cfe9d2124d66ed1` |
| `fresh-export.log` | `10bfd54f43baf761765e15d6702fdbc24cdd018246a5ac2b7ee3c9355f900fcd` |
| `restart-suite.log` | `0e829d89feeaca7f7163879914daf05dc86d00b380dd9e1c95f5fde2fcc8c9c5` |
| `restart-export.log` | `97c02b1e77d96b742f4053b6d24f1096d0fd211248f9e66160f0fd1296faa391` |
| `recovered-suite.log` | `81e7ef3af04cfa1a9d6e2099dbad6abe804cbe5b9499e814d407f8f49307faf9` |
| `recovered-export.log` | `8da045b09377837068e89cc55422e6193db0cec51cc33076e72c274265890313` |
| `sandbox/recovery-result.json` | `9a8300b80f4a1d85c7abb4da641ec456e4008050fac824e41c96bd34a21df4cf` |
| Generated `recover.ps1` | `8291ea0edea7421c0f1a9308dc75247b52c66d9977e9db4b0485b044fa54f5a7` |

Evidence names without a repository prefix are relative to the retained run directory. Recovery emitted no console output, so there is no `recovery.log` for the passing run; the result and generated script are bound above. This result closes the synthetic persistence/restart/recovery check, with the venue and power-loss limits stated above.
