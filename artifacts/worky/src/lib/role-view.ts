export type WebRole = 'client' | 'professional' | 'admin';
export type AccountRole = 'cliente' | 'profesional' | 'admin' | undefined;
export type SwitchableRole = Exclude<WebRole, 'admin'>;

export function shouldShowProfessionalSearch(activeRole: SwitchableRole): boolean {
  return activeRole === 'client';
}

export function hasDualRoleAccount(accountRole: AccountRole, professionalProfile: unknown): boolean {
  if (accountRole === 'profesional') return true;
  return (accountRole === 'cliente' || accountRole === 'admin') && Boolean(professionalProfile);
}

export function shouldShowPartnerSignupCta(
  activeRole: SwitchableRole,
  accountRole: AccountRole,
  professionalProfile: unknown,
  profileLoading: boolean,
  profileError: boolean,
): boolean {
  return activeRole === 'client'
    && !profileLoading
    && !profileError
    && !hasDualRoleAccount(accountRole, professionalProfile);
}

export function resolveEffectiveRole(
  accountRole: AccountRole,
  selectedRole: WebRole,
  hasSavedPreference: boolean,
  hasProfessionalAccount: boolean,
): SwitchableRole {
  const requestedRole = hasSavedPreference
    ? selectedRole
    : accountRole === 'profesional' || (accountRole === 'admin' && hasProfessionalAccount)
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