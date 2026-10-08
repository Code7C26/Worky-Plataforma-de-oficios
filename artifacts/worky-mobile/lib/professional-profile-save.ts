type ProfessionalProfileSaveResult =
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

export async function runProfessionalProfileSave(
  persist: () => Promise<unknown>,
  refresh: () => Promise<unknown>,
): Promise<ProfessionalProfileSaveResult> {
  try {
    await persist();
    await refresh();
    return { kind: 'saved' };
  } catch (reason) {
    return {
      kind: 'error',
      message: reason instanceof Error ? reason.message : 'No pudimos guardar tu perfil.',
    };
  }
}