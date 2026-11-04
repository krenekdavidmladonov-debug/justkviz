// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { SlideDesignFields, designContrastWarning, designDefaults } from '../apps/web/src/features/editor/SlideDesignFields';
import { ResultTemplatePreview } from '../apps/web/src/features/editor/ResultTemplatePreview';
import { EditorDisclosure, EditorPreview, QuestionForm } from '../apps/web/src/features/editor/EditorForms';
import { PrintTemplateFields } from '../apps/web/src/features/print/PrintTemplateFields';
import { practiceSlides } from '../apps/web/src/features/editor/QuizPractice';
import type { EditorQuiz, EditorSlide } from '../apps/web/src/features/editor/types';

const question: EditorSlide = { id: 'q', position: 2, kind: 'free', storedKind: 'free', isQuestion: true, title: '', text: 'Otázka', options: [], correctAnswer: 'Soukromá odpověď', moderatorNote: '', media: [], hasLegacyData: false, backgroundImage: '', questionImage: '', answerImage: '', mediaSource: '', backgroundOverlay: null, clipStartSeconds: null, clipEndSeconds: null, presentation: { videoStart: null, videoEnd: null, audioTrigger: null, backgroundOverlay: null, answerOverlay: null, sourceQuestionNumber: null } };

test('visual controls expose inherited values and local overrides without copying them on render', () => {
  const onChange = vi.fn();
  const html = renderToStaticMarkup(<SlideDesignFields scope="slide" inherited={{ accentColor: '#112233' }} value={{ textAlign: 'right' }} disabled onChange={onChange} />);
  expect(html).toContain('value="#112233"');
  expect(html).toContain('Děděné');
  expect(html).toContain('Vlastní');
  expect(html).toContain('Obnovit výchozí vzhled');
  expect(html).toContain('disabled=""');
  expect(onChange).not.toHaveBeenCalled();
});

test('contrast warning handles shorthand colors and never blocks editing', () => {
  expect(designContrastWarning({ backgroundColor: '#fff', textColor: '#fff' })).toBe(true);
  expect(designContrastWarning({ backgroundColor: '#000', textColor: '#fff' })).toBe(false);
  expect(designContrastWarning(designDefaults)).toBe(false);
  const html = renderToStaticMarkup(<SlideDesignFields scope="slide" value={{ backgroundColor: '#fff', textColor: '#fff' }} disabled={false} onChange={vi.fn()} />);
  expect(html).toContain('uložení je možné');
  expect(html).toContain('value="#ffffff"');
  const print = renderToStaticMarkup(<PrintTemplateFields value={{ accentColor: '#abc' }} disabled={false} quizId="quiz" onChange={vi.fn()} />);
  expect(print).not.toContain('type="color"');
  expect(print).toContain('/print-samples/player-standard.png');
  expect(print).toContain('Ukázka vzhledu — vzorová data');
});

test('image background advises a visual readability check without disabling controls', () => {
  const html = renderToStaticMarkup(<SlideDesignFields scope="answer" value={{ backgroundImage: 'https://example.test/image.png', backgroundOverlay: 0 }} disabled={false} onChange={vi.fn()} />);
  expect(html).toContain('Obrázkové pozadí může snížit čitelnost textu');
  expect(html).toContain('<input type="range" min="0" max="100" value="0"/>');
});

test('layout-only legacy override can reset while inherited appearance cannot', () => {
  const render = (legacyResetAvailable: boolean) => renderToStaticMarkup(<SlideDesignFields scope="slide" value={{}} legacy={{ backgroundImage: 'https://example.test/default.png' }} legacyResetAvailable={legacyResetAvailable} disabled={false} onChange={vi.fn()} />);
  expect(render(true)).toContain('class="secondary-button">Obnovit výchozí vzhled');
  expect(render(false)).toContain('class="secondary-button" disabled="">Obnovit výchozí vzhled');
});

test('result template controls omit question-only settings and unsupported image layout', () => {
  const html = renderToStaticMarkup(<SlideDesignFields scope="results" value={{}} disabled={false} onChange={vi.fn()} />);
  for (const label of ['Zobrazit číslo otázky', 'Zobrazit název kola', 'Zobrazení obrázku', 'Obraz v hlavní roli']) expect(html).not.toContain(label);
  expect(html).toContain('Zobrazit logo');
});

test('private preview does not use answer-only visual overrides before explicit reveal', () => {
  const slide = { ...question, design: { backgroundColor: '#112233' }, answerDesign: { backgroundColor: '#aabbcc' } };
  const render = (showAnswer: boolean) => renderToStaticMarkup(<EditorPreview slide={slide} quizTitle="Kvíz" showAnswer={showAnswer} onShowAnswer={vi.fn()} onEdit={vi.fn()} />);
  expect(render(false)).toContain('#112233');
  expect(render(false)).not.toContain('#aabbcc');
  expect(render(false)).not.toContain('Soukromá odpověď');
  expect(render(true)).toContain('#aabbcc');
  expect(render(true)).toContain('Soukromá odpověď');
  expect(render(false)).toContain('Zvětšit náhled');
  expect(render(false)).toContain('Zpět k editaci');
});

