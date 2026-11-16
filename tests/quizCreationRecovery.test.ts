import { expect, test } from 'vitest';
import { loadCreationAttempt, persistCreationAttempt, clearCreationAttempt, newCreationAttempt } from '../apps/web/src/routes/admin/quizCreationRecovery';
import { quizCreationIdentity } from '../functions/src/editor/model';

const sharedKey = 'justkviz.quiz-create-attempt';
const legacyKey = 'justkviz.quiz-create-request-id';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
test('committed but lost creation restores the submitted request and retries the original quiz without duplication', () => {
  const store = storage(), roots = new Map<string, {title: string; quizId: string}>();
  const attempted = {...loadCreationAttempt('actor-a', store), submittedTitle: 'Synthetic quiz'};
  persistCreationAttempt(attempted, store);
  const commit = (request: typeof attempted) => {
    const existing = roots.get(request.requestId);
    if (existing && existing.title !== request.submittedTitle) throw Error('already-exists');
    const result = existing ?? {title: request.submittedTitle, quizId: 'original-quiz'};
    roots.set(request.requestId, result); return result;
  };
  const committed = commit(attempted); // Response is lost; no success cleanup.
  const restored = loadCreationAttempt('actor-a', store);
  expect(restored).toEqual(attempted);
  expect(commit(restored as typeof attempted)).toEqual(committed);
  expect(roots.size).toBe(1);
  clearCreationAttempt(restored, store);
  expect(loadCreationAttempt('actor-a', store).requestId).not.toBe(attempted.requestId);
});
test('only deliberate reset changes an ambiguous attempt; same-user remount keeps original title', () => {
  const store = storage(), prior = {...loadCreationAttempt('actor-a', store), submittedTitle: 'Original'};
  persistCreationAttempt(prior, store);
  expect(loadCreationAttempt('actor-a', store)).toEqual(prior);
  const fresh = newCreationAttempt('actor-a'); persistCreationAttempt(fresh, store);
  expect(fresh.requestId).not.toBe(prior.requestId); expect(fresh.submittedTitle).toBeNull();
  clearCreationAttempt(prior, store); // Late old response cannot clear the fresh attempt.
  expect(loadCreationAttempt('actor-a', store)).toEqual(fresh);
});
test('identity switch never restores another user title or lets their late success clear current state', () => {
  const store = storage(), first = {...loadCreationAttempt('actor-a', store), submittedTitle: 'Private previous title'};
  persistCreationAttempt(first, store);
  const second = loadCreationAttempt('actor-b', store);
  expect(second.actorUid).toBe('actor-b'); expect(second.submittedTitle).toBeNull();
  expect(second.requestId).not.toBe(first.requestId); clearCreationAttempt(first, store);
  expect(loadCreationAttempt('actor-b', store)).toEqual(second);
});
test('denied storage retains the in-memory retry and cleanup is harmless; malformed records are ignored', () => {
  const denied = {getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('denied'); }, removeItem: () => { throw Error('denied'); }};
  const initial = loadCreationAttempt('actor-a', denied), attempted = {...initial, submittedTitle: 'Retained in memory'};
  expect(() => persistCreationAttempt(attempted, denied)).not.toThrow();
  expect(attempted.requestId).toBe(initial.requestId); expect(() => clearCreationAttempt(attempted, denied)).not.toThrow();
  const broken = { ...storage(), getItem: () => '{invalid json' };
  expect(loadCreationAttempt('actor-a', broken).submittedTitle).toBeNull();
});

test('deployed legacy ID is adopted without changing the backend identity after a committed lost response', () => {
  const store = storage(), legacyId = 'deployed-committed-request';
  store.setItem('justkviz.quiz-create-request-id', legacyId);
  const original = quizCreationIdentity('actor-a', legacyId, 'Original submitted title');
  const adopted = loadCreationAttempt('actor-a', store);
  expect(adopted).toEqual({actorUid: 'actor-a', requestId: legacyId, submittedTitle: null});
  expect(quizCreationIdentity('actor-a', adopted.requestId, 'Original submitted title')).toEqual(original);
  expect(loadCreationAttempt('actor-a', store)).toEqual(adopted);
  expect(store.getItem('justkviz.quiz-create-request-id')).toBeNull();
});
test('failed legacy adoption persistence keeps its durable ID; foreign scoped records and malformed legacy are not adopted', () => {
  const store = storage(); store.setItem('justkviz.quiz-create-request-id', 'durable-legacy');
  const deniedWrite = {...store, setItem: () => { throw Error('denied'); }};
  expect(loadCreationAttempt('actor-a', deniedWrite).requestId).toBe('durable-legacy');
  expect(store.getItem('justkviz.quiz-create-request-id')).toBe('durable-legacy');
  expect(loadCreationAttempt('actor-a', deniedWrite).requestId).toBe('durable-legacy');
  store.setItem(sharedKey, JSON.stringify({...newCreationAttempt('actor-b'), submittedTitle: 'Private other title'}));
  const own = loadCreationAttempt('actor-a', store);
  expect(own.requestId).not.toBe('durable-legacy'); expect(own.submittedTitle).toBeNull();
  const malformed = storage(); malformed.setItem('justkviz.quiz-create-request-id', 'bad/request');
  expect(loadCreationAttempt('actor-a', malformed).requestId).not.toBe('bad/request');
});

