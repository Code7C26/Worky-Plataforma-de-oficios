export type WorkyRole = 'cliente' | 'profesional';

export async function switchRoleAfterServerConfirmation<TAccount>(
  role: WorkyRole,
  requestRoleSwitch: (input: { rol: WorkyRole }) => Promise<TAccount>,
  onRoleConfirmed: (account: TAccount) => void,
): Promise<TAccount> {
  const updatedAccount = await requestRoleSwitch({ rol: role });
  onRoleConfirmed(updatedAccount);
  return updatedAccount;
}