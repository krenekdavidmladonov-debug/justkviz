import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, closeSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { compilerEnvironment, freshOutput, parseArguments, unlinkedPath, validateSource } from '../email/build-activation.mjs';
import { secureDirectory } from '../email/oauth-connect.mjs';
import { artifactPackage, assertArtifactPath, restartViteConfig, runtimeClosure } from '../staging/restart-build-core.mjs';
import { assertStagingEnvironment } from '../staging/guard.mjs';
import { assertFrontendFiles, assertHostingOnlyConfig } from '../staging/hosting-only.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mapping = Object.freeze({
  createDriveMediaFolder: './drive/callables.js', requestDriveMediaImport: './drive/import-callables.js',
  readDriveMediaImport: './drive/import-callables.js', processDriveMediaImport: './drive/import-callables.js',
  readDriveConnection: './drive/callables.js', readQuizMedia: './media/endpoint.js',
  createQuizSlide: './editor/callables.js', updateQuizSlide: './editor/callables.js',
  lockEventQuiz: './events/callables.js', beginQuizMediaUpload: './media/callables.js',
});
export const TARGETS = Object.freeze(Object.keys(mapping));
export const PUBLIC_DOCUMENTS = Object.freeze(['google-drive.html','google-drive-privacy.html']);
const bootstrap = "import { getApps, initializeApp } from 'firebase-admin/app';\nfunction bootstrapAdmin() { if (getApps().length === 0) initializeApp(); }\nbootstrapAdmin();\n";
const MAX_FILE = 256 * 1024 * 1024, MAX_TOTAL = 600 * 1024 * 1024, MAX_FILES = 2000;

