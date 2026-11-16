const storageKey = 'justkviz.quiz-create-attempt';
const legacyStorageKey = 'justkviz.quiz-create-request-id';
export interface CreationAttempt {
  readonly actorUid: string;
  readonly requestId: string;
  readonly submittedTitle: string | null;
}
type AttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
function sessionStore(): AttemptStorage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}
const actorStorageKey = (actorUid: string) => storageKey + ':' + encodeURIComponent(actorUid);
function readAttempt(raw: string | null | undefined, actorUid: string): CreationAttempt | undefined {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const candidate = value as Record<string, unknown>;
      if (Object.keys(candidate).sort().join(',') === 'actorUid,requestId,submittedTitle'
        && candidate.actorUid === actorUid && typeof candidate.requestId === 'string' && /^[\w-]{1,150}$/u.test(candidate.requestId)
        && (candidate.submittedTitle === null || (typeof candidate.submittedTitle === 'string'
          && candidate.submittedTitle.trim() === candidate.submittedTitle && candidate.submittedTitle.length > 0 && candidate.submittedTitle.length <= 300))) {
        return candidate as unknown as CreationAttempt;
      }
    }
  } catch { /* Malformed records never supply another actor's draft. */ }
  return undefined;
}
function writeAttempt(key: string, attempt: CreationAttempt, storage: AttemptStorage | undefined): boolean {
  try {
    if (!storage) return false;
    const serialized = JSON.stringify(attempt);
    storage.setItem(key, serialized); return storage.getItem(key) === serialized;
  } catch { return false; /* Same-page retries retain the in-memory attempt. */ }
}
function retireLegacyId(attempt: CreationAttempt, storage: AttemptStorage | undefined): void {
  const bound = readAttempt(storage?.getItem(storageKey), attempt.actorUid);
  if (bound?.requestId === attempt.requestId && storage?.getItem(legacyStorageKey) === attempt.requestId) {
    storage.removeItem(legacyStorageKey);
    if (storage.getItem(legacyStorageKey) === attempt.requestId) throw Error('Legacy request ID is still stored.');
  }
}
function finishMigration(attempt: CreationAttempt, storage: AttemptStorage | undefined): void {
  retireLegacyId(attempt, storage);
  const bound = readAttempt(storage?.getItem(storageKey), attempt.actorUid);
  if (bound?.requestId === attempt.requestId) storage?.removeItem(storageKey);
}
export function newCreationAttempt(actorUid: string): CreationAttempt {
  return {actorUid, requestId: crypto.randomUUID(), submittedTitle: null};
}
export function persistCreationAttempt(attempt: CreationAttempt, storage = sessionStore()): boolean {
  return writeAttempt(actorStorageKey(attempt.actorUid), attempt, storage);
}
export function loadCreationAttempt(actorUid: string, storage = sessionStore()): CreationAttempt {
  try {
    const scoped = readAttempt(storage?.getItem(actorStorageKey(actorUid)), actorUid);
    if (scoped) {
      try { finishMigration(scoped, storage); } catch { /* Keep its actor-bound backup until retirement succeeds. */ }
      return scoped;
    }
    const raw = storage?.getItem(storageKey);
    const previous = readAttempt(raw, actorUid);
    if (previous) {
      if (persistCreationAttempt(previous, storage)) {
        try { finishMigration(previous, storage); } catch { /* Preserve the deployed binding on partial migration. */ }
      }
      return previous;
    }
    // The deployed version stored only an ID. Keep it on upgrade: its original
    // title is unknown, but repeating the original title must address the same
    // actor-bound backend quiz. Never adopt it over another actor's record.
    if (raw === null) {
      const legacy = storage?.getItem(legacyStorageKey);
      if (typeof legacy === 'string' && /^[\w-]{1,150}$/u.test(legacy)) {
        const adopted = {actorUid, requestId: legacy, submittedTitle: null};
        // Bind the old unscoped ID before a scoped copy or raw-key retirement
        // can fail, so another actor cannot adopt the leftover raw ID.
        if (writeAttempt(storageKey, adopted, storage) && persistCreationAttempt(adopted, storage)) {
          try { finishMigration(adopted, storage); } catch { /* The verified old-format binding remains authoritative. */ }
        }
        return adopted;
      }
    }
  } catch { /* Unavailable or malformed storage cannot expose a previous user's draft. */ }
  const fresh = newCreationAttempt(actorUid); persistCreationAttempt(fresh, storage); return fresh;
}
export function clearCreationAttempt(attempt: CreationAttempt, storage = sessionStore()): void {
  try {
    const scoped = readAttempt(storage?.getItem(actorStorageKey(attempt.actorUid)), attempt.actorUid);
    const shared = readAttempt(storage?.getItem(storageKey), attempt.actorUid);
    if (scoped?.requestId === attempt.requestId || (!scoped && shared?.requestId === attempt.requestId)) {
      // A durable empty successor prevents older shared records resurfacing.
      if (!persistCreationAttempt(newCreationAttempt(attempt.actorUid), storage)) return;
    }
    retireLegacyId(attempt, storage);
    for (const key of [actorStorageKey(attempt.actorUid), storageKey]) {
      const stored = readAttempt(storage?.getItem(key), attempt.actorUid);
      if (stored?.requestId === attempt.requestId) storage?.removeItem(key);
    }
  } catch { /* Successful creation is unaffected by storage availability. */ }
}
