# Quiz behavior discovery — draft

Status: **DISCOVERY BASELINE + CONFIRMED FOUNDATION (2026-09-01)**

This document records what can be proven from the four local V1 quiz exports, the migration code, and the current V2 code. It intentionally does not invent final product behavior.

## Confirmed product behavior implemented in the projector foundation

The sections below retain the original discovery record. Where an older “current V2” paragraph conflicts with this section, this confirmed section is authoritative for `feature/projector-behavior-foundation`.

- **GUARANTEED:** QUESTION, FREE, IMAGE, AUDIO, VIDEO, and legacy PL use explicit `questionNumber` / `questionCount` within their round. Strict `number/number` `qCount` remains a compatibility fallback only.
- **GUARANTEED:** QUESTION and FREE may use a cover background with a black percentage overlay. IMAGE instead has a distinct contained question-image area with black bars; `backgroundImage`, `questionImage`, and `answerImage` are different normalized roles.
- **GUARANTEED:** options are immediately visible for option-bearing question types and support general arrays, including the observed four-option questions and five/six-item agenda lists. FREE suppresses options.
- **GUARANTEED:** AUDIO never mounts or receives a YouTube player/source on the normal public projector. The moderator's visible laptop player supplies system audio; the projector shows the question plus vinyl playback state.
- **GUARANTEED:** VIDEO shows the static question before playback, replaces it with one 16:9 player while playing, and returns to the question after stop or finish. Media never reveals an answer or advances automatically.
- **GUARANTEED:** media commands are manual and distinct from confirmed playback state. The client lifecycle is `IDLE → PREPARING → READY → PLAYING → STOPPING/FINISHED/ERROR`; immutable per-load epochs and monotonic generations discard stale callbacks after navigation or replay. AUDIO animation requires confirmed PLAYING, while media error restores the stable question and requires explicit retry.
- **GUARANTEED:** recap is an explicit authorized mode. The moderator may select questions in arbitrary order. The single public snapshot contains an answer only for the selected recap question. AUDIO/VIDEO recap starts at 0:00, ignores question clip bounds, does not autoplay, and uses a visible projector player.
- **GUARANTEED:** recap PLAY/STOP/REPLAY are remote moderator commands. Pause, seek, current time, and duration are available through the projector's visible standard YouTube controls; mirroring that timeline into the moderator window is not part of this foundation.
- **GUARANTEED:** PL means Pravda / Lež, remains migration-only in normal editor creation, and renders Czech `PRAVDA` / `LEŽ` when the stored value is a recognized boolean/truth form. Unrecognized legacy answer text is preserved rather than guessed.
- **GUARANTEED:** intro/round-header animation starts only on an explicit moderator command. A newly inserted agenda is generated from ordered round headers, while authored legacy agenda options remain unchanged. Editable default rules have a dedicated mode. END stays authored and requires explicit further navigation/session ending.
- **GUARANTEED:** the projector is a dedicated, black, responsive 16:9 shell with a manual fullscreen button and `F` shortcut. It never inherits admin navigation.
- **GUARANTEED:** same-device `BroadcastChannel` is only a strictly parsed, one-revision latency fast path for an already server-sanitized public snapshot. It carries no private slide, legacy raw, moderator note, or unrevealed answer; unconfirmed state rolls back and Firestore remains authoritative.
- **GUARANTEED:** no player preload is enabled. A projector has a hard budget of one active heavy player and deterministic player/timer cleanup.
- **BEST EFFORT / YOUTUBE LIMITATION:** title, thumbnail, branding, ads, keyframe start precision, embed availability, and browser autoplay behavior cannot be hidden or guaranteed. No player is obscured and no hidden/background YouTube audio is used on the projector.
- **FUTURE:** owned media, robust offline bundles, results/rank reveal, winner music, scoring, digital answers, registrations, print/PDF, referee tools, and media upload are intentionally not implemented here.

## Evidence labels

- **FACT** — directly established by the 315-slide local dataset or current repository code.
- **STRONG INFERENCE** — strongly supported by repeated structure, but not proven by a V1 renderer or explicit product decision.
- **UNKNOWN / HUMAN DECISION** — must be decided before final renderer behavior is implemented.

No question text, answer value, note, quiz title, document ID, or production media URL appears in this document. The reproducible aggregate source is `pnpm migration:v1:behavior-inventory`; its output stays in Git-ignored `.local-data/v1-analysis/behavior-inventory.json`.

## Dataset scope