export function releaseGuard(state) {
  validateSource(state);
  assert.equal(state.branch, 'codex/drive-media-workflow', 'Exact reviewed Drive media branch required');
}
export function releaseEntry(source, functions) {
  assert.deepEqual(functions, TARGETS, 'Exact ten endpoint manifest required');
  const found = [], exports = [];
  for (const match of source.matchAll(/export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gu)) {
    const selected = match[1].split(',').map(value => value.trim()).filter(name => TARGETS.includes(name));
    if (!selected.length) continue;
    for (const name of selected) { assert.equal(match[2], mapping[name], 'Endpoint module drift'); found.push(name); }
    exports.push(`export { ${selected.join(', ')} } from '${match[2]}';`);
  }
  assert.deepEqual(found.sort(), [...TARGETS].sort(), 'Every selected endpoint must be exported exactly once');
  return "import './bootstrap-admin.js';\n" + exports.join('\n') + '\n';
}
export function reviewedClosure(entry, read, packages) {
  let processor;
  const files = runtimeClosure(entry, name => {
    if (name === 'bootstrap-admin.js') return bootstrap;
    const text = read(name);
    assert(!/\brequire\s*\(|\beval\s*\(|sourceMappingURL/u.test(text), 'Uninventoried runtime loading or source map');
    if (name !== 'drive/processor.js') return text;
    // This is the only exception to runtimeClosure's nonliteral import ban.
    // The full processor source is separately pinned before compilation.
    assert.equal((text.match(/\bimport\s*\(/gu) ?? []).length, 1);
    assert(text.includes("const workerUrl = new URL('../../worker/clip.mjs', import.meta.url);"));
    assert(text.includes('const worker = await import(workerUrl.href);'));
    assert(text.includes("const binary = (name) => fileURLToPath(new URL('../../worker/bin/' + name, import.meta.url));"));
    processor = text;
    return text.replace('import(workerUrl.href)', 'Promise.resolve(undefined)');
  }, packages);
  assert(processor, 'Selected runtime must include the reviewed media processor');
  files.set('drive/processor.js', processor);
  assert(![...files.keys()].some(name => /^(?:dev\/|email\/(?:worker|gmail|callables|team-callables)\.js|print\/endpoint\.js)/u.test(name)));
  return files;
}
export function zipMode(name) { return /^worker\/bin\/(?:yt-dlp|ffmpeg|ffprobe)$/u.test(name) ? 0o755 : 0o644; }
export function validateFrontend(frontend, readPublic) {
  assertFrontendFiles(frontend.map(file=>({...file,name:PUBLIC_DOCUMENTS.includes(file.name)?'assets/'+file.name+'.js':file.name==='brand/NOTO-LICENSE.txt'?'assets/brand-license.js':file.name.startsWith('brand/')?'assets/'+file.name.slice(6):file.name.startsWith('print-samples/')?'assets/'+file.name.slice(14):file.name})));
  for(const file of frontend) if(PUBLIC_DOCUMENTS.includes(file.name)||file.name.startsWith('brand/')||file.name.startsWith('print-samples/')) {
    assert.equal(hash(file.bytes),hash(readPublic(file.name)),'Reviewed public asset changed during build');
  }
  for(const name of PUBLIC_DOCUMENTS) assert(frontend.some(file=>file.name===name),'Reviewed public document missing');
}
function artifactName(name, workerFiles) {
  assert(!name.includes('\\') && !name.split('/').includes('..') && !name.startsWith('/'), 'Artifact path escape');
  if (name.startsWith('functions/worker/')) assert(workerFiles.includes(name.slice('functions/'.length)), 'Uninventoried worker artifact');
  else assertArtifactPath(name);
}
function files(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap(item => {
    assert(!item.isSymbolicLink(), 'Artifact links refused');
    const name = prefix + item.name, filename = path.join(directory, item.name);
    if (item.isDirectory()) return files(filename, name + '/');
    assert(item.isFile(), 'Only regular artifact files permitted'); return [{ name, filename }];
  });
}
async function fileHash(filename) {
  const digest = createHash('sha256'); for await (const chunk of createReadStream(filename)) digest.update(chunk); return digest.digest('hex');
}
async function inspect(directory, expected, workers) {
  const entries = files(directory); assert(entries.length <= MAX_FILES); assert.deepEqual(entries.map(file => file.name).sort(), [...expected].sort());
  let total = 0; const checksums = {};
  for (const file of entries) {
    artifactName(file.name, workers); const size = statSync(file.filename).size;
    assert(size <= MAX_FILE, 'Artifact file too large'); total += size; assert(total <= MAX_TOTAL, 'Artifact total too large');
    checksums[file.name] = await fileHash(file.filename);
  }
  return checksums;
}
/** Inspect the central directory so Windows preparation proves the ZIP's Unix modes. */
export function inspectZipModes(filename, expected) {
  const descriptor = openSync(filename, 'r');
  try {
    const size = statSync(filename).size; assert(size > 22 && size <= MAX_TOTAL);
    const tail = Buffer.alloc(Math.min(size, 65557)); readSync(descriptor, tail, 0, tail.length, size - tail.length);
    let end = -1;
    for (let offset = tail.length - 22; offset >= 0; offset--) if (tail.readUInt32LE(offset) === 0x06054b50 && offset + 22 + tail.readUInt16LE(offset + 20) === tail.length) { end = offset; break; }
    assert(end >= 0, 'ZIP central directory missing');
    assert.equal(tail.readUInt16LE(end + 4), 0); assert.equal(tail.readUInt16LE(end + 6), 0);
    const count = tail.readUInt16LE(end + 10), directoryBytes = tail.readUInt32LE(end + 12); let offset = tail.readUInt32LE(end + 16);
    assert(count <= MAX_FILES && offset + directoryBytes <= size); assert.equal(count, Object.keys(expected).length);
    const modes = {};
    for (let index = 0; index < count; index++) {
      const header = Buffer.alloc(46); assert.equal(readSync(descriptor, header, 0, 46, offset), 46); assert.equal(header.readUInt32LE(0), 0x02014b50);
      assert.equal(header.readUInt16LE(4) >>> 8, 3, 'ZIP entry must encode Unix metadata');
      const length = header.readUInt16LE(28), extra = header.readUInt16LE(30), comment = header.readUInt16LE(32);
      assert(length > 0 && length <= 500); const data = Buffer.alloc(length); assert.equal(readSync(descriptor, data, 0, length, offset + 46), length);
      const name = data.toString('utf8'); assert(Object.hasOwn(expected, name) && !Object.hasOwn(modes, name));
      const mode = (header.readUInt32LE(38) >>> 16) & 0o777; assert.equal(mode, expected[name], 'ZIP permission mismatch'); modes[name] = mode;
      offset += 46 + length + extra + comment;
    }
    return modes;
  } finally { closeSync(descriptor); }
}

export async function prepareRelease({ sha, output }) {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','pipe'] }).trim();
  const guard = () => releaseGuard({ sha, head: git('rev-parse','HEAD'), branch: git('branch','--show-current'), status: git('status','--porcelain','--untracked-files=all'), node: process.versions.node });
  guard();
  const read = name => readFileSync(unlinkedPath(ROOT, path.join(ROOT,name)), 'utf8'), json = name => JSON.parse(read(name));
  const manifest = json('tools/drive-media/deployment-manifest.json');
  assert.equal(manifest.projectId, 'filmovy-kviz-v2-staging'); assert.equal(manifest.hostingSite, 'justkviz-v2'); assert.equal(manifest.region,'europe-west1');
  assert.deepEqual(manifest.publicDocuments,PUBLIC_DOCUMENTS);
  assert.deepEqual(manifest.functions,TARGETS); assert.equal(manifest.runtime.gcpBuild,'node worker/verify-runtime.mjs');
  assert.equal(manifest.frontendSdkCache,'.local-data/show-mode-staging/preflight.json');
  assert.equal(hash(readFileSync(unlinkedPath(ROOT,path.join(ROOT,'functions/src/drive/processor.ts')))),manifest.runtime.processorSourceSha256,'Reviewed processor source changed');
  const workerRoot = unlinkedPath(ROOT,path.join(ROOT,'functions/worker'));
  const workerManifestBytes = readFileSync(unlinkedPath(ROOT,path.join(workerRoot,'runtime-manifest.json')));
  assert.equal(hash(workerManifestBytes),manifest.runtime.workerManifestSha256,'Worker manifest drift');
  const workerManifest = JSON.parse(workerManifestBytes);
  assert.equal(workerManifest.target,'linux-x86_64'); assert.deepEqual(workerManifest.files,manifest.runtime.workerFiles);
  const workers = [...manifest.runtime.workerFiles.map(file => file.path),'worker/runtime-manifest.json'];
  assert.deepEqual(files(workerRoot).map(file => 'worker/'+file.name).sort(),[...workers].sort(),'Unexpected installed worker file');
  for (const file of manifest.runtime.workerFiles) {
    assert.match(file.sha256,/^[a-f0-9]{64}$/u); assert(file.bytes > 0 && file.bytes <= MAX_FILE);
    const filename = unlinkedPath(ROOT,path.join(ROOT,'functions',file.path)); assert.equal(lstatSync(filename).size,file.bytes); assert.equal(await fileHash(filename),file.sha256);
  }
  for (const file of ['clip.mjs','verify-runtime.mjs']) assert.equal(hash(readFileSync(path.join(ROOT,'tools/media-worker',file))),manifest.runtime.workerFiles.find(pin=>pin.path==='worker/'+file).sha256,'Tracked worker source differs from package');
  const tracked = git('ls-files','-z').split('\0').filter(Boolean).sort();
  const bindings = () => Object.fromEntries(tracked.map(name => [name,hash(readFileSync(unlinkedPath(ROOT,path.join(ROOT,name))))]));
  const before = bindings(), destination = freshOutput(ROOT,path.resolve(ROOT,output)), work = freshOutput(ROOT,destination+'.work');
  mkdirSync(destination); mkdirSync(work); await secureDirectory(destination); await secureDirectory(work);
  const artifact = path.join(destination,'artifact'), temporary = path.join(work,'temp'); mkdirSync(artifact); mkdirSync(temporary);
  const compiler = realpathSync(path.join(ROOT,'node_modules/typescript')); assert(compiler.startsWith(path.join(ROOT,'node_modules')+path.sep));
  const compilerVersion = JSON.parse(readFileSync(path.join(compiler,'package.json'),'utf8')).version;
  assert.equal(compilerVersion,read('pnpm-lock.yaml').match(/\n {6}typescript:\r?\n {8}specifier: [^\r\n]+\r?\n {8}version: ([0-9.]+)\r?\n/u)?.[1]);
  const env = compilerEnvironment(process.env,temporary);
  const compile = config => execFileSync(process.execPath,[path.join(compiler,'bin/tsc'),'-p',config,'--pretty','false'],{cwd:work,env,stdio:'inherit',windowsHide:true});
  const domain = path.join(work,'domain'), runtime = path.join(work,'runtime');
  for (const [name,config] of [['domain',{extends:path.join(ROOT,'packages/quiz-domain/tsconfig.json'),compilerOptions:{outDir:domain,sourceMap:false,declarationMap:false,incremental:false}}],
    ['runtime',{extends:path.join(ROOT,'functions/tsconfig.json'),compilerOptions:{outDir:runtime,sourceMap:false,declarationMap:false,incremental:false,paths:{'@filmovy-kviz/quiz-domain':[path.join(domain,'index.d.ts')]}}}]]) {
    const filename = path.join(work,name+'.json'); writeFileSync(filename,JSON.stringify(config),{flag:'wx'}); compile(filename);
  }
  const entry = releaseEntry(read('functions/src/index.ts'),manifest.functions), lock = json(manifest.runtime.packageLock);
  const pkg = artifactPackage(json(manifest.runtime.packageManifest),lock,manifest); pkg.scripts = {'gcp-build':manifest.runtime.gcpBuild};
  const expected = [];
  const write = (name,bytes) => { artifactName(name,workers); const filename=unlinkedPath(artifact,path.join(artifact,name),{fresh:true}); mkdirSync(path.dirname(filename),{recursive:true}); writeFileSync(filename,bytes,{flag:'wx',mode:0o600}); expected.push(name); };
  const closure = reviewedClosure(entry,name=>readFileSync(unlinkedPath(runtime,path.join(runtime,name)),'utf8'),Object.keys(pkg.dependencies));
  for (const [name,bytes] of closure) write('functions/lib/'+name,bytes);
  write('functions/package.json',JSON.stringify(pkg,null,2)+'\n'); write('functions/package-lock.json',read(manifest.runtime.packageLock));
  const domainPkg = json('packages/quiz-domain/package.json'); delete domainPkg.scripts; assert.equal(domainPkg.version,lock.packages['vendor/quiz-domain'].version);
  write('functions/vendor/quiz-domain/package.json',JSON.stringify(domainPkg,null,2)+'\n');
  for (const file of files(domain)) write('functions/vendor/quiz-domain/lib/'+file.name,readFileSync(file.filename));
  for (const name of workers) {
    const bytes=readFileSync(unlinkedPath(ROOT,path.join(ROOT,'functions',name)));
    const expectedHash=name==='worker/runtime-manifest.json'?manifest.runtime.workerManifestSha256:manifest.runtime.workerFiles.find(file=>file.path===name).sha256;
    assert.equal(hash(bytes),expectedHash,'Worker bytes changed before artifact copy');
    write('functions/'+name,bytes);
  }

  const cached = json(manifest.frontendSdkCache), sdk = cached.sdk;
  assert.deepEqual(Object.keys(sdk).sort(),['apiKey','appId','authDomain','messagingSenderId','projectId','storageBucket'].sort());
  for (const value of Object.values(sdk)) assert.equal(typeof value,'string');
  const webEnv = {VITE_APP_ENV:'staging',VITE_FIREBASE_API_KEY:sdk.apiKey,VITE_FIREBASE_AUTH_DOMAIN:sdk.authDomain,VITE_FIREBASE_PROJECT_ID:sdk.projectId,
    VITE_FIREBASE_STORAGE_BUCKET:sdk.storageBucket,VITE_FIREBASE_MESSAGING_SENDER_ID:sdk.messagingSenderId,VITE_FIREBASE_APP_ID:sdk.appId,
    VITE_FIREBASE_USE_EMULATORS:'false',VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT:'true',VITE_ENABLE_TEAM_EMAIL:'false'};
  assertStagingEnvironment(webEnv);
  const hosting = path.join(artifact,'hosting'), viteConfig = path.join(work,'vite.config.mjs');
  writeFileSync(viteConfig,restartViteConfig(ROOT,domain,hosting),{flag:'wx'});
  execFileSync(process.execPath,[path.join(ROOT,'apps/web/node_modules/vite/bin/vite.js'),'build','--mode','staging','--config',viteConfig],{cwd:ROOT,env:{...env,PATH:path.dirname(process.execPath),...webEnv},stdio:'inherit',windowsHide:true});
  const frontend = files(hosting).map(file=>{const bytes=readFileSync(file.filename);return {...file,bytes,text:bytes.toString('utf8')};});
  validateFrontend(frontend,name=>readFileSync(unlinkedPath(ROOT,path.join(ROOT,'apps/web/public',name))));
  for (const file of frontend) expected.push('hosting/'+file.name);
  const allJs = frontend.filter(file=>file.name.endsWith('.js')).map(file=>file.text).join('\n');
  for (const target of ['createDriveMediaFolder','requestDriveMediaImport','readDriveMediaImport','readDriveConnection']) assert(allJs.includes(target),'Missing frontend endpoint '+target);
  assert(allJs.includes(sdk.projectId) && allJs.includes(sdk.appId)); assert(!frontend.some(file=>file.name.endsWith('.map')));
  const staging = json('firebase.staging.json'); assertHostingOnlyConfig(staging);
  const config = {functions:{source:'artifact/functions',codebase:'default',runtime:'nodejs22'},hosting:{...staging.hosting,site:manifest.hostingSite,public:'artifact/hosting'}};
  const configPath = path.join(destination,'firebase.drive-media.json'); writeFileSync(configPath,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
  const checksums = await inspect(artifact,expected,workers), require = createRequire(path.join(ROOT,'package.json'));
  assert.equal(require('firebase-tools/package.json').version,'15.28.2'); const cliRequire=createRequire(require.resolve('firebase-tools/package.json'));
  assert.equal(cliRequire('archiver/package.json').version,'7.0.1');
  const archivePath = path.join(destination,'functions-source.zip'), stream=createWriteStream(archivePath,{flags:'wx',mode:0o600});
  const archive=cliRequire('archiver')('zip',{zlib:{level:9}}), done=new Promise((resolve,reject)=>{stream.on('close',resolve);stream.on('error',reject);archive.on('error',reject);archive.on('warning',reject);}); archive.pipe(stream);
  const zipModes = {};
  for (const name of Object.keys(checksums).filter(name=>name.startsWith('functions/')).sort()) {
    const relative=name.slice('functions/'.length); zipModes[relative]=zipMode(relative);
    archive.file(path.join(artifact,name),{name:relative,date:new Date('2000-01-01T00:00:00Z'),mode:zipModes[relative]});
  }
  await archive.finalize(); await done; inspectZipModes(archivePath,zipModes);
  guard(); assert.deepEqual(bindings(),before); assert.deepEqual(await inspect(artifact,expected,workers),checksums);
  const hostingGzipChecksums = Object.fromEntries(frontend.map(file=>['/'+file.name,hash(gzipSync(readFileSync(file.filename),{level:9}))]));
  const receipt = {status:'PASS',mode:'OFFLINE_PREPARATION',sourceSha:sha,sourceTree:git('rev-parse','HEAD^{tree}'),sourceBranch:manifest.sourceBranch,
    projectId:manifest.projectId,region:manifest.region,hostingSite:manifest.hostingSite,targets:TARGETS,node:process.version,compilerVersion,
    builderSha256:hash(readFileSync(fileURLToPath(import.meta.url))),manifestSha256:hash(readFileSync(path.join(ROOT,'tools/drive-media/deployment-manifest.json'))),
    inputBindingsSha256:hash(JSON.stringify(before)),workerManifestSha256:manifest.runtime.workerManifestSha256,processorSourceSha256:manifest.runtime.processorSourceSha256,
    artifactChecksums:checksums,hostingGzipChecksums,frontendSdkSha256:hash(JSON.stringify(sdk)),firebaseConfigSha256:hash(readFileSync(configPath)),
    functionsArchiveSha256:await fileHash(archivePath),functionsArchiveBytes:statSync(archivePath).size,zipModes,entry,adminBootstrap:true,
    cloudRequests:0,dependenciesInstalled:false,sdkDiscoveryPerformed:false,deploymentPerformed:false,secretOrEnvironmentFilesCopied:false,
    remainingVerification:['Linux gcp-build must run worker/verify-runtime.mjs before worker traffic','Separate controlled exact-export SDK discovery and explicit scoped deployment approval'],preparedAt:new Date().toISOString()};
  writeFileSync(path.join(destination,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  return {destination,receiptSha256:hash(readFileSync(path.join(destination,'receipt.json'))),receipt};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result=await prepareRelease(parseArguments(process.argv.slice(2)));
    console.log(JSON.stringify({status:'PASS',sourceSha:result.receipt.sourceSha,targets:TARGETS.length,functionsArchiveSha256:result.receipt.functionsArchiveSha256,
      functionsArchiveBytes:result.receipt.functionsArchiveBytes,receipt:result.destination+'/receipt.json',receiptSha256:result.receiptSha256,cloudRequests:0}));
  } catch { console.error('DRIVE_MEDIA_BUILD_STOP; PRESERVE_PARTIAL_OUTPUT; NO_CLOUD_IO'); process.exitCode=1; }
}
