import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { defineConfig } = require('vite');
export default defineConfig({ root: fileURLToPath(new URL('../..', import.meta.url)), esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 5574, strictPort: true } });