| V1 type | Count | Question-like | Main observed variants |
|---|---:|---|---|
| `agenda` | 2 | no | option lists of 5 and 6 items; two V1 schema families |
| `audio` | 52 | yes | 27 with YouTube URL, 25 without source; 25 URL slides also carry a legacy YouTube ID |
| `end` | 2 | no | two V1 schema families |
| `free` | 50 | yes | 37 text-only, 13 with background image and positive overlay |
| `image` | 30 | yes | 18 without source, 9 direct image URL, 3 YouTube-provider URL classified by V1 type as image |
| `intro` | 25 | no | 20 without background, 5 with background and positive overlay |
| `pl` | 11 | yes/legacy | 5 without background, 6 with background and positive overlay |
| `question` | 74 | yes | 64 with four options, 10 without; 19 with background, one of those with answer image |
| `recap` | 23 | no | 22 ordinary, one with five `recapOverrides` entries |
| `video` | 46 | yes | 24 with YouTube URL, 22 without source; 22 URL slides also carry a legacy YouTube ID |

**FACT:** totals are 4 quizzes, 315 slides, 23 rounds, 263 question-like slides, 263 non-empty private answers, and 154 normalized media references.

## Raw field inventory

All 315 raw slides physically contain these fields: `audioTrigger`, `correct`, `mediaRaw`, `note`, `options`, `qCount`, `roundHeader`, `text`, `title`, `type`, `videoEnd`, and `videoStart`. Physical presence does not mean a value is meaningful; V1 commonly stores empty strings, empty arrays, or zero defaults.

| Field | Raw presence and value types | Meaningful use |
|---|---|---|
| `type` | 315 strings | always; 10 unique normalized values |
| `title` | 315 strings | non-empty on all 315 |
| `text` | 315 strings | type-dependent; empty on agenda and recap, one intro is empty |
| `roundHeader` | 315 strings | non-empty on 312 |
| `correct` | 315 strings | non-empty on exactly 263 question-like slides |
| `correctAnswer` | absent | covered only by synthetic migration tests |
| `note` | 315 strings | non-empty on 253 question-like slides |
| `options` | 315 arrays | lengths 0/4/5/6; all 283 elements are strings |
| `optionsStr` | 87 strings | non-empty on 21; see options mismatch below |
| `qCount` | 315 strings | non-empty on 184; every non-empty value has structural form `number/number` |
| `mediaRaw` | 315 strings | non-empty on 63 |
| `media` | 56 objects and 43 nulls | all objects have exactly `src:string,type:string`; other slides omit it |
| `bgImage` | 252 strings | non-empty on 43 |
| `bgRaw` | 63 strings | all 63 are empty; it does not create a media reference |
| `bgOverlay` | 209 numbers, 43 numeric strings | positive on exactly 43 |
| `answerImg` | 6 strings | non-empty on one slide |
| `answerOverlay` | 4 numbers | all four are zero |
| `videoStart` | 291 numbers, 24 numeric strings | positive on 37 slides, otherwise zero |
| `videoEnd` | 288 numbers, 27 numeric strings | positive on 46 slides, otherwise zero |
| `audioTrigger` | 314 numbers, one numeric string | positive on one AUDIO slide, otherwise zero |
| `id` | 63 numbers | V1 schema identifier; preserved only as legacy raw |
| `recapOverrides` | one array | five object entries; details below |

### Options facts

- **FACT:** canonical raw `options` lengths are: 245×0, 68×4, 1×5, 1×6.
- **FACT:** 64 QUESTION and 3 VIDEO slides have four non-empty options. Both AGENDA slides have non-empty option lists of 5 and 6 items.
- **FACT:** one INTRO has four empty `options` entries but a non-empty `optionsStr`.
- **FACT:** on every one of the 21 slides with a non-empty `optionsStr`, content parsed with the migrator's supported newline/pipe delimiters differs from the non-empty `options` array. The affected types are AGENDA (1), INTRO (1), QUESTION (18), and VIDEO (1).
- **FACT:** the current migrator prefers `options` whenever it is an array, which it is on all 315 slides. `optionsStr` remains losslessly available in `legacy.raw`, but is not shown by the current editor preview/projector.
- **UNKNOWN / HUMAN DECISION:** whether `optionsStr` is alternate presentation copy, legacy serialization, or another semantic field.

### Round and recap controls

- **FACT:** every non-empty `qCount` has a `number/number` structure; values are retained as `presentation.sourceQuestionNumber`.
- **STRONG INFERENCE:** `qCount` is a source question-number/total label. Its display semantics are not proven.
- **FACT:** the only `recapOverrides` array contains five objects: two empty, two with `extraText:string`, and one with `overrideMedia:string`.
- **FACT:** migration retains `recapOverrides` in private slide presentation and in `legacy.raw`; editor mapping, public mapping, and `SlidePreview` do not render it.
- **UNKNOWN / HUMAN DECISION:** how each recap override aligns with questions and when it is shown.

## Media inventory

The following counts are references, not unique downloadable files.

