/** Measure the wrapped recap on its actual canvas, including the prompt and option letter. */
export function observeRecapFit(stage: HTMLElement, onFit?: (tooSmall: boolean) => void) {
  const layout = stage.querySelector<HTMLElement>('.slide-layout');
  const answer = layout?.querySelector<HTMLElement>('.slide-answer-value > strong');
  if (!layout || !answer) return;
  const blocks = Array.from(layout.querySelectorAll<HTMLElement>('.slide-answer, .slide-copy, .slide-question-label'));
  const photoColumn = layout.querySelector<HTMLElement>('.fixed-photo-copy, .answer-focus-copy');

  function measure() {
    if (!layout || !answer || !stage.clientWidth || !layout.clientHeight) return;
    stage.removeAttribute('data-wide-answer');
    layout.style.removeProperty('--slide-scale');
    const authoredScale = Number(getComputedStyle(layout).getPropertyValue('--slide-scale'));
    const fits = (scale: number) => {
      layout.style.setProperty('--slide-scale', String(scale));
      const area = layout.getBoundingClientRect();
      if (photoColumn && photoColumn.scrollHeight > photoColumn.clientHeight + 1) return false;
      return blocks.every(block => {
        const rect = block.getBoundingClientRect();
        return rect.top >= area.top - 1 && rect.bottom <= area.bottom + 1
          && rect.left >= area.left - 1 && rect.right <= area.right + 1
          && block.scrollWidth <= block.clientWidth + 1;
      });
    };

    let tooSmall = false;
    if (!fits(authoredScale)) {
      // 2% of canvas width is 38.4px on a Full HD projector.
      const fontSize = parseFloat(getComputedStyle(answer).fontSize);
      const readable = Math.min(authoredScale, authoredScale * stage.clientWidth * .02 / fontSize);
      if (!fits(readable)) stage.setAttribute('data-wide-answer', '');
      tooSmall = !fits(readable);
      let lower = tooSmall ? authoredScale / 1024 : readable;
      let upper = authoredScale;
      for (let pass = 0; pass < 12; pass++) {
        const middle = (lower + upper) / 2;
        if (fits(middle)) lower = middle;
        else upper = middle;
      }
      fits(lower);
    }
    if (tooSmall) stage.setAttribute('data-answer-too-long', 'true');
    else stage.removeAttribute('data-answer-too-long');
    onFit?.(tooSmall);
  }

  measure();
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
  observer?.observe(stage);
  stage.addEventListener('load', measure, true);
  document.fonts?.addEventListener('loadingdone', measure);
  return () => {
    observer?.disconnect();
    stage.removeEventListener('load', measure, true);
    document.fonts?.removeEventListener('loadingdone', measure);
    layout.style.removeProperty('--slide-scale');
    stage.removeAttribute('data-answer-too-long');
    stage.removeAttribute('data-wide-answer');
  };
}
