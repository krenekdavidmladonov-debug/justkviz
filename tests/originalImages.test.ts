import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { resolveOriginalImages } from '../functions/src/media/original-images';
import { slideView } from '../functions/src/access/slide-view';
import { buildPublicSessionState } from '../functions/src/live/publication';
import type { PrivateLiveSession, PrivateSlide } from '../functions/src/live/types';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function image(field: string, letter: string, url = `https://images.example.test/${field}.png`) {
  const importJobId = letter.repeat(64), reference = `quiz-asset:quiz/${hash(['drive-asset-v1', importJobId])}`;
  const source = { type: 'https-image', kind: 'image', url };
  return { reference, url, receipt: { importJobId, field, source, sourceFingerprint: hash(source), sourceQuizRevision: 7 } };
}
function slide() {
  const question = image('questionImage', 'a'), answer = image('answerImage', 'b'), background = image('backgroundImage', 'c');
  return { id: 'slide', kind: 'image', position: 1, isQuestion: true, title: 'Frozen', text: 'Frozen prompt', options: [], presentation: {},
    correctAnswer: 'PRIVATE_ANSWER', moderatorNote: 'PRIVATE_NOTE', questionImage: question.reference, answerImage: answer.reference, backgroundImage: background.reference,
    mediaSource: `quiz-asset:quiz/${'e'.repeat(64)}`, clipStartSeconds: 0, clipEndSeconds: 13,
    media: [{ kind: 'image', role: 'prompt', source: question.reference }, { kind: 'image', role: 'answer', source: answer.reference }],
    design: { backgroundImage: background.reference }, answerDesign: { backgroundImage: answer.reference },
    driveImportProvenance: { questionImage: question.receipt, answerImage: answer.receipt, backgroundImage: background.receipt } };
}

test('derives original HTTPS images in editor and frozen views without changing the source or prepared AV clip', () => {
  const raw = slide(), frozen = structuredClone(raw), resolved = resolveOriginalImages(raw);
  expect(resolved).toMatchObject({ questionImage: image('questionImage', 'a').url, answerImage: image('answerImage', 'b').url,
    backgroundImage: image('backgroundImage', 'c').url, mediaSource: raw.mediaSource, clipStartSeconds: 0, clipEndSeconds: 13,
    media: [{ source: image('questionImage', 'a').url }, { source: image('answerImage', 'b').url }],
    design: { backgroundImage: image('backgroundImage', 'c').url }, answerDesign: { backgroundImage: image('answerImage', 'b').url } });
  const view = slideView('slide', raw, false, false);
  expect(view.questionImage).toBe(image('questionImage', 'a').url);
  expect(view.answerImage).toBe(''); expect(view.answerDesign).toBeUndefined();
  expect(JSON.stringify(view)).not.toMatch(/PRIVATE_|answerImage\.png|driveImportProvenance|sourceFingerprint|importJobId/u);
  expect(slideView('slide', raw, true, true).answerImage).toBe(image('answerImage', 'b').url);
  expect(raw).toEqual(frozen);
});

test.each(['missing', 'job', 'fingerprint', 'field', 'source', 'revision', 'detached', 'empty'] as const)('%s provenance retains the saved image without guessing a URL', mode => {
  const raw = slide(), receipt: Record<string, unknown> = raw.driveImportProvenance.questionImage;
  if (mode === 'missing') delete (raw.driveImportProvenance as Record<string, unknown>).questionImage;
  if (mode === 'job') receipt.importJobId = 'f'.repeat(64);
  if (mode === 'fingerprint') receipt.sourceFingerprint = 'f'.repeat(64);
  if (mode === 'field') receipt.field = 'answerImage';
  if (mode === 'source') receipt.source = { type: 'youtube', kind: 'image', url: image('questionImage', 'a').url };
  if (mode === 'revision') receipt.sourceQuizRevision = -1;
  if (mode === 'detached') raw.questionImage = 'https://images.example.test/replacement.png';
  if (mode === 'empty') raw.questionImage = '';
  expect(resolveOriginalImages(raw).questionImage).toBe(raw.questionImage);
});

test('Firestore map key ordering cannot invalidate an otherwise exact image provenance', () => {
  const original = image('questionImage', 'a'), raw = { ...slide(), driveImportProvenance: { questionImage: {
    ...original.receipt, source: { kind: 'image', url: original.url, type: 'https-image' },
  } } };
  expect(resolveOriginalImages(raw).questionImage).toBe(original.url);
});

test.each(['javascript:alert(1)', 'http://images.example.test/a.png', 'https://name:secret@images.example.test/a.png', 'https://images.example.test/a.png#secret', 'invalid'])('unsafe original %s keeps the backup', url => {
  const original = image('questionImage', 'a', url), raw = { ...slide(), questionImage: original.reference,
    driveImportProvenance: { questionImage: original.receipt } };
  expect(resolveOriginalImages(raw).questionImage).toBe(original.reference);
});

test('public publication contains original prompt/background only, and publishes answer URL only after reveal', () => {
  const raw = slide(), resolved = resolveOriginalImages(raw) as unknown as PrivateSlide;
  const session = { sessionId: 'live', status: 'active', quizTitle: 'Frozen', currentSlidePosition: 1, answerRevealed: false,
    presentationMode: 'slide', mediaCommand: 'idle', mediaPlaybackState: 'idle', mediaGeneration: 0, introGeneration: 0, revision: 1 } as PrivateLiveSession;
  const before = buildPublicSessionState(session, resolved);
  expect(before.questionImage).toBe(image('questionImage', 'a').url);
  expect(before.backgroundImage).toBe(image('backgroundImage', 'c').url);
  expect(JSON.stringify(before)).not.toMatch(/PRIVATE_|answerImage\.png|driveImportProvenance|sourceFingerprint|importJobId/u);
  const after = buildPublicSessionState({ ...session, answerRevealed: true }, resolved);
  expect(after.answerImage).toBe(image('answerImage', 'b').url);
  expect(after.revealedAnswer).toBe('PRIVATE_ANSWER');
  expect(after.design?.backgroundImage).toBe(image('answerImage', 'b').url);
  expect(after).not.toHaveProperty('driveImportProvenance');
});
