import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('the Functions entry point registers live and print endpoints without loading the PDF stack', async () => {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      assert.doesNotMatch(specifier, /^(?:pdf-lib|@pdf-lib\/fontkit|@fontsource\/noto-sans)(?:\/|$)/u);
      return nextResolve(specifier, context);
    },
  });
  try {
    const handlers = await import('../functions/lib/index.js');
    for (const name of ['generatePrintArtifact', 'revealAnswer', 'previewInterimResults', 'readRefereeEvent']) {
      assert.equal(handlers[name].__endpoint.platform, 'gcfv2');
    }
  } finally {
    hooks.deregister();
  }
});