| Category | References | Slides | Evidence |
|---|---:|---:|---|
| Direct external image URL | 53 | 52 | HTTP(S), normalized kind `image` |
| YouTube URL on AUDIO | 27 | 27 | YouTube host, normalized kind `audio` |
| Legacy YouTube ID on AUDIO | 25 | 25 | `media.type == youtube`, 11-character YouTube-ID shape |
| YouTube URL on VIDEO | 24 | 24 | YouTube host, normalized kind `video` |
| Legacy YouTube ID on VIDEO | 22 | 22 | `media.type == youtube`, 11-character YouTube-ID shape |
| YouTube-provider URL on IMAGE | 3 | 3 | YouTube host but normalized kind `image` because V1 type is `image` |

Totals: 154 references = 56 image-kind + 52 audio-kind + 46 video-kind. There are no direct audio-file URLs and no direct video-file URLs in this dataset.

- **FACT:** AUDIO has 27 media-bearing slides, not 52. Twenty-five of those 27 store both a YouTube URL and a companion legacy YouTube ID. The other 25 AUDIO slides have no non-empty media source.
- **FACT:** VIDEO has 24 media-bearing slides, not 46. Twenty-two of those 24 store both a YouTube URL and a companion legacy YouTube ID. The other 22 VIDEO slides have no non-empty media source.
- **FACT:** all 56 image-kind references are external HTTP(S) URLs. They occur on 55 slides because one QUESTION has both a background and an answer image.
- **FACT:** the three YouTube-provider IMAGE references are a provider/type mismatch that cannot safely be interpreted as an image player contract from data alone.

## Timing data

All three timing/trigger fields are physically present on every slide and all values parse as finite numbers. Both native numbers and numeric strings occur.

| Type/field | Zero | Positive | Min positive context | Maximum | Paired segment facts |
|---|---:|---:|---|---:|---|
| AUDIO `videoStart` | 35 | 17 | integer-like | 320 | 25 slides have `end > start`; 8 use start 0 with positive end |
| AUDIO `videoEnd` | 27 | 25 | integer-like | 345 | segment duration range 8–31, average 19.80 |
| AUDIO `audioTrigger` | 51 | 1 | one value only | 35 | no semantics proven |
| VIDEO `videoStart` | 26 | 20 | integer-like | 443 | 21 slides have `end > start`; 1 uses start 0 with positive end |
| VIDEO `videoEnd` | 25 | 21 | integer-like | 480 | segment duration range 12–39, average 22.67 |

- **FACT:** no slide has `videoStart > videoEnd`; no positive start lacks a positive end.
- **FACT:** zero is the default on non-media slides and on media slides without configured timing. It is not a missing field.
- **STRONG INFERENCE:** the units are seconds. Evidence: sources are YouTube, the IFrame API uses seconds, values are integer-like, and paired durations are plausible quiz excerpt lengths. The raw export itself does not declare a unit.
- **UNKNOWN / HUMAN DECISION:** whether start 0 means “from the beginning”, “unset”, or both depending on whether end is positive.
- **UNKNOWN / HUMAN DECISION:** the meaning of the single positive `audioTrigger=35`. The data does not prove whether it is an automatic-play delay, a cue point, or another V1 control.

## Image presentation semantics

- **FACT:** 43 slides have non-empty `bgImage`; all 43 also have a positive `bgOverlay`, and no positive background overlay exists without a non-empty `bgImage`.
- **FACT:** background image types/counts are FREE 13, INTRO 5, PL 6, QUESTION 19.
- **FACT:** positive background overlay values are 20 (2), 30 (3), 35 (1), 70 (14), 75 (22), and 80 (1). The other 209 present values are zero; 63 slides omit the field.
- **STRONG INFERENCE:** these values are percentage-like opacity/intensity controls because they are bounded 20–80 and correlate exactly with non-empty backgrounds. CSS direction and whether the percentage applies to image or overlay color remain unknown.
- **FACT:** one QUESTION has a non-empty `answerImg`; `answerOverlay` is zero wherever present, including that schema family.
- **FACT:** IMAGE-type slides never use non-empty `bgImage`; their 12 sources are stored through `mediaRaw` (nine direct image URLs, three YouTube-provider URLs).
- **HUMAN-PROVIDED PRODUCT INPUT:** the main image on image questions was used as a projector background rather than an inline image.
- **CONCLUSION:** raw field names alone do not encode that behavior for IMAGE. If the product input is correct, V1 behavior was type-driven (`type=image` + `mediaRaw`) rather than represented by `bgImage`. Current V2 migration labels those references `prompt`, not `background`; this is a fidelity mismatch to resolve deliberately.

## Current V2 renderer fidelity

