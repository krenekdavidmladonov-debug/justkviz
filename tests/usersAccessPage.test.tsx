// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { permissions, type Membership } from '../packages/quiz-domain/src/access';
import { UsersAccessPage } from '../apps/web/src/routes/admin/UsersAccessPage';
import { accessCall, privateRead } from '../apps/web/src/features/access/api';

const auth = vi.hoisted(() => ({ member: null as Membership | null }));
vi.mock('../apps/web/src/auth/AuthProvider', () => ({ useAuth: () => ({ membership: auth.member, can: (permission: string) => auth.member?.status === 'active' && auth.member.permissions.includes(permission as never) }) }));
vi.mock('../apps/web/src/features/access/api', () => ({ accessCall: vi.fn(), privateRead: vi.fn() }));
vi.mock('../apps/web/src/services/firebase/config', () => ({ readFirebaseConfig: () => ({ options: { projectId: 'demo-access' }, useEmulators: true }) }));
let host: HTMLDivElement, root: Root;
const member = (uid = 'owner'): Membership => ({ uid, email: `${uid}@example.test`, displayName: uid, status: 'active', version: 1, sessionValidAfter: 0, role: 'owner', permissions: [...permissions], quizzes: { mode: 'all', ids: [] }, events: { mode: 'all', ids: [] } });
const overview = (enabled = true, uid = 'person') => ({ users: [{ ...member(uid), lastLoginAt: null, emailVerified: true }], invitations: [], collaborationEnabled: enabled });
const button = (label: string) => [...host.querySelectorAll('button')].find(item => item.textContent === label)!;
async function render() { await act(async () => root.render(<UsersAccessPage />)); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); auth.member = member();
  vi.mocked(privateRead).mockReset().mockResolvedValue([]);
  vi.mocked(accessCall).mockReset().mockImplementation(async name => name === 'listAccessUsers' ? overview() : []);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('shows available members even when the independent audit fails', async () => {
  vi.mocked(accessCall).mockImplementation(async name => {
    if (name === 'listAccessAudit') throw Object.assign(new Error('Audit unavailable'), { code: 'functions/internal' });
    return overview();
  });
  await render();
  expect(host.querySelector('tbody')?.textContent).toContain('person@example.test');
  expect(host.textContent).toContain('listAccessAudit'); expect(host.textContent).toContain('functions/internal');
});

it('shows members before an audit response arrives', async () => {
  vi.mocked(accessCall).mockImplementation(name => name === 'listAccessAudit' ? new Promise(() => {}) : Promise.resolve(overview()));
  await render(); expect(host.querySelector('tbody')?.textContent).toContain('person@example.test');
});

it('does not claim an empty list before users finish loading', async () => {
  vi.mocked(accessCall).mockImplementation(name => name === 'listAccessUsers' ? new Promise(() => {}) : Promise.resolve([]));
  await render(); expect(host.textContent).not.toContain('Žádné odpovídající účty.'); expect(host.textContent).toContain('Načítám uživatele');
});

it('preserves filters and an open grant editor when users are retried', async () => {
  await render(); await act(async () => button('Pozvat člověka').click());
  const filter = host.querySelector<HTMLInputElement>('input[type=search]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(filter, 'person'); filter.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => button('Znovu načíst uživatele').click());
  expect(host.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('person');
  expect(host.querySelector('.access-editor')).not.toBeNull();
});

it('keeps signup separate from membership and disables invitation creation until activation', async () => {
  vi.mocked(accessCall).mockImplementation(async name => name === 'listAccessUsers' ? overview(false) : []);
  await render(); expect(button('Pozvat člověka').disabled).toBe(true);
  expect(host.textContent).toContain('Samotná registrace'); expect(host.textContent).toContain('aktivace');
});

it('ignores responses for a prior identity even with the same membership version', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(accessCall).mockImplementation(name => name === 'listAccessUsers' ? new Promise(done => { resolve = done; }) : Promise.resolve([]));
  await render(); const oldResolve = resolve;
  auth.member = member('other-owner'); await render();
  await act(async () => oldResolve(overview(true, 'old-private-person')));
  expect(host.textContent).not.toContain('old-private-person');
  await act(async () => resolve(overview(true, 'new-person')));
  expect(host.textContent).toContain('new-person@example.test');
});

it('does not read access data for suspended or unauthorized members', async () => {
  auth.member = { ...member(), status: 'suspended' }; await render();
  expect(accessCall).not.toHaveBeenCalled(); expect(host.textContent).toContain('nemáte oprávnění');
});

it('does not represent a failed users request as an empty member list', async () => {
  vi.mocked(accessCall).mockImplementation(async name => {
    if (name === 'listAccessUsers') throw Object.assign(new Error('Denied'), { code: 'functions/permission-denied' });
    return [];
  });
  await render(); expect(host.textContent).toContain('listAccessUsers'); expect(host.textContent).toContain('functions/permission-denied');
  expect(host.textContent).not.toContain('Žádné odpovídající účty.'); expect(button('Pozvat člověka').disabled).toBe(true);
});

it('supersedes a stalled users request and ignores its delayed result', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(accessCall).mockImplementation(name => name === 'listAccessUsers' ? new Promise(done => { resolve = done; }) : Promise.resolve([]));
  await render(); const oldResolve = resolve;
  await act(async () => button('Znovu načíst uživatele').click());
  await act(async () => resolve(overview(true, 'current-person')));
  await act(async () => oldResolve(overview(true, 'stale-person')));
  expect(host.textContent).toContain('current-person@example.test'); expect(host.textContent).not.toContain('stale-person');
});

