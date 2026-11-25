import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { canHideInfoSlide, questionRoundAtGap } from '@filmovy-kviz/quiz-domain';
import type { SemanticQuizModel, SemanticRound } from './semanticModel';
import { questionSummary, questionTypeLabels, semanticQuestionType } from './semanticModel';
import type { CreatableQuestionType, EditorSlide } from './types';
import { validateQuestion } from './validation';
import './editorOutline.css';
import { EditorDeleteButton } from './EditorDeleteButton';

const creationLabels: Record<CreatableQuestionType, string> = {
  choice: 'Výběr z možností (ABCD)', free: 'Volná odpověď', image: 'Otázka s obrázkem', audio: 'Otázka se zvukem', video: 'Otázka s videem',
};
const screenLabels = {
  intro: 'Úvodní obrazovka', rules: 'Pravidla', agenda: 'Harmonogram', round: 'Kolo s úvodem a rekapitulací',
  recap: 'Rekapitulace kola', title: 'Titulní snímek', info: 'Informační snímek', pause: 'Přestávka', 'thank-you': 'Poděkování', end: 'Závěr kvízu',
} as const;
export type EveningItem = CreatableQuestionType | keyof typeof screenLabels;
type DraggedItem = { readonly kind: 'question' | 'round' | 'announcement'; readonly id: string };
const moveMessages = {
  question: ['Přesouvám otázku…', 'Otázka přesunuta.'],
  round: ['Přesouvám kolo…', 'Kolo přesunuto.'],
  announcement: ['Přesouvám sdělení…', 'Sdělení přesunuto.'],
} as const;

function isAnnouncement(slide: EditorSlide | undefined): slide is EditorSlide {
  return slide !== undefined && !slide.isQuestion && !slide.roundId && (slide.kind === 'info' || slide.kind === 'title');
}
// Immutable slides retain their validation across draft keystrokes and drag feedback.
const issueCache = new WeakMap<EditorSlide, ReturnType<typeof validateQuestion>>();
function questionIssues(slide: EditorSlide) {
  let issues = issueCache.get(slide);
  if (!issues) { issues = validateQuestion(slide); issueCache.set(slide, issues); }
  return issues;
}

