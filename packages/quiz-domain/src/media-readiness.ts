import { isSafeHttpUrl, youtubeVideoId } from './presentation.js';
import { canHideInfoSlide, resolveLegacySlideAppearance, resolveSlideDesign } from './design.js';
import { parseQuizAsset } from './media-assets.js';
import { correctOptionIndex } from './validation.js';
import { buildSemanticQuizModel } from './semantic.js';
import type { EditorQuiz, EditorSlide, PreflightIssue, PreflightMediaSummary } from './types.js';

export interface PreflightMediaUse { readonly source: string; readonly field: string; readonly slide?: EditorSlide; readonly image: boolean }
/** References actually used by presentation; provenance/originalMediaSource is not an export input. */
export function collectPreflightMedia(quiz: EditorQuiz): PreflightMediaUse[] {
  const uses: PreflightMediaUse[] = [];
  const add = (source: string | undefined, field: string, image: boolean, slide?: EditorSlide) => {
    if (source && (isSafeHttpUrl(source) || parseQuizAsset(source) || (!image && youtubeVideoId(source)))) uses.push({ source, field, image, ...(slide ? { slide } : {}) });
  };
  const roundDesigns = new Map(buildSemanticQuizModel(quiz).rounds.flatMap(round => round.slides.map(slide => [slide.id, round.settingsSlide?.design] as const)));
  for (const slide of quiz.slides) {
    if (slide.hidden && canHideInfoSlide(slide)) continue;
    for (const field of ['questionImage', 'answerImage'] as const) add(slide[field], field, true, slide);
    add(resolveLegacySlideAppearance(quiz.defaultAppearance, slide).backgroundImage, 'backgroundImage', true, slide);
    const design = resolveSlideDesign(quiz.defaultDesign, roundDesigns.get(slide.id), slide.design);
    add(design.backgroundImage, 'design.backgroundImage', true, slide);
    add(design.logoImage, 'design.logoImage', true, slide);
    add(slide.answerDesign?.backgroundImage, 'answerDesign.backgroundImage', true, slide);
    add(slide.answerDesign?.logoImage, 'answerDesign.logoImage', true, slide);
    if (['audio', 'music', 'video', 'youtube'].includes(slide.kind)) add(slide.mediaSource, 'mediaSource', false, slide);
    for (const media of slide.media) add(media.source, 'media', media.kind === 'image', slide);
  }
  for (const name of ['interim', 'final'] as const) {
    add(quiz.resultTemplates?.[name]?.design?.backgroundImage, name + '.backgroundImage', true);
    add(quiz.resultTemplates?.[name]?.design?.logoImage, name + '.logoImage', true);
  }
  return uses;
}

export function offlineMediaSourceKind(source: string): 'youtube' | 'drive' | 'external' | undefined {
  if (youtubeVideoId(source)) return 'youtube';
  if (!isSafeHttpUrl(source)) return undefined;
  const host = new URL(source).hostname.toLowerCase();
  return host === 'drive.google.com' || host === 'docs.google.com' ? 'drive' : 'external';
}
const words = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('cs-CZ').match(/[\p{L}\p{N}]+/gu) ?? [];
const stopWords = new Set(['a', 'v', 've', 'na', 'do', 'od', 'z', 'ze', 's', 'se', 'u', 'o', 'i', 'je', 'to', 'the', 'of', 'and']);
/** Never returns the matched private word or the URL as diagnostic evidence. */
export function imageUrlContainsAnswer(source: string, slide: EditorSlide): boolean {
  if (!isSafeHttpUrl(source)) return false;
  const index = correctOptionIndex(slide);
  const answer = index === undefined ? slide.correctAnswer : slide.options[index] ?? '';
  const answerWords = words(answer).filter(word => word.length >= 2 && !stopWords.has(word));
  let decoded = source;
  // Decode nested percent encodings, bounded independently of untrusted input.
  for (let n = 0; n < 3; n++) {
    const next = decoded.replace(/(?:%[\da-f]{2})+/giu, part => { try { return decodeURIComponent(part); } catch { return part; } });
    if (next === decoded) break;
    decoded = next;
  }
  const urlWords = new Set(words(decoded));
  return answerWords.some(word => urlWords.has(word));
}

export function mediaReadiness(quiz: EditorQuiz, options: {
  readonly imageWidths?: ReadonlyMap<string, number>;
  readonly offlineExcludedReferences?: ReadonlySet<string>;
} = {}): { summary: PreflightMediaSummary; issues: PreflightIssue[] } {
  const uses = collectPreflightMedia(quiz), images = new Set(uses.filter(use => use.image).map(use => use.source));
  const sources = new Map(uses.map(use => [use.source, use]));
  const summary = { imageCount: images.size, smallImageCount: 0, unknownImageCount: 0,
    offlineExcludedCount: 0, youtubeCount: 0, driveCount: 0, externalCount: 0, answerUrlCount: 0 };
  const references = new Map(buildSemanticQuizModel(quiz).rounds.flatMap(round => round.questions.map(question => [question.slide.id, { roundId: round.id, roundPosition: round.position, questionNumber: question.number, questionType: question.type }] as const)));
  const issues: PreflightIssue[] = [];
  const add = (use: PreflightMediaUse, code: PreflightIssue['code'], message: string) => {
    const slide = use.slide;
    issues.push({ severity: 'WARNING', category: use.image ? 'IMAGE' : 'MEDIA', code, message,
      reference: { quizId: quiz.id, ...(slide ? { questionId: slide.id, ...references.get(slide.id) } : {}) },
      ...(slide?.isQuestion && slide.roundId ? { fixTarget: { kind: 'question' as const, questionId: slide.id, roundId: slide.roundId, field: use.field } } : {}) });
  };
  for (const [source, use] of sources) {
    const kind = offlineMediaSourceKind(source) ?? (options.offlineExcludedReferences?.has(source) ? 'drive' : undefined);
    if (kind) {
      summary.offlineExcludedCount++;
      if (kind === 'youtube') summary.youtubeCount++;
      else if (kind === 'drive') summary.driveCount++;
      else summary.externalCount++;
      add(use, 'MEDIA_NOT_OFFLINE', `${kind === 'youtube' ? 'YouTube ukázka' : kind === 'drive' ? 'Médium na Google Drive' : 'Externí médium'} nevstupuje do offline balíčku. Pro offline hraní použijte vlastní soubor v podporovaném úložišti.`);
    }
    if (images.has(source)) {
      const width = options.imageWidths?.get(source);
      if (!Number.isSafeInteger(width) || width === undefined || width < 1) summary.unknownImageCount++;
      else if (width < 800) { summary.smallImageCount++; add(use, 'IMAGE_WIDTH_SMALL', 'Obrázek má šířku menší než 800 px. Pro projekci zvažte větší obrázek.'); }
      if (uses.some(item => item.source === source && item.slide && imageUrlContainsAnswer(source, item.slide))) {
        summary.answerUrlCount++;
        add(use, 'IMAGE_URL_ANSWER_HINT', 'Adresa externího obrázku může napovídat správnou odpověď. Zvažte vlastní soubor s neutrálním názvem.');
      }
    }
  }
  return { summary, issues };
}
