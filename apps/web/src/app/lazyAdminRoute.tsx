import type { ComponentType } from 'react';
import type { Permission } from '@filmovy-kviz/quiz-domain';

// Load the module before committing navigation. Component-level Suspense would
// delay mounting the page (and starting its data reads) after showing a fallback.
export function lazyAdminRoute(load: () => Promise<ComponentType>, requires: readonly Permission[]) {
  return async () => {
    const [Page, { PermissionGate }] = await Promise.all([load(), import('../features/access/PermissionGate')]);
    function GuardedPage() {
      return <PermissionGate requires={requires}><Page /></PermissionGate>;
    }
    return { Component: GuardedPage };
  };
}
