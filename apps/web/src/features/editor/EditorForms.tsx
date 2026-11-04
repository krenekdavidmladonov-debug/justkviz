import { parseQuizAsset, directMediaKind, type EditorAppearance } from '@filmovy-kviz/quiz-domain';
import { MediaUploadField } from '../media/MediaUploadField';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { SlidePreview } from '../presentation/SlidePreview';
import { MediaPlayer } from '../presentation/MediaPlayer';
import { youtubeVideoId, defaultRules, generatedAgendaOptions } from '../presentation/model';
import type { MediaPlaybackCommand } from '../presentation/types';
import type { SemanticQuizModel, SemanticRound, SemanticSystemSection } from './semanticModel';
import { questionTypeLabels, semanticQuestionType } from './semanticModel';
import { clipDuration, formatHumanTime, parseHumanTime } from './time';
import type { EditorQuiz, EditorSlide, EditorValidationIssue } from './types';
import { correctOptionIndex, validateQuestion } from './validation';

/** Closed design controls do not need to render on each keystroke. */
export function EditorDisclosure({ title, children, busy = false, field }: { readonly title: string; readonly children: () => ReactNode; readonly busy?: boolean; readonly field?: string }) {
  const [open, setOpen] = useState(false);
  return <details className="editor-extra" data-preflight-field={field} open={open} onToggle={event => {
    if (!event.currentTarget.open && busy) { event.currentTarget.open = true; return; }
    setOpen(event.currentTarget.open);
  }}><summary>{title}</summary>{open && children()}</details>;
}

function FieldIssues({ field, issues, visible }: { readonly field: string; readonly issues: readonly EditorValidationIssue[]; readonly visible: boolean }) {
  if (!visible) return null;
  return <>{issues.filter((issue) => issue.field === field).map((issue) => <p key={`${field}-${issue.message}`} className={`field-validation ${issue.severity}`} role={issue.severity === 'error' ? 'alert' : 'status'}>{issue.message}</p>)}</>;
}

export function ReadinessSummary({ slide }: { readonly slide: EditorSlide }) {
  const issues = validateQuestion(slide);
  const type = semanticQuestionType(slide);
  const rows = [
    { label: 'Otázka', ok: !issues.some((issue) => issue.field === 'prompt' && issue.severity === 'error') },
    { label: 'Správná odpověď', ok: !issues.some((issue) => issue.field === 'correctAnswer' && issue.severity === 'error') },
    ...(type === 'audio' || type === 'video' ? [
      { label: 'Médium', ok: !issues.some((issue) => issue.field === 'mediaSource' && issue.severity === 'error') },
      { label: 'Časování', ok: !issues.some((issue) => ['clipStartSeconds', 'clipEndSeconds'].includes(issue.field) && issue.severity === 'error') },
    ] : []),
    ...(type === 'image' ? [{ label: 'Obrázek', ok: !issues.some((issue) => issue.field === 'questionImage' && issue.severity === 'error') }] : []),
  ];
  return (
    <section className="readiness-summary" aria-label="Připravenost otázky">
      <strong>Připravenost</strong>
      <ul>{rows.map((row) => <li key={row.label} className={row.ok ? 'ready' : 'issue'}><span aria-hidden="true">{row.ok ? '✓' : '!'}</span>{row.label}</li>)}</ul>
    </section>
  );
}

export function QuizSettingsForm({
  quiz,
  title,
  description,
  disabled,
  onTitle,
  onDescription,
}: {
  readonly appearance?: EditorAppearance;
  readonly onAppearance?: (value: EditorAppearance) => void;
  readonly quiz: EditorQuiz;
  readonly title: string;
  readonly description: string;
  readonly disabled: boolean;
  readonly onTitle: (value: string) => void;
  readonly onDescription: (value: string) => void;
}) {
  return (
    <section className="editor-form-stack" aria-labelledby="quiz-settings-title">
      <header className="content-form-heading"><span>Kvíz</span><h2 id="quiz-settings-title">Základní údaje</h2><p>{quiz.roundCount} kol · {quiz.questionCount} otázek</p></header>
      <label className="form-field" data-preflight-field="quizTitle">Název kvízu *<input disabled={disabled} value={title} onChange={(event) => onTitle(event.target.value)} /></label>
      <details className="editor-extra"><summary>Popis kvízu (volitelný)</summary><label className="form-field">Popis<textarea rows={3} disabled={disabled} value={description} onChange={(event) => onDescription(event.target.value)} /></label></details>
      <p className="field-help">Začněte názvem, přidejte kolo a napište první otázku. Vzhled je připravený automaticky. Změny ukládáte tlačítkem Uložit.</p>
    </section>
  );
}

