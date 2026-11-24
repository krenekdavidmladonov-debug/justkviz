import { createRequire } from 'node:module';
import { assertStagingProject, STAGING_PROJECT } from './guard.mjs';

const require = createRequire(import.meta.url);
const cli = (name) => require(`firebase-tools/lib/${name}`);

// Reuse the operator's Firebase CLI OAuth session in memory; never export a key.
export async function stagingClient(origin, version) {
  assertStagingProject(STAGING_PROJECT);
  if (!['https://firebase.googleapis.com', 'https://identitytoolkit.googleapis.com', 'https://firestore.googleapis.com', 'https://firebasehosting.googleapis.com', 'https://cloudfunctions.googleapis.com'].includes(origin)) {
    throw new Error('Cloud API origin is not allowlisted.');
  }
  const account = cli('auth').getGlobalDefaultAccount();
  if (!account) throw new Error('Run firebase login first.');
  await cli('requireAuth').requireAuth({ project: STAGING_PROJECT, ...account, nonInteractive: true });
  return new (cli('apiv2').Client)({ urlPrefix: origin, apiVersion: version });
}

export async function stagingWebConfig() {
  const client = await stagingClient('https://firebase.googleapis.com', 'v1beta1');
  const { STAGING_APP } = await import('./guard.mjs');
  const response = await client.get(`projects/${STAGING_PROJECT}/webApps/${STAGING_APP}/config`);
  assertStagingProject(response.body.projectId);
  return response.body;
}
