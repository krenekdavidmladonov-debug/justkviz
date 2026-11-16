import { spawn } from 'node:child_process';
import { closeSync, openSync, writeSync } from 'node:fs';
import { lstat, mkdtemp, realpath, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

export const clipLimits = Object.freeze({ sourceBytes: 200 * 1024 * 1024, outputBytes: 25 * 1024 * 1024,
  clipSeconds: 180, width: 1280, height: 720, deadlineMs: 300_000 });

const messages = {
  'invalid-input': 'Neplatný zdroj nebo interval výřezu.',
  'invalid-config': 'Lokální nástroje pro výřez nejsou nakonfigurované.',
  'deadline-exceeded': 'Příprava výřezu překročila časový limit.',
  'source-too-large': 'Zdroj překročil povolenou velikost.',
  'output-too-large': 'Výřez překročil povolenou velikost.',
  'process-failed': 'Nástroj pro přípravu média selhal.',
  'invalid-media': 'Médium nemá požadované stopy, časování nebo formát.',
};
export class ClipError extends Error {
  constructor(code, diagnosticCode) {
    super(messages[code] ?? messages['process-failed']); this.name = 'ClipError'; this.code = code;
    if (diagnosticCode) this.diagnosticCode = diagnosticCode;
  }
}
const failure = (code, diagnosticCode) => new ClipError(code, diagnosticCode);

// Match provider/runtime output only in memory. Only these fixed labels escape;
// even an unknown error's message, URL, title and local path are discarded.
function diagnosticCategory(text) {
  for (const [pattern, code] of [
    [/error while loading shared libraries|cannot open shared object file|GLIBC_[\d.]+.*not found/iu, 'runtime-library-missing'],
    [/no such option|unrecognized (?:option|argument)|unknown option/iu, 'runtime-option-unsupported'],
    [/sign in to confirm|login required|use --cookies|authentication required/iu, 'provider-sign-in-required'],
    [/HTTP Error 429|too many requests/iu, 'provider-rate-limited'],
    [/HTTP Error 403|access denied|forbidden/iu, 'provider-access-denied'],
    [/video unavailable|private video|video has been removed|not available in your country/iu, 'provider-unavailable'],
    [/requested format is not available|no video formats found/iu, 'format-unavailable'],
    [/timed? out|temporary failure in name resolution|network is unreachable|connection (?:reset|refused)|certificate verify failed/iu, 'network-failed'],
  ]) if (pattern.test(text)) return code;
}

function startupCategory(error) {
  return error?.code === 'ENOENT' ? 'executable-missing' : ['EACCES', 'EPERM'].includes(error?.code)
    ? 'executable-not-permitted' : 'executable-start-failed';
}

/** Browser/job input contains no URL, executable path, downloader flags or output path. */
export function validateClipRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['videoId', 'startSeconds', 'endSeconds', 'kind'].includes(key))
    || typeof input.videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/u.test(input.videoId)
    || !['video', 'audio'].includes(input.kind)
    || !Number.isFinite(input.startSeconds) || input.startSeconds < 0
    || !Number.isFinite(input.endSeconds) || input.endSeconds <= input.startSeconds
    || input.endSeconds - input.startSeconds > clipLimits.clipSeconds
    || input.endSeconds > 24 * 60 * 60) throw failure('invalid-input');
  return Object.freeze({ videoId: input.videoId, kind: input.kind,
    startSeconds: input.startSeconds, endSeconds: input.endSeconds });
}

function processEnvironment() {
  const allowed = ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'PATH', 'Path', 'PATHEXT', 'TEMP', 'TMP', 'LANG', 'LC_ALL'];
  return { ...Object.fromEntries(allowed.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])), NO_COLOR: '1' };
}

