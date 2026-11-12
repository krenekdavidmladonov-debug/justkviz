/** Classifies presentation shortcuts without stealing input or dialog interactions. */
export function liveNavigationDirection(event: KeyboardEvent, allowedDialog?: Element): -1 | 1 | undefined {
  if (event.defaultPrevented || event.repeat || event.isComposing
    || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return undefined;
  const space = event.key === ' ' || event.key === 'Spacebar';
  if (!space && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return undefined;

  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input, textarea, select, summary, a[href], audio, video, iframe, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="listbox"], [role="slider"], [role="spinbutton"], [role="menu"], [role="tablist"]')) return undefined;
  if (space && target?.closest('button, [role="button"]')) return undefined;

  const eventDocument = target?.ownerDocument ?? event.view?.document ?? document;
  if ([...eventDocument.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')]
    .some(dialog => dialog !== allowedDialog && !dialog.closest('[hidden], [aria-hidden="true"]')
      && eventDocument.defaultView?.getComputedStyle(dialog).display !== 'none'
      && eventDocument.defaultView?.getComputedStyle(dialog).visibility !== 'hidden')) return undefined;

  return event.key === 'ArrowLeft' ? -1 : 1;
}
