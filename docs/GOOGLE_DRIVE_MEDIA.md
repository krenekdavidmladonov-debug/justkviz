# Private Drive media

This extension is separately gated by `DRIVE_MEDIA_ENABLED=true` and the existing
Drive configuration. Source preparation is not deployment or activation approval.
Only the approved V2 project and `justkviz-v2.web.app` are eligible; V1 is excluded.

## Saved-slide workflow

The separately gated local mode moves YouTube preparation to the owner's paired
Windows computer while retaining this same job/attachment and Drive read model.
Photo imports continue on the server. Its pairing, untrusted-output validation,
offline behavior and release boundary are in
[LOCAL_MEDIA_COMPANION.md](LOCAL_MEDIA_COMPANION.md).

After an owner successfully saves a slide, the editor requests imports for a
YouTube video/audio interval and photo fields. Owned Storage photos and HTTPS
JPEG/PNG/WebP links are supported. Drafts never start an import. Failed partial
saves retain acknowledged slides until the next fully successful save. The
server derives sources from the saved private slide, not a submitted URL or
download command. Existing quizzes are not bulk migrated.

`requestDriveMediaImport` requires fresh verified Auth, an active owner membership,
`users.manage`, `quiz.media.upload`, `quiz.media.attach`, `quiz.edit`, `quiz.read`,
`quiz.answers.read`, and scope for the active quiz. A deterministic server-only
job includes the source fingerprint, member version, Auth/session cutoff,
connection revision/generation, account permission ID and folder. Enqueue failure
is retryable without another attachment. `readDriveMediaImport` returns only a
sanitized status and ready asset reference after the same authorization checks.

`processDriveMediaImport` is an IAM-private task Function with two concurrent
dispatches, one concurrent request per instance, 2 GiB memory, a 540-second
deadline and bounded retries. It repeats current authorization in every
transaction and checks the source and connection before external IO and final
attachment. Its 500-second lease expires before the first retry after a killed
540-second invocation. Processing leases are retried, never acknowledged as
successful completion. A reserved Drive file ID is persisted before upload;
retries verify identical bytes and metadata. A changed retry output fails closed.

After verified upload, a single transaction creates the immutable media asset,
changes only the saved field and normalized clip timing, updates an existing
derived question, increments the quiz revision and records an audit. A newer
field/source edit makes the job stale. Unrelated edits, answers, notes and counts
are preserved. Existing event snapshots and public/session documents are never
rewritten by imports. Failed jobs retain the original source. A file completed
just before cancellation can remain private and unattached; no destructive
cleanup runs.

Video output is MP4 H.264 with AAC sound; audio output is MP3. Maximum interval
is 180 seconds, source download 200 MiB, output 25 MiB and video dimensions 1280×720.
Only the selected interval is retained; saved playback times become 0–duration.
Recap uses the same interval. Private provenance preserves the original ID and
interval for audit; it is never a public answer hint. The editor shows progress
and retry; a safe refresh never discards typing. Closing the editor does not stop
the worker. Progress polling is local to the editor session; reopening does not
resume its old status display, but subsequent saved data contains ready assets.

## Storage and playback

Drive-backed ready assets retain the existing `quiz-asset:<quiz>/<asset>` reference
format. Metadata records `storageBackend: drive`, MIME/size, SHA256 and a stable
`drive:<sha256>` generation, plus private Drive owner/account/file binding and
source provenance. Files and their parent must remain private, owned by the
connected personal account and untrashed. Drive bytes are checked against stored
SHA256/MD5, exact size, MIME and metadata before returning them.

The existing `readQuizMedia` gateway checks the reader or exact currently revealed
public field both before and after IO. It never exposes a Drive token, file URL,
folder or source provenance. Public clients cannot request unrevealed answer
images. Byte ranges are served from the completely verified bounded object.
Browser playback uses a revocable Blob URL and native video/audio with the
existing one-player lifecycle. Direct browser video upload remains disallowed.
The gateway uses 512 MiB and at most two concurrent requests per instance,
bounding the overlapping verified 25 MiB downloads and their temporary buffers.

Disconnecting stops Drive reads; files remain in the account. Reconnecting the
same Google account preserves access to old immutable assets even if the current
upload folder changes. A different account cannot read them. Editing/sharing/
trashing a file outside the app invalidates verification; there is no silent
fallback to a potentially revealing YouTube player. Moving the quiz to Trash
does not delete media needed by existing event snapshots.

## Provider limits and local evidence

This is a separate downloader integration, not an official YouTube download API.
It does not use logged-in cookies, proxies, CAPTCHA solutions, access-control
bypasses or downloaded remote helper code. Use sources you are entitled to save;
YouTube restrictions can make individual imports fail. Local success does not
prove a YouTube request will succeed from Google Cloud's network.

`tools/media-worker/package-runtime.mjs` stages pinned, checksum-verified Linux
yt-dlp and FFmpeg binaries, worker code, licenses and a version manifest. It does
not deploy; production performs no runtime binary download. The reviewed local

Official references: [Drive file scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[YouTube developer policies](https://developers.google.com/youtube/terms/developer-policies),
[yt-dlp source](https://github.com/yt-dlp/yt-dlp),
[FFmpeg builds](https://github.com/BtbN/FFmpeg-Builds).

## Release boundary

New Functions: `createDriveMediaFolder`, `requestDriveMediaImport`,
`readDriveMediaImport`, `processDriveMediaImport`. Updated Functions:
`readDriveConnection`, `readQuizMedia`, `createQuizSlide`, `updateQuizSlide`,
`lockEventQuiz`, and `beginQuizMediaUpload` for explicit direct-video denial parity.
Hosting includes editor progress, folder recovery, native playback and updated
public Drive data-use information. No Rules/index changes, bulk migration,
e-mail actions or extra OAuth scope are required.

The worker/gateway need only the two existing Drive secrets, never Gmail secrets.
The import caller needs queue-enqueue/invocation permissions for this private
worker; do not grant public invocation to the worker. Runtime identities must
retain the exact Auth/Firestore and existing Storage-read permissions needed by
their operation. Disable new imports first during rollback. Keep the compatible
media gateway and ready asset metadata for existing snapshots; rolling them back
after a successful attachment would break saved Drive references.