`SlidePreview` is shared by editor preview and projector. That prevents divergence in the basic title/text/options/media markup. The editor may additionally reveal its private answer locally. The moderator live preview is separate and shows title, text, options, and private answer, but no media or presentation controls.

| V1 type | Data-backed V1 semantics | Current V2 rendering | Fidelity |
|---|---|---|---|
| AGENDA | title + 5/6-item list; one differing `optionsStr` | generic title and canonical options list | **PARTIAL** — list renders; alternate `optionsStr` ignored |
| AUDIO | question text/answer; 27 YouTube sources; optional segment; one trigger | title/text and a link labelled Audio; no player or timing | **MISMATCH** |
| END | title/text content slide | generic active slide; ended session replaces it with hard-coded end message | **PARTIAL** |
| FREE | text answer; 13 have background + overlay | title/text; background rendered as inline contained image; overlay ignored | **PARTIAL** |
| IMAGE | question; 12 source URLs; human input says main source is background | source rendered as inline contained image; no background semantics | **MISMATCH** to stated product input |
| INTRO | title/text; 5 background + overlay; often round header | generic content; background inline; round header/overlay ignored | **PARTIAL** |
| PL | question-like, sometimes background; native meaning unresolved | generic “Legacy slide”, title/text, inline image | **PARTIAL / semantic match unknown** |
| QUESTION | text/options/answer; 19 backgrounds; one answer image | core title/text/options and revealed answer work; background inline, overlay ignored; answer image only after reveal | **PARTIAL** |
| RECAP | title/round header; one structured override set | generic title; `recapOverrides` not rendered | **MISMATCH** for override variant |
| VIDEO | question text/answer; 24 YouTube sources and segments | title/text and a link labelled Video; no player or timing | **MISMATCH** |

Cross-type renderer facts:

- `background` media is included in `promptMedia`; all image media uses `<img class="projector-image">` with `object-fit: contain`. There is no CSS background-image rendering.
- `backgroundOverlay`, `answerOverlay`, `videoStart`, `videoEnd`, `audioTrigger`, and `sourceQuestionNumber` are sanitized by the Function into `publicSessions.presentation`, but `mapPublicLiveState` drops `presentation`, `PublicLiveState` has no such field, and `SlidePreview` cannot consume it.
- Audio and video are placeholder cards with external links. There is no `<audio>`, `<video>`, YouTube iframe, player API, timer, or playback lifecycle.
- An answer image is allowlisted only after reveal and is rendered as an ordinary answer-section image. Answer overlay is ignored.
- `roundHeader`, `qCount`, `recapOverrides`, and moderator note are not projector-rendered. Moderator note is also absent from current live control.
- Projector states are only `waiting`, `active`, and `ended`, plus `answerRevealed`. There are no media-specific READY, PLAYING, or FINISHED states.

## YouTube technical and policy audit

Sources checked on 2026-09-01:

