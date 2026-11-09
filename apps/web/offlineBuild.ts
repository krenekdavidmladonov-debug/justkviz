import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Inventory the actual written artifact after Vite removes CSS-only JS chunks. */
export function offlineBuild(): Plugin {
  return {
    name: 'justkviz-offline-shell',
    apply: 'build',
    writeBundle(output) {
      if (!output.dir) throw new Error('Offline shell requires a directory build output.');
      const directory = resolve(output.dir);
      // This installable app belongs to the demo build, not Vite's shared public files.
      writeFileSync(join(directory, 'offline.webmanifest'), JSON.stringify({
        name: 'JustKvíz Offline', short_name: 'JustKvíz', id: '/offline.html', start_url: '/offline.html',
        scope: '/offline.html', display: 'standalone', background_color: '#10131a', theme_color: '#10131a',
        icons: [{ src: '/brand/justkviz-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      }) + '\n');
      const relativeFiles: string[] = [];
      const visit = (current: string, prefix: string) => {
        for (const name of readdirSync(current).sort()) {
          const filename = join(current, name);
          const metadata = lstatSync(filename);
          if (metadata.isSymbolicLink()) throw new Error('Offline shell cannot include symbolic links.');
          if (metadata.isDirectory()) {
            visit(filename, prefix + name + '/');
          } else if (metadata.isFile()) {
            const relative = prefix + name;
            const staticAsset = /\.(?:js|css|svg|png|jpe?g|webp|ico|woff2?|ttf|otf|webmanifest)$/iu.test(relative);
            if (relative !== 'offline-sw.js' && (relative === 'offline.html' || staticAsset)) relativeFiles.push(relative);
          }
        }
      };
      visit(directory, '');
      relativeFiles.sort();
      if (!relativeFiles.includes('offline.html')) throw new Error('Offline HTML is missing from the final artifact.');

      const digest = createHash('sha256');
      for (const relative of relativeFiles) {
        const filename = join(directory, relative);
        if (!lstatSync(filename).isFile()) throw new Error('Offline shell inventory contains a missing file.');
        const bytes = readFileSync(filename);
        digest.update(relative).update('\0').update(String(bytes.length)).update('\0').update(bytes);
      }
      const version = 'justkviz-offline-' + digest.digest('hex').slice(0, 20);
      const files = relativeFiles.map(relative => '/' + relative.split('/').map(encodeURIComponent).join('/'));
      const source = `const VERSION=${JSON.stringify(version)};const FILES=${JSON.stringify(files)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_OFFLINE_SHELL') {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === 'VERIFY_OFFLINE_SHELL' && event.ports[0]) {
    event.waitUntil((async () => {
      const cache = await caches.open(VERSION);
      const responses = await Promise.all(FILES.map(path => cache.match(path)));
      event.ports[0].postMessage({ type: 'offline-shell-proof', version: VERSION, ready: responses.every(Boolean) });
      event.ports[0].close();
    })());
  }
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/offline.html') {
    event.respondWith(caches.open(VERSION).then(cache => cache.match('/offline.html')).then(response => {
      if (!response) return new Response('Offline aplikace není připravená.', { status: 503 });
      if (url.searchParams.has('offlineSelfTest')) {
        const headers = new Headers(response.headers);
        headers.set('Content-Security-Policy', "connect-src 'none'; object-src 'none'; base-uri 'none'");
        return new Response(response.body, { status: response.status, headers });
      }
      return response;
    }));
    return;
  }
  if (FILES.includes(url.pathname)) {
    event.respondWith(caches.open(VERSION).then(cache => cache.match(url.pathname))
      .then(response => response || new Response('', { status: 503 })));
  }
});`;
      // writeBundle runs after final names and bytes exist. The worker does not
      // cache/hash itself, source maps, API responses, private files or index.html.
      writeFileSync(join(directory, 'offline-sw.js'), source);
    },
  };
}