export function EditorOutline({ model, selectedKey, activeDraft, disabled, disabledReason, creationDisabled = disabled,
  onSelect, onInsert, onAddRound, onMove, onMoveRound, onMoveSlide,
  onDeleteQuestion, onDeleteRound, deleteDisabled = disabled, questionDeleteDisabled = deleteDisabled, deleteDisabledReason,
}: {
  readonly model: SemanticQuizModel;
  readonly selectedKey: string;
  readonly activeDraft: EditorSlide | null;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly creationDisabled?: boolean;
  readonly onSelect: (key: string) => void;
  readonly onInsert: (beforeId: string | null, type: EveningItem) => void;
  readonly onAddRound: () => void;
  readonly onMove: (id: string, roundId: string | undefined, beforeId?: string) => Promise<boolean>;
  readonly onMoveRound?: (id: string, beforeId?: string) => Promise<boolean>;
  readonly onMoveSlide?: (id: string, beforeId: string | null) => Promise<boolean>;
  readonly onDeleteQuestion?: (slide: EditorSlide) => void;
  readonly onDeleteRound?: (round: SemanticRound) => void;
  readonly deleteDisabled?: boolean;
  readonly questionDeleteDisabled?: boolean;
  readonly deleteDisabledReason?: string;
}) {
  const dragged = useRef<DraggedItem | null>(null);
  const outlineRef = useRef<HTMLElement | null>(null);
  const movePending = useRef(false);
  const [dragging, setDragging] = useState<DraggedItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const gapTrigger = useRef<HTMLButtonElement | null>(null);
  const [openGap, setOpenGap] = useState<string | null>(null);
  useEffect(() => {
    function closeMenus(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      const target = event.target;
      if (event instanceof KeyboardEvent && target instanceof Element && target.closest('.question-type-picker')) gapTrigger.current?.focus();
      if (event instanceof KeyboardEvent || !(target instanceof Element) || !target.closest('.outline-gap')) setOpenGap(null);
      outlineRef.current?.querySelectorAll<HTMLDetailsElement>('.outline-item-actions[open]').forEach(menu => {
        if (target instanceof Element && target.closest('dialog')) return;
        if (event instanceof KeyboardEvent || !(target instanceof Node) || !menu.contains(target)) {
          if (event instanceof KeyboardEvent && menu.contains(target as Node)) menu.querySelector('summary')?.focus();
          menu.open = false;
        }
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
  const presentationSlides = useMemo(() => [...model.slideById.values()].sort((a, b) => a.position - b.position), [model.slideById]);
  const selectedSlide = selectedKey.startsWith('slide:') ? model.slideById.get(selectedKey.slice(6)) : undefined;
  const selectedAnnouncement = onMoveSlide && isAnnouncement(selectedSlide) ? selectedSlide : undefined;
  const lastDestination = presentationSlides.length;
  function clearDrag() { dragged.current = null; setDragging(null); setDropTarget(null); }
  async function move(item: DraggedItem, roundId?: string, beforeId?: string) {
    clearDrag();
    if (locked || movePending.current || item.id === beforeId) return;
    if (item.kind === 'announcement') {
      const source = presentationSlides.findIndex(slide => slide.id === item.id);
      if (source < 0 || beforeId === presentationSlides[source + 1]?.id) return;
    }
    outlineRef.current?.querySelectorAll<HTMLDetailsElement>('.outline-item-actions[open]').forEach(menu => { menu.open = false; });
    movePending.current = true; setMoving(true);
    const [pendingMessage, successMessage] = moveMessages[item.kind];
    setAnnouncement(pendingMessage);
    try {
      let success;
      switch (item.kind) {
        case 'round': success = await onMoveRound?.(item.id, beforeId); break;
        case 'announcement': success = await onMoveSlide?.(item.id, beforeId ?? null); break;
        default: success = await onMove(item.id, roundId, beforeId);
      }
      setAnnouncement(success ? successMessage : 'Přesun se nezdařil. Zkontrolujte hlášení nad editorem.');
      if (success) requestAnimationFrame(() => document.getElementById(`outline-${item.kind}-${item.id}`)?.focus());
    } catch {
      setAnnouncement('Přesun se nezdařil. Zkuste jej znovu po obnovení editoru.');
    } finally { movePending.current = false; setMoving(false); }
  }
  function startDrag(event: DragEvent, item: DraggedItem) {
    if (locked || movePending.current) { event.preventDefault(); return; }
    dragged.current = item; setDragging(item);
    event.dataTransfer.effectAllowed = 'move';
  }
  function allowDrop(event: DragEvent, key: string, kind: DraggedItem['kind']) {
    if (locked || dragged.current?.kind !== kind) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
    setDropTarget(previous => previous === key ? previous : key);
  }
  function dragAfter(event: DragEvent) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY >= bounds.top + bounds.height / 2;
  }
  function allowAnnouncementDrop(event: DragEvent, position: number, key: string) {
    if (dragged.current?.kind !== 'announcement') return;
    if (position > lastDestination) { setDropTarget(null); return; }
    allowDrop(event, key, 'announcement');
  }
  function dropAnnouncement(event: DragEvent, position: number) {
    const item = dragged.current;
    if (locked || item?.kind !== 'announcement' || position > lastDestination) return;
    event.preventDefault(); event.stopPropagation();
    void move(item, undefined, presentationSlides[position]?.id);
  }
  function orderLabel(slide: EditorSlide) {
    const round = model.rounds.find(item => item.settingsSlide?.id === slide.id);
    const section = model.introduction.find(item => item.slide?.id === slide.id);
    const key = section ? `system:${section.key}` : round ? `round:${round.id}` : `slide:${slide.id}`;
    const label = slide.isQuestion ? questionSummary(slide) : slide.title
      || (round ? 'Úvod kola' : slide.kind === 'recap' ? 'Rekapitulace' : section?.label ?? 'Informační obrazovka');
    return { key, label };
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
    return <div data-question-id={slide.id}
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
        <span><strong>{questionSummary(displayed)}</strong><small>{draft || displayed.authoringStatus === 'draft' ? 'Rozpracováno · ' : ''}{questionTypeLabels[type]} · {draft || displayed.authoringStatus === 'draft' || issues.some(item => item.severity === 'error') ? 'Je potřeba doplnit' : 'Promítá se'}</small></span>
        {issue && <span className={`outline-issue ${issue.severity}`} title={issue.message} aria-label={issue.message}>!</span>}
      </button>
      {!draft && <details className="outline-item-actions"><summary aria-label={`Další akce otázky ${number}`} title="Další akce otázky">⋯</summary>
        <div className="outline-action-panel" aria-label={`Přesun otázky ${number}`}>
          <button type="button" disabled={locked || index === 0} onClick={() => void move(item, slide.roundId, round.questions[index - 1]?.slide.id)}>Posunout nahoru</button>
          <button type="button" disabled={locked || index === round.questions.length - 1} onClick={() => void move(item, slide.roundId, round.questions[index + 2]?.slide.id)}>Posunout dolů</button>
          {rounds.length > (round.id === 'roundless' ? 0 : 1) && <label>Přesunout do kola<select aria-label={`Přesunout otázku ${number} do kola`} value="" disabled={locked} onChange={event => { if (event.target.value) void move(item, event.target.value); }}>
            <option value="">Vyberte kolo…</option>{rounds.filter(target => target.id !== round.id).map(target => <option key={target.id} value={target.id}>{target.title}</option>)}
          </select></label>}
          {onDeleteQuestion && <EditorDeleteButton label={`Smazat otázku ${number}: ${questionSummary(slide)}`} disabled={questionDeleteDisabled || moving} reason={deleteDisabledReason} onClick={() => onDeleteQuestion(slide)} />}
          {locked && <small>{lockedReason}</small>}
        </div>
      </details>}
    </div>;
  }
  function gap(beforeId: string | null) {
    const id = beforeId ?? '';
    const upcoming = beforeId === null ? undefined : model.slideById.get(beforeId);
    const gapRoundId = openGap === id ? questionRoundAtGap(presentationSlides.map(slide => slide.roundId), (upcoming?.position ?? presentationSlides.length + 1) - 1, upcoming?.isQuestion || upcoming?.kind === 'recap') : undefined;
    return <div className="outline-gap" data-before={id}>
      <button type="button" className="outline-insert" disabled={createLocked} aria-expanded={openGap === id}
        onClick={event => { gapTrigger.current = event.currentTarget; setOpenGap(openGap === id ? null : id); }}>Přidat sem</button>
      {openGap === id && <div className="question-type-picker" role="dialog" aria-label="Přidat do osnovy">
        <small>{gapRoundId ? `Otázky a rekapitulace patří do kola ${roundById.get(gapRoundId)?.title}.` : 'Přidáním otázky nebo rekapitulace vznikne první kolo.'}</small>
        {(Object.entries({ ...creationLabels, ...screenLabels }) as [EveningItem, string][]).map(([type, label]) =>
          <button key={type} type="button" disabled={createLocked || (type === 'thank-you' && Boolean(model.thankYou))}
            title={type === 'thank-you' && model.thankYou ? 'Poděkování už v osnově je.' : undefined}
            onClick={() => { setOpenGap(null); onInsert(beforeId, type); }}>{label}</button>)}
        <button type="button" onClick={() => { setOpenGap(null); gapTrigger.current?.focus(); }}>Zrušit</button>
      </div>}
    </div>;
  }
  function roundRow(slide: EditorSlide | undefined, round: SemanticRound) {
    const roundIndex = rounds.findIndex(item => item.id === round.id);
    const roundItem: DraggedItem = { kind: 'round', id: round.id };
    return (<div className={`outline-round-header ${dropTarget === `end:${round.id}` ? 'drop-active' : ''}`}
            onDragOver={event => {
              if (round.id === 'roundless') return;
              if (dragged.current?.kind === 'question') allowDrop(event, `end:${round.id}`, 'question');
              else if (dragged.current?.id !== round.id) {
                const rect = event.currentTarget.getBoundingClientRect();
                allowDrop(event, `round-${event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'}:${round.id}`, 'round');
              }
            }} onDrop={event => {
              if (!dragged.current || dragged.current.kind === 'announcement' || round.id === 'roundless') return;
              event.preventDefault(); event.stopPropagation();
              if (dragged.current.kind === 'question') { void move(dragged.current, round.id); return; }
              const rect = event.currentTarget.getBoundingClientRect();
              void move(dragged.current, undefined, event.clientY < rect.top + rect.height / 2 ? round.id : rounds[roundIndex + 1]?.id);
            }}>
            {round.id !== 'roundless' && onMoveRound && <button type="button" className="outline-drag-handle" draggable={!locked} disabled={locked}
              aria-label={`Přetáhnout kolo ${round.title}`} title={locked ? lockedReason : 'Přetáhnout kolo. Bez myši použijte nabídku Přesunout.'}
              onDragStart={event => startDrag(event, roundItem)} onDragEnd={clearDrag} onClick={() => setAnnouncement('Kolo přetáhněte za úchyt, nebo otevřete nabídku Přesunout.')}>⠿</button>}
            <button id={`outline-round-${round.id}`} type="button" className={`outline-round-select ${selected(`round:${round.id}`)}`} aria-current={selectedKey === `round:${round.id}` ? 'true' : undefined} onClick={() => onSelect(`round:${round.id}`)}>
              <strong>{slide?.title || round.title}</strong><small>{slide ? 'Úvod kola · Automatický · Promítá se' : 'Nastavení kola'} · {round.id === 'roundless' ? 'Bez kola' : `${round.position}. kolo`} · {round.questions.length} otázek</small>
            </button>
            {round.id !== 'roundless' && (onMoveRound || onDeleteRound) && <details className="outline-item-actions"><summary aria-label={`Další akce kola ${round.title}`} title="Další akce kola">⋯</summary><div className="outline-action-panel">
              {onMoveRound && <><button type="button" disabled={locked || roundIndex === 0} onClick={() => void move(roundItem, undefined, rounds[roundIndex - 1]?.id)}>Posunout nahoru</button>
              <button type="button" disabled={locked || roundIndex === rounds.length - 1} onClick={() => void move(roundItem, undefined, rounds[roundIndex + 2]?.id)}>Posunout dolů</button></>}
              {onDeleteRound && <EditorDeleteButton label={`Smazat kolo ${round.title}`} disabled={deleteDisabled || moving} reason={deleteDisabledReason} onClick={() => onDeleteRound(round)} />}
              {locked && <small>{lockedReason}</small>}
            </div></details>}
            {dropTarget === `end:${round.id}` && <span className="outline-round-drop-hint">Přesunout na konec kola</span>}
          </div>);
  }
  function slideRow(slide: EditorSlide) {
    const round = roundById.get(slide.roundId ?? 'roundless');
    const question = model.questionBySlideId.get(slide.id);
    if (round && question) return questionRow(slide, round, question.number - 1, question.number);
    if (round && round.settingsSlide?.id === slide.id) return roundRow(slide, round);
    const { key, label } = orderLabel(slide);
    const movable = onMoveSlide !== undefined && isAnnouncement(slide);
    const automatic = (slide.kind === 'recap' && Boolean(round && slide.roundId)) || slide.automaticAgenda === true || slide.generatedAgendaSlide === true;
    const section = model.introduction.find(item => item.slide?.id === slide.id);
    const typeLabel = section?.label ?? (slide.kind === 'recap' ? 'Rekapitulace' : slide.kind === 'end' ? 'Závěr kvízu' : slide.kind === 'thank-you' ? 'Poděkování před vyhlášením' : '');
    return <div className="outline-order-row">
      {movable && <button type="button" className="outline-drag-handle" draggable={!locked} disabled={locked}
        aria-label={`Přetáhnout sdělení: ${label}`} onDragStart={event => startDrag(event, { kind: 'announcement', id: slide.id })} onDragEnd={clearDrag}>⠿</button>}
      <button id={movable ? `outline-announcement-${slide.id}` : undefined} type="button" className={`outline-system-item ${selected(key)}`}
        aria-current={selectedKey === key ? 'true' : undefined} onClick={() => onSelect(key)}>
        <strong>{typeLabel || label}</strong>{typeLabel && label !== typeLabel && <span>{label}</span>}
        <small>{automatic && 'Automatický · '}{slide.hidden && canHideInfoSlide(slide) ? 'Skryté' : 'Promítá se'}</small>
      </button></div>;
  }
  // Contiguous groups keep older, interleaved slide streams in their stored order.
  const groups: { round?: SemanticRound; slides: EditorSlide[] }[] = [];
  const roundById = new Map(model.rounds.map(round => [round.id, round]));
  for (const slide of presentationSlides) {
    const round = roundById.get(slide.roundId ?? (slide.isQuestion ? 'roundless' : ''));
    const group = groups.at(-1);
    if (group && group.round === round) group.slides.push(slide);
    else groups.push({ round, slides: [slide] });
  }
  // Live moderation enters the finale immediately before the closing slide.
  const finaleAt = presentationSlides.find(slide => slide.kind === 'end')?.position ?? presentationSlides.length + 1;
  const firstRecap = presentationSlides.find(slide => slide.kind === 'recap');
  const interimAt = Math.min(firstRecap ? firstRecap.position + 1 : finaleAt, finaleAt);
  function resultCues(position: number) {
    return (['interim', 'final'] as const).map(type => position === (type === 'interim' ? interimAt : finaleAt) &&
      <button key={type} type="button" className={`outline-system-item ${selected('results:' + type)}`} onClick={() => onSelect('results:' + type)}>
        <strong>{type === 'interim' ? 'Průběžné pořadí' : 'Finální vyhlášení'}</strong><small>Spouští moderátor</small>
      </button>);
  }
  const draftAt = selectedKey === 'draft' && activeDraft?.isQuestion ? activeDraft.position : undefined;
  function draftRow() {
    return activeDraft && <button id={`outline-question-${activeDraft.id}`} type="button" aria-current="true" className="outline-question selected" onClick={() => onSelect('draft')}>
      <strong>{questionSummary(activeDraft)}</strong><small>Je potřeba doplnit</small></button>;
  }
  return <aside ref={outlineRef} className={`editor-outline editor-panel-structure quiz-outline ${dragging ? 'is-dragging' : ''}`} aria-label="Osnova kvízu" aria-busy={moving}
    onDragOverCapture={event => {
      if (!dragged.current) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientY < bounds.top + 40) event.currentTarget.scrollTop -= 18;
      if (event.clientY > bounds.bottom - 40) event.currentTarget.scrollTop += 18;
    }}>
    <header className="outline-heading"><div><span>Osnova kvízu</span><strong>{rounds.length} kol · {questionCount} otázek</strong></div>
      <button type="button" className={`outline-root-button ${selected('quiz')}`} aria-current={selectedKey === 'quiz' ? 'true' : undefined} onClick={() => onSelect('quiz')}>Název a nastavení kvízu</button>
      <button type="button" className="secondary-button add-round-button" disabled={createLocked} onClick={onAddRound}>+ Přidat kolo</button>
    </header>
    <span className="outline-move-status" role="status" aria-live="polite">{announcement}</span>
        {selectedAnnouncement && <label className="outline-announcement-target">
          Přesunout vybrané sdělení
          <select disabled={locked} value="" onChange={event => {
            if (event.target.value) void move({ kind: 'announcement', id: selectedAnnouncement.id }, undefined,
              presentationSlides[Number(event.target.value)]?.id);
          }}>
            <option value="">Vyberte místo…</option>
            {presentationSlides.map((slide, index) => index < lastDestination && slide.id !== selectedAnnouncement.id
              && index !== selectedAnnouncement.position && <option key={slide.id} value={index}>Před {slide.position}. {orderLabel(slide).label}</option>)}
            {selectedAnnouncement.position !== lastDestination && <option value={lastDestination}>Na konec programu</option>}
          </select>
        </label>}
    <ol className="presentation-outline" aria-label="Pořadí večera">
      {groups.map(({ round, slides }) => <li key={slides[0]!.id} className={round ? 'outline-round' : undefined} data-round-id={round?.id}>
        {round && !round.settingsSlide && round.slides[0]?.id === slides[0]?.id && round.id !== 'roundless' &&
          roundRow(undefined, round)}
        {slides.map(slide => <Fragment key={slide.id}>{resultCues(slide.position)}{gap(slide.id)}
          {draftAt === slide.position && draftRow()}
          <div data-slide-id={slide.id} data-slide-kind={slide.kind}
            className={dropTarget === `order-before:${slide.id}` ? 'drop-before' : dropTarget === `order-after:${slide.id}` ? 'drop-after' : undefined}
            onDragOver={event => { const after = dragAfter(event); allowAnnouncementDrop(event, slide.position - 1 + Number(after), `order-${after ? 'after' : 'before'}:${slide.id}`); }}
            onDrop={event => dropAnnouncement(event, slide.position - 1 + Number(dragAfter(event)))}>{slideRow(slide)}</div>
        </Fragment>)}
      </li>)}
      <li className="outline-order-end" onDragOver={event => allowAnnouncementDrop(event, lastDestination, 'order-end')}
        onDrop={event => dropAnnouncement(event, lastDestination)}>{draftAt !== undefined && draftAt > presentationSlides.length && draftRow()}{resultCues(lastDestination + 1)}{gap(null)}</li>
    </ol>
    {locked && !moving && <p className="field-help outline-disabled-reason">{lockedReason}</p>}
  </aside>;
}
