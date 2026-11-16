import { isDeepStrictEqual } from 'node:util';
import { PROJECT, USERS, demand, qaPlan } from './restart-qa-core.mjs';

const metadataFields = 'users(localId,email,emailVerified,disabled,createdAt)';
const quiet = () => ({ retries: 0, skipLog: { body: true, resBody: true, queryParams: true } });
const status = error => Number(error.status ?? error.context?.response?.statusCode);

// Injected clients keep all tests offline. Nothing authenticates on import.
export function qaStore(inputPlan, clients) {
  const plan = qaPlan(inputPlan.approval);
  demand(isDeepStrictEqual(inputPlan, plan), 'ALTERED_QA_PLAN');
  const allowedNames = new Set([plan.controlName, plan.auditName, ...plan.memberships.map(member => member.name)]);
  const authPrefix = `projects/${PROJECT}`;
  async function lookup(body, projection) {
    try {
      const result = await clients.auth.post(`${authPrefix}/accounts:lookup`, body, { ...quiet(), queryParams: { fields: projection } });
      demand(result.body && (result.body.users === undefined || Array.isArray(result.body.users)), 'INVALID_AUTH_METADATA_RESPONSE');
      return result.body.users ?? [];
    } catch { throw new Error('QA_AUTH_METADATA_REQUEST_FAILED'); }
  }
  return {
    async read(name) {
      demand(allowedNames.has(name), 'READ_OUTSIDE_QA_PLAN');
      try { return (await clients.firestore.get(name, quiet())).body; }
      catch (error) {
        if (status(error) === 404) return null;
        // Deliberately discard cause: CLI errors can contain credential-bearing payloads.
        // eslint-disable-next-line preserve-caught-error
        throw new Error('QA_FIRESTORE_READ_FAILED');
      }
    },
    async identitiesAbsent() {
      const uids = await lookup({ localId: USERS.map(user => user.uid) }, 'users(localId)');
      const emails = await lookup({ email: USERS.map(user => user.email) }, 'users(localId)');
      return uids.length === 0 && emails.length === 0;
    },
    async readAuth(uid) {
      demand(USERS.some(user => user.uid === uid), 'FOREIGN_AUTH_UID');
      const users = await lookup({ localId: [uid] }, metadataFields);
      demand(users.length <= 1 && (!users.length || users[0].localId === uid), 'FOREIGN_AUTH_RESPONSE');
      return users[0] ?? null;
    },
    async createAuth(uid, password) {
      const expected = USERS.find(user => user.uid === uid);
      demand(expected && typeof password === 'string' && password.length >= 40 && password.length <= 128, 'INVALID_AUTH_CREATE_SCOPE');
      try { return (await clients.auth.post(`${authPrefix}/accounts`, { localId: uid, email: expected.email, password, emailVerified: true,
        displayName: `QA ${plan.approval.qaRunId} ${expected.slot}` }, { ...quiet(), queryParams: { fields: 'localId' } })).body; }
      catch { throw new Error('QA_AUTH_CREATE_OUTCOME_UNCONFIRMED'); }
    },
    async commit(writes) {
      demand(isDeepStrictEqual(writes, plan.writes), 'WRITE_OUTSIDE_EXACT_QA_PLAN');
      try { return await clients.firestore.post(`projects/${PROJECT}/databases/(default)/documents:commit`, { writes }, quiet()); }
      catch { throw new Error('QA_FIRESTORE_COMMIT_OUTCOME_UNCONFIRMED'); }
    },
  };
}

export async function connectQaStore(plan, cli) {
  demand(cli('package').version === '15.34.2', 'PINNED_CLI_REQUIRED');
  const account = cli('auth').getGlobalDefaultAccount();
  demand(account?.user?.email === plan.approval.operatorEmail, 'REVIEWED_CLI_OPERATOR_REQUIRED');
  let authenticatedEmail;
  try { authenticatedEmail = await cli('requireAuth').requireAuth({ project: PROJECT, ...account, nonInteractive: true }, true); }
  catch { throw new Error('CLI_OPERATOR_AUTHENTICATION_FAILED'); }
  demand(authenticatedEmail === plan.approval.operatorEmail, 'ADC_OR_OTHER_OPERATOR_DENIED');
  const Client = cli('apiv2').Client;
  return qaStore(plan, { firestore: new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' }),
    auth: new Client({ urlPrefix: 'https://identitytoolkit.googleapis.com', apiVersion: 'v1' }) });
}
