import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const pathFor = (file: string) => fileURLToPath(new URL(file, `file:///${root.replaceAll('\\', '/')}/`));
const read = (file: string) => readFileSync(pathFor(file), 'utf8');
const hasUtf8Bom = (file: string) => {
  const bytes = readFileSync(pathFor(file));
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
};

describe('tonight repair launcher safety contract', () => {
  const startCmd = read('tools/legacy/START_TONIGHT_REPAIR.cmd');
  const verifyCmd = read('tools/legacy/VERIFY_TONIGHT_GO_NO_GO.cmd');
  const common = read('tools/tonight-repair/TonightRepair.Common.ps1');
  const start = read('tools/tonight-repair/Start-TonightRepair.ps1');
  const verify = read('tools/tonight-repair/Verify-TonightGoNoGo.ps1');
  const repairCheck = read('tools/tonight-repair/repair-check.mjs');
  const goNoGo = read('tools/tonight-repair/verify-go-no-go.mjs');

  test('keeps one-click entrypoints thin and PowerShell 5 UTF-8 compatible', () => {
    expect(startCmd.trim().split(/\r?\n/u)).toEqual([
      '@echo off',
      'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\\tonight-repair\\Start-TonightRepair.ps1"',
      'exit /b %ERRORLEVEL%',
    ]);
    expect(verifyCmd).toContain('..\\tonight-repair\\Verify-TonightGoNoGo.ps1');
    for (const file of [
      'tools/tonight-repair/TonightRepair.Common.ps1',
      'tools/tonight-repair/Start-TonightRepair.ps1',
      'tools/tonight-repair/Verify-TonightGoNoGo.ps1',
    ]) expect(hasUtf8Bom(file), file).toBe(true);
  });

  test('pins all runtime work to localhost, demo Firebase, ignored reports and the existing snapshot', () => {
    const implementation = `${common}\n${start}\n${verify}\n${repairCheck}\n${goNoGo}`;
    expect(common).toContain("TonightRepairBaseUrl = 'http://localhost:5000'");
    expect(start).toContain("ProjectId = 'demo-filmovy-kviz-v2'");
    expect(start).toContain('Assert-EventNightSnapshot');
    expect(start).toMatch(/backup/iu);
    expect(start).toContain('New-EventNightBuildManifest');
    expect(start).toContain("if ($null -eq $recordedProcess)");
    expect(start).toContain('Remove-Item -LiteralPath $eventPaths.StatePath -Force');
    expect(common).toContain(".local-data\\tonight-repair");
    expect(implementation).not.toMatch(/firebase\s+deploy/iu);
    expect(implementation).not.toContain('filmovy-kviz.web.app');
    expect(implementation).not.toMatch(/service.?account/iu);
  });

  test('opens the staff repair route without auto-login and records only sanitized progress', () => {
    expect(start).toContain('/readiness/repair');
    expect(start).toContain('admin@example.test');
    expect(start).toContain('LocalQuiz123!');
    expect(start).not.toMatch(/signInWithEmailAndPassword/iu);
    expect(repairCheck).toContain('noDefaultSelection');
    expect(repairCheck).toContain('containsCorrectAnswers: false');
    expect(repairCheck).not.toMatch(/\.textContent/iu);
    expect(repairCheck).not.toMatch(/\.innerText/iu);
  });

  test('blocks live smoke until zero blockers and verifies required security boundaries', () => {
    expect(goNoGo).toContain("repairReport.readiness.blockers === 0");
    expect(goNoGo).toContain("invoke('createLiveSession'");
    expect(goNoGo).toContain("invoke('nextSlide'");
    expect(goNoGo).toContain("invoke('previousSlide'");
    expect(goNoGo).toContain("invoke('playMedia'");
    expect(goNoGo).toContain("invoke('selectRecapQuestion'");
    expect(goNoGo).toContain("invoke('revealAnswer'");
    expect(goNoGo).toContain('Question-mode AUDIO source was published');
    expect(goNoGo).toContain('Anonymous client unexpectedly read a private quiz');
    expect(verify).toContain('GO — V2 SOFTWARE READY FOR PHYSICAL CHECK');
    expect(verify).toContain('NO-GO — USE V1');
  });
});