it('clears protected member details on an authorization denial during retry', async () => {
  await render(); expect(host.textContent).toContain('person@example.test');
  vi.mocked(accessCall).mockRejectedValue(Object.assign(new Error('Denied'), { code: 'functions/permission-denied' }));
  await act(async () => button('Znovu načíst uživatele').click());
  expect(host.textContent).not.toContain('person@example.test'); expect(host.textContent).toContain('functions/permission-denied');
});

it('renders a legacy audit record with missing time and malformed grant without crashing', async () => {
  vi.mocked(accessCall).mockImplementation(async name => name === 'listAccessUsers' ? overview() : [{
    id: 'legacy', kind: 'membership-changed', actorUid: 'owner', targetId: 'person', at: null,
    changes: { before: { role: 'viewer', permissions: [] }, after: { role: 'bad', permissions: null } },
  }]);
  await render(); expect(host.textContent).toContain('person@example.test'); expect(host.textContent).toContain('Čas není k dispozici');
  expect(host.textContent).toContain('podrobnosti staršího záznamu nejsou dostupné');
});

it('retries audit independently without fetching members or resetting the editor', async () => {
  await render(); await act(async () => button('Pozvat člověka').click());
  const usersCalls = vi.mocked(accessCall).mock.calls.filter(([name]) => name === 'listAccessUsers').length;
  await act(async () => button('Znovu načíst historii').click());
  expect(vi.mocked(accessCall).mock.calls.filter(([name]) => name === 'listAccessUsers')).toHaveLength(usersCalls);
  expect(host.querySelector('.access-editor')).not.toBeNull(); expect(host.textContent).toContain('person@example.test');
});

it('clears audit and rejects a delayed audit response after a users authorization denial', async () => {
  const audit = [{ id: 'private-audit', kind: 'private-marker', actorUid: 'owner', targetId: 'person', at: null, changes: {} }];
  vi.mocked(accessCall).mockImplementation(async name => name === 'listAccessUsers' ? overview() : audit);
  await render(); expect(host.querySelector('details')).not.toBeNull();
  let resolve!: (value: unknown) => void;
  vi.mocked(accessCall).mockImplementation(name => name === 'listAccessAudit'
    ? new Promise(done => { resolve = done; })
    : Promise.reject(Object.assign(new Error('Denied'), { code: 'functions/permission-denied' })));
  await act(async () => button('Znovu načíst historii').click());
  await act(async () => button('Znovu načíst uživatele').click());
  expect(host.querySelector('details')).toBeNull();
  await act(async () => resolve(audit)); expect(host.querySelector('details')).toBeNull();
});

it('keeps a successfully created invitation link when the subsequent users refresh fails', async () => {
  await render(); await act(async () => button('Pozvat člověka').click());
  const input = host.querySelector<HTMLInputElement>('.access-editor input[type=email]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'new@example.test'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  vi.mocked(accessCall).mockImplementation(async name => {
    if (name === 'createAccessInvitation') return { inviteId: 'synthetic-invite', token: 'synthetic-token' };
    if (name === 'listAccessUsers') throw Object.assign(new Error('Unavailable'), { code: 'functions/unavailable' });
    return [];
  });
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(host.textContent).toContain('Pozvánka je připravená');
  const link = host.querySelector<HTMLInputElement>('input[readonly]')!.value;
  expect(link).toContain('synthetic-invite'); expect(link).toContain('synthetic-token');
  await act(async () => button('Znovu načíst uživatele').click());
  expect(host.querySelector<HTMLInputElement>('input[readonly]')!.value).toBe(link);
});