test('A returns to the exact committed request and title after B uses the same browser', () => {
  const store = storage(), first = { ...loadCreationAttempt('actor-a', store), submittedTitle: 'Original committed title' };
  persistCreationAttempt(first, store);
  const committed = quizCreationIdentity(first.actorUid, first.requestId, first.submittedTitle);
  const second = { ...loadCreationAttempt('actor-b', store), submittedTitle: 'Other actor draft' };
  persistCreationAttempt(second, store);
  const restored = loadCreationAttempt('actor-a', store);
  expect(restored).toEqual(first);
  expect(quizCreationIdentity(restored.actorUid, restored.requestId, restored.submittedTitle!)).toEqual(committed);
  expect(loadCreationAttempt('actor-b', store)).toEqual(second);
});

test('preserves a deployed shared A record while B loads, then migrates A exactly', () => {
  const store = storage(), first = { ...newCreationAttempt('actor-a'), submittedTitle: 'Deployed unresolved title' };
  const serialized = JSON.stringify(first);
  store.setItem(sharedKey, serialized);
  const second = loadCreationAttempt('actor-b', store);
  expect(second.submittedTitle).toBeNull();
  expect(store.getItem(sharedKey)).toBe(serialized);
  expect(loadCreationAttempt('actor-a', store)).toEqual(first);
  expect(quizCreationIdentity('actor-a', loadCreationAttempt('actor-a', store).requestId, first.submittedTitle))
    .toEqual(quizCreationIdentity('actor-a', first.requestId, first.submittedTitle));
});

test('keeps verified actor-bound legacy adoption when scoped copying fails, blocking foreign adoption', () => {
  const store = storage(), id = 'partially-migrated-request';
  store.setItem(legacyKey, id);
  const scopedDenied = { ...store, setItem: (key: string, value: string) => {
    if (key.startsWith(sharedKey + ':')) throw Error('Scoped migration denied');
    store.setItem(key, value);
  } };
  const first = loadCreationAttempt('actor-a', scopedDenied);
  expect(first.requestId).toBe(id);
  expect(JSON.parse(store.getItem(sharedKey)!)).toEqual(first);
  const second = loadCreationAttempt('actor-b', scopedDenied);
  expect(second.requestId).not.toBe(id);
  expect(JSON.parse(store.getItem(sharedKey)!)).toEqual(first);
  expect(loadCreationAttempt('actor-a', store)).toEqual(first);
});

test('stale cleanup preserves a newer A attempt, B attempt and foreign deployed record', () => {
  const store = storage(), old = { ...newCreationAttempt('actor-a'), submittedTitle: 'Old A' };
  persistCreationAttempt(old, store);
  const current = newCreationAttempt('actor-a'), other = { ...newCreationAttempt('actor-b'), submittedTitle: 'Pending B' };
  persistCreationAttempt(current, store); persistCreationAttempt(other, store);
  store.setItem(sharedKey, JSON.stringify(other));
  clearCreationAttempt(old, store);
  expect(loadCreationAttempt('actor-a', store)).toEqual(current);
  expect(JSON.parse(store.getItem(sharedKey)!)).toEqual(other);
  expect(loadCreationAttempt('actor-b', store)).toEqual(other);
});

test('does not clear an unbound legacy ID backed by another actor with the same request string', () => {
  const store = storage(), requestId = 'same-request-string';
  const other = { actorUid: 'actor-b', requestId, submittedTitle: 'Foreign pending title' };
  store.setItem(sharedKey, JSON.stringify(other)); store.setItem(legacyKey, requestId);
  clearCreationAttempt({ actorUid: 'actor-a', requestId, submittedTitle: null }, store);
  expect(store.getItem(legacyKey)).toBe(requestId);
  expect(JSON.parse(store.getItem(sharedKey)!)).toEqual(other);
});

