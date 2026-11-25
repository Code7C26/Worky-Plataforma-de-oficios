export type LoginError = {
  code?: 'EMAIL_NOT_VERIFIED';
  message: string;
};

// Only known, user-facing JSON messages may reach the screen. Plain text,
// Error.message and unknown JSON can contain HTML, SQL or server internals.
const safeMessages = new Set([
  'Email o contraseña incorrectos.',
  'Verificá tu email para ingresar.',
  'Revisá tu email, contraseña y dispositivo.',
  'Ingresá el código de 6 dígitos recibido por email.',
  'El código no es válido o venció. Solicitá uno nuevo al iniciar sesión.',
]);

export function getLoginError(reason: unknown): LoginError {
  const fallback = { message: 'No pudimos iniciar sesión. Intentá de nuevo.' };
  if (!reason || typeof reason !== 'object') return fallback;

  const error = reason as { status?: unknown; data?: unknown; name?: unknown };
  const status = typeof error.status === 'number' ? error.status : undefined;
  const data = error.data && typeof error.data === 'object' && !Array.isArray(error.data)
    ? error.data as { code?: unknown; error?: unknown; message?: unknown }
    : undefined;

  if (status === 404 || status === 405) {
    return { message: 'El ingreso móvil no está disponible en este servidor. Intentá más tarde o contactá al equipo de Worky.' };
  }
  if (status !== undefined && status >= 500) {
    return { message: 'Worky no pudo completar el ingreso en este momento. Intentá de nuevo más tarde.' };
  }
  if (status === 429) {
    return { message: 'Hubo demasiados intentos de ingreso. Esperá unos minutos e intentá de nuevo.' };
  }
  if (status === 0 || (status === undefined &&
      (error.name === 'TypeError' || error.name === 'AbortError' || error.name === 'TimeoutError'))) {
    return { message: 'No pudimos conectarnos con Worky. Revisá tu conexión a internet e intentá de nuevo.' };
  }
  if (status === 403 && data?.code === 'EMAIL_NOT_VERIFIED') {
    return { code: 'EMAIL_NOT_VERIFIED', message: 'Verificá tu email para ingresar.' };
  }
  if (status === 401) return { message: 'Email o contraseña incorrectos.' };

  if (status !== undefined && status >= 400 && status < 500) {
    const message = typeof data?.error === 'string' ? data.error : data?.message;
    if (typeof message === 'string' && safeMessages.has(message.trim())) {
      return { message: message.trim() };
    }
  }
  return fallback;
}
