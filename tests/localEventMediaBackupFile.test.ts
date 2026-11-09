import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';

import {
  createLocalEventMediaBackup, parseLocalEventMediaManifest, saveLocalEventMediaBackup,
  verifyLocalEventMediaBackup, type LocalEventMediaManifest,
} from '../apps/web/src/features/events/localEventMediaBackupFile';

const png = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLZkAAAAASUVORK5CYII=',
  'base64',
));

function manifest(): LocalEventMediaManifest {
  return {
    schemaVersion: 1,
    eventId: 'demo-event',
    snapshotId: 'demo-snapshot',
    quizRevision: 2,
    validUntilMs: Date.now() + 60_000,
    scopeKey: 'b'.repeat(64),
    media: {
      role: 'question-image',
      reference: 'quiz-asset:quiz/' + 'f'.repeat(64),
      generation: '12345',
      contentType: 'image/png',
      size: png.byteLength,
      sha256: createHash('sha256').update(png).digest('hex'),
      etag: '"' + 'a'.repeat(64) + '"',
    },
    missing: 0,
    excluded: 1,
  };
}

afterEach(() => vi.unstubAllGlobals());

it('detects a same-length payload change even when the manifest is intact', async () => {
  const current = manifest();
  const file = await createLocalEventMediaBackup(current, new Blob([png], { type: 'image/png' }));
  const changed = new Uint8Array(await file.arrayBuffer());
  changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
  expect(changed.byteLength).toBe(file.size);
  await expect(verifyLocalEventMediaBackup(file, current)).resolves.toBe('ready');
  await expect(verifyLocalEventMediaBackup(new Blob([changed]), current)).resolves.toBe('corrupt');
  await expect(verifyLocalEventMediaBackup(new Blob([new Uint8Array(2 * 1024 * 1024)]), current)).resolves.toBe('corrupt');
});

it('binds saved bytes to the freshly authorized snapshot, role and deadline', async () => {
  const current = manifest();
  const file = await createLocalEventMediaBackup(current, new Blob([png], { type: 'image/png' }));
  for (const binding of [
    { ...current, snapshotId: 'new-snapshot' },
    { ...current, scopeKey: 'c'.repeat(64) },
    { ...current, validUntilMs: 1 },
    { ...current, validUntilMs: current.validUntilMs + 1000 },
  ]) {
    await expect(verifyLocalEventMediaBackup(file, binding)).resolves.toBe('invalid');
  }
  expect(() => parseLocalEventMediaManifest({ ...current, unexpectedAnswer: 'synthetic' })).toThrow();
  expect(() => parseLocalEventMediaManifest({ ...current, media: { ...current.media, role: 'answer-image' } })).toThrow();
});

it('aborts an uncommitted native write if the authorization check fails after writing', async () => {
  const writer = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn(), abort: vi.fn().mockResolvedValue(undefined) };
  const destination = { createWritable: vi.fn().mockResolvedValue(writer), getFile: vi.fn() };
  const showSaveFilePicker = vi.fn().mockResolvedValue(destination);
  vi.stubGlobal('window', { showSaveFilePicker });
  const assertCurrent = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Revoked during save'));
  await expect(saveLocalEventMediaBackup(new Blob(['synthetic bytes']), undefined, assertCurrent)).rejects.toThrow('Revoked during save');
  expect(writer.write).toHaveBeenCalledOnce();
  expect(writer.abort).toHaveBeenCalledOnce();
  expect(writer.close).not.toHaveBeenCalled();
  expect(destination.getFile).not.toHaveBeenCalled();
});
