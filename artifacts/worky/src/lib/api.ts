import { setAuthTokenGetter } from "@workspace/api-client-react";

const TOKEN_KEY = "worky-token";
const APPOINTMENT_ATTEMPTS_KEY = "worky-appointment-attempts";

export type AuthUser = {
  id: number;
  nombre: string;
  email: string;
  emailVerifiedAt?: string | null;
  telefono?: string | null;
  rol: "cliente" | "profesional" | "admin";
  ubicacion?: unknown;
  edad?: number | null;
  fotoObjectPath?: string | null;
  onboardingEstado?: string;
  onboardingPaso?: number;
};
export type AuthLoginChallenge = { requiresTwoFactor: true; challengeId: number; maskedEmail: string };
export type AuthLoginResult = AuthUser | AuthLoginChallenge;

export class WorkyApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export type PendingAppointmentAttempt = {
  id: number;
  changaId: number;
  accion: "proponer" | "aceptar" | "rechazar" | "cancelar";
  resultado: "exitoso" | "rechazado" | "error_permiso" | "error_validacion" | "error_red";
  detalle: string | null;
  appointmentId: number | null;
  empiezaAt: string | null;
  createdAt: string;
};

function pendingAttemptsKey(changaId: number) {
  return `${APPOINTMENT_ATTEMPTS_KEY}-${changaId}`;
}

