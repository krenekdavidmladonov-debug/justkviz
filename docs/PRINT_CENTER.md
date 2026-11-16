# PDF Print Center

Status: **IMPLEMENTED** for immutable event snapshots.

The admin route `/admin/events/:eventId/print` offers team sheets, a private answer key, and a manual score table. An event must have a locked `quizAssignment.snapshotId`; mutable source quizzes are never a print source.

## Architecture

`private quizSnapshot → trusted mapper → typed print model → deterministic renderer`

The typed model is `PrintEvent`, `PrintQuiz`, `PrintRound`, `PrintQuestion`, `PrintTeam`, and `PrintOptions`. The mapper keeps only print-relevant fields. The renderer is pure and cannot read Firestore.

`generatePrintArtifact` is an authenticated binary HTTPS Function. The browser sends only the event ID, artifact type, disposition, team-sheet mode, and synthetic team names. It receives `application/pdf` with `Cache-Control: no-store` and inline/attachment `Content-Disposition`. Preview, download, and print reuse one Blob URL; replaced and unmounted previews revoke it.

## Engine and layout

The renderer uses `pdf-lib` with `@pdf-lib/fontkit`. Noto Sans Latin Extended regular/bold WOFF files are embedded and subsetted for repeatable Czech Unicode output. Noto Sans is licensed under SIL Open Font License 1.1. Fixed metadata, stable sorting, explicit A4 dimensions, deterministic wrapping, and fixed pagination produce stable bytes for equal input.

- Team sheets: generic, one team, or 1–30 accepted teams in one PDF; no answers or private content. A landscape A4 holds two A5 panels. Each round stays wholly on one side, using adaptive rows, fonts of at least 8 points, and two columns when needed. The all-team PDF adds exactly one universal blank-name reserve panel with a writable round number and enough numbered answer lines for the largest round; spare half-pages remain blank. Generic and single-team modes retain duplicate panels. Organizer panels omit Team/Table fields. Impossible single-side layouts return a layout-limit error.
- Answer key: question number and canonical answer; Choice adds the option letter.
- Score table: 1–30 teams, half-point guidance, repeated headers, landscape beyond five rounds, and horizontal/vertical pagination.

Server limits: 30 teams, 30 rounds, 500 questions, 800 slides, 200 pages, 10 MiB output, 32 KiB request, and a 15-second renderer deadline inside a 30-second Function timeout.

Registrations, persisted team binding, automatic scoring, and answer-sheet ingestion are not part of this version.
