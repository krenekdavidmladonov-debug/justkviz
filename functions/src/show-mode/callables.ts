import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { normalizeShowPreferences, parseQuizAsset, showAudioCues, mapEditorSlide } from '@filmovy-kviz/quiz-domain';
import { authorize, freshIdentity, runAccessTransaction, securedOnCall } from '../access/authorization.js';
import { assertEventOperational } from '../events/guards.js';
import { assertQuizActive } from '../quizzes/guards.js';
import { mediaId, mediaInput } from '../media/model.js';
import { readyShowAudio, requestedShowPreferences, type ShowAudioBindings } from './audio-model.js';

const options = { region: 'europe-west1', cors: true, maxInstances: 10 };
export const readEventShowPreferences = securedOnCall('readEventShowPreferences', options, async request => {
  const data = mediaInput(request.data, ['eventId']), eventId = mediaId(data.eventId), db = getFirestore();
  return runAccessTransaction(db, async tx => {
    await freshIdentity(request.auth);
    const event = (await tx.get(db.doc('events/' + eventId))).data();
    assertEventOperational(event);
    if (!Number.isSafeInteger(event.revision) || (event.revision as number) < 1) throw new HttpsError('failed-precondition', 'Neplatná revize akce.');
    return { eventId, revision: event.revision as number, preferences: normalizeShowPreferences(event.showPreferences) };
  });
});
export const configureEventShow = securedOnCall('configureEventShow', options, async request => {
  const data = mediaInput(request.data, ['eventId', 'expectedRevision', 'preferences']);
  const eventId = mediaId(data.eventId), preferences = requestedShowPreferences(data.preferences), db = getFirestore();
  if (!Number.isSafeInteger(data.expectedRevision) || (data.expectedRevision as number) < 1) throw new HttpsError('invalid-argument', 'Chybí revize akce.');
  return runAccessTransaction(db, async tx => {
    await freshIdentity(request.auth);
    const ref = db.doc('events/' + eventId), event = (await tx.get(ref)).data();
    assertEventOperational(event);
    if (event.revision !== data.expectedRevision) throw new HttpsError('aborted', 'Akce se změnila. Načtěte nastavení znovu.');
    const previous = normalizeShowPreferences(event.showPreferences), bindings: ShowAudioBindings = {};
    const checked = new Set<string>();
    for (const cue of showAudioCues) {
      const reference = preferences.cues[cue];
      if (!reference) continue;
      const parsed = parseQuizAsset(reference)!;
      const asset = (await tx.get(db.doc(`quizzes/${parsed.quizId}/mediaAssets/${parsed.assetId}`))).data();
      // Existing event links remain usable by event-scoped staff. New links need source authority.
      if (!Object.values(previous.cues).includes(reference) && !checked.has(reference)) {
        const member = await authorize(request.auth, ['quiz.read'], { kind: 'quiz', id: parsed.quizId }, tx);
        const quiz = await tx.get(db.doc('quizzes/' + parsed.quizId));
        if (!quiz.exists) throw new HttpsError('permission-denied', 'Zdrojový kvíz není dostupný.');
        assertQuizActive(quiz.data());
        const slides = await tx.get(db.collection('quizzes/' + parsed.quizId + '/slides').limit(401));
        if (slides.size > 400) throw new HttpsError('failed-precondition', 'Zdrojový kvíz je příliš velký.');
        const mapped = slides.docs.map(d => mapEditorSlide(d.id, d.data()));
        const privateAnswer = mapped.some(s =>
          s.answerImage === reference || [s.answerDesign?.backgroundImage, s.answerDesign?.logoImage].includes(reference)
          || s.media.some(m => m.role === 'answer' && m.source === reference));
        if (privateAnswer && !member.permissions.includes('quiz.answers.read')) throw new HttpsError('permission-denied', 'Médium není dostupné.');
        const promptVisible = mapped.some(s => s.mediaSource === reference || s.media.some(m => ['prompt','background'].includes(m.role) && m.source === reference));
        if (!member.permissions.includes('quiz.answers.read') && !promptVisible && !(asset?.createdBy === member.uid && member.permissions.includes('quiz.media.upload'))) {
          throw new HttpsError('permission-denied', 'Médium není dostupné ve zdrojovém kvízu.');
        }
        checked.add(reference);
      }
      bindings[cue] = readyShowAudio(reference, asset);
    }
    const revision = (event.revision as number) + 1;
    tx.update(ref, { showPreferences: preferences, showAudioBindings: bindings, revision, updatedAt: Timestamp.now(), updatedBy: request.auth!.uid });
    return { eventId, revision, preferences };
  });
});
