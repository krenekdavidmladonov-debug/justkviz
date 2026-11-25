import { useMemo, useState, useSyncExternalStore } from 'react';
import { collectPreflightMedia, runQuizPreflight, type EditorQuiz } from '@filmovy-kviz/quiz-domain';
import { preflightImageWidths, subscribePreflightImageWidths } from './imageObservations';
import { ImageResolutionCheck } from './ImageResolutionCheck';
import { AnswerLengthMeasurement, answerMeasurementSlides, answerLengthWarning, type AnswerLengthResult } from './AnswerLengthMeasurement';
import { Link } from 'react-router-dom';

import { questionTypeLabels, semanticQuestionType } from '../editor/semanticModel';
import type { PreflightFixTarget, PreflightIssue, PreflightResult } from './types';
import { preflightVisibleQuiz, preflightFixUrl } from './validation';

const categoryLabels = {
  STRUCTURE: 'Struktura',
  ANSWER: 'Správné odpovědi',
  MEDIA: 'Média',
  TIMING: 'Časování',
  IMAGE: 'Obrázky',
  LEGACY: 'Starší obsah',
  PROJECTOR: 'Projektor',
} as const;

function issueHeading(issue: Pick<PreflightIssue, 'reference'>): string {
  const { reference } = issue;
  if (reference.questionNumber !== undefined && reference.questionType !== undefined) {
    return `${questionTypeLabels[reference.questionType]} · ${reference.roundPosition ?? '—'}. kolo · Otázka ${reference.questionNumber}`;
  }
  if (reference.roundPosition !== undefined) {
    return `${reference.roundPosition}. kolo · ${reference.roundTitle || 'Bez názvu'}`;
  }
  return 'Celý kvíz';
}

function plural(count: number, one: string, few: string, many: string): string {
  return count === 1 ? one : count > 1 && count < 5 ? few : many;
}

