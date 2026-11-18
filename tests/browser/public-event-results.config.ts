import { defineConfig } from '@playwright/test';
function port(name:string):string {
  const endpoint=process.env[name];
  if (!endpoint || !/^127\.0\.0\.1:[1-9]\d{0,4}$/u.test(endpoint)) throw new Error(`Loopback emulator required: ${name}`);
  return endpoint.split(':')[1]!;
}
if (process.env.GCLOUD_PROJECT !== 'demo-filmovy-kviz-v2') throw new Error('Exact demo project required.');
export default defineConfig({
  testDir:'.', testMatch:'public-event-results.spec.mjs', workers:1, timeout:180000, expect:{ timeout:20000 }, reporter:[['line']],
  outputDir:'../../.local-data/a6-t11/browser-results',
  use:{ baseURL:'http://127.0.0.1:5789', trace:'off', screenshot:'off', video:'off', launchOptions:process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} },
  webServer:{ cwd:process.cwd(), command:'node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5789 --strictPort', url:'http://127.0.0.1:5789', reuseExistingServer:false,
    env:{ VITE_APP_ENV:'local', VITE_FIREBASE_API_KEY:'demo-api-key', VITE_FIREBASE_AUTH_DOMAIN:'demo-filmovy-kviz-v2.firebaseapp.com', VITE_FIREBASE_PROJECT_ID:'demo-filmovy-kviz-v2', VITE_FIREBASE_USE_EMULATORS:'true', VITE_FIREBASE_STORAGE_BUCKET:'demo-filmovy-kviz-v2.appspot.com', VITE_FIREBASE_MESSAGING_SENDER_ID:'000000000000', VITE_FIREBASE_APP_ID:'1:000000000000:web:demo', VITE_FIREBASE_EMULATOR_HOST:'127.0.0.1',
      VITE_FIREBASE_AUTH_EMULATOR_PORT:port('FIREBASE_AUTH_EMULATOR_HOST'), VITE_FIREBASE_FIRESTORE_EMULATOR_PORT:port('FIRESTORE_EMULATOR_HOST'), VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT:port('FUNCTIONS_EMULATOR_HOST'), VITE_FIREBASE_STORAGE_EMULATOR_PORT:port('FIREBASE_STORAGE_EMULATOR_HOST') } },
});
