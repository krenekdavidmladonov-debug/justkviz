# Complete quiz editor contract

The editor manages quiz appearance, round order, question types, protected answers/notes and owned media. Local drafts retain explicit dirty/pending state, authoritative acknowledgements and safe retry behavior. Structural changes must not silently discard unsaved edits. Rehearsal uses saved content through the same immutable snapshot boundary as the live event.

Choice, open, image, audio and video questions are included. A normal authoring journey creates rounds/questions through the UI, saves them, checks media, rehearses and locks an event snapshot. A minimal saved quiz may proceed even when optional editorial warnings remain; warnings are advisory and do not invent or repair content.

Validation includes complete-editor, save-all conflict/retry, outline movement, owned media, editor core workflow, bounded performance/retention, unit tests and demo-emulator authorization tests. Real browser interactions should follow the current controls; fixtures and backend calls must be described separately. CI results require the exact candidate commit.

Historical release receipts and private operator data are intentionally outside this public product documentation. Any future publication/deployment needs concrete approval and current validation.
