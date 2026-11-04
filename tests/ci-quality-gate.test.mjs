import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8').replaceAll('\r\n','\n');
const gate=source.split('  quality-gate:')[1]?.split('\n  show-mode-acceptance:')[0]??'';
test('quality gate waits for every independently meaningful acceptance job',()=>{
  const needs=/needs: \[([^\]]+)\]/u.exec(gate)?.[1].split(',').map(x=>x.trim());
  assert.deepEqual(needs,['quality-core','editor-media-acceptance','show-mode-acceptance','oauth-windows','restart-recovery-acceptance','dependency-security']);
  for(const variable of ['CORE','EDITOR','SHOW','OAUTH','RECOVERY','SECURITY'])assert(gate.includes('test "$'+variable+'_RESULT" = success'));
  assert(gate.includes('always()'));
});
test('registry security audit is mandatory and preserves its actual exit',()=>{
  const security=source.split('\n  dependency-security:\n')[1]??'';
  assert(security.includes('pnpm audit --audit-level low --json'));
  assert(security.includes('security-audit.json'));
  assert(security.includes('if: ${{ always() }}'));
});
test('recovery gate has an actual demo-only recovery job and current browser campaign is exercised',()=>{
  assert(source.includes('\n  restart-recovery-acceptance:\n'));
  assert(source.includes('node tools/event-night/restart-acceptance.mjs --powershell'));
  assert(source.includes('--config tests/browser/extraordinary-stress.config.ts'));
});
