const TARGET = Object.freeze({ projectId: 'filmovy-kviz-v2-staging', region: 'europe-west1', site: 'justkviz-v2' });
const FUNCTIONS = Object.freeze(['listAccessAudit', 'listAccessUsers']);
const BUNDLE_REQUIRED = ['lib/access/callables.js', 'lib/index.js', 'package.json', 'package-lock.json'];
const BUNDLE_CHANGED = ['lib/access/callables.js'];
const WEB_CHANGED = ['apps/web/src/features/access/api.ts', 'apps/web/src/routes/admin/UsersAccessPage.tsx'];
const fail = message => { throw new TypeError(message); };

// Inspect data properties before reading values: plans are inert input, not executable hooks.
function dictionary(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain dictionary`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
      || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail(`${label} has an unsafe property`);
  }
  return value;
}

function exactKeys(value, required, optional, label) {
  dictionary(value, label);
  if (required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail(`${label} has unexpected or missing fields`);
}

function manifest(value, label) {
  dictionary(value, label);
  if (!Object.keys(value).length) fail(`${label} must not be empty`);
  const names = new Set();
  for (const [name, hash] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_.@+-]+(?:\/[A-Za-z0-9_.@+-]+)*$/u.test(name)
      || name.split('/').some(part => part === '.' || part === '..') || names.has(name.toLowerCase())
      || typeof hash !== 'string' || !/^[a-f0-9]{64}$/u.test(hash)) {
      fail(`${label} contains an invalid canonical path or SHA-256`);
    }
    names.add(name.toLowerCase());
  }
  return value;
}

function diff(baseline, candidate, label) {
  manifest(baseline, `${label} baseline`); manifest(candidate, `${label} candidate`);
  const before = Object.keys(baseline).sort(), after = Object.keys(candidate).sort();
  if (before.length !== after.length || before.some((name, index) => name !== after[index])) fail(`${label} file inventory changed`);
  return before.filter(name => baseline[name] !== candidate[name]);
}

function exactChanges(actual, expected, label) {
  if (actual.length !== expected.length || expected.some(name => !actual.includes(name))) fail(`${label} changes exceed or omit the reviewed fix`);
}

/** Pure offline scope validation. Successful validation never authorizes a release. */
export function validateAccessHotfix(input) {
  exactKeys(input, ['projectId', 'region', 'site', 'functions', 'baselineEntries', 'candidateEntries'], ['hostingSources'], 'Hotfix plan');
  for (const [name, expected] of Object.entries(TARGET)) if (input[name] !== expected) fail(`Unexpected ${name}`);
  const functions = input.functions;
  if (!Array.isArray(functions) || Object.getPrototypeOf(functions) !== Array.prototype || functions.length !== FUNCTIONS.length
    || Reflect.ownKeys(functions).length !== FUNCTIONS.length + 1
    || FUNCTIONS.some((_name, index) => !Object.hasOwn(functions, index) || !Object.hasOwn(Object.getOwnPropertyDescriptor(functions, index), 'value'))) {
    fail('Functions must contain exactly the two reviewed callables');
  }
  if (FUNCTIONS.some(name => functions.filter(item => item === name).length !== 1)) fail('Functions must contain exactly the two reviewed callables');

  const bundleChanges = diff(input.baselineEntries, input.candidateEntries, 'Functions bundle');
  if (BUNDLE_REQUIRED.some(name => !Object.hasOwn(input.baselineEntries, name))) fail('Functions bundle lacks required entry points or dependency manifests');
  exactChanges(bundleChanges, BUNDLE_CHANGED, 'Functions bundle');

  let webChanges = [];
  if (Object.hasOwn(input, 'hostingSources')) {
    exactKeys(input.hostingSources, ['baseline', 'candidate'], [], 'Hosting sources');
    webChanges = diff(input.hostingSources.baseline, input.hostingSources.candidate, 'Hosting sources');
    exactChanges(webChanges, WEB_CHANGED, 'Hosting sources');
  }
  return Object.freeze({
    approved: false,
    target: TARGET,
    resources: Object.freeze({ functions: FUNCTIONS, hosting: Object.hasOwn(input, 'hostingSources') }),
    changes: Object.freeze({ functions: Object.freeze(bundleChanges), hosting: Object.freeze(webChanges) }),
  });
}
