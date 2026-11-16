import { HttpsError } from 'firebase-functions/v2/https';
import { parseQuizAsset, validOwnedMedia, normalizeSlideDesign, parseInterimBackdrop, type OwnedMediaKind } from '@filmovy-kviz/quiz-domain';
import type { Transaction, Firestore } from 'firebase-admin/firestore';

export const assetPath = (quizId: string, assetId: string) => 'quiz-assets/' + quizId + '/' + assetId + '/source';
export function mediaId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/u.test(value)) throw new HttpsError('invalid-argument', 'Neplatné ID média.');
  return value;
}
export function mediaInput(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new HttpsError('invalid-argument', 'Neplatný požadavek média.');
  return value as Record<string, unknown>;
}
export function mediaSignature(bytes: Uint8Array, contentType: string): boolean {
  const b = Buffer.from(bytes), ascii = (start: number, end: number) => b.subarray(start, end).toString('ascii');
  if (contentType === 'image/png') return b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && ascii(12,16) === 'IHDR';
  if (contentType === 'image/jpeg') return b.length >= 4 && b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (contentType === 'image/webp') return b.length >= 16 && ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP';
  if (contentType === 'audio/wav') return b.length >= 44 && ascii(0,4) === 'RIFF' && ascii(8,12) === 'WAVE';
  if (contentType === 'audio/mpeg') return b.length >= 4 && (ascii(0,3) === 'ID3' || (b[0] === 255 && (b[1]! & 0xe0) === 0xe0));
  if (contentType === 'video/mp4') {
    if (b.length < 24 || ascii(4,8) !== 'ftyp') return false;
    const length = b.readUInt32BE(0);
    if (length < 24 || length > b.length || (length - 16) % 4 !== 0) return false;
    const brands = ['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1'];
    return brands.includes(ascii(8,12)) || Array.from({ length: (length - 16) / 4 }, (_, index) => ascii(16 + index * 4,20 + index * 4)).some(brand => brands.includes(brand));
  }
  return false;
}
export function mediaByteRange(header: string | undefined, size: number): { start: number; end: number } | undefined {
  if (header === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
  if (!match || (!match[1] && !match[2])) throw new Error('Invalid range');
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size || (!match[1] && Number(match[2]) <= 0)) throw new Error('Invalid range');
  return { start, end };
}
// Exact current publication only: ordinary AUDIO has no public source; unrevealed answer is absent.
export function publicMediaAllowed(publication: Record<string, unknown> | undefined, reference: string, kind?: string): boolean {
  if (!publication || publication.status !== 'active') return false;
  const design = normalizeSlideDesign(publication.design);
  if ((kind === undefined || kind === 'image') && [design.backgroundImage, design.logoImage].includes(reference)) return true;
  if (publication.interimResults && publication.interimBackdrop && (kind === undefined || kind === 'image')) {
    try {
      const backdrop = parseInterimBackdrop(publication.interimBackdrop), appearance = normalizeSlideDesign(backdrop.design);
      if ([appearance.backgroundImage, appearance.logoImage, backdrop.backgroundImage].includes(reference)) return true;
      if (['image','picture','photo'].includes(backdrop.slideKind) && backdrop.questionImage === reference) return true;
    } catch { return false; }
  }
  if (publication.interimResults || publication.finalReveal) return false;
  return ((kind === undefined || kind === 'image') && publication.backgroundImage === reference)
    || ((kind === undefined || kind === 'image') && ['image','picture','photo'].includes(String(publication.slideKind)) && publication.questionImage === reference)
    || ((kind === undefined || kind === 'image') && publication.answerRevealed === true && publication.answerImage === reference)
    || ((kind === undefined || kind === 'audio') && publication.renderMode === 'recap' && ['audio','music'].includes(String(publication.slideKind)) && publication.mediaSource === reference)
    || ((kind === undefined || kind === 'video') && ['question','recap'].includes(String(publication.renderMode)) && ['video','youtube'].includes(String(publication.slideKind)) && publication.mediaSource === reference);
}
export async function assertQuizAssets(transaction: Transaction, db: Firestore, quizId: string, slides: readonly Record<string, unknown>[]): Promise<void> {
  const sources = new Map<string, OwnedMediaKind>();
  for (const slide of slides) {
    for (const design of [slide.design, slide.answerDesign]) {
      const normalized = normalizeSlideDesign(design);
      for (const source of [normalized.backgroundImage, normalized.logoImage]) {
        if (!source?.startsWith('quiz-asset:')) continue;
        const asset = parseQuizAsset(source);
        if (!asset || asset.quizId !== quizId || (sources.has(source) && sources.get(source) !== 'image')) throw new HttpsError('invalid-argument', 'Asset nepatří do tohoto kvízu.');
        sources.set(source, 'image');
      }
    }
    for (const field of ['questionImage', 'mediaSource', 'answerImage', 'backgroundImage']) {
      const value = slide[field];
      if (typeof value !== 'string' || !value.startsWith('quiz-asset:')) continue;
      const asset = parseQuizAsset(value);
      if (!asset || asset.quizId !== quizId
        || (field === 'mediaSource' && !['audio','music','video','youtube'].includes(String(slide.kind)))
        || (field === 'questionImage' && !['image','picture','photo'].includes(String(slide.kind)))) throw new HttpsError('invalid-argument', 'Asset nepatří do této otázky a kvízu.');
      const expectedKind = field === 'mediaSource' ? (['video','youtube'].includes(String(slide.kind)) ? 'video' : 'audio') : 'image';
      if (sources.has(value) && sources.get(value) !== expectedKind) throw new HttpsError('invalid-argument', 'Asset má neslučitelné role.');
      sources.set(value, expectedKind);
    }
    if (Array.isArray(slide.media) && slide.media.some((entry: unknown) => entry && typeof entry === 'object' && 'source' in entry && typeof entry.source === 'string' && entry.source.startsWith('quiz-asset:'))) throw new HttpsError('invalid-argument', 'Vlastní asset patří do normalizovaného pole otázky.');
  }
  for (const [source, kind] of sources) {
    const asset = parseQuizAsset(source)!;
    const data = (await transaction.get(db.doc('quizzes/' + quizId + '/mediaAssets/' + asset.assetId))).data();
    if (!data || typeof data.generation !== 'string' || data.status !== 'ready' || data.quizId !== quizId || data.kind !== kind || !validOwnedMedia(data.kind, data.contentType, data.size)) throw new HttpsError('failed-precondition', 'Médium ještě není připravené pro otázku.');
  }
}
