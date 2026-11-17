# Local event-night operation

This profile is a fail-closed, production-build local pilot. It uses only `demo-filmovy-kviz-v2` and loopback Firebase emulators. It never deploys and never seeds during normal start.

## One-time preparation

Run `PREPARE_EVENT_NIGHT.cmd` once from a clean release commit. It:

1. verifies Node 22, Java 21, pnpm, Git, and demo-only environment values;
2. selects the lowest-blocker migrated quiz without printing private values;
3. creates a production build tied to the exact Git HEAD and records file SHA-256 hashes;
4. starts fresh local emulators, seeds only the demo admin, migrates the four offline V1 quizzes, and performs independent read-back;
5. runs candidate login/readiness health through the Hosting Emulator;
6. exports a checksummed snapshot under `.local-data/event-night/emulator-data/` and stops its own worker.

It refuses to overwrite an existing snapshot. A reset is intentionally not exposed as an event operator command.

## Event use

- `START_EVENT_NIGHT.cmd` validates the build, HEAD, candidate, snapshot, checksums, and ports; creates a timestamped backup; imports the snapshot; runs browser health; and opens `http://localhost:5000/admin/login`.
- `BACKUP_EVENT_NIGHT.cmd` performs a live emulator export and promotes it only after checksum validation. A bounded recovery journal is persisted before the two directory renames; the prior snapshot is retained in `.local-data/event-night/backups/`.
- `STOP_EVENT_NIGHT.cmd` updates health, exports and validates current data, retains the previous known-good snapshot, then terminates only the identity-checked worker it owns.

After an interrupted promotion, normal start validates `.local-data/event-night/promotion-pending.json`. If the canonical snapshot is missing, it copies only the exact prior backup named in that journal into a unique temporary directory, verifies the manifest hash and snapshot checksums, then restores the canonical directory. The backup remains unchanged. If a valid canonical snapshot already exists, start keeps it and completes the journal after validating the prior evidence. Repeating recovery is safe. It never selects the newest backup or seeds empty data. Work performed after the most recent successful checkpoint may need to be repeated.

A missing canonical snapshot without a journal, invalid journals, missing or corrupt referenced backups, corrupt canonical snapshots, paths outside the event-night directory, and junctions or symbolic links fail closed. A valid canonical snapshot without a journal follows normal start. Preserve failed recovery directories for developer inspection. Preparation and further exports refuse a pending promotion, so they cannot reset or overwrite its recovery evidence. These checks recover process interruption during promotion; they do not certify storage hardware durability after power loss.

Keep the laptop awake and plugged in. Do not run development launchers on the same ports. Internet is still required for public YouTube playback, but the core application, local data, and launch flow do not depend on GitHub, Codex, or production Firebase during the event.
