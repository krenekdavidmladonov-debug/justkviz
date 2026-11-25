import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { d2Names, exceptions } from './d2-functions.mjs';
import { ffprobeFiles, ffprobeVerification } from './ffprobe-runtime.mjs';
import { artifactPackage, runtimeClosure } from '../staging/restart-build-core.mjs';

export const LIMIT = 100 * 1024 * 1024;
const require = createRequire(import.meta.url);
const archiver = createRequire(require.resolve('firebase-tools/package.json'))('archiver');
export function d2Trigger(name) {
  assert(d2Names.includes(name), 'Unknown D2 function');
  if (name === 'processDriveMediaImport') return 'taskQueueTrigger';
  if (['readQuizMedia', 'driveMediaCompanion'].includes(name)) return 'httpsTrigger';
  return 'callableTrigger';
}

export function d2Verification(name, trigger = d2Trigger(name), native = false) {
  return `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getApp } from 'firebase-admin/app';
import * as functions from './lib/index.js';
assert.equal(getApp().name, '[DEFAULT]');
assert.equal(process.versions.node.split('.')[0], '22');
assert.deepEqual(Object.keys(functions), [${JSON.stringify(name)}]);
const fn = functions[${JSON.stringify(name)}];
assert.equal(typeof fn, 'function');
assert.equal(fn.__endpoint.platform, 'gcfv2');
assert.deepEqual(fn.__endpoint.region, ['europe-west1']);
assert(fn.__endpoint[${JSON.stringify(trigger)}]);
for (const other of ['callableTrigger', 'httpsTrigger', 'taskQueueTrigger']) if (other !== ${JSON.stringify(trigger)}) assert(!fn.__endpoint[other]);
${native ? ffprobeVerification : ''}
console.log('Verified single Gen 2 ${trigger} ${name} (europe-west1).');
`;
}

export async function buildLockZip(sha, name = 'lockEventQuiz') {
  assert.match(sha, /^[0-9a-f]{40}$/u);
  assert(d2Names.includes(name), 'Unknown D2 function');
  if (exceptions[name]) throw new Error('D2_NATIVE_LIMIT ' + name + ': ' + exceptions[name]);
  // Read immutable Git blobs, never ignored lib output or a local environment file.
  const read = file => execFileSync('git', ['--no-replace-objects', 'show', sha + ':' + file], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const json = file => JSON.parse(read(file));
  const index = ts.createSourceFile('index.ts', read('functions/src/index.ts'), ts.ScriptTarget.Latest, true);
  const bindings = index.statements.filter(ts.isExportDeclaration).flatMap(s =>
    s.exportClause && ts.isNamedExports(s.exportClause) ? s.exportClause.elements.filter(e => e.name.text === name)
      .map(e => [s.moduleSpecifier.text, e.propertyName?.text ?? e.name.text]) : []);
  assert.equal(bindings.length, 1, 'D2 export must exist exactly once');
  const [[module, local]] = bindings;
  assert.match(module, /^\.\/[a-z0-9/-]+\.js$/u);
  assert.equal(local, name, 'D2 aliases need manual review');
  const entry = `export { ${name} } from '${module}';\n`;
  const trigger = d2Trigger(name);
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
  closure('functions', 'lib/', entry, Object.keys(sourcePackage.dependencies));
  // In the full index other callable modules initialize Admin. Isolated HTTP/Drive exports need it too.
  files.set('lib/d2-admin.js', "import { getApps, initializeApp } from 'firebase-admin/app';\nif (!getApps().some(app => app.name === '[DEFAULT]')) initializeApp();\n");
  files.set('lib/index.js', "import './d2-admin.js';\n" + entry);
  closure('packages/quiz-domain', 'vendor/quiz-domain/lib/', null, []);
  files.set('vendor/quiz-domain/package.json', JSON.stringify(domain));
  files.set('package.json', JSON.stringify(pkg));
  files.set('package-lock.json', lockText);
  const native = files.has('lib/drive/local-output.js');
  if (native) for (const [file, bytes] of await ffprobeFiles(read)) files.set(file, bytes);
  files.set('verify-lock.mjs', d2Verification(name, trigger, native));
  files.set('source-commit.txt', sha + '\n');
  // Text uses STORE. The pinned ELF uses fixed DEFLATE level 9; Linux CI must match the local digest.
  const zip = archiver('zip', { zlib: { level: 9 } });
  const chunks = [];
  const complete = new Promise((resolve, reject) => {
    zip.on('data', chunk => chunks.push(chunk));
    zip.once('error', reject); zip.once('warning', reject); zip.once('end', resolve);
  });
  assert([...files.values()].reduce((sum, file) => sum + Buffer.byteLength(file), 0) < 300 * 1024 * 1024);
  for (const name of [...files.keys()].sort()) zip.append(Buffer.from(files.get(name)), {
    name, date: new Date('2000-01-01T00:00:00Z'), mode: name === 'worker/bin/ffprobe' ? 0o755 : 0o644, store: name !== 'worker/bin/ffprobe' });
  await Promise.all([complete, zip.finalize()]);
  const bytes = Buffer.concat(chunks);
  assert(bytes.length > 0 && bytes.length < LIMIT);
  return { bytes, digest: createHash('sha256').update(bytes).digest('hex') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [sha, destination, name = 'lockEventQuiz'] = process.argv.slice(2);
  assert(process.argv.length >= 4 && process.argv.length <= 5, 'Usage: lock-bundle.mjs SHA DESTINATION [NAME]');
  const { bytes } = await buildLockZip(sha, name);
  writeFileSync(destination, bytes, { flag: 'wx' });
}