function terminateTree(child) {
  if (!child.pid) { child.kill('SIGKILL'); return; }
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    return;
  }
  // PyInstaller and a future local runtime may have children: kill only this PID tree.
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot || !path.isAbsolute(systemRoot)) { child.kill('SIGKILL'); return; }
  try {
    const killer = spawn(path.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'],
      { shell: false, windowsHide: true, stdio: 'ignore', env: processEnvironment() });
    killer.on('error', () => child.kill('SIGKILL'));
    killer.on('close', code => { if (code !== 0) child.kill('SIGKILL'); });
  } catch { child.kill('SIGKILL'); }
}

/** No raw provider output escapes this runner. Binary stdout is capped before disk writes. */
export function runBoundedProcess(command, args, options, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    let child, descriptor, timer, error, stdoutBytes = 0, stderrBytes = 0, diagnosticCode, stderrTail = '';
    const output = [];
    const fail = (code, diagnostic) => { if (!error) { error = failure(code, diagnostic); if (child) terminateTree(child); } };
    try {
      if (options.stdoutFile) descriptor = openSync(options.stdoutFile, 'wx', 0o600);
      child = spawnProcess(command, args, { cwd: options.cwd, shell: false, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: processEnvironment() });
      timer = setTimeout(() => fail('deadline-exceeded', 'timeout'), options.timeoutMs);
      child.stdout.on('data', chunk => {
        if (error) return;
        const bytes = Buffer.from(chunk);
        stdoutBytes += bytes.length;
        if (stdoutBytes > (descriptor === undefined ? 1024 * 1024 : options.maxFileBytes)) {
          fail(descriptor === undefined ? 'process-failed' : 'source-too-large', 'stdout-limit'); return;
        }
        try {
          if (descriptor === undefined) output.push(bytes);
          else {
            let offset = 0;
            while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
          }
        } catch { fail('process-failed', 'file-write-failed'); }
      });
      child.stderr.on('data', chunk => {
        // Bounded transient window handles phrases split across chunks; never expose it.
        stderrBytes += Buffer.byteLength(chunk);
        if (stderrBytes > 1024 * 1024) { fail('process-failed', 'stderr-limit'); return; }
        const text = stderrTail + Buffer.from(chunk).toString('utf8');
        diagnosticCode ??= diagnosticCategory(text);
        stderrTail = text.slice(-256);
      });
      child.on('error', cause => { error ??= failure('process-failed', startupCategory(cause)); });
      child.on('close', code => {
        clearTimeout(timer);
        stderrTail = '';
        if (descriptor !== undefined) closeSync(descriptor);
        if (error || code !== 0) reject(error ?? failure('process-failed', diagnosticCode ?? 'process-exit'));
        else resolve({ stdout: Buffer.concat(output).toString('utf8') });
      });
    } catch (cause) {
      clearTimeout(timer);
      if (descriptor !== undefined) closeSync(descriptor);
      if (child) terminateTree(child);
      reject(failure('process-failed', child ? 'file-write-failed' : startupCategory(cause)));
    }
  });
}

function operatorConfiguration(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).some(key => !['ytDlpPath', 'ffmpegPath', 'ffprobePath', 'nodePath', 'tempRoot', 'deadlineMs'].includes(key))
    || ['ytDlpPath', 'ffmpegPath', 'ffprobePath', 'tempRoot', ...(config.nodePath === undefined ? [] : ['nodePath'])].some(key => typeof config[key] !== 'string'
      || !path.isAbsolute(config[key]) || [...config[key]].some(character => character.charCodeAt(0) < 32))
    || ['ytDlpPath', 'ffmpegPath', 'ffprobePath', ...(config.nodePath === undefined ? [] : ['nodePath'])].some(key => /\.(?:cmd|bat|ps1)$/iu.test(config[key]))) throw failure('invalid-config');
  const deadlineMs = config.deadlineMs ?? clipLimits.deadlineMs;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 || deadlineMs > 900_000) throw failure('invalid-config');
  return { ...config, deadlineMs };
}

