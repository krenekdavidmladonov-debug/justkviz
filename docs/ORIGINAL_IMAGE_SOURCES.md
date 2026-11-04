# Original image sources

Images use their original web URLs. Google Drive prepares and serves video and
audio clips only. New Drive import requests for question, answer or background
images fail before creating a job or contacting Drive; existing image backups,
receipts and previously queued work remain retained.

Some saved slides and immutable event snapshots already contain a Drive image
asset reference. Their private `driveImportProvenance` retains the original
`https-image` descriptor separately for `questionImage`, `answerImage` and
`backgroundImage`. The server derives a read representation from that exact
frozen receipt: the field must match, the import job must hash to the currently
attached asset ID, the canonical source fingerprint must match and the source
revision must be valid. The original URL must be bounded HTTPS without embedded
credentials or a fragment. Firestore map key ordering does not affect this
verification. There is no network fetch in the resolver.

`functions/src/media/original-images.ts` applies this representation before the
private editor/read mapping and trusted live slide parsing. Duplicate image
references in the same slide's media/design fields resolve consistently. Audio
and video sources, exact clip ranges, text, answers, order and snapshot ownership
do not change. The resolver never consults current quiz slides when reading an
event snapshot and never writes a source, snapshot, score or media record.

Missing, detached or invalid provenance preserves the existing asset reference;
the application does not invent an original URL. This compatibility case can
still use an existing image backup. A valid original URL's availability is the
image host's responsibility; the resolver does not silently fetch a Drive image
when that host fails.

The private media gateway checks retained physical image attachments through an
internal stored-image view. Existing tabs and valid retained backup references
therefore keep their prior authorization; answer permissions and the current
event snapshot binding still apply. Browser read responses prefer original URLs.

Answer images and answer designs remain private until the normal explicit reveal.
The public projection still allowlists fields and never includes provenance.
Editor authorization compares the derived representation while preserving exact
protected stored fields on redacted saves. Users without answer read permission
cannot repurpose either the private answer's retained asset or its original URL
into a prompt, background or design. Existing membership, resource scope and media
gateway checks remain active; no Rules or collection changes are introduced.

Verification covers original source binding, Firestore map ordering, invalid URLs,
missing provenance, editor permissions, public reveal, unchanged Drive AV clips,
and event-only snapshot reads without current quiz access or writes. See
`tests/originalImages.test.ts`, `tests/snapshotClipAccess.test.ts`,
`tests/slideDesignSecurity.test.ts` and `tests/driveImports.test.ts`.

## Navigation and browser preparation

Both moderator directions call the existing `goToSlide` endpoint with an exact
`direction` of -1 or 1 and the expected revision. The server chooses the adjacent
visible slide; clients do not decide authoritative positions. Position-based
calls remain compatible, but combining position and direction is rejected.
Ordinary navigation reads one candidate. Hidden runs use subsequent batches of
32 projected metadata documents, keeping the existing 400-candidate bound.
This avoids one sequential database request per hidden slide and avoids routing
backwards navigation to a separately cold Function. Actual cold-start latency
has not been measured by the synthetic navigation tests.

Private moderator/editor image preloading gives both neighbouring directions a
slot, with at most two sequential images. Original HTTP images use native browser
image requests and the same unchanged URL as visible images. Answers and clips
are excluded; public/projector clients never preload future private content.
Original-host caching and availability still govern these web images.
