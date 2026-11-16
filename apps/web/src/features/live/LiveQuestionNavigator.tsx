import { useEffect, useId, useMemo, useRef, useState } from 'react';

import type { LiveControlSlide } from './types';
import './question-navigator.css';

interface QuestionGroup { readonly key: string; readonly title: string; readonly questions: readonly LiveControlSlide[] }

/** Derive navigation only from the private, current session source (including frozen event snapshots). */
export function questionNavigationGroups(slides: readonly LiveControlSlide[]): readonly QuestionGroup[] {
  const groups = new Map<string, { key: string; title: string; questions: LiveControlSlide[] }>();
  let fallbackRound = 0;
  for (const slide of [...slides].sort((a, b) => a.position - b.position)) {
    const kind = slide.kind.toLowerCase();
    const roundHeader = !slide.isQuestion && ['round', 'roundheader', 'round-header', 'section'].includes(kind);
    if (roundHeader) fallbackRound++;
    if (slide.roundId || roundHeader) {
      const key = slide.roundId ? `round:${slide.roundId}` : `legacy:${fallbackRound}`;
      if (!groups.has(key)) groups.set(key, { key, title: slide.roundTitle?.trim() || (roundHeader ? slide.title.trim() : ''), questions: [] });
    }
    if (slide.isQuestion) {
      const key = slide.roundId ? `round:${slide.roundId}` : `legacy:${fallbackRound}`;
      const group = groups.get(key) ?? { key, title: slide.roundTitle?.trim() || '', questions: [] };
      group.questions.push(slide); groups.set(key, group);
    }
    if (!slide.roundId && kind === 'recap') fallbackRound++;
  }
  return [...groups.values()];
}

export function LiveQuestionNavigator({ slides, currentPosition, disabled, onSelect, onFinale }: {
  readonly slides: readonly LiveControlSlide[];
  readonly currentPosition: number;
  readonly disabled: boolean;
  readonly onSelect: (position: number) => void;
  readonly onFinale?: () => void;
}) {
  const groups = useMemo(() => questionNavigationGroups(slides), [slides]);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const selected = useRef(false);
  const headingId = useId();

  useEffect(() => {
    if (!open) return;
    selected.current = false;
    const modal = dialog.current;
    modal?.showModal();
    (modal?.querySelector<HTMLButtonElement>('[aria-current="page"]') ?? modal?.querySelector<HTMLButtonElement>('.live-question-grid button'))?.focus();
    return () => { modal?.close(); trigger.current?.focus(); };
  }, [open]);

  function choose(action: () => void) {
    if (disabled || selected.current) return;
    selected.current = true; setOpen(false); action();
  }

  return <>
    <button ref={trigger} type="button" className="secondary-button live-wide-action" disabled={disabled || (groups.length === 0 && !onFinale)} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>Přejít na otázku</button>
    {open && <dialog ref={dialog} className="live-question-navigator" aria-modal="true" aria-labelledby={headingId} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }} onCancel={event => { event.preventDefault(); setOpen(false); }}>
      <header><div><span className="panel-label">Soukromá navigace moderátora</span><h2 id={headingId}>Přejít na otázku</h2></div><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Zavřít</button></header>
      <p>Vyberte kolo a otázku. Zobrazí se zadání se skrytou odpovědí.</p>
      <div className="live-question-groups">
        {groups.map((group, roundIndex) => {
          const label = `${roundIndex + 1}. kolo${group.title ? ` · ${group.title}` : ''}`;
          return <section key={group.key} aria-label={label}>
            <h3>{label}</h3>
            {group.questions.length === 0 && <p className="field-help">Kolo zatím nemá otázky.</p>}
            <div className="live-question-grid">{group.questions.map((question, index) => <button key={question.id} type="button" className="secondary-button" aria-label={`${roundIndex + 1}. kolo, otázka ${index + 1}`} aria-current={question.position === currentPosition ? 'page' : undefined} disabled={disabled} onClick={() => choose(() => onSelect(question.position))}>{index + 1}</button>)}</div>
          </section>;
        })}
      </div>
      {onFinale && <footer><button type="button" className="secondary-button live-wide-action" disabled={disabled} onClick={() => choose(onFinale)}>Finální výsledky</button></footer>}
    </dialog>}
  </>;
}
