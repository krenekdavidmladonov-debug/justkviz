import { expect, test } from 'vitest';
import { DriveImageByteCache } from '../functions/src/drive/image-byte-cache';

test('immutable image retention owns buffers and expires without extending the lifetime on reads', () => {
  let now = 100;
  const cache = new DriveImageByteCache(10, 3, 5, 50, () => now);
  const bytes = Buffer.from('image');
  cache.put('a', bytes); bytes.fill(0);
  const first = cache.get('a')!; expect(first.toString()).toBe('image'); first.fill(0);
  now = 149; expect(cache.get('a')?.toString()).toBe('image');
  now = 150; expect(cache.get('a')).toBeUndefined();
});

test('image retention caps total bytes, entry count and individual size and evicts least recently used bytes', () => {
  const cache = new DriveImageByteCache(8, 2, 5);
  cache.put('a', Buffer.from('aaaa')); cache.put('b', Buffer.from('bbbb')); cache.get('a');
  cache.put('c', Buffer.from('cccc'));
  expect(cache.get('b')).toBeUndefined(); expect(cache.get('a')?.toString()).toBe('aaaa');
  cache.put('large', Buffer.alloc(6)); expect(cache.get('large')).toBeUndefined();
  cache.put('empty', Buffer.alloc(0)); expect(cache.get('empty')).toBeUndefined();
  cache.put('tiny', Buffer.from('x')); expect(cache.get('c')).toBeUndefined();
  cache.clear(); expect(cache.get('a')).toBeUndefined(); expect(cache.get('tiny')).toBeUndefined();
  cache.put('after-clear', Buffer.from('new')); expect(cache.get('after-clear')?.toString()).toBe('new');
});