export function SystemSectionForm({
  section,
  slide,
  model,
  disabled,
  onChange,
}: {
  readonly section: SemanticSystemSection;
  readonly slide: EditorSlide;
  readonly model: SemanticQuizModel;
  readonly disabled: boolean;
  readonly onChange: (slide: EditorSlide) => void;
}) {
  const set = <K extends keyof EditorSlide>(field: K, value: EditorSlide[K]) => onChange({ ...slide, [field]: value });
  if (section.key === 'agenda') {
    const automatic = slide.automaticAgenda === true;
    const items = automatic ? generatedAgendaOptions(model.rounds) : slide.options;
    return <section className="editor-form-stack" data-preflight-field="agenda">
      <header className="content-form-heading"><span>Úvod kvízu</span><h2>Harmonogram</h2><p>{automatic ? 'Automaticky podle pořadí a názvů kol' : 'Uložený ruční harmonogram'}</p></header>
      <label className="form-field">Nadpis<input disabled={disabled} value={slide.title} onChange={event => set('title', event.target.value)} /></label>
      <label className="form-field">Doprovodný text<textarea disabled={disabled} value={slide.text} onChange={event => set('text', event.target.value)} /></label>
      <label className="binary-answer"><input type="checkbox" disabled={disabled} checked={automatic} onChange={event => onChange({ ...slide, automaticAgenda: event.target.checked, options: [...items] })} /> Automaticky podle kol</label>
      {automatic ? <ol className="generated-agenda">{items.map(item => <li key={item}>{item}</li>)}</ol> : <label className="form-field">Položky · každá na vlastní řádek<textarea rows={6} disabled={disabled} value={slide.options.join('\n')} onChange={event => set('options', event.target.value.split('\n'))} /></label>}
      <p className="field-help">Automatické položky se mění podle kol. Vlastní položky zůstanou zachované.</p>
    </section>;
  }
  if (section.key === 'rules') {
    const rules = slide.options.length > 0 ? slide.options : defaultRules;
    return (
      <section className="editor-form-stack">
        <header className="content-form-heading"><span>Úvod kvízu</span><h2>Pravidla</h2></header>
        <label className="form-field">Nadpis<input disabled={disabled} value={slide.title} onChange={event => set('title', event.target.value)} /></label>
        <label className="form-field">Doprovodný text<textarea disabled={disabled} value={slide.text} onChange={event => set('text', event.target.value)} /></label>
        <fieldset className="editor-fieldset" disabled={disabled}>
          <legend>Pravidla pro hráče</legend>
          {rules.map((rule, index) => (
            <div className="inline-editor-row" key={index}>
              <span>{index + 1}.</span>
              <input aria-label={`Pravidlo ${index + 1}`} value={rule} onChange={(event) => set('options', rules.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />
              <button type="button" className="icon-button" aria-label={`Odstranit pravidlo ${index + 1}`} onClick={() => set('options', rules.filter((_, itemIndex) => itemIndex !== index))}>×</button>
            </div>
          ))}
          <button type="button" className="secondary-button compact-button" onClick={() => set('options', [...rules, ''])}>+ Přidat pravidlo</button>
          <button type="button" className="text-button" onClick={() => set('options', [...defaultRules])}>Obnovit výchozí pravidla</button>
        </fieldset>
      </section>
    );
  }
  return (
    <section className="editor-form-stack">
      <header className="content-form-heading"><span>Úvod kvízu</span><h2>Úvodní obrazovka</h2></header>
      <label className="form-field">Název na úvodní obrazovce<input disabled={disabled} value={slide.title} onChange={(event) => set('title', event.target.value)} /></label>
      <label className="form-field">Podtitulek<textarea rows={3} disabled={disabled} value={slide.text} onChange={(event) => set('text', event.target.value)} /></label>
    </section>
  );
}

export function RoundSettingsForm({
  round,
  title,
  slide,
  disabled,
  onTitle,
  onChange,
}: {
  readonly round: SemanticRound;
  readonly title: string;
  readonly slide?: EditorSlide;
  readonly disabled: boolean;
  readonly onTitle: (value: string) => void;
  readonly onChange: (slide: EditorSlide) => void;
}) {
  return (
    <section className="editor-form-stack">
      <header className="content-form-heading"><span>{round.position}. kolo</span><h2>Nastavení kola</h2><p>{round.questions.length} otázek</p></header>
      <label className="form-field" data-preflight-field="roundTitle">Název kola *<input disabled={disabled || round.id === 'roundless'} value={title} onChange={(event) => onTitle(event.target.value)} /></label>
      {slide && <label className="form-field">Doprovodný text úvodu kola<textarea disabled={disabled} value={slide.text} onChange={event => onChange({ ...slide, text: event.target.value })} /></label>}
      {!slide && <p className="field-help">Toto kolo nemá samostatnou úvodní obrazovku. Název kola lze přesto bezpečně upravit.</p>}
    </section>
  );
}

function PromptField({ slide, disabled, issues, showIssues, touch, onChange }: QuestionFormFieldProps) {
  return (
    <label className="form-field" data-preflight-field="prompt">Otázka *
      <textarea aria-label="Otázka *" rows={4} disabled={disabled} value={slide.text || slide.title} onBlur={() => touch('prompt')} onChange={(event) => onChange({
        ...slide,
        text: event.target.value,
        ...(event.target.value === '' ? { title: '' } : {}),
      })} />
      <FieldIssues field="prompt" issues={issues} visible={showIssues('prompt')} />
    </label>
  );
}

interface QuestionFormFieldProps {
  readonly answersReadable?: boolean;
  readonly answersEditable?: boolean;
  readonly slide: EditorSlide;
  readonly disabled: boolean;
  readonly issues: readonly EditorValidationIssue[];
  readonly showIssues: (field: string) => boolean;
  readonly touch: (field: string) => void;
  readonly onChange: (slide: EditorSlide) => void;
}

function ChoiceFields(props: QuestionFormFieldProps) {
  const { slide, disabled, issues, showIssues, touch, onChange } = props;
  const selectedIndex = correctOptionIndex(slide);
  const updateOption = (index: number, value: string) => {
    const options = slide.options.map((option, optionIndex) => optionIndex === index ? value : option);
    onChange({ ...slide, options, ...(selectedIndex === index ? { correctAnswer: value } : {}) });
  };
  const remove = (index: number) => {
    const options = slide.options.filter((_, optionIndex) => optionIndex !== index);
    onChange({ ...slide, options, ...(selectedIndex === index ? { correctAnswer: '' } : {}) });
  };
  return (
    <fieldset className="editor-fieldset choice-editor" data-preflight-field="options" disabled={disabled || props.answersEditable === false} onBlur={() => touch('options')}>
      <legend>Odpovědi</legend>
      {props.answersEditable === false && <p>Úprava možností a jejich pořadí vyžaduje oprávnění Upravovat odpovědi.</p>}
      {slide.options.map((option, index) => (
        <div className="choice-row" key={index}>
          {props.answersReadable !== false && <input type="radio" disabled={props.answersEditable === false} data-preflight-field={index === 0 ? 'correctAnswer' : undefined} name={`correct-${slide.id}`} aria-label={`Označit možnost ${String.fromCharCode(65 + index)} jako správnou`} checked={selectedIndex === index} onChange={() => onChange({ ...slide, correctAnswer: option })} />}
          <span>{String.fromCharCode(65 + index)}</span>
          <input aria-label={`Možnost ${String.fromCharCode(65 + index)}`} value={option} onChange={(event) => updateOption(index, event.target.value)} />
          <button type="button" className="icon-button" aria-label={`Posunout možnost ${String.fromCharCode(65 + index)} nahoru`} disabled={index === 0} onClick={() => { const options = [...slide.options]; [options[index - 1], options[index]] = [options[index]!, options[index - 1]!]; onChange({ ...slide, options }); }}>↑</button>
          <button type="button" className="icon-button" aria-label={`Odstranit možnost ${String.fromCharCode(65 + index)}`} onClick={() => remove(index)}>×</button>
        </div>
      ))}
      <button type="button" className="secondary-button compact-button" disabled={slide.options.length >= 6} onClick={() => onChange({ ...slide, options: [...slide.options, ''] })}>+ Přidat odpověď</button>
      <FieldIssues field="options" issues={issues} visible={showIssues('options')} />
      <FieldIssues field="correctAnswer" issues={issues} visible={showIssues('correctAnswer')} />
    </fieldset>
  );
}

function FreeAnswerField(props: QuestionFormFieldProps) {
  const { slide, disabled, issues, showIssues, touch, onChange } = props;
  return (
    <label className="form-field private-field" data-preflight-field="correctAnswer">Správná odpověď *
      <textarea aria-label="Správná odpověď *" rows={2} disabled={disabled} value={slide.correctAnswer} onBlur={() => touch('correctAnswer')} onChange={(event) => onChange({ ...slide, correctAnswer: event.target.value })} />
      <FieldIssues field="correctAnswer" issues={issues} visible={showIssues('correctAnswer')} />
    </label>
  );
}

function PlAnswerField(props: QuestionFormFieldProps) {
  const { slide, disabled, issues, showIssues, touch, onChange } = props;
  const normalized = slide.correctAnswer.trim().toLocaleLowerCase('cs-CZ');
  const truthy = ['pravda', 'true', 'ano', '1'].includes(normalized);
  const falsy = ['lež', 'lez', 'false', 'ne', '0'].includes(normalized);
  return (
    <fieldset className="editor-fieldset private-field" data-preflight-field="correctAnswer" disabled={disabled} onBlur={() => touch('correctAnswer')}>
      <legend>Správná odpověď</legend>
      <label className="binary-answer"><input type="radio" name={`pl-${slide.id}`} checked={truthy} onChange={() => onChange({ ...slide, correctAnswer: 'Pravda' })} /> Pravda</label>
      <label className="binary-answer"><input type="radio" name={`pl-${slide.id}`} checked={falsy} onChange={() => onChange({ ...slide, correctAnswer: 'Lež' })} /> Lež</label>
      <FieldIssues field="correctAnswer" issues={issues} visible={showIssues('correctAnswer')} />
    </fieldset>
  );
}

function TimeField({ label, field, value, disabled, issues, showIssue, touch, onChange }: {
  readonly label: string;
  readonly field: 'clipStartSeconds' | 'clipEndSeconds';
  readonly value: number | null;
  readonly disabled: boolean;
  readonly issues: readonly EditorValidationIssue[];
  readonly showIssue: boolean;
  readonly touch: () => void;
  readonly onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(() => formatHumanTime(value));
  const [invalid, setInvalid] = useState(false);
  const pendingLocalValue = useRef<{ readonly value: number | null } | null>(null);
  useEffect(() => {
    if (pendingLocalValue.current !== null && Object.is(pendingLocalValue.current.value, value)) {
      pendingLocalValue.current = null;
      return;
    }
    pendingLocalValue.current = null;
    setText(formatHumanTime(value));
    setInvalid(false);
  }, [value]);
  return (
    <label className="form-field" data-preflight-field={field}>{label} *
      <input value={text} disabled={disabled} inputMode="decimal" placeholder="mm:ss nebo mm:ss.s" onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const parsed = parseHumanTime(next);
        setInvalid(parsed === undefined);
        const nextValue = parsed === undefined ? null : parsed;
        pendingLocalValue.current = { value: nextValue };
        onChange(nextValue);
      }} onBlur={() => { touch(); const parsed = parseHumanTime(text); if (parsed !== undefined) setText(formatHumanTime(parsed)); }} />
      {invalid && <p className="field-validation error" role="alert">Použijte formát mm:ss nebo mm:ss.s.</p>}
      <FieldIssues field={field} issues={issues} visible={showIssue} />
    </label>
  );
}

function MediaTimingFields(props: QuestionFormFieldProps) {
  const { slide, disabled, issues, showIssues, touch, onChange } = props;
  const [command, setCommand] = useState<MediaPlaybackCommand>('idle');
  const [generation, setGeneration] = useState(0);
  const [currentTimeRequest, setCurrentTimeRequest] = useState(0);
  const [captureTarget, setCaptureTarget] = useState<'start' | 'end'>('start');
  const [mediaStatus, setMediaStatus] = useState('Přehrávač není načtený.');
  const run = (next: MediaPlaybackCommand) => {
    touch('mediaSource');
    touch('clipStartSeconds');
    touch('clipEndSeconds');
    setGeneration((value) => value + 1);
    setCommand(next);
    setMediaStatus(next === 'stop' ? 'Ukázka je zastavená.' : next === 'idle' ? 'Načítám ukázku.' : 'Spouštím ukázku.');
  };
  const duration = clipDuration(slide.clipStartSeconds, slide.clipEndSeconds);
  const capture = (target: 'start' | 'end') => {
    touch(target === 'start' ? 'clipStartSeconds' : 'clipEndSeconds');
    setCaptureTarget(target);
    setCurrentTimeRequest((value) => value + 1);
  };
  return (
    <fieldset className="editor-fieldset media-timing-editor">
      <legend>Ukázka</legend>
      <div data-preflight-field="mediaSource"><MediaUploadField key={slide.id + ':source'} kind={semanticQuestionType(slide) === 'audio' ? 'audio' : 'video'} label="Zdroj ukázky" value={slide.mediaSource} disabled={disabled} onReady={value => {
        setCurrentTimeRequest(0); setCommand('stop'); setGeneration(g => g + 1); setMediaStatus(value ? 'Zdroj rozpoznán. Načtěte přehrávač a zkontrolujte nové časování.' : 'Zdroj odebrán.');
        onChange({ ...slide, mediaSource: value, clipStartSeconds: null, clipEndSeconds: null });
      }} /><FieldIssues field="mediaSource" issues={issues} visible={showIssues('mediaSource')} /></div>
      {youtubeVideoId(slide.mediaSource) && <p className="field-help">YouTube zobrazuje svůj přehrávač a může omezit vložení. Pro zvuk bez názvu a náhledu použijte vlastní audio.</p>}
      <div className="media-time-grid">
        <TimeField key={slide.id + slide.mediaSource + ":start"} label="Začátek ukázky" field="clipStartSeconds" value={slide.clipStartSeconds} disabled={disabled} issues={issues} showIssue={showIssues('clipStartSeconds')} touch={() => touch('clipStartSeconds')} onChange={(value) => onChange({ ...slide, clipStartSeconds: value })} />
        <TimeField key={slide.id + slide.mediaSource + ":end"} label="Konec ukázky" field="clipEndSeconds" value={slide.clipEndSeconds} disabled={disabled} issues={issues} showIssue={showIssues('clipEndSeconds')} touch={() => touch('clipEndSeconds')} onChange={(value) => onChange({ ...slide, clipEndSeconds: value })} />
      </div>
      <p className="clip-duration">Délka ukázky: <strong>{duration === null ? '—' : formatHumanTime(duration)}</strong></p>
      {(youtubeVideoId(slide.mediaSource) !== undefined || Boolean(parseQuizAsset(slide.mediaSource)) || directMediaKind(slide.mediaSource) !== undefined) && (
        <MediaPlayer
          className="youtube-player-shell editor-test-player"
          key={slide.id + slide.mediaSource}
          source={slide.mediaSource}
          command={command}
          onPlayRequest={() => run('play')}
          generation={generation}
          startSeconds={slide.clipStartSeconds ?? 0}
          {...(slide.clipEndSeconds === null ? {} : { endSeconds: slide.clipEndSeconds })}
          currentTimeRequest={currentTimeRequest}
          onCurrentTime={(seconds) => onChange({ ...slide, [captureTarget === 'start' ? 'clipStartSeconds' : 'clipEndSeconds']: Math.round(seconds * 10) / 10 })}
          onPlaybackState={(_generation, state) => setMediaStatus(state === 'playing' ? 'Ukázka se přehrává.' : 'Přehrávač je připravený.')}
          onFinished={() => setMediaStatus('Ukázka dohrála.')}
          onError={(_generation, message) => setMediaStatus(message)}
        />
      )}
      <p className="field-help" role="status" aria-live="polite">{mediaStatus}</p>
      <div className="media-test-controls">
        <button type="button" className="secondary-button" disabled={disabled} onClick={() => run('idle')}>Načíst</button>
        <button type="button" className="secondary-button" disabled={disabled} onClick={() => capture('start')}>Použít aktuální čas jako začátek</button>
        <button type="button" className="secondary-button" disabled={disabled} onClick={() => capture('end')}>Použít aktuální čas jako konec</button>
        <button type="button" className="primary-button" disabled={disabled} onClick={() => run('play')}>Přehrát ukázku</button>
        <button type="button" className="secondary-button" disabled={disabled} onClick={() => run('stop')}>Stop</button>
        <button type="button" className="secondary-button" disabled={disabled} onClick={() => run('replay')}>Pustit znovu</button>
      </div>
    </fieldset>
  );
}

export function QuestionForm({
  answersReadable = true,
  answersEditable = true,
  notesReadable = true,
  notesEditable = true,
  slide,
  number,
  disabled,
  showAllIssues,
  touched,
  onTouch,
  onChange,
  onNext,
}: {
  readonly answersReadable?: boolean;
  readonly answersEditable?: boolean;
  readonly notesReadable?: boolean;
  readonly notesEditable?: boolean;
  readonly slide: EditorSlide;
  readonly number: number;
  readonly disabled: boolean;
  readonly defaultAppearance?: EditorAppearance;
  readonly quizId?: string;
  readonly onUploadPending?: ((pending: boolean) => void) | undefined;
  readonly showAllIssues: boolean;
  readonly touched: ReadonlySet<string>;
  readonly onTouch: (field: string) => void;
  readonly onChange: (slide: EditorSlide) => void;
  readonly onNext?: () => void;
}) {
  const type = semanticQuestionType(slide);
  const issues = validateQuestion(slide).filter(issue => answersReadable || issue.field !== 'correctAnswer');
  const props: QuestionFormFieldProps = {
    slide, disabled, issues, onChange, touch: onTouch, answersReadable, answersEditable,
    showIssues: (field) => showAllIssues || touched.has(field),
  };
  const choices = slide.answerMode === 'choice' || (slide.answerMode !== 'open' && (type === 'choice' || slide.options.length > 0));
  const changeMedia = (next: 'text' | 'image' | 'audio' | 'video') => {
    if (next !== type && (slide.questionImage || slide.mediaSource) && !window.confirm('Změna zadání odpojí nynější médium otázky a časování. Soubor zůstane v knihovně, odpověď, poznámka a pozadí se zachovají. Pokračovat?')) return;
    onChange({ ...slide, kind: next, questionImage: '', mediaSource: '', clipStartSeconds: next === 'audio' || next === 'video' ? 0 : null, clipEndSeconds: null, answerMode: choices ? 'choice' : 'open' });
  };
  const changeMode = (mode: 'open' | 'choice') => {
    if (mode === 'open' && slide.options.length > 0 && !window.confirm('Přechod na volnou odpověď odpojí všechny možnosti. Zadání, média a text správné odpovědi zůstanou. Pokračovat?')) return;
    onChange({ ...slide, kind: mode === 'choice' && slide.kind === 'free' ? 'text' : slide.kind, answerMode: mode, options: mode === 'choice' ? slide.options.length ? slide.options : ['', '', '', ''] : [] });
  };
  return (
    <section className="editor-form-stack question-form" data-question-type={type} data-preflight-field={type === 'legacy' || type === 'legacy-pl' ? 'legacy' : undefined}>
      <header className="content-form-heading"><span>Otázka {number}</span><h2>Zadání a odpověď</h2><p>{questionTypeLabels[type]}</p></header>
      {type === 'legacy-pl' && <div className="legacy-notice"><strong>Starší typ Pravda / Lež</strong><p>Typ je uzamčený, ale obsah a odpověď můžete upravit bez ztráty původních dat.</p></div>}
      {type === 'legacy' && <div className="legacy-notice"><strong>Obsah obsahuje starší nastavení.</strong><p>Neznámé části zůstanou při uložení beze změny.</p></div>}
      <PromptField {...props} />

      {!answersReadable && <p className="system-content-note">Správná odpověď je pro váš účet skrytá. Při uložení zadání zůstane zachována na serveru.</p>}
      {choices ? <ChoiceFields {...props} /> : answersReadable ? type === 'legacy-pl' ? <PlAnswerField {...props} disabled={disabled || !answersEditable} /> : <FreeAnswerField {...props} disabled={disabled || !answersEditable} /> : null}
      {!type.startsWith('legacy') && <div className="question-content-options">
        <button type="button" className="text-button" disabled={disabled || !answersEditable || slide.options.length > 6} onClick={() => changeMode(choices ? 'open' : 'choice')}>{choices ? 'Použít volnou odpověď' : 'Nabídnout možnosti odpovědi'}</button>
        <div className="question-media-actions" aria-label="Média otázky">{(['image', 'audio', 'video'] as const).map(kind => <button key={kind} type="button" className="secondary-button compact-button" aria-pressed={type === kind} disabled={disabled || !answersEditable} onClick={() => { if (type !== kind) changeMedia(kind); }}>{kind === 'image' ? 'Přidat obrázek' : kind === 'audio' ? 'Přidat zvuk' : 'Přidat video'}</button>)}</div>
      </div>}
      {type === 'image' && <div data-preflight-field="questionImage"><MediaUploadField key={slide.id + ':question'} kind="image" label="Obrázek otázky" value={slide.questionImage} disabled={disabled} onReady={value => onChange({ ...slide, questionImage: value })} /><FieldIssues field="questionImage" issues={issues} visible={props.showIssues('questionImage')} /></div>}
      {(type === 'audio' || type === 'video') && <MediaTimingFields {...props} />}
      {onNext && <div className="question-save-actions"><button type="button" className="primary-button" disabled={disabled} onClick={onNext}>Uložit a přidat další</button><span className="field-help">Uloží změny a otevře další otázku v tomto kole.</span></div>}
      {!type.startsWith('legacy') && <details className="editor-extra"><summary>Typ otázky a odpovědi</summary><div className="question-settings">
        <label className="form-field">Způsob zadání<select disabled={disabled || !answersEditable} value={['image','audio','video'].includes(type) ? type : 'text'} onChange={event => changeMedia(event.target.value as 'text' | 'image' | 'audio' | 'video')}><option value="text">Text</option><option value="image">Obrázek</option><option value="audio">Zvuk</option><option value="video">Video</option></select></label>
        <label className="form-field">Způsob odpovědi<select disabled={disabled || !answersEditable || slide.options.length > 6} value={choices ? 'choice' : 'open'} onChange={event => changeMode(event.target.value as 'open' | 'choice')}><option value="open">Volná odpověď</option><option value="choice">ABCD – jedna možnost</option></select></label>
      </div></details>}
      {answersReadable && <EditorDisclosure field="answerImage" title={slide.answerImage ? 'Odpověď po odhalení · fotografie přidána' : 'Odpověď po odhalení · přidat fotografii (volitelné)'} busy={disabled}>{() => <>
        <p className="field-help">Fotografie je volitelná a zobrazí se až po odhalení správné odpovědi.</p>
        <MediaUploadField key={slide.id + ':answer'} kind="image" label="Obrázek odpovědi (soukromý)" value={slide.answerImage} disabled={disabled || !answersEditable} onReady={value => onChange({ ...slide, answerImage: value })} />
        <label className="form-field">Vysvětlení pro hráče po odhalení<textarea disabled={disabled || !answersEditable} value={slide.answerExplanation ?? ''} onChange={event => onChange({ ...slide, answerExplanation: event.target.value })} /></label>
      </>}</EditorDisclosure>}
      {notesReadable && <details className="editor-extra"><summary>Poznámka moderátora</summary><label className="form-field">Poznámka moderátora<textarea rows={3} disabled={disabled || !notesEditable} value={slide.moderatorNote} onChange={event => onChange({ ...slide, moderatorNote: event.target.value })} /></label></details>}
      {showAllIssues && <ReadinessSummary slide={slide} />}
    </section>
  );
}

export function SystemContentForm({ slide, disabled, onChange }: { readonly slide: EditorSlide; readonly disabled: boolean; readonly onChange: (slide: EditorSlide) => void }) {
  const set = <K extends keyof EditorSlide>(field: K, value: EditorSlide[K]) => onChange({ ...slide, [field]: value });
  const recap = slide.kind === 'recap';
  return (
    <section className="editor-form-stack">
      <header className="content-form-heading"><span>Systémová část</span><h2>{recap ? 'Rekapitulace' : slide.kind === 'end' ? 'Závěr kvízu' : 'Informační slide'}</h2></header>
      {recap && <p className="system-content-note">Rekapitulace se sestavuje z otázek tohoto kola. Původní nastavení zůstává zachované.</p>}
      <label className="form-field">Titulek<input disabled={disabled} value={slide.title} onChange={(event) => set('title', event.target.value)} /></label>
      <label className="form-field">Text<textarea rows={4} disabled={disabled} value={slide.text} onChange={(event) => set('text', event.target.value)} /></label>
    </section>
  );
}

export function EditorPreview({ slide, quizTitle, showAnswer, onShowAnswer, onEdit }: {
  readonly slide: EditorSlide;
  readonly quizTitle: string;
  readonly showAnswer: boolean;
  readonly onShowAnswer: (value: boolean) => void;
  readonly onEdit?: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    if (expanded) dialogRef.current?.showModal();
  }, [expanded]);
  useEffect(() => {
    let observer: ResizeObserver | undefined;
    const timer = window.setTimeout(() => {
      const stage = stageRef.current?.querySelector<HTMLElement>('.slide-renderer');
      if (!stage) return;
      const check = () => {
        const area = stage.getBoundingClientRect();
        setOverflowing([...stage.querySelectorAll<HTMLElement>('.slide-copy h1, .slide-copy p, .slide-centered h1, .slide-centered p, .slide-options li, .agenda-items li, .slide-answer strong, .slide-answer p')].some(item => {
          const bounds = item.getBoundingClientRect();
          return bounds.width > 0 && (bounds.left < area.left - 1 || bounds.right > area.right + 1 || bounds.top < area.top - 1 || bounds.bottom > area.bottom + 1 || item.scrollWidth > item.clientWidth + 2 || item.scrollHeight > item.clientHeight + 2);
        }));
      };
      check();
      if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(check); observer.observe(stage); }
    }, 180);
    return () => { window.clearTimeout(timer); observer?.disconnect(); };
  }, [slide, showAnswer, expanded]);
  const projection = <div ref={stageRef}><SlidePreview slide={slide} quizTitle={quizTitle} position={slide.position} showAnswer={showAnswer} /></div>;
  const answerToggle = slide.isQuestion && <label className="answer-preview-toggle"><input type="checkbox" checked={showAnswer} onChange={(event) => onShowAnswer(event.target.checked)} /> Náhled odpovědi</label>;
  const closePreview = () => { dialogRef.current?.close(); setExpanded(false); requestAnimationFrame(() => expandButtonRef.current?.focus()); };
  return (
    <aside className="round-editor-preview editor-panel-preview">
      <header className="preview-heading"><span>Náhled projekce</span><button ref={expandButtonRef} type="button" className="secondary-button" onClick={() => setExpanded(true)}>Zvětšit náhled</button>{onEdit && <button type="button" className="text-button preview-return-button" onClick={onEdit}>Zpět k editaci</button>}</header>
      <div className="local-preview-label">Lokální náhled · nepublikováno</div>
      {!expanded && <>{projection}{answerToggle}</>}
      {expanded && <dialog ref={dialogRef} className="editor-preview-dialog" aria-label="Zvětšený náhled projekce" onCancel={event => { event.preventDefault(); closePreview(); }}><header><strong>Náhled projekce</strong><button type="button" className="secondary-button" autoFocus onClick={closePreview}>Zpět k editaci</button></header>{projection}{answerToggle}<p className="field-help">Lokální náhled rozepsaných změn. Nic se nepublikuje.</p></dialog>}
      {slide.text.length + slide.title.length + slide.options.join('').length > 650 && <p className="field-validation warning" role="status">Slide obsahuje mnoho textu. Zkontrolujte zalomení a velikost v náhledu; uložení je možné.</p>}
      {overflowing && <p className="field-validation warning" role="status">Část obsahu přesahuje promítanou plochu. Zmenšete text nebo zvolte vhodnější rozložení; uložení je možné.</p>}
      <p className="field-help">Reaguje na rozepsané změny bez uložení a nic neposílá do živé relace.</p>
    </aside>
  );
}
