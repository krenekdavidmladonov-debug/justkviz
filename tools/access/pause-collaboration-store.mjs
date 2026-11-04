import assert from 'node:assert/strict';

// The CLI module loader is injected so account attribution and transport options
// can be tested without opening credentials or making a request.
export async function connectPauseStore(plan, cli) {
  assert.equal(plan.approval.projectId, 'filmovy-kviz-v2-staging');
  assert.equal(cli('package').version, '15.34.2', 'Review Firebase CLI adapter before changing its version');
  const account = cli('auth').getGlobalDefaultAccount();
  assert.equal(account?.user?.email, plan.approval.operatorEmail, 'Operator account differs from reviewed approval');
  const authenticatedEmail = await cli('requireAuth').requireAuth({ project: plan.approval.projectId, ...account, nonInteractive: true }, true);
  assert.equal(authenticatedEmail, plan.approval.operatorEmail, 'Signed-in operator required; no ADC fallback');
  const client = new (cli('apiv2').Client)({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
  return pauseStore(plan, client);
}

export function pauseStore(plan, client) {
  return {
    async read(name) {
      assert([plan.controlName, plan.auditName].includes(name), 'Read outside reviewed operation');
      try { return (await client.get(name)).body; }
      catch (error) { if (Number(error.status ?? error.context?.response?.statusCode) === 404) return null; throw error; }
    },
    async commit(writes) {
      assert.deepEqual(writes, plan.writes);
      return client.post(`projects/${plan.approval.projectId}/databases/(default)/documents:commit`, { writes }, { retries: 0 });
    },
  };
}