- [YouTube IFrame Player API reference](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube embedded player parameters](https://developers.google.com/youtube/player_parameters)
- [Required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [YouTube API Services developer policies](https://developers.google.com/youtube/terms/developer-policies)

### Technically guaranteed by the documented API

- Object-form `cueVideoById`/`loadVideoById` accept numeric `startSeconds` and `endSeconds`; `endSeconds` stops playback at the requested time.
- `startSeconds` seeks to the closest keyframe, not necessarily the exact requested frame.
- `onReady`, `onStateChange`, `onError`, and `onAutoplayBlocked` exist. The last one explicitly reports browser-blocked autoplay/scripted playback.
- `controls=0` can suppress standard controls, and the JS API can cue, play, pause, stop, seek, mute, and read current time/state.
- After `seekTo()`, a previously supplied `endSeconds` is no longer in effect; a lifecycle implementation must account for that.

### Best effort, not exact guarantees

- Starting/ending a quiz excerpt at a visually exact frame: keyframe seeking, buffering, network latency, ads, and device behavior prevent frame accuracy.
- Minimal unwanted UI: controls can be reduced, but branding and player-selected UI remain under YouTube control.
- Autoplay after moderator navigation: browsers may block it, particularly with sound or without a qualifying user gesture. A READY/blocked state is required.
- A clean transition at segment end: the API can stop at `endSeconds`, but the post-stop frame/UI and event timing must be treated as best effort and tested on target browsers.

### Not guaranteed by YouTube

- No thumbnail, title, channel avatar, branding, related content, ad, or transient frame before/after playback.
- `modestbranding` and `showinfo` no longer provide the old suppression behavior. The official parameter history says title/channel information is displayed before playback, when paused, and when playback ends.
- `rel=0` does not eliminate related videos; it limits them to the same channel.
- Unmuted autoplay, exact frame boundaries, uninterrupted network playback, or availability of a particular video.

### Incompatible / policy risk

The requested AUDIO projector behavior “play a YouTube source while the audience sees no video, thumbnail, title, or spoiler” is not a compliant assumption for a YouTube embed:

- embedded players must have a viewport of at least 200×200;
- automatic playback must wait until the player is visible and more than half visible;
- overlays must not obscure any part of the player;
- developer policies prohibit separating/isolating audio from YouTube audiovisual content and prohibit background players;
- official guidance says thumbnail/title metadata generally must remain visible and unmodified.

**UNKNOWN / HUMAN DECISION:** either accept a visible compliant YouTube player for AUDIO, move AUDIO to licensed/owned direct audio assets, or choose a different legally and technically supported source. Hiding/off-screening/covering the iframe is not a proposed workaround.

## Media player lifecycle architecture proposal

This is architecture only, not final UX behavior.

1. The projector owns one `MediaCoordinator` slot keyed by public session revision and slide ID/position.
2. A slide change increments a local generation token, stops and destroys the previous heavy player, removes listeners/timers, then creates at most one new player.
3. Every asynchronous callback captures the generation token and becomes a no-op when stale.
4. YouTube API script loading is singleton/idempotent; player instances are not accumulated per slide.
5. A direct `<audio>`/`<video>` player pauses, removes `src`, calls `load()`, and detaches listeners on cleanup.
6. Timers use one owned handle and are cleared on slide change, reveal, end, error, and unmount.
7. Player readiness and autoplay blockage are explicit technical states. They do not automatically reveal an answer or advance a slide unless the behavior spec later requires it.
8. Moderator and projector may have distinct views, but there must not be two simultaneous autoplaying YouTube players on one page/screen.

Recommended technical state envelope: `ABSENT → LOADING → READY → PLAYING → FINISHED | BLOCKED | ERROR`, orthogonal to `answerRevealed`. Product-visible transitions remain human decisions.

## Performance audit

### Current facts

- The projector subscribes to one `publicSessions/{id}` document and mounts one `SlidePreview`. A slide change replaces props; no prior slide collection is retained.
- The projector effect unsubscribes the Firestore listener and removes its offline listener on cleanup.
- Live control has one session listener and at most one current-slide listener; the slide effect unsubscribes when `currentSlideId` changes.
- Current code contains zero YouTube iframes, `<audio>`, `<video>`, observers, or playback intervals. Therefore the historical “higher question number means more player lag” mechanism is not present yet.
- Each live navigation Function queries at most one slide by exact position; it does not load all earlier slides.
- The editor intentionally loads the complete ordered slide stream using a revision sandwich: quiz, all slides, quiz. It holds the whole quiz in state and renders every slide navigation row (63–91 rows in the four real quizzes).
- Changing a selected slide draft rerenders the parent editor and its full navigation list because rows are not memoized/virtualized. This scales with total quiz length, not the current slide number.
- Only one selected editor preview is mounted; the navigation list has no thumbnails or players.
- Quiz detail loads every round and every question and mounts the full detail list. It is not part of the live projector path.

### Risk assessment

- **Current projector:** low cumulative-lag risk; no heavy player exists.
- **Current editor at 91 slides:** bounded but worth profiling after real media rendering exists; no evidence yet of slide-index-dependent degradation.
- **Future renderer:** high risk if each visited slide retains an iframe/player, listener, interval, or decoded media element. The one-active-player invariant is required.
- **Instrumentation needed with renderer work:** count live iframes/media elements/listeners, player creation/destruction, heap trend across 315 next/previous transitions, transition latency percentiles, and stale callback count. Acceptance should require iframe count ≤1 and no monotonic heap/listener growth.

## Offline reality matrix

| Source | Online now | Cacheable in principle | Offline possible | Offline guaranteed now | Limitations |
|---|---|---|---|---|---|
| Firestore text data | yes | yes | yes with deliberate persistent cache | no | Web persistent Firestore cache is not enabled; editor explicitly uses server-only reads; projector rejects cached snapshots for answer safety |
| Direct image | yes | depends on HTTP/cache headers or service worker | yes if explicitly cached and CORS/use rights allow | no | all current images are external; provider availability and cache headers are outside V2 control |
| Direct audio | no real references in dataset | technically yes for owned HTTP assets | yes with explicit asset cache/download design | no | ownership, quota, CORS, storage, eviction, and licensing unresolved |
| Direct video | no real references in dataset | technically yes but large | yes with explicit asset cache/download design | no | large files, seeking/range requests, storage, eviction, rights, and update policy unresolved |
| YouTube AUDIO source | yes for 27 slides | not as an app-controlled offline asset | no supported offline guarantee | no | hidden/audio-only playback has policy conflict; downloads outside YouTube Premium experience are prohibited |
| YouTube VIDEO | yes for 24 slides | YouTube/browser internal caching is not an app contract | no supported offline guarantee | no | availability, ads, UI, embedding restrictions, autoplay, and network remain external |

The current Firebase initialization uses default memory cache; web persistent caching is disabled. Firebase also warns that persistent web cache can retain sensitive data between sessions, so enabling it for private admin quiz data requires a trusted-device and sign-out/clear-cache policy. See [Firestore offline data](https://firebase.google.com/docs/firestore/manage-data/enable-offline). No service worker or application-managed Cache API exists in the repository.

---

# Per-type behavior templates

## TYPE: AUDIO

**Purpose:** **STRONG INFERENCE** — identify content from a played audio excerpt, then reveal a private answer.

**DATA FACTS:** 52 slides; all have title/text/round header/private answer; 48 notes; 35 `qCount`; no options. Twenty-seven have a YouTube URL; 25 of those also have a legacy YouTube ID. Twenty-five have no source.

**KNOWN VARIANTS:** no source (25); YouTube URL only (2); URL + legacy ID (25); 25 configured positive-end segments; 17 positive starts; one positive `audioTrigger`.

**ADMIN EDITOR:** Known — must preserve URL/legacy ID, start/end, trigger, note, answer, and empty-source records. Human decisions — source validation, visible provider metadata, whether zero means unset, whether legacy ID is editable or derived.

**ADMIN LIVE CONTROL:** Known — current control shows text/options/answer only. Human decisions — cue/play/pause/restart controls, moderator-only source preview, blocked-autoplay recovery, and whether control or projector owns sound output.

**PROJECTOR – INITIAL:** Known — no media state exists today. Unknown — show question text, a compliant player, an audio visualization, or a static ready card.

**PROJECTOR – READY:** Unknown — manual play versus autoplay, and what the audience sees before play.

**PROJECTOR – PLAYING:** Unknown — visible YouTube player versus non-YouTube owned audio; progress/timer visualization; replay rules.

**PROJECTOR – FINISHED:** Unknown — remain on player, return to prompt, enable moderator action, or another state. No automatic reveal is implied.

**PROJECTOR – REVEALED:** Known — answer must be published only after authorized reveal. Unknown — whether audio/player remains visible or replayable.

**MEDIA:** YouTube audio-only hidden playback is policy-incompatible; start/end are supported but best-effort at runtime.

**OFFLINE:** YouTube is not offline-guaranteed. Direct owned audio could be cacheable after a separate design.

**FAILURE BEHAVIOR:** Unknown — missing source, removed/blocked video, autoplay blocked, embed denied, timeout, or network loss.

**OPEN QUESTIONS:** see P0 AUDIO decisions in `PRODUCT_DECISIONS_REQUIRED.md`.

## TYPE: VIDEO

**Purpose:** **STRONG INFERENCE** — identify content from a video segment and reveal an answer.

**DATA FACTS:** 46 slides; 24 have YouTube URLs, 22 of those companion IDs, 22 no source; 21 positive-end segments; 3 slides have four options.

**KNOWN VARIANTS:** no source (22); URL only (2); URL + legacy ID (22); timed/untimed; with options (3) or without (43).

**ADMIN EDITOR:** Known — preserves provider references, timing, note, options, answer. Human decisions — validation and whether ID/URL are one derived source.

**ADMIN LIVE CONTROL:** Human decisions — cue, play, pause, restart, seek policy, moderator preview, and blocked/embed-error recovery.

**PROJECTOR – INITIAL:** Unknown — prompt first, thumbnail/player first, or ready card.

**PROJECTOR – READY:** Unknown — manual versus automatic start; permitted YouTube UI remains visible.

**PROJECTOR – PLAYING:** Known technically — one visible player can play a segment. Unknown — controls, progress, prompt placement, ads/interruption behavior.

**PROJECTOR – FINISHED:** Unknown — freeze, hide, prompt, replay, or moderator-controlled transition.

**PROJECTOR – REVEALED:** Known — private answer only after reveal. Unknown — player frame and answer composition.

**MEDIA:** exact first/last frame and absence of YouTube UI are not guaranteed.

**OFFLINE:** not guaranteed; current dataset has no direct video asset.

**FAILURE BEHAVIOR:** Unknown — unavailable/embed-disabled/age-restricted content, network, autoplay, or timing failure.

**OPEN QUESTIONS:** see P0 VIDEO decisions.

## TYPE: IMAGE

**Purpose:** **STRONG INFERENCE** — answer from a primary image.

**DATA FACTS:** 30 slides; 12 source URLs, 18 no source; all have title/text/note/answer; no options. Sources use `mediaRaw`, never non-empty `bgImage`.

**KNOWN VARIANTS:** no source (18); direct image URL (9); YouTube-provider URL classified as image (3).

**ADMIN EDITOR:** Known — source and answer must be retained. Human decisions — whether main source is always background, how to classify the three provider mismatches, crop/focal controls, and missing-source validation.

**ADMIN LIVE CONTROL:** Unknown — source preview, preloading readiness, fallback controls.

**PROJECTOR – INITIAL:** Human-provided input says background. Exact fit/crop/overlay/text layering remains unknown.

**PROJECTOR – READY / PLAYING / FINISHED:** Not naturally media-timed; whether these states collapse to INITIAL is a human decision.

**PROJECTOR – REVEALED:** Known — answer appears only after reveal. No answer image occurs on IMAGE slides in this dataset.

**MEDIA:** external HTTP images; no local ownership/cache guarantee.

**OFFLINE:** possible only after an explicit cache/asset strategy.

**FAILURE BEHAVIOR:** Unknown — broken URL placeholder, text-only fallback, moderator warning, or block session progression.

**OPEN QUESTIONS:** background semantics and the three YouTube-provider sources are P0.

## TYPE: QUESTION

**Purpose:** **FACT** — generic question with private answer; often multiple choice.

**DATA FACTS:** 74; 64 have four non-empty options, 10 none; 19 background images with overlay; one of those also has answer image; 18 have a differing non-empty `optionsStr`; 72 notes.

**KNOWN VARIANTS:** plain open question (9); multiple choice without background (49); background open question (1); background multiple choice (15); two note-less; one background + answer image.

**ADMIN EDITOR:** Known — title/text/options/answer/note/background/answer image must survive. Human decisions — role of `optionsStr`, option labeling/scoring, overlay units, image crop, and answer-image composition.

**ADMIN LIVE CONTROL:** Known current text/options/answer. Human decisions — note visibility, readiness for external images, and answer-image preview.

**PROJECTOR – INITIAL:** Known core title/text/options. Unknown background composition and whether options appear immediately.

**PROJECTOR – READY / PLAYING / FINISHED:** No timed media proven; decide whether these collapse to INITIAL.

**PROJECTOR – REVEALED:** Known — answer and the single answer image may be published only after reveal. Unknown layout/overlay and whether options remain.

**MEDIA:** 19 external backgrounds, one external answer image.

**OFFLINE:** text potentially cacheable; images not guaranteed.

**FAILURE BEHAVIOR:** Unknown image fallback; text/options can remain available.

**OPEN QUESTIONS:** `optionsStr`, background composition, answer image, scoring.

## TYPE: FREE

**Purpose:** **STRONG INFERENCE** — free-text answer without options.

**DATA FACTS:** 50; no options; 37 text-only, 13 background + positive overlay; all have answer; 49 notes.

**KNOWN VARIANTS:** plain (37); background (13); one note-less.

**ADMIN EDITOR:** Known — text/answer/note/background/overlay. Human decisions — overlay semantics and whether empty note is intentional.

**ADMIN LIVE CONTROL:** Human decisions — moderator note display and background readiness.

**PROJECTOR – INITIAL:** Known text; unknown background fit/overlay/text placement.

**PROJECTOR – READY / PLAYING / FINISHED:** likely collapse for static content, but **UNKNOWN** until decided.

**PROJECTOR – REVEALED:** Known private answer after reveal; composition unknown.

**MEDIA:** optional external background.

**OFFLINE:** text possible; background not guaranteed.

**FAILURE BEHAVIOR:** text-only fallback is technically possible but requires product approval.

**OPEN QUESTIONS:** static state collapse, background semantics, moderator note.

## TYPE: INTRO

**Purpose:** **STRONG INFERENCE** — quiz/round introduction or separator.

**DATA FACTS:** 25; all titles, 24 text, 24 round headers; 5 backgrounds with overlays; no answers. One has four empty options plus differing non-empty `optionsStr`.

**KNOWN VARIANTS:** ordinary title/text (19), background title/text (5), title without text (1); V1 schema ID on 5.

**ADMIN EDITOR:** Known — content/background/round association preserved. Human decisions — distinguish quiz intro versus round header, meaning of the one `optionsStr`, and permitted structural moves.

**ADMIN LIVE CONTROL:** Unknown — whether intro requires a dedicated “start round” action or behaves as an ordinary slide.

**PROJECTOR – INITIAL:** Known title/text candidate; background composition unknown.

**PROJECTOR – READY / PLAYING / FINISHED:** likely static, but not specified.

**PROJECTOR – REVEALED:** no answer exists; reveal should likely be unavailable, but this remains a product rule to confirm.

**MEDIA:** five external backgrounds.

**OFFLINE:** text possible; backgrounds not guaranteed.

**FAILURE BEHAVIOR:** unknown background fallback.

**OPEN QUESTIONS:** intro taxonomy, round transition, `optionsStr`, reveal availability.

## TYPE: AGENDA

**Purpose:** **STRONG INFERENCE** — list upcoming sections/rounds.

**DATA FACTS:** 2; titles; option lists of 5 and 6; no answer/text. One has round header and differing `optionsStr`; one has V1 numeric ID.

**KNOWN VARIANTS:** 5-item legacy-schema list; 6-item round-header list.

**ADMIN EDITOR:** Known — arbitrary option count is required. Human decisions — whether options are ordinary editable list items and what `optionsStr` means.

**ADMIN LIVE CONTROL:** Unknown — ordinary next/previous versus navigation shortcuts.

**PROJECTOR – INITIAL:** current generic list is structurally capable; final numbering/layout unknown.

**PROJECTOR – READY / PLAYING / FINISHED:** static-state collapse unknown.

**PROJECTOR – REVEALED:** no answer; reveal behavior unknown/likely disabled.

**MEDIA:** none meaningful.

**OFFLINE:** Firestore text only.

**FAILURE BEHAVIOR:** malformed/empty list behavior unknown.

**OPEN QUESTIONS:** list semantics and `optionsStr`.

## TYPE: RECAP

**Purpose:** **STRONG INFERENCE** — summarize a completed round.

**DATA FACTS:** 23; title and round header; no meaningful text/options/answer/media. One has five structured overrides: two empty, two extra-text, one override-media.

**KNOWN VARIANTS:** ordinary recap (22); override recap (1).

**ADMIN EDITOR:** Known — overrides must remain lossless. Human decisions — alignment to questions, editing UI, empty override meaning, and whether override media is prompt/answer/background.

**ADMIN LIVE CONTROL:** Unknown — recap generation source, navigation within recap, answer status, and per-question override control.

**PROJECTOR – INITIAL:** current title-only output loses override semantics.

**PROJECTOR – READY / PLAYING / FINISHED:** unknown; override media may introduce sub-states.

**PROJECTOR – REVEALED:** unknown whether recap is already a revealed summary or has an independent reveal.

**MEDIA:** one legacy override media string, not normalized as public media.

**OFFLINE:** depends on future derived recap data and media handling.

**FAILURE BEHAVIOR:** unknown behavior for malformed/missing override targets.

**OPEN QUESTIONS:** the entire override contract is P0 before faithful recap rendering.

## TYPE: END

**Purpose:** **STRONG INFERENCE** — authored quiz closing slide.

**DATA FACTS:** 2; title/text; no answer/media/options; one has round header, one numeric V1 ID.

**KNOWN VARIANTS:** two schema families, no meaningful content-shape difference beyond round header.

**ADMIN EDITOR:** Known — authored title/text preserved. Human decisions — whether multiple END slides are allowed and validation relative to quiz order.

**ADMIN LIVE CONTROL:** current separate `end-session` action replaces authored slide with a hard-coded public ended state.

**PROJECTOR – INITIAL:** authored END can render as ordinary active content.

**PROJECTOR – READY / PLAYING / FINISHED:** static; exact state mapping unknown.

**PROJECTOR – REVEALED:** no answer.

**MEDIA:** none.

**OFFLINE:** text potentially cacheable.

**FAILURE BEHAVIOR:** unknown relationship between last slide and ended session.

**OPEN QUESTIONS:** authored END versus system ended screen is P0.

## TYPE: PL

**Purpose:** **UNKNOWN / HUMAN DECISION**. The type name and data do not prove its product meaning.

**DATA FACTS:** 11 question-like slides; title/text/round header/private answer/`qCount`; 10 notes; no options; 6 backgrounds with overlays; 5 V1 numeric IDs.

**KNOWN VARIANTS:** background PL (6, one without note); non-background legacy-schema PL (5).

**ADMIN EDITOR:** Known — type and full raw data must remain locked/lossless until meaning is decided. Human decisions — native name, editable fields, validation, scoring, and conversion policy.

**ADMIN LIVE CONTROL:** current generic legacy label plus text/answer. All special control is unknown.

**PROJECTOR – INITIAL:** current generic title/text/background-as-inline-image. Intended semantics unknown.

**PROJECTOR – READY / PLAYING / FINISHED:** unknown.

**PROJECTOR – REVEALED:** answer is available privately and can be revealed as text; whether that is semantically correct is unknown.

**MEDIA:** six external background candidates with overlay 70/75.

**OFFLINE:** text possible; images not guaranteed.

**FAILURE BEHAVIOR:** current safe fallback is generic legacy rendering without dropping raw data. Final behavior unknown.

**OPEN QUESTIONS:** identify PL from human V1 knowledge before native rendering.
