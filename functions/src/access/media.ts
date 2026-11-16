import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { mapEditorSlide, parseQuizAsset, normalizeSlideDesign, normalizeResultTemplates, normalizePrintTemplate } from '@filmovy-kviz/quiz-domain';
import { authorize, type AuthIdentity } from './authorization.js';
import { slideView, snapshotResource } from './reads.js';
import { assertEventOperational } from '../events/guards.js';
import { eventShowAudioAllowed } from '../show-mode/audio-model.js';
import { loadSnapshotClipAssets } from '../media/snapshot-clip-store.js';
import { resolveSnapshotClip } from '../media/snapshot-clips.js';

/** Event scope authorizes only an exact current linked ready generation, never arbitrary quiz audio. */
export async function authorizeEventShowMedia(auth: AuthIdentity, eventId: string, reference: string): Promise<string> {
  const parsed = parseQuizAsset(reference);
  if (!parsed) throw new HttpsError('permission-denied', 'Médium není dostupné.');
  const db = getFirestore();
  return db.runTransaction(async tx => {
    await authorize(auth, ['event.live'], { kind: 'event', id: eventId }, tx);
    const event = (await tx.get(db.doc('events/' + eventId))).data();
    assertEventOperational(event);
    const asset = (await tx.get(db.doc(`quizzes/${parsed.quizId}/mediaAssets/${parsed.assetId}`))).data();
    if (!eventShowAudioAllowed(event, reference, asset)) throw new HttpsError('permission-denied', 'Zvuk není přiřazený k této akci.');
    return asset!.generation as string;
  });
}

export async function authorizePrivateMedia(auth: AuthIdentity, reference: string, snapshotId?: string) {
  const parsed = parseQuizAsset(reference);
  if (!parsed) throw new HttpsError('permission-denied', 'Médium není dostupné.');
  const db = getFirestore();
  return db.runTransaction(async tx => {
    const resource = snapshotId ? await snapshotResource(auth, snapshotId, tx) : { kind: 'quiz' as const, id: parsed.quizId };
    const member = await authorize(auth, [snapshotId ? 'event.read' : 'quiz.read'], resource, tx);
    const answers = member.permissions.includes(snapshotId ? 'event.answers.read' : 'quiz.answers.read');
    const source = db.collection(snapshotId ? `quizSnapshots/${snapshotId}/slides` : `quizzes/${parsed.quizId}/slides`);
    const slides = await tx.get(source.limit(401));
    if (slides.size > 400) throw new HttpsError('permission-denied', 'Médium není dostupné.');
    const all = slides.docs.map(d => mapEditorSlide(d.id, d.data()));
    const answerReference = all.some(s => s.answerImage === reference || [s.answerDesign?.backgroundImage, s.answerDesign?.logoImage].includes(reference) || s.media.some(m => m.role === 'answer' && m.source === reference));
    if (answerReference && !answers) throw new HttpsError('permission-denied', 'Médium není dostupné.');
    const root = (await tx.get(db.doc(snapshotId ? `quizSnapshots/${snapshotId}` : `quizzes/${parsed.quizId}`))).data();
    if (snapshotId && root?.quizId !== parsed.quizId) throw new HttpsError('permission-denied', 'Médium nepatří do této akce.');
    const assets = snapshotId ? await loadSnapshotClipAssets(tx, db, root!.quizId as string, slides.docs.map(d => d.data()), parsed.assetId) : [];
    const visible = slides.docs.map(d => slideView(d.id, snapshotId ? resolveSnapshotClip(root!.quizId as string, d.data(), assets) : d.data(), answers, false,
      { preserveStoredImages: true }));
    const appearance = root?.defaultAppearance as { backgroundImage?: unknown } | undefined;
    const defaults = normalizeSlideDesign(root?.defaultDesign), templates = normalizeResultTemplates(root?.resultTemplates);
    const attached = appearance?.backgroundImage === reference || [normalizePrintTemplate(root?.printTemplate).logoImage, defaults.backgroundImage, defaults.logoImage, templates.interim?.design?.backgroundImage, templates.interim?.design?.logoImage, templates.final?.design?.backgroundImage, templates.final?.design?.logoImage].includes(reference) || visible.some(s => [s.backgroundImage, s.questionImage, s.answerImage, s.mediaSource, s.design?.backgroundImage, s.design?.logoImage, s.answerDesign?.backgroundImage, s.answerDesign?.logoImage, ...s.media.map(m => m.source)].includes(reference));
    if (snapshotId && !attached) throw new HttpsError('permission-denied', 'Médium nepatří do této akce.');
    if (!snapshotId && !attached && !answers) {
      const asset = (await tx.get(db.doc(`quizzes/${parsed.quizId}/mediaAssets/${parsed.assetId}`))).data();
      if (asset?.createdBy !== member.uid || !member.permissions.includes('quiz.media.upload')) throw new HttpsError('permission-denied', 'Médium není dostupné.');
    }
    return member.version;
  });
}
