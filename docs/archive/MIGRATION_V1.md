# V1 library migration

## Cloud extension (version 2)

The existing pipeline now has an explicit, separately guarded staging path. See [CLOUD_IMPORT.md](../tools/migration-v1/CLOUD_IMPORT.md) for allowlists, read-only source credentials, immutable artifacts, dry-run, create-only writes and incomplete-import recovery. No real cloud migration is performed by development or CI. The emulator commands below retain their original safety guards.

## Scope and safety

The tool migrates only V1 `library` documents into the private V2 model. The original emulator workflow does not read a remote Firebase project. The explicit cloud extension reads only library content and creates private staging copies; neither workflow deploys, migrates events/registrations/live state, downloads media, or creates public/projector documents. Managed export bytes, extracted JSON, and detailed inventories remain under Git-ignored `.local-data/`.

Emulator extraction and writing fail closed unless `FIRESTORE_EMULATOR_HOST` is an exact local host and port and the project ID begins with `demo-`. The writer also requires an empty dedicated emulator target.

## Managed export format and extraction

A managed Firestore export is not JSON. The overall and collection metadata are protocol-buffer records and the data files are LevelDB logs. Firebase CLI can import that supported format directly into the Firestore Emulator; the repository does not contain a guessed binary parser.

The preserved layout is:

```text
.local-data/v1-managed-export/<export-id>/
├── <export-id>.overall_export_metadata
└── all_namespaces/all_kinds/
    ├── all_namespaces_all_kinds.export_metadata
    └── output-0
```

After confirming SHA-256 equality with the untouched source files, import the directory into a temporary `demo-*` emulator and extract only `library`:

```powershell
firebase emulators:exec --only firestore --project demo-filmovy-kviz-v1-import --import ".local-data/v1-managed-export/<export-id>" "pnpm migration:v1:extract"
pnpm migration:v1:inventory
```

`migration:v1:extract` queries only the `library` collection and atomically writes `.local-data/v1-export/library.json`. It prints only a document count. `migration:v1:inventory` writes a local structural inventory without question text, answers, notes, options values, contacts, or raw documents.

References:

- [Google Cloud Firestore export format and metadata files](https://cloud.google.com/firestore/docs/manage-data/export-import#export_format_and_metadata_files)
- [Firebase Local Emulator import/export](https://firebase.google.com/docs/emulator-suite/install_and_configure#export_and_import_emulator_data)

## Extraction contract

The JSON adapter accepts schema version 1 and `collection: "library"`. Each document has an `id` and `data`. It supports the observed nested `data.quiz` array and the legacy-compatible top-level keys `slides`, `quiz`, `items`, or `questions`. Unmapped quiz metadata is preserved privately.

## Mapping

- One library document becomes a private draft at `quizzes/{quizId}`.
- Every V1 slide becomes `quizzes/{quizId}/slides/{slideId}` in global source order. This preserves intro, agenda, recap, end, and other non-question content.
- Non-empty `roundHeader` transitions define rounds. Explicit round-marker slides are supported. Prelude/outro segments with no questions do not create empty rounds.
- Question-like slides also become ordered `rounds/{roundId}/questions/{questionId}` documents.
- V1 question/free types map to `text`; image to `image`; audio to `audio`; video to native `video`.
- The observed `pl` type is retained as a private `legacy` question because its product meaning is not established.
- `correct` and `correctAnswer` map to private `correctAnswer`. The first non-empty variant is used; conflicting non-empty variants fail closed.
- Options, moderator notes, images, audio/video references, answer/background images, timing, trigger, overlays, source numbering, and recap overrides are preserved.
- Supported source fields are projected through an explicit allowlist into private `legacy.raw` and `legacy.metadata`. Unknown fields are excluded; unsupported structured content and unknown cloud slide types block rather than being guessed.

External media is classified and validated as a reference only. No network download or Storage write occurs.

## Validation and write behavior

Validation compares quiz/slide/round/question counts, ordering, answer presence and exact values, canonical allowlisted legacy records, mapped prompt/options/media/presentation fields, source positions, and aggregate media counts. Any mismatch aborts before WRITE.

Each quiz is written in one Firestore batch and must remain below the 500-document batch limit. The set of quizzes is not globally atomic, so a failed multi-quiz run must be discarded by restarting a fresh emulator. A preflight refuses any target that already contains quiz, slide, round, or question migration data. The independent verifier reads the emulator back and compares IDs, order, correct answers, and media.

```powershell
pnpm migration:v1:inspect
pnpm migration:v1:validate
pnpm migration:v1:dry-run

firebase emulators:exec --only firestore --project demo-filmovy-kviz-v2-migration `
  "pnpm migration:v1:emulator && pnpm migration:v1:verify-emulator"
```

The three read-only commands default to `.local-data/v1-export/library.json`. An alternate input is accepted only inside `.local-data/`.

## Explicitly excluded

- `events`, `registrations`, teams, emails, and phone numbers
- `activeScores`, active quiz/live state, and public projector state
- media bytes and Storage objects
- production configuration, credentials, writes, and deployment
