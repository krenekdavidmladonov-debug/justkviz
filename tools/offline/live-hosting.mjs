import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const appPath = 'apps/web';
const detailPath = appPath + '/src/routes/admin/AdminEventDetailPage.tsx';
const offlinePath = appPath + '/src/features/offline';
const readyLink = '      {locked && currentUser && eventOperational(event) && <OfflinePreparationLink eventId={event.id} can={can} />}\n\n';
const onlineAnchor = "      {!hidden && can('event.read') && event.lifecycleStatus === 'completed' && <section";
const reserved = ['/__/firebase/init.js', '/__/firebase/init.json'];

function inventory(root, skipDependencies = false) {
  const files = {};
  function visit(dir, prefix) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skipDependencies && entry.name === 'node_modules') continue;
      assert(!entry.isSymbolicLink(), 'A release input contains a symbolic link.');
      const filename = path.join(dir, entry.name);
      const relative = prefix + entry.name;
      if (entry.isDirectory()) visit(filename, relative + '/');
      else {
        assert(entry.isFile());
        files[relative] = digest(readFileSync(filename));
      }
    }
  }
  visit(root, '');
  return files;
}

function insertLink(source) {
  const start = source.indexOf(onlineAnchor);
  assert(start >= 0 && start === source.lastIndexOf(onlineAnchor), 'The locked-event detail must have one known insertion point.');
  assert(source.includes('const locked = event.quizAssignment;') && source.includes('const { can, currentUser } = useAuth();'));
  return "import { OfflinePreparationLink } from '../../features/offline/OfflinePreparationLink';\n" +
    source.slice(0, start) + readyLink + source.slice(start);
}

function verifyWorker(dir) {
  const worker = readFileSync(path.join(dir, 'offline-sw.js'), 'utf8');
  const integrity = JSON.parse(/^const INTEGRITY=(\{[^\n]+\});$/mu.exec(worker)[1]);
  assert(Object.keys(integrity).some(file => file.startsWith('/offline-assets/')));
  for (const [file, expected] of Object.entries(integrity)) {
    assert(/^\/(?:offline-assets\/[^/]+|brand\/justkviz-icon\.svg|offline\.html|offline\.webmanifest)$/u.test(file));
    const bytes = readFileSync(path.join(dir, decodeURIComponent(file.slice(1))));
    assert.equal(expected, 'sha256-' + createHash('sha256').update(bytes).digest('base64'));
  }
}

/** Reproduce the live online application, then add the already implemented offline entry and detail link. */
export function buildLiveHosting({ root, baseline, metadata, config, out, scratch, env, mode }) {
  const live = json(metadata);
  const frozenBuild = json(path.join(baseline, 'build.json'));
  const frozenSource = json(path.join(baseline, 'source-derivation.json'));
  const frozenVersion = json(path.join(baseline, 'verification.json'));
  const liveHosting = live.hosting;
  assert.equal(live.project, 'filmovy-kviz-v2-staging');
  assert.equal(live.site, 'justkviz-v2');
  assert.equal(liveHosting.filesStatus, 200);
  assert.equal(liveHosting.filesPaginated, false);
  assert.equal(frozenVersion.status, 'PASS');
  assert.equal(frozenVersion.version, liveHosting.version);
  assert.equal(frozenBuild.sourceRevision, frozenVersion.sourceRevision);
  assert.equal(digest(readFileSync(path.join(baseline, 'source-derivation.json'))), frozenBuild.sourceDerivationSha256);

  const liveFiles = Object.fromEntries(liveHosting.fileHashes.map(file => [file.path, file.hash]));
  const source = path.join(baseline, 'web-source');
  const previous = path.join(baseline, 'hosting');
  assert.deepEqual(inventory(source, true), frozenSource.files);
  assert.deepEqual(inventory(previous), frozenBuild.files);
  assert.deepEqual(Object.keys(liveFiles).sort(), [...reserved, ...Object.keys(frozenBuild.files).map(file => '/' + file)].sort());
  for (const file of Object.keys(frozenBuild.files)) {
    assert.equal(digest(gzipSync(readFileSync(path.join(previous, file)), { level: 9 })), liveFiles['/' + file], file);
  }
  const onlineHeaders = structuredClone(config.hosting.headers);
  onlineHeaders[1].source = onlineHeaders[1].source.replace(',offline.html,offline.webmanifest,offline-sw.js', '');
  assert.deepEqual(liveHosting.config, {
    headers: onlineHeaders.map(item => ({ glob: item.source, headers: Object.fromEntries(item.headers.map(h => [h.key, h.value])) })),
    rewrites: config.hosting.rewrites.map(item => ({ glob: item.source, path: item.destination })),
  });
  if (mode === 'disabled') config.hosting.headers = onlineHeaders;

  const result = path.join(out, 'hosting');
  cpSync(previous, result, { recursive: true });
  const vite = path.join(root, appPath, 'node_modules/vite');
  const runBuild = (cwd, wrapper, output, variables, tool = vite) => execFileSync(process.execPath, [
    path.join(tool, 'bin/vite.js'), 'build', '--config', wrapper, '--mode', 'staging', '--outDir', output, '--emptyOutDir',
  ], { cwd, env: variables, stdio: 'inherit', windowsHide: true });
  if (mode === 'enabled') {
    const copied = path.join(scratch, 'online-source');
    cpSync(source, copied, { recursive: true, filter: file => path.basename(file) !== 'node_modules' });
    assert.deepEqual(inventory(copied), frozenSource.files);
    const dependencies = realpathSync(path.join(source, appPath, 'node_modules'));
    const onlineVite = path.join(dependencies, 'vite');
    symlinkSync(dependencies, path.join(copied, appPath, 'node_modules'), 'junction');
    const wrapper = path.join(scratch, 'live-online.vite.mts');
    const domain = path.join(copied, 'packages/quiz-domain/lib/index.js');
    writeFileSync(wrapper, [
      'import base from "./online-source/apps/web/vite.config.ts";',
      'export default async env => ({...await base(env), resolve: {alias: {"@filmovy-kviz/quiz-domain": ' + JSON.stringify(domain) + '}}});',
    ].join('\n'));
    const unchanged = path.join(scratch, 'online-reproduced');
    runBuild(path.join(copied, appPath), wrapper, unchanged, { ...env, VITE_JUSTKVIZ_OFFLINE: 'false' }, onlineVite);
    assert.deepEqual(inventory(unchanged), frozenBuild.files, 'The exact deployed online build must be reproducible before adding a link.');
    const files = ['offlineAvailability.ts', 'OfflinePreparationLink.tsx'];
    mkdirSync(path.join(copied, offlinePath));
    for (const file of files) cpSync(path.join(root, offlinePath, file), path.join(copied, offlinePath, file));
    const detail = path.join(copied, detailPath);
    writeFileSync(detail, insertLink(readFileSync(detail, 'utf8')));
    const patched = inventory(copied, true);
    assert.deepEqual(Object.keys(patched).filter(file => patched[file] !== frozenSource.files[file]).sort(),
      [detailPath, ...files.map(file => offlinePath + '/' + file)].sort());
    const online = path.join(scratch, 'online-enabled');
    runBuild(path.join(copied, appPath), wrapper, online, env, onlineVite);
    for (const [file, hash] of Object.entries(inventory(online))) {
      if (frozenBuild.files[file] !== undefined && file !== 'index.html') assert.equal(frozenBuild.files[file], hash);
      const destination = path.join(result, file);
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(path.join(online, file), destination);
    }
  }
  if (mode !== 'disabled') {
    const wrapper = path.join(scratch, 'offline-only.vite.mts');
    const publicDir = path.join(scratch, 'offline-public');
    mkdirSync(path.join(publicDir, 'brand'), { recursive: true });
    cpSync(path.join(root, appPath, 'public/brand/justkviz-icon.svg'), path.join(publicDir, 'brand/justkviz-icon.svg'));
    writeFileSync(wrapper, [
      'import base from ' + JSON.stringify(path.join(root, appPath, 'vite.config.ts')) + ';',
      'export default async env => { const config = await base(env);',
      'return { ...config, publicDir: ' + JSON.stringify(publicDir) + ', build: { assetsDir: "offline-assets", rollupOptions: { input: { offline: ' +
        JSON.stringify(path.join(root, appPath, 'offline.html')) + ' } } } }; };',
    ].join('\n'));
    const offline = path.join(scratch, 'offline-only');
    runBuild(path.join(root, appPath), wrapper, offline, env);
    for (const [file, hash] of Object.entries(inventory(offline))) {
      const destination = path.join(result, file);
      if (frozenBuild.files[file] !== undefined) assert.equal(frozenBuild.files[file], hash, 'Offline and online public asset conflict: ' + file);
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(path.join(offline, file), destination);
    }
    verifyWorker(result);
  }
  const outputFiles = inventory(result);
  for (const [file, hash] of Object.entries(frozenBuild.files)) {
    if (mode !== 'enabled' || file !== 'index.html') assert.equal(outputFiles[file], hash, 'Retain active clients: ' + file);
  }
  return {
    baselineVersion: liveHosting.version,
    baselineRelease: liveHosting.release,
    baselinePublicFiles: Object.keys(frozenBuild.files).length,
    reserved: Object.fromEntries(reserved.map(file => [file, liveFiles[file]])),
    files: Object.fromEntries(Object.keys(outputFiles).sort().map(file =>
      ['/' + file, digest(gzipSync(readFileSync(path.join(result, file)), { level: 9 }))])),
  };
}
