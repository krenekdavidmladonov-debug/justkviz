import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { analyzeFunctionImpact } from './function-impact.mjs';

function repository(t, extra = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'justkviz-function-impact-'));
  t.after(() => {
    assert.equal(path.dirname(root), tmpdir());
    assert(path.basename(root).startsWith('justkviz-function-impact-'));
    rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const write = (name, text) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), text); };
  git('init', '--quiet');
  function commit(files) {
    for (const [name, text] of Object.entries(files)) {
      if (text === null) rmSync(path.join(root, name)); else write(name, text);
    }
    git('add', '--all');
    git('-c', 'user.name=Offline test', '-c', 'user.email=offline@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Synthetic fixture');
    return git('rev-parse', 'HEAD');
  }
  const baseline = commit({
    'functions/package.json': JSON.stringify({ type: 'module', dependencies: { '@filmovy-kviz/quiz-domain': 'workspace:*' } }),
    'functions/src/index.ts': "export { alpha } from './alpha.js';\nexport { beta } from './beta.js';\nexport const health = () => 'ok';\n",
    'functions/src/alpha.ts': "import { shared } from './shared.js'; export const alpha = () => shared;",
    'functions/src/beta.ts': "import { shared } from './shared.js'; export const beta = () => shared;",
    'functions/src/shared.ts': 'export const shared = 1;',
    'packages/quiz-domain/src/index.ts': "export { value } from './value.js';",
    'packages/quiz-domain/src/value.ts': 'export const value = 1;',
    ...extra,
  });
  return { root, baseline, commit, write, git, analyze: (target, options = {}) => analyzeFunctionImpact({ root, baseline, target, ...options }) };
}

test('samostatný soubor mění jen jeho export, ignoruje dirty checkout a nesouvisející web', t => {
  const f = repository(t);
  const target = f.commit({ 'functions/src/alpha.ts': 'export const alpha = () => 2;', 'apps/web/src/example.ts': 'web' });
  f.write('functions/src/beta.ts', 'invalid dirty content');
  assert.deepEqual(f.analyze(target).changed, ['alpha']);
  assert.deepEqual(f.analyze(target).unchanged, ['beta', 'health']);
  assert.equal(f.analyze(target).mode, 'partial');
});

test('sdílený modul zasáhne všechny transitivní odběratele, inline health zůstává', t => {
  const f = repository(t);
  const target = f.commit({ 'functions/src/shared.ts': 'export const shared = 2;' });
  assert.deepEqual(f.analyze(target).changed, ['alpha', 'beta']);
});

test('odstraněný import a smazaný původní dependency se zohlední ze starého stromu', t => {
  const f = repository(t);
  const target = f.commit({ 'functions/src/alpha.ts': 'export const alpha = () => 0;', 'functions/src/shared.ts': 'export const shared = 3;' });
  assert.deepEqual(f.analyze(target).changed, ['alpha', 'beta']);
});

test('reexport barrel, alias, export star a quiz-domain closure', t => {
  const f = repository(t, {
    'functions/src/index.ts': "export { alpha as one } from './barrel.js'; export * from './beta.js'; export const health=1;",
    'functions/src/barrel.ts': "export { alpha } from './alpha.js';",
    'functions/src/alpha.ts': "import { value } from '@filmovy-kviz/quiz-domain'; export const alpha=()=>value;",
  });
  const target = f.commit({ 'packages/quiz-domain/src/value.ts': 'export const value = 9;' });
  assert.deepEqual(f.analyze(target).changed, ['one']);
  assert.equal(f.analyze(target).mode, 'partial');
});

test('index přidání a inline změna nezahrne ostatní reexportované moduly', t => {
  const f = repository(t);
  const index = readFileSync(path.join(f.root, 'functions/src/index.ts'), 'utf8');
  const target = f.commit({ 'functions/src/index.ts': index.replace("'ok'", "'ready'") + "export { gamma } from './gamma.js';", 'functions/src/gamma.ts': 'export const gamma=1;' });
  assert.deepEqual(f.analyze(target).changed, ['gamma', 'health']);
});

test('přesměrování importu na jiný modul zohlední nový graf', t => {
  const f = repository(t);
  const target = f.commit({ 'functions/src/beta.ts': "import { value } from '@filmovy-kviz/quiz-domain'; export const beta=()=>value;" });
  assert.deepEqual(f.analyze(target).changed, ['beta']);
});

test('runtime, lock a build změny vynutí všechny', t => {
  for (const file of ['pnpm-lock.yaml', 'package.json', 'functions/package.json', 'functions/tsconfig.json', 'packages/quiz-domain/tsconfig.json', 'tools/staging/functions-package-lock.json', 'tools/deploy/artefakt.mjs', 'tools/media-worker/clip.mjs', 'functions/src/asset.bin']) {
    const f = repository(t);
    const target = f.commit({ [file]: file.endsWith('package.json') ? '{}' : 'changed' });
    assert.equal(f.analyze(target).mode, 'full', file);
    assert.deepEqual(f.analyze(target).changed, ['alpha', 'beta', 'health'], file);
  }
});

test('neznámý původ, neexistující commit, mutable ref, nesouvisející historie a rozbitý Git fail closed', t => {
  const f = repository(t);
  const names = ['alpha', 'beta'];
  for (const baseline of [null, 'f'.repeat(40), 'HEAD']) assert.equal(f.analyze(f.baseline, { baseline, functionNames: names }).mode, 'full');
  const old = f.baseline;
  f.git('checkout', '--orphan', 'unrelated');
  const target = f.commit({ 'README.md': 'unrelated' });
  assert.equal(f.analyze(target, { baseline: old }).mode, 'full');
  const result = analyzeFunctionImpact({ root: path.join(f.root, 'missing'), baseline: old, target, functionNames: names });
  assert.equal(result.mode, 'full'); assert.deepEqual(result.changed, names);
});

test('nevyřešený import, dynamický import a syntaktická chyba vynutí full', t => {
  for (const source of ["import './missing.js'; export const alpha=1;", 'export const alpha=()=>import(process.env.MODULE);', 'export const alpha = (']) {
    const f = repository(t);
    const target = f.commit({ 'functions/src/alpha.ts': source });
    const result = f.analyze(target);
    assert.equal(result.mode, 'full');
    assert(result.reasons[0].startsWith('Nelze bezpečně určit dopad:'));
  }
});

test('statický dynamický import patří do closure', t => {
  const f = repository(t, { 'functions/src/alpha.ts': "export const alpha=()=>import('./dynamic.js');", 'functions/src/dynamic.ts': 'export const dynamic=1;' });
  const target = f.commit({ 'functions/src/dynamic.ts': 'export const dynamic=2;' });
  assert.deepEqual(f.analyze(target).changed, ['alpha']);
});

test('entrypoint shared inicializace a side effect import dopadá na všechny', t => {
  const f = repository(t, { 'functions/src/index.ts': "import './shared.js'; export { alpha } from './alpha.js'; export { beta } from './beta.js'; export const health=1;" });
  const target = f.commit({ 'functions/src/shared.ts': 'export const shared=4;' });
  assert.deepEqual(f.analyze(target).changed, ['alpha', 'beta', 'health']);
  const next = f.commit({ 'functions/src/index.ts': "console.log('init'); export { alpha } from './alpha.js'; export { beta } from './beta.js'; export const health=1;" });
  assert.equal(f.analyze(next).mode, 'full');
});

test('odstraněné exporty jsou explicitní full, zadaný scope zachová oddělené D2', t => {
  const f = repository(t);
  const target = f.commit({ 'functions/src/index.ts': "export { alpha } from './alpha.js'; export const health=()=> 'ok';" });
  assert.deepEqual(f.analyze(target).removed, ['beta']);
  assert.equal(f.analyze(target).mode, 'full');
  const scoped = f.analyze(target, { functionNames: ['alpha'] });
  assert.equal(scoped.mode, 'partial'); assert.deepEqual(scoped.changed, []);
});

test('entry lokální helper a export přes lokální binding jsou konzervativně společné', t => {
  const f = repository(t, { 'functions/src/index.ts': 'const helper=()=>1; const alpha=()=>helper(); export {alpha}; export const beta=()=>2;' });
  const target = f.commit({ 'functions/src/index.ts': 'const helper=()=>3; const alpha=()=>helper(); export {alpha}; export const beta=()=>2;' });
  assert.equal(f.analyze(target).mode, 'full');
  assert.deepEqual(f.analyze(target).changed, ['alpha', 'beta']);
});

