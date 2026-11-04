/** Roles are editable presets. Only current permissions AND resource scope grant access. */
export const permissionLabels = {
  'quiz.read': 'Číst kvízy', 'quiz.create': 'Vytvářet kvízy', 'quiz.edit': 'Upravovat strukturu a zadání',
  'quiz.answers.read': 'Číst odpovědi kvízu', 'quiz.answers.edit': 'Upravovat odpovědi',
  'quiz.notes.read': 'Číst poznámky moderátora', 'quiz.notes.edit': 'Upravovat poznámky',
  'quiz.delete': 'Mazat obsah kvízu', 'quiz.media.upload': 'Nahrávat média', 'quiz.media.attach': 'Připojovat média',
  'quiz.export': 'Exportovat kvízy', 'event.read': 'Číst akce', 'event.create': 'Vytvářet akce',
  'event.manage': 'Spravovat akce a týmy', 'event.delete': 'Trvale mazat akce z koše', 'event.live': 'Ovládat živé promítání',
  'event.score': 'Zapisovat skóre', 'event.contacts': 'Číst kontakty týmů',
  'event.answers.read': 'Číst odpovědi uzamčené akce', 'event.notes.read': 'Číst poznámky uzamčené akce',
  'event.export': 'Exportovat podklady akce', 'event.answers.export': 'Exportovat klíč odpovědí akce', 'users.manage': 'Spravovat uživatele a pozvánky',
} as const;
export type Permission = keyof typeof permissionLabels;
export const permissions = Object.keys(permissionLabels) as Permission[];
export const roleLabels = { owner: 'Vlastník', manager: 'Správce', creator: 'Tvůrce kvízů', moderator: 'Moderátor', referee: 'Rozhodčí', viewer: 'Pouze náhled' } as const;
export type AccessRole = keyof typeof roleLabels;
export type AccessScope = { mode: 'none' | 'own' | 'selected' | 'all'; ids: string[] };
export interface AccessGrant { role: AccessRole; permissions: Permission[]; quizzes: AccessScope; events: AccessScope }
export interface Membership extends AccessGrant {
  uid: string; status: 'active' | 'suspended'; version: number; sessionValidAfter: number;
  displayName: string; email: string;
}
export const rolePresets: Record<AccessRole, readonly Permission[]> = {
  owner: permissions,
  manager: permissions.filter(p => p !== 'event.delete'),
  creator: permissions.filter(p => p.startsWith('quiz.') && p !== 'quiz.delete'),
  moderator: ['event.read', 'event.live', 'event.answers.read', 'event.notes.read', 'event.export'],
  referee: ['event.read', 'event.score'],
  viewer: ['quiz.read', 'event.read'],
};
export const permissionDependencies: Partial<Record<Permission, readonly Permission[]>> = {
  'quiz.create': ['quiz.read'], 'quiz.edit': ['quiz.read'], 'quiz.answers.read': ['quiz.read'],
  'quiz.answers.edit': ['quiz.answers.read', 'quiz.edit'], 'quiz.notes.read': ['quiz.read'],
  'quiz.notes.edit': ['quiz.notes.read', 'quiz.edit'], 'quiz.delete': ['quiz.edit'],
  'quiz.media.upload': ['quiz.read'], 'quiz.media.attach': ['quiz.edit'], 'quiz.export': ['quiz.read'],
  'event.create': ['event.read'], 'event.manage': ['event.read'], 'event.delete': ['event.read'], 'event.live': ['event.read'],
  'event.score': ['event.read'], 'event.contacts': ['event.read'], 'event.answers.read': ['event.read'],
  'event.notes.read': ['event.read'], 'event.export': ['event.read'], 'event.answers.export': ['event.export', 'event.answers.read'],
};
export function grantErrors(grant: AccessGrant): string[] {
  const errors: string[] = [];
  for (const permission of grant.permissions) for (const dependency of permissionDependencies[permission] ?? []) {
    if (!grant.permissions.includes(dependency)) errors.push(`${permissionLabels[permission]} vyžaduje: ${permissionLabels[dependency]}.`);
  }
  return errors;
}
export function scopeAllows(scope: AccessScope, id: string, uid: string, createdBy?: unknown): boolean {
  return scope.mode === 'all' || (scope.mode === 'own' && createdBy === uid) || (scope.mode === 'selected' && scope.ids.includes(id));
}
/** Own resources cannot be delegated as somebody else's own resources. */
export function scopeContains(parent: AccessScope, child: AccessScope): boolean {
  if (child.mode === 'none' || (child.mode === 'selected' && child.ids.length === 0)) return true;
  if (parent.mode === 'all') return true;
  return parent.mode === 'selected' && child.mode === 'selected' && child.ids.every(id => parent.ids.includes(id));
}
export function canDelegate(actor: Membership, grant: AccessGrant): boolean {
  return actor.status === 'active' && actor.permissions.includes('users.manage') && grant.role !== 'owner'
    && (actor.role === 'owner' || (grant.role !== 'manager' && !grant.permissions.includes('users.manage')))
    && grant.permissions.every(p => hasPermission(actor, p))
    && scopeContains(actor.quizzes, grant.quizzes) && scopeContains(actor.events, grant.events);
}

/** Presets supply defaults; editable role labels never add implicit permissions. */
export function hasPermission(member: AccessGrant, permission: Permission): boolean {
  return member.permissions.includes(permission);
}
