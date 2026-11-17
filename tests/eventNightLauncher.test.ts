import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file: string) => readFileSync(
  fileURLToPath(new URL(file, `file:///${root.replaceAll('\\', '/')}/`)),
  'utf8',
);
const hasUtf8Bom = (file: string) => {
  const bytes = readFileSync(fileURLToPath(new URL(file, `file:///${root.replaceAll('\\', '/')}/`)));
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
};

describe('event-night launcher safety contract', () => {
  const startCmd = read('tools/legacy/START_EVENT_NIGHT.cmd');
  const stopCmd = read('tools/legacy/STOP_EVENT_NIGHT.cmd');
  const prepareCmd = read('tools/legacy/PREPARE_EVENT_NIGHT.cmd');
  const backupCmd = read('tools/legacy/BACKUP_EVENT_NIGHT.cmd');
  const fallbackCmd = read('tools/legacy/OPEN_V1_FALLBACK.cmd');
  const common = read('tools/event-night/EventNight.Common.ps1');
  const start = read('tools/event-night/Start-EventNight.ps1');
  const stop = read('tools/event-night/Stop-EventNight.ps1');
  const prepare = read('tools/event-night/Prepare-EventNight.ps1');
  const backup = read('tools/event-night/Backup-EventNight.ps1');
  const worker = read('tools/event-night/EventNight.Worker.ps1');

  test('keeps entrypoints thin and the V1 fallback inert until manual use', () => {
    expect(startCmd).toContain('..\\event-night\\Start-EventNight.ps1');
    expect(stopCmd).toContain('..\\event-night\\Stop-EventNight.ps1');
    expect(prepareCmd).toContain('..\\event-night\\Prepare-EventNight.ps1');
    expect(backupCmd).toContain('..\\event-night\\Backup-EventNight.ps1');
    expect(fallbackCmd.trim().split(/\r?\n/u)).toEqual([
      '@echo off',
      'start "" "https://filmovy-kviz.web.app/"',
    ]);
  });

  test('keeps PowerShell entrypoints UTF-8 compatible with Windows PowerShell 5', () => {
    for (const file of [
      'tools/event-night/Backup-EventNight.ps1',
      'tools/event-night/EventNight.Common.ps1',
      'tools/event-night/EventNight.Worker.ps1',
      'tools/event-night/Prepare-EventNight.ps1',
      'tools/event-night/Start-EventNight.ps1',
      'tools/event-night/Stop-EventNight.ps1',
      'tests/fixtures/event-night-recovery.ps1',
    ]) {
      expect(hasUtf8Bom(file), file).toBe(true);
    }
    const jsonReads = common.split(/\r?\n/u).filter((line) => line.includes('Get-Content'));
    expect(jsonReads.length).toBeGreaterThan(0);
    expect(jsonReads.every((line) => line.includes('-Encoding UTF8'))).toBe(true);
  });

  test('pins localhost demo Firebase and clears credential variables', () => {
    const implementation = `${common}\n${start}\n${stop}\n${prepare}\n${backup}\n${worker}`;
    expect(common).toContain("EventNightProjectId = 'demo-filmovy-kviz-v2'");
    expect(common).toContain("EventNightUrl = 'http://localhost:5000/admin/login'");
    expect(common).toContain("FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'");
    expect(common).toContain("FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'");
    expect(worker).toContain("$ProjectId -ne 'demo-filmovy-kviz-v2'");
    expect(worker).toContain("'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_CONFIG', 'FIREBASE_TOKEN'");
    expect(implementation).not.toMatch(/firebase\s+deploy/iu);
    expect(implementation).not.toMatch(/service.?account/iu);
  });

  test('separates one-time preparation from non-destructive normal start', () => {
    expect(prepare).toContain("@('seed:auth')");
    expect(prepare).toContain("@('migration:v1:emulator')");
    expect(start).not.toMatch(/seed:|migration:v1:emulator/iu);
    expect(start).toContain("Start-EventNightWorker -Mode 'Import'");
    expect(start).toContain('Restore-EventNightSnapshot');
    expect(prepare.indexOf('Assert-EventNightPromotionClear')).toBeLessThan(prepare.indexOf("@('seed:auth')"));
    expect(worker).toContain("'event-night:emulators'");
    expect(worker).toContain("'event-night:emulators:fresh'");
    expect(worker).toContain('$eventArguments = @(if (');
  });

  test('verifies manifests, backs up data, exports before stop, and tracks one owned worker', () => {
    expect(common).toContain('Assert-EventNightBuildManifest');
    expect(common).toContain('Assert-EventNightSnapshot');
    expect(common).toContain('Get-FileHash');
    expect(start).toContain('Backup-EventNightSnapshot');
    expect(stop.indexOf('Export-EventNightSnapshot')).toBeLessThan(stop.indexOf('Stop-EventNightWorker'));
    expect(backup).toContain('Export-EventNightSnapshot');
    expect(common).toContain('Test-EventNightWorker');
    expect(common).not.toMatch(/taskkill(?:\.exe)?\s+\/IM/iu);
    expect(common).not.toContain('[System.IO.Path]::GetRelativePath');
  });

  test('recovers interrupted promotion using real isolated PowerShell snapshots', () => {
    const script = fileURLToPath(new URL('./fixtures/event-night-recovery.ps1', import.meta.url));
    const commonPath = fileURLToPath(new URL('../tools/event-night/EventNight.Common.ps1', import.meta.url));
    const output = execFileSync(process.platform === 'win32' ? 'powershell.exe' : 'pwsh', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script, '-CommonPath', commonPath,
    ], { cwd: root, encoding: 'utf8', timeout: 90_000, windowsHide: true });
    expect(output).toContain('PASS: event-night recovery');
  }, 120_000);
});
