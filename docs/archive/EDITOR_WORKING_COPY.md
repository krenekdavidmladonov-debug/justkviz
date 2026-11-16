# Shared editor working copy

Existing questions, round settings, system slides and quiz metadata retain edits when selecting another item. **Uložit vše** or Ctrl+S validates the whole working copy before writing. Leaving the editor offers save, discard or cancel; reloading warns about unsaved changes.

The working copy exists only in memory inside the current authorization context. It is not autosave, disk recovery or version history. A new question/system slide must still be saved or discarded before navigating away. Structural operations require saving or discarding first.

## Save and conflict behavior

The client calls the existing authenticated, revision-checked mutations sequentially. This is not one atomic transaction: acknowledged changes remain saved if a later operation fails. The editor retains only unacknowledged work and retries it from the last acknowledged revision. Metadata is saved last. A lost response preserves the previous revision, so retrying cannot silently overwrite a newer revision or duplicate a creation. On conflict, remaining local changes stay visible; discarding and reloading requires an explicit confirmation.

After confirming discard and reload, editing, saving and selection remain locked until the authoritative read finishes. A failed read preserves the working copy and releases the lock for retry; a delayed response cannot silently replace work entered during the reload.

No collections, Security Rules, authorization boundaries, event snapshots or public answer projection change. Draft content is not written to browser persistence.

## Validation

Unit tests cover draft overlays, revision sequencing, partial failure/retry, lost responses, metadata failure and acknowledged creations. The emulator browser suite tests/browser/editor-save-all.spec.mjs covers navigation, Ctrl+S, leaving/discarding, validation of inactive questions, metadata/round edits, partial failure and lost responses. CI runs it after the existing seeded editor workflow. Full editor scenarios also exercise creating all supported question types.
