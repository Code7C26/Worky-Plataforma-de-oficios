export type WebRole = 'client' | 'professional' | 'admin';
export type AccountRole = 'cliente' | 'profesional' | 'admin' | undefined;
export type SwitchableRole = Exclude<WebRole, 'admin'>;

export function hasDualRoleAccount(accountRole: AccountRole, professionalProfile: unknown): boolean {
  if (accountRole === 'profesional') return true;
  return accountRole === 'cliente' && Boolean(professionalProfile);
}

export function resolveEffectiveRole(
  accountRole: AccountRole,
  selectedRole: WebRole,
  hasSavedPreference: boolean,
  hasProfessionalAccount: boolean,
): WebRole {
  if (accountRole === 'admin') return 'admin';

  const requestedRole = hasSavedPreference
    ? selectedRole
    : accountRole === 'profesional'
      ? 'professional'
      : selectedRole;

  return requestedRole === 'professional' && hasProfessionalAccount ? 'professional' : 'client';
}

export function getRoleSwitcherTarget(role: SwitchableRole): SwitchableRole {
  return role === 'client' ? 'professional' : 'client';
}

export function getRoleSwitcherLabel(role: SwitchableRole): string {
  return role === 'client' ? 'Cambiar a Profesional' : 'Cambiar a Cliente';
}