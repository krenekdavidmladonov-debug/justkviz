import { collectPreflightMedia, mediaReadiness, normalizeResultTemplates, offlineMediaSourceKind } from '@filmovy-kviz/quiz-domain';
import { requiredOfflineMedia, type OfflineSource } from './source.js';
import type { PreparedMediaRecord } from './prepare.js';

/** Read-only advice over the same export inventory. No IO, signatures or export eligibility changes. */
export function offlineMediaRecommendations(source: OfflineSource, media: readonly PreparedMediaRecord[]) {
  const quiz = { id: source.quizId, title: '', description: '', revision: source.quizRevision,
    slides: source.slides, slideCount: source.slides.length, questionCount: source.slides.filter(slide => slide.isQuestion).length,
    roundCount: source.rounds.length, resultTemplates: normalizeResultTemplates(source.snapshot.resultTemplates) };
  const drive = new Set(media.filter(item => item.record.storageBackend === 'drive' || (item.record.drive !== undefined && item.record.drive !== null)).map(item => item.reference));
  const advisory = mediaReadiness(quiz, { offlineExcludedReferences: drive });
  const excluded = new Map([...requiredOfflineMedia(source).excluded].map(([reference]) => [reference, offlineMediaSourceKind(reference) ?? 'external'] as const));
  for (const item of media) {
    if (item.record.drive !== undefined || (item.record.storageBackend !== undefined && item.record.storageBackend !== 'storage'))
      excluded.set(item.reference, drive.has(item.reference) ? 'drive' : 'external');
  }
  return { media: { ...advisory.summary, offlineExcludedCount: excluded.size,
    youtubeCount: [...excluded.values()].filter(kind => kind === 'youtube').length,
    driveCount: [...excluded.values()].filter(kind => kind === 'drive').length,
    externalCount: [...excluded.values()].filter(kind => kind === 'external').length },
    issues: advisory.issues.map(issue => ({ slidePosition: source.slides.find(slide => slide.id === issue.reference.questionId)?.position ?? 0,
      field: issue.fixTarget?.field ?? 'media', message: issue.message })),
    imageSources: [...new Set(collectPreflightMedia(quiz).filter(use => use.image).map(use => use.source))] };
}
