# V1 migration report

## Result

Status: **PASS** for extraction, structural inventory, validation, dry-run, emulator write, and independent emulator read-back. No production Firebase service was contacted and nothing was deployed.

The managed export consisted of one consistent three-file set. All three reconstructed copies matched their untouched sources by byte length and SHA-256. The originals and all derived data remain under Git-ignored `.local-data/`.

## Sanitized inventory

| Metric | V1 before | V2 after |
|---|---:|---:|
| Quizzes | 4 | 4 |
| Slides | 315 | 315 |
| Rounds | 23 | 23 |
| Questions | 263 | 263 |
| Non-empty correct answers | 263 | 263 |
| Image references | 56 | 56 |
| Audio references | 52 | 52 |
| Video references | 46 | 46 |

Anonymized per-quiz distributions were `88/6/74`, `91/6/79`, `63/5/50`, and `73/6/60` for slides/rounds/questions. No title, document ID, question, answer, note, option value, contact, media URL/domain, or raw record is included in this committed report.

### Slide types

| V1 type | Count | Status | V2 handling |
|---|---:|---|---|
| `agenda` | 2 | KNOWN | private content slide |
| `audio` | 52 | KNOWN | audio question |
| `end` | 2 | KNOWN | private content slide |
| `free` | 50 | KNOWN | text question |
| `image` | 30 | KNOWN | image question |
| `intro` | 25 | KNOWN | private content slide / round presentation |
| `pl` | 11 | PARTIALLY MAPPED | private locked Pravda / Lež question with full raw preservation |
| `question` | 74 | KNOWN | text question |
| `recap` | 23 | KNOWN | private content slide |
| `video` | 46 | KNOWN | video question |

There were no UNKNOWN slide types. Migration originally kept `pl` unresolved and lossless rather than guessing. The later editor product contract confirmed **Pravda / Lež** presentation while retaining its legacy-only, non-creatable storage mapping.

### Observed fields

All 315 slides used the core fields `audioTrigger`, `correct`, `mediaRaw`, `note`, `options`, `qCount`, `roundHeader`, `text`, `title`, `type`, `videoStart`, and `videoEnd`. Other observed counts were: `bgImage` 252, `bgOverlay` 252, `bgRaw` 63, `media` 99, `optionsStr` 87, `id` 63, `answerImg` 6, `answerOverlay` 4, and `recapOverrides` 1.

Known fields were mapped to native private fields where their meaning was clear. `bgRaw`, legacy `id`, and `recapOverrides` are PARTIALLY MAPPED and retained in `legacy.raw` even when a useful presentation copy is also made. There were no UNKNOWN field names in this export.

`correct` was present as a string on all slides and non-empty on exactly 263 question slides. `correctAnswer` did not occur in this export, but synthetic regression tests cover correctAnswer-only, empty/non-empty fallback, and conflicting non-empty variants. Conflict fails closed without logging either value.

Options arrays had lengths 0 (245 slides), 4 (68), 5 (1), and 6 (1); all 283 option values were strings. Timing, trigger, and overlay fields included both numbers and numeric strings and are normalized while their original values remain in `legacy.raw`.

## Media

The migration preserved 154 classified media references: 56 image, 52 audio, and 46 video. Sources included background image, answer image, raw media reference, and nested media source fields. Matching prompt references are deduplicated without deleting the raw record. No invalid external media URL was detected. Media bytes were not downloaded or copied.

## Correctness and data-loss controls

- Every one of the 315 source slides has a private ordered V2 slide record with canonical `legacy.raw`.
- All 263 question records preserve their exact private correct-answer value.
- Validation independently compares mapped prompt, options, media values/roles/URLs, presentation controls, source positions, and raw records.
- Content-only prelude/outro segments are preserved without manufacturing questions or empty rounds.
- Round boundaries are derived from observed header transitions; explicit markers and roundless input have synthetic tests.
- Unknown future types/fields fall back to private legacy preservation; malformed slides, timing ranges, answer conflicts, and count/mapping mismatches fail closed.

Data-loss status: **no known data loss**.

## Emulator verification

The migration wrote only to a fresh local Firestore Emulator using a `demo-*` project ID. Independent read-back verified 4 quizzes, 315 slides, 23 rounds, 263 questions, all 263 correct answers, and all 154 media references. The writer rejects remote hosts, non-demo project IDs, malformed local host strings, non-empty migration targets, and any quiz exceeding the atomic batch limit.

## Architectural audit

Two small, unambiguous V2 extensions were implemented: a private global slide stream for lossless presentation order, and native `video` question type support. Existing private rounds/questions remain suitable for the current admin library and future scoring.

Larger product choices were deliberately not guessed: the native meaning of `pl`, scoring semantics, media ingestion/ownership, editor behavior, and the trusted projector publication state machine. Before projector work, a Function must generate a sanitized public document and include answer data only after an authorized reveal.
