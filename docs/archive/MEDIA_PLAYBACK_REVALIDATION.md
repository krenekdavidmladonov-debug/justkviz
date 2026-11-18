# Media playback and revalidation

Original web images now bypass this private byte gateway when their verified
source is available; see `ORIGINAL_IMAGE_SOURCES.md`. The behavior below continues
to apply to owned media, retained image backups and Drive audio/video.

Native players keep one decoded resource for their mounted source and access scope.
Play, stop and replay change the command generation, not the resource lifetime.
Callbacks from an older generation cannot finish or pause the current command.
Unmounting or changing the source releases the player, object URL and request.

The browser keeps a bounded, memory-only blob cache (64 MiB, 24 entries, five
minutes). Keys include the complete media URL and the private ID token or public
session scope. Private access invalidation clears retained and pending entries.
Owned images additionally use private browser HTTP caching for an exact representation
hash (asset reference, immutable Storage/Drive generation, MIME and size). Discovery
URLs are no-store and redirect to a pinned image URL. Only successfully authorized
pinned image responses receive private,max-age=31536000,immutable; errors, clips,
ranges and offline exports remain no-store. ETag/304 remains available on network
revalidation. The URL also contains an unpredictable in-memory access namespace,
separate for each private ID token or public session. Identity/membership epoch
invalidation aborts pending memory reads and rotates namespaces on the next read.
Authorization and Origin vary the HTTP cache representation. No credential enters
URLs. Previously downloaded browser-cache bytes cannot be remotely erased; logout
prevents this application from reusing the old namespace but is not a promise to
recall bytes already delivered. Every request that reaches the server still passes
current authorization before and after media IO. Errors never fall back to retained
memory bytes. No service worker is introduced.

Private editor/rehearsal lookahead uses the same snapshot binding as visible
reads and cancels when that binding changes. Live moderators also prefetch at
most two adjacent prompt images/backgrounds/logos in both directions after visible reads settle;
answer media and audio/video clips are excluded. Moderator previews retain the
public session gate, avoiding private snapshot scans on their visible path.
Original web URLs use the native browser image cache. For retained owned assets,
lookahead can warm server bytes on the same instance; it cannot guarantee a
shared instance. Projectors now prefetch only a server-built allowlist for the next
three visible prompt slides (at most nine owned image references). No answer field,
private source document, external URL or clip is published for lookahead. Any image
also used in answerImage, mapped legacy answer-role media or answerDesign anywhere
in the source is excluded. Public gateway reads require exact current publication
or this bounded prompt allowlist. Results, recap and ended/waiting sessions omit it.
The first active navigation and return from results rebuild it. Immutable snapshot
prompt plans are process-local, bounded to eight snapshots and five minutes; they
contain positions/image references only, never authority. Later media lifecycle
reports reuse the plan without rereading up to 400 slides. Mutable quiz plans are
not cached. All session/event authorization remains fresh in their callers.

`readQuizMedia` emits a content ETag derived from the asset reference, immutable
generation, MIME and size. Conditional requests retain current reader/publication
authorization both before and after IO. Drive revalidation checks the live owner,
connection, account, folder and file permissions through the existing runtime;
only the byte download is skipped. Storage revalidation checks the pinned object
generation still exists. Range requests continue through the normal verified
byte path. Unpinned/clip/offline responses remain `Cache-Control: no-store`; pinned image
responses use the private cache policy above. ETag is exposed through CORS.

Drive checkpoints fetch current Auth state alongside one transactional batch of
membership, source quiz and connection records. Current account and configured
folder checks overlap, as do asset folder and file metadata checks. All existing
checkpoints still run; no authority, access token or provider metadata is cached.

A Function instance retains verified immutable image bytes for at most five
minutes, 16 entries and 32 MiB total, excluding individual images above 8 MiB.
The key binds the source quiz, owner/account and complete private file reference.
A hit still checks the live owner, current connection, account, configured folder
and asset folder/file ACLs plus final owner/connection and reader/publication
authority. Only the already verified immutable byte transfer and its surrounding
duplicate metadata verification are skipped, matching conditional-read semantics.
Failed checks never return retained bytes. Audio/video retain their original
verified download path. Retention is process-local and disappears on restart;
it provides no warm-instance or cross-instance latency guarantee.

Successful gateway responses expose non-sensitive `Server-Timing` durations for
initial authorization, media IO, final reauthorization and total server time, so
browser measurements can distinguish transport/decoding from server work. No
identifiers, credentials or quiz content enter these headers.

This does not promise instant cold downloads: first access still checks current
authority and retrieves the bytes. The primary latency correction removes those
downloads from repeated play/stop commands. Performance tests use delayed
synthetic transport and must not be represented as live internet measurements.
