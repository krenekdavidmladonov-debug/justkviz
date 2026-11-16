import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const mib = bytes => bytes == null ? null : Math.round(bytes / (1024 * 1024) * 10) / 10;

export function summarizeCapacityDurations(rawDurationsMs, failures = 0) {
  if (!Number.isInteger(failures) || failures < 0 || rawDurationsMs.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid observed duration.');
  const sorted = [...rawDurationsMs].sort((a, b) => a - b), count = sorted.length;
  const median = count ? count % 2 ? sorted[Math.floor(count / 2)] : (sorted[count / 2 - 1] + sorted[count / 2]) / 2 : null;
  return { n: count, medianMs: median, p95Ms: count ? sorted[Math.ceil(count * .95) - 1] : null,
    maxMs: count ? sorted.at(-1) : null, failures, rawDurationsMs };
}

/** Only numeric process IDs returned by THIS browser's CDP session reach PowerShell. */
export async function observeCapacityMemory(browser) {
  const session = await browser.newBrowserCDPSession();
  const samples = [];
  const started = performance.now();
  let phase = 'baseline', busy = false, stopped = false, failedSamples = 0, churnSamples = 0, pending = Promise.resolve();
  const ownedProcessIds = async () => {
    const info = await session.send('SystemInfo.getProcessInfo');
    const ids = [...new Set(info.processInfo.map(process => process.id))].sort((a, b) => a - b);
    if (!ids.length || ids.length > 128 || !ids.every(id => Number.isSafeInteger(id) && id > 0 && id <= 0xffffffff)) throw new Error('Invalid owned process IDs.');
    return ids;
  };
  const sample = async () => {
    busy = true;
    const samplePhase = phase;
    try {
      const ids = await ownedProcessIds();
      const command = `$capacityOwnedProcesses = @(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue); [pscustomobject]@{ count = $capacityOwnedProcesses.Count; workingSetBytes = [double](($capacityOwnedProcesses | Measure-Object -Property WorkingSet64 -Sum).Sum); privateBytes = [double](($capacityOwnedProcesses | Measure-Object -Property PrivateMemorySize64 -Sum).Sum) } | ConvertTo-Json -Compress`;
      const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024,
      });
      const value = JSON.parse(stdout.trim());
      if (!Number.isInteger(value.count) || value.count < 0 || value.count > ids.length) throw new Error('Invalid owned process count.');
      const after = await ownedProcessIds();
      if (value.count !== ids.length || after.length !== ids.length || after.some((id, index) => id !== ids[index])) {
        churnSamples++;
        return;
      }
      if (!Number.isSafeInteger(value.workingSetBytes) || value.workingSetBytes <= 0
        || !Number.isSafeInteger(value.privateBytes) || value.privateBytes <= 0) throw new Error('Invalid owned memory sample.');
      samples.push({ elapsedMs: Math.round(performance.now() - started), phase: samplePhase,
        processCount: value.count, workingSetBytes: value.workingSetBytes, privateBytes: value.privateBytes });
    } catch {
      failedSamples++;
    } finally {
      busy = false;
    }
  };
  await sample();
  const interval = setInterval(() => {
    if (!busy && !stopped) pending = sample();
  }, 1000);
  return {
    phase(value) { phase = value; },
    async finish() {
      stopped = true; clearInterval(interval); await pending;
      await sample(); await session.detach();
      const peakWorking = samples.length ? Math.max(...samples.map(sample => sample.workingSetBytes)) : null;
      const peakPrivate = samples.length ? Math.max(...samples.map(sample => sample.privateBytes)) : null;
      return { status: samples.length >= 2 ? 'MEASURED' : 'NOT_MEASURED', sampleIntervalMs: 1000, failedSamples, churnSamples,
        sampleCount: samples.length, baselineWorkingSetMiB: mib(samples[0]?.workingSetBytes),
        peakObservedWorkingSetMiB: mib(peakWorking), retainedWorkingSetMiB: mib(samples.at(-1)?.workingSetBytes),
        baselinePrivateMiB: mib(samples[0]?.privateBytes), peakObservedPrivateMiB: mib(peakPrivate),
        retainedPrivateMiB: mib(samples.at(-1)?.privateBytes), samples,
        scope: 'Only the CDP-identified process family of this Playwright Chromium. Samples with changed or missing processes are counted separately and discarded. WorkingSet64 sums can double-count shared pages. PrivateMemorySize64 is committed private memory, not resident RAM. Excludes Node/Firebase/PowerShell. One-second sampled peaks do not represent instantaneous maxima, forced-GC results, device RAM or physical projector/audio evidence.' };
    },
  };
}

export async function capacitySnapshot(context, page, label) {
  const session = await context.newCDPSession(page);
  try {
    await session.send('Performance.enable');
    const metrics = await session.send('Performance.getMetrics');
    const values = Object.fromEntries(metrics.metrics.filter(metric => ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'Documents'].includes(metric.name))
      .map(metric => [metric.name, metric.value]));
    const storage = await page.evaluate(async () => ({ persisted: await navigator.storage.persisted(), ...await navigator.storage.estimate() }));
    return { label, values, storage,
      scope: 'JS heap covers this renderer only; it excludes most Blob/ArrayBuffer/native decoder/GPU memory. Storage estimate is origin quota accounting, not total OS disk space.' };
  } finally {
    await session.detach();
  }
}
