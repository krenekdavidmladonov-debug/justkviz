import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { clipLimits, ClipError, createYouTubeClip, runBoundedProcess, validateClipRequest } from './clip.mjs';

const root = path.resolve(import.meta.dirname, '../../.local-data');
const request = { videoId: 'abcdefghijk', startSeconds: 10, endSeconds: 23, kind: 'video' };
const video = { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 };
const audio = { codec_type: 'audio', codec_name: 'aac', channels: 2 };
const probe = (streams, duration, format_name = 'mov,mp4,m4a,3gp,3g2,mj2') => JSON.stringify({ streams, format: { duration: String(duration), format_name } });

async function fixture(t, customize = {}) {
  const directory = await mkdtemp(path.join(root, 'clip-worker-test-'));
  t.after(async () => { assert.equal(path.dirname(directory), root); await rm(directory, { recursive: true, force: true }); });
  const calls = [], progress = [];
  const config = { ytDlpPath: path.join(directory, 'yt-dlp.exe'), ffmpegPath: path.join(directory, 'ffmpeg.exe'),
    ffprobePath: path.join(directory, 'ffprobe.exe'), tempRoot: directory };
  const runProcess = async (command, args, options) => {
    calls.push({ command, args, options });
    if (customize.before) await customize.before(command, args, options);
    if (args.includes('--version')) return { stdout: customize.version ?? '2026.08.19\n' };
    if (args.includes('-version')) return { stdout: path.basename(command, '.exe') + ' version 7.1.1 synthetic\n' };
    if (command === config.ytDlpPath) {
      await writeFile(options.stdoutFile, Buffer.alloc(64, 1));
      if (customize.sourceSize) await truncate(options.stdoutFile, customize.sourceSize);
      return { stdout: '' };
    }
    if (command === config.ffmpegPath) {
      await writeFile(args.at(-1), Buffer.alloc(128, 2));
      if (customize.outputSize) await truncate(args.at(-1), customize.outputSize);
      return { stdout: '' };
    }
    const file = args.at(-1), output = path.basename(file).startsWith('clip.');
    if (customize.probe) {
      const result = customize.probe(file, output);
      if (result !== undefined) return { stdout: result };
    }
    if (path.basename(file) === 'source-video.bin') return { stdout: probe([video], 125) };
    if (path.basename(file) === 'source-audio.bin') return { stdout: probe([audio], 125) };
    return { stdout: file.endsWith('.mp3') ? probe([{ ...audio, codec_name: 'mp3' }], 13.05, 'mp3') : probe([video, audio], 13) };
  };
  return { directory, config, calls, dependencies: { runProcess, onProgress: value => progress.push(value), ...customize.dependencies }, progress };
}

test('strict canonical ID and finite, positive, at-most-180-second clip input', () => {
  assert.deepEqual(validateClipRequest(request), request);
  assert.equal(validateClipRequest({ ...request, startSeconds: 0, endSeconds: 180 }).endSeconds, 180);
  for (const invalid of [null, [], { ...request, videoId: 'https://youtu.be/abcdefghijk' },
    { ...request, videoId: '../abcdefgh' }, { ...request, videoId: 'abcdefghij\n' },
    { ...request, startSeconds: -1 }, { ...request, startSeconds: NaN }, { ...request, endSeconds: Infinity },
    { ...request, startSeconds: '10' }, { ...request, endSeconds: 10 }, { ...request, endSeconds: 190.01 },
    { ...request, endSeconds: 86401, startSeconds: 86399 }, { ...request, kind: 'other' },
    { ...request, cookies: 'secret' }, { ...request, ytDlpPath: 'injected.exe' }, { ...request, url: 'http://127.0.0.1' }]) {
    assert.throws(() => validateClipRequest(invalid), error => error instanceof ClipError && error.code === 'invalid-input');
  }
});