async function checkedFile(file, directory, maximum, code) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || path.dirname(await realpath(file)) !== directory || info.size <= 0) throw failure('invalid-media');
  if (info.size > maximum) throw failure(code);
  return info.size;
}

function parseProbe(stdout) {
  try {
    const data = JSON.parse(stdout);
    if (!data || !Array.isArray(data.streams) || !Number.isFinite(Number(data.format?.duration))
      || Number(data.format.duration) <= 0) throw failure('invalid-media');
    return data;
  } catch { throw failure('invalid-media'); }
}

function validateProbe(data, kind, expectedDuration, output) {
  const duration = Number(data.format.duration);
  if (expectedDuration !== undefined && (output ? Math.abs(duration - expectedDuration) > 0.3 : duration + 0.05 < expectedDuration)) throw failure('invalid-media');
  const audio = data.streams.filter(stream => stream.codec_type === 'audio');
  const video = data.streams.filter(stream => stream.codec_type === 'video');
  if ((kind === 'audio' || kind === 'video-audio') && (audio.length !== 1 || !Number.isInteger(audio[0].channels)
    || audio[0].channels < 1 || audio[0].channels > 2
    || (output && audio[0].codec_name !== (kind === 'audio' ? 'mp3' : 'aac')))) throw failure('invalid-media');
  if (kind === 'video' || kind === 'video-audio') {
    if (video.length !== 1 || !Number.isInteger(video[0].width) || !Number.isInteger(video[0].height)
      || video[0].width < 2 || video[0].height < 2 || video[0].width > clipLimits.width || video[0].height > clipLimits.height
      || (output && video[0].codec_name !== 'h264')) throw failure('invalid-media');
  }
  if (output && (data.streams.length !== (kind === 'video-audio' ? 2 : 1)
    || (kind === 'audio' && video.length !== 0)
    || !(String(data.format.format_name).split(',').includes(kind === 'audio' ? 'mp3' : 'mp4')))) throw failure('invalid-media');
  return duration;
}

function version(stdout, tool) {
  const line = stdout.split(/\r?\n/u)[0];
  const match = tool === 'ytDlp' ? /^(\d{4}\.\d{2}\.\d{2}(?:[A-Za-z0-9._+-]{0,40}))$/u.exec(line)
    : new RegExp('^' + tool + ' version ([A-Za-z0-9._+-]{1,80})(?: |$)', 'u').exec(line);
  if (!match) throw failure('invalid-config');
  return match[1];
}

const downloaderFlags = ['--ignore-config', '--no-plugin-dirs', '--no-remote-components', '--no-js-runtimes',
  '--no-cookies', '--no-cookies-from-browser', '--no-cache-dir', '--proxy', '', '--no-geo-bypass',
  '--no-playlist', '--no-progress', '--quiet', '--no-warnings', '--no-part', '--fixup', 'never',
  '--socket-timeout', '15', '--retries', '1', '--fragment-retries', '1', '--downloader', 'native',
  '--max-filesize', String(clipLimits.sourceBytes), '--match-filter', '!is_live & !is_upcoming', '--output', '-'];

/**
 * Local-only worker. Operator configuration must never come from a browser/job payload.
 * Success retains only the verified artifact until cleanup(); every failure removes its work directory.
 * YouTube/provider permission and the caller's application authorization are separate upstream checks.
 */
