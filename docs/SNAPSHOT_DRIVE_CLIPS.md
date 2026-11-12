# Imported clips in older event snapshots

An event keeps its immutable question snapshot even after the source quiz changes.
Previously, a snapshot locked before media import kept playing its YouTube sources,
although the same clips were already available on Drive in the source quiz.

The trusted read layer now resolves a frozen YouTube prompt clip to an existing
import of the **same quiz, media kind, video ID, start and end**. It reads only
trusted immutable asset metadata and the completed import receipt, never current
quiz questions. It verifies the canonical source fingerprint, full descriptor,
deterministic asset ID, ready status, Drive/output bindings and bounded duration.
The playback range is zero to the validated output duration of that exact import.
If no verified import matches, the frozen source is retained.

This is a derived playback representation. No snapshot, question, answer, score,
result, event assignment, original source interval or import record is rewritten.
Changed source clips cannot silently replace a frozen clip. Existing owned media,
images and answer media do not participate in this resolver.

Live publication, private snapshot reads and private media authorization share
the same resolver. They run after normal current membership and event scope checks.
The snapshot root supplies the source quiz ID; a caller's requested asset cannot
choose it. An event-only moderator receives no access to current quiz content.
Private response shaping still removes answers/notes according to permissions,
and never exposes import receipts, provenance or Drive credentials. Ordinary audio
is still omitted from the projector. Public media reads require the exact current
publication, and private reads reauthorize after file IO.

The explicit whole-YouTube playback choice remains available only after reveal.
Normal Play and navigation restore the verified prepared clip. Existing published
session state changes only on the next trusted live command; deploying this code
does not navigate, restart or rewrite an active event.

Verification covers exact matching, malformed bindings, source/interval changes,
event-only access, revoked/missing scope, answer redaction and immutable inputs,
along with the existing Firestore Rules suite.