test('video uses fixed HTTPS-only <=720p format, separate bounded streams and local-only ffmpeg inputs', async t => {
  const f = await fixture(t);
  const result = await createYouTubeClip(request, f.config, f.dependencies);
  assert.equal(result.contentType, 'video/mp4'); assert.equal(result.size, 128); assert.equal(result.sourceBytes, 128);
  assert.equal(result.durationSeconds, 13);
  assert.deepEqual(result.versions, { ytDlp: '2026.08.19', ffmpeg: '7.1.1', ffprobe: '7.1.1' });
  const downloads = f.calls.filter(call => call.options.stdoutFile);
  assert.equal(downloads.length, 2);
  assert.ok(downloads[0].args.includes('bestvideo[protocol=https][height<=720][width<=1280]'));
  assert.ok(downloads[1].args.includes('bestaudio[protocol=https]'));
  assert.equal(downloads[0].options.maxFileBytes, clipLimits.sourceBytes);
  assert.equal(downloads[1].options.maxFileBytes, clipLimits.sourceBytes - 64);
  for (const call of downloads) {
    assert.equal(call.args.at(-1), 'https://www.youtube.com/watch?v=abcdefghijk');
    for (const flag of ['--ignore-config', '--no-plugin-dirs', '--no-remote-components', '--no-cookies', '--no-cookies-from-browser', '--no-geo-bypass']) assert.ok(call.args.includes(flag));
    assert.equal(call.args[call.args.indexOf('--proxy') + 1], '');
    assert.equal(path.dirname(call.options.stdoutFile), result.directory);
  }
  const transcode = f.calls.find(call => call.command === f.config.ffmpegPath && !call.args.includes('-version'));
  const inputs = transcode.args.flatMap((arg, i) => arg === '-i' ? [transcode.args[i + 1]] : []);
  assert.equal(inputs.length, 2); assert.ok(inputs.every(file => path.dirname(file) === result.directory));
  assert.equal(transcode.args.filter(arg => arg === 'file,pipe').length, 2);
  assert.ok(transcode.args.includes('libx264')); assert.ok(transcode.args.includes('aac'));
  assert.equal(transcode.args[transcode.args.indexOf('-t') + 1], '13');
  assert.equal(transcode.args[transcode.args.indexOf('-fs') + 1], String(clipLimits.outputBytes));
  assert.deepEqual(await readdir(result.directory), ['clip.mp4']);
  assert.deepEqual(f.progress.map(value => value.phase), ['tools', 'download-video', 'download-audio', 'transcode', 'verify', 'ready']);
  assert.ok(f.progress.every(value => Object.keys(value).length === 1));
  await result.cleanup(); await result.cleanup(); assert.deepEqual(await readdir(f.directory), []);
});

test('audio creates verified MP3 and downloads only one source track', async t => {
  const f = await fixture(t);
  const result = await createYouTubeClip({ ...request, kind: 'audio' }, f.config, f.dependencies);
  assert.equal(result.contentType, 'audio/mpeg'); assert.ok(result.path.endsWith('.mp3'));
  assert.equal(f.calls.filter(call => call.options.stdoutFile).length, 1);
  const ffmpeg = f.calls.find(call => call.args.includes('libmp3lame'));
  assert.ok(ffmpeg.args.includes('-vn')); assert.ok(!ffmpeg.args.includes('libx264'));
  await result.cleanup();
});

test('only trusted operator config may explicitly enable an absolute local Node runtime', async t => {
  const f = await fixture(t), nodePath = path.join(f.directory, 'node.exe');
  const result = await createYouTubeClip(request, { ...f.config, nodePath }, f.dependencies);
  const downloads = f.calls.filter(call => call.options.stdoutFile);
  for (const { args } of downloads) {
    assert.ok(args.includes('--no-remote-components'));
    assert.ok(args.indexOf('--no-js-runtimes') < args.indexOf('--js-runtimes'));
    assert.equal(args[args.indexOf('--js-runtimes') + 1], 'node:' + nodePath);
  }
  await assert.rejects(createYouTubeClip({ ...request, nodePath }, f.config, f.dependencies), error => error.code === 'invalid-input');
  for (const invalid of ['node', path.join(f.directory, 'node.cmd'), path.join(f.directory, 'node.ps1'), null, 42, 'C:\\bad\nnode.exe']) {
    await assert.rejects(createYouTubeClip(request, { ...f.config, nodePath: invalid }, f.dependencies), error => error.code === 'invalid-config');
  }
  await result.cleanup();
});

test('operator paths/options cannot be chosen through the request and config rejects shell launchers', async t => {
  const f = await fixture(t);
  for (const config of [{ ...f.config, ytDlpPath: 'yt-dlp' }, { ...f.config, ffmpegPath: path.join(f.directory, 'ffmpeg.cmd') },
    { ...f.config, cookies: 'secret' }, { ...f.config, deadlineMs: 999 }, { ...f.config, deadlineMs: Infinity }]) {
    await assert.rejects(createYouTubeClip(request, config, f.dependencies), error => error.code === 'invalid-config');
  }
  assert.equal(f.calls.length, 0);
});

