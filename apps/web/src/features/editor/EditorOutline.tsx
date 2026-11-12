import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { SemanticQuizModel, SemanticRound } from './semanticModel';
import { questionSummary, questionTypeLabels, semanticQuestionType } from './semanticModel';
import type { CreatableQuestionType, EditorSlide } from './types';
import { validateQuestion } from './validation';
import './editorOutline.css';
import { EditorDeleteButton } from './EditorDeleteButton';

const creationLabels: Record<CreatableQuestionType, string> = {
  choice: 'Výběr z možností (ABCD)', free: 'Volná odpověď', image: 'Otázka s obrázkem', audio: 'Otázka se zvukem', video: 'Otázka s videem',
};
type DraggedItem = { readonly kind: 'question' | 'round'; readonly id: string };
// Immutable slides retain their validation across draft keystrokes and drag feedback.
const issueCache = new WeakMap<EditorSlide, ReturnType<typeof validateQuestion>>();
function questionIssues(slide: EditorSlide) {
  let issues = issueCache.get(slide);
  if (!issues) { issues = validateQuestion(slide); issueCache.set(slide, issues); }
  return issues;
}

export function EditorOutline({ model, selectedKey, activeDraft, disabled, disabledReason, creationDisabled = disabled, pickerRoundId,
  onSelect, onOpenPicker, onClosePicker, onCreateQuestion, onAddRound, onAddClosing, onAddInfo, onMove, onMoveRound,
  onDeleteQuestion, onDeleteRound, deleteDisabled = disabled, questionDeleteDisabled = deleteDisabled, deleteDisabledReason,
}: {
  readonly model: SemanticQuizModel;
  readonly selectedKey: string;
  readonly activeDraft: EditorSlide | null;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly creationDisabled?: boolean;
  readonly pickerRoundId: string | null;
  readonly onSelect: (key: string) => void;
  readonly onOpenPicker: (roundId: string) => void;
  readonly onClosePicker: () => void;
  readonly onCreateQuestion: (round: SemanticRound, type: CreatableQuestionType) => void;
  readonly onAddRound: () => void;
  readonly onAddClosing?: () => void;
  readonly onAddInfo?: () => void;
  readonly onMove: (id: string, roundId: string | undefined, beforeId?: string) => Promise<boolean>;
  readonly onMoveRound?: (id: string, beforeId?: string) => Promise<boolean>;
  readonly onDeleteQuestion?: (slide: EditorSlide) => void;
  readonly onDeleteRound?: (round: SemanticRound) => void;
  readonly deleteDisabled?: boolean;
  readonly questionDeleteDisabled?: boolean;
  readonly deleteDisabledReason?: string;
}) {
  const selectedRoundId = selectedKey.startsWith('round:') ? selectedKey.slice(6)
    : activeDraft?.roundId ?? (selectedKey.startsWith('slide:') ? model.slideById.get(selectedKey.slice(6))?.roundId : undefined);
  const dragged = useRef<DraggedItem | null>(null);
  const outlineRef = useRef<HTMLElement | null>(null);
  const movePending = useRef(false);
  const [dragging, setDragging] = useState<DraggedItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  // Start with a compact overview. Existing toggles persist; newly added rounds
  // are not in this initial set and therefore open immediately.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(
    model.rounds.filter(round => round.id !== selectedRoundId).map(round => round.id),
  ));
  const [screensOpen, setScreensOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  useEffect(() => {
    function closeMenus(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      const target = event.target;
      outlineRef.current?.querySelectorAll<HTMLDetailsElement>('.outline-item-actions[open]').forEach(menu => {
        if (event instanceof KeyboardEvent || !(target instanceof Node) || !menu.contains(target)) menu.open = false;
      });
    }
    document.addEventListener('pointerdown', closeMenus);
    document.addEventListener('keydown', closeMenus);
    return () => { document.removeEventListener('pointerdown', closeMenus); document.removeEventListener('keydown', closeMenus); };
  }, []);
  const locked = disabled || moving;
  const createLocked = creationDisabled || moving;
  const rounds = useMemo(() => model.rounds.filter(round => round.id !== 'roundless'), [model.rounds]);
  const questionCount = model.questionBySlideId.size;
  useEffect(() => {
    // Following a validation link or selecting a question reveals its parent.
    if (selectedRoundId) setCollapsed(previous => {
      if (!previous.has(selectedRoundId)) return previous;
      const next = new Set(previous); next.delete(selectedRoundId); return next;
    });
  }, [selectedKey, selectedRoundId]);
  useEffect(() => {
    if (selectedKey.startsWith('system:') || selectedKey.startsWith('results:')
      || model.closing.some(slide => selectedKey === `slide:${slide.id}`)
      || model.legacy.some(slide => selectedKey === `slide:${slide.id}`)) setScreensOpen(true);
  }, [selectedKey, model.closing, model.legacy]);
  function clearDrag() { dragged.current = null; setDragging(null); setDropTarget(null); }
  async function move(item: DraggedItem, roundId?: string, beforeId?: string) {
    clearDrag();
    if (locked || movePending.current || item.id === beforeId) return;
    outlineRef.current?.querySelectorAll<HTMLDetailsElement>('.outline-item-actions[open]').forEach(menu => { menu.open = false; });
    movePending.current = true; setMoving(true);
    setAnnouncement(item.kind === 'round' ? 'Přesouvám kolo…' : 'Přesouvám otázku…');
    try {
      const success = item.kind === 'round' ? await onMoveRound?.(item.id, beforeId) : await onMove(item.id, roundId, beforeId);
      if (success && roundId) setCollapsed(previous => { const next = new Set(previous); next.delete(roundId); return next; });
      setAnnouncement(success ? (item.kind === 'round' ? 'Kolo přesunuto.' : 'Otázka přesunuta.') : 'Přesun se nezdařil. Zkontrolujte hlášení nad editorem.');
      if (success) requestAnimationFrame(() => document.getElementById(`outline-${item.kind}-${item.id}`)?.focus());
    } catch {
      setAnnouncement('Přesun se nezdařil. Zkuste jej znovu po obnovení editoru.');
    } finally { movePending.current = false; setMoving(false); }
  }
  function startDrag(event: DragEvent, item: DraggedItem) {
    if (locked || movePending.current) { event.preventDefault(); return; }
    dragged.current = item; setDragging(item);
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', `${item.kind}:${item.id}`);
  }
  function allowDrop(event: DragEvent, key: string, kind: DraggedItem['kind']) {
    if (locked || dragged.current?.kind !== kind) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
    setDropTarget(previous => previous === key ? previous : key);
  }
  function toggleRound(id: string) {
    setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  const selected = (key: string) => key === selectedKey ? 'selected' : '';
  const lockedReason = disabledReason ?? 'Přesun je dostupný po uložení změn a dokončení probíhající operace.';
  function questionRow(slide: EditorSlide, round: SemanticRound, index: number, number: number, draft = false) {
    const key = draft ? 'draft' : `slide:${slide.id}`;
    const displayed = selectedKey === key && activeDraft?.id === slide.id ? activeDraft : slide;
    const type = semanticQuestionType(displayed);
    const issues = questionIssues(displayed);
    const issue = issues.find(item => item.severity === 'error') ?? issues[0];
    const item: DraggedItem = { kind: 'question', id: slide.id };
    return <li key={slide.id} data-question-id={slide.id}
      className={`outline-question-row ${dragging?.id === slide.id ? 'drag-source' : ''} ${dropTarget === `before:${slide.id}` ? 'drop-before' : ''} ${dropTarget === `after:${slide.id}` ? 'drop-after' : ''}`}
      onDragOver={event => {
        if (draft || dragged.current?.id === slide.id) return;
        const rect = event.currentTarget.getBoundingClientRect();
        allowDrop(event, `${event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'}:${slide.id}`, 'question');
      }} onDrop={event => {
        if (draft || dragged.current?.kind !== 'question') return;
        event.preventDefault(); event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const beforeId = event.clientY < rect.top + rect.height / 2 ? slide.id : round.questions[index + 1]?.slide.id;
        void move(dragged.current, slide.roundId, beforeId);
      }}>
      {!draft && <button type="button" className="outline-drag-handle" draggable={!locked} disabled={locked}
        aria-label={`Přetáhnout otázku ${number}`} title={locked ? lockedReason : 'Přetáhnout otázku. Bez myši použijte nabídku Přesunout.'}
        onDragStart={event => startDrag(event, item)} onDragEnd={clearDrag} onClick={() => setAnnouncement('Otázku přetáhněte za úchyt, nebo otevřete nabídku Přesunout.')}>⠿</button>}
      <button id={`outline-question-${slide.id}`} type="button" className={`outline-question ${selected(key)}`} aria-current={selectedKey === key ? 'true' : undefined}
        onClick={() => onSelect(key)} onKeyDown={event => {
          if (draft || locked || !event.altKey) return;
          if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); void move(item, slide.roundId, round.questions[index - 1]?.slide.id); }
          if (event.key === 'ArrowDown' && index < round.questions.length - 1) { event.preventDefault(); void move(item, slide.roundId, round.questions[index + 2]?.slide.id); }
        }}>
        <span className="outline-question-number">{number}</span>
        <span><strong>{questionSummary(displayed)}</strong><small>{draft || displayed.authoringStatus === 'draft' ? 'Rozpracováno · ' : ''}{questionTypeLabels[type]}</small></span>
        {issue && <span className={`outline-issue ${issue.severity}`} title={issue.message} aria-label={issue.message}>!</span>}
      </button>
      {!draft && onDeleteQuestion && <EditorDeleteButton compact label={`Smazat otázku ${number}: ${questionSummary(slide)}`} disabled={questionDeleteDisabled || moving} reason={deleteDisabledReason} onClick={() => onDeleteQuestion(slide)} />}
      {!draft && <details className="outline-item-actions"><summary aria-label={`Přesunout otázku ${number}`} title="Přesunout otázku">⋯</summary>
        <div className="outline-action-panel" aria-label={`Přesun otázky ${number}`}>
          <button type="button" disabled={locked || index === 0} onClick={() => void move(item, slide.roundId, round.questions[index - 1]?.slide.id)}>Posunout nahoru</button>
          <button type="button" disabled={locked || index === round.questions.length - 1} onClick={() => void move(item, slide.roundId, round.questions[index + 2]?.slide.id)}>Posunout dolů</button>
          {rounds.length > (round.id === 'roundless' ? 0 : 1) && <label>Přesunout do kola<select aria-label={`Přesunout otázku ${number} do kola`} value="" disabled={locked} onChange={event => { if (event.target.value) void move(item, event.target.value); }}>
            <option value="">Vyberte kolo…</option>{rounds.filter(target => target.id !== round.id).map(target => <option key={target.id} value={target.id}>{target.title}</option>)}
          </select></label>}
          {locked && <small>{lockedReason}</small>}
        </div>
      </details>}
    </li>;
  }
  return <aside ref={outlineRef} className={`editor-outline editor-panel-structure quiz-outline ${dragging ? 'is-dragging' : ''}`} aria-label="Osnova kvízu" aria-busy={moving}
    onDragOver={event => {
      if (!dragged.current) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientY < bounds.top + 40) event.currentTarget.scrollTop -= 18;
      if (event.clientY > bounds.bottom - 40) event.currentTarget.scrollTop += 18;
    }}>
    <header className="outline-heading"><div><span>Osnova kvízu</span><strong>{rounds.length} kol · {questionCount} otázek</strong></div>
      <button type="button" className={`outline-root-button ${selected('quiz')}`} aria-current={selectedKey === 'quiz' ? 'true' : undefined} onClick={() => onSelect('quiz')}>Název a nastavení kvízu</button>
    </header>
    <span className="outline-move-status" role="status" aria-live="polite">{announcement}</span>
    <section className="outline-section outline-rounds" aria-label="Kola a otázky">
      {model.rounds.length === 0 && <p className="outline-empty">Začněte prvním kolem. Potom přidejte otázky.</p>}
      {model.rounds.map(round => {
        const expanded = !collapsed.has(round.id) || pickerRoundId === round.id;
        const active = selectedRoundId === round.id;
        const roundIndex = rounds.findIndex(item => item.id === round.id);
        const roundItem: DraggedItem = { kind: 'round', id: round.id };
        return <section key={round.id} className={`outline-round ${active ? 'active-round' : ''} ${dragging?.kind === 'round' && dragging.id === round.id ? 'drag-source' : ''} ${dropTarget === `round-before:${round.id}` ? 'drop-before' : ''} ${dropTarget === `round-after:${round.id}` ? 'drop-after' : ''}`} data-round-id={round.id}>
          <div className={`outline-round-header ${dropTarget === `end:${round.id}` ? 'drop-active' : ''}`}
            onDragOver={event => {
              if (round.id === 'roundless') return;
              if (dragged.current?.kind === 'question') allowDrop(event, `end:${round.id}`, 'question');
              else if (dragged.current?.id !== round.id) {
                const rect = event.currentTarget.getBoundingClientRect();
                allowDrop(event, `round-${event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'}:${round.id}`, 'round');
              }
            }} onDrop={event => {
              if (!dragged.current || round.id === 'roundless') return;
              event.preventDefault(); event.stopPropagation();
              if (dragged.current.kind === 'question') { void move(dragged.current, round.id); return; }
              const rect = event.currentTarget.getBoundingClientRect();
              void move(dragged.current, undefined, event.clientY < rect.top + rect.height / 2 ? round.id : rounds[roundIndex + 1]?.id);
            }}>
            {round.id !== 'roundless' && onMoveRound && <button type="button" className="outline-drag-handle" draggable={!locked} disabled={locked}
              aria-label={`Přetáhnout kolo ${round.title}`} title={locked ? lockedReason : 'Přetáhnout kolo. Bez myši použijte nabídku Přesunout.'}
              onDragStart={event => startDrag(event, roundItem)} onDragEnd={clearDrag} onClick={() => setAnnouncement('Kolo přetáhněte za úchyt, nebo otevřete nabídku Přesunout.')}>⠿</button>}
            <button type="button" className="outline-collapse" aria-expanded={expanded} aria-controls={`round-questions-${round.id}`} aria-label={`${expanded ? 'Sbalit' : 'Rozbalit'} kolo ${round.title}`} onClick={() => toggleRound(round.id)}>{expanded ? '▾' : '▸'}</button>
            <button id={`outline-round-${round.id}`} type="button" className={`outline-round-select ${selected(`round:${round.id}`)}`} aria-current={selectedKey === `round:${round.id}` ? 'true' : undefined} onClick={() => onSelect(`round:${round.id}`)}>
              <strong>{round.title}</strong><small>{round.id === 'roundless' ? 'Bez kola' : `${round.position}. kolo`} · {round.questions.length} otázek</small>
            </button>
            {round.id !== 'roundless' && onDeleteRound && <EditorDeleteButton compact label={`Smazat kolo ${round.title}`} disabled={deleteDisabled || moving} reason={deleteDisabledReason} onClick={() => onDeleteRound(round)} />}
            {round.id !== 'roundless' && onMoveRound && <details className="outline-item-actions"><summary aria-label={`Přesunout kolo ${round.title}`} title="Přesunout kolo">⋯</summary><div className="outline-action-panel">
              <button type="button" disabled={locked || roundIndex === 0} onClick={() => void move(roundItem, undefined, rounds[roundIndex - 1]?.id)}>Posunout nahoru</button>
              <button type="button" disabled={locked || roundIndex === rounds.length - 1} onClick={() => void move(roundItem, undefined, rounds[roundIndex + 2]?.id)}>Posunout dolů</button>
              {locked && <small>{lockedReason}</small>}
            </div></details>}
            {dropTarget === `end:${round.id}` && <span className="outline-round-drop-hint">Přesunout na konec kola</span>}
          </div>
          {expanded && <div id={`round-questions-${round.id}`} className="outline-round-content">
            <ol>{round.questions.map((question, index) => questionRow(question.slide, round, index, question.number))}
              {selectedKey === 'draft' && activeDraft?.isQuestion === true && activeDraft.roundId === round.id && questionRow(activeDraft, round, round.questions.length, activeDraft.questionNumber ?? round.questions.length + 1, true)}
            </ol>
            {round.questions.length === 0 && selectedKey !== 'draft' && <p className="outline-empty">Kolo je zatím prázdné.</p>}
            {round.id !== 'roundless' && <div className={`outline-drop-end ${dropTarget === `end:${round.id}` ? 'drop-active' : ''}`} onDragOver={event => allowDrop(event, `end:${round.id}`, 'question')} onDrop={event => {
              if (dragged.current?.kind !== 'question') return;
              event.preventDefault(); event.stopPropagation(); void move(dragged.current, round.id);
            }}>{dragging?.kind === 'question' ? 'Přesunout na konec kola' : ''}</div>}
            {round.id === 'roundless' ? <p className="field-help">Otázky lze přesunout do kola přes úchyt nebo nabídku.</p>
              : <div className="outline-add-question"><button type="button" className="add-question-button" disabled={createLocked} onClick={() => onCreateQuestion(round, 'free')}>+ Přidat otázku</button><button type="button" className="outline-type-button" disabled={createLocked} aria-label={`Další typy otázek pro kolo ${round.title}`} title="Výběr z možností, obrázek, zvuk nebo video" onClick={() => onOpenPicker(round.id)}>Další typy</button></div>}
            {round.id !== 'roundless' && pickerRoundId === round.id && <div className="question-type-picker" role="dialog" aria-label={`Typ otázky pro ${round.position}. kolo`}>
              <strong>Jakou otázku chcete přidat?</strong>{(Object.keys(creationLabels) as CreatableQuestionType[]).map(type => <button key={type} type="button" disabled={createLocked} onClick={() => onCreateQuestion(round, type)}>{creationLabels[type]}</button>)}
              <button type="button" className="type-picker-cancel" onClick={onClosePicker}>Zrušit</button>
            </div>}
            {(round.recaps.length > 0 || round.otherSystemSlides.length > 0) && <details className="outline-round-screens" open={[...round.recaps, ...round.otherSystemSlides].some(slide => selectedKey === `slide:${slide.id}`)}><summary>Další obrazovky kola</summary>
              {round.recaps.map(slide => <button key={slide.id} type="button" className={`outline-system-item ${selected(`slide:${slide.id}`)}`} onClick={() => onSelect(`slide:${slide.id}`)}>Rekapitulace</button>)}
              {round.otherSystemSlides.map(slide => <button key={slide.id} type="button" className={`outline-system-item ${selected(`slide:${slide.id}`)}`} onClick={() => onSelect(`slide:${slide.id}`)}>{slide.title || 'Informační obrazovka'}</button>)}
            </details>}
          </div>}
        </section>;
      })}
      <button type="button" className="secondary-button add-round-button" disabled={createLocked} onClick={onAddRound}>+ Přidat kolo</button>
      {locked && !moving && <p className="field-help outline-disabled-reason">{lockedReason}</p>}
    </section>
    <details className="outline-section outline-extra-screens" open={screensOpen} onToggle={event => setScreensOpen(event.currentTarget.open)}><summary>Úvod, výsledky a další obrazovky</summary>
      {screensOpen && <>
        <h2>Úvod kvízu</h2>{model.introduction.map(section => <button key={section.key} type="button" className={`outline-system-item ${selected(`system:${section.key}`)}`} onClick={() => onSelect(`system:${section.key}`)}><span>{section.label}</span>{section.generated && (section.key !== 'agenda' || section.slide?.automaticAgenda === true) && <small>Automaticky</small>}</button>)}
        {onAddInfo && <button type="button" className="outline-system-item" disabled={createLocked} onClick={onAddInfo}>+ Přidat informaci nebo přestávku</button>}
        <h2>Výsledky</h2><button type="button" className={`outline-system-item ${selected('results:interim')}`} onClick={() => onSelect('results:interim')}>Průběžné pořadí</button><button type="button" className={`outline-system-item ${selected('results:final')}`} onClick={() => onSelect('results:final')}>Finální vyhlášení</button>
        <p className="field-help">Moderátor je zobrazí po publikaci výsledků.</p>
        {model.closing.map(slide => <button key={slide.id} type="button" className={`outline-system-item ${selected(`slide:${slide.id}`)}`} onClick={() => onSelect(`slide:${slide.id}`)}>Závěr kvízu</button>)}
        {model.closing.length === 0 && onAddClosing && <button type="button" className="outline-system-item" disabled={createLocked} onClick={onAddClosing}>+ Přidat závěr kvízu</button>}
        {model.legacy.map(slide => <button key={slide.id} type="button" className={`outline-system-item ${selected(`slide:${slide.id}`)}`} onClick={() => onSelect(`slide:${slide.id}`)}>{slide.title || 'Informační obrazovka'}</button>)}
        <details className="outline-full-order" open={orderOpen} onToggle={event => setOrderOpen(event.currentTarget.open)}><summary>Celé pořadí promítání</summary>{orderOpen && <ol className="presentation-outline">{[...model.slideById.values()].sort((a, b) => a.position - b.position).map(slide => {
          const round = model.rounds.find(item => item.settingsSlide?.id === slide.id);
          const section = model.introduction.find(item => item.slide?.id === slide.id);
          const key = section ? `system:${section.key}` : round ? `round:${round.id}` : `slide:${slide.id}`;
          return <li key={slide.id}><button type="button" className={`outline-system-item ${selected(key)}`} onClick={() => onSelect(key)}><span>{slide.position}. {slide.isQuestion ? questionSummary(slide) : slide.title || (round ? 'Úvod kola' : slide.kind === 'recap' ? 'Rekapitulace' : section?.label ?? 'Informační obrazovka')}</span>{slide.hidden && <small>Skryté</small>}</button></li>;
        })}</ol>}</details>
      </>}
    </details>
  </aside>;
}