export function getPendingAppointmentAttempts(changaId: number): PendingAppointmentAttempt[] {
  try {
    const value = JSON.parse(localStorage.getItem(pendingAttemptsKey(changaId)) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function savePendingAppointmentAttempts(changaId: number, attempts: PendingAppointmentAttempt[]) {
  if (attempts.length) localStorage.setItem(pendingAttemptsKey(changaId), JSON.stringify(attempts.slice(-20)));
  else localStorage.removeItem(pendingAttemptsKey(changaId));
}

export function addPendingAppointmentAttempt(changaId: number, attempt: PendingAppointmentAttempt) {
  const current = getPendingAppointmentAttempts(changaId);
  const duplicate = current.some((item) => item.accion === attempt.accion && item.resultado === attempt.resultado && item.detalle === attempt.detalle && item.createdAt === attempt.createdAt);
  if (!duplicate) savePendingAppointmentAttempts(changaId, [...current, attempt]);
  return duplicate ? current : [...current, attempt].slice(-20);
}

type AppointmentAttemptRequest = (path: string, init?: RequestInit) => Promise<unknown>;
const pendingAttemptSyncs = new Map<number, Promise<void>>();

export async function syncPendingAppointmentAttempts(changaId: number, request: AppointmentAttemptRequest = apiRequest) {
  const running = pendingAttemptSyncs.get(changaId);
  if (running) return running;

  const sync = (async () => {
    for (const attempt of getPendingAppointmentAttempts(changaId)) {
      await request(`/chats/${changaId}/historial-visitas`, {
        method: "POST",
        body: JSON.stringify({
          accion: attempt.accion,
          resultado: attempt.resultado,
          detalle: attempt.detalle || undefined,
        }),
      });
      savePendingAppointmentAttempts(
        changaId,
        getPendingAppointmentAttempts(changaId).filter((item) => item.id !== attempt.id),
      );
    }
  })();

  pendingAttemptSyncs.set(changaId, sync);
  try {
    await sync;
  } finally {
    if (pendingAttemptSyncs.get(changaId) === sync) pendingAttemptSyncs.delete(changaId);
  }
}

export function configureApiAuth(onUnauthorized?: () => void) {
  setAuthTokenGetter(() => getToken());
  return async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`/api/v1${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}), ...init.headers },
    });
    const data = await response.json().catch(() => null);
    if (response.status === 401 || (response.status === 403 && data?.code === "EMAIL_NOT_VERIFIED")) {
      clearToken();
      onUnauthorized?.();
    }
    if (!response.ok) throw new WorkyApiError(response.status, data?.error || "No pudimos completar la solicitud.", data?.code);
    return data as T;
  };
}

export function apiRequest<T>(path: string, init: RequestInit = {}) {
  return configureApiAuth()(path, init) as Promise<T>;
}

export async function markNotificationRead(notificationId: number, onConfirmed?: () => void | Promise<void>) {
  const result = await apiRequest(`/notificaciones/${notificationId}/leida`, { method: "PATCH" });
  await onConfirmed?.();
  return result;
}

export async function login(email: string, password: string): Promise<AuthLoginResult> {
  const request = configureApiAuth();
  const data = await request<{ token: string; usuario: AuthUser } | AuthLoginChallenge>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  if ("requiresTwoFactor" in data) return data;
  localStorage.setItem(TOKEN_KEY, data.token);
  return data.usuario;
}

export async function verifyTwoFactorLogin(challengeId: number, code: string) {
  const request = configureApiAuth();
  const data = await request<{ token: string; usuario: AuthUser }>("/auth/login/verify", {
    method: "POST",
    body: JSON.stringify({ challengeId, code }),
  });
  localStorage.setItem(TOKEN_KEY, data.token);
  return data.usuario;
}
export async function requestAdminSignupCode(email: string) {
  return apiRequest<{ message: string }>("/auth/admin-signup/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function completeAdminSignup(payload: {
  nombre: string;
  email: string;
  password: string;
  codigo: string;
}) {
  const result = await apiRequest<{ token: string; usuario: AuthUser }>("/auth/admin-signup/complete", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (result.usuario.rol !== "admin") {
    throw new WorkyApiError(403, "El servidor no confirmó el rol administrador.");
  }
  localStorage.setItem(TOKEN_KEY, result.token);
  return result.usuario;
}

export async function requestPasswordRecovery(email: string) {
  const request = configureApiAuth();
  return request<{ message: string }>("/auth/password-recovery/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, newPassword: string) {
  const request = configureApiAuth();
  return request<{ success: boolean }>("/auth/password-recovery/reset", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
}

export async function requestAccountEmailVerification() {
  return apiRequest<{ message: string }>("/auth/email-verification/account/request", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function confirmAccountEmailVerification(code: string) {
  return apiRequest<{ verified: boolean }>("/auth/email-verification/account/confirm", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function requestRegistrationEmailVerification(email: string) {
  return apiRequest<{ message: string }>("/auth/email-verification/registration/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function confirmRegistrationEmailVerification(email: string, code: string) {
  const data = await apiRequest<{ token: string; usuario: AuthUser }>("/auth/email-verification/registration/confirm", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
  localStorage.setItem(TOKEN_KEY, data.token);
  return data.usuario;
}

export async function register(payload: { nombre: string; email: string; password: string; telefono?: string; ubicacion?: unknown; edad?: number; fotoObjectPath?: string | null; rol?: "cliente" | "profesional"; onboardingRespuestas?: Record<string, string> }) {
  const request = configureApiAuth();
  return request<{ message: string }>("/auth/register", { method: "POST", body: JSON.stringify(payload) });
}

export async function uploadWorkyFile(file: File, purpose: "profile_photo" | "chat_image" | "file" = "file", changaId?: number, profesionalId?: number) {
  if (purpose === "profile_photo") {
    if (!file.type.startsWith("image/")) throw new Error("Elegí un archivo de imagen para tu foto de perfil.");
    if (file.size > 10 * 1024 * 1024) throw new Error("La foto de perfil puede pesar hasta 10 MB.");
  }
  if (purpose === "chat_image") {
    if (!changaId) throw new Error("No encontramos la conversación.");
    if (!file.type.startsWith("image/")) throw new Error("Solo podés adjuntar imágenes.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Cada imagen puede pesar hasta 10 MB.");
  }
  const request = configureApiAuth();
  const prepared = await request<{ uploadURL: string; objectPath: string }>("/storage/uploads/request-url", {
    method: "POST", body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream", purpose, ...(changaId ? { changaId } : {}), ...(profesionalId ? { profesionalId } : {}) }),
  });
  const uploaded = await fetch(prepared.uploadURL, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  if (!uploaded.ok) throw new Error("No pudimos cargar el archivo.");
  return { objectPath: prepared.objectPath, name: file.name, size: file.size, contentType: file.type || "application/octet-stream" };
}

export async function fetchWorkyObject(objectPath: string) {
  const response = await fetch(`/api/v1/storage/objects${objectPath}`, {
    headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
  });
  if (!response.ok) throw new Error("No pudimos cargar el archivo.");
  return response.blob();
}

export async function fetchWorkyApiFile(path: string) {
  const response = await fetch(`/api/v1${path}`, {
    headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new WorkyApiError(response.status, body?.error || "No pudimos cargar el archivo privado.");
  }
  return response.blob();
}

export async function currentUser() {
  const request = configureApiAuth();
  return request<AuthUser>("/auth/me");
}

export async function logout() {
  const hadToken = Boolean(getToken());
  const serverLogout = hadToken
    ? configureApiAuth()("/auth/logout", { method: "POST" }).catch(() => undefined)
    : Promise.resolve();
  clearToken();
  await serverLogout;
}