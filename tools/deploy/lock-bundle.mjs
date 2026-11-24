import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { artifactPackage, runtimeClosure } from '../staging/restart-build-core.mjs';

export const LIMIT = 100 * 1024 * 1024;
const require = createRequire(import.meta.url);
const archiver = createRequire(require.resolve('firebase-tools/package.json'))('archiver');
const entry = "export { lockEventQuiz } from './events/callables.js';\n";
const verifyBuild = `import assert from 'node:assert/strict';
import * as functions from './lib/index.js';
assert.equal(process.versions.node.split('.')[0], '22');
assert.deepEqual(Object.keys(functions), ['lockEventQuiz']);
const fn = functions.lockEventQuiz;
assert.equal(typeof fn, 'function');
assert.equal(fn.__endpoint.platform, 'gcfv2');
assert.deepEqual(fn.__endpoint.region, ['europe-west1']);
assert(fn.__endpoint.callableTrigger);
console.log('Verified single Gen 2 callable lockEventQuiz (europe-west1).');
`;

export async function buildLockZip(sha) {
  assert.match(sha, /^[0-9a-f]{40}$/u);
  // Read immutable Git blobs, never ignored lib output or a local environment file.
  const read = file => execFileSync('git', ['show', sha + ':' + file], { encoding: 'utf8' });
  const json = file => JSON.parse(read(file));
  const index = ts.createSourceFile('index.ts', read('functions/src/index.ts'), ts.ScriptTarget.Latest, true);
  const bindings = index.statements.filter(ts.isExportDeclaration).flatMap(s =>
    s.exportClause && ts.isNamedExports(s.exportClause) ? s.exportClause.elements.filter(e => e.name.text === 'lockEventQuiz')
      .map(e => [s.moduleSpecifier.text, e.propertyName?.text ?? e.name.text]) : []);
  assert.deepEqual(bindings, [['./events/callables.js', 'lockEventQuiz']]);
  const files = new Map();
  function closure(project, prefix, rootEntry, dependencies) {
    const config = ts.convertCompilerOptionsFromJson(json(project + '/tsconfig.json').compilerOptions, '.');
    assert.equal(config.errors.length, 0);
    const compile = name => {
      const file = project + '/src/' + name.replace(/\.js$/u, '.ts');
      const result = ts.transpileModule(read(file), { fileName: name.replace(/\.js$/u, '.ts'),
        compilerOptions: { ...config.options, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
          newLine: ts.NewLineKind.LineFeed, rootDir: undefined, outDir: undefined, declaration: false, sourceMap: false }, reportDiagnostics: true });
      assert.equal(result.diagnostics.length, 0, file + ": " + result.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, " ")));
      assert(!/\brequire\s*\(/u.test(result.outputText), 'Unexpected CommonJS dependency in ' + file);
      return result.outputText;
    };
    for (const [name, source] of runtimeClosure(rootEntry ?? compile('index.js'), compile, dependencies)) {
      assert.match(name, /^[A-Za-z0-9_/-]+\.js$/u);
      files.set(prefix + name, source);
    }
  }
  const sourcePackage = json('functions/package.json');
  const lockText = read('tools/staging/functions-package-lock.json');
  const pkg = artifactPackage(sourcePackage, JSON.parse(lockText), { runtime: { packages: sourcePackage.dependencies } });
  pkg.scripts = { 'gcp-build': 'node verify-lock.mjs' };
  const domain = json('packages/quiz-domain/package.json');
  delete domain.scripts;
  closure('functions', 'lib/', entry, ['firebase-admin', 'firebase-functions', '@filmovy-kviz/quiz-domain']);
  closure('packages/quiz-domain', 'vendor/quiz-domain/lib/', null, []);
  files.set('vendor/quiz-domain/package.json', JSON.stringify(domain));
  files.set('package.json', JSON.stringify(pkg));
  files.set('package-lock.json', lockText);
  files.set('verify-lock.mjs', verifyBuild);
  files.set('source-commit.txt', sha + '\n');
  // STORE avoids host-specific compression differences; paths, dates and modes are fixed.
  const zip = archiver('zip', { store: true });
  const chunks = [];
  const complete = new Promise((resolve, reject) => {
    zip.on('data', chunk => chunks.push(chunk));
    zip.once('error', reject); zip.once('warning', reject); zip.once('end', resolve);
  });
  assert([...files.values()].reduce((sum, file) => sum + Buffer.byteLength(file), 0) < LIMIT);
  for (const name of [...files.keys()].sort()) zip.append(Buffer.from(files.get(name)), {
    name, date: new Date('2000-01-01T00:00:00Z'), mode: 0o644, store: true });
  await Promise.all([complete, zip.finalize()]);
  const bytes = Buffer.concat(chunks);
  assert(bytes.length > 0 && bytes.length < LIMIT);
  return { bytes, digest: createHash('sha256').update(bytes).digest('hex') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [sha, destination] = process.argv.slice(2);
  const { bytes } = await buildLockZip(sha);
  writeFileSync(destination, bytes, { flag: 'wx' });
}
