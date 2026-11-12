import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { resolveSnapshotClip, snapshotClipFingerprint, snapshotClipSource, type SnapshotClipAssetCandidate } from '../functions/src/media/snapshot-clips';
import { verifiedOriginalYoutubeSource } from '../functions/src/media/original-source';
import type { DriveImportAsset, DriveImportJob } from '../functions/src/drive/import-model';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const originalUrl = 'https://www.youtube.com/watch?v=abcdefghijk';
function slide(): Record<string, unknown> {
  return { position: 3, kind: 'video', isQuestion: true, roundId: 'frozen-round', questionNumber: 2,
    mediaSource: originalUrl, clipStartSeconds: 10, clipEndSeconds: 23, title: 'Frozen question',
    correctAnswer: 'PRIVATE_ANSWER', options: ['one', 'two'], moderatorNote: 'PRIVATE_NOTE',
    answerImage: 'https://example.invalid/private-answer.png', answerDesign: { background: 'PRIVATE' },
    questionImage: 'https://example.invalid/frozen-prompt.png', design: { retained: true },
    legacy: { raw: { original: 'PRIVATE_RAW' } }, presentation: { videoStart: 1, videoEnd: 5 },
    driveImportProvenance: { answerImage: { retained: 'PRIVATE_PROVENANCE' }, mediaSource: { old: true } } };
}
function candidate(raw = slide(), jobId = 'b'.repeat(64), durationSeconds = 13): SnapshotClipAssetCandidate {
  const source = snapshotClipSource(raw)!;
  const assetId = hash(['drive-asset-v1', jobId]);
  const contentType = source.kind === 'video' ? 'video/mp4' : 'audio/mpeg';
  const file = { id: 'private_file', folderId: 'private_folder', mimeType: contentType, size: 1024,
    sha256: 'd'.repeat(64), md5Checksum: 'e'.repeat(32) };
  const privateProvenance = { source, sourceFingerprint: hash(source), sourceQuizRevision: 9, field: 'mediaSource' as const };
  const data: DriveImportAsset = { quizId: 'quiz', assetId, status: 'ready', storageBackend: 'drive', kind: source.kind,
    contentType, size: file.size, sha256: file.sha256, generation: 'drive:' + file.sha256,
    createdBy: 'owner', createdAt: 100, readyAt: 200, importJobId: jobId,
    drive: { ownerUid: 'owner', accountPermissionId: 'account_permission', connectionGeneration: 2, file }, privateProvenance };
  const job: DriveImportJob = { schemaVersion: 1, quizId: 'quiz', slideId: 'newer-library-slide', field: 'mediaSource', jobId,
    ownerUid: 'owner', membershipVersion: 2, connectionRevision: 3, connectionGeneration: 2, authValidAfter: 0,
    folderId: file.folderId, accountPermissionId: 'account_permission', source, sourceFingerprint: hash(source), sourceQuizRevision: 9,
    status: 'ready', createdAt: 100, updatedAt: 200, attempt: 1, fileId: file.id, assetId,
    output: { contentType, size: file.size, sha256: file.sha256, md5Checksum: file.md5Checksum, durationSeconds } };
  return { id: assetId, data, job };
}
const record = (value: unknown) => value as Record<string, unknown>;
function change(path: string, value: unknown): (candidate: SnapshotClipAssetCandidate) => void {
  return candidate => {
    const fields = path.split('.'), leaf = fields.pop()!;
    const target = fields.reduce<Record<string, unknown>>((current, key) => record(current[key]), record(candidate));
    target[leaf] = value;
  };
}

test('source selector follows effective mapped source and timing with canonical ordered fingerprint', () => {
  const raw = slide(), source = { type: 'youtube', kind: 'video', videoId: 'abcdefghijk', startSeconds: 10, endSeconds: 23 };
  expect(snapshotClipSource(raw)).toEqual(source);
  expect(snapshotClipFingerprint(raw)).toBe(hash(source));
  const legacy = { position: 1, kind: 'music', media: [{ role: 'prompt', kind: 'audio', source: 'abcdefghijk' }],
    presentation: { videoStart: 10, videoEnd: 23 } };
  expect(snapshotClipSource(legacy)).toEqual({ ...source, kind: 'audio' });
  expect(snapshotClipSource({ ...legacy, mediaSource: 'https://youtu.be/zyxwvutsrqp', clipStartSeconds: 5, clipEndSeconds: 7 }))
    .toEqual({ type: 'youtube', kind: 'audio', videoId: 'zyxwvutsrqp', startSeconds: 5, endSeconds: 7 });
  expect(snapshotClipSource({ ...legacy, mediaSource: '' })).toBeUndefined();
});

