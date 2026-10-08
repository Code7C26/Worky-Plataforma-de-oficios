export type PersonalDetailsSaveResult =
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

export async function savePersonalDetails<T>(
  persist: () => Promise<T>,
  onSaved: (account: T) => void,
): Promise<PersonalDetailsSaveResult> {
  let account: T;
  try {
    account = await persist();
  } catch (reason) {
    return {
      kind: 'error',
      message: reason instanceof Error ? reason.message : 'No pudimos guardar tus datos.',
    };
  }

  onSaved(account);
  return { kind: 'saved' };
}