import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const productPaths = ['apps/web', 'functions', 'packages', 'firebase.json',
  'firestore.rules', 'firestore.indexes.json', 'storage.rules', 'pnpm-lock.yaml'];
const localAbsolute = value => typeof value === 'string' && path.isAbsolute(value) && !/^(?:\\\\|\/\/)/u.test(value);

function executable(filename, label) {
  assert(localAbsolute(filename), label + ' must be an absolute local path.');
  const resolved = realpathSync(filename);
  assert(localAbsolute(resolved) && statSync(resolved).isFile(), label + ' must name a local file.');
  return resolved;
}

function onPath(name) {
  const filename = process.platform === 'win32' ? name + '.exe' : name;
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    const directory = entry.replace(/^"(.*)"$/u, '$1');
    if (!localAbsolute(directory)) continue;
    const candidate = path.join(directory, filename);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(name + ' is not available on the local PATH.');
}

export function offlineValidationTools(root, acceptedChromium, capacity = false) {
  assert.equal(process.versions.node.split('.')[0], '22', 'Use Node 22.');
  assert(/^\d+\.\d+\.\d+\.\d+$/u.test(acceptedChromium ?? ''), 'The core receipt must contain its actual Chromium version.');
  const chrome = executable(process.env.PLAYWRIGHT_EXECUTABLE_PATH || chromium.executablePath(), 'Chromium');
  const versionOf = packageName => JSON.parse(readFileSync(path.join(root, 'node_modules', packageName, 'package.json'), 'utf8')).version;
  const proof = { node: process.versions.node, playwright: versionOf('@playwright/test'), acceptedChromium };
  if (!capacity) return { chrome, proof };
  assert.equal(process.platform, 'win32', 'Capacity memory proof requires Windows process counters.');
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) assert(localAbsolute(javaHome) && statSync(javaHome).isDirectory(), 'JAVA_HOME must be an absolute local directory.');
  const java = executable(javaHome ? path.join(javaHome, 'bin', 'java.exe') : onPath('java'), 'Java');
  const ffmpeg = executable(process.env.OFFLINE_QA_FFMPEG_PATH || onPath('ffmpeg'), 'FFmpeg');
  const firstLine = (file, args) => execFileSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 5000 }).split(/\r?\n/u)[0];
  proof.java = firstLine(java, ['--version']);
  proof.ffmpeg = firstLine(ffmpeg, ['-version']);
  assert(/^(?:openjdk|java) 21(?:\.|\s|$)/u.test(proof.java), 'Use Java 21 for the local emulator.');
  assert(/^ffmpeg version \S+/u.test(proof.ffmpeg), 'FFmpeg version could not be read.');
  proof.firebaseCli = versionOf('firebase-tools');
  return { chrome, java, javaHome, ffmpeg, proof };
}

export function validationHarnessIdentity(root, coreSource) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  assert(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(coreSource.commit));
  assert.equal(git(['rev-parse', coreSource.commit + '^{tree}']), coreSource.tree, 'Core source tree does not match the receipt.');
  assert.equal(git(['diff', '--name-only', coreSource.commit, 'HEAD', '--', ...productPaths]), '', 'Product sources differ from the accepted core.');
  assert.equal(git(['status', '--porcelain', '--untracked-files=normal', '--', ...productPaths]), '', 'Product sources have uncommitted changes.');
  return { harnessCommit: git(['rev-parse', 'HEAD']), harnessTree: git(['rev-parse', 'HEAD^{tree}']) };
}