test('result template preview shares real results rendering while labelling sample data', () => {
  const html = renderToStaticMarkup(<ResultTemplatePreview kind="interim" template={{ title: 'Naše pořadí', design: { accentColor: '#112233' } }} onEdit={vi.fn()} />);
  expect(html).toContain('Naše pořadí');
  expect(html).toContain('results-canvas');
  expect(html).toContain('Ukázka rozložení');
  expect(html).toContain('Ukázkový tým');
  expect(html).not.toContain('publicSessions');
});

test('rehearsal skips hidden standalone information while preserving even malformed hidden questions', () => {
  const info = { ...question, id: 'info', position: 1, kind: 'info' as const, isQuestion: false, hidden: true };
  const quiz: EditorQuiz = { id: 'quiz', title: 'Kvíz', description: '', revision: 1, slideCount: 2, questionCount: 1, roundCount: 0, slides: [info, { ...question, hidden: true }] };
  expect(practiceSlides(quiz).map(slide => slide.id)).toEqual(['q']);
  expect(quiz.slides).toHaveLength(2);
});

test('question authoring offers content, optional media and next question before advanced controls without warning on an untouched blank', () => {
  const html = renderToStaticMarkup(<QuestionForm slide={{ ...question, text: '', correctAnswer: '' }} number={1} disabled={false} showAllIssues={false} touched={new Set()} onTouch={vi.fn()} onChange={vi.fn()} onNext={vi.fn()} />);
  expect(html.indexOf('Otázka *')).toBeLessThan(html.indexOf('Správná odpověď *'));
  expect(html.indexOf('Správná odpověď *')).toBeLessThan(html.indexOf('Přidat obrázek'));
  expect(html.indexOf('Uložit a přidat další')).toBeLessThan(html.indexOf('Typ otázky a odpovědi'));
  expect(html).not.toContain('role="alert"');
  expect(html).not.toContain('readiness-summary');
});

test('closed advanced controls mount only when opened and retain an active upload on an attempted close', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'), root = createRoot(host), content = vi.fn(() => <input aria-label="Vzhled" />);
  document.body.append(host);
  try {
    await act(async () => root.render(<EditorDisclosure title="Pokročilé" busy>{content}</EditorDisclosure>));
    expect(content).not.toHaveBeenCalled();
    const details = host.querySelector('details')!;
    await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')); });
    expect(host.querySelector('input')).not.toBeNull();
    await act(async () => { details.open = false; details.dispatchEvent(new Event('toggle')); });
    expect(details.open).toBe(true);
    expect(host.querySelector('input')).not.toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

test('optional answer photography mounts only when its editor opens and preserves the saved reference', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'), root = createRoot(host), onChange = vi.fn();
  document.body.append(host);
  const source = 'https://example.test/private-answer.png';
  try {
    await act(async () => root.render(<QuestionForm slide={{ ...question, answerImage: source }} number={1} disabled={false} showAllIssues={false} touched={new Set()} onTouch={vi.fn()} onChange={onChange} />));
    const section = host.querySelector<HTMLDetailsElement>('[data-preflight-field="answerImage"]')!;
    expect(section.textContent).toContain('fotografie přidána');
    expect(section.querySelector('img')).toBeNull();
    expect(section.querySelector('.media-picker')).toBeNull();
    await act(async () => { section.open = true; section.dispatchEvent(new Event('toggle')); });
    expect(section.textContent).toContain('Fotografie je volitelná');
    expect(section.querySelector('img')?.getAttribute('src')).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => [...section.querySelectorAll('button')].find(button => button.textContent === 'Odebrat')!.click());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ answerImage: '', correctAnswer: question.correctAnswer }));
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

test('expanded preview uses the same private renderer, closes with Escape and restores the expand button focus', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(<EditorPreview slide={question} quizTitle="Kvíz" showAnswer={false} onShowAnswer={vi.fn()} />));
    const expand = host.querySelector('button')!;
    await act(async () => expand.click());
    const dialog = host.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(host.querySelectorAll('.slide-renderer')).toHaveLength(1);
    expect(dialog.textContent).toContain('Otázka');
    expect(dialog.textContent).not.toContain('Soukromá odpověď');
    await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
    expect(host.querySelector('dialog')).toBeNull();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(expand);
    expect(host.querySelectorAll('.slide-renderer')).toHaveLength(1);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