test('combined source byte limit includes both tracks and removes every temporary file', async t => {
  const f = await fixture(t, { sourceSize: clipLimits.sourceBytes / 2 + 1 });
  await assert.rejects(createYouTubeClip(request, f.config, f.dependencies), error => error.code === 'source-too-large');
  assert.deepEqual(await readdir(f.directory), []);
});

test('oversized output is rejected before it is returned', async t => {
  const f = await fixture(t, { outputSize: clipLimits.outputBytes + 1 });
  await assert.rejects(createYouTubeClip(request, f.config, f.dependencies), error => error.code === 'output-too-large');
  assert.deepEqual(await readdir(f.directory), []);
});

test('source must cover requested END and has bounded dimensions/channels', async t => {
  for (const body of [probe([video], 22), probe([{ ...video, height: 1080 }], 125), probe([{ ...audio, channels: 6 }], 125), 'malformed']) {
    const f = await fixture(t, { probe: (file, output) => !output ? body : undefined });
    await assert.rejects(createYouTubeClip(request, f.config, f.dependencies), error => error.code === 'invalid-media');
    assert.deepEqual(await readdir(f.directory), []);
  }
});

test('output requires H264 + AAC, exactly two tracks, dimensions, duration and MP4 container', async t => {
  for (const body of [probe([video, audio], 11), probe([video], 13), probe([video, { ...audio, channels: 0 }], 13),
    probe([{ ...video, codec_name: 'vp9' }, audio], 13), probe([video, { ...audio, codec_name: 'opus' }], 13),
    probe([{ ...video, width: 1920 }, audio], 13), probe([video, audio, { codec_type: 'data' }], 13),
    probe([video, audio], 13, 'matroska,webm'), probe([video, audio], 'Infinity')]) {
    const f = await fixture(t, { probe: (_file, output) => output ? body : undefined });
    await assert.rejects(createYouTubeClip(request, f.config, f.dependencies), error => error.code === 'invalid-media');
    assert.deepEqual(await readdir(f.directory), []);
  }
});

test('output audio rejects a hidden video track or incorrect codec/container', async t => {
  for (const body of [probe([audio], 13, 'mp3'), probe([{ ...audio, codec_name: 'mp3' }, video], 13, 'mp3'),
    probe([{ ...audio, codec_name: 'mp3' }], 13, 'wav')]) {
    const f = await fixture(t, { probe: (_file, output) => output ? body : undefined });
    await assert.rejects(createYouTubeClip({ ...request, kind: 'audio' }, f.config, f.dependencies), error => error.code === 'invalid-media');
  }
});

test('one overall deadline covers all sequential steps', async t => {
  let now = 0;
  const f = await fixture(t, { before: async () => { now += 400; }, dependencies: { now: () => now } });
  await assert.rejects(createYouTubeClip(request, { ...f.config, deadlineMs: 1000 }, f.dependencies), error => error.code === 'deadline-exceeded');
  assert.deepEqual(f.calls.map(call => call.options.timeoutMs), [1000, 600, 200]);
  assert.deepEqual(await readdir(f.directory), []);
});

test('provider errors and malformed versions never expose URLs, stderr or local details', async t => {
  for (const customize of [{ before: async () => { throw new Error('secret https://example.invalid/?access_token=secret'); } },
    { version: '2026.08.19 https://example.invalid/secret' }]) {
    const f = await fixture(t, customize);
    await assert.rejects(createYouTubeClip(request, f.config, f.dependencies), error => {
      assert.ok(error instanceof ClipError); assert.ok(!String(error).includes('secret')); assert.ok(!String(error).includes('http'));
      assert.equal(error.cause, undefined); return true;
    });
    assert.deepEqual(await readdir(f.directory), []);
  }
});

function fakeSpawn(action) {
  const calls = [];
  return { calls, spawnProcess(command, args, options) {
    calls.push({ command, args, options });
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false;
    child.kill = () => { if (!closed) { closed = true; queueMicrotask(() => child.emit('close', null)); } return true; };
    queueMicrotask(() => action(child, code => { if (!closed) { closed = true; child.emit('close', code); } }));
    return child;
  } };
}

