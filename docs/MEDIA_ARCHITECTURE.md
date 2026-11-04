# Media architecture

## Guarantees

Media control is explicit and revisioned. Navigation resets media to `idle` and advances `mediaGeneration`; every play, stop, replay, finish, or recap selection advances it again. `mediaCommand` records moderator intent, while `mediaPlaybackState` records confirmed lifecycle (`idle`, `preparing`, `ready`, `playing`, `finished`, or `error`). Player reports are accepted only for the current generation and a valid lifecycle transition (including native pause from playing to ready and resume within the same generation).

The local player lifecycle is:

```text
IDLE → PREPARING → READY → PLAYING → STOPPING → READY
                              └──────→ FINISHED
                 any state ─────────→ ERROR
```

Only one heavy player may exist in a projector window. The current video may remain prepared while its frame is hidden after STOP; it is paused and inert. No previous-slide players, timers, or subscriptions survive React cleanup. No future public question or answer is preloaded. Development diagnostics are available at `window.__FILMOVY_KVIZ_MEDIA_DEBUG__` and fail when a projector exceeds the one-player budget.

Every command owns an immutable playback epoch and a dedicated player callback closure. A new generation invalidates old callbacks while retaining the current source resource. Source changes, navigation and unmount release the resource. An event from an invalidated epoch cannot be relabeled with the newest generation. Failed IFrame API loads clear the singleton promise; only a later explicit command/generation retries, so there is no automatic retry loop.

Normalized slide fields are `mediaSource`, `clipStartSeconds`, and optional `clipEndSeconds`. Legacy `videoStart` / `videoEnd` remain preserved in `presentation` and private raw data; compatibility mapping uses them only when normalized fields are absent. Internally timing is finite non-negative seconds. An end is used only when it is strictly greater than start.

## AUDIO

In ordinary question mode, the public projector payload omits the audio source and the renderer cannot mount a YouTube iframe. The projector shows question copy and a vinyl state driven only by confirmed `mediaPlaybackState === playing`, never by the PLAY command alone. The moderator laptop mounts the visible, controlled MediaPlayer adapter (YouTube or owned native audio), so system audio comes from that device. Errors and autoplay blocks transition the trusted state to `error`, stop the vinyl, retain the question, and require an explicit REPLAY.

## VIDEO

Before play, the question is visible and its current video is prepared in an inert hidden frame. PLAY or REPLAY reveals the same 16:9 player. STOP and finish pause and hide that frame; navigation or error releases it. Question copy stays within the safe area. The local error fallback is immediate; same-device playback state is then relayed to the authenticated moderator tab for authoritative publication. There is no automatic answer reveal or navigation.

## RECAP

Recap AUDIO/VIDEO has one visible player on the projector. Moderator PLAY/STOP/REPLAY commands are remote, the player starts on an explicit command and preserves the question clip bounds by default. Only the explicit full-original choice starts at zero without an end bound. The visible standard YouTube controls on the projector provide pause, seek, current time, and duration without mounting a competing moderator player. Mirroring that timeline back into the moderator window is a future same-device enhancement, not a guarantee of this foundation.

## YouTube limitations

### Explicit original-video playback after reveal

The moderator and private rehearsal expose **Přehrát celé původní video z YouTube** only for a revealed answer with a supported original source. Ordinary PLAY keeps the prepared clip as its source. The optional `playMedia.mode = original` request is revision checked and requires current scoped answer-read permission in addition to live control. The server rejects it before an explicit reveal. It stores `mediaPlaybackMode: original` for that playback lifecycle, publishes the canonical YouTube URL in the existing `mediaSource` field only after reveal, starts at zero without an end bound, and marks the public payload with that mode. Official in-app player controls provide seeking. No provenance object is published. Selecting another recap question, revealing/hiding an answer, navigation, result entry/return and session closure reset the original mode; ordinary PLAY also returns to the prepared clip.

An imported clip's private `driveImportProvenance.mediaSource` is bound to its currently attached asset by comparing the asset ID to SHA-256 of the existing `['drive-asset-v1', importJobId]` recipe. This server-only check prevents old provenance from selecting the wrong original after a manual media replacement and adds no database reads. Private read views expose only the canonical derived URL to staff with answer-read permission. Public parsers reject original mode without an active revealed recap, a YouTube source, a zero start or with a clip end.

Release this contract with the web app and the live publication/reset writers together: `createLiveSession`, `endLiveSession`, `finishMedia`, `goToSlide`, `hideAnswer`, `nextSlide`, `playMedia`, `previousSlide`, `reportMediaPlayback`, `replayMedia`, `revealAnswer`, `selectRecapQuestion`, `startIntro`, `stopMedia`, `createEventLiveSession`, `controlInterimResults`, `controlFinalReveal`, `cancelEvent`, `archiveEvent`, `trashEvent`, and `readAccessData`. The result controllers share the reset/publication helpers; event close operations must clear playback as they close sessions. `previewInterimResults` and `previewFinalResults` import shared session readers but do not publish or reset playback. No Rules, indexes, secret bindings or migration is required. This is deployment inventory only, not authorization to deploy.

YouTube behavior is **BEST EFFORT**, not a spoiler-free guarantee. The implementation uses the documented IFrame API and does not obscure, background, or extract audio from a player. YouTube may display title, thumbnail, channel, branding, ads, errors, region/age restrictions, and controls; requested start can resolve to a nearby keyframe. A browser can also block scripted playback. See the official [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference), [player parameters](https://developers.google.com/youtube/player_parameters), [required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality), and [developer policies](https://developers.google.com/youtube/terms/developer-policies).

Owned audio/video uses the native adapter. See [MEDIA_PLAYBACK_REVALIDATION.md](MEDIA_PLAYBACK_REVALIDATION.md) for resource retention, conditional byte reuse and its authorization checks.

## Owned image/audio

See [MEDIA_STORAGE.md](MEDIA_STORAGE.md). The owned adapter shares commands, generations, callbacks, reducer and player budget. It uses immutable quiz assets through the authorized gateway; legacy YouTube/HTTP sources continue to use their existing paths. Uploaded answer/background/video media and physical cleanup are outside this foundation.
