# Email activation retry compatibility — 2026-10-13

Verified source commit: `4c99181441c2037e00ca6e4f111606c7b4348a52`, based on `422f3cbdde64cb68aa9a6ead08fd01619a71dde0`. This local fix does not activate cloud email or change the deployed frozen application.

## Problem and fix

A create receipt saved while cloud email is disabled has no token envelope. Future activation of the vault path must still replay that historical registration without creating another team/message. The callable now treats an absent historical envelope as the existing fallback path; a present malformed envelope still fails closed. Matching retry capability/payload and the existing management-token verifier remain required. The regression checks exact recovered identity/token, unchanged persisted documents/updateTimes, changed-payload denial and malformed-envelope rejection.

MEDIUM source review PASS covered callable SHA `329da815…` and test SHA `2ad7931d…`. The lead ran the local checks; this record independently matches current source bytes and all three retained log hashes without rerunning tests.

## Actual local evidence

Receipt: `.local-data/final-operational-readiness/email-retry-FSiwOm/verification.json`, mode `LOCAL_EMAIL_RETRY_VERIFICATION_PASS`, at `2026-10-13T10:23:52.637Z`; SHA256 `cc6c1ee66f84596dcecdee2ea029b397e07090ae2598c46a12268a79f827eb84`.

| Check | Result |
| --- | --- |
| `pnpm check` | PASS; build/check completed |
| `pnpm test:rules` | 50 PASS; emulator command exit 0 |
| Registration email runtime | Nine PASS phases; emulator command exit 0, including pre-activation receipt compatibility and existing delivery/retry/security contracts |

| Bound file (logs relative to receipt directory) | SHA256 |
| --- | --- |
| `functions/src/registrations/callables.ts` | `329da8153c82f94716d296db10f796c116d194ee5d237eabae4c009fcf474f56` |
| `tests/e2e/registration-email-emulator.mjs` | `2ad7931de8994643c623d8918951882fdfb5d29642620dbae98742c16959b729` |
| `firestore.rules` (unchanged) | `58d1f6e57f9fb72a12806839670a01b36812cf5eda708ba59eceaff92310b8e5` |
| `check.log` | `8b0e811963dc25a2ec3338d0f1218e3e5ad19a53542ed159e12c7440084828ff` |
| `rules.log` | `e66a4672cd2d618e1f529df5af2c7be7235ed32b00a2ed0bcc331ac504011741` |
| `registration-email.log` | `7707d3f3b6e5eb490a55cbb3a8c1c0a2b9a0434a0c5127156e509a9f12d92df0` |

## Limits

The regression reproduces the pre-activation persisted shape in synthetic demo emulators; it is not real-data migration or cloud activation. Current cloud callables still select no email vault and cloud intent enqueue stays disabled. No new remote CI, artifact deployment, OAuth provisioning or real email occurred. Fake-provider success is not inbox-delivery evidence. Future activation retains the coordinated code/configuration and sender prerequisites in [TRANSACTIONAL_EMAIL.md](TRANSACTIONAL_EMAIL.md), [GMAIL_DELIVERY.md](GMAIL_DELIVERY.md) and [readiness](FINAL_LAUNCH_READINESS.md).