test('resolves a matching immutable import by changing only private media view fields', () => {
  const raw = slide(), before = structuredClone(raw), imported = candidate(raw);
  Object.freeze(raw);
  const result = resolveSnapshotClip('quiz', raw, [imported]);
  expect(result).not.toBe(raw);
  expect(result).toEqual({ ...raw, mediaSource: 'quiz-asset:quiz/' + imported.id, clipStartSeconds: 0, clipEndSeconds: 13,
    driveImportProvenance: { ...record(raw.driveImportProvenance), mediaSource: { ...record(record(imported.data).privateProvenance), importJobId: 'b'.repeat(64) } } });
  expect(raw).toEqual(before);
  for (const key of ['correctAnswer', 'options', 'moderatorNote', 'legacy', 'answerImage', 'answerDesign', 'questionImage', 'design', 'presentation']) {
    expect(result[key]).toBe(raw[key]);
  }
  expect(verifiedOriginalYoutubeSource(result)).toBe(originalUrl);
});

test('matches by exact canonical descriptor rather than source object key insertion order', () => {
  const raw = slide(), imported = candidate(raw);
  const reordered = { endSeconds: 23, startSeconds: 10, videoId: 'abcdefghijk', kind: 'video', type: 'youtube' };
  record(record(imported.data).privateProvenance).source = reordered;
  record(imported.job).source = reordered;
  expect(resolveSnapshotClip('quiz', raw, [imported]).mediaSource).toBe('quiz-asset:quiz/' + imported.id);
});

test('uses verified actual output duration within importer tolerance and preserves the requested frozen interval', () => {
  const raw = slide(), imported = candidate(raw, 'b'.repeat(64), 12.8);
  const result = resolveSnapshotClip('quiz', raw, [imported]);
  expect(result.clipEndSeconds).toBe(12.8);
  expect(record(record(result.driveImportProvenance).mediaSource).source).toMatchObject({ startSeconds: 10, endSeconds: 23 });
  for (const duration of [12.69, 13.31, 0, -1, Infinity, NaN, '13', undefined]) {
    const invalid = candidate(raw); change('job.output.durationSeconds', duration)(invalid);
    expect(resolveSnapshotClip('quiz', raw, [invalid])).toBe(raw);
  }
});

test('audio and legacy media resolve with the same exact source boundary', () => {
  for (const kind of ['audio', 'music', 'video', 'youtube']) {
    const raw = { position: 1, kind, media: [{ role: 'prompt', kind: ['audio', 'music'].includes(kind) ? 'audio' : 'video', source: 'abcdefghijk' }],
      presentation: { videoStart: 10, videoEnd: 23 } };
    const imported = candidate(raw);
    expect(resolveSnapshotClip('quiz', raw, [imported]).mediaSource).toBe('quiz-asset:quiz/' + imported.id);
  }
});

test('noneligible, malformed, unbounded and already owned frozen sources remain identical', () => {
  for (const patch of [
    { kind: 'image' }, { kind: 'question' }, { kind: 'legacy' }, { position: 0 }, { kind: null },
    { mediaSource: '' }, { mediaSource: 'https://example.invalid/abcdefghijk' }, { mediaSource: 'abcdefghijk'.repeat(500) },
    { mediaSource: 'quiz-asset:quiz/' + 'a'.repeat(64), originalMediaSource: originalUrl },
    { clipStartSeconds: -1 }, { clipStartSeconds: NaN, presentation: {} }, { clipEndSeconds: Infinity, presentation: {} }, { clipEndSeconds: 10 },
    { clipEndSeconds: 191 }, { clipStartSeconds: 86399, clipEndSeconds: 86401 },
    { clipStartSeconds: undefined, clipEndSeconds: undefined, presentation: { videoStart: 0, videoEnd: 0 } },
  ]) {
    const raw = { ...slide(), ...patch };
    expect(snapshotClipSource(raw), JSON.stringify(patch)).toBeUndefined();
    expect(snapshotClipFingerprint(raw)).toBeUndefined();
    expect(resolveSnapshotClip('quiz', raw, [candidate()])).toBe(raw);
  }
  const raw = slide();
  expect(resolveSnapshotClip('../quiz', raw, [candidate()])).toBe(raw);
  expect(resolveSnapshotClip('quiz', raw, [])).toBe(raw);
});

