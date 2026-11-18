import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const runner = fileURLToPath(new URL('../tools/local-emulator-environment.mjs', import.meta.url));
const printEnvironment = [
  '-e',
  "process.stdout.write([process.env.FIREBASE_AUTH_EMULATOR_HOST,process.env.FIRESTORE_EMULATOR_HOST,process.env.FUNCTIONS_EMULATOR_HOST,process.env.GCLOUD_PROJECT].join('|'))",
];

describe('local emulator command environment', () => {
  test('keeps explicitly supplied non-default localhost ports', () => {
    const result = spawnSync(process.execPath, [runner, 'full', ...printEnvironment], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9399',
        FIRESTORE_EMULATOR_HOST: 'localhost:8380',
        FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5101',
        GCLOUD_PROJECT: 'demo-port-isolation',
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('127.0.0.1:9399|localhost:8380|127.0.0.1:5101|demo-port-isolation');
  });

  test('supplies safe defaults only when endpoints and project are absent', () => {
    const environment = { ...process.env };
    delete environment.FIREBASE_AUTH_EMULATOR_HOST;
    delete environment.FIRESTORE_EMULATOR_HOST;
    delete environment.FUNCTIONS_EMULATOR_HOST;
    delete environment.GCLOUD_PROJECT;
    delete environment.GOOGLE_CLOUD_PROJECT;
    const result = spawnSync(process.execPath, [runner, 'full', ...printEnvironment], {
      encoding: 'utf8', env: environment,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('127.0.0.1:9099|127.0.0.1:8080|127.0.0.1:5001|demo-filmovy-kviz-v2');
  });

  test('fails closed for a remote host or non-demo project', () => {
    const remote = spawnSync(process.execPath, [runner, 'full', ...printEnvironment], {
      encoding: 'utf8',
      env: { ...process.env, FIRESTORE_EMULATOR_HOST: 'firestore.example.test:443', GCLOUD_PROJECT: 'demo-safe' },
    });
    expect(remote.status).toBe(1);
    expect(remote.stderr).toContain('FIRESTORE_EMULATOR_HOST must use localhost');

    const production = spawnSync(process.execPath, [runner, 'full', ...printEnvironment], {
      encoding: 'utf8',
      env: { ...process.env, GCLOUD_PROJECT: 'production-project' },
    });
    expect(production.status).toBe(1);
    expect(production.stderr).toContain('requires a demo-* project ID');
  });
});

import { emulatorEndpoint } from '../apps/web/src/services/firebase/emulatorEndpoint';

test('browser emulator endpoints preserve custom ports and fail closed for non-demo or non-loopback targets', () => {
  expect(emulatorEndpoint('demo-isolation', 'FUNCTIONS', {})).toEqual({ host: '127.0.0.1', port: 5001, origin: 'http://127.0.0.1:5001' });
  expect(emulatorEndpoint('demo-isolation', 'AUTH', { VITE_FIREBASE_EMULATOR_HOST: 'localhost', VITE_FIREBASE_AUTH_EMULATOR_PORT: '9299' }))
    .toEqual({ host: 'localhost', port: 9299, origin: 'http://localhost:9299' });
  for (const project of [undefined, 'filmovy-kviz-v2-staging']) expect(() => emulatorEndpoint(project, 'STORAGE', {})).toThrow();
  for (const host of ['example.test', '127.0.0.1.example.test', 'http://localhost', '0.0.0.0', 'localhost/path']) {
    expect(() => emulatorEndpoint('demo-isolation', 'STORAGE', { VITE_FIREBASE_EMULATOR_HOST: host })).toThrow();
  }
  for (const port of ['', '0', '-1', '65536', '1.5', '5e3', ' 5001', '5001/path']) {
    expect(() => emulatorEndpoint('demo-isolation', 'FUNCTIONS', { VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: port })).toThrow();
  }
});