test('neimportovaný JSON/readFile payload a atributy/config package manageru vyžadují full', t => {
  for (const file of ['functions/src/template.json', 'packages/quiz-domain/src/template.svg', '.gitattributes', '.npmrc', 'pnpm-workspace.yaml', 'package-lock.json']) {
    const f = repository(t);
    assert.equal(f.analyze(f.commit({ [file]: '{}' })).mode, 'full', file);
  }
});

test('rename dependency se smazaným starým souborem sleduje oba stromy', t => {
  const f = repository(t, { 'functions/src/beta.ts': 'export const beta=1;' });
  const target = f.commit({ 'functions/src/shared.ts': null, 'functions/src/renamed.ts': 'export const shared=1;', 'functions/src/alpha.ts': "import {shared} from './renamed.js'; export const alpha=()=>shared;" });
  assert.deepEqual(f.analyze(target).changed, ['alpha']);
  assert.equal(f.analyze(target).mode, 'partial');
});

test('nový nevalidní export i neznámý domain subpath fail closed', t => {
  for (const source of ['export const gamma=(', "import {value} from '@filmovy-kviz/quiz-domain/unknown'; export const gamma=value;"]) {
    const f = repository(t);
    const target = f.commit({ 'functions/src/index.ts': "export {gamma} from './gamma.js';", 'functions/src/gamma.ts': source });
    assert.equal(f.analyze(target, { functionNames: ['gamma'] }).mode, 'full');
  }
});

test('entrypoint lokální inline export sleduje i statický dynamický import', t => {
  const f = repository(t, { 'functions/src/index.ts': "export const alpha=()=>import('./dynamic.js'); export const beta=1;", 'functions/src/dynamic.ts': 'export const value=1;' });
  const target = f.commit({ 'functions/src/dynamic.ts': 'export const value=2;' });
  assert.deepEqual(f.analyze(target).changed, ['alpha', 'beta']);
});

test('exportovaný entry helper invaliduje inline odběratele a kruhový import zpět na index', t => {
  const f = repository(t, {
    'functions/src/index.ts': "export const helper=()=>1; export const alpha=()=>helper(); export {beta} from './beta.js';",
    'functions/src/beta.ts': "import {helper} from './index.js'; export const beta=()=>helper();",
  });
  const target = f.commit({ 'functions/src/index.ts': "export const helper=()=>2; export const alpha=()=>helper(); export {beta} from './beta.js';" });
  assert.deepEqual(f.analyze(target).changed, ['alpha', 'beta', 'helper']);
});

test('lokální git replace nemůže přepsat immutable objekty porovnání', t => {
  const f = repository(t);
  const target = f.commit({ 'functions/src/alpha.ts': 'export const alpha=2;' });
  f.git('replace', target, f.baseline);
  const result = f.analyze(target);
  assert.equal(result.mode, 'partial');
  assert.deepEqual(result.changed, ['alpha']);
});

test('sdílená závislost všech vybraných funkcí vrací full s důvodem', t => {
  const f = repository(t);
  const target = f.commit({ 'functions/src/shared.ts': 'export const shared=8;' });
  const result = f.analyze(target, { functionNames: ['alpha', 'beta'] });
  assert.equal(result.mode, 'full');
  assert.deepEqual(result.changed, ['alpha', 'beta']);
  assert.match(result.reasons[0], /všechny vybrané exporty/u);
});

test('nezmapovaný workspace mimo quiz-domain a změna jiného workspace vyžadují full', t => {
  for (const manifest of ['functions/package.json', 'packages/quiz-domain/package.json']) {
    const f = repository(t, { [manifest]: JSON.stringify({ dependencies: { '@test/workspace': 'workspace:*' } }) });
    const result = f.analyze(f.baseline);
    assert.equal(result.mode, 'full');
    assert.match(result.reasons[0], /workspace závislost/u);
  }
  const f = repository(t);
  assert.equal(f.analyze(f.commit({ 'packages/other/src/other.ts': 'export const other=1;' })).mode, 'full');
});
