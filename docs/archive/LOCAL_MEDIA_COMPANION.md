# Local media preparation

This is an opt-in replacement for the YouTube download stage of the existing
private Drive pipeline. It is prepared separately from activation; the deployed
cloud download test required provider sign-in while the same bounded source
worked from the owner's Windows computer. No browser cookies, proxy, CAPTCHA
solver, or Google credentials are supplied to the downloader.

## User workflow

The owner connects the Windows helper once with a short-lived code from Settings
→ Google Disk. The editor keeps its existing workflow: YouTube link, start/end,
Save. Only acknowledged saved content enters the import queue. Video and audio
wait for the paired computer; image backups retain the existing cloud worker.
The computer needs to be on and the helper running during preparation. Closing
the editor does not cancel a queued import. Already prepared media can be played
on other devices without the helper running.

The helper downloads and cuts the source with the same bounded worker used in
local verification, then sends only the finished MP4/MP3 to V2. The server checks
the bytes and current authorization, uploads to the private connected Drive
folder, and uses the existing atomic media attachment. Video playback uses the
existing native player and protected media gateway, including its audio track;
it does not mount a YouTube iframe for a ready Drive asset.

## Trust boundaries

The helper only makes outbound HTTPS requests to the fixed V2 endpoint. It opens
no local HTTP listener and receives no Drive refresh token, Firebase account
credential, quiz answers, contacts, arbitrary download URL or shell command.
The device capability is limited to bounded saved YouTube import jobs. It can be
revoked independently of the Drive connection. Pairing requires the current
verified owner with the existing concrete media/edit/read permissions.

Only a digest of the device capability is stored server-side. Windows protects
its local copy with current-user DPAPI. A pairing code is single-use and expires
after five minutes. Membership, session/Auth cutoff and Drive connection changes
invalidate the device. Every import transaction checks current authority and the
device grant, including final attachment after external IO.

Jobs reuse `driveMediaJobs` with an explicit local executor and expiring claim.
Source fingerprints, output digests and reserved Drive IDs retain the existing
idempotence contract. Expired or superseded claims cannot attach content; a
changed slide cannot be overwritten by an old result. The helper handles one
job at a time and retains identical prepared bytes for an ambiguous upload retry.
Failed jobs retain their original source for explicit retry. Pairing records,
device records, leases and jobs remain server-only under default-deny Rules.
Pairing creation, exchange and revocation write immutable access audit events
without codes or capabilities. A source changed away and back can be explicitly
retried; terminal failed jobs do not block other work in the queue.

Local output is untrusted. The endpoint accepts at most 25 MiB of raw binary,
checks its signature and probes the actual format, codecs, duration, stream count
and dimensions with a bounded, local-only FFprobe invocation. Client MIME,
duration or hashes never establish validity. The 25 MiB raw-body cap stays below
the second-generation [32 MB HTTP request limit](https://firebase.google.com/docs/functions/quotas).

## Release and rollback

The release adds `configureDriveMediaCompanion` and `driveMediaCompanion`, and
updates `requestDriveMediaImport`, `readDriveMediaImport`,
`processDriveMediaImport` and `readDriveConnection`, plus Hosting. It is enabled
only with `DRIVE_MEDIA_LOCAL_ENABLED=true` alongside the existing Drive/media
flags in the exact V2 environment. No new Google OAuth scope is required.
Only the binary receiver needs the existing Drive secrets and file access;
the Windows helper never receives them. The existing media gateway stays intact.

After local mode is enabled, legacy queued YouTube cloud tasks are acknowledged
without downloading. An explicit owner save/retry routes that saved source to
the helper. Photo tasks continue through the existing private queue. There is no
bulk import or silent replay of every existing quiz.

To stop new work, disable import requests and local processing, pause the media
queue, and stop/revoke the helper. Preserve media reads, ready assets, Drive files
and event snapshots. Reverting a ready media reference to YouTube automatically
is not part of rollback. Deployment and persistent startup registration require
the concrete owner-approved activation proposal; local preparation does not
change the live environment or V1.
