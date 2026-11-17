import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { renderEventPreview } from './preview-meta.js';

if (!getApps().length) initializeApp();

function indexUrl(): string | undefined {
  const project = getApp().options.projectId ?? process.env.GCLOUD_PROJECT;
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const loopback = /^(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/u.exec(firestoreHost ?? '');
    if (project?.startsWith('demo-') && loopback && Number(loopback[1]) > 0 && Number(loopback[1]) <= 65535) {
      return 'http://127.0.0.1:5000/index.html';
    }
  } else if (project === 'filmovy-kviz-v2-staging' && !firestoreHost) {
    return 'https://justkviz-v2.web.app/index.html';
  }
  return undefined;
}

async function loadIndex(url: string): Promise<string> {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(4_000) });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('text/html')) throw new Error('Hosting index unavailable');
  return response.text();
}

export const servePublicEventMeta = onRequest({
  region: 'europe-west1', invoker: 'public', cors: false,
  memory: '256MiB', maxInstances: 3, timeoutSeconds: 10,
}, async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const eventId = /^\/events\/([A-Za-z0-9_-]{1,1500})$/u.exec(request.path)?.[1];
  if (!eventId) { response.sendStatus(404); return; }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.set('Allow', 'GET, HEAD').sendStatus(405);
    return;
  }
  const url = indexUrl();
  if (!url) { response.sendStatus(503); return; }

  const event = getFirestore().collection('publicEvents').doc(eventId).get()
    .then(snapshot => ({ available: true, data: snapshot.data() }))
    .catch(() => ({ available: false, data: undefined }));

  const html = await loadIndex(url).catch(() => undefined);
  if (html === undefined) {
    // The trailing slash takes the static SPA rewrite and avoids calling this function again.
    const search = new URL(request.originalUrl, url).search;
    response.redirect(302, '/events/' + eventId + '/' + search);
    return;
  }
  const { available, data } = await event;
  if (available) response.set('Cache-Control', 'public, max-age=0, s-maxage=600');
  response.type('html').send(renderEventPreview(html, eventId, data));
});
