import { expect, test } from 'vitest';
import { LiveMutationQueue } from '../apps/web/src/features/live/mutationQueue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test('commands pass waiting reports, preserve command order and wait for the in-flight revision', async () => {
  const queue = new LiveMutationQueue();
  const active = deferred<number>();
  const order: string[] = [];
  let revision = 1;
  const first = queue.enqueueReport('session:1', async () => {
    order.push('active report');
    revision = await active.promise;
    return revision;
  });
  const waiting = queue.enqueueReport('session:1', () => {
    order.push('waiting report');
    return Promise.resolve(++revision);
  });
  const command = (name: string) => queue.enqueueCommand(() => {
    order.push(`${name}:${revision}`);
    return Promise.resolve(++revision);
  });
  const stop = command('stop');
  const next = command('next');
  expect(order).toEqual(['active report']);
  active.resolve(2);
  expect(await first).toBe(2);
  expect(await stop).toBe(3);
  expect(await next).toBe(4);
  expect(await waiting).toBe(5);
  expect(order).toEqual(['active report', 'stop:2', 'next:3', 'waiting report']);
});

test('a ready/playing burst publishes only the latest waiting state and settles superseded callers', async () => {
  const queue = new LiveMutationQueue();
  const active = deferred<void>();
  const blocker = queue.enqueueCommand(() => active.promise);
  const states: string[] = [];
  const report = (state: string) => queue.enqueueReport('session:8', () => {
    states.push(state);
    return Promise.resolve({ revision: 12 });
  });
  const ready = report('ready');
  const playing = report('playing');
  const duplicate = report('playing');
  expect(await ready).toBeUndefined();
  expect(await playing).toBeUndefined();
  expect(states).toEqual([]);
  active.resolve();
  await blocker;
  expect(await duplicate).toEqual({ revision: 12 });
  expect(states).toEqual(['playing']);
});

test('distinct report generations remain independent and a later pause is retained', async () => {
  const queue = new LiveMutationQueue();
  const active = deferred<void>();
  const blocker = queue.enqueueCommand(() => active.promise);
  const states: string[] = [];
  const report = (key: string, state: string) => queue.enqueueReport(key, () => {
    states.push(`${key}:${state}`);
    return Promise.resolve(state);
  });
  const old = report('session:1', 'playing');
  const playing = report('session:2', 'playing');
  const paused = report('session:2', 'ready');
  expect(await playing).toBeUndefined();
  active.resolve();
  await blocker;
  expect(await old).toBe('playing');
  expect(await paused).toBe('ready');
  expect(states).toEqual(['session:1:playing', 'session:2:ready']);
});

test('a rejected report does not stall a pending command or later reports', async () => {
  const queue = new LiveMutationQueue();
  const active = deferred<number>();
  const failure = new Error('stale generation');
  const report = queue.enqueueReport('session:1', () => active.promise);
  const rejected = expect(report).rejects.toBe(failure);
  const command = queue.enqueueCommand(() => Promise.resolve(5));
  active.reject(failure);
  await rejected;
  expect(await command).toBe(5);
  expect(await queue.enqueueReport('session:2', () => Promise.resolve(6))).toBe(6);
});
