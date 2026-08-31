export type AppointmentAction = 'propose' | 'accept' | 'reject' | 'cancel';

export function appointmentErrorMessage(action: AppointmentAction, error: unknown) {
  const fallback = {
    propose: 'No pudimos proponer la visita.',
    accept: 'No pudimos aceptar la visita.',
    reject: 'No pudimos rechazar la visita.',
    cancel: 'No pudimos cancelar la visita.',
  }[action];
  if (error instanceof Error && error.message && !/^(failed to fetch|network error)$/i.test(error.message)) {
    return `${fallback} ${error.message}`;
  }
  return `${fallback} Revisá tu conexión y probá de nuevo.`;
}