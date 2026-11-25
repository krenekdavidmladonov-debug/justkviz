import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { analyzeFunctionImpact } from './function-impact.mjs';
import { d2Names, exceptions } from './d2-functions.mjs';
import { LIMIT } from './lock-bundle.mjs';
import { baseline, resource, publishD2 } from './lock-release.mjs';

export function historyDirectory() {
  return path.join(homedir(), 'JustKviz', 'nasazeni', 'd2', 'filmovy-kviz-v2-staging', 'europe-west1');
}

export function releaseHistory(directory) {
  const key = (name, state) => createHash('sha256').update(JSON.stringify([resource(name), state.updateTime, state.revision,
    state.old.bucket, state.old.object, state.old.generation])).digest('hex');
  const save = (filename, data) => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, filename);
    writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600, flush: true });
    return file;
  };
  return {
    origin(name, state) {
      try {
        const record = JSON.parse(readFileSync(path.join(directory, key(name, state) + '.json'), 'utf8'));
        if (record.target === resource(name) && key(name, record.state) === key(name, state)
          && /^[0-9a-f]{40}$/u.test(record.sha) && /^[0-9a-f]{64}$/u.test(record.digest)) return record.sha;
      } catch { /* First run, incomplete file or another operator machine: include every target. */ }
    },
    previous(name, state, evidence) {
      return save(name + '-rollback-' + randomUUID() + '.json', { target: resource(name), state, next: evidence });
    },
    complete(name, state, evidence) {
      return save(key(name, state) + '.json', { target: resource(name), state, ...evidence });
    },
  };
}

export async function releaseSelection({ choice, root, head, client, history, build, proof, confirm, upload, wait,
  log = console.log, analyze = analyzeFunctionImpact }) {
  assert(choice === 'vše' || d2Names.includes(choice), 'Neplatný výběr D2.');
  if (exceptions[choice]) throw new Error(exceptions[choice]);
  const names = choice === 'vše' ? d2Names : [choice];
  const states = new Map(), origins = new Map();
  for (const name of names) {
    if (exceptions[name]) { log('Vynechaná výjimka ' + name + ' — ' + exceptions[name]); continue; }
    const state = baseline((await client.get(resource(name))).body, name);
    states.set(name, state);
    if (choice === 'vše') origins.set(name, history.origin(name, state));
  }
  let selected = [...states.keys()];
  if (choice === 'vše') {
    const changed = new Set();
    let partial = true;
    for (const commit of new Set(origins.values())) {
      if (!commit) { log('Neznámý původ D2. Vybrány všechny nasaditelné funkce.'); partial = false; break; }
      const functionNames = selected.filter(name => origins.get(name) === commit);
      const impact = analyze({ root, baseline: commit, target: head, functionNames });
      if (impact.mode === 'full') { log('Plný výběr D2: ' + impact.reasons.join(' ')); partial = false; break; }
      for (const name of impact.changed) changed.add(name);
    }
    if (partial) selected = selected.filter(name => changed.has(name));
  }
  log('Vybrané D2 (' + selected.length + '): ' + (selected.join(', ') || '(žádné)'));
  const unchanged = [...states.keys()].filter(name => !selected.includes(name));
  const artifacts = new Map();
  for (const name of selected) {
    const { bytes } = await build(head, name);
    const evidence = { sha: head, digest: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
    assert(bytes.length > 0 && bytes.length < LIMIT);
    assert.deepEqual(proof(name), evidence, 'ZIP neodpovídá Linux CI pro ' + name);
    artifacts.set(name, { bytes, evidence });
  }
  for (const [name, { bytes, evidence }] of artifacts) {
    const state = await publishD2({ name, head, bytes, expected: states.get(name), client, verifyCI: () => proof(name),
      confirm, upload, wait, log, savePrevious: (...args) => log('Doklad pro návrat: ' + history.previous(...args)) });
    history.complete(name, state, evidence);
  }
  for (const name of unchanged) assert.deepEqual(baseline((await client.get(resource(name))).body, name), states.get(name),
    'Přeskočená funkce se během vydání změnila. Připravte nový náhled.');
}