test('clearing a newer completed request cannot reactivate an older shared request after failed removal', () => {
  const store = storage(), old = { ...newCreationAttempt('actor-a'), submittedTitle: 'Older unresolved title' };
  store.setItem(sharedKey, JSON.stringify(old));
  const removalDenied = { ...store, removeItem: (key: string) => {
    if (key === sharedKey) throw Error('Old record removal denied');
    store.removeItem(key);
  } };
  expect(loadCreationAttempt('actor-a', removalDenied)).toEqual(old);
  const current = { ...newCreationAttempt('actor-a'), submittedTitle: 'Deliberate newer creation' };
  persistCreationAttempt(current, store);
  expect(loadCreationAttempt('actor-a', store)).toEqual(current);
  clearCreationAttempt(current, store);
  const fresh = loadCreationAttempt('actor-a', store);
  expect(fresh.requestId).not.toBe(old.requestId);
  expect(fresh.requestId).not.toBe(current.requestId);
  expect(fresh.submittedTitle).toBeNull();
});

test('retains the actor binding when raw ID removal fails and never lets B adopt the leftover ID', () => {
  const store = storage(), requestId = 'raw-removal-failed';
  store.setItem(legacyKey, requestId);
  const removalDenied = { ...store, removeItem: (key: string) => {
    if (key === legacyKey) throw Error('Legacy removal denied');
    store.removeItem(key);
  } };
  const first = loadCreationAttempt('actor-a', removalDenied);
  expect(first.requestId).toBe(requestId);
  expect(JSON.parse(store.getItem(sharedKey)!)).toEqual(first);
  expect(store.getItem(legacyKey)).toBe(requestId);
  const second = loadCreationAttempt('actor-b', removalDenied);
  expect(second.requestId).not.toBe(requestId);
  expect(JSON.parse(store.getItem(sharedKey)!)).toEqual(first);
  expect(loadCreationAttempt('actor-a', removalDenied)).toEqual(first);
});

test('does not retire an unbound ID when its actor-bound write cannot be read back', () => {
  const store = storage(), requestId = 'unverified-binding';
  store.setItem(legacyKey, requestId);
  const ignoredBinding = { ...store, setItem: (key: string, value: string) => {
    if (key !== sharedKey) store.setItem(key, value);
  } };
  expect(loadCreationAttempt('actor-a', ignoredBinding).requestId).toBe(requestId);
  expect(store.getItem(sharedKey)).toBeNull();
  expect(store.getItem(legacyKey)).toBe(requestId);
  expect(store.getItem(sharedKey + ':actor-a')).toBeNull();
});

test('malformed shared data blocks raw-ID adoption and distinct encoded UIDs retain separate attempts', () => {
  const store = storage();
  store.setItem(sharedKey, '{malformed'); store.setItem(legacyKey, 'unbound-request');
  const first = { ...loadCreationAttempt('actor/a', store), submittedTitle: 'Slash actor title' };
  persistCreationAttempt(first, store);
  const second = loadCreationAttempt('actor%2Fa', store);
  expect(second.requestId).not.toBe('unbound-request');
  expect(second.submittedTitle).toBeNull();
  expect(loadCreationAttempt('actor/a', store)).toEqual(first);
  expect(store.getItem(sharedKey)).toBe('{malformed');
});

test.each(['throws', 'silently ignores'] as const)('keeps the fresh scoped successor when shared removal %s through cleanup', mode => {
  const store = storage(), old = { ...newCreationAttempt('actor-a'), submittedTitle: 'Old retained title' };
  store.setItem(sharedKey, JSON.stringify(old));
  const removalDenied = { ...store, removeItem: (key: string) => {
    if (key === sharedKey) {
      if (mode === 'throws') throw Error('Shared removal denied');
      return;
    }
    store.removeItem(key);
  } };
  expect(loadCreationAttempt('actor-a', removalDenied)).toEqual(old);
  clearCreationAttempt(old, removalDenied);
  const fresh = loadCreationAttempt('actor-a', removalDenied);
  expect(fresh.requestId).not.toBe(old.requestId);
  expect(fresh.submittedTitle).toBeNull();
  expect(JSON.parse(store.getItem(sharedKey)!)).toEqual(old);
  clearCreationAttempt(old, removalDenied);
  expect(loadCreationAttempt('actor-a', removalDenied)).toEqual(fresh);
});