test('subprocess runner uses no shell, ignores stdin, suppresses stderr and strips credential/proxy environment', async () => {
  const prior = process.env.HTTPS_PROXY; process.env.HTTPS_PROXY = 'http://secret.invalid';
  try {
    const fake = fakeSpawn((child, close) => { child.stdout.write('2026.08.19\n'); child.stderr.write('secret https://example.invalid'); close(0); });
    const result = await runBoundedProcess('/trusted/tool', ['--version'], { timeoutMs: 1000 }, fake.spawnProcess);
    assert.deepEqual(result, { stdout: '2026.08.19\n' });
    assert.equal(fake.calls[0].options.shell, false); assert.equal(fake.calls[0].options.windowsHide, true);
    assert.equal(fake.calls[0].options.stdio[0], 'ignore'); assert.equal(fake.calls[0].options.env.HTTPS_PROXY, undefined);
  } finally { if (prior === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = prior; }
});

test('runner caps downloaded binary stdout before writing bytes beyond its allocation', async t => {
  const f = await fixture(t), output = path.join(f.directory, 'bounded.bin');
  const fake = fakeSpawn(child => { child.stdout.write(Buffer.alloc(8, 1)); child.stdout.write(Buffer.alloc(8, 2)); });
  await assert.rejects(runBoundedProcess('/trusted/tool', [], { timeoutMs: 1000, stdoutFile: output, maxFileBytes: 10 }, fake.spawnProcess), error => error.code === 'source-too-large');
  assert.equal((await readFile(output)).length, 8);
});

test('runner rejects excessive diagnostic output, process exit, startup error and deadline without leaking detail', async () => {
  for (const [action, code] of [[child => child.stdout.write(Buffer.alloc(1024 * 1024 + 1)), 'process-failed'],
    [child => child.stderr.write(Buffer.alloc(1024 * 1024 + 1)), 'process-failed'],
    [(_child, close) => close(1), 'process-failed'],
    [(child, close) => { child.emit('error', new Error('secret')); close(null); }, 'process-failed'],
    [() => {}, 'deadline-exceeded']]) {
    const fake = fakeSpawn(action);
    await assert.rejects(runBoundedProcess('/trusted/tool', [], { timeoutMs: 10 }, fake.spawnProcess), error => {
      assert.equal(error.code, code); assert.ok(!String(error).includes('secret')); return true;
    });
  }
});

test('runner reports fixed diagnostic categories across split stderr without leaking raw provider output', async () => {
  for (const [text, expected] of [
    ['error while loading shared libraries: libz.so', 'runtime-library-missing'],
    ['no such option: --no-remote-components', 'runtime-option-unsupported'],
    ['Sign in to confirm you are not a bot', 'provider-sign-in-required'],
    ['HTTP Error 403: Forbidden', 'provider-access-denied'],
    ['HTTP Error 429: Too Many Requests', 'provider-rate-limited'],
    ['Video unavailable', 'provider-unavailable'],
    ['Requested format is not available', 'format-unavailable'],
    ['Temporary failure in name resolution', 'network-failed'],
    ['unrecognized provider detail', 'process-exit'],
  ]) {
    const fake = fakeSpawn((child, close) => {
      child.stderr.write(text.slice(0, 8));
      child.stderr.write(text.slice(8) + ' https://secret.invalid/?access_token=private /private/path');
      close(1);
    });
    await assert.rejects(runBoundedProcess('/trusted/tool', [], { timeoutMs: 1000 }, fake.spawnProcess), error => {
      assert.equal(error.code, 'process-failed'); assert.equal(error.diagnosticCode, expected);
      for (const secret of ['secret.invalid', 'access_token', '/private/path', text]) assert.ok(!JSON.stringify(error).includes(secret));
      assert.equal(error.cause, undefined); return true;
    });
  }
});

test('runner distinguishes missing and non-executable runtime binaries using only fixed startup codes', async () => {
  for (const [code, expected] of [['ENOENT', 'executable-missing'], ['EACCES', 'executable-not-permitted'], ['EOTHER', 'executable-start-failed']]) {
    const fake = fakeSpawn((child, close) => { child.emit('error', Object.assign(new Error('/secret/path'), { code })); close(null); });
    await assert.rejects(runBoundedProcess('/trusted/tool', [], { timeoutMs: 1000 }, fake.spawnProcess), error => {
      assert.equal(error.diagnosticCode, expected); assert.ok(!JSON.stringify(error).includes('/secret/path')); return true;
    });
  }
});

test('clip failure identifies its phase and active tool while preserving cleanup', async t => {
  const f = await fixture(t, { before: async (_command, args, options) => {
    if (options.stdoutFile) throw new ClipError('process-failed', 'provider-sign-in-required');
  } });
  await assert.rejects(createYouTubeClip(request, f.config, f.dependencies), error => {
    assert.equal(error.phase, 'download-video'); assert.equal(error.tool, 'ytDlp');
    assert.equal(error.diagnosticCode, 'provider-sign-in-required'); return true;
  });
  assert.deepEqual(await readdir(f.directory), []);
});