export async function createYouTubeClip(input, operatorConfig, dependencies = {}) {
  const request = validateClipRequest(input), config = operatorConfiguration(operatorConfig);
  const run = dependencies.runProcess ?? runBoundedProcess, now = dependencies.now ?? Date.now;
  const startedAt = now();
  let root, directory, phase = 'setup', activeTool;
  const progress = next => { phase = next; activeTool = undefined; dependencies.onProgress?.({ phase }); };
  const execute = (tool, args, options = {}) => {
    activeTool = tool;
    const timeoutMs = config.deadlineMs - (now() - startedAt);
    if (timeoutMs <= 0) throw failure('deadline-exceeded');
    return run(config[tool + 'Path'], args, { cwd: directory, timeoutMs, ...options });
  };
  const cleanup = async () => {
    if (!directory) return;
    const target = path.resolve(directory);
    if (path.dirname(target) !== root || !path.basename(target).startsWith('clip-')) throw failure('invalid-config');
    try {
      const info = await lstat(target);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(target) !== target) throw failure('invalid-config');
      await rm(target, { recursive: true, force: true });
    } catch (error) { if (error.code !== 'ENOENT') throw failure('process-failed'); }
  };
  try {
    root = await realpath(config.tempRoot);
    if (!(await stat(root)).isDirectory()) throw failure('invalid-config');
    directory = await mkdtemp(path.join(root, 'clip-'));
    progress('tools');
    const versions = {};
    for (const [tool, args] of [['ytDlp', ['--ignore-config', '--no-plugin-dirs', '--version']], ['ffmpeg', ['-version']], ['ffprobe', ['-version']]]) {
      versions[tool] = version((await execute(tool, args)).stdout, tool);
    }
    const sourceVideo = path.join(directory, 'source-video.bin'), sourceAudio = path.join(directory, 'source-audio.bin');
    let sourceBytes = 0;
    const sources = request.kind === 'video' ? [['video', sourceVideo], ['audio', sourceAudio]] : [['audio', sourceAudio]];
    for (const [kind, file] of sources) {
      progress('download-' + kind);
      await execute('ytDlp', [...downloaderFlags, ...(config.nodePath ? ['--js-runtimes', 'node:' + config.nodePath] : []), '--format', kind === 'video'
        ? 'bestvideo[protocol=https][height<=720][width<=1280]' : 'bestaudio[protocol=https]',
      '--', 'https://www.youtube.com/watch?v=' + request.videoId], { stdoutFile: file, maxFileBytes: clipLimits.sourceBytes - sourceBytes });
      sourceBytes += await checkedFile(file, directory, clipLimits.sourceBytes - sourceBytes, 'source-too-large');
      const probe = parseProbe((await execute('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe',
        '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,channels,width,height', '-of', 'json', file])).stdout);
      validateProbe(probe, kind, request.endSeconds, false);
    }
    progress('transcode');
    const output = path.join(directory, request.kind === 'video' ? 'clip.mp4' : 'clip.mp3');
    const duration = request.endSeconds - request.startSeconds;
    const localInput = file => ['-protocol_whitelist', 'file,pipe', '-ss', String(request.startSeconds), '-i', file];
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-threads', '2',
      ...localInput(request.kind === 'video' ? sourceVideo : sourceAudio),
      ...(request.kind === 'video' ? localInput(sourceAudio) : []), '-t', String(duration), '-map_metadata', '-1', '-map_chapters', '-1',
      ...(request.kind === 'video' ? ['-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']
        : ['-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '192k']),
      '-ac', '2', '-threads', '2', '-fs', String(clipLimits.outputBytes), output];
    await execute('ffmpeg', args);
    const size = await checkedFile(output, directory, clipLimits.outputBytes, 'output-too-large');
    progress('verify');
    const probe = parseProbe((await execute('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe',
      '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,channels,width,height', '-of', 'json', output])).stdout);
    const durationSeconds = validateProbe(probe, request.kind === 'video' ? 'video-audio' : 'audio', duration, true);
    if (now() - startedAt >= config.deadlineMs) throw failure('deadline-exceeded');
    for (const [, file] of sources) await unlink(file);
    progress('ready');
    return { path: output, directory, contentType: request.kind === 'video' ? 'video/mp4' : 'audio/mpeg',
      size, durationSeconds, sourceBytes, versions, cleanup };
  } catch (error) {
    await cleanup();
    const safe = error instanceof ClipError ? error : failure('process-failed');
    safe.phase = phase;
    if (activeTool) safe.tool = activeTool;
    throw safe;
  }
}
