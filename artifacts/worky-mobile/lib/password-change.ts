export type PasswordChangeResult =
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

export async function changePasswordWithValidation(
  input: {
    currentPassword: string;
    newPassword: string;
    confirmation: string;
  },
  persist: () => Promise<unknown>,
): Promise<PasswordChangeResult> {
  if (!input.currentPassword) {
    return { kind: 'error', message: 'Ingresá tu contraseña actual.' };
  }
  if (input.newPassword.length < 8) {
    return { kind: 'error', message: 'La nueva contraseña debe tener al menos 8 caracteres.' };
  }
  if (input.newPassword !== input.confirmation) {
    return { kind: 'error', message: 'Las contraseñas nuevas no coinciden.' };
  }

  try {
    await persist();
    return { kind: 'saved' };
  } catch (reason) {
    return {
      kind: 'error',
      message: reason instanceof Error ? reason.message : 'No pudimos cambiar tu contraseña.',
    };
  }
}