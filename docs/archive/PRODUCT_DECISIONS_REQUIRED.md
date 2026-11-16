# Remaining product decisions after projector behavior foundation

This register records the earlier projector/migration foundation. Its deferred list is historical: [event registrations](REGISTRATIONS.md), [private PDF](PRINT_CENTER.md), [scoring](EVENT_SCORING.md), [referee access](REFEREE_ACCESS.md), [final reveal](FINAL_REVEAL.md) and [owned media](MEDIA_AUTHORING_RELEASE.md) now have implemented contracts and acceptance evidence. Current remaining work is tracked in [COMPLETION_MATRIX.md](COMPLETION_MATRIX.md). Legacy-content interpretation remains relevant only to a separately authorized migration/content review; it does not block a newly authored V2 pilot. No new production data was inspected to update this register.

The projector foundation resolved the behavior needed to implement and test the first live flow. This file now lists only decisions that remain genuinely unresolved. None blocks local technical validation of the foundation, and all unresolved V1 values stay private in `legacy.raw`.

## Content review required before a real event

1. Replace or explicitly accept the 25 AUDIO, 22 VIDEO, and 18 IMAGE slides that have no usable normalized source. The current guaranteed fallback is a stable text question plus a moderator warning.
2. Review the three IMAGE records whose source provider is YouTube. They remain classified as image questions and are not guessed into video behavior.
3. Decide whether the 21 meaningful `optionsStr` values contain alternate authored presentation copy. Canonical `options` is rendered; `optionsStr` remains losslessly private.
4. Establish the meaning of the single positive `audioTrigger=35`. It has no live behavior until that meaning is known.
5. Establish how the five legacy `recapOverrides` slots align and what `extraText` / `overrideMedia` mean. The new recap is generated from normalized question data; the legacy override array is preserved but not interpreted.

## Decisions deferred with their features

- Owned/direct media ingestion, licenses, checksums, transcoding, preflight, upload UI, and cache eviction.
- Whether trusted admin devices may opt into persistent Firestore cache; memory-only behavior remains the safe default.
- Results mode: manual last-to-first rank reveal is the intended direction, but tie ranking, winner music, and final animation need a separate product decision.
- Events and registrations, printable answer sheets/PDF, referee tools, live scoring, and digital answering. Digital answering must not introduce a speed bonus without a separate explicit decision.
- Accessibility authoring beyond the current keyboard focus and reduced-motion foundation: captions, audio descriptions, and per-media alt text.
- Analytics retention. Diagnostics must remain structural and must not log prompt, answer, note, media URL, contact, or legacy raw values.

## Resolved decisions

- PL is **Pravda / Lež**, migration-only, recap-capable, and cannot be created from the normal editor type picker.
- IMAGE uses a separate contained question-image region; it is not a fullscreen background by default.
- Media is always moderator-initiated and never auto-advances or auto-reveals.
- Normal AUDIO uses a visible moderator YouTube player on the laptop and no projector iframe.
- Normal VIDEO uses a visible projector player only while playing; stop/finish returns to the question.
- Recap selects one answer at a time in arbitrary order and is the normal answer-publication flow.
- Timing is stored as numeric seconds, edited as `mm:ss` / `hh:mm:ss` with tenths supported, and an absent end is never guessed.
- Background overlay is black opacity in the 0–100 range with text above it.
- Missing/failed media keeps a stable text question and shows a clear moderator-side warning.
- One active heavy player per projector; no preload in this foundation.