describe('malformed or mismatched asset/job bindings cannot replace frozen media', () => {
  const cases: [string, unknown][] = [
    ['id', 'invalid'], ['data', null], ['data.quizId', 'other'], ['data.assetId', 'a'.repeat(64)],
    ['data.status', 'processing'], ['data.storageBackend', 'storage'], ['data.kind', 'audio'],
    ['data.contentType', 'video/webm'], ['data.size', 0], ['data.size', 26 * 1024 * 1024],
    ['data.importJobId', 'c'.repeat(64)], ['data.sha256', 'c'.repeat(64)], ['data.generation', 'drive:' + 'c'.repeat(64)],
    ['data.createdBy', 'other'], ['data.drive.ownerUid', 'other'], ['data.drive.connectionGeneration', -1],
    ['data.drive.accountPermissionId', ''], ['data.drive.file.id', 'bad'], ['data.drive.file.folderId', '../folder'],
    ['data.drive.file.sha256', 'bad'], ['data.drive.file.md5Checksum', 'bad'], ['data.drive.file.size', 999],
    ['data.drive.file.mimeType', 'audio/mpeg'], ['data.privateProvenance', []],
    ['data.privateProvenance.field', 'answerImage'], ['data.privateProvenance.sourceFingerprint', '0'.repeat(64)],
    ['data.privateProvenance.sourceQuizRevision', -1], ['data.privateProvenance.source.videoId', 'zyxwvutsrqp'],
    ['data.privateProvenance.source.kind', 'audio'], ['data.privateProvenance.source.startSeconds', 11],
    ['data.privateProvenance.source.endSeconds', 24], ['data.privateProvenance.source.type', 'https-image'],
    ['data.privateProvenance.source.extra', 'untrusted'], ['job', undefined], ['job.schemaVersion', 2], ['job.status', 'processing'],
    ['job.jobId', 'c'.repeat(64)], ['job.assetId', 'c'.repeat(64)], ['job.quizId', 'other'], ['job.field', 'answerImage'],
    ['job.source.videoId', 'zyxwvutsrqp'], ['job.source.startSeconds', 11], ['job.sourceFingerprint', 'c'.repeat(64)],
    ['job.sourceQuizRevision', 10], ['job.ownerUid', 'other'], ['job.fileId', 'other_file'], ['job.folderId', 'other_folder'],
    ['job.accountPermissionId', 'other_account'], ['job.connectionGeneration', 3], ['job.output', null],
    ['job.output.sha256', 'c'.repeat(64)], ['job.output.md5Checksum', 'c'.repeat(32)], ['job.output.size', 999],
    ['job.output.contentType', 'audio/mpeg'],
  ];
  test.each(cases)('%s fails closed', (path, value) => {
    const raw = slide(), imported = candidate(raw);
    // Detach job/source references so each mutation exercises the intended single binding.
    const detached = structuredClone(imported); record(detached.job).source = structuredClone(record(detached.job).source);
    change(path, value)(detached);
    expect(resolveSnapshotClip('quiz', raw, [detached])).toBe(raw);
  });
});

test('validates all candidates before deterministic asset ID selection and never trusts an invalid earlier one', () => {
  const raw = slide(), first = candidate(raw, 'b'.repeat(64)), second = candidate(raw, 'c'.repeat(64));
  const expected = [first, second].sort((left, right) => left.id.localeCompare(right.id))[0]!;
  expect(resolveSnapshotClip('quiz', raw, [first, second]).mediaSource).toBe('quiz-asset:quiz/' + expected.id);
  expect(resolveSnapshotClip('quiz', raw, [second, first]).mediaSource).toBe('quiz-asset:quiz/' + expected.id);
  const invalid = candidate(raw, 'a'.repeat(64)); change('job.status', 'failed')(invalid);
  expect(resolveSnapshotClip('quiz', raw, [invalid, expected]).mediaSource).toBe('quiz-asset:quiz/' + expected.id);
});
