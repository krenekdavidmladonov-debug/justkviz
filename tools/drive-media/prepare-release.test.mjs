import assert from 'node:assert/strict';
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inspectZipModes, PUBLIC_DOCUMENTS, releaseEntry, releaseGuard, reviewedClosure, TARGETS, validateFrontend, zipMode } from './prepare-release.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('./deployment-manifest.json',import.meta.url),'utf8'));
test('release scope is exactly four new and six updated endpoints with no Rules or default media activation',()=>{
  assert.deepEqual(manifest.functions,TARGETS); assert.equal(TARGETS.length,10); assert.equal(new Set(TARGETS).size,10);
  assert.deepEqual([...manifest.newFunctions,...manifest.updatedFunctions],TARGETS);
  assert.equal(manifest.mediaImportEnabledByDefault,false); assert.equal(manifest.firestoreRulesChanged,false); assert.equal(manifest.storageRulesChanged,false);
  assert.equal(manifest.runtime.gcpBuild,'node worker/verify-runtime.mjs');
  assert.match(manifest.runtime.workerManifestSha256,/^[a-f0-9]{64}$/u);
  for(const file of manifest.runtime.workerFiles){assert.match(file.sha256,/^[a-f0-9]{64}$/u);assert.ok(file.bytes>0);}
  for(const name of ['worker/clip.mjs','worker/verify-runtime.mjs','worker/bin/yt-dlp','worker/bin/ffmpeg','worker/bin/ffprobe'])assert.ok(manifest.runtime.workerFiles.some(file=>file.path===name));
});
test('source guard requires exact SHA, clean reviewed branch and Node22 without running a build',()=>{
  const state={sha:'a'.repeat(40),head:'a'.repeat(40),branch:'codex/drive-media-workflow',status:'',node:'22.1.0'};
  assert.doesNotThrow(()=>releaseGuard(state));
  for(const patch of [{sha:'short'},{head:'b'.repeat(40)},{branch:'main'},{branch:'codex/other'},{status:' M source.ts'},{node:'24.0.0'}])assert.throws(()=>releaseGuard({...state,...patch}));
});
test('allows only exact reviewed public HTML documents and verifies their source bytes',()=>{
  assert.deepEqual(manifest.publicDocuments,PUBLIC_DOCUMENTS);
  const file=(name,text)=>({name,text,bytes:Buffer.from(text)});
  const frontend=[file('index.html','<html>Entry</html>'),...PUBLIC_DOCUMENTS.map(name=>file(name,'<html>Reviewed public information</html>'))];
  const read=()=>Buffer.from('<html>Reviewed public information</html>');
  assert.doesNotThrow(()=>validateFrontend(frontend,read));
  assert.throws(()=>validateFrontend([...frontend,file('unreviewed.html','<html>Other</html>')],read));
  assert.throws(()=>validateFrontend(frontend,()=>Buffer.from('Different tracked content')));
  assert.throws(()=>validateFrontend(frontend.filter(item=>item.name!==PUBLIC_DOCUMENTS[0]),read));
});
test('entry bootstraps Admin before exact named exports and refuses missing or module-drifted targets',()=>{
  const source=readFileSync(path.join(root,'functions/src/index.ts'),'utf8'),entry=releaseEntry(source,TARGETS);
  assert.ok(entry.startsWith("import './bootstrap-admin.js';\n"));
  for(const name of TARGETS)assert.ok(entry.includes(name));
  assert.ok(!entry.includes('dispatchRegistrationEmail'));assert.ok(!entry.includes('health'));
  assert.throws(()=>releaseEntry(source,TARGETS.slice(1)));
  assert.throws(()=>releaseEntry(source.replace('createDriveMediaFolder,',''),TARGETS));
  assert.throws(()=>releaseEntry(source.replace("from './drive/import-callables.js'","from './drive/other.js'"),TARGETS));
});
const processor="const workerUrl = new URL('../../worker/clip.mjs', import.meta.url);\nconst worker = await import(workerUrl.href);\nconst binary = (name) => fileURLToPath(new URL('../../worker/bin/' + name, import.meta.url));\n";
test('closure exception restores only the reviewed processor import and inventories bootstrap separately',()=>{
  const entry="import './bootstrap-admin.js';\nimport './drive/processor.js';\n";
  const files=reviewedClosure(entry,name=>{assert.equal(name,'drive/processor.js');return processor;},['firebase-admin']);
  assert.equal(files.get('drive/processor.js'),processor);assert.ok(files.get('bootstrap-admin.js').includes('bootstrapAdmin'));
  assert.throws(()=>reviewedClosure(entry,()=>processor+'await import(otherModule);',['firebase-admin']));
  assert.throws(()=>reviewedClosure(entry,()=>processor.replace('../../worker/clip.mjs','../../other.mjs'),['firebase-admin']));
  assert.throws(()=>reviewedClosure(entry,name=>name==='drive/processor.js'?processor+"import './other.js';":"await import(unreviewed);",['firebase-admin']));
});
test('ZIP encodes and verifies exact Unix755 binary modes even from Windows',async()=>{
  const local=path.join(root,'.local-data');mkdirSync(local,{recursive:true});const directory=mkdtempSync(path.join(local,'drive-media-zip-test-'));
  try{
    const require=createRequire(path.join(root,'package.json')),cliRequire=createRequire(require.resolve('firebase-tools/package.json'));
    const archive=cliRequire('archiver')('zip',{zlib:{level:1}}),filename=path.join(directory,'source.zip'),stream=createWriteStream(filename,{flags:'wx'});
    const done=new Promise((resolve,reject)=>{stream.on('close',resolve);stream.on('error',reject);archive.on('error',reject);});archive.pipe(stream);
    const names=['worker/bin/yt-dlp','worker/bin/ffmpeg','worker/bin/ffprobe','worker/clip.mjs','worker/verify-runtime.mjs','package.json'];
    const expected=Object.fromEntries(names.map(name=>[name,zipMode(name)]));
    for(const name of names)archive.append(Buffer.from('synthetic'),{name,mode:expected[name],date:new Date('2000-01-01T00:00:00Z')});
    await archive.finalize();await done;
    assert.deepEqual(inspectZipModes(filename,expected),expected);
    assert.throws(()=>inspectZipModes(filename,{...expected,'worker/bin/ffmpeg':0o644}));
    assert.throws(()=>inspectZipModes(filename,{...expected,'unexpected':0o644}));
  }finally{
    const resolved=realpathSync(directory);assert.ok(resolved.startsWith(realpathSync(local)+path.sep));assert.equal(resolved,path.resolve(directory));
    rmSync(resolved,{recursive:true});
  }
});