export function QuizPreflightPanel({
  quizId,
  result: originalResult,
  quiz: sourceQuiz,
  answersReadable = false,
  onRecheck,
  onFix,
}: {
  readonly quizId: string;
  readonly quiz?: EditorQuiz;
  readonly answersReadable?: boolean;
  readonly result: PreflightResult;
  readonly onRecheck?: () => void;
  readonly onFix?: (target: PreflightFixTarget) => void;
}) {
  const quiz = useMemo(() => sourceQuiz ? preflightVisibleQuiz(sourceQuiz, answersReadable) : undefined, [sourceQuiz, answersReadable]);
  const widths = useSyncExternalStore(subscribePreflightImageWidths, preflightImageWidths);
  const baseResult = useMemo(() => quiz ? runQuizPreflight(quiz, { source: originalResult.source, hasUnsavedChanges: originalResult.issues.some(issue => issue.code === 'UNSAVED_CHANGES'), imageWidths: widths }) : originalResult, [quiz, originalResult, widths]);
  const imageSources = useMemo(() => quiz ? collectPreflightMedia(quiz).filter(use => use.image).map(use => use.source) : [], [quiz]);
  const answerSlides = useMemo(() => quiz && answersReadable ? answerMeasurementSlides(quiz) : [], [quiz, answersReadable]);
  const [measuredAnswers, setMeasuredAnswers] = useState<AnswerLengthResult | null>(null);
  const answerIssues = answerSlides.filter(slide => measuredAnswers?.slides === answerSlides && measuredAnswers.tooLong.has(slide.id)).map(slide => ({
    code: 'ANSWER_TOO_LONG' as const, category: 'PROJECTOR' as const, severity: 'WARNING' as const, message: answerLengthWarning,
    reference: { quizId, ...(slide.roundId ? { roundId: slide.roundId } : {}), ...(slide.roundTitle ? { roundTitle: slide.roundTitle } : {}),
      ...(slide.roundNumber === undefined ? {} : { roundPosition: slide.roundNumber }), questionId: slide.id,
      ...(slide.questionNumber === undefined ? {} : { questionNumber: slide.questionNumber }), questionType: semanticQuestionType(slide) },
    fixTarget: { kind: 'question' as const, ...(slide.roundId ? { roundId: slide.roundId } : {}), questionId: slide.id, field: 'correctAnswer' },
  }));
  const result = { ...baseResult, issues: [...baseResult.issues, ...answerIssues], warningCount: baseResult.warningCount + answerIssues.length,
    status: baseResult.status === 'READY' && answerIssues.length ? 'READY_WITH_WARNINGS' as const : baseResult.status };
  // Unsaved work is distinct from the optional editorial recommendations.
  const hasUnsaved = result.issues.some(issue => issue.code === 'UNSAVED_CHANGES');
  const contentIssues = result.issues.filter(issue => issue.code !== 'UNSAVED_CHANGES');
  const contentBlockers = contentIssues.filter(issue => issue.severity === 'BLOCKER').length;
  const contentReady = contentBlockers === 0;
  const statusMessage = !contentReady
    ? `Kontrola našla ${contentBlockers} ${plural(contentBlockers, 'věc', 'věci', 'věcí')} k prověření. Spuštění tím není podmíněné.`
    : hasUnsaved ? 'Kontrola nenašla nedostatky v obsahu. Před hraním uložte rozepsané změny.'
    : result.warningCount > 0
      ? 'Kontrola nenašla zásadní nedostatky. Můžete si projít doporučení.'
      : 'Kontrola nenašla žádné nedostatky.';
  const visibleCategories = Object.keys(categoryLabels).map(category => [category, {
    blockers: contentIssues.filter(issue => issue.category === category && issue.severity === 'BLOCKER').length,
    warnings: contentIssues.filter(issue => issue.category === category && issue.severity === 'WARNING').length,
  }] as const)
    .filter(([, count]) => count.blockers > 0 || count.warnings > 0);

  return (
    <section
      className={`quiz-preflight-panel status-${hasUnsaved && contentReady ? 'draft' : result.status.toLowerCase()}`}
      aria-labelledby="quiz-preflight-title"
      data-preflight-status={result.status}
      data-blocker-count={result.blockerCount}
      data-content-blocker-count={contentBlockers}
      data-warning-count={result.warningCount}
      data-round-count={result.roundCount}
      data-question-count={result.questionCount}
      data-validation-duration-ms={result.validationDurationMs.toFixed(3)}
    >
      {answersReadable && <AnswerLengthMeasurement slides={answerSlides} quizTitle={quiz?.title ?? ''} onMeasured={setMeasuredAnswers} />}
      <header className="preflight-heading">
        <div>
          <span>DOBROVOLNÁ KONTROLA KVÍZU</span>
          <h1 id="quiz-preflight-title">Kontrola kvízu</h1>
          <p>{result.source === 'LOCAL_DRAFT'
            ? 'Kontrola průběžně zahrnuje i vaše rozepsané změny. Před hraním je uložte.'
            : 'Kontrola uloženého obsahu nemění stav kvízu a není podmínkou spuštění.'}</p>
        </div>
        {onRecheck && <button type="button" className="secondary-button" onClick={onRecheck}>Zkontrolovat znovu</button>}
      </header>
      {hasUnsaved && <p className="field-help" role="status">Rozpracováno — změny zatím nejsou uložené. Použijte Uložit vše.</p>}

      <div className="preflight-status-grid">
        <section className={contentReady ? 'preflight-check ready' : 'preflight-check blocked'}>
          <span aria-hidden="true">{contentReady ? '✓' : '✕'}</span>
          <div><small>OBSAH KVÍZU</small><strong>{contentReady ? 'Bez nalezených nedostatků' : 'Položky k prověření'}</strong></div>
        </section>
        <section className="preflight-check neutral">
          <span aria-hidden="true">○</span>
          <div><small>PROJEKTOR</small><strong>Neověřeno</strong><p>Stav projektoru lze spolehlivě určit až v živém řízení.</p></div>
        </section>
      </div>

      <dl className="preflight-metrics">
        <div><dt>Struktura</dt><dd>{result.roundCount} kol · {result.questionCount} otázek</dd></div>
        <div><dt>Správné odpovědi</dt><dd>{result.validAnswerCount} / {result.questionCount}</dd></div>
        <div><dt>K prověření</dt><dd>{contentBlockers}</dd></div>
        <div><dt>Doporučení</dt><dd>{result.warningCount}</dd></div>
      </dl>

      {result.media && <div className="preflight-media-advisory">
        <p>Rozpoznané odkazy mimo offline balíček: {result.media.offlineExcludedCount} médií: YouTube {result.media.youtubeCount}, Google Drive {result.media.driveCount}, ostatní externí odkazy {result.media.externalCount}. Počítáme různé zdroje, opakované použití jednou.</p>
        <p>Obrázky pod 800 px na šířku: {result.media.smallImageCount}. Adresy obrázků s možnou nápovědou: {result.media.answerUrlCount}.</p>
        <p>Vlastní média se ověří při offline přípravě; soubory uložené na Drive se neexportují. Kontrola žádné médium nenahrazuje a spuštění neblokuje.</p>
        {quiz && <ImageResolutionCheck sources={imageSources} />}
      </div>}
      {visibleCategories.length > 0 && (
        <ul className="preflight-category-list" aria-label="Souhrn oblastí">
          {visibleCategories.map(([category, count]) => (
            <li
              key={category}
              data-category={category}
              data-category-blockers={count.blockers}
              data-category-warnings={count.warnings}
            >
              <strong>{categoryLabels[category as keyof typeof categoryLabels]}</strong>
              <span>{count.blockers > 0 ? `${count.blockers} k opravě` : ''}{count.blockers > 0 && count.warnings > 0 ? ' · ' : ''}{count.warnings > 0 ? `${count.warnings} doporučení` : ''}</span>
            </li>
          ))}
        </ul>
      )}

      {contentIssues.length > 0 && (
        <ol className="preflight-issues" aria-label="Nalezené problémy">
          {contentIssues.map((issue, index) => (
            <li className={`preflight-issue severity-${issue.severity.toLowerCase()}`} key={`${issue.code}-${issue.reference.questionId ?? issue.reference.roundId ?? 'quiz'}-${index}`} data-issue-code={issue.code} data-issue-category={issue.category}>
              <span className="preflight-severity">{issue.severity === 'BLOCKER' ? 'K PROVĚŘENÍ' : 'DOPORUČENÍ'}</span>
              <strong>{issueHeading(issue)}</strong>
              <p>{issue.message}</p>
              {issue.fixTarget && (onFix
                ? <button type="button" className="secondary-button compact-button" onClick={() => onFix(issue.fixTarget!)}>Opravit</button>
                : <Link className="secondary-link" to={preflightFixUrl(quizId, issue.fixTarget)}>Opravit</Link>)}
            </li>
          ))}
        </ol>
      )}

      <footer className="preflight-result" role="status" aria-live="polite">
        <strong>{statusMessage}</strong>
        {result.warningCount > 0 && <p>Doporučení hraní neblokují. Obrázky, zvuk a video z externích odkazů si před akcí přehrajte na zařízení, které použijete.</p>}
      </footer>
    </section>
  );
}
