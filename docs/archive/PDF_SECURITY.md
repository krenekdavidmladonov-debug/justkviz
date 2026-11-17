# PDF Print Center security

PDF generation is a trusted server operation over a private immutable event snapshot.

## Authorization

| Actor | Team sheets | Answer key | Score table |
|---|---:|---:|---:|
| Admin | Allow | Allow | Allow |
| Moderator | Allow | Deny | Allow |
| Ordinary authenticated | Deny | Deny | Deny |
| Anonymous / projector | Deny | Deny | Deny |

The HTTPS Function verifies the Firebase ID token and its server-managed role claim. Direct browser writes to events and snapshots remain denied by Firestore Rules. An unlocked event fails closed.

## Data minimization

The request schema is an exact allowlist. Browsers cannot send correct answers, options, contacts, media sources, notes, raw legacy data, snapshot IDs, or arbitrary print content. The server resolves the snapshot ID from the private event.

The trusted mapper drops prompts, media URLs/IDs, moderator notes, `legacy.raw`, contacts, and internal document IDs. Answer data exists only in the private print model needed by the answer-key renderer; team sheets and score tables never draw it. Logs contain only artifact type and aggregate round, question, team, page, and duration counts.

Responses use `no-store`, `nosniff`, a PDF content type, and a bounded binary body. Exact-key validation, text normalization, control/bidi rejection, duplicate-team rejection, page/byte/request limits, and timeouts bound attacker-controlled work.

Local QA uses only `demo-*` emulators and synthetic content. `.local-data/pdf-qa/` is ignored and never committed. No production credentials, V1 data, media identifiers, or contacts are used.
