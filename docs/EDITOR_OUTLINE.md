# Direct question movement in the editor outline

The editor has one workspace: the left outline, the question form and the existing preview. There is no separate storyboard view or view switch. Question text is primary in outline rows, with type and draft state secondary.

Drag the question row within the left outline. The insertion line marks before/after the hovered question. Questions can move between rounds, onto a round heading or into its end slot, including empty rounds. Round headings open while hovered during a drag; the outline scrolls near its edges. End slots reserve their space so drag start does not shift target rows. Alt+Up/Down moves the focused question within its round; existing form controls remain available as alternatives.

Selection and shared in-memory content edits remain in the original form. Structural operations require saved content and current edit permission; uploads and in-flight mutations lock further moves. Successful movement restores focus and announces completion.

The existing revision-protected operations are reused. A cross-round move appends then performs adjacent moves to reach the requested position. A failure stops the sequence and reads the persisted order. Long moves are not atomic and can be partly applied; the error explains this. No backend, collection, authorization, snapshot or public projection changes.

Verification: browser coverage exercises drag before/after questions in the left outline, moving between rounds with numbering, keyboard movement/focus, retaining unsaved content and interrupted-move recovery alongside save-all scenarios. Unit coverage checks acknowledged revisions and stopping on failure. Desktop native drag is covered; touch dragging is not claimed.

The left outline's **Celé pořadí promítání** section lists the saved program,
including standalone announcements and breaks. Move an announcement with its
drag handle or the keyboard-accessible destination menu. The exact move uses
one revision-checked transaction and preserves round membership. Automatic
agendas follow the saved order of visible announcements and round headers.
