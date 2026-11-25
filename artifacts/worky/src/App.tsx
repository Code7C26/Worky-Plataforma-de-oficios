import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  ArrowDownUp, Banknote, BriefcaseBusiness, Check, ChevronRight, CircleAlert, Clock3, Heart, Inbox, LoaderCircle,
  LockKeyhole, MapPin, Menu, MessageCircle, Plus, Search, Send, ShieldCheck, Sparkles,
  Star, UserRound, X, Bell, CalendarDays, LayoutDashboard, RefreshCw, Trash2, Pencil,
  ImageIcon, Paperclip, LocateFixed, Settings,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  getGetMyProfessionalProfileQueryKey, getGetProfessionalQueryKey,
  getGetProfessionalReputationQueryKey, getListAssignedJobsQueryKey, getListAvailableJobsQueryKey,
  getListMyJobsQueryKey, getListAppointmentAttemptsQueryKey,
  getListProfessionalsQueryKey, getListAppointmentsQueryKey, getListMyPaymentsQueryKey, useListMyPayments,
  useCreatePaymentCheckout, useConfirmCashJobPayment, useAcceptJob, useAcceptAppointment, useCreateJob,
  useCreateMyProfessionalProfile, useGetMyProfessionalProfile,
  useGetProfessional, useGetProfessionalReputation,
   useListAssignedJobs, useListAvailableJobs,
   useListAppointments, useListMyJobs, useListProfessionals, useProposeAppointment, useRejectAppointment, useUpdateJob, useUpdateMyProfessionalProfile,
} from '@workspace/api-client-react';
import type { Appointment, AppointmentAttempt, ChatMessage, ClientPayment, Conversation, Job, ProfessionalProfile } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { PasswordInput } from '@/components/password-input';
import NotFound from '@/pages/not-found';
import { Route, Switch, Link, Router as WouterRouter, useLocation, useParams } from 'wouter';
import { AuthUser, WorkyApiError, addPendingAppointmentAttempt, apiRequest, clearToken, configureApiAuth, confirmRegistrationEmailVerification, currentUser, fetchWorkyObject, getPendingAppointmentAttempts, getToken, login, logout, markNotificationRead, register, requestPasswordRecovery, requestRegistrationEmailVerification, resetPassword, savePendingAppointmentAttempts, syncPendingAppointmentAttempts, uploadWorkyFile, verifyTwoFactorLogin as verifyTwoFactorLoginRequest, type AuthLoginChallenge, type AuthLoginResult, type PendingAppointmentAttempt } from '@/lib/api';
import { appointmentErrorMessage, type AppointmentAction } from '@/appointment-errors';
import {
  getRoleSwitcherLabel,
  getRoleSwitcherTarget,
  hasDualRoleAccount,
  resolveEffectiveRole,
  shouldShowPartnerSignupCta,
  shouldShowProfessionalSearch,
} from '@/lib/role-view';
import SettingsPage from '@/pages/settings';
import { AccountPasswordForm } from '@/pages/settings';
import { AdminConsolePage } from '@/pages/admin-console';
import { AdminAccessPage } from '@/pages/admin-access';
import { AdminSessionGate } from '@/components/admin-session-gate';
import { PartnerApprovalGate } from '@/components/partner-approval-gate';

export const queryClient = new QueryClient();
type Role = 'client' | 'professional' | 'admin';
type JobStatus = 'published' | 'accepted' | 'in_progress' | 'awaiting_payment' | 'completed' | 'cancelled';
const conversationsQueryKey = (role: Role) => ['worky-conversations', role] as const;
type WorkyProfessional = {
  id: number;
  userId: number;
  name: string;
  initials: string;
  trade: string;
  category: string;
  rating: number;
  jobsCompleted: number;
  experience: number;
  price: number;
  available: boolean;
  verified: boolean;
  bio: string;
  skills: string[];
  location?: string;
  photoUrl?: string;
  reviewsCount: number;
  recommendationsCount: number;
  distanceKm?: number | null;
  visibilityRank?: number;
};
type ProfessionalSort = 'recommended' | 'rating' | 'distance';
type WorkyJob = {
  id: number;
  category: string;
  location: string;
  price: number;
  detail: string;
  status: JobStatus;
  clientName: string;
  clientVerified: boolean;
  professionalName: string | null;
  professionalId: number | null;
  clientId: number;
  createdAt: string;
  calificada: boolean;
  paymentMethod: 'mercado_pago' | 'efectivo';
  cashConfirmedByClient: boolean;
  cashConfirmedByProfessional: boolean;
};
type ProfileForm = { trade: string; category: string; price: number; experience: number; bio: string; skills: string[]; available: boolean; locationAddress: string; locationCity: string; locationProvince: string; locationCoordinates?: [number, number] };
const profilePhotosByInitials = new Map<string, string>();
function captureBrowserCoordinates() {
  return new Promise<[number, number]>((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Este dispositivo no permite obtener la ubicación.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve([coords.longitude, coords.latitude]),
      () => reject(new Error('No pudimos obtener la ubicación. Revisá el permiso e intentá de nuevo.')),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  });
}
const NOTIFICATION_SYNC_KEY = 'worky-notification-sync';
const NOTIFICATION_STREAM_LEASE_KEY = 'worky-notification-stream-lease';
const NOTIFICATION_STREAM_LEASE_MS = 15_000;
const NOTIFICATION_STREAM_RETRY_DELAY_MS = 30_000;
const NOTIFICATION_STREAM_CHECK_MS = 1_000;
const NOTIFICATION_TAB_ID = Math.random().toString(36).slice(2);
type NotificationSyncMessage = { userId: number; at: number; source?: string };
type NotificationStreamLease = { userId: number; owner: string; expiresAt: number; nextAttemptAt?: number };
type WorkyNotification = { id: number; usuarioId?: number; titulo: string; detalle: string; leida: boolean; href?: string | null; createdAt?: string | null };
type NotificationsResponse = { items: WorkyNotification[]; unread: number };

function notificationStreamLeaseKey(userId: number) {
  return `${NOTIFICATION_STREAM_LEASE_KEY}-${userId}`;
}

function readNotificationStreamLease(userId: number): NotificationStreamLease | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(notificationStreamLeaseKey(userId)) || 'null') as NotificationStreamLease | null;
    return value?.userId === userId && typeof value.owner === 'string' && typeof value.expiresAt === 'number' ? value : null;
  } catch {
    return null;
  }
}

function writeNotificationStreamLease(lease: NotificationStreamLease) {
  try {
    window.localStorage.setItem(notificationStreamLeaseKey(lease.userId), JSON.stringify(lease));
  } catch {
    // Si el almacenamiento está bloqueado, el backoff local evita un bucle de reintentos.
  }
}

function tryClaimNotificationStream(userId: number, now: number) {
  const current = readNotificationStreamLease(userId);
  if (current && current.owner !== NOTIFICATION_TAB_ID && current.expiresAt > now) return false;
  if (current?.owner !== NOTIFICATION_TAB_ID && (current?.nextAttemptAt ?? 0) > now) return false;
  if (current?.owner === NOTIFICATION_TAB_ID && (current.nextAttemptAt ?? 0) > now) return false;

  writeNotificationStreamLease({
    userId,
    owner: NOTIFICATION_TAB_ID,
    expiresAt: now + NOTIFICATION_STREAM_LEASE_MS,
  });
  return readNotificationStreamLease(userId)?.owner === NOTIFICATION_TAB_ID;
}

function renewNotificationStreamLease(userId: number, now: number) {
  const current = readNotificationStreamLease(userId);
  if (current?.owner !== NOTIFICATION_TAB_ID) return false;
  writeNotificationStreamLease({ ...current, expiresAt: now + NOTIFICATION_STREAM_LEASE_MS, nextAttemptAt: 0 });
  return true;
}

function delayNotificationStreamRetry(userId: number, now: number) {
  const nextAttemptAt = now + NOTIFICATION_STREAM_RETRY_DELAY_MS;
  const current = readNotificationStreamLease(userId);
  if (current?.owner === NOTIFICATION_TAB_ID) {
    writeNotificationStreamLease({ ...current, expiresAt: now + NOTIFICATION_STREAM_LEASE_MS, nextAttemptAt });
  }
  return nextAttemptAt;
}

function releaseNotificationStreamLease(userId: number) {
  try {
    const current = readNotificationStreamLease(userId);
    if (current?.owner === NOTIFICATION_TAB_ID) window.localStorage.removeItem(notificationStreamLeaseKey(userId));
  } catch {
    // No impedir el cierre de sesión por un almacenamiento no disponible.
  }
}

function publishNotificationSync(userId: number) {
  const message: NotificationSyncMessage = { userId, at: Date.now(), source: NOTIFICATION_TAB_ID };
  try {
    window.localStorage.setItem(NOTIFICATION_SYNC_KEY, JSON.stringify(message));
  } catch {
    // La pestaña receptora conserva el refresco periódico si el almacenamiento está bloqueado.
  }
}

type RegistrationPayload = Parameters<typeof register>[0];
const REGISTRATION_DRAFT_KEY = 'worky-registration-draft';
type RegistrationDraft = {
  step: number;
  role: Role;
  data: Omit<RegistrationData, 'password' | 'confirm'>;
  answers: Record<string, string>;
  services: { oficio: string; categoria: string; experienciaAnios: number }[];
  docs: Record<string, { objectPath: string; name: string; contentType: string; sizeBytes: number }>;
  photo: { objectPath: string } | null;
};
type RegistrationData = { name: string; email: string; phone: string; password: string; confirm: string; address: string; city: string; province: string; age: string; shopCoordinates: [number, number] | null };

function readRegistrationDraft(): RegistrationDraft | null {
  try {
    const raw = localStorage.getItem(REGISTRATION_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as RegistrationDraft;
    return draft && typeof draft === 'object' && [1, 2, 3].includes(draft.step) ? draft : null;
  } catch {
    return null;
  }
}

function saveRegistrationDraft(draft: RegistrationDraft) {
  try { localStorage.setItem(REGISTRATION_DRAFT_KEY, JSON.stringify(draft)); } catch { /* storage may be unavailable */ }
}

function clearRegistrationDraft() {
  try { localStorage.removeItem(REGISTRATION_DRAFT_KEY); } catch { /* storage may be unavailable */ }
}

type AuthContextValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthLoginResult>;
  verifyTwoFactorLogin: (challengeId: number, code: string) => Promise<AuthUser>;
  register: (payload: RegistrationPayload) => Promise<void>;
  requestRegistrationCode: (email: string) => Promise<void>;
  confirmRegistration: (email: string, code: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<AuthUser | null>;
};
const AuthContext = createContext<AuthContextValue | null>(null);
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('AuthProvider requerido'); return value; }
function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setLoading] = useState(true);
  const setSessionUser = (nextUser: AuthUser | null) => { queryClient.clear(); setUser(nextUser); };
  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    if (!getToken()) { queryClient.clear(); setUser(null); return null; }
    try {
      const current = await currentUser();
      setUser(current);
      return current;
    } catch (error) {
      if (error instanceof WorkyApiError && (error.status === 401 || (error.status === 403 && error.code === 'EMAIL_NOT_VERIFIED'))) {
        clearToken(); queryClient.clear(); setUser(null);
        return null;
      }
      // A temporary failure is not proof that the session or admin role was lost.
      throw error;
    }
  }, []);
  useEffect(() => { void refreshUser().catch(() => undefined).finally(() => setLoading(false)); }, [refreshUser]);
  useEffect(() => { configureApiAuth(() => setSessionUser(null)); }, []);
  const value: AuthContextValue = {
    user,
    isAuthenticated: Boolean(user),
    isLoading,
    login: async (email, password) => {
      const result = await login(email, password);
      if ('requiresTwoFactor' in result) return result;
      setSessionUser(result);
      return result;
    },
    verifyTwoFactorLogin: async (challengeId, code) => {
      const verifiedUser = await verifyTwoFactorLoginRequest(challengeId, code);
      setSessionUser(verifiedUser);
      return verifiedUser;
    },
    register: async (payload) => { await register(payload); },
    requestRegistrationCode: async (email) => { await requestRegistrationEmailVerification(email); },
    confirmRegistration: async (email, code) => {
      return confirmRegistrationEmailVerification(email, code);
    },
    logout: async () => { const pendingLogout = logout(); setSessionUser(null); await pendingLogout; },
    refreshUser,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const categories = ['Plomería', 'Electricidad', 'Gas', 'Albañilería', 'Otro'];
const statusLabels: Record<string, string> = {
  published: 'Publicada', accepted: 'Aceptada', in_progress: 'En curso', awaiting_payment: 'Pago pendiente', completed: 'Finalizada', cancelled: 'Cancelada',
};
const statusTone: Record<string, string> = {
  published: 'status status-amber', accepted: 'status status-blue', in_progress: 'status status-blue', awaiting_payment: 'status status-amber',
  completed: 'status status-green', cancelled: 'status status-red',
};

function money(value: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value);
}

type VerificationDocument = {
  id: number; tipo: 'dni_frente' | 'dni_dorso' | 'antecedentes_penales' | 'matricula'; objectPath: string; nombre: string;
  contentType: string; sizeBytes: number; estado: 'pending_verification' | 'verified' | 'rejected';
  createdAt: string; updatedAt?: string; partner: { id: number; nombre: string; email: string };
  perfil: { oficio: string; categoria: string; estadoVerificacion: string } | null;
};
function dateLabel(value?: string) {
  if (!value) return 'Recién publicada';
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(new Date(value));
}
function appointmentAttemptLabel(attempt: AppointmentAttempt) {
  const action = { proponer: 'Propuso una visita', aceptar: 'Aceptó una visita', rechazar: 'Rechazó una visita', cancelar: 'Canceló una visita' }[attempt.accion] || 'Coordinó una visita';
  const result = { exitoso: 'Completado', rechazado: 'La otra persona rechazó la propuesta', error_permiso: 'Error de permisos', error_validacion: 'Datos inválidos', error_red: 'Error de conexión' }[attempt.resultado] || attempt.resultado;
  return { action, result };
}
function attemptResultTone(result: AppointmentAttempt['resultado']) {
  return result === 'exitoso' ? 'text-[#31825a]' : result === 'rechazado' ? 'text-[hsl(var(--muted-foreground))]' : 'text-[hsl(var(--destructive))]';
}
function toProfessional(profile: ProfessionalProfile): WorkyProfessional {
  const location = profile.ubicacionFija;
  const initials = profile.usuario.nombre.split(' ').map((part) => part[0]).join('').slice(0, 2);
  const photoObjectPath = (profile.usuario as typeof profile.usuario & { fotoObjectPath?: string | null }).fotoObjectPath;
  const photoUrl = photoObjectPath ? `/api/v1/storage/public-objects${photoObjectPath}` : undefined;
  if (photoUrl) profilePhotosByInitials.set(initials, photoUrl);
  return {
    id: profile.id,
    userId: profile.usuarioId,
    name: profile.usuario.nombre,
    initials,
    trade: profile.oficio,
    category: profile.categoria,
    rating: profile.rating,
    jobsCompleted: profile.completedJobs,
    experience: profile.experienciaAnios,
    price: profile.precioReferencia,
    available: profile.disponible,
    verified: profile.verificado,
    bio: profile.about ?? '',
    skills: profile.skills,
    location: location
      ? [location.direccionTexto, location.ciudad, location.provincia].filter(Boolean).join(', ')
      : undefined,
    photoUrl,
    reviewsCount: profile.reviewsCount,
    recommendationsCount: profile.recommendationsCount,
    distanceKm: (profile as ProfessionalProfile & { distanceKm?: number | null }).distanceKm,
    visibilityRank: profile.visibilityRank ?? 0,
  };
}
function toJob(job: Job): WorkyJob {
  const statuses: Record<Job['estado'], JobStatus> = {
    publicada: 'published',
    aceptada: 'accepted',
    en_curso: 'in_progress',
    trabajo_realizado: 'awaiting_payment',
    finalizada: 'completed',
    cancelada: 'cancelled',
  };
  return {
    id: job.id,
    category: job.categoria,
    location: job.ubicacion.direccionTexto ?? job.ubicacion.zona ?? 'Sin ubicación',
    price: job.precioOfrecido,
    detail: job.detalle ?? '',
    status: statuses[job.estado],
    clientName: job.cliente.nombre,
    clientVerified: job.cliente.clientVerified === true,
    professionalName: job.profesional?.nombre ?? null,
    professionalId: job.profesionalId,
    clientId: job.clienteId,
    createdAt: job.createdAt,
    calificada: job.calificada,
    paymentMethod: job.paymentMethod,
    cashConfirmedByClient: job.cashConfirmedByClient,
    cashConfirmedByProfessional: job.cashConfirmedByProfessional,
  };
}
function displayName(professional?: WorkyProfessional | null) {
  return professional?.name || 'Tu perfil profesional';
}
function useCatalogCategories() {
  return useQuery({ queryKey: ['worky-catalog-categories'], queryFn: () => apiRequest<string[]>('/catalogo/categorias'), staleTime: 5 * 60 * 1000 });
}

function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link href="/home" className={`focus-ring flex items-center gap-2.5 ${light ? 'text-white' : ''}`} data-testid="link-brand">
      <img src="/brand/worky-logo.png" alt="Worky" className="h-10 w-[124px] object-contain object-left" />
    </Link>
  );
}

function Avatar({ name, initials, photoUrl, size = 'md', warm = false }: { name?: string; initials?: string; photoUrl?: string; size?: 'sm' | 'md' | 'lg' | 'xl'; warm?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [photoUrl]);
  const fallback = initials || name?.split(' ').map((part) => part[0]).slice(0, 2).join('') || 'WK';
  const resolvedPhotoUrl = photoUrl || profilePhotosByInitials.get(fallback);
  const sizeClass = { sm: 'h-8 w-8 text-[.68rem]', md: 'h-11 w-11 text-xs', lg: 'h-20 w-20 text-xl', xl: 'h-24 w-24 text-2xl' }[size];
  return <div className={`${sizeClass} relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl font-bold ${warm ? 'bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]' : 'bg-[hsl(var(--secondary))] text-white'}`} data-testid={`avatar-${fallback}`}>{resolvedPhotoUrl && !imageFailed ? <img src={resolvedPhotoUrl} alt={`Foto de ${name || 'perfil'}`} className="absolute inset-0 h-full w-full object-cover" onError={() => setImageFailed(true)} /> : fallback}</div>;
}

function Button({ children, onClick, type = 'button', variant = 'primary', className = '', disabled = false, testId }: { children: ReactNode; onClick?: () => void; type?: 'button' | 'submit'; variant?: 'primary' | 'ghost' | 'dark' | 'soft' | 'danger'; className?: string; disabled?: boolean; testId?: string }) {
  const styles = {
    primary: 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_5px_0_hsl(24_70%_42%)] hover:shadow-[0_3px_0_hsl(24_70%_42%)]',
    ghost: 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]',
    dark: 'bg-[hsl(var(--secondary))] text-white hover:bg-[hsl(215_45%_29%)]',
    soft: 'bg-[hsl(var(--accent))] text-[hsl(var(--foreground))] hover:bg-[hsl(42_92%_72%)]',
    danger: 'bg-[hsl(var(--destructive))] text-white hover:bg-[hsl(4_72%_46%)]',
  }[variant];
  return <button type={type} disabled={disabled} onClick={onClick} className={`btn focus-ring inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-55 ${styles} ${className}`} data-testid={testId}>{children}</button>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={statusTone[status] || 'status'} data-testid={`status-job-${status}`}>{statusLabels[status] || status}</span>;
}

function Skeleton({ className = '' }: { className?: string }) { return <div className={`skeleton rounded-lg ${className}`} aria-label="Cargando" />; }
function LoadingBlock({ label = 'Cargando información' }: { label?: string }) {
  return <div className="space-y-4" role="status" data-testid="state-loading"><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /><p className="text-center text-xs text-[hsl(var(--muted-foreground))]">{label}</p></div>;
}
function ErrorState({ onRetry }: { onRetry: () => void }) {
  return <div className="flex flex-col items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-6 py-14 text-center" data-testid="state-error"><CircleAlert className="mb-3 text-[hsl(var(--destructive))]" size={30} /><h3 className="display-font text-lg font-bold">Algo no salió como esperábamos</h3><p className="mt-1 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">Revisá tu conexión y probá de nuevo. Estamos cuidando que todo vuelva a funcionar.</p><Button onClick={onRetry} variant="ghost" className="mt-5" testId="button-retry">Intentar de nuevo</Button></div>;
}
function EmptyState({ icon: Icon, title, copy, action }: { icon: typeof Inbox; title: string; copy: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/.65)] px-6 py-16 text-center" data-testid="state-empty"><span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"><Icon size={25} /></span><h3 className="display-font text-lg font-bold">{title}</h3><p className="mt-1 max-w-sm text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{copy}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

function AppShell({ children, role, setRole }: { children: ReactNode; role: Exclude<Role, 'admin'>; setRole: (role: Role) => void }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const auth = useAuth();
  const profileQuery = useGetMyProfessionalProfile({ query: { queryKey: getGetMyProfessionalProfileQueryKey(), retry: false, enabled: Boolean(auth.user) } });
  const profile = profileQuery.data ? toProfessional(profileQuery.data) : null;
  const switchTargetRole = role === 'client' || role === 'professional' ? getRoleSwitcherTarget(role) : null;
  const switchLabel = role === 'client' || role === 'professional' ? getRoleSwitcherLabel(role) : '';
  const canSwitchRole = switchTargetRole !== null && hasDualRoleAccount(auth.user?.rol, profile);
  const showPartnerSignupCta = shouldShowPartnerSignupCta(role, auth.user?.rol, profileQuery.data, profileQuery.isLoading, profileQuery.isError);
  const switchRole = () => {
    if (!switchTargetRole) return;
    setRole(switchTargetRole);
    setMobileOpen(false);
    setLocation(switchTargetRole === 'professional' ? '/partner/dashboard' : '/home');
  };
  const accountName = profile?.name || auth.user?.nombre || 'Tu cuenta';
  const accountInitials = accountName.split(' ').map((part) => part[0]).join('').slice(0, 2);
  const accountPhotoPath = auth.user?.fotoObjectPath;
  if (accountPhotoPath) profilePhotosByInitials.set(accountInitials, `/api/v1/storage/public-objects${accountPhotoPath}`);
  const notifications = useQuery({ queryKey: ['worky-notifications'], queryFn: () => apiRequest<NotificationsResponse>('/notificaciones'), enabled: Boolean(auth.user), refetchInterval: 10000, refetchIntervalInBackground: true, refetchOnWindowFocus: true });
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const notificationPanelRef = useRef<HTMLDivElement>(null);
  const [notificationReadFailures, setNotificationReadFailures] = useState<Map<number, { id: number; title: string }>>(new Map());
  const [retryingNotificationId, setRetryingNotificationId] = useState<number | null>(null);
  useEffect(() => {
    if (!showNotifications) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (notificationButtonRef.current?.contains(target) || notificationPanelRef.current?.contains(target))) return;
      setShowNotifications(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowNotifications(false);
      notificationButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showNotifications]);
  useEffect(() => {
    if (!auth.user) return;
    const token = getToken();
    if (!token) return;
    const EventSourceImpl = window.EventSource;
    if (!EventSourceImpl) return;
    const userId = auth.user.id;
    let stream: EventSource | null = null;
    let retryTimer: number | undefined;
    let nextLocalAttemptAt = 0;
    const rehydrate = () => { void notifications.refetch(); };
    const handleNotification = (event: MessageEvent<string>) => {
      try {
        const incoming = JSON.parse(event.data) as WorkyNotification;
        queryClient.setQueryData<NotificationsResponse | undefined>(['worky-notifications'], (current) => {
          if (!current || current.items.some((item) => item.id === incoming.id)) return current;
          return { items: [incoming, ...current.items], unread: current.unread + (incoming.leida ? 0 : 1) };
        });
        void notifications.refetch();
        publishNotificationSync(userId);
      } catch {
        void notifications.refetch();
      }
    };

    const openStream = () => {
      if (stream || Date.now() < nextLocalAttemptAt) return;
      const now = Date.now();
      if (!tryClaimNotificationStream(userId, now)) return;

      const candidate = new EventSourceImpl(`/api/v1/notificaciones/stream?token=${encodeURIComponent(token)}`);
      stream = candidate;
      const handleOpen = () => {
        if (stream !== candidate) return;
        if (retryTimer !== undefined) {
          window.clearTimeout(retryTimer);
          retryTimer = undefined;
        }
        nextLocalAttemptAt = 0;
        renewNotificationStreamLease(userId, Date.now());
        rehydrate();
      };
      const handleError = () => {
        if (stream !== candidate) return;
        candidate.close();
        nextLocalAttemptAt = delayNotificationStreamRetry(userId, Date.now());
        if (retryTimer !== undefined) window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => {
          if (stream === candidate) stream = null;
          retryTimer = undefined;
          openStream();
        }, Math.max(0, nextLocalAttemptAt - Date.now()));
      };
      candidate.addEventListener('open', handleOpen);
      candidate.addEventListener('ready', handleOpen);
      candidate.addEventListener('notification', handleNotification);
      candidate.addEventListener('error', handleError);
    };

    openStream();
    const streamCoordinator = window.setInterval(() => {
      const now = Date.now();
      if (stream) renewNotificationStreamLease(userId, now);
      else openStream();
    }, NOTIFICATION_STREAM_CHECK_MS);
    const handleVisibility = () => { if (document.visibilityState === 'visible') rehydrate(); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(streamCoordinator);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      stream?.close();
      releaseNotificationStreamLease(userId);
    };
  }, [auth.user, notifications.refetch]);
  useEffect(() => {
    if (!auth.user) return;
    const refreshNotifications = (message: NotificationSyncMessage) => {
      if (message.userId === auth.user?.id && message.source !== NOTIFICATION_TAB_ID) {
        void notifications.refetch().then((result) => {
          if (result.data) queryClient.setQueryData(['worky-notifications'], result.data);
        });
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== NOTIFICATION_SYNC_KEY || !event.newValue) return;
      try {
        refreshNotifications(JSON.parse(event.newValue) as NotificationSyncMessage);
      } catch {
        // Ignorar eventos inválidos de otras versiones.
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [auth.user, notifications.refetch]);
  const markNotificationAsRead = async (item: { id: number; titulo: string }) => {
    setRetryingNotificationId(item.id);
    try {
      await markNotificationRead(item.id, () => {
        void queryClient.invalidateQueries({ queryKey: ['worky-notifications'] });
        publishNotificationSync(auth.user!.id);
      });
      setNotificationReadFailures((current) => {
        const next = new Map(current);
        next.delete(item.id);
        return next;
      });
    } catch {
      setNotificationReadFailures((current) => new Map(current).set(item.id, { id: item.id, title: item.titulo }));
    } finally {
      setRetryingNotificationId(null);
    }
  };
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);
  const navItems = [
    ...(shouldShowProfessionalSearch(role) ? [{ href: '/home', label: 'Encontrar profesionales', icon: Search }] : []),
    { href: '/jobs', label: 'Mis changas', icon: BriefcaseBusiness },
     { href: '/conversations', label: 'Conversaciones', icon: MessageCircle },
    ...(role === 'professional' ? [
      { href: '/profile', label: 'Mi perfil', icon: UserRound },
      { href: '/services', label: 'Mis servicios', icon: BriefcaseBusiness },
    ] : []),
  ];
  return <div className="app-shell grain flex bg-[hsl(var(--background))]">
      <aside aria-label="Menú principal de Worky" className={`fixed inset-y-0 left-0 z-30 flex w-[258px] flex-col overflow-hidden bg-[hsl(var(--sidebar))] px-5 py-6 text-[hsl(var(--sidebar-foreground))] transition-transform duration-300 md:fixed md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="brand-surface -mx-5 -mt-6 mb-6 flex min-h-[68px] items-center justify-between px-5 py-3"><Brand light /><button onClick={() => setMobileOpen(false)} className="text-white/75 md:hidden" aria-label="Cerrar menú" data-testid="button-close-menu"><X size={20} /></button></div>
       <div className="mb-5 rounded-2xl border border-white/10 bg-white/[.06] p-3"><div className="flex items-center gap-3"><Avatar name={accountName} initials={profile?.initials} size="sm" warm /><div className="min-w-0"><p className="truncate text-xs font-bold">{accountName}</p><p className="mt-0.5 text-[11px] text-white/55">{role === 'professional' ? 'Profesional' : 'Cliente'}</p></div></div>{canSwitchRole && switchTargetRole ? <button onClick={switchRole} className="focus-ring mt-3 flex w-full flex-nowrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[.04] px-2.5 py-2 text-[11px] font-bold text-[hsl(var(--accent))] transition-colors hover:border-[hsl(var(--accent)/.35)] hover:bg-white/[.08]" data-testid="button-switch-role"><span className="whitespace-nowrap">{switchLabel}</span><ChevronRight size={13} /></button> : null}</div>
      <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.17em] text-white/35">Tu espacio</p>
       <nav aria-label="Navegación principal" className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">{navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`nav-link focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${location === href ? 'bg-[hsl(var(--sidebar-accent))] text-white' : 'text-white/65 hover:bg-white/[.07] hover:text-white'}`} data-testid={`link-nav-${href.slice(1).replace('/', '-')}`}><Icon size={18} strokeWidth={location === href ? 2.5 : 2} /><span>{label}</span>{href === '/jobs' && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />}</Link>)}{role === 'professional' && <Link href="/partner/dashboard" onClick={() => setMobileOpen(false)} className={`nav-link focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${location === '/partner/dashboard' ? 'bg-[hsl(var(--sidebar-accent))] text-white' : 'text-white/65 hover:bg-white/[.07] hover:text-white'}`} data-testid="link-nav-partner-dashboard"><LayoutDashboard size={18} /> <span>Panel Partner</span></Link>}</nav>
        {showPartnerSignupCta && <div className="shrink-0 pt-3"><div className="rounded-2xl bg-[hsl(var(--primary))] p-3.5 text-[hsl(var(--primary-foreground))]"><Sparkles size={18} /><p className="mt-2 text-sm font-bold leading-snug">La changa justa, con gente de confianza.</p><p className="mt-1 text-[11px] leading-relaxed opacity-75">Todo empieza cerca de casa.</p><Link href="/partner" onClick={() => setMobileOpen(false)} className="focus-ring mt-2 flex items-center justify-between rounded-xl bg-black/10 px-3 py-2 text-xs font-bold transition-colors hover:bg-black/20" data-testid="link-offer-services"><span>Ofrecer mis servicios</span><ChevronRight size={14} /></Link></div></div>}
          <div className="mt-4 mb-2 shrink-0">
           <Link href="/settings" onClick={() => setMobileOpen(false)} className={`nav-link focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${location === '/settings' ? 'bg-[hsl(var(--sidebar-accent))] text-white' : 'text-white/65 hover:bg-white/[.07] hover:text-white'}`} data-testid="link-nav-settings">
             <Settings size={18} /><span>Configuración</span>
           </Link>
         </div>
        <button onClick={() => { void auth.logout(); setLocation('/'); }} className="mt-1 flex shrink-0 items-center gap-2 px-3 pb-1 text-xs font-bold text-white/45 hover:text-white" data-testid="button-logout"><LockKeyhole size={14} /> Salir de Worky</button>
    </aside>
    {mobileOpen && <button aria-label="Cerrar menú" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-20 bg-[hsl(var(--secondary)/.45)] md:hidden" data-testid="button-menu-overlay" />}
          <main className="min-w-0 flex-1 md:ml-[258px]">
            <header className="relative flex h-[76px] items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/.85)] px-5 backdrop-blur md:px-10">
              <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-white md:hidden md:text-[hsl(var(--foreground))]" aria-label="Abrir menú" data-testid="button-open-menu"><Menu size={22} /></button>
              <div className="md:hidden"><Brand light /></div>
              <div className="ml-auto flex items-center gap-3">
                <button
                  ref={notificationButtonRef}
                  aria-label="Notificaciones"
                  aria-expanded={showNotifications}
                  aria-controls="worky-notifications-panel"
                  onClick={() => setShowNotifications((open) => !open)}
                  className="relative rounded-xl p-2.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                  data-testid="button-notifications"
                >
                  <Bell size={19} />
                  {Boolean(notifications.data?.unread) && <span data-testid="notification-unread-count" className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--primary))] px-1 text-[9px] font-bold text-white">{notifications.data?.unread}</span>}
                </button>
                <Link href="/profile" className="focus-ring flex items-center gap-2" data-testid="link-header-profile"><Avatar name={accountName} initials={profile?.initials} size="sm" warm /><span className="hidden text-xs font-bold sm:block">Mi perfil</span></Link>
              </div>
              {showNotifications && (
                <div
                  ref={notificationPanelRef}
                  id="worky-notifications-panel"
                  role="region"
                  aria-label="Notificaciones"
                  className="absolute right-5 top-[66px] z-40 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-2xl md:right-10"
                >
                  <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-2 pb-3">
                    <p className="display-font font-bold">Notificaciones</p>
                    <button className="text-[10px] font-bold text-[hsl(var(--primary))]" onClick={() => { void apiRequest('/notificaciones/leidas', { method: 'POST' }).then(() => notifications.refetch()); }}>Marcar leídas</button>
                  </div>
                  {!notifications.data?.items.length
                    ? <p className="px-2 py-6 text-center text-xs text-[hsl(var(--muted-foreground))]">No tenés novedades.</p>
                    : <div className="max-h-72 overflow-auto">
                      {notifications.data.items.slice(0, 6).map((item) => {
                        const className = `block border-b border-[hsl(var(--border))] px-2 py-3 last:border-0 ${item.leida ? 'opacity-55' : ''} ${item.href ? 'cursor-pointer hover:bg-[hsl(var(--muted)/.55)]' : ''}`;
                        const content = <><p className="text-xs font-bold">{item.titulo}</p><p className="mt-1 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">{item.detalle}</p>{item.href && <p className="mt-2 text-[10px] font-bold text-[hsl(var(--primary))]">Abrir conversación <ChevronRight size={12} className="inline" /></p>}</>;
                        return item.href
                          ? <Link key={item.id} href={item.href} onClick={() => { setShowNotifications(false); if (!item.leida) void markNotificationAsRead(item); }} className={className} data-testid={`notification-${item.id}`}>{content}</Link>
                          : <div key={item.id} className={className} data-testid={`notification-${item.id}`}>{content}</div>;
                      })}
                    </div>}
                </div>
              )}
              {notificationReadFailures.size > 0 && <div className="absolute left-5 right-5 top-[82px] z-30 flex flex-col gap-2 md:left-auto md:right-10 md:max-w-[360px]">{Array.from(notificationReadFailures.values()).map((failure) => <div key={failure.id} className="flex items-center gap-3 rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--card))] px-4 py-3 text-xs shadow-lg" role="alert" data-testid={`notification-read-error-${failure.id}`}><CircleAlert size={16} className="shrink-0 text-[hsl(var(--destructive))]" /><p className="min-w-0 flex-1 text-[hsl(var(--muted-foreground))]">No pudimos marcar “{failure.title}” como leída. Revisá tu conexión.</p><button onClick={() => { void markNotificationAsRead({ id: failure.id, titulo: failure.title }); }} disabled={retryingNotificationId === failure.id} className="shrink-0 font-bold text-[hsl(var(--primary))] disabled:opacity-50" data-testid={`button-retry-notification-read-${failure.id}`}>{retryingNotificationId === failure.id ? <LoaderCircle size={15} className="animate-spin" aria-label="Reintentando" /> : <><RefreshCw size={14} className="mr-1 inline" />Reintentar</>}</button></div>)}</div>}
            </header>
            <div className="page-enter mx-auto max-w-[1440px] px-5 py-7 md:px-10 md:py-10">{role === 'professional'
              ? <PartnerApprovalGate allowEditing={location === '/partner'}>{children}</PartnerApprovalGate>
              : children}</div>
          </main>
  </div>;
}

function AuthPageLegacy({ setRole }: { setRole: (role: Role) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [role, setLocalRole] = useState<Role>('client');
  const auth = useAuth();
  const [error, setError] = useState('');
  const [, setLocation] = useLocation();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      if (mode === 'login') {
        const result = await auth.login(String(values.get('email')), String(values.get('password')));
        if ('requiresTwoFactor' in result) {
          setError(`Ingresá el código enviado a ${result.maskedEmail} desde la pantalla de verificación.`);
          return;
        }
      }
      else {
        setError('Usá el registro actualizado para crear tu cuenta.');
        return;
      }
      setRole('client');
      setLocation('/home');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos ingresar. Intentá nuevamente.');
    }
  };
  return <div className="grain flex min-h-[100dvh] flex-col bg-[hsl(var(--secondary))] text-white md:flex-row"><section className="relative hidden w-[46%] overflow-hidden p-12 md:flex md:flex-col"><Brand light /><div className="relative my-auto max-w-md"><p className="eyebrow !text-[hsl(var(--accent))]">La red que mueve tu barrio</p><h1 className="display-font mt-4 text-5xl font-bold leading-[.98] tracking-[-.06em]">Cuando hace falta,<br /><span className="text-[hsl(var(--accent))]">aparece alguien.</span></h1><p className="mt-6 max-w-sm text-base leading-relaxed text-white/65">Una cuenta para encontrar, contratar, ofrecer y recomendar.</p></div></section><section className="flex flex-1 items-center justify-center px-5 py-10"><div className="w-full max-w-[430px]"><div className="mb-10 md:hidden"><Brand light /></div><div className="mb-8"><p className="eyebrow !text-[hsl(var(--accent))]">{mode === 'login' ? 'Volvé a tu red' : 'Unite a Worky'}</p><h2 className="display-font mt-3 text-4xl font-bold tracking-[-.06em]">{mode === 'login' ? 'Hola de nuevo.' : 'Empecemos cerca.'}</h2><p className="mt-3 text-sm text-white/60">{mode === 'login' ? 'Ingresá para seguir con tus changas.' : 'Una cuenta para encontrar, ofrecer y recomendar.'}</p></div><form onSubmit={submit} className="space-y-4">{mode === 'register' && <label className="block"><span className="label !text-white/75">Cómo te llamás</span><input name="name" autoComplete="name" className="field border-white/15 bg-white/[.08] text-white placeholder:text-white/35" required placeholder="Tu nombre y apellido" data-testid="input-auth-name" /></label>}<label className="block"><span className="label !text-white/75">Tu email</span><input name="email" autoComplete="email" className="field border-white/15 bg-white/[.08] text-white placeholder:text-white/35" type="email" required placeholder="nombre@correo.com" data-testid="input-auth-email" /></label><label className="block"><span className="label !text-white/75">Contraseña</span><input name="password" autoComplete={mode === 'login' ? "current-password" : "new-password"} className="field border-white/15 bg-white/[.08] text-white placeholder:text-white/35" type="password" required placeholder="Al menos 6 caracteres" minLength={6} data-testid="input-auth-password" /></label>{error && <p className="text-xs font-semibold text-[hsl(var(--accent))]">{error}</p>}<Button type="submit" variant="soft" className="mt-3 w-full py-3.5" disabled={auth.isLoading} testId="button-auth-submit">{mode === 'login' ? 'Entrar a Worky' : 'Crear mi cuenta'} <ChevronRight size={17} /></Button></form><div className="my-7 flex items-center gap-3 text-[11px] text-white/35"><span className="h-px flex-1 bg-white/10" /> acceso simple y seguro <span className="h-px flex-1 bg-white/10" /></div><p className="text-center text-sm text-white/55">{mode === 'login' ? '¿Todavía no tenés cuenta?' : '¿Ya tenés una cuenta?'} <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="font-bold text-[hsl(var(--accent))]" data-testid="button-toggle-auth">{mode === 'login' ? 'Registrate' : 'Ingresá'}</button></p><p className="mt-7 text-center text-[11px] leading-relaxed text-white/35">Al continuar aceptás nuestras condiciones de uso.<br />Tu información queda protegida.</p></div></section></div>;
}

function AuthPage({ setRole }: { setRole: (role: Role) => void }) {
  const auth = useAuth();
  const [currentLocation, navigate] = useLocation();
  const isAdminEntry = currentLocation === '/admin' || currentLocation === '/admin/verificaciones';
  const [resetToken, setResetToken] = useState(() => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('resetToken'));
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'reset' | 'verify' | 'two_factor'>(() => resetToken ? 'reset' : 'login');
  const [draft] = useState(() => readRegistrationDraft());
  const [step, setStep] = useState(draft?.step ?? 1);
  const [role, setRoleLocal] = useState<Role>(draft?.role ?? 'client');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<AuthLoginChallenge | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [verificationCodeSent, setVerificationCodeSent] = useState(false);
  const [registrationVerificationPending, setRegistrationVerificationPending] = useState(false);
  const [sendingVerificationCode, setSendingVerificationCode] = useState(false);
  const setLocation = (next: string) => {
    if (next === '/') {
      setResetToken(null);
      setMode('login');
      setStep(1);
      setError('');
      setSuccess('');
      setVerificationEmail('');
      setVerificationCode('');
      setVerificationCodeSent(false);
      setRegistrationVerificationPending(false);
      setTwoFactorChallenge(null);
      setTwoFactorCode('');
    }
    navigate(next);
  };
  const [data, setData] = useState<RegistrationData>({ name: draft?.data.name ?? '', email: draft?.data.email ?? '', phone: draft?.data.phone ?? '', password: '', confirm: '', address: draft?.data.address ?? '', city: draft?.data.city ?? '', province: draft?.data.province ?? '', age: draft?.data.age ?? '', shopCoordinates: draft?.data.shopCoordinates ?? null });
  const [answers, setAnswers] = useState<Record<string, string>>(draft?.answers ?? {});
  const [services, setServices] = useState(draft?.services ?? [{ oficio: '', categoria: 'Plomería', experienciaAnios: 0 }]);
  const [docs, setDocs] = useState<RegistrationDraft['docs']>(draft?.docs ?? {});
  const [photo, setPhoto] = useState<{ objectPath?: string; preview: string; file?: File } | null>(draft?.photo ? { ...draft.photo, preview: '' } : null);
  const [uploading, setUploading] = useState('');
  const [failedFiles, setFailedFiles] = useState<Record<string, File>>({});
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File>>({});
  useEffect(() => {
    saveRegistrationDraft({
      step, role,
      data: { name: data.name, email: data.email, phone: data.phone, address: data.address, city: data.city, province: data.province, age: data.age, shopCoordinates: data.shopCoordinates },
      answers, services, docs, photo: photo?.objectPath ? { objectPath: photo.objectPath } : null,
    });
  }, [step, role, data, answers, services, docs, photo]);
  const change = (key: string, value: string) => {
    setData((current) => ({ ...current, [key]: value }));
  };
  const file = async (key: string, picked?: File) => {
    if (!picked) return;
    setError('');
    setFailedFiles((current) => { const next = { ...current }; delete next[key]; return next; });
    setSelectedFiles((current) => ({ ...current, [key]: picked }));
    if (key === 'photo') setPhoto({ preview: URL.createObjectURL(picked), file: picked });
    else setDocs((current) => ({ ...current, [key]: { objectPath: '', name: picked.name, contentType: picked.type || 'application/octet-stream', sizeBytes: picked.size } }));
  };
  const retryFile = (key: string) => {
    const picked = failedFiles[key];
    if (picked) void file(key, picked);
  };
  const finish = async () => {
    setError('');
    if (data.password.length < 6 || data.password !== data.confirm) { setError('La contraseña debe tener 6 caracteres y coincidir.'); return; }
    if (!photo?.file && !photo?.objectPath) { setError('Subí una foto de perfil para continuar.'); return; }
    const validServices = services.filter((item) => item.oficio.trim());
    if (role === 'professional' && !validServices.length) { setError('Agregá al menos un oficio.'); return; }

    setBusy(true);
    try {
      await auth.register({ nombre: data.name, email: data.email, password: data.password, telefono: data.phone, edad: Number(data.age), rol: role === 'professional' ? 'profesional' : 'cliente', ubicacion: { direccion: data.address, ciudad: data.city, provincia: data.province } });
      setVerificationEmail(data.email.trim().toLowerCase());
      setVerificationCode('');
      setRegistrationVerificationPending(true);
      setVerificationCodeSent(true);
      setSuccess('Te enviamos un código de 6 dígitos. Ingresalo para activar tu cuenta.');
      setMode('verify');
    } catch (cause) {
      if (cause instanceof WorkyApiError && ['EMAIL_VERIFICATION_DELIVERY_FAILED', 'EMAIL_VERIFICATION_THROTTLED'].includes(cause.code ?? '')) {
        setVerificationEmail(data.email.trim().toLowerCase());
        setVerificationCode('');
        setRegistrationVerificationPending(true);
        setVerificationCodeSent(false);
        setSuccess('');
        setMode('verify');
        setError(cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : 'No pudimos crear tu cuenta.');
      }
    } finally {
      setBusy(false);
    }
  };

  const finishRegistrationSetup = async () => {
    const validServices = services.filter((item) => item.oficio.trim());
    if (photo?.file) {
      const uploadedPhoto = await uploadWorkyFile(photo.file, 'profile_photo');
      await apiRequest('/auth/profile-photo', { method: 'POST', body: JSON.stringify({ objectPath: uploadedPhoto.objectPath }) });
    }
    if (role === 'professional') {
      await apiRequest('/partner-profile', { method: 'POST', body: JSON.stringify({
        oficio: validServices[0].oficio,
        categoria: validServices[0].categoria,
        experienciaAnios: validServices[0].experienciaAnios,
        precioReferencia: 0,
        skills: validServices.map((item) => item.oficio),
        ubicacionFija: {
          direccionTexto: data.address.trim(),
          ciudad: data.city.trim(),
          provincia: data.province.trim() || null,
          ...(data.shopCoordinates ? { coordinates: data.shopCoordinates } : {}),
        },
      }) });
      await apiRequest('/auth/professional-services', { method: 'PUT', body: JSON.stringify({ services: validServices }) });
      for (const [tipo, document] of Object.entries(docs)) {
        const selected = selectedFiles[tipo];
        const uploaded = selected ? await uploadWorkyFile(selected) : null;
        const objectPath = uploaded?.objectPath || document.objectPath;
        if (objectPath) await apiRequest(`/auth/verification-documents/${tipo}`, { method: 'PUT', body: JSON.stringify({ objectPath, nombre: document.name, contentType: document.contentType, sizeBytes: document.sizeBytes }) });
      }
    }
    await apiRequest('/auth/onboarding', { method: 'PATCH', body: JSON.stringify({ estado: role === 'professional' ? 'professional_verification_pending' : 'onboarding_completed', paso: 3, respuestas: answers }) });
    clearRegistrationDraft();
    await auth.refreshUser();
    await queryClient.invalidateQueries();
    setRole(role);
    setLocation('/home');
  };

  const requestVerificationCode = async () => {
    setError('');
    setSuccess('');
    setSendingVerificationCode(true);
    try {
      await auth.requestRegistrationCode(verificationEmail);
      setVerificationCodeSent(true);
      setSuccess('Te enviamos un código de verificación a tu email.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos enviar el código. Intentá nuevamente.');
    } finally {
      setSendingVerificationCode(false);
    }
  };

  const verificationSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!/^\d{6}$/.test(verificationCode)) {
      setError('Ingresá el código de 6 dígitos que recibiste por email.');
      return;
    }
    setBusy(true);
    try {
      const verifiedUser = await auth.confirmRegistration(verificationEmail, verificationCode);
      if (registrationVerificationPending) {
        await finishRegistrationSetup();
      } else {
        setRole(verifiedUser.rol === 'profesional' ? 'professional' : verifiedUser.rol === 'admin' ? 'admin' : 'client');
        await auth.refreshUser();
        setLocation(currentLocation === '/admin' || currentLocation === '/admin/verificaciones' ? currentLocation : '/home');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos verificar el código.');
    } finally {
      setBusy(false);
    }
  };

  const loginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    try {
      const result = await auth.login(data.email, data.password);
      if ('requiresTwoFactor' in result) {
        setTwoFactorChallenge(result);
        setTwoFactorCode('');
        setData((current) => ({ ...current, password: '' }));
        setSuccess(`Te enviamos un código a ${result.maskedEmail}.`);
        setMode('two_factor');
        return;
      }
      const signedInUser = result;
      setRole(signedInUser.rol === 'profesional' ? 'professional' : signedInUser.rol === 'admin' ? 'admin' : 'client');
      setLocation(currentLocation === '/admin' || currentLocation === '/admin/verificaciones' ? currentLocation : '/home');
    } catch (cause) {
      if (cause instanceof WorkyApiError && cause.code === 'EMAIL_NOT_VERIFIED') {
        const email = data.email.trim().toLowerCase();
        const alreadyPendingSignup = registrationVerificationPending && verificationEmail === email;
        setVerificationEmail(email);
        setVerificationCode('');
        setVerificationCodeSent(false);
        setRegistrationVerificationPending(alreadyPendingSignup);
        setSuccess('Tu cuenta necesita verificar el email antes de ingresar.');
        setMode('verify');
      } else {
        setError(cause instanceof Error ? cause.message : 'No pudimos ingresar. Intentá nuevamente.');
      }
    }
  };
  const twoFactorSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!twoFactorChallenge || !/^\d{6}$/.test(twoFactorCode)) {
      setError('Ingresá el código de 6 dígitos enviado a tu email.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const signedInUser = await auth.verifyTwoFactorLogin(twoFactorChallenge.challengeId, twoFactorCode);
      setTwoFactorChallenge(null);
      setTwoFactorCode('');
      setRole(signedInUser.rol === 'profesional' ? 'professional' : signedInUser.rol === 'admin' ? 'admin' : 'client');
      setLocation(currentLocation === '/admin' || currentLocation === '/admin/verificaciones' ? currentLocation : '/home');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos verificar el código.');
    } finally {
      setBusy(false);
    }
  };
  const recoverySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const response = await requestPasswordRecovery(data.email);
      setSuccess(response.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos procesar la solicitud.');
    } finally {
      setBusy(false);
    }
  };
  const resetSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!resetToken) {
      setError('El enlace de recuperación no es válido.');
      return;
    }
    if (data.password.length < 8 || data.password !== data.confirm) {
      setError('La contraseña debe tener al menos 8 caracteres y coincidir.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(resetToken, data.password);
      setResetToken(null);
      window.history.replaceState({}, '', window.location.pathname);
      setData((current) => ({ ...current, password: '', confirm: '' }));
      setMode('login');
      setSuccess('Tu contraseña fue actualizada. Ya podés ingresar.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos cambiar la contraseña.');
    } finally {
      setBusy(false);
    }
  };
  const input = (key: string, label: string, type = 'text', required = true) => {
    const id = `input-auth-${key}`;
    const commonProps = {
      id,
      value: String(data[key as keyof typeof data] ?? ''),
      onChange: (event: ChangeEvent<HTMLInputElement>) => change(key, event.target.value),
      autoComplete: key === 'email' ? 'email' : key === 'password' ? (mode === 'login' ? 'current-password' : 'new-password') : key === 'confirm' ? 'new-password' : undefined,
      required,
      className: 'field border-white/15 bg-white/[.08] text-white placeholder:text-white/35',
      'data-testid': `input-auth-${key}`,
    };
    const field = type === 'password' && mode !== 'reset'
      ? <PasswordInput {...commonProps} />
      : <input {...commonProps} type={type} />;

    return (
      <div className="block">
        <label htmlFor={id} className="label !text-white/75">{label}</label>
        {field}
      </div>
    );
  };
  const altaGraciaZones = ['Norte', 'Carlos Pellegrini (Alto)', 'Barrio Cámara', 'Barrio Sur', 'Otra zona'];
  const onboardingOptions: Record<string, string[]> = {
    zona: altaGraciaZones,
    preferencia: ['Rapidez', 'Precio claro', 'Experiencia', 'Recomendaciones'],
    frecuencia: ['Una vez', 'Todas las semanas', 'Todos los meses', 'Cuando surge una urgencia'],
    tipoTrabajo: ['Mantenimiento', 'Reparaciones', 'Instalaciones', 'Urgencias', 'Otro tipo de trabajo'],
    zonaTrabajo: altaGraciaZones,
    objetivo: ['Conseguir más changas', 'Organizar mejor mi trabajo', 'Mostrar mi experiencia', 'Construir reputación en Worky'],
  };
  const question = (key: string, label: string) => {
    const options = onboardingOptions[key];
    const storedAnswer = answers[key] || '';
    const selected = options && !options.includes(storedAnswer) && !storedAnswer.startsWith('Otro:')
      ? ''
      : storedAnswer;
    const isOther = selected.startsWith('Otro:') || /^(otra|otro)/i.test(selected);
    return options ? <fieldset className="block"><legend className="label !text-white/75">{label}</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{options.map((option) => { const active = option === selected || (isOther && /^(otra|otro)/i.test(option)); return <button type="button" key={option} onClick={() => setAnswers((current) => ({ ...current, [key]: active && isOther ? '' : option }))} className={`rounded-xl border px-3.5 py-3 text-left text-sm font-semibold transition-colors ${active ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/.18)] text-white' : 'border-white/15 bg-white/[.04] text-white/75 hover:bg-white/[.09]'}`}>{option}{active && <span className="float-right text-[hsl(var(--accent))]">✓</span>}</button>; })}</div>{isOther && <input autoFocus value={selected.startsWith('Otro:') ? selected.replace(/^Otro:\s*/, '') : ''} onChange={(event) => setAnswers((current) => ({ ...current, [key]: `Otro: ${event.target.value}` }))} placeholder="Contanos cuál" required className="field mt-3 border-white/15 bg-white/[.08] text-white placeholder:text-white/35" />}{!isOther && <input tabIndex={-1} aria-hidden="true" value={selected} onChange={() => undefined} required className="sr-only" />}</fieldset> : <label className="block"><span className="label !text-white/75">{label}</span><input value={selected} onChange={(event) => setAnswers((current) => ({ ...current, [key]: event.target.value }))} required className="field border-white/15 bg-white/[.08] text-white" /></label>;
  };
  useEffect(() => {
    if (step !== 2 || role !== 'professional') return;
    const form = document.querySelector('body:has(input[placeholder="Oficio"]) form');
    if (!form) return;
    form.querySelectorAll<HTMLInputElement>('input[placeholder="Oficio"]').forEach((input, index) => {
      const row = input.parentElement;
      if (!row || row.dataset.serviceRow) return;
      const experience = row.querySelector<HTMLInputElement>('input[type="number"]');
      if (experience?.value === '0') experience.value = '';
      row.dataset.serviceRow = 'true';
      row.classList.add('service-row');
      const labels = document.createElement('div');
      labels.dataset.serviceLabels = 'true';
      labels.innerHTML = '<span>Oficio</span><span>Categoría</span><span>Años de experiencia</span>';
      row.prepend(labels);
      if (index > 0) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'service-remove';
        remove.textContent = 'Eliminar oficio';
        remove.onclick = () => setServices((current) => current.filter((_, serviceIndex) => serviceIndex !== index));
        row.append(remove);
      }
    });
  }, [step, role, services.length]);
  useEffect(() => {
    if (mode !== 'register') return;
    const form = document.querySelector<HTMLFormElement>('.grain form');
    if (!form) return;
    const validateBeforeAdvance = (event: Event) => {
      const currentForm = event.currentTarget as HTMLFormElement;
      if (step === 3) {
        if (role === 'professional') {
          const requiredDocuments = ['dni_frente', 'dni_dorso', 'antecedentes_penales'];
          const missingDocument = requiredDocuments.some((type) => !docs[type] && !selectedFiles[type]);
          if (missingDocument) {
            event.preventDefault();
            event.stopPropagation();
            setError('Subí todos los documentos solicitados para continuar.');
          }
        }
        return;
      }
      if (step === 1) {
        const requiredFields = Array.from(currentForm.querySelectorAll<HTMLInputElement>('input[required]'));
        const missingField = requiredFields.some((field) => field.type !== 'file' && !field.value.trim());
        if (missingField || !photo?.file) {
          event.preventDefault();
          event.stopPropagation();
          setError(missingField ? 'Completá todos los campos del primer paso.' : 'Subí una foto de perfil para continuar.');
          return;
        }
      }
      if (step === 2) {
        const missingService = role === 'professional' && Array.from(currentForm.querySelectorAll<HTMLInputElement>('input[placeholder="Oficio"]')).some((field) => !field.value.trim() || !(field.parentElement?.querySelector('input[type="number"]') as HTMLInputElement | null)?.value.trim());
        if (!currentForm.checkValidity() || missingService) {
          event.preventDefault();
          event.stopPropagation();
          setError(role === 'professional' ? 'Completá oficio, categoría y años de experiencia en cada fila.' : 'Elegí una opción en cada pregunta.');
        }
      }
    };
    form.addEventListener('submit', validateBeforeAdvance, true);
    return () => form.removeEventListener('submit', validateBeforeAdvance, true);
  }, [mode, step, role, photo, docs, selectedFiles]);
  const authLayout = (content: ReactNode) => (
    <div className="grain flex min-h-[100dvh] flex-col bg-[hsl(var(--secondary))] text-white md:flex-row">
      <section className="relative hidden w-[46%] overflow-hidden p-12 md:flex md:flex-col">
        <Brand light />
        <div className="relative my-auto max-w-md">
          <p className="eyebrow !text-[hsl(var(--accent))]">La red que mueve tu barrio</p>
          <h1 className="display-font mt-4 text-5xl font-bold leading-[.98] tracking-[-.06em]">Cuando hace falta,<br /><span className="text-[hsl(var(--accent))]">aparece alguien.</span></h1>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-white/65">Una cuenta para encontrar, contratar, ofrecer y recomendar.</p>
        </div>
      </section>
      <section className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-[430px]">
          <div className="mb-8 md:hidden"><Brand light /></div>
          {isAdminEntry && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-white/15 bg-white/[.06] p-3.5 text-sm" role="status" data-testid="admin-login-context">
              <LayoutDashboard size={18} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" />
              <span><b className="block">Acceso a Worky Admin</b><span className="mt-1 block text-xs leading-relaxed text-white/65">Ingresá con tu cuenta Worky. Si ya tenés rol administrador, vas a entrar directamente al panel, sin un código adicional de acceso admin.</span></span>
            </div>
          )}
          {content}
        </div>
      </section>
    </div>
  );
  if (mode === 'verify') return authLayout(<>
    <div className="mb-8">
      <p className="eyebrow !text-[hsl(var(--accent))]">Un paso más</p>
      <h2 className="display-font mt-3 text-4xl font-bold tracking-[-.06em]">Confirmá tu email.</h2>
      <p className="mt-3 text-sm text-white/60">
        {verificationCodeSent ? 'Te enviamos un código de 6 dígitos a' : 'Necesitás un código para seguir. Podés pedirlo para'}
        {' '}<span className="font-semibold text-white">{verificationEmail}</span>.
      </p>
    </div>
    <form onSubmit={verificationSubmit} className="space-y-4">
      <label className="block">
        <span className="label !text-white/75">Código de verificación</span>
        <input
          value={verificationCode}
          onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="[0-9]{6}"
          required
          className="field border-white/15 bg-white/[.08] text-white placeholder:text-white/35"
          placeholder="000000"
          aria-label="Código de verificación de seis dígitos"
          data-testid="input-email-verification-code"
        />
      </label>
      {error && <p className="text-xs font-semibold text-[hsl(var(--accent))]" role="alert">{error}</p>}
      {success && <p className="rounded-xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.12)] p-3 text-xs font-semibold text-[hsl(var(--accent))]" role="status">{success}</p>}
      <Button type="submit" variant="soft" className="w-full py-3.5" disabled={busy || sendingVerificationCode || verificationCode.length !== 6 || !verificationEmail} testId="button-confirm-email-verification">
        {busy ? <LoaderCircle className="animate-spin" size={17} /> : null} Confirmar email <ChevronRight size={17} />
      </Button>
    </form>
    <Button type="button" variant="ghost" className="mt-3 w-full text-white" disabled={busy || sendingVerificationCode || !verificationEmail} onClick={() => void requestVerificationCode()} testId="button-request-email-verification">
      {sendingVerificationCode ? <LoaderCircle className="animate-spin" size={17} /> : null}
      {verificationCodeSent ? 'Reenviar código' : 'Enviar código'} <ChevronRight size={17} />
    </Button>
    <p className="mt-7 text-center text-sm text-white/55">
      ¿Ya tenés un código? Revisá también la carpeta de spam.
      <br />
      <button type="button" onClick={() => { setMode('login'); setError(''); setSuccess(''); }} className="mt-3 font-bold text-[hsl(var(--accent))]">Volver a ingresar</button>
    </p>
  </>);
  if (mode === 'two_factor') return authLayout(<><div className="mb-8"><p className="eyebrow !text-[hsl(var(--accent))]">Segundo paso de seguridad</p><h2 className="display-font mt-3 text-4xl font-bold tracking-[-.06em]">Confirmá que sos vos.</h2><p className="mt-3 text-sm text-white/60">Ingresá el código enviado a <b className="text-white">{twoFactorChallenge?.maskedEmail}</b>.</p></div><form onSubmit={twoFactorSubmit} className="space-y-4"><label className="block"><span className="label !text-white/75">Código de seguridad</span><input value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className="field border-white/15 bg-white/[.08] text-white placeholder:text-white/35 tracking-[.3em]" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="000000" data-testid="input-two-factor-code" /></label>{error && <p className="text-xs font-semibold text-[hsl(var(--accent))]" role="alert">{error}</p>}{success && <p className="rounded-xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.12)] p-3 text-xs font-semibold text-[hsl(var(--accent))]" role="status">{success}</p>}<Button type="submit" variant="soft" className="w-full py-3.5" disabled={busy || twoFactorCode.length !== 6 || !twoFactorChallenge} testId="button-confirm-two-factor">{busy ? <LoaderCircle className="animate-spin" size={17} /> : null} Verificar e ingresar <ChevronRight size={17} /></Button></form><p className="mt-7 text-center text-sm text-white/55"><button type="button" onClick={() => { setTwoFactorChallenge(null); setTwoFactorCode(''); setMode('login'); setError(''); setSuccess(''); }} className="font-bold text-[hsl(var(--accent))]" data-testid="button-back-from-two-factor">Volver a ingresar</button></p></>);
  if (mode === 'forgot') return authLayout(<><div className="mb-8"><p className="eyebrow !text-[hsl(var(--accent))]">Recuperá el acceso</p><h2 className="display-font mt-3 text-4xl font-bold tracking-[-.06em]">Verifiquemos tu email.</h2><p className="mt-3 text-sm text-white/60">Te vamos a enviar un enlace para crear una contraseña nueva.</p></div><form onSubmit={recoverySubmit} className="space-y-4">{input('email', 'Tu email', 'email')}{error && <p className="text-xs font-semibold text-[hsl(var(--accent))]" role="alert">{error}</p>}{success && <p className="rounded-xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.12)] p-3 text-xs font-semibold text-[hsl(var(--accent))]" role="status">{success}</p>}<Button type="submit" variant="soft" className="mt-3 w-full py-3.5" disabled={busy} testId="button-request-password-recovery">{busy ? <LoaderCircle className="animate-spin" size={17} /> : null} Enviar enlace <ChevronRight size={17} /></Button></form><p className="mt-7 text-center text-sm text-white/55"><button type="button" onClick={() => setLocation('/')} className="font-bold text-[hsl(var(--accent))]" data-testid="button-back-to-login">Volver a ingresar</button></p></>);
  if (mode === 'reset') return authLayout(<><div className="mb-8"><p className="eyebrow !text-[hsl(var(--accent))]">Enlace verificado</p><h2 className="display-font mt-3 text-4xl font-bold tracking-[-.06em]">Elegí una contraseña nueva.</h2><p className="mt-3 text-sm text-white/60">Usá al menos 8 caracteres y no repitas tu contraseña anterior.</p></div><form onSubmit={resetSubmit} className="space-y-4">{input('password', 'Nueva contraseña', 'password')}{input('confirm', 'Repetí la contraseña', 'password')}{error && <p className="text-xs font-semibold text-[hsl(var(--accent))]" role="alert">{error}</p>}<Button type="submit" variant="soft" className="mt-3 w-full py-3.5" disabled={busy} testId="button-reset-password">{busy ? <LoaderCircle className="animate-spin" size={17} /> : null} Guardar contraseña <ChevronRight size={17} /></Button></form><p className="mt-7 text-center text-sm text-white/55"><button type="button" onClick={() => setLocation('/')} className="font-bold text-[hsl(var(--accent))]">Volver a ingresar</button></p></>);
  if (mode === 'login') return authLayout(<><div className="mb-8"><p className="eyebrow !text-[hsl(var(--accent))]">Volvé a tu red</p><h2 className="display-font mt-3 text-4xl font-bold tracking-[-.06em]">Hola de nuevo.</h2><p className="mt-3 text-sm text-white/60">Ingresá para seguir con tus changas.</p></div><form onSubmit={loginSubmit} className="space-y-4">{input('email', 'Tu email', 'email')}{input('password', 'Contraseña', 'password')}<div className="flex justify-end"><button type="button" onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }} className="text-xs font-bold text-[hsl(var(--accent))]" data-testid="button-forgot-password">¿Olvidaste tu contraseña?</button></div>{error && <p className="text-xs font-semibold text-[hsl(var(--accent))]" role="alert">{error}</p>}{success && <p className="rounded-xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.12)] p-3 text-xs font-semibold text-[hsl(var(--accent))]" role="status">{success}</p>}<Button type="submit" variant="soft" className="mt-3 w-full py-3.5" disabled={auth.isLoading} testId="button-auth-submit">Entrar a Worky <ChevronRight size={17} /></Button></form><div className="my-7 flex items-center gap-3 text-[11px] text-white/35"><span className="h-px flex-1 bg-white/10" /> acceso simple y seguro <span className="h-px flex-1 bg-white/10" /></div><p className="text-center text-sm text-white/55">¿Todavía no tenés cuenta? <button type="button" onClick={() => { setMode('register'); setStep(1); }} className="font-bold text-[hsl(var(--accent))]" data-testid="button-toggle-auth">Registrate</button></p><p className="mt-7 text-center text-[11px] leading-relaxed text-white/35">Tu información queda protegida.</p></>);
  return <div className="grain flex min-h-[100dvh] flex-col bg-[hsl(var(--secondary))] text-white md:flex-row">
    <section className="relative hidden w-[46%] overflow-hidden p-12 md:flex md:flex-col"><Brand light /><div className="relative my-auto max-w-md"><p className="eyebrow !text-[hsl(var(--accent))]">La red que mueve tu barrio</p><h1 className="display-font mt-4 text-5xl font-bold leading-[.98] tracking-[-.06em]">Cuando hace falta,<br /><span className="text-[hsl(var(--accent))]">aparece alguien.</span></h1><p className="mt-6 max-w-sm text-base leading-relaxed text-white/65">Una cuenta para encontrar, contratar, ofrecer y recomendar.</p></div></section>
    <section className="flex flex-1 items-center justify-center px-5 py-10"><div className="w-full max-w-[600px]">
      <div className="mb-7 md:hidden"><Brand light /></div>
      <div className="mb-5 flex items-center justify-between"><div><p className="eyebrow !text-[hsl(var(--accent))]">Unite a Worky</p><h2 className="display-font mt-2 text-4xl font-bold tracking-[-.06em]">Empecemos cerca.</h2></div><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">Paso {step} de 3</span></div>
      <div className="mb-6 h-1.5 rounded-full bg-white/10"><div className="h-full rounded-full bg-[hsl(var(--accent))] transition-all" style={{ width: `${step * 33.33}%` }} /></div>
      {role === 'professional' && <p className="mb-5 rounded-xl border border-white/20 p-3 text-sm" data-testid="professional-registration-flow">Creá tu cuenta → Verificá tu email → Esperá la revisión de tus documentos y la habilitación de un administrador.</p>}
      <form onSubmit={(event) => { event.preventDefault(); if (step < 3) setStep((current) => current + 1); else void finish(); }} className="space-y-4">
        {step === 1 && <>
          <div className="grid gap-4 sm:grid-cols-2">{input('name', 'Nombre y apellido')}{input('email', 'Email', 'email')}{input('phone', 'Teléfono', 'tel')}{input('age', 'Edad', 'number')}{input('password', 'Contraseña', 'password')}{input('confirm', 'Confirmar contraseña', 'password')}</div>
          <div className="grid gap-4 sm:grid-cols-3">{input('address', role === 'professional' ? 'Dirección exacta del taller' : 'Dirección')}{input('city', 'Ciudad')}{input('province', 'Provincia')}</div>
          {role === 'professional' && <div className="rounded-2xl border border-white/20 bg-white/[.06] p-4">
            <p className="text-sm font-bold">Ubicación de tu taller</p>
            <p className="mt-1 text-xs leading-relaxed text-white/65">La dirección exacta que ingresaste se mostrará en tu perfil público. Si estás en el taller, guardá el punto GPS para calcular distancias aproximadas; las coordenadas no se publican.</p>
            <Button type="button" variant="soft" className="mt-3" onClick={() => { setError(''); void captureBrowserCoordinates().then((shopCoordinates) => setData((current) => ({ ...current, shopCoordinates }))).catch((cause) => setError(cause instanceof Error ? cause.message : 'No pudimos obtener la ubicación.')); }} testId="button-capture-workshop-location">
              <LocateFixed size={16} /> {data.shopCoordinates ? 'Actualizar punto del taller' : 'Usar ubicación actual del taller'}
            </Button>
            {data.shopCoordinates && <p className="mt-2 text-xs font-semibold text-[hsl(var(--accent))]" role="status">Punto del taller guardado.</p>}
          </div>}
          <div><span className="label !text-white/75">Foto de perfil (opcional)</span><label className="inline-flex cursor-pointer items-center rounded-xl border border-dashed border-white/25 px-4 py-3 text-xs font-bold">{photo ? 'Reemplazar foto' : 'Subir foto'}<input type="file" accept="image/*" capture="user" className="hidden" onChange={(event) => void file('photo', event.target.files?.[0])} /></label>{photo && <span className="ml-3 inline-flex items-center gap-2"><img src={photo.preview} alt="Vista previa" className="h-12 w-12 rounded-xl object-cover" /><button type="button" className="text-xs text-[hsl(var(--accent))]" onClick={() => setPhoto(null)}>Eliminar</button></span>}</div>
          <div><span className="label !text-white/75">¿Cómo querés usar Worky?</span><div className="grid gap-3 sm:grid-cols-2">{[['client', 'Buscar ayuda'], ['professional', 'Ofrecer mis servicios']].map(([value, label]) => <button type="button" key={value} onClick={() => setRoleLocal(value as Role)} className={`rounded-2xl border p-4 text-left text-sm font-bold ${role === value ? 'border-[hsl(var(--accent))] bg-white/10' : 'border-white/15 bg-white/[.04]'}`}>{label}<span className="mt-1 block text-xs font-normal text-white/55">{value === 'client' ? 'Encontrá un Partner para tu changa.' : 'Creá tu perfil y solicitá la habilitación profesional.'}</span></button>)}</div></div>
        </>}
        {step === 2 && <div className="space-y-4">{role === 'client' ? <><p className="text-sm text-white/65">Personalicemos tu experiencia.</p>{question('zona', '¿En qué barrio o zona de Alta Gracia vivís?')}{question('preferencia', '¿Qué valorás más al contratar?')}{question('frecuencia', '¿Con qué frecuencia necesitás ayuda?')}</> : <>
          <p className="text-sm text-white/65">Contanos qué hacés. Para trabajar en Worky necesitás verificar tu email y que un administrador apruebe tu documentación y habilite tu perfil.</p>
          {services.map((service, index) => <div className="grid gap-2 sm:grid-cols-[1fr_1fr_100px]" key={index}>
            <input value={service.oficio} onChange={(event) => setServices((current) => current.map((item, i) => i === index ? { ...item, oficio: event.target.value } : item))} className="field border-white/15 bg-white/[.08] text-white" placeholder="Oficio" required={index === 0} />
            <select value={service.categoria} onChange={(event) => setServices((current) => current.map((item, i) => i === index ? { ...item, categoria: event.target.value } : item))} className="field border-white/15 bg-white/[.08] text-white"><option>Plomería</option><option>Electricidad</option><option>Gas</option><option>Albañilería</option><option>Otro</option></select>
            <input type="number" value={service.experienciaAnios} onChange={(event) => setServices((current) => current.map((item, i) => i === index ? { ...item, experienciaAnios: Number(event.target.value) } : item))} className="field border-white/15 bg-white/[.08] text-white" placeholder="Años" />
          </div>)}
          <button type="button" className="text-xs font-bold text-[hsl(var(--accent))]" onClick={() => setServices((current) => [...current, { oficio: '', categoria: 'Otro', experienciaAnios: 0 }])}>+ Agregar otro oficio</button>
        </>}</div>}
        {step === 3 && <div className="space-y-4">{role === 'professional' ? <>
          <p className="text-sm text-white/65">Subí tus documentos. Son privados. Después de verificar tu email, tu solicitud quedará pendiente de revisión y habilitación administrativa.</p>
          <div className="grid gap-3 sm:grid-cols-2">{[['dni_frente', 'DNI frente', 'image/*'], ['dni_dorso', 'DNI dorso', 'image/*'], ['antecedentes_penales', 'Antecedentes penales PDF', 'application/pdf'], ['matricula', 'Matrícula habilitante (opcional)', 'image/*,application/pdf']].map(([key, label, accept]) => <label key={key} className="rounded-2xl border border-dashed border-white/20 p-3 text-xs font-bold">{label}<input type="file" accept={accept} className="mt-2 block w-full text-[10px]" onChange={(event) => void file(key, event.target.files?.[0])} />{docs[key] && <span className="mt-2 block truncate text-white/60">{docs[key].name}</span>}{uploading === key && <span className="mt-2 block text-[hsl(var(--accent))]">Cargando...</span>}</label>)}</div>
          {question('tipoTrabajo', '¿Qué trabajos hacés mejor?')}{question('zonaTrabajo', '¿En qué barrio o zona de Alta Gracia trabajás?')}{question('objetivo', '¿Qué esperás de Worky?')}
        </> : <><p className="text-sm text-white/65">Listo. Revisá tus datos y creá tu cuenta.</p><div className="rounded-2xl bg-white/[.07] p-4 text-sm leading-relaxed"><b>{data.name}</b><br />{data.email}<br />{data.city}, {data.province}</div></>}</div>}
        {error && <p className="text-xs font-semibold text-[hsl(var(--accent))]">{error}</p>}
        <div className="flex gap-3"><Button type="button" variant="ghost" className="flex-1 text-white" disabled={step === 1} onClick={() => setStep((current) => current - 1)}>Atrás</Button><Button type="submit" variant="soft" className="flex-1 py-3.5" disabled={auth.isLoading || Boolean(uploading)}>{step < 3 ? 'Continuar' : 'Crear mi cuenta'} <ChevronRight size={17} /></Button></div>
      </form>
      <p className="mt-7 text-center text-sm text-white/55">¿Ya tenés una cuenta? <button type="button" onClick={() => setLocation('/')} className="font-bold text-[hsl(var(--accent))]">Ingresá</button></p>
    </div></section>
  </div>;
}

function ProfessionalCard({ professional }: { professional: WorkyProfessional }) {
  return <Link href={`/professional/${professional.id}`} className="card-lift group block rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5" data-testid={`card-professional-${professional.id}`}><div className="flex items-start justify-between gap-3"><Avatar name={professional.name} initials={professional.initials} photoUrl={professional.photoUrl} size="lg" warm /><span className={`h-2.5 w-2.5 rounded-full ${professional.available ? 'bg-[#49a574]' : 'bg-[hsl(var(--border))]'}`} title={professional.available ? 'Disponible' : 'No disponible'} /></div><div className="mt-5"><div className="flex items-center gap-1.5"><h3 className="display-font text-xl font-bold tracking-[-.03em]">{professional.name}</h3>{professional.verified && <ShieldCheck size={16} className="text-[hsl(var(--primary))]" />}</div><p className="mt-1 text-sm font-semibold text-[hsl(var(--primary))]">{professional.trade}</p><div className="mt-4 flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]"><span className="flex items-center gap-1 font-bold text-[hsl(var(--foreground))]"><Star size={14} fill="currentColor" className="text-[hsl(var(--primary))]" /> {professional.rating.toFixed(1)}</span><span>{professional.jobsCompleted} trabajos</span><span>{professional.experience} años</span></div><div className="mt-4 flex items-center justify-between border-t border-[hsl(var(--border))] pt-4"><span className="text-sm font-bold">{money(professional.price)} <span className="font-normal text-[hsl(var(--muted-foreground))]">/ visita</span></span><span className="flex items-center gap-1 text-xs font-bold text-[hsl(var(--secondary))] group-hover:text-[hsl(var(--primary))]">Ver perfil <ChevronRight size={15} /></span></div></div></Link>;
}

function LegacyHomePage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const params = useMemo(() => ({ search: query || undefined, categoria: category || undefined }), [query, category]);
  const professionals = useListProfessionals(params, { query: { queryKey: getListProfessionalsQueryKey(params), staleTime: 30000 } });
  const list = professionals.data?.map(toProfessional) ?? [];
  return <div className="space-y-9"><section className="relative overflow-hidden rounded-[26px] bg-[hsl(var(--secondary))] px-6 py-8 text-white md:px-10 md:py-11"><div className="absolute -right-16 -top-24 h-72 w-72 rounded-full border-[45px] border-[hsl(var(--primary)/.35)]" /><div className="relative max-w-2xl"><p className="eyebrow !text-[hsl(var(--accent))]">El oficio de confiar</p><h1 className="display-font mt-3 text-4xl font-bold leading-[1.02] tracking-[-.055em] md:text-5xl">La persona indicada<br /><span className="text-[hsl(var(--accent))]">para esa changa.</span></h1><p className="mt-4 max-w-lg text-sm leading-relaxed text-white/65 md:text-base">Profesionales verificados, recomendados y listos para darte una mano.</p><form onSubmit={(event) => { event.preventDefault(); setQuery(search); }} className="mt-7 flex max-w-xl flex-col gap-2 rounded-2xl bg-white p-2 sm:flex-row"><div className="flex flex-1 items-center gap-2 px-2 text-[hsl(var(--muted-foreground))]"><Search size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full bg-transparent py-2 text-sm text-[hsl(var(--foreground))] outline-none" placeholder="¿Qué necesitás resolver?" data-testid="input-search-professionals" /></div><Button type="submit" className="px-5" testId="button-search-professionals">Buscar</Button></form></div></section><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Cerca tuyo</p><h2 className="display-font mt-2 text-3xl font-bold tracking-[-.05em]">Gente que sabe hacerlo</h2></div><div className="mobile-scroll flex gap-2 pb-1">{['', ...categories].slice(0, 6).map((item) => <button key={item || 'all'} onClick={() => setCategory(item)} className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-bold transition ${category === item ? 'border-[hsl(var(--secondary))] bg-[hsl(var(--secondary))] text-white' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary))]'}`} data-testid={`button-filter-${item || 'all'}`}>{item || 'Todos'}</button>)}</div></div>{professionals.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-72" /><Skeleton className="h-72" /><Skeleton className="h-72" /></div> : professionals.isError ? <ErrorState onRetry={() => void professionals.refetch()} /> : list.length === 0 ? <EmptyState icon={Search} title="Todavía no encontramos a alguien" copy="Probá con otro oficio, otra palabra o quitá algún filtro para abrir la búsqueda." action={<Button onClick={() => { setSearch(''); setQuery(''); setCategory(''); }} variant="soft" testId="button-clear-filters">Limpiar búsqueda</Button>} /> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{list.map((professional) => <ProfessionalCard key={professional.id} professional={professional} />)}</div>}</div>;
}

function ProfessionalCardWithDistance({ professional }: { professional: WorkyProfessional }) {
  const visibleSkills = professional.skills.slice(0, 3);
  const moreSkills = professional.skills.length - visibleSkills.length;
  const hasReviews = professional.reviewsCount > 0;

  return (
    <Link
      href={`/professional/${professional.id}`}
      className="professional-result card-lift group block overflow-hidden rounded-[22px] border border-[hsl(var(--border))] bg-gradient-to-br from-[hsl(var(--card))] via-[hsl(var(--card))] to-[hsl(var(--accent)/.15)] p-4 shadow-[0_10px_24px_hsl(var(--secondary)/.06)] sm:p-5"
      data-testid={`card-professional-${professional.id}`}
      aria-label={`Ver perfil de ${professional.name}, ${professional.trade}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative shrink-0">
          <Avatar name={professional.name} initials={professional.initials} photoUrl={professional.photoUrl} size="md" warm />
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[hsl(var(--card))] ${professional.available ? 'bg-[#378a61]' : 'bg-[hsl(var(--muted-foreground))]'}`}
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h3 className="display-font truncate text-lg font-bold tracking-[-.035em]">{professional.name}</h3>
            {professional.verified && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[hsl(var(--secondary))] px-2 py-1 text-[9px] font-bold text-white" aria-label="Perfil verificado por Worky">
                <ShieldCheck size={11} /> Verificado
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs font-bold text-[hsl(var(--primary))]">{professional.trade} · {professional.category}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-bold ${professional.available ? 'bg-[#e7f3eb] text-[#286b48]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}>
          {professional.available ? 'Disponible' : 'No disponible'}
        </span>
      </div>

      {professional.bio.trim() && (
        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">{professional.bio}</p>
      )}

      {visibleSkills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Especialidades">
          {visibleSkills.map((skill) => (
            <span key={skill} className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1 text-[10px] font-semibold text-[hsl(var(--secondary))]">
              {skill}
            </span>
          ))}
          {moreSkills > 0 && (
            <span className="rounded-full bg-[hsl(var(--muted))] px-2.5 py-1 text-[10px] font-bold text-[hsl(var(--muted-foreground))]">
              +{moreSkills}
            </span>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2" aria-label="Datos de reputación y experiencia">
        <div className="min-w-0 rounded-2xl bg-[hsl(var(--muted)/.72)] px-2 py-2.5 text-center" data-testid={`text-rating-professional-${professional.id}`}>
          <span className="flex items-center justify-center gap-1 font-bold">
            {hasReviews ? (
              <>
                <Star size={14} fill="currentColor" className="shrink-0 text-[hsl(var(--primary))]" />
                <span>{professional.rating.toFixed(1)}</span>
              </>
            ) : <span className="text-sm">—</span>}
          </span>
          <span className="mt-1 block truncate text-[9px] leading-tight text-[hsl(var(--muted-foreground))]" aria-label={hasReviews ? `${professional.reviewsCount} reseñas` : 'Sin reseñas todavía'}>
            {hasReviews ? `${professional.reviewsCount} reseñas` : 'Sin reseñas'}
          </span>
        </div>
        <div className="min-w-0 rounded-2xl bg-[hsl(var(--muted)/.72)] px-2 py-2.5 text-center">
          <span className="flex items-center justify-center gap-1 font-bold">
            <BriefcaseBusiness size={13} className="shrink-0 text-[hsl(var(--primary))]" />
            <span>{professional.jobsCompleted}</span>
          </span>
          <span className="mt-1 block text-[9px] leading-tight text-[hsl(var(--muted-foreground))]">trabajos completados</span>
        </div>
        <div className="min-w-0 rounded-2xl bg-[hsl(var(--muted)/.72)] px-2 py-2.5 text-center" data-testid={`text-experience-professional-${professional.id}`}>
          <span className="block font-bold">{professional.experience}</span>
          <span className="mt-1 block text-[9px] leading-tight text-[hsl(var(--muted-foreground))]">
            {professional.experience === 1 ? 'año de experiencia' : 'años de experiencia'}
          </span>
        </div>
      </div>

      <div className="mt-3 flex min-w-0 items-center justify-between gap-2 text-[10px]">
        {professional.recommendationsCount > 0 ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 truncate font-bold text-[hsl(var(--secondary))]">
            <Heart size={12} fill="currentColor" className="shrink-0 text-[hsl(var(--primary))]" />
            {professional.recommendationsCount} recomendaciones
          </span>
        ) : <span />}
        <span
          className="inline-flex shrink-0 items-center gap-1 text-[hsl(var(--muted-foreground))]"
          data-testid={`distance-professional-${professional.id}`}
        >
          <MapPin size={12} className="shrink-0" />
          {professional.distanceKm !== null && professional.distanceKm !== undefined
            ? `${professional.distanceKm.toFixed(1)} km aprox.`
            : 'Distancia no disponible'}
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2 border-t border-[hsl(var(--border))] pt-3">
        <div>
          <p className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))]">Consulta / visita</p>
          <p className="display-font mt-0.5 text-lg font-bold leading-none" data-testid={`text-price-professional-${professional.id}`}>
            {professional.price > 0 ? money(professional.price) : 'A consultar'}
          </p>
        </div>
        <span className="flex items-center gap-1 rounded-xl bg-[hsl(var(--secondary))] px-3 py-2 text-[11px] font-bold text-white transition-colors group-hover:bg-[hsl(var(--primary))] group-hover:text-[hsl(var(--primary-foreground))]">
          Ver perfil <ChevronRight size={14} />
        </span>
      </div>
    </Link>
  );
}

function HomePage() {
  const [coordinates, setCoordinates] = useState<[number, number] | null>(null);
  const [locationState, setLocationState] = useState<'idle' | 'loading' | 'ready' | 'denied'>('idle');
  const [category, setCategory] = useState('');
  const [sortBy, setSortBy] = useState<ProfessionalSort>('recommended');
  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocationState('denied');
      return;
    }
    setLocationState('loading');
    navigator.geolocation.getCurrentPosition(
      (position) => { setCoordinates([position.coords.longitude, position.coords.latitude]); setLocationState('ready'); },
      () => setLocationState('denied'),
      { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 },
    );
  };
  const params = useMemo(() => ({ categoria: category || undefined, limit: 50, latitud: coordinates?.[1], longitud: coordinates?.[0] }), [category, coordinates]);
  const professionals = useListProfessionals(params, {
    query: {
      queryKey: getListProfessionalsQueryKey(params),
      staleTime: 30000,
      refetchInterval: coordinates ? 60_000 : false,
    },
  });
  const list = professionals.data?.map(toProfessional) ?? [];
  const visibleList = useMemo(() => {
    if (sortBy === 'recommended') return list;
    if (sortBy === 'rating') return [...list].sort((a, b) => (a.visibilityRank ?? 0) - (b.visibilityRank ?? 0) || b.rating - a.rating || b.reviewsCount - a.reviewsCount || b.jobsCompleted - a.jobsCompleted);
    return [...list].sort((a, b) => (a.visibilityRank ?? 0) - (b.visibilityRank ?? 0) || (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY));
  }, [list, sortBy]);
  const clearFilters = () => { setCategory(''); setSortBy('recommended'); };
  const sortOptions: { value: ProfessionalSort; label: string; detail: string }[] = [
    { value: 'recommended', label: 'Recomendados', detail: 'Una selección equilibrada' },
    { value: 'rating', label: 'Mejor valorados', detail: 'Más confianza primero' },
    { value: 'distance', label: 'Más cercanos', detail: 'Ordenados por distancia' },
  ];
  return <div className="space-y-9"><section className="relative overflow-hidden rounded-[26px] bg-[hsl(var(--secondary))] px-6 py-8 text-white md:px-10 md:py-11"><div className="absolute -right-16 -top-24 h-72 w-72 rounded-full border-[45px] border-[hsl(var(--primary)/.35)]" /><div className="relative max-w-2xl"><p className="eyebrow !text-[hsl(var(--accent))]">El oficio de confiar</p><h1 className="display-font mt-3 text-4xl font-bold leading-[1.02] tracking-[-.055em] md:text-5xl">La persona indicada<br /><span className="text-[hsl(var(--accent))]">para esa changa.</span></h1><p className="mt-4 max-w-lg text-sm leading-relaxed text-white/65 md:text-base">Profesionales verificados, recomendados y listos para darte una mano.</p></div></section><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Cerca tuyo</p><h2 className="display-font mt-2 text-3xl font-bold tracking-[-.05em]">Gente que sabe hacerlo</h2></div><div className="mobile-scroll flex gap-2 pb-1">{['', ...categories].slice(0, 6).map((item) => <button key={item || 'all'} onClick={() => setCategory(item)} className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-bold transition ${category === item ? 'border-[hsl(var(--secondary))] bg-[hsl(var(--secondary))] text-white' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary))]'}`} data-testid={`button-filter-${item || 'all'}`}>{item || 'Todos'}</button>)}</div></div><section className="relative overflow-hidden rounded-[24px] border border-[hsl(var(--border))] bg-gradient-to-br from-[hsl(var(--card))] via-[hsl(var(--card))] to-[hsl(var(--accent)/.18)] p-4 shadow-[0_12px_30px_hsl(var(--secondary)/.04)] sm:p-5" aria-label="Ordenar profesionales"><div className="absolute -right-12 -top-14 h-36 w-36 rounded-full bg-[hsl(var(--accent)/.16)] blur-2xl" /><div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]"><ArrowDownUp size={19} /></span><div><p className="eyebrow">Encontrá tu mejor opción</p><h3 className="display-font mt-1 text-xl font-bold tracking-[-.035em]">Ordená los resultados</h3><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Elegí qué querés priorizar y compará sin perder opciones.</p></div></div><div className="flex items-center gap-2 rounded-full bg-[hsl(var(--muted)/.7)] px-3 py-1.5 text-[11px] font-bold text-[hsl(var(--muted-foreground))]"><span className="h-2 w-2 rounded-full bg-[hsl(var(--primary))]" />{list.length} profesionales</div></div><div className="relative mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]"><div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Criterio de ordenación">{sortOptions.map((option) => <button key={option.value} type="button" onClick={() => setSortBy(option.value)} aria-pressed={sortBy === option.value} className={`group rounded-2xl border px-3.5 py-3 text-left transition ${sortBy === option.value ? 'border-[hsl(var(--secondary))] bg-[hsl(var(--secondary))] text-white shadow-[0_8px_18px_hsl(var(--secondary)/.14)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card)/.72)] hover:-translate-y-0.5 hover:border-[hsl(var(--primary)/.45)] hover:shadow-sm'}`} data-testid={`button-sort-${option.value}`}><span className="block text-xs font-bold">{option.label}</span><span className={`mt-1 block text-[10px] leading-4 ${sortBy === option.value ? 'text-white/65' : 'text-[hsl(var(--muted-foreground))]'}`}>{option.detail}</span></button>)}</div>{locationState !== 'ready' ? <button type="button" onClick={requestLocation} disabled={locationState === 'loading'} className="flex min-h-[58px] items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--primary)/.3)] bg-[hsl(var(--accent)/.2)] px-4 py-3 text-xs font-bold text-[hsl(var(--foreground))] transition hover:-translate-y-0.5 hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--accent)/.35)] disabled:cursor-wait disabled:opacity-70" data-testid="button-use-location"><LocateFixed size={16} className="text-[hsl(var(--primary))]" /> {locationState === 'loading' ? 'Buscando ubicación...' : 'Activar cercanía'}</button> : <div className="flex min-h-[58px] items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--accent)/.14)] px-4 py-3 text-xs font-bold text-[hsl(var(--foreground))]" data-testid="location-ready"><LocateFixed size={16} className="text-[hsl(var(--primary))]" /> Cercanía disponible</div>}</div>{locationState === 'denied' && <p className="relative mt-3 flex items-start gap-2 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]" role="status"><CircleAlert size={14} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" /> No pudimos acceder a tu ubicación. Podés seguir buscando; para ordenar por cercanía, activá el permiso e intentá de nuevo.</p>}{locationState === 'ready' && <p className="relative mt-3 flex items-start gap-2 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]" role="status"><MapPin size={14} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" /> Distancias aproximadas, sin mostrar tu ubicación exacta.</p>}{sortBy === 'distance' && locationState !== 'ready' && locationState !== 'loading' && <p className="relative mt-3 text-[11px] font-semibold text-[hsl(var(--primary))]" role="status">Activá tu ubicación para que “Más cercanos” pueda ordenar con precisión.</p>}</section>{professionals.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-72" /><Skeleton className="h-72" /><Skeleton className="h-72" /></div> : professionals.isError ? <ErrorState onRetry={() => void professionals.refetch()} /> : visibleList.length === 0 ? <EmptyState icon={Search} title="No encontramos profesionales" copy="Probá elegir otra categoría para ampliar la búsqueda." action={<Button onClick={() => setCategory('')} variant="soft" testId="button-clear-filters">Ver todos los profesionales</Button>} /> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visibleList.map((professional) => <ProfessionalCardWithDistance key={professional.id} professional={professional} />)}</div>}</div>;
}

function ProfessionalPageLegacy({ professionalId, publicOnly = false, initialPerson }: { professionalId?: number; publicOnly?: boolean; initialPerson?: WorkyProfessional }) {
  const params = useParams<{ id: string }>();
  const id = professionalId ?? Number(params.id);
  const professional = useGetProfessional(id, { query: { enabled: !initialPerson && Number.isInteger(id), queryKey: getGetProfessionalQueryKey(id), retry: false } });
  const createJob = useCreateJob();
  const [, setLocation] = useLocation();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ detail: '', location: 'CABA', price: '', paymentMethod: 'mercado_pago' as 'mercado_pago' | 'efectivo' });
  if (!initialPerson && professional.isLoading) return <LoadingBlock label="Abriendo perfil..." />;
  const person = initialPerson ?? (professional.data ? toProfessional(professional.data) : null);
  if (!person) return <ErrorState onRetry={() => void professional.refetch()} />;
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); createJob.mutate({ data: { categoria: person.category, ubicacion: { direccionTexto: form.location }, precioOfrecido: Number(form.price) || person.price, detalle: form.detail, profesionalId: person.userId, paymentMethod: form.paymentMethod } }, { onSuccess: (job) => { queryClient.invalidateQueries({ queryKey: getListMyJobsQueryKey() }); setLocation(`/chat/${job.id}`); } }); };
  return <div className="mx-auto max-w-5xl space-y-7"><Link href="/home" className="focus-ring inline-flex items-center gap-2 text-xs font-bold text-[hsl(var(--muted-foreground))]" data-testid="link-back-home"><ChevronRight className="rotate-180" size={15} /> Volver a profesionales</Link><section className="overflow-hidden rounded-[26px] border border-[hsl(var(--border))] bg-[hsl(var(--card))]"><div className="h-28 bg-[hsl(var(--secondary))] md:h-36" /><div className="relative px-6 pb-7 md:px-10"><div className="-mt-12 flex flex-col gap-5 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between"><Avatar name={person.name} initials={person.initials} size="xl" warm />{!publicOnly && <Button onClick={() => setShowForm(!showForm)} variant={showForm ? 'ghost' : 'primary'} className="sm:mb-1" disabled={createJob.isPending} testId="button-request-job">{showForm ? <><X size={16} /> Cerrar</> : <><Plus size={16} /> Solicitar changa</>}</Button>}</div><div className="mt-5"><div className="flex flex-wrap items-center gap-2"><h1 className="display-font text-3xl font-bold tracking-[-.05em]">{person.name}</h1>{person.verified && <span className="flex items-center gap-1 rounded-full bg-[#e6f4ed] px-2.5 py-1 text-[11px] font-bold text-[#31825a]"><ShieldCheck size={13} /> Verificado</span>}</div><p className="mt-1 font-semibold text-[hsl(var(--primary))]">{person.trade}</p><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[hsl(var(--muted-foreground))]"><span className="flex items-center gap-1.5"><MapPin size={14} /> {person.location || 'Ubicación no informada'}</span><span className="flex items-center gap-1.5 text-[hsl(var(--foreground))]"><Star size={14} fill="currentColor" className="text-[hsl(var(--primary))]" /> {person.rating.toFixed(1)} ({person.reviewsCount} reseñas)</span><span className="flex items-center gap-1.5"><Clock3 size={14} /> {person.available ? 'Disponible ahora' : 'No disponible ahora'}</span></div></div>{!publicOnly && showForm && <form onSubmit={submit} className="mt-7 grid gap-4 rounded-2xl bg-[hsl(var(--muted)/.65)] p-5 md:grid-cols-2"><div className="md:col-span-2"><p className="display-font text-lg font-bold">Contale qué necesitás</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Le vamos a enviar esta solicitud a {person.name.split(' ')[0]}.</p></div><label className="md:col-span-2"><span className="label">Detalle de la changa</span><textarea required minLength={3} value={form.detail} onChange={(event) => setForm({ ...form, detail: event.target.value })} className="field min-h-24 resize-y" placeholder="Ej: Necesito arreglar una pérdida debajo de la pileta..." data-testid="input-request-detail" /></label><label><span className="label">Zona</span><input required value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} className="field" data-testid="input-request-location" /></label><label><span className="label">Presupuesto estimado</span><input required type="number" min="0" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} className="field" placeholder={String(person.price)} data-testid="input-request-price" /></label><label><span className="label">Medio de pago</span><select className="field" value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value as 'mercado_pago' | 'efectivo' })} data-testid="select-request-payment-method"><option value="mercado_pago">Mercado Pago</option><option value="efectivo">Efectivo, con confirmación de ambas partes</option></select></label><div className="md:col-span-2"><Button type="submit" disabled={createJob.isPending} testId="button-submit-request">{createJob.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Send size={16} />} {createJob.isPending ? 'Enviando...' : 'Enviar solicitud'}</Button>{createJob.isError && <p className="mt-2 text-xs font-semibold text-[hsl(var(--destructive))]">No pudimos enviar la solicitud. Intentá nuevamente.</p>}</div></form>}<div className="mt-8 grid gap-8 border-t border-[hsl(var(--border))] pt-7 md:grid-cols-[1.2fr_.8fr]"><div><h2 className="display-font text-xl font-bold">Sobre su trabajo</h2><p className="mt-3 text-sm leading-7 text-[hsl(var(--muted-foreground))]">{person.bio}</p><div className="mt-5 flex flex-wrap gap-2">{person.skills.map((skill) => <span key={skill} className="rounded-full bg-[hsl(var(--muted))] px-3 py-1.5 text-xs font-semibold" data-testid={`skill-${skill}`}>{skill}</span>)}</div></div><div className="rounded-2xl bg-[hsl(var(--muted)/.6)] p-5"><p className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Desde</p><p className="display-font mt-1 text-3xl font-bold">{money(person.price)}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">precio orientativo por visita</p><div className="mt-5 flex items-center gap-3 border-t border-[hsl(var(--border))] pt-4"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#e6f4ed] text-[#31825a]"><ShieldCheck size={18} /></div><p className="text-xs font-semibold leading-relaxed">Identidad y referencias revisadas por Worky.</p></div></div></div></div></section></div>;
}

function ReviewButtonLegacy({ job }: { job: WorkyJob }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState('');
  const submit = async () => {
    try {
      await apiRequest('/reviews', { method: 'POST', body: JSON.stringify({ changaId: job.id, rating, comentario: comment }) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListProfessionalsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListMyJobsQueryKey() }),
      ]);
      setMessage('Gracias por tu review.');
      setOpen(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No pudimos guardar la review.'); }
  };
  return <div className="flex items-center gap-2">{message && <span className="text-xs font-semibold text-[#31825a]">{message}</span>}{!message && <><Button onClick={() => setOpen(!open)} variant="soft" className="px-3 py-2 text-xs" testId={`button-review-job-${job.id}`}><Star size={14} /> Calificar</Button>{open && <div className="flex items-center gap-2"><select value={rating} onChange={(event) => setRating(Number(event.target.value))} className="field w-20 py-2 text-xs" aria-label="Calificación">{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value}/5</option>)}</select><input value={comment} onChange={(event) => setComment(event.target.value)} className="field w-40 py-2 text-xs" placeholder="Comentario (opcional)" /><Button onClick={() => void submit()} className="px-3 py-2 text-xs">Enviar</Button></div>}</>}</div>;
}

type ReviewAttachment = { objectPath: string; nombre: string; contentType: string; sizeBytes: number };

async function uploadReviewFile(file: File): Promise<ReviewAttachment> {
  const prepared = await apiRequest<{ uploadURL: string; objectPath: string }>('/storage/uploads/request-url', {
    method: 'POST',
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || 'application/octet-stream' }),
  });
  const response = await fetch(prepared.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  if (!response.ok) throw new Error('No pudimos subir uno de los archivos.');
  return { objectPath: prepared.objectPath, nombre: file.name, contentType: file.type || 'application/octet-stream', sizeBytes: file.size };
}

function ReviewButton({ job }: { job: WorkyJob }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  if (auth.user?.id !== job.clientId) return null;
  const submit = async () => {
    if (!comment.trim() && !files.length) {
      setError('Agregá un comentario o una imagen del trabajo.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const attachments = await Promise.all(files.map(uploadReviewFile));
      await apiRequest('/reviews', { method: 'POST', body: JSON.stringify({ changaId: job.id, rating, comentario: comment.trim() || null, adjuntos: attachments }) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListProfessionalsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetProfessionalReputationQueryKey(job.professionalId || 0) }),
        queryClient.invalidateQueries({ queryKey: getListMyJobsQueryKey() }),
      ]);
      setDone(true);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos guardar la calificación.');
    } finally {
      setSaving(false);
    }
  };
  return <>{(done || job.calificada) ? <span className="text-xs font-semibold text-[#31825a]" data-testid={`text-review-sent-${job.id}`}>Calificación enviada</span> : <Button onClick={() => { setError(''); setOpen(true); }} variant="soft" className="px-3 py-2 text-xs" testId={`button-review-job-${job.id}`}><Star size={14} /> Calificar</Button>}<Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Calificar a {job.professionalName || 'este Partner'}</DialogTitle><DialogDescription>Contá cómo fue el trabajo. Podés adjuntar fotos o archivos como evidencia del resultado.</DialogDescription></DialogHeader><div className="space-y-5"><div><span className="label">Puntuación</span><div className="mt-2 flex gap-1" role="radiogroup" aria-label="Puntuación"><span className="sr-only">{rating} de 5 estrellas</span>{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" onClick={() => setRating(value)} aria-label={`${value} estrellas`} aria-pressed={rating === value} className={`rounded-lg p-1 transition ${rating >= value ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--border))]'}`}><Star size={25} fill="currentColor" /></button>)}</div></div><label><span className="label">Comentario</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} className="field min-h-28 resize-y" placeholder="¿Qué te pareció el trabajo?" maxLength={1000} data-testid="textarea-review-comment" /></label><label><span className="label">Fotos o archivos del trabajo</span><input type="file" multiple accept="image/*,.pdf" onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 6))} className="field mt-2 p-2 text-xs" data-testid="input-review-files" /><p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">{files.length ? `${files.length} archivo${files.length === 1 ? '' : 's'} seleccionado${files.length === 1 ? '' : 's'}` : 'Hasta 6 archivos.'}</p></label>{error && <p className="text-xs font-semibold text-[hsl(var(--destructive))]" role="alert">{error}</p>}</div><DialogFooter><Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button><Button onClick={() => void submit()} disabled={saving}>{saving && <LoaderCircle className="animate-spin" size={15} />} {saving ? 'Guardando...' : 'Enviar calificación'}</Button></DialogFooter></DialogContent></Dialog></>;
}

function ProfessionalReviews({ professionalId }: { professionalId: number }) {
  const reputation = useGetProfessionalReputation(professionalId, { query: { queryKey: getGetProfessionalReputationQueryKey(professionalId) } });
  if (reputation.isLoading) return <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><Skeleton className="h-24" /></section>;
  if (reputation.isError) return <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"><p className="text-xs text-[hsl(var(--destructive))]">No pudimos cargar las reseñas.</p></section>;
  const reviews = reputation.data?.reviews || [];
  return <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6" data-testid="section-professional-reviews"><div className="flex items-end justify-between gap-3"><div><p className="eyebrow">La voz de sus clientes</p><h2 className="display-font mt-2 text-2xl font-bold">Comentarios y reseñas</h2></div><span className="flex items-center gap-1 text-sm font-bold"><Star size={15} fill="currentColor" className="text-[hsl(var(--primary))]" /> {Number(reputation.data?.rating || 0).toFixed(1)}</span></div>{reviews.length ? <div className="mt-5 space-y-4">{reviews.map((review) => <article key={review.id} className="border-t border-[hsl(var(--border))] pt-4"><div className="flex items-center justify-between gap-3"><span className="text-xs font-bold">{review.autor.nombre}</span><span className="flex items-center gap-1 text-xs text-[hsl(var(--primary))]">{review.rating}/5 <Star size={12} fill="currentColor" /></span></div>{review.comentario && <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{review.comentario}</p>}{review.adjuntos?.length ? <div className="mt-3 flex flex-wrap gap-2">{review.adjuntos.map((file) => <a key={file.objectPath} href={`/api/v1/storage/objects${file.objectPath}`} target="_blank" rel="noreferrer" className="rounded-lg bg-[hsl(var(--muted))] px-2.5 py-1.5 text-[11px] font-semibold underline">{file.nombre}</a>)}</div> : null}</article>)}</div> : <p className="mt-5 text-sm text-[hsl(var(--muted-foreground))]">Todavía no hay reseñas publicadas.</p>}</section>;
}

function ProfessionalPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  return <><ProfessionalPageLegacy /><div className="mx-auto max-w-5xl pb-8"><ProfessionalReviews professionalId={id} /></div></>;
}

function MyPublicProfilePage() {
  const auth = useAuth();
  const [, setLocation] = useLocation();
  const profile = useGetMyProfessionalProfile({ query: { enabled: Boolean(auth.user), retry: false, queryKey: getGetMyProfessionalProfileQueryKey() } });
  if (!auth.user) return null;
  if (profile.isLoading) return <LoadingBlock label="Cargando tu perfil público..." />;
  if (profile.isError || !profile.data) {
    return <div className="mx-auto max-w-3xl space-y-7"><div><p className="eyebrow">Tu perfil público</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Todavía no publicaste tu perfil.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Completá tus datos profesionales para que los clientes puedan conocerte y contratarte.</p></div><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 md:p-8"><div className="flex items-start gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"><UserRound size={21} /></div><div><h2 className="display-font text-xl font-bold">Completá Mis servicios</h2><p className="mt-1 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Ahí podés cargar tu oficio, categoría, precio, experiencia, descripción, habilidades y disponibilidad. Después vas a poder ver esta misma ficha como la ven los clientes.</p><Button onClick={() => setLocation('/services')} className="mt-5" testId="button-go-to-services">Completar mis servicios <ChevronRight size={16} /></Button></div></div></section></div>;
  }
   return <><div className="relative mx-auto max-w-5xl"><ProfessionalPageLegacy professionalId={profile.data.id} publicOnly initialPerson={toProfessional(profile.data)} /><Button onClick={() => setLocation('/services')} variant="soft" className="absolute right-4 top-[9.5rem] z-10 sm:right-8" testId="button-edit-own-profile"><Pencil size={16} /> Editar mi perfil</Button></div><div className="mx-auto max-w-5xl pb-8"><ProfessionalReviews professionalId={profile.data.id} /></div></>;
}

function JobCard({ job, onStatus, onEdit, onDelete, deleteError, payment, onPay, paying, onConfirmCash, confirmingCash }: {
  job: WorkyJob;
  onStatus?: (status: 'accepted' | 'in_progress' | 'work_done' | 'cancelled') => void;
  onEdit?: () => void;
  onDelete?: () => void;
  deleteError?: string;
  payment?: ClientPayment;
  onPay?: () => void;
  paying?: boolean;
  onConfirmCash?: () => void;
  confirmingCash?: boolean;
}) {
  const nextAction = job.status === 'published' ? 'Aceptar changa' : job.status === 'accepted' ? 'Marcar en curso' : job.status === 'in_progress' ? 'Marcar trabajo realizado' : null;
  const paymentMessage = payment?.status === 'aprobado'
    ? 'Pago confirmado a Worky'
    : payment?.status === 'iniciado'
      ? 'Pago iniciado; esperando confirmación de Mercado Pago'
      : payment?.status === 'rechazado'
        ? 'El pago fue rechazado; se puede reintentar'
        : payment?.status === 'reembolsado'
          ? 'Pago reembolsado'
          : null;
  const currentCashActorConfirmed = job.cashConfirmedByClient || job.cashConfirmedByProfessional;
  return <article className="card-lift rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5" data-testid={`card-job-${job.id}`}>
    <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="text-[11px] font-bold uppercase tracking-[.12em] text-[hsl(var(--primary))]">{job.category}</span><StatusBadge status={job.status} /></div><h3 className="display-font mt-3 text-lg font-bold leading-tight">{job.detail}</h3></div><span className="text-xs text-[hsl(var(--muted-foreground))]">{dateLabel(job.createdAt)}</span></div>
    <div className="mt-5 grid grid-cols-2 gap-3 border-y border-[hsl(var(--border))] py-3 text-xs"><span className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]"><MapPin size={14} /> {job.location}</span><span className="font-bold">{money(job.price)}</span><span className="text-[hsl(var(--muted-foreground))]">Cliente <b className="text-[hsl(var(--foreground))]">{job.clientName}</b>{job.clientVerified && <span className="ml-1 inline-flex items-center gap-1 font-semibold text-[hsl(var(--primary))]" data-testid={`badge-client-verified-${job.id}`}><ShieldCheck size={13} /> Verificado</span>}</span><span className="text-[hsl(var(--muted-foreground))]">Profesional <b className="text-[hsl(var(--foreground))]">{job.professionalName || 'Por asignar'}</b></span></div>
    {job.status === 'awaiting_payment' && <div className="mt-3 rounded-xl bg-[hsl(var(--muted)/.55)] p-3 text-xs text-[hsl(var(--muted-foreground))]">
      <p>Trabajo realizado · {job.paymentMethod === 'mercado_pago' ? 'Mercado Pago' : 'Efectivo'} · <b className="text-[hsl(var(--foreground))]">{money(job.price)}</b></p>
      {job.paymentMethod === 'mercado_pago'
        ? <p className="mt-1">No queda finalizado ni se habilita la reseña hasta que Mercado Pago confirme el pago.</p>
        : <p className="mt-1">El trabajo se finaliza cuando cliente y profesional confirman el pago en efectivo. Estado: cliente {job.cashConfirmedByClient ? 'confirmó' : 'pendiente'} · profesional {job.cashConfirmedByProfessional ? 'confirmó' : 'pendiente'}.</p>}
      {paymentMessage && <p className="mt-2 font-semibold" role="status">{paymentMessage}</p>}
      {currentCashActorConfirmed && !onConfirmCash && job.paymentMethod === 'efectivo' && <p className="mt-2 font-semibold">Ya confirmaste el pago; falta la otra parte.</p>}
    </div>}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><Link href={`/chat/${job.id}`} className="focus-ring flex items-center gap-2 text-xs font-bold text-[hsl(var(--secondary))] hover:text-[hsl(var(--primary))]" data-testid={`link-chat-job-${job.id}`}><MessageCircle size={15} /> Abrir conversación</Link>
      <div className="flex flex-wrap gap-2">
        {job.status === 'completed' && job.professionalId ? <ReviewButton job={job} /> : null}
        {onPay && job.status === 'awaiting_payment' && job.paymentMethod === 'mercado_pago' && payment?.status !== 'aprobado' && <Button onClick={onPay} disabled={paying} variant="primary" className="px-3 py-2 text-xs" testId={`button-pay-job-${job.id}`}>{paying ? <LoaderCircle className="animate-spin" size={14} /> : <Check size={14} />}{payment?.status === 'iniciado' ? 'Continuar pago' : 'Pagar trabajo'}</Button>}
        {onConfirmCash && job.status === 'awaiting_payment' && job.paymentMethod === 'efectivo' && <Button onClick={onConfirmCash} disabled={confirmingCash} variant="primary" className="px-3 py-2 text-xs" testId={`button-confirm-cash-job-${job.id}`}>{confirmingCash ? <LoaderCircle className="animate-spin" size={14} /> : <Check size={14} />}{confirmingCash ? 'Confirmando...' : 'Confirmar pago en efectivo'}</Button>}
        {onEdit && <Button onClick={onEdit} variant="ghost" className="px-3 py-2 text-xs" testId={`button-edit-job-${job.id}`}><Pencil size={14} /> Editar</Button>}
        {onDelete && <Button onClick={onDelete} variant="ghost" className="px-3 py-2 text-xs text-[hsl(var(--destructive))]" testId={`button-delete-job-${job.id}`}><Trash2 size={14} /> Eliminar</Button>}
        {nextAction && onStatus && <Button onClick={() => onStatus(job.status === 'published' ? 'accepted' : job.status === 'accepted' ? 'in_progress' : 'work_done')} variant="soft" className="px-3 py-2 text-xs" testId={`button-status-job-${job.id}`}>{nextAction} <ChevronRight size={14} /></Button>}
      </div>
    </div>{deleteError && <p className="mt-3 text-xs font-semibold text-[hsl(var(--destructive))]" role="alert">{deleteError}</p>}
  </article>;
}

function JobEditForm({ job, onClose, onSaved }: { job: WorkyJob; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState(job.category);
  const [location, setLocation] = useState(job.location);
  const [price, setPrice] = useState(String(job.price));
  const [detail, setDetail] = useState(job.detail);
  const [paymentMethod, setPaymentMethod] = useState(job.paymentMethod);
  const [professionalId, setProfessionalId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const categoriesQuery = useCatalogCategories();
  const categories = [...new Set([job.category, ...(categoriesQuery.data ?? [])])];
  const professionalParams = { categoria: category, limit: 50 };
  const professionalsQuery = useListProfessionals(professionalParams, {
    query: { queryKey: getListProfessionalsQueryKey(professionalParams) },
  });
  const professionals = professionalsQuery.data?.map(toProfessional) ?? [];
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await apiRequest<Job>(`/trabajos/${job.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          categoria: category,
          ubicacion: { direccionTexto: location.trim() },
          precioOfrecido: Number(price),
          detalle: detail.trim() || null,
          profesionalId: professionalId ? Number(professionalId) : null,
          paymentMethod,
        }),
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos guardar los cambios.');
    } finally {
      setBusy(false);
    }
  };
  return <form onSubmit={save} className="mt-3 space-y-4 rounded-2xl border border-[hsl(var(--primary)/.35)] bg-[hsl(var(--card))] p-5" data-testid={`form-edit-job-${job.id}`}>
    <div><h3 className="text-sm font-bold">Editar changa</h3><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Solo se puede editar antes de que un profesional la acepte.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block"><span className="label">Oficio</span><select className="field" value={category} onChange={(event) => { setCategory(event.target.value); setProfessionalId(''); }} required>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label className="block"><span className="label">Presupuesto (ARS)</span><input className="field" type="number" min="0" step="1" value={price} onChange={(event) => setPrice(event.target.value)} required /></label>
      <label className="block sm:col-span-2"><span className="label">Dirección o zona</span><input className="field" value={location} onChange={(event) => setLocation(event.target.value)} minLength={3} required /></label>
      <label className="block sm:col-span-2"><span className="label">Descripción del problema</span><textarea className="field min-h-24" value={detail} onChange={(event) => setDetail(event.target.value)} maxLength={3000} /></label>
      <label className="block"><span className="label">Medio de pago</span><select className="field" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as 'mercado_pago' | 'efectivo')} data-testid="select-edit-job-payment-method"><option value="mercado_pago">Mercado Pago</option><option value="efectivo">Efectivo, con confirmación de ambas partes</option></select></label>
      <label className="block sm:col-span-2"><span className="label">Profesional</span><select className="field" value={professionalId} onChange={(event) => setProfessionalId(event.target.value)}><option value="">Dejar sin asignar</option>{professionals.map((professional) => <option key={professional.userId} value={professional.userId}>{professional.name} · {professional.trade}</option>)}</select><span className="mt-1 block text-[11px] text-[hsl(var(--muted-foreground))]">Al asignarlo, la changa quedará aceptada por esa persona.</span></label>
    </div>
    {professionalsQuery.isError && <p className="text-xs text-[hsl(var(--muted-foreground))]">No pudimos cargar la lista de profesionales. Podés guardar la changa sin asignarla.</p>}
    {error && <p className="text-xs font-semibold text-[hsl(var(--destructive))]" role="alert">{error}</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy || !location.trim() || !price}>{busy ? 'Guardando…' : 'Guardar cambios'}</Button></div>
  </form>;
}

function PartnerJobsSections() {
  const [activeSection, setActiveSection] = useState('opportunities');
  const available = useListAvailableJobs({ query: { queryKey: getListAvailableJobsQueryKey() } });
  const assigned = useListAssignedJobs({ query: {
    queryKey: getListAssignedJobsQueryKey(),
    refetchInterval: (query) => query.state.data?.some((job) => job.estado === 'trabajo_realizado') ? 8000 : false,
  } });
  const acceptJob = useAcceptJob();
  const updateJob = useUpdateJob();
  const confirmCashPayment = useConfirmCashJobPayment();
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getListAvailableJobsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListAssignedJobsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: ['partner-dashboard'] }),
  ]);
  const update = (id: number, status: 'accepted' | 'in_progress' | 'work_done') => {
    if (status === 'accepted') acceptJob.mutate({ id }, { onSuccess: refresh });
    else updateJob.mutate({ id, data: { estado: status === 'in_progress' ? 'en_curso' : 'trabajo_realizado' } }, { onSuccess: refresh });
  };
  const confirmCash = (id: number) => confirmCashPayment.mutate({ id }, { onSuccess: refresh });
  const opportunities = available.data?.map(toJob) ?? [];
  const assignedJobs = assigned.data?.map(toJob) ?? [];
  const sections = [
    { key: 'opportunities', title: 'Oportunidades', copy: 'Solicitudes nuevas para aceptar.', jobs: opportunities, action: (job: WorkyJob) => update(job.id, 'accepted') },
    { key: 'progress', title: 'En proceso', copy: 'Trabajos aceptados y todavía activos.', jobs: assignedJobs.filter((job) => job.status === 'accepted' || job.status === 'in_progress'), action: (job: WorkyJob) => update(job.id, job.status === 'accepted' ? 'in_progress' : 'work_done') },
    { key: 'payment', title: 'Pago pendiente', copy: 'Trabajo realizado; falta confirmar el pago.', jobs: assignedJobs.filter((job) => job.status === 'awaiting_payment') },
    { key: 'completed', title: 'Mis trabajos', copy: 'Trabajos que ya realizaste y fueron pagados.', jobs: assignedJobs.filter((job) => job.status === 'completed') },
  ];
  if (available.isLoading || assigned.isLoading) return <LoadingBlock label="Buscando tus changas..." />;
  if (available.isError || assigned.isError) return <ErrorState onRetry={() => { void available.refetch(); void assigned.refetch(); }} />;
  const selected = sections.find((section) => section.key === activeSection) ?? sections[0];
  return <div className="space-y-6">
    <div className="grid grid-cols-2 gap-1 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.45)] p-1 md:grid-cols-4" role="tablist" aria-label="Secciones de changas">
      {sections.map((section) => <button key={section.key} type="button" role="tab" aria-selected={selected.key === section.key} onClick={() => setActiveSection(section.key)} className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-3 text-xs font-bold transition-colors sm:px-4 ${selected.key === section.key ? 'bg-[hsl(var(--card))] text-[hsl(var(--secondary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`} data-testid={`button-jobs-tab-${section.key}`}><span className="truncate">{section.title}</span><span className={`rounded-full px-2 py-0.5 text-[10px] ${selected.key === section.key ? 'bg-[hsl(var(--primary)/.14)] text-[hsl(var(--primary))]' : 'bg-[hsl(var(--card))]'}`}>{section.jobs.length}</span></button>)}
    </div>
    <section data-testid={`jobs-section-${selected.key}`} aria-labelledby={`jobs-tab-${selected.key}`}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div><p className="eyebrow">{selected.key === 'opportunities' ? 'Para aceptar' : selected.key === 'progress' ? 'En marcha' : 'Historial'}</p><h2 id={`jobs-tab-${selected.key}`} className="display-font mt-1 text-2xl font-bold">{selected.title}</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{selected.copy}</p></div>
        <span className="rounded-full bg-[hsl(var(--muted))] px-2.5 py-1 text-[11px] font-bold">{selected.jobs.length}</span>
      </div>
      {selected.jobs.length ? <div className="grid max-w-4xl gap-4">{selected.jobs.map((job) => <JobCard key={job.id} job={job} onStatus={selected.action ? () => selected.action?.(job) : undefined} onConfirmCash={job.status === 'awaiting_payment' && job.paymentMethod === 'efectivo' && !job.cashConfirmedByProfessional ? () => confirmCash(job.id) : undefined} confirmingCash={confirmCashPayment.isPending} />)}</div> : <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-6 text-sm text-[hsl(var(--muted-foreground))]">No hay changas en esta sección por ahora.</div>}
    </section>
  </div>;
}

function JobsPage({ role }: { role: Role | string }) {
  const [view, setView] = useState<'available' | 'mine' | 'all'>(role === 'professional' ? 'available' : 'all');
  const [editingJobId, setEditingJobId] = useState<number | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: number; message: string } | null>(null);
  const availableJobs = useListAvailableJobs({ query: { enabled: role === 'professional' && view === 'available', queryKey: getListAvailableJobsQueryKey() } });
  const assignedJobs = useListAssignedJobs({ query: {
    enabled: role === 'professional' && view === 'mine',
    queryKey: getListAssignedJobsQueryKey(),
    refetchInterval: (query) => query.state.data?.some((job) => job.estado === 'trabajo_realizado') ? 8000 : false,
  } });
  const myJobs = useListMyJobs({ query: {
    enabled: role === 'client',
    queryKey: getListMyJobsQueryKey(),
    refetchInterval: (query) => query.state.data?.some((job) => job.estado === 'trabajo_realizado') ? 8000 : false,
  } });
  const myPayments = useListMyPayments({ query: {
    enabled: role === 'client',
    queryKey: getListMyPaymentsQueryKey(),
    refetchInterval: (query) => query.state.data?.some((payment) => payment.status === 'iniciado') ? 8000 : false,
  } });
  const createPayment = useCreatePaymentCheckout();
  const confirmCashPayment = useConfirmCashJobPayment();
  const updateJob = useUpdateJob();
  const acceptJob = useAcceptJob();
  const [paymentError, setPaymentError] = useState('');
  const [payingJobId, setPayingJobId] = useState<number | null>(null);
  const filters = role === 'professional' ? [{ key: 'available', label: 'Oportunidades' }, { key: 'mine', label: 'Mis trabajos' }] : [{ key: 'all', label: 'Todas mis changas' }];
  const jobs = role === 'client' ? myJobs : view === 'available' ? availableJobs : assignedJobs;
  const list = jobs.data?.map(toJob) ?? [];
  const refreshJobs = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getListAvailableJobsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListAssignedJobsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListMyJobsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListMyPaymentsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: conversationsQueryKey('client') }),
  ]);
  const beginPayment = async (changaId: number) => {
    setPaymentError('');
    setPayingJobId(changaId);
    try {
      const checkout = await createPayment.mutateAsync({ data: { changaId } });
      await queryClient.invalidateQueries({ queryKey: getListMyPaymentsQueryKey() });
      window.location.assign(checkout.checkoutUrl);
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : 'No pudimos iniciar el pago.');
    } finally {
      setPayingJobId(null);
    }
  };
  const removeJob = async (job: WorkyJob) => {
    if (!window.confirm('¿Eliminar esta changa? Se borrará permanentemente y no se puede deshacer. Si ya tiene mensajes o actividad, Worky conservará el historial y no permitirá borrarla.')) return;
    setDeletingJobId(job.id);
    setDeleteError(null);
    try {
      await apiRequest(`/trabajos/${job.id}`, { method: 'DELETE' });
      await refreshJobs();
    } catch (cause) {
      setDeleteError({ id: job.id, message: cause instanceof Error ? cause.message : 'No pudimos eliminar la changa.' });
    } finally {
      setDeletingJobId(null);
    }
  };
  const update = (id: number, status: 'accepted' | 'in_progress' | 'work_done' | 'cancelled') => {
    if (status === 'accepted') acceptJob.mutate({ id }, { onSuccess: refreshJobs });
    else {
      const statuses = { in_progress: 'en_curso', work_done: 'trabajo_realizado', cancelled: 'cancelada' } as const;
      updateJob.mutate({ id, data: { estado: statuses[status] } }, { onSuccess: refreshJobs });
    }
  };
  const confirmCash = (changaId: number) => confirmCashPayment.mutate({ id: changaId }, {
    onSuccess: refreshJobs,
    onError: (cause) => setPaymentError(cause instanceof Error ? cause.message : 'No pudimos registrar la confirmación de efectivo.'),
  });
  if (role === 'professional') return <div className="space-y-8"><div><p className="eyebrow">Changas</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Tu operación, ordenada.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Separá lo que podés aceptar, lo que está en marcha y lo que ya realizaste.</p></div><PartnerJobsSections /></div>;
  return <div className="space-y-8"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Changas</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">{role === 'professional' ? 'Oportunidades que encajan' : 'Lo que está pasando'}</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{role === 'professional' ? 'Elegí un trabajo y hacé que suceda.' : 'Seguimiento simple de tus pedidos y trabajos.'}</p></div>{role === 'client' && <Link href="/jobs/new" className="focus-ring" data-testid="link-new-job"><Button testId="button-new-job"><Plus size={17} /> Publicar changa</Button></Link>}</div>{paymentError && <p className="rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.08)] px-4 py-3 text-sm font-semibold text-[hsl(var(--destructive))]" role="alert">{paymentError}</p>}<div className="flex gap-2 border-b border-[hsl(var(--border))] pb-3">{filters.map((filter) => <button key={filter.key} onClick={() => setView(filter.key as typeof view)} className={`rounded-lg px-3 py-2 text-xs font-bold ${view === filter.key ? 'bg-[hsl(var(--secondary))] text-white' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`} data-testid={`button-jobs-view-${filter.key}`}>{filter.label}</button>)}</div>{jobs.isLoading ? <LoadingBlock label="Buscando changas..." /> : jobs.isError ? <ErrorState onRetry={() => void jobs.refetch()} /> : list.length === 0 ? <EmptyState icon={BriefcaseBusiness} title={role === 'professional' ? 'No hay oportunidades por ahora' : 'Todavía no publicaste changas'} copy={role === 'professional' ? 'Cuando aparezca una solicitud cerca tuyo, la vas a ver acá.' : 'Publicá tu primera changa y encontrá a alguien que la resuelva.'} action={role === 'client' ? <Link href="/jobs/new" data-testid="link-empty-new-job"><Button variant="primary" testId="button-empty-new-job"><Plus size={16} /> Publicar una changa</Button></Link> : undefined} /> : <div className="grid max-w-4xl gap-4">{list.map((job) => <div key={job.id}><JobCard job={job} payment={myPayments.data?.find((payment) => payment.changaId === job.id)} onPay={role === 'client' && job.status === 'awaiting_payment' ? () => void beginPayment(job.id) : undefined} paying={payingJobId === job.id} onConfirmCash={role === 'client' && job.status === 'awaiting_payment' && job.paymentMethod === 'efectivo' && !job.cashConfirmedByClient ? () => confirmCash(job.id) : undefined} confirmingCash={confirmCashPayment.isPending} onStatus={role === 'professional' ? (status) => update(job.id, status) : undefined} onEdit={role === 'client' && job.status === 'published' && !job.professionalId ? () => setEditingJobId((current) => current === job.id ? null : job.id) : undefined} onDelete={role === 'client' && job.status === 'published' && !job.professionalId && deletingJobId !== job.id ? () => void removeJob(job) : undefined} deleteError={deleteError?.id === job.id ? deleteError.message : undefined} />{editingJobId === job.id && <JobEditForm job={job} onClose={() => setEditingJobId(null)} onSaved={() => { setEditingJobId(null); void refreshJobs(); }} />}</div>)}</div>}{(updateJob.isPending || acceptJob.isPending || confirmCashPayment.isPending || deletingJobId !== null) && <div className="fixed bottom-5 right-5 flex items-center gap-2 rounded-xl bg-[hsl(var(--secondary))] px-4 py-3 text-xs font-bold text-white shadow-xl" role="status"><LoaderCircle className="animate-spin" size={15} /> Actualizando changa...</div>}</div>;
}

function AppointmentActions({ appointment, clientId, partnerId, onAccept, onReject, onCancel, onArrival, onComplete, onConfirm, onReport, pendingAction, history, onRetry, onDelete, syncingId }: { appointment: Appointment; clientId: number; partnerId: number; onAccept: (id: number, method: 'mercado_pago' | 'efectivo') => void; onReject: (id: number) => void; onCancel: (id: number) => void; onArrival: (id: number) => void; onComplete: (id: number) => void; onConfirm: (id: number) => void; onReport: (id: number, issueType: 'partner_no_show' | 'client_no_show' | 'other', detail: string) => void; pendingAction: AppointmentAction | null; history?: AppointmentAttempt[]; onRetry?: (attempt: PendingAppointmentAttempt) => void; onDelete?: (id: number) => void; syncingId?: number | null }) {
  const auth = useAuth();
  const [paymentMethod, setPaymentMethod] = useState<'mercado_pago' | 'efectivo'>('mercado_pago');
  const [issueType, setIssueType] = useState<'partner_no_show' | 'client_no_show' | 'other'>('other');
  const [issueDetail, setIssueDetail] = useState('');
  const isAccepting = pendingAction === 'accept';
  const isRejecting = pendingAction === 'reject';
  const isCancelling = pendingAction === 'cancel';
  const canAct = appointment.estado === 'solicitada' && auth.user?.id === clientId;
  const canCancel = (appointment.estado === 'solicitada' || appointment.estado === 'confirmada') && auth.user?.id === clientId;
  const isPartner = auth.user?.id === partnerId;
  const finance = appointment.finanzas;
  const canReport = Boolean(finance && ['pending_release', 'cash_pending_visit', 'cash_commission_due', 'cash_commission_settled'].includes(finance.status));
  return <>
    {canAct && <div className="mt-2 flex w-full flex-wrap items-end gap-2">
      <label className="grid gap-1 text-[10px] font-semibold text-[hsl(var(--muted-foreground))]">
        Medio de pago
        <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)} className="field h-9 py-1 text-xs" aria-label="Medio de pago de la visita">
          <option value="mercado_pago">Mercado Pago</option><option value="efectivo">Efectivo</option>
        </select>
      </label>
      <Button onClick={() => onAccept(appointment.id, paymentMethod)} disabled={pendingAction !== null} variant="soft" className="px-3 py-2 text-xs" testId={`button-accept-appointment-${appointment.id}`}>{isAccepting && <LoaderCircle className="animate-spin" size={12} />} {isAccepting ? 'Procesando...' : paymentMethod === 'mercado_pago' ? 'Aceptar y pagar' : 'Aceptar en efectivo'}</Button>
      <Button onClick={() => onReject(appointment.id)} disabled={pendingAction !== null} variant="ghost" className="px-3 py-2 text-xs" testId={`button-reject-appointment-${appointment.id}`}>{isRejecting && <LoaderCircle className="animate-spin" size={12} />} {isRejecting ? 'Rechazando...' : 'Rechazar'}</Button>
    </div>}
    {canCancel && <Button onClick={() => onCancel(appointment.id)} disabled={pendingAction !== null} variant="ghost" className="ml-auto px-2 py-1 text-[10px] text-[hsl(var(--destructive))]" testId={`button-cancel-appointment-${appointment.id}`}>{isCancelling && <LoaderCircle className="animate-spin" size={12} />} {isCancelling ? 'Cancelando...' : 'Cancelar visita'}</Button>}
    {appointment.estado === 'solicitada' && !canAct && <p className="mt-2 text-[10px] text-[hsl(var(--muted-foreground))]">Esperando la respuesta y el pago del cliente.</p>}
    {isPartner && appointment.estado === 'confirmada' && finance && <div className="mt-2 flex flex-wrap gap-2">
      {!finance.partnerArrivedAt ? <Button onClick={() => onArrival(appointment.id)} disabled={pendingAction !== null} variant="soft" className="px-3 py-2 text-xs" testId={`button-arrival-${appointment.id}`}>{pendingAction === 'arrival' ? 'Registrando...' : 'Registrar llegada'}</Button>
        : <><p className="w-full text-[10px] text-[hsl(var(--muted-foreground))]">Llegada registrada. Al terminar la visita, cerrala desde acá.</p><Button onClick={() => onComplete(appointment.id)} disabled={pendingAction !== null} variant="soft" className="px-3 py-2 text-xs" testId={`button-complete-visit-${appointment.id}`}>{pendingAction === 'complete' ? 'Cerrando...' : 'Marcar visita realizada'}</Button></>}
    </div>}
    {auth.user?.id === clientId && appointment.estado === 'completada' && finance && ['pending_release', 'cash_commission_due', 'cash_commission_settled'].includes(finance.status) && <Button onClick={() => onConfirm(appointment.id)} disabled={pendingAction !== null} variant="soft" className="mt-2 px-3 py-2 text-xs" testId={`button-confirm-visit-${appointment.id}`}>{pendingAction === 'confirm' ? 'Confirmando...' : finance.method === 'mercado_pago' ? 'Confirmar visita y liberar saldo' : 'Confirmar visita'}</Button>}
    {canReport && <details className="mt-2 w-full rounded-lg border border-[hsl(var(--border))] p-2">
      <summary className="cursor-pointer text-[10px] font-bold text-[hsl(var(--destructive))]">Reportar un problema</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <select value={issueType} onChange={(event) => setIssueType(event.target.value as typeof issueType)} className="field h-9 py-1 text-xs" aria-label="Motivo del reporte">
          {auth.user?.id === clientId ? <option value="partner_no_show">El Partner no se presentó</option> : <option value="client_no_show">El cliente no se presentó</option>}
          <option value="other">Otro problema</option>
        </select>
        <input value={issueDetail} onChange={(event) => setIssueDetail(event.target.value)} className="field h-9 py-1 text-xs" minLength={5} maxLength={1000} placeholder="Contanos qué pasó" aria-label="Detalle del problema" />
        <Button onClick={() => onReport(appointment.id, issueType, issueDetail)} disabled={pendingAction !== null || issueDetail.trim().length < 5} variant="ghost" className="px-3 py-2 text-xs" testId={`button-report-visit-${appointment.id}`}>{pendingAction === 'report' ? 'Enviando...' : 'Enviar reporte'}</Button>
      </div>
      <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">Los reportes de ausencia se habilitan 10 minutos después del horario pactado y retienen el saldo hasta la revisión de Worky.</p>
    </details>}
    {finance?.status === 'pending_release' && finance.releaseAt && <p className="mt-2 w-full text-[10px] text-[hsl(var(--muted-foreground))]">El 85% del Partner está retenido hasta que confirmes o venza la revisión de 24 horas. Liberación automática: {new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(finance.releaseAt))}.</p>}
    {finance?.status === 'under_review' && <p className="mt-2 w-full rounded-lg bg-[hsl(var(--accent)/.5)] p-2 text-[10px] font-semibold">Saldo en revisión por Worky. No se liberará hasta resolver el reporte.</p>}
    {history?.length ? <div className="basis-full"><AppointmentAttemptHistory attempts={history} onRetry={onRetry} onDelete={onDelete} syncingId={syncingId} /></div> : null}
  </>;
}

function ConversationsPage({ role }: { role: Role }) {
  const conversationRole = role === 'professional' ? 'profesional' : 'cliente';
  const conversations = useQuery<Conversation[]>({
    queryKey: conversationsQueryKey(role),
    queryFn: () => apiRequest<Conversation[]>(`/conversaciones?rol=${conversationRole}`),
    refetchInterval: 30000,
  });
  return <div className="mx-auto max-w-4xl space-y-7"><div><p className="eyebrow">Tu bandeja</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Conversaciones en marcha.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Cada profesional tiene su propio chat, incluso si responde a la misma changa.</p></div>{conversations.isLoading ? <LoadingBlock label="Cargando conversaciones..." /> : conversations.isError ? <ErrorState onRetry={() => void conversations.refetch()} /> : !conversations.data?.length ? <EmptyState icon={MessageCircle} title="Todavía no hay conversaciones" copy="Cuando un profesional responda a una changa, su chat aparecerá acá." /> : <div className="space-y-3">{conversations.data.map((conversation) => <Link key={`${conversation.changaId}-${conversation.profesionalId ?? 'general'}`} href={conversation.profesionalId ? `/chat/${conversation.changaId}?profesionalId=${conversation.profesionalId}` : `/chat/${conversation.changaId}`} className="card-lift flex items-center gap-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4" data-testid={`conversation-${conversation.changaId}-${conversation.profesionalId ?? 'general'}`}><Avatar name={conversation.interlocutor?.nombre || 'Worky'} size="md" warm /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-1"><p className="truncate text-sm font-bold">{conversation.interlocutor?.nombre || 'Profesional'}</p>{role === 'professional' && conversation.interlocutor?.clientVerified && <ShieldCheck size={14} className="shrink-0 text-[hsl(var(--primary))]" aria-label="Cliente verificado" data-testid={`badge-client-verified-conversation-${conversation.changaId}`} />}</div><StatusBadge status={conversation.estado === 'publicada' ? 'published' : conversation.estado === 'aceptada' ? 'accepted' : conversation.estado === 'en_curso' ? 'in_progress' : conversation.estado === 'trabajo_realizado' ? 'awaiting_payment' : conversation.estado === 'finalizada' ? 'completed' : 'cancelled'} /></div><p className="mt-1 truncate text-xs text-[hsl(var(--muted-foreground))]">{conversation.categoria} · {conversation.ultimoMensaje?.texto || conversation.detalle || 'Sin mensajes todavía'}</p></div>{conversation.unread > 0 && <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[hsl(var(--primary))] px-1.5 text-[10px] font-bold text-white">{conversation.unread}</span>}<ChevronRight size={16} className="text-[hsl(var(--muted-foreground))]" /></Link>)}</div>}</div>;
}

function PartnerDashboard() {
  const dashboard = useQuery({ queryKey: ['partner-dashboard'], queryFn: () => apiRequest<{ trabajos: Job[]; calendario: Array<{ id: number; empiezaAt: string; estado: string; changaId: number }>; archivos: Array<{ id: number }>; notificacionesNoLeidas: number }>('/partner/dashboard'), refetchInterval: 30000 });
  const visitBalance = useQuery({ queryKey: ['partner-visit-balance'], queryFn: () => apiRequest<{ availableAmount: number; pendingAmount: number; cashCommissionDue: number }>('/partner/saldo-visitas'), refetchInterval: 30000 });
  const recommendationRanking = useQuery<{
    active: boolean;
    windowDays?: number;
    incidentThreshold?: number;
    confirmedRecentIncidentCount?: number;
    cashVisitCommissionDue?: number;
    visibilityAdjusted?: boolean;
    incidents?: Array<{ jobId: number; category: string; reviewedAt: string }>;
  }>({
    queryKey: ['partner-recommendation-ranking'],
    queryFn: () => apiRequest('/partner/recommendation-ranking'),
    refetchInterval: 60000,
  });
  if (dashboard.isLoading) return <LoadingBlock label="Cargando tu operación..." />;
  if (dashboard.isError || !dashboard.data) return <ErrorState onRetry={() => void dashboard.refetch()} />;
  const data = dashboard.data;
  const jobs = data.trabajos.map(toJob);
  const moneyLabel = (amount = 0) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(amount);
  return <div className="space-y-8">
    <div><p className="eyebrow">Operación Partner</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Todo lo que tenés en marcha.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Trabajos, agenda y conversaciones en un solo lugar.</p></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl bg-[hsl(var(--secondary))] p-5 text-white"><BriefcaseBusiness size={19} className="text-[hsl(var(--accent))]" /><p className="mt-5 text-3xl font-bold">{jobs.length}</p><p className="mt-1 text-xs text-white/60">trabajos activos</p></div>
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><CalendarDays size={19} className="text-[hsl(var(--primary))]" /><p className="mt-5 text-3xl font-bold">{data.calendario.length}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">eventos en agenda</p></div>
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><Bell size={19} className="text-[hsl(var(--primary))]" /><p className="mt-5 text-3xl font-bold">{data.notificacionesNoLeidas}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">novedades sin leer</p></div>
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5" data-testid="card-visit-balance"><Banknote size={19} className="text-[hsl(var(--primary))]" /><p className="mt-3 text-xs font-bold">Saldo de visitas</p>{visitBalance.isError ? <button onClick={() => void visitBalance.refetch()} className="mt-2 text-xs font-bold text-[hsl(var(--destructive))]">No se pudo cargar · Reintentar</button> : <><p className="mt-1 text-lg font-bold">{moneyLabel(visitBalance.data?.availableAmount)}</p><p className="text-[10px] text-[hsl(var(--muted-foreground))]">Disponible · {moneyLabel(visitBalance.data?.pendingAmount)} retenido</p>{visitBalance.data && visitBalance.data.cashCommissionDue > 0 && <p className="mt-1 text-[10px] font-semibold text-[hsl(var(--destructive))]">Comisión en efectivo adeudada: {moneyLabel(visitBalance.data.cashCommissionDue)}</p>}</>}</div>
    </div>
    {recommendationRanking.isError && <div role="alert" className="rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.08)] p-4 text-sm font-semibold text-[hsl(var(--destructive))]" data-testid="ranking-status-error">No pudimos consultar el estado de recomendaciones. <button className="underline" onClick={() => void recommendationRanking.refetch()}>Reintentar</button></div>}
    {recommendationRanking.data?.active && <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 md:p-6" data-testid="card-recommendation-ranking">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3"><span className="rounded-xl bg-[hsl(var(--secondary))] p-2 text-[hsl(var(--accent))]"><ShieldCheck size={19} /></span><div><p className="eyebrow">Visibilidad del perfil</p><h2 className="display-font mt-1 text-xl font-bold">Cómo se recomiendan los profesionales</h2></div></div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${recommendationRanking.data.visibilityAdjusted ? 'bg-[hsl(var(--accent)/.3)] text-[hsl(var(--foreground))]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}>{recommendationRanking.data.visibilityAdjusted ? 'Ajuste temporal activo' : 'Sin ajuste por saldo o señales'}</span>
      </div>
      <p className="mt-3 max-w-4xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">El orden también considera reseñas, trabajos finalizados, experiencia y recomendaciones públicas. Una comisión de visita confirmada pendiente puede bajar la posición; las señales solo cuentan si administración las revisa y confirma. Dos señales dentro de {recommendationRanking.data.windowDays ?? 30} días ajustan la visibilidad, nunca bloquean la cuenta.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-[hsl(var(--muted)/.65)] p-4"><p className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">Comisión de visita pendiente</p><p className="mt-1 text-lg font-bold">{moneyLabel(recommendationRanking.data.cashVisitCommissionDue)}</p></div>
        <div className="rounded-xl bg-[hsl(var(--muted)/.65)] p-4"><p className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">Señales revisadas en {recommendationRanking.data.windowDays ?? 30} días</p><p className="mt-1 text-lg font-bold">{recommendationRanking.data.confirmedRecentIncidentCount ?? 0} / {recommendationRanking.data.incidentThreshold ?? 2}</p></div>
      </div>
      {!!recommendationRanking.data.incidents?.length && <ul className="mt-4 divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))] px-4" data-testid="list-confirmed-ranking-signals">{recommendationRanking.data.incidents.map((incident) => <li key={`${incident.jobId}-${incident.reviewedAt}`} className="flex flex-wrap justify-between gap-2 py-3 text-xs"><span className="font-semibold">Trabajo #{incident.jobId} · {incident.category} · señal revisada</span><time className="text-[hsl(var(--muted-foreground))]">{dateLabel(incident.reviewedAt)}</time></li>)}</ul>}
      <p className="mt-3 text-[11px] text-[hsl(var(--muted-foreground))]">Los mensajes y una cancelación, por sí solos, no generan sanciones. Las devoluciones, intentos pendientes y pagos de prueba no activan esta capa.</p>
    </section>}
    <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]"><section><div className="mb-4 flex items-center justify-between"><h2 className="display-font text-xl font-bold">Trabajos recientes</h2><Link href="/jobs" className="text-xs font-bold text-[hsl(var(--primary))]">Ver todos</Link></div>{jobs.length ? <div className="space-y-3">{jobs.slice(0, 5).map((job) => <JobCard key={job.id} job={job} />)}</div> : <EmptyState icon={BriefcaseBusiness} title="Todavía no hay trabajos" copy="Las oportunidades que aceptes van a aparecer acá." />}</section><section className="space-y-6"><div><h2 className="mb-4 display-font text-xl font-bold">Próximamente</h2><div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">{data.calendario.length ? data.calendario.slice(0, 4).map((event) => <Link href={`/chat/${event.changaId}`} key={event.id} className="flex items-center gap-3 border-b border-[hsl(var(--border))] py-3 last:border-0"><CalendarDays size={17} className="text-[hsl(var(--primary))]" /><span><b className="block text-xs">{dateLabel(event.empiezaAt)}</b><small className="text-[11px] text-[hsl(var(--muted-foreground))]">Reserva {event.estado}</small></span></Link>) : <p className="py-5 text-center text-xs text-[hsl(var(--muted-foreground))]">Tu agenda está despejada.</p>}</div></div><div className="rounded-2xl bg-[hsl(var(--accent))] p-5"><p className="text-xs font-bold">Portfolio conectado</p><p className="mt-2 text-sm leading-relaxed">Tus archivos se guardan en almacenamiento seguro; Worky conserva solo sus metadatos.</p><Link href="/profile" className="mt-4 inline-flex text-xs font-bold underline">Administrar perfil y archivos</Link></div></section></div>
  </div>;
}

function NewJobPage() {
  const createJob = useCreateJob();
  const [, setLocation] = useLocation();
  const [form, setForm] = useState({ category: '', location: '', price: '', detail: '', paymentMethod: 'mercado_pago' as 'mercado_pago' | 'efectivo' });
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); createJob.mutate({ data: { categoria: form.category, ubicacion: { direccionTexto: form.location }, precioOfrecido: Number(form.price), detalle: form.detail, profesionalId: null, paymentMethod: form.paymentMethod } }, { onSuccess: (job) => { queryClient.invalidateQueries({ queryKey: getListMyJobsQueryKey() }); setLocation(`/chat/${job.id}`); } }); };
  return <div className="mx-auto max-w-3xl space-y-7"><Link href="/jobs" className="focus-ring inline-flex items-center gap-2 text-xs font-bold text-[hsl(var(--muted-foreground))]" data-testid="link-back-jobs"><ChevronRight className="rotate-180" size={15} /> Volver a changas</Link><div><p className="eyebrow">Nueva publicación</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">¿Qué necesitás resolver?</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Cuanto más detalle compartas, mejores propuestas vas a recibir.</p></div><form onSubmit={submit} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 md:p-8"><div className="grid gap-5 md:grid-cols-2"><label><span className="label">Oficio</span><select required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="field" data-testid="select-job-category"><option value="">Elegí una categoría</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label><span className="label">Zona</span><div className="relative"><MapPin size={16} className="absolute left-3 top-3.5 text-[hsl(var(--muted-foreground))]" /><input required minLength={3} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} className="field pl-9" placeholder="Ej: Villa Urquiza, CABA" data-testid="input-job-location" /></div></label><label><span className="label">Presupuesto orientativo</span><div className="relative"><span className="absolute left-3 top-3 text-sm font-bold text-[hsl(var(--muted-foreground))]">$</span><input required type="number" min="0" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} className="field pl-8" placeholder="45000" data-testid="input-job-price" /></div></label><label><span className="label">Medio de pago</span><select className="field" value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value as 'mercado_pago' | 'efectivo' })} data-testid="select-job-payment-method"><option value="mercado_pago">Mercado Pago</option><option value="efectivo">Efectivo, con confirmación de ambas partes</option></select></label><div className="rounded-xl bg-[hsl(var(--muted)/.7)] p-3 text-xs leading-relaxed text-[hsl(var(--muted-foreground))] md:col-span-2"><ShieldCheck size={16} className="mb-1 text-[hsl(var(--primary))]" /><b className="text-[hsl(var(--foreground))]">Cierre protegido.</b> El trabajo solo finaliza cuando Worky confirma Mercado Pago o ambas partes confirman el efectivo.</div><label className="md:col-span-2"><span className="label">Contá qué hay que hacer</span><textarea required minLength={3} value={form.detail} onChange={(event) => setForm({ ...form, detail: event.target.value })} className="field min-h-36 resize-y" placeholder="Describí el problema, medidas, materiales o cualquier dato que ayude..." data-testid="textarea-job-detail" /></label></div><div className="mt-7 flex flex-col-reverse gap-3 border-t border-[hsl(var(--border))] pt-6 sm:flex-row sm:justify-end"><Link href="/jobs" className="focus-ring" data-testid="link-cancel-job"><Button variant="ghost" className="w-full sm:w-auto" testId="button-cancel-job">Cancelar</Button></Link><Button type="submit" disabled={createJob.isPending} className="w-full sm:w-auto" testId="button-publish-job">{createJob.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Plus size={17} />} {createJob.isPending ? 'Publicando...' : 'Publicar changa'}</Button></div>{createJob.isError && <p className="mt-4 text-right text-xs font-bold text-[hsl(var(--destructive))]" data-testid="text-job-error">No se pudo publicar. Revisá los datos e intentá de nuevo.</p>}</form></div>;
}

function AppointmentAttemptHistoryLegacy({ attempts }: { attempts: AppointmentAttempt[] }) {
  return <div className="mt-5 border-t border-[hsl(var(--border)/.6)] pt-4"><p className="mb-3 text-xs font-bold">Historial de intentos</p>{attempts.length ? <div className="space-y-2" data-testid="appointment-attempt-history">{attempts.map((attempt) => { const labels = appointmentAttemptLabel(attempt); return <div key={attempt.id} className="rounded-xl bg-white/60 px-3 py-2 text-xs"><div className="flex items-start justify-between gap-3"><span className="font-bold">{labels.action}</span><span className={`text-right font-bold ${attemptResultTone(attempt.resultado)}`}>{labels.result}</span></div><p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(attempt.createdAt))}{attempt.detalle ? ` · ${attempt.detalle}` : ''}</p></div>; })}</div> : <p className="text-xs text-[hsl(var(--muted-foreground))]">Todavía no hay intentos registrados.</p>}</div>;
}

const APPOINTMENT_STATUS: Record<string, { label: string; tone: string }> = {
  solicitada: { label: 'Esperando respuesta', tone: 'bg-[hsl(var(--accent)/.35)] text-[hsl(var(--accent-foreground))]' },
  confirmada: { label: 'Confirmada', tone: 'bg-[hsl(152_45%_40%/.14)] text-[hsl(152_50%_28%)]' },
  en_curso: { label: 'En curso', tone: 'bg-[hsl(var(--secondary)/.12)] text-[hsl(var(--secondary))]' },
  finalizada: { label: 'Finalizada', tone: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]' },
  completada: { label: 'Completada', tone: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]' },
  rechazada: { label: 'Rechazada', tone: 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]' },
  cancelada: { label: 'Cancelada', tone: 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]' },
};
function AppointmentStatusPill({ estado }: { estado: string }) {
  const meta = APPOINTMENT_STATUS[estado] || { label: estado.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), tone: 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]' };
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.tone}`}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />{meta.label}</span>;
}
function AppointmentAttemptHistory({ attempts, onRetry, onDelete, syncingId }: { attempts: AppointmentAttempt[]; onRetry?: (attempt: PendingAppointmentAttempt) => void; onDelete?: (id: number) => void; syncingId?: number | null }) {
  const pendingCount = attempts.filter((attempt) => attempt.id < 0).length;
  return <details open={pendingCount > 0 || undefined} data-testid="appointment-attempt-history" className="group mt-1 rounded-lg border-t border-dashed border-[hsl(var(--border))] pt-2"><summary data-testid="toggle-appointment-attempt-history" className="focus-ring flex cursor-pointer list-none items-center gap-2 rounded-md py-1 text-[11px] font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] [&::-webkit-details-marker]:hidden"><ChevronRight size={13} className="transition-transform group-open:rotate-90" aria-hidden="true" /><span>Historial de intentos</span><span className="rounded-full bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[10px]">{attempts.length}</span>{pendingCount > 0 && <span className="rounded-full bg-[hsl(var(--primary)/.15)] px-1.5 py-0.5 text-[10px] text-[hsl(var(--primary))]">{pendingCount} sin sincronizar</span>}</summary>{attempts.length ? <ol className="mt-1.5 space-y-1 border-l-2 border-[hsl(var(--border))] pl-3" data-testid="list-appointment-attempts">{attempts.map((attempt) => { const labels = appointmentAttemptLabel(attempt); const pending = attempt.id < 0; return <li key={attempt.id} className={`rounded-lg px-2.5 py-1.5 text-[11px] ${pending ? 'border border-[hsl(var(--accent)/.7)] bg-[hsl(var(--accent)/.18)]' : ''}`}><div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><span className="font-bold">{labels.action}</span><span className={`font-bold ${pending ? 'text-[hsl(var(--primary))]' : attemptResultTone(attempt.resultado)}`}>{pending ? 'Pendiente de sincronización' : labels.result}</span><span className="text-[10px] text-[hsl(var(--muted-foreground))]">{new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(attempt.createdAt))}{attempt.detalle ? ` · ${attempt.detalle}` : ''}</span></div>{pending && onRetry && onDelete && <div className="mt-1.5 flex flex-wrap gap-2"><button type="button" onClick={() => onRetry(attempt as PendingAppointmentAttempt)} disabled={syncingId === attempt.id} className="focus-ring inline-flex items-center gap-1 rounded-lg bg-[hsl(var(--primary))] px-2 py-1 text-[10px] font-bold text-white disabled:opacity-60" data-testid={`button-retry-attempt-${attempt.id}`}>{syncingId === attempt.id ? <LoaderCircle className="animate-spin" size={12} /> : <RefreshCw size={12} />} {syncingId === attempt.id ? 'Sincronizando...' : 'Reintentar'}</button><button type="button" onClick={() => onDelete(attempt.id)} disabled={syncingId === attempt.id} className="focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.08)] disabled:opacity-60" data-testid={`button-delete-attempt-${attempt.id}`}><Trash2 size={12} /> Eliminar</button></div>}</li>; })}</ol> : <p className="text-xs text-[hsl(var(--muted-foreground))]">Todavía no hay intentos registrados.</p>}</details>;
}

function ChatAttachment({ attachment, outgoing }: { attachment: { objectPath: string; nombre?: string }; outgoing: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    if (!attachment.objectPath.startsWith('/objects/chat-attachments/')) return undefined;
    void fetchWorkyObject(attachment.objectPath).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.objectPath]);
  if (src && !failed) return <a href={src} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-xl" aria-label={`Abrir ${attachment.nombre || 'imagen adjunta'}`}><img src={src} alt={attachment.nombre || 'Imagen adjunta'} className="max-h-56 max-w-full object-cover" /></a>;
  return <span className={`mt-2 flex items-center gap-1.5 text-xs underline ${outgoing ? 'text-white/85' : 'text-[hsl(var(--primary))]'}`}><ImageIcon size={14} /> {failed ? 'No se pudo cargar la imagen' : attachment.nombre || 'Imagen adjunta'}</span>;
}

function ChatPageLegacy({ role }: { role: Role }) {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const auth = useAuth();
  const requestedThreadProfessionalId = Number(new URLSearchParams(window.location.search).get('profesionalId')) || null;
  const threadProfessionalId = requestedThreadProfessionalId ?? (role === 'professional' ? auth.user?.id ?? null : null);
  const messageQueryKey = ['chat-messages', id, threadProfessionalId] as const;
  const job = useQuery<Job>({
    queryKey: ['chat-job', id, threadProfessionalId],
    queryFn: () => apiRequest<Job>(threadProfessionalId
      ? `/trabajos/${id}/hilos/${threadProfessionalId}`
      : `/trabajos/${id}`),
    enabled: Number.isInteger(id) && id > 0,
    retry: false,
  });
  const messages = useQuery<ChatMessage[]>({
    queryKey: messageQueryKey,
    queryFn: () => apiRequest<ChatMessage[]>(threadProfessionalId
      ? `/chats/${id}/hilos/${threadProfessionalId}/mensajes`
      : `/chats/${id}/mensajes`),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: 10000,
  });
  const appointmentQuery = useListAppointments(id, { query: { queryKey: getListAppointmentsQueryKey(id), enabled: Boolean(job.data?.profesionalId), refetchInterval: 10000 } });
  const attemptHistory = useQuery({
    queryKey: getListAppointmentAttemptsQueryKey(id),
    queryFn: () => apiRequest<AppointmentAttempt[]>(`/chats/${id}/historial-visitas`),
    // Keep an open conversation current when the other participant proposes,
    // accepts, or rejects a visit in another session.
    enabled: Boolean(job.data?.profesionalId),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
  const proposeAppointmentMutation = useProposeAppointment();
  const acceptAppointmentMutation = useAcceptAppointment();
  const rejectAppointmentMutation = useRejectAppointment();
  const [body, setBody] = useState('');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentFee, setAppointmentFee] = useState('');
  const [appointmentActionError, setAppointmentActionError] = useState('');
  const [pendingAppointmentAction, setPendingAppointmentAction] = useState<AppointmentAction | null>(null);
  const [localAttempts, setLocalAttempts] = useState<PendingAppointmentAttempt[]>(() => getPendingAppointmentAttempts(id));
  const [syncingAttemptId, setSyncingAttemptId] = useState<number | null>(null);
  const [chatFiles, setChatFiles] = useState<Array<{ file: File; preview: string }>>([]);
  const [chatError, setChatError] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  useEffect(() => {
    const clientView = Boolean(auth.user && job.data && job.data.profesionalId !== auth.user.id);
    document.body.classList.toggle('chat-client-view', clientView);
    return () => document.body.classList.remove('chat-client-view');
  }, [auth.user, job.data]);
  const removePendingAttempt = (attemptId: number) => {
    setLocalAttempts((current) => {
      const next = current.filter((attempt) => attempt.id !== attemptId);
      savePendingAppointmentAttempts(id, next);
      return next;
    });
  };
  const retryPendingAttempt = async (attempt: PendingAppointmentAttempt) => {
    setSyncingAttemptId(attempt.id);
    try {
      await syncPendingAppointmentAttempts(id);
      await attemptHistory.refetch();
    } catch (error) {
      setAppointmentActionError(error instanceof Error ? error.message : 'No pudimos sincronizar este intento.');
    } finally {
      setSyncingAttemptId(null);
    }
  };
  const syncPendingAttempts = async () => {
    try {
      await syncPendingAppointmentAttempts(id);
      await attemptHistory.refetch();
    } catch {
      // La cola permanece visible para reintentar cuando vuelva el servidor.
    }
  };
  const rememberFailedAttempt = async (accion: AppointmentAttempt['accion'], error: unknown) => {
    const resultado: AppointmentAttempt['resultado'] = error instanceof WorkyApiError
      ? error.status === 403 ? 'error_permiso' : 'error_validacion'
      : 'error_red';
    const detalle = error instanceof Error ? error.message : 'No pudimos conectar con el servidor.';
    const attempt: AppointmentAttempt = { id: -Date.now(), changaId: id, accion, resultado, detalle, appointmentId: null, empiezaAt: null, createdAt: new Date().toISOString() };
    try {
      await apiRequest(`/chats/${id}/historial-visitas`, { method: 'POST', body: JSON.stringify({ accion, resultado, detalle }) });
      await attemptHistory.refetch();
    } catch {
      setLocalAttempts(() => addPendingAppointmentAttempt(id, attempt as PendingAppointmentAttempt));
    }
  };
  useEffect(() => {
    const sync = () => { void syncPendingAttempts(); };
    sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [id]);
  useEffect(() => {
    if (!job.data) return;
    const path = threadProfessionalId
      ? `/chats/${id}/hilos/${threadProfessionalId}/leidos`
      : `/chats/${id}/leidos`;
    void apiRequest(path, { method: 'POST' })
      .then(() => queryClient.invalidateQueries({ queryKey: conversationsQueryKey(role) }))
      .catch(() => undefined);
  }, [id, role, threadProfessionalId, job.data]);
  const selectChatFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const nextFiles = Array.from(files).filter((file) => file.type.startsWith('image/')).slice(0, 5 - chatFiles.length);
    if (nextFiles.length !== files.length) setChatError('Solo podés adjuntar hasta 5 imágenes.');
    setChatFiles((current) => [...current, ...nextFiles.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  };
  const removeChatFile = (index: number) => {
    setChatFiles((current) => {
      const removed = current[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return current.filter((_, currentIndex) => currentIndex !== index);
    });
  };
  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if ((!body.trim() && !chatFiles.length) || sendingMessage) return;
    setChatError('');
    setSendingMessage(true);
    try {
      const adjuntos = await Promise.all(chatFiles.map(({ file }) => uploadWorkyFile(file, 'chat_image', id, threadProfessionalId ?? undefined)));
      const messagePath = threadProfessionalId
        ? `/chats/${id}/hilos/${threadProfessionalId}/mensajes`
        : `/chats/${id}/mensajes`;
      await apiRequest<ChatMessage>(messagePath, {
        method: 'POST',
        body: JSON.stringify({ texto: body.trim() || 'Imagen adjunta', adjuntos }),
      });
      chatFiles.forEach(({ preview }) => URL.revokeObjectURL(preview));
      setChatFiles([]);
      setBody('');
      await messages.refetch();
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'No pudimos enviar el mensaje.');
    } finally {
      setSendingMessage(false);
    }
  };
  const proposeAppointment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth.user || !job.data || job.data.profesionalId !== auth.user.id) return;
    if (!appointmentDate || pendingAppointmentAction) return;
    setAppointmentActionError('');
    setPendingAppointmentAction('propose');
    try {
      await proposeAppointmentMutation.mutateAsync({ changaId: id, data: { empiezaAt: new Date(appointmentDate).toISOString(), tarifaVisita: Number(appointmentFee) } });
      setAppointmentDate('');
      setAppointmentFee('');
      await appointments.refetch();
    } catch (error) {
      setAppointmentActionError(appointmentErrorMessage('propose', error));
      await rememberFailedAttempt('proponer', error);
    } finally {
      setPendingAppointmentAction(null);
    }
  };
  const runAppointmentAction = async (action: AppointmentAction, appointmentId: number, extra?: { method?: 'mercado_pago' | 'efectivo'; issueType?: 'partner_no_show' | 'client_no_show' | 'other'; detail?: string }) => {
    if (pendingAppointmentAction) return;
    setAppointmentActionError('');
    setPendingAppointmentAction(action);
    try {
      if (action === 'accept') {
        const result = await apiRequest<{ appointment: Appointment; checkoutUrl: string | null }>(`/citas/${appointmentId}/aceptar`, {
          method: 'POST', body: JSON.stringify({ paymentMethod: extra?.method }),
        });
        if (result.checkoutUrl) {
          window.location.assign(result.checkoutUrl);
          return;
        }
      }
      else if (action === 'reject') await rejectAppointmentMutation.mutateAsync({ id: appointmentId });
      else if (action === 'cancel') await apiRequest(`/citas/${appointmentId}`, { method: 'PATCH', body: JSON.stringify({ accion: 'cancelar' }) });
      else if (action === 'arrival') await apiRequest(`/citas/${appointmentId}/llegada`, { method: 'POST' });
      else if (action === 'complete') await apiRequest(`/citas/${appointmentId}/completar`, { method: 'POST' });
      else if (action === 'confirm') await apiRequest(`/citas/${appointmentId}/confirmar-visita`, { method: 'POST' });
      else if (action === 'report') await apiRequest(`/citas/${appointmentId}/reportar-problema`, {
        method: 'POST', body: JSON.stringify({ issueType: extra?.issueType, detail: extra?.detail }),
      });
      await appointments.refetch();
    } catch (error) {
       setAppointmentActionError(appointmentErrorMessage(action, error));
       if (action === 'accept' || action === 'reject' || action === 'cancel') {
         await rememberFailedAttempt(action === 'accept' ? 'aceptar' : action === 'cancel' ? 'cancelar' : 'rechazar', error);
       }
    } finally {
      setPendingAppointmentAction(null);
    }
  };
  if (job.isLoading) return <LoadingBlock label="Abriendo conversación..." />;
  if (job.isError || !job.data) return <ErrorState onRetry={() => void job.refetch()} />;
  const currentJob = toJob(job.data);
  const chatProfessionalId = threadProfessionalId ?? currentJob.professionalId;
  const list = messages.data || [];
  const remoteAttempts = attemptHistory.data || [];
  const remoteFingerprints = new Set(remoteAttempts.map((attempt) => `${attempt.accion}|${attempt.resultado}|${attempt.detalle || ''}`));
  const historyRows = [...remoteAttempts, ...localAttempts.filter((attempt) => !remoteFingerprints.has(`${attempt.accion}|${attempt.resultado}|${attempt.detalle || ''}`))].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const appointments = { ...appointmentQuery, data: appointmentQuery.data?.length ? appointmentQuery.data : historyRows.length ? [{ id: -1, changaId: id, clienteId: currentJob.clientId, profesionalId: currentJob.professionalId || 0, empiezaAt: new Date().toISOString(), terminaAt: null, tarifaVisita: 0, estado: 'cancelada' as const, finanzas: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] : appointmentQuery.data };
  const activeAppointment = appointmentQuery.data?.some((appointment) => ['solicitada', 'confirmada', 'en_curso'].includes(appointment.estado));
  // Do not expose the proposal form while the server is still checking the
  // current appointments; otherwise a confirmed visit briefly looks
  // available again on the Partner's first render.
  const canProposeAppointment = appointmentQuery.isSuccess && auth.user?.id === currentJob.professionalId && !activeAppointment;
  const appointmentRows = appointments.data?.map((appointment, index) => appointment.id < 0 ? <AppointmentAttemptHistory key={appointment.id} attempts={historyRows} onRetry={retryPendingAttempt} onDelete={removePendingAttempt} syncingId={syncingAttemptId} /> : <div key={appointment.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[hsl(var(--border)/.7)] bg-[hsl(var(--card))] px-3 py-2.5 text-xs shadow-[0_1px_2px_hsl(222_43%_16%/.04)]"><span className="flex min-w-0 items-center gap-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]"><CalendarDays size={15} /></span><span className="min-w-0"><span className="block text-[10px] font-semibold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">Visita</span><span className="display-font block font-bold leading-tight">{new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(appointment.empiezaAt))}</span><span className="mt-1 block text-[10px] font-semibold">Tarifa: {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(appointment.tarifaVisita)}</span></span></span><AppointmentStatusPill estado={appointment.estado} /><AppointmentActions appointment={appointment} clientId={currentJob.clientId} partnerId={currentJob.professionalId ?? 0} onAccept={(appointmentId, method) => void runAppointmentAction('accept', appointmentId, { method })} onReject={(appointmentId) => void runAppointmentAction('reject', appointmentId)} onCancel={(appointmentId) => void runAppointmentAction('cancel', appointmentId)} onArrival={(appointmentId) => void runAppointmentAction('arrival', appointmentId)} onComplete={(appointmentId) => void runAppointmentAction('complete', appointmentId)} onConfirm={(appointmentId) => void runAppointmentAction('confirm', appointmentId)} onReport={(appointmentId, issueType, detail) => void runAppointmentAction('report', appointmentId, { issueType, detail })} pendingAction={pendingAppointmentAction} history={index === 0 ? historyRows : undefined} onRetry={retryPendingAttempt} onDelete={removePendingAttempt} syncingId={syncingAttemptId} /></div>);
  return <div className="mx-auto max-w-3xl"><Link href="/conversations" className="focus-ring mb-6 inline-flex items-center gap-2 text-xs font-bold text-[hsl(var(--muted-foreground))]" data-testid="link-back-from-chat"><ChevronRight className="rotate-180" size={15} /> Volver a conversaciones</Link><section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]"><header className="flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)] px-5 py-4"><div className="flex items-center gap-3"><Link href={chatProfessionalId ? `/professional/${chatProfessionalId}` : '/home'} className="focus-ring flex items-center gap-3 rounded-xl" data-testid="link-chat-professional-profile" aria-label={`Abrir perfil de ${currentJob.professionalName || 'Partner'}`}><Avatar initials={(currentJob.professionalName || currentJob.clientName).split(' ').map((part) => part[0]).slice(0, 2).join('')} size="sm" warm /><span className="text-xs font-bold">{currentJob.professionalName || currentJob.clientName}</span></Link><div><p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">{currentJob.category} · {currentJob.location}</p></div></div><StatusBadge status={currentJob.status} /></header><div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--accent)/.25)] p-4" data-testid="chat-visits-panel"><div className="mb-3 flex items-center gap-2"><CalendarDays size={16} className="text-[hsl(var(--primary))]" /><p className="text-xs font-bold">Visitas coordinadas</p></div>{appointments.data?.length ? <div className="space-y-2">{appointmentRows}</div> : <p className="text-xs text-[hsl(var(--muted-foreground))]">Todavía no hay una visita propuesta.</p>}{appointmentActionError && <p className="appointment-error mt-3" role="alert" data-testid="text-appointment-error"><CircleAlert size={15} /> {appointmentActionError}</p>}{auth.user?.id === currentJob.professionalId ? canProposeAppointment ? <form onSubmit={proposeAppointment} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input type="datetime-local" required value={appointmentDate} onChange={(event) => setAppointmentDate(event.target.value)} className="field bg-white/75" aria-label="Fecha y hora de visita" /><input required type="number" min="1" max="10000000" step="0.01" value={appointmentFee} onChange={(event) => setAppointmentFee(event.target.value)} className="field bg-white/75" placeholder="Tarifa de visita (ARS)" aria-label="Tarifa de visita en pesos" /><Button type="submit" disabled={pendingAppointmentAction !== null} variant="soft" className="whitespace-nowrap" testId="button-propose-appointment">{pendingAppointmentAction === 'propose' && <LoaderCircle className="animate-spin" size={15} />} {pendingAppointmentAction === 'propose' ? 'Proponiendo...' : 'Proponer visita'}</Button><p className="sm:col-span-3 text-[10px] text-[hsl(var(--muted-foreground))]">El cliente paga al aceptar. Worky cobra el 15%; el 85% del Partner queda retenido hasta confirmar la visita o terminar la revisión de 24 horas.</p></form> : <p className="mt-3 text-xs font-semibold text-[hsl(var(--muted-foreground))]">Ya hay una visita activa. Esperá a que se cancele o finalice antes de proponer otra.</p> : null}</div><div className="flex min-h-[430px] flex-col gap-4 bg-[hsl(var(--background)/.5)] p-5 md:p-8" data-testid="list-messages">{messages.isLoading ? <LoadingBlock label="Cargando mensajes..." /> : messages.isError ? <ErrorState onRetry={() => void messages.refetch()} /> : list.length === 0 ? <EmptyState icon={MessageCircle} title="Arranquen la conversación" copy="Coordiná detalles, horarios y expectativas antes de empezar." /> : list.map((message) => <div key={message.id} className={`flex ${message.emisor.id === currentJob.clientId ? 'justify-end' : 'justify-start'}`} data-testid={`message-${message.id}`}><div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.emisor.id === currentJob.clientId ? 'rounded-br-md bg-[hsl(var(--secondary))] text-white' : 'rounded-bl-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`}><p>{message.texto}</p>{message.adjuntos.map((attachment) => <ChatAttachment key={attachment.objectPath} attachment={attachment} outgoing={message.emisor.id === currentJob.clientId} />)}<p className={`mt-1.5 text-[10px] ${message.emisor.id === currentJob.clientId ? 'text-white/45' : 'text-[hsl(var(--muted-foreground))]'}`}>{message.emisor.nombre} · {dateLabel(message.createdAt)}</p></div></div>)}</div><form onSubmit={send} className="border-t border-[hsl(var(--border))] p-4"><div className="mb-3 flex flex-wrap gap-2">{chatFiles.map((item, index) => <div key={`${item.file.name}-${index}`} className="relative"><img src={item.preview} alt={item.file.name} className="h-14 w-14 rounded-lg object-cover" /><button type="button" onClick={() => removeChatFile(index)} className="absolute -right-1.5 -top-1.5 rounded-full bg-[hsl(var(--secondary))] p-1 text-white" aria-label={`Quitar ${item.file.name}`}><X size={12} /></button></div>)}</div>{chatError && <p className="mb-2 text-xs font-semibold text-[hsl(var(--destructive))]" role="alert">{chatError}</p>}<div className="flex items-end gap-2"><label className="flex h-[46px] w-[46px] shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" aria-label="Adjuntar imágenes"><Paperclip size={18} /><input type="file" accept="image/*" multiple className="hidden" onChange={(event) => { selectChatFiles(event.target.files); event.currentTarget.value = ''; }} data-testid="input-chat-images" /></label><textarea value={body} onChange={(event) => setBody(event.target.value)} className="field min-h-[46px] max-h-32 resize-none" rows={1} placeholder="Escribí un mensaje..." maxLength={1000} data-testid="textarea-message" /><Button type="submit" disabled={sendingMessage || (!body.trim() && !chatFiles.length)} className="h-[46px] w-[46px] shrink-0 p-0" testId="button-send-message">{sendingMessage ? <LoaderCircle className="animate-spin" size={17} /> : <Send size={17} />}</Button></div></form></section></div>;
}

function ChatPage({ role }: { role: Role }) {
  return <ChatPageLegacy role={role} />;
}

function ClientProfilePage() {
  const auth = useAuth();
  const user = auth.user;
  if (!user) return <LoadingBlock label="Cargando tu cuenta..." />;
  const initials = user.nombre.split(' ').map((part) => part[0]).join('').slice(0, 2);
  return <div className="mx-auto max-w-3xl space-y-8" data-testid="client-profile-page"><div><p className="eyebrow">Tu cuenta</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Tu perfil de cliente.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Desde acá contratás profesionales y seguís tus changas.</p></div><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 md:p-8"><div className="flex items-center gap-4 border-b border-[hsl(var(--border))] pb-6"><Avatar name={user.nombre} initials={initials} size="lg" warm /><div><h2 className="display-font text-xl font-bold">{user.nombre}</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{user.email}</p></div></div><div className="mt-5 flex flex-wrap items-center gap-2" data-testid="client-profile-rating"><span className="text-xs font-bold">Puntaje como cliente</span><span className="flex items-center gap-0.5" aria-label="Sin calificaciones: cinco estrellas vacías"><Star size={16} className="text-[hsl(var(--muted-foreground))]" /><Star size={16} className="text-[hsl(var(--muted-foreground))]" /><Star size={16} className="text-[hsl(var(--muted-foreground))]" /><Star size={16} className="text-[hsl(var(--muted-foreground))]" /><Star size={16} className="text-[hsl(var(--muted-foreground))]" /></span><span className="text-xs text-[hsl(var(--muted-foreground))]">(0 reseñas)</span></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><div className="rounded-xl bg-[hsl(var(--muted)/.7)] p-4"><p className="text-xs font-bold">Usás Worky como cliente</p><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Podés publicar changas, conversar y calificar trabajos finalizados.</p></div><div className="rounded-xl bg-[hsl(var(--accent)/.35)] p-4"><p className="text-xs font-bold">¿También ofrecés servicios?</p><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Activá tu perfil Partner sin crear otra cuenta.</p><Link href="/partner" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[hsl(var(--primary))]" data-testid="link-create-partner-from-client-profile">Ofrecer mis servicios <ChevronRight size={14} /></Link></div></div></section><AccountPasswordForm account={user} /></div>;
}

function PartnerProfilePage() {
  const profile = useGetMyProfessionalProfile({ query: { queryKey: getGetMyProfessionalProfileQueryKey(), retry: false } });
  const update = useUpdateMyProfessionalProfile();
  const [form, setForm] = useState<ProfileForm | null>(null);
  const person = profile.data ? toProfessional(profile.data) : null;
  const current = form || (person ? {
    trade: person.trade,
    category: person.category,
    price: person.price,
    experience: person.experience,
    bio: person.bio,
    skills: person.skills,
    available: person.available,
    locationAddress: profile.data?.ubicacionFija?.direccionTexto ?? '',
    locationCity: profile.data?.ubicacionFija?.ciudad ?? '',
    locationProvince: profile.data?.ubicacionFija?.provincia ?? '',
  } : null);
  if (profile.isLoading) return <LoadingBlock label="Cargando tu perfil..." />;
  if (profile.isError) return <ErrorState onRetry={() => void profile.refetch()} />;
  if (!profile.data || !person || !current) return <PartnerServiceSetupPage />;
  const value = current;
  const setField = <K extends keyof ProfileForm>(key: K, next: ProfileForm[K]) => setForm({ ...value, [key]: next });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    update.mutate({ data: {
      oficio: value.trade,
      categoria: value.category,
      precioReferencia: value.price,
      experienciaAnios: value.experience,
      about: value.bio,
      skills: value.skills,
      disponible: value.available,
      ubicacionFija: {
        direccionTexto: value.locationAddress.trim(),
        ciudad: value.locationCity.trim(),
        provincia: value.locationProvince.trim() || null,
        ...(value.locationCoordinates ? { coordinates: value.locationCoordinates } : {}),
      },
    } }, { onSuccess: () => { setForm(null); queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() }); queryClient.invalidateQueries({ queryKey: getListProfessionalsQueryKey() }); } });
  };
  return <PartnerProfileEditor person={person} value={value} setField={setField} submit={submit} update={update} verificationStatus={profile.data.estadoVerificacion} />;
}

function ProfilePage({ role }: { role: Role }) {
  const auth = useAuth();
  return role === 'professional'
    ? <div className="space-y-8"><MyPublicProfilePage />{auth.user && <div className="mx-auto max-w-3xl"><AccountPasswordForm account={auth.user} /></div>}</div>
    : <ClientProfilePage />;
}

function SkillsInput({ skills, onChange, testId = 'input-profile-skills' }: { skills: string[]; onChange: (skills: string[]) => void; testId?: string }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const skill = draft.trim();
    if (!skill || skills.some((item) => item.toLowerCase() === skill.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...skills, skill]);
    setDraft('');
  };
  return <div><div className="flex flex-wrap gap-2 rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] p-2 focus-within:ring-2 focus-within:ring-[hsl(var(--ring))]">{skills.map((skill) => <span key={skill} className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--muted))] px-2.5 py-1.5 text-xs font-semibold">{skill}<button type="button" onClick={() => onChange(skills.filter((item) => item !== skill))} className="rounded-full p-0.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--border))] hover:text-[hsl(var(--foreground))]" aria-label={`Eliminar habilidad ${skill}`}><X size={12} /></button></span>)}<input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter' || event.key === ',') { event.preventDefault(); commit(); } else if (event.key === 'Backspace' && !draft && skills.length) onChange(skills.slice(0, -1)); }} className="min-w-[160px] flex-1 bg-transparent px-1 py-1 text-sm outline-none" placeholder={skills.length ? 'Agregar otra habilidad' : 'Escribí una habilidad y apretá espacio'} data-testid={testId} /></div><p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">Separá cada habilidad con la barra espaciadora.</p></div>;
}

function LegacyPartnerProfileEditor({ person, value, setField, submit, update, verificationStatus, photoControl }: { person: WorkyProfessional; value: ProfileForm; setField: <K extends keyof ProfileForm>(key: K, next: ProfileForm[K]) => void; submit: (event: FormEvent<HTMLFormElement>) => void; update: ReturnType<typeof useUpdateMyProfessionalProfile>; verificationStatus: string; photoControl?: ReactNode }) {
  const [locationCoordinates, setLocationCoordinates] = useState<[number, number] | undefined>();
  const [locationError, setLocationError] = useState('');
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value.locationAddress.trim().length < 3 || value.locationCity.trim().length < 2) {
      setLocationError('Indicá la dirección exacta del taller y la ciudad.');
      return;
    }
    setLocationError('');
    if (locationCoordinates) setField('locationCoordinates', locationCoordinates);
    submit(event);
  };
  return <div className="mx-auto max-w-4xl space-y-8"><div><p className="eyebrow">Tu presencia</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Que tu perfil hable por vos.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Las personas eligen mejor cuando pueden conocerte un poco antes.</p></div><div className={`flex items-center gap-3 rounded-2xl border p-4 ${verificationStatus === 'verified' ? 'border-[#49a574]/30 bg-[#e6f4ed]' : verificationStatus === 'rejected' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}><ShieldCheck size={21} /><div><p className="text-sm font-bold">Verificación: {verificationStatusLabels[verificationStatus as VerificationDocument['estado']] || 'Pendiente de revisión'}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">El estado es privado de tu cuenta; tus documentos nunca aparecen en el perfil público.</p></div></div><form onSubmit={save} className="grid gap-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 md:grid-cols-2 md:p-8"><div className="md:col-span-2 flex flex-wrap items-center gap-4 border-b border-[hsl(var(--border))] pb-6"><Avatar name={person.name} initials={person.initials} photoUrl={person.photoUrl} size="lg" warm /><div className="min-w-0 flex-1"><h2 className="display-font text-xl font-bold">{person.name}</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Perfil profesional · {person.location || 'Sin dirección cargada'}</p></div>{photoControl}</div><label><span className="label">Oficio principal</span><input required minLength={2} value={value.trade} onChange={(event) => setField('trade', event.target.value)} className="field" data-testid="input-profile-trade" /></label><label><span className="label">Categoría</span><select required value={value.category} onChange={(event) => setField('category', event.target.value)} className="field" data-testid="select-profile-category"><option value="">Elegí una categoría</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label><span className="label">Precio por visita</span><input required type="number" min="0" value={value.price} onChange={(event) => setField('price', Number(event.target.value))} className="field" data-testid="input-profile-price" /></label><label><span className="label">Años de experiencia</span><input required type="number" min="0" value={value.experience} onChange={(event) => setField('experience', Number(event.target.value))} className="field" data-testid="input-profile-experience" /></label><div className="md:col-span-2 rounded-2xl border border-[hsl(var(--primary)/.25)] bg-[hsl(var(--accent)/.14)] p-4"><p className="text-sm font-bold">Dirección fija del taller</p><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">La dirección exacta es pública en tu perfil. Las coordenadas se usan solo para calcular distancias aproximadas y no se muestran.</p></div><label className="md:col-span-2"><span className="label">Dirección exacta</span><input required minLength={3} value={value.locationAddress} onChange={(event) => setField('locationAddress', event.target.value)} className="field" data-testid="input-profile-workshop-address" /></label><label><span className="label">Ciudad</span><input required minLength={2} value={value.locationCity} onChange={(event) => setField('locationCity', event.target.value)} className="field" data-testid="input-profile-workshop-city" /></label><label><span className="label">Provincia (opcional)</span><input value={value.locationProvince} onChange={(event) => setField('locationProvince', event.target.value)} className="field" data-testid="input-profile-workshop-province" /></label><div className="md:col-span-2"><Button type="button" variant="soft" onClick={() => { setLocationError(''); void captureBrowserCoordinates().then((coordinates) => { setLocationCoordinates(coordinates); setField('locationCoordinates', coordinates); }).catch((cause) => setLocationError(cause instanceof Error ? cause.message : 'No pudimos obtener la ubicación.')); }}><LocateFixed size={16} /> {locationCoordinates ? 'Actualizar punto del taller' : 'Usar ubicación actual del taller'}</Button>{locationError && <p className="mt-2 text-xs font-semibold text-[hsl(var(--destructive))]" role="alert">{locationError}</p>}</div><label className="md:col-span-2"><span className="label">Sobre tu trabajo</span><textarea required value={value.bio} onChange={(event) => setField('bio', event.target.value)} className="field min-h-32 resize-y" placeholder="Contá qué hacés, cómo trabajás y qué te diferencia..." data-testid="textarea-profile-bio" /></label><label className="md:col-span-2"><span className="label">Habilidades</span><SkillsInput skills={value.skills} onChange={(skills) => setField('skills', skills)} /><span className="sr-only">Separá cada habilidad con espacio, Enter o coma.</span></label><div className="md:col-span-2 flex items-center justify-between rounded-xl bg-[hsl(var(--muted)/.7)] p-4"><div><p className="text-sm font-bold">Estoy disponible para nuevas changas</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Tu perfil aparece activo en las búsquedas.</p></div><button type="button" onClick={() => setField('available', !value.available)} className={`relative h-7 w-12 rounded-full transition-colors ${value.available ? 'bg-[#49a574]' : 'bg-[hsl(var(--border))]'}`} data-testid="button-toggle-availability"><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${value.available ? 'translate-x-6' : 'translate-x-1'}`} /></button></div><div className="md:col-span-2 flex flex-col-reverse gap-3 border-t border-[hsl(var(--border))] pt-6 sm:flex-row sm:items-center sm:justify-end"><span className="mr-auto text-xs text-[hsl(var(--muted-foreground))]">{update.isSuccess ? 'Cambios guardados' : 'Tus cambios se guardan al confirmar.'}</span><Button type="submit" disabled={update.isPending} testId="button-save-profile">{update.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Check size={17} />} {update.isPending ? 'Guardando...' : 'Guardar cambios'}</Button></div>{update.isError && <p className="md:col-span-2 text-xs font-bold text-[hsl(var(--destructive))]">No pudimos guardar los cambios. Intentá nuevamente.</p>}</form></div>;
}

function PartnerProfileEditor(props: Parameters<typeof LegacyPartnerProfileEditor>[0]) {
  const auth = useAuth();
  const [photoUrl, setPhotoUrl] = useState(props.person.photoUrl);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const changePhoto = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    setPhotoError('');
    try {
      const uploaded = await uploadWorkyFile(file, 'profile_photo');
      const saved = await apiRequest<{ fotoObjectPath: string }>('/auth/profile-photo', { method: 'POST', body: JSON.stringify({ objectPath: uploaded.objectPath }) });
      const nextPhotoUrl = `/api/v1/storage/public-objects${saved.fotoObjectPath}`;
      setPhotoUrl(nextPhotoUrl);
      profilePhotosByInitials.set(props.person.initials, nextPhotoUrl);
      await auth.refreshUser();
      await queryClient.invalidateQueries({ queryKey: getGetProfessionalQueryKey(props.person.userId) });
      await queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getListProfessionalsQueryKey() });
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : 'No pudimos guardar la foto.');
    } finally {
      setUploading(false);
    }
  };
  const photoControl = <div className="ml-auto flex flex-col items-end"><label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-xs font-bold shadow-sm hover:bg-[hsl(var(--muted))]"><Pencil size={14} /> {uploading ? 'Cargando...' : 'Cambiar foto'}<input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(event) => void changePhoto(event.target.files?.[0])} data-testid="input-change-profile-photo" /></label>{photoError && <p className="mt-2 max-w-56 text-right text-[11px] font-semibold text-[hsl(var(--destructive))]">{photoError}</p>}</div>;
  return <LegacyPartnerProfileEditor {...props} person={{ ...props.person, photoUrl }} photoControl={photoControl} />;
}

function PartnerServiceSetupPage() {
  const registrationDraft = readRegistrationDraft();
  const primaryService = registrationDraft?.services?.[0];
  const [form, setForm] = useState({
    oficio: primaryService?.oficio ?? '',
    categoria: primaryService?.categoria ?? '',
    precioReferencia: '',
    experienciaAnios: primaryService?.experienciaAnios ?? 0,
    about: '',
    skills: registrationDraft?.services?.map((service) => service.oficio).filter(Boolean) ?? [],
    disponible: true,
    locationAddress: '',
    locationCity: '',
    locationProvince: '',
  });
  const [locationCoordinates, setLocationCoordinates] = useState<[number, number] | undefined>();
  const [error, setError] = useState('');
  const [locationError, setLocationError] = useState('');
  const [saved, setSaved] = useState(false);
  const createProfile = useCreateMyProfessionalProfile();
  const [, setLocation] = useLocation();
  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (form.locationAddress.trim().length < 3 || form.locationCity.trim().length < 2) {
      setError('Indicá la dirección exacta del taller y la ciudad.');
      return;
    }
    try {
      await createProfile.mutateAsync({
        data: {
          oficio: form.oficio,
          categoria: form.categoria,
          precioReferencia: Number(form.precioReferencia) || 0,
          experienciaAnios: form.experienciaAnios,
          about: form.about,
          skills: form.skills,
          disponible: form.disponible,
          ubicacionFija: {
            direccionTexto: form.locationAddress.trim(),
            ciudad: form.locationCity.trim(),
            provincia: form.locationProvince.trim() || null,
            ...(locationCoordinates ? { coordinates: locationCoordinates } : {}),
          },
        },
      });
      await queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      setSaved(true);
      setLocation('/profile');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos crear tu perfil Partner.');
    }
  };
  return <div className="mx-auto max-w-4xl space-y-8">
    <div><p className="eyebrow">Tu cuenta Worky</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Ofrecé lo que sabés hacer.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Completá los datos que van a formar parte de tu perfil público.</p></div>
    <form onSubmit={submit} className="grid gap-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 md:grid-cols-2 md:p-8">
      <label><span className="label">Oficio principal</span><input required minLength={2} value={form.oficio} onChange={(event) => setField('oficio', event.target.value)} className="field" placeholder="Ej: Plomero" data-testid="input-partner-trade" /></label>
      <label><span className="label">Categoría</span><select required value={form.categoria} onChange={(event) => setField('categoria', event.target.value)} className="field" data-testid="select-partner-category"><option value="">Elegí una categoría</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
      <label><span className="label">Precio de referencia</span><input required type="number" min="0" value={form.precioReferencia} onChange={(event) => setField('precioReferencia', event.target.value)} className="field" placeholder="12000" data-testid="input-partner-price" /></label>
      <label><span className="label">Años de experiencia</span><input required type="number" min="0" value={form.experienciaAnios} onChange={(event) => setField('experienciaAnios', Number(event.target.value))} className="field" data-testid="input-partner-experience" /></label>
      <div className="md:col-span-2 rounded-2xl border border-[hsl(var(--primary)/.25)] bg-[hsl(var(--accent)/.14)] p-4">
        <p className="text-sm font-bold">Ubicación fija del taller</p>
        <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">La dirección exacta aparecerá en tu perfil público. Si estás en el taller, guardá también el punto GPS para que los clientes vean la distancia aproximada.</p>
      </div>
      <label className="md:col-span-2"><span className="label">Dirección exacta del taller</span><input required minLength={3} value={form.locationAddress} onChange={(event) => setField('locationAddress', event.target.value)} className="field" placeholder="Calle y altura" data-testid="input-partner-workshop-address" /></label>
      <label><span className="label">Ciudad</span><input required minLength={2} value={form.locationCity} onChange={(event) => setField('locationCity', event.target.value)} className="field" placeholder="Ciudad" data-testid="input-partner-workshop-city" /></label>
      <label><span className="label">Provincia (opcional)</span><input value={form.locationProvince} onChange={(event) => setField('locationProvince', event.target.value)} className="field" placeholder="Provincia" data-testid="input-partner-workshop-province" /></label>
      <div className="md:col-span-2">
        <Button type="button" variant="soft" onClick={() => { setLocationError(''); void captureBrowserCoordinates().then(setLocationCoordinates).catch((cause) => setLocationError(cause instanceof Error ? cause.message : 'No pudimos obtener la ubicación.')); }} testId="button-capture-workshop-location"><LocateFixed size={16} /> {locationCoordinates ? 'Actualizar punto del taller' : 'Usar ubicación actual del taller'}</Button>
        {locationCoordinates && <p className="mt-2 text-xs font-semibold text-[#31825a]" role="status">Punto del taller guardado; las coordenadas no se mostrarán en el perfil.</p>}
        {locationError && <p className="mt-2 text-xs font-semibold text-[hsl(var(--destructive))]" role="alert">{locationError}</p>}
      </div>
      <label className="md:col-span-2"><span className="label">Sobre tu trabajo</span><textarea required value={form.about} onChange={(event) => setField('about', event.target.value)} className="field min-h-32 resize-y" placeholder="Contá tu experiencia, especialidades y zonas donde trabajás..." data-testid="textarea-partner-about" /></label>
      <label className="md:col-span-2"><span className="label">Habilidades</span><SkillsInput skills={form.skills} onChange={(skills) => setField('skills', skills)} testId="input-partner-skills" /></label>
      <div className="md:col-span-2 flex items-center justify-between rounded-xl bg-[hsl(var(--muted)/.7)] p-4"><div><p className="text-sm font-bold">Estoy disponible para nuevas changas</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Tu perfil aparece activo en las búsquedas.</p></div><button type="button" onClick={() => setField('disponible', !form.disponible)} className={`relative h-7 w-12 rounded-full transition-colors ${form.disponible ? 'bg-[#49a574]' : 'bg-[hsl(var(--border))]'}`} aria-pressed={form.disponible} data-testid="button-toggle-partner-availability"><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${form.disponible ? 'translate-x-6' : 'translate-x-1'}`} /></button></div>
      {error && <p className="md:col-span-2 text-xs font-bold text-[hsl(var(--destructive))]" role="alert">{error}</p>}
      {saved && <p className="md:col-span-2 text-xs font-bold text-[#31825a]">Tu perfil Partner fue creado.</p>}
      <div className="md:col-span-2 flex justify-end border-t border-[hsl(var(--border))] pt-5"><Button type="submit" disabled={createProfile.isPending} testId="button-create-partner">{createProfile.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Check size={17} />} {createProfile.isPending ? 'Guardando...' : 'Guardar y ver mi perfil'}</Button></div>
    </form>
  </div>;
}

function PartnerPage() {
  const registrationDraft = readRegistrationDraft();
  const primaryService = registrationDraft?.services?.[0];
  const [form, setForm] = useState(() => ({
    oficio: primaryService?.oficio ?? '',
    categoria: primaryService?.categoria ?? '',
    experienciaAnios: primaryService?.experienciaAnios ?? 0,
    skills: registrationDraft?.services?.map((service) => service.oficio).filter(Boolean) ?? [],
    precioReferencia: '',
    about: '',
    locationAddress: '',
    locationCity: '',
    locationProvince: '',
  }));
  const [locationCoordinates, setLocationCoordinates] = useState<[number, number] | undefined>();
  const [locationError, setLocationError] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const createProfile = useCreateMyProfessionalProfile();
  const [, setLocation] = useLocation();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setSaved(false);
    if (form.locationAddress.trim().length < 3 || form.locationCity.trim().length < 2) { setError('Indicá la dirección exacta del taller y la ciudad.'); return; }
    try {
      await createProfile.mutateAsync({ data: {
        oficio: form.oficio,
        categoria: form.categoria,
        experienciaAnios: form.experienciaAnios,
        skills: form.skills,
        precioReferencia: Number(form.precioReferencia) || 0,
        about: form.about,
        ubicacionFija: {
          direccionTexto: form.locationAddress.trim(),
          ciudad: form.locationCity.trim(),
          provincia: form.locationProvince.trim() || null,
          ...(locationCoordinates ? { coordinates: locationCoordinates } : {}),
        },
      } });
      await queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() });
      setSaved(true);
      setLocation('/profile');
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos crear tu perfil Partner.'); }
  };
  return <div className="mx-auto max-w-3xl space-y-7">
    <div><p className="eyebrow">Tu cuenta Worky</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Ofrecé lo que sabés hacer.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Usás la misma cuenta para contratar y ofrecer servicios. Completá estos datos para aparecer como Partner.</p></div>
    <form onSubmit={submit} className="grid gap-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 md:grid-cols-2 md:p-8">
      <label><span className="label">¿Qué oficio ofrecés?</span><input required minLength={2} value={form.oficio} onChange={(e) => setForm({ ...form, oficio: e.target.value })} className="field" placeholder="Ej: Electricista" data-testid="input-partner-trade" /></label>
      <label><span className="label">Categoría</span><select required value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} className="field"><option value="">Elegí una categoría</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
      <label><span className="label">Precio de referencia</span><input type="number" min="0" value={form.precioReferencia} onChange={(e) => setForm({ ...form, precioReferencia: e.target.value })} className="field" placeholder="12000" /></label>
      <div className="md:col-span-2 rounded-2xl border border-[hsl(var(--primary)/.25)] bg-[hsl(var(--accent)/.14)] p-4"><p className="text-sm font-bold">Ubicación fija del taller</p><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">La dirección exacta aparecerá en tu perfil público. Guardá el punto GPS desde el taller para que los clientes vean la distancia aproximada; las coordenadas no se publican.</p></div>
      <label className="md:col-span-2"><span className="label">Dirección exacta</span><input required minLength={3} value={form.locationAddress} onChange={(e) => setForm({ ...form, locationAddress: e.target.value })} className="field" placeholder="Calle y altura" /></label>
      <label><span className="label">Ciudad</span><input required minLength={2} value={form.locationCity} onChange={(e) => setForm({ ...form, locationCity: e.target.value })} className="field" placeholder="Ciudad" /></label>
      <label><span className="label">Provincia (opcional)</span><input value={form.locationProvince} onChange={(e) => setForm({ ...form, locationProvince: e.target.value })} className="field" placeholder="Provincia" /></label>
      <div className="md:col-span-2"><Button type="button" variant="soft" onClick={() => { setLocationError(''); void captureBrowserCoordinates().then(setLocationCoordinates).catch((cause) => setLocationError(cause instanceof Error ? cause.message : 'No pudimos obtener la ubicación.')); }}><LocateFixed size={16} /> {locationCoordinates ? 'Actualizar ubicación del taller' : 'Usar ubicación actual del taller'}</Button>{locationError && <p className="mt-2 text-xs font-semibold text-[hsl(var(--destructive))]" role="alert">{locationError}</p>}</div>
      <label className="md:col-span-2"><span className="label">Contá brevemente sobre tu trabajo</span><textarea value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} className="field min-h-32 resize-y" placeholder="Experiencia, especialidades y zonas donde trabajás..." /></label>
      {error && <p className="md:col-span-2 text-xs font-bold text-[hsl(var(--destructive))]">{error}</p>}
      {saved && <p className="md:col-span-2 text-xs font-bold text-[#31825a]">Tu perfil Partner fue creado.</p>}
      <div className="md:col-span-2 flex justify-end border-t border-[hsl(var(--border))] pt-5"><Button type="submit" disabled={createProfile.isPending} testId="button-create-partner">{createProfile.isPending ? 'Guardando...' : 'Empezar como Partner'} <ChevronRight size={16} /></Button></div>
    </form>
  </div>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function RouterContent({ role, setRole }: { role: Role; setRole: (role: Role) => void }) {
  const auth = useAuth();
  const [location, setLocation] = useLocation();
  const basePath = import.meta.env?.BASE_URL ?? '/';
  const professionalProfile = useGetMyProfessionalProfile({
    query: {
      queryKey: getGetMyProfessionalProfileQueryKey(),
      retry: false,
      enabled: Boolean(auth.user),
    },
  });
  const hasProfessionalAccount = hasDualRoleAccount(auth.user?.rol, professionalProfile.data);
  const savedRole = localStorage.getItem('worky-role');
  const hasSavedRolePreference = savedRole === 'client' || savedRole === 'professional';
  const effectiveRole = resolveEffectiveRole(auth.user?.rol, role, hasSavedRolePreference, hasProfessionalAccount);
  const shouldRedirectProfessionalSearch = auth.isAuthenticated && effectiveRole === 'professional' && location === '/home';
  useEffect(() => {
    if (shouldRedirectProfessionalSearch) setLocation('/partner/dashboard');
  }, [shouldRedirectProfessionalSearch, setLocation]);
  if (auth.isLoading) return <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))]"><LoadingBlock label="Recuperando tu sesión..." /></div>;
  if (!auth.isAuthenticated) return <RoutedErrorBoundary><AuthPage setRole={setRole} /></RoutedErrorBoundary>;
  if (shouldRedirectProfessionalSearch) return null;
  const adminActivation = <AdminAccessPage
    user={auth.user!}
    onPromoted={async () => {
      await auth.refreshUser();
      setRole('admin');
    }}
  />;
  const adminAccess = (initialSection?: "verifications") => <AdminSessionGate
    loadUser={auth.refreshUser}
    panel={<AdminConsolePage initialSection={initialSection} />}
    activation={adminActivation}
  />;
  const content = location === '/services'
    ? <AppShell role="professional" setRole={setRole}><PartnerProfilePage /></AppShell>
    : <RoutedErrorBoundary><Switch><Route path="/" component={() => { window.history.replaceState({}, '', `${basePath}home`); return null; }} /><Route path="/home"><AppShell role={effectiveRole} setRole={setRole}><HomePage /></AppShell></Route><Route path="/professional/:id"><AppShell role={effectiveRole} setRole={setRole}><ProfessionalPage /></AppShell></Route>
      <Route path="/admin">{adminAccess()}</Route>
      <Route path="/admin/verificaciones">{adminAccess("verifications")}</Route>
      <Route path="/partner/dashboard"><AppShell role="professional" setRole={setRole}><PartnerDashboard /></AppShell></Route><Route path="/jobs/new"><AppShell role={effectiveRole} setRole={setRole}><NewJobPage /></AppShell></Route><Route path="/jobs"><AppShell role={effectiveRole} setRole={setRole}><JobsPage role={effectiveRole === 'professional' ? 'professional' : 'client'} /></AppShell></Route><Route path="/conversations"><AppShell role={effectiveRole} setRole={setRole}><ConversationsPage role={effectiveRole} /></AppShell></Route><Route path="/chat/:id"><AppShell role={effectiveRole} setRole={setRole}><ChatPage role={effectiveRole} /></AppShell></Route><Route path="/partner"><AppShell role={effectiveRole} setRole={setRole}><PartnerPage /></AppShell></Route><Route path="/profile"><AppShell role={effectiveRole} setRole={setRole}><ProfilePage role={effectiveRole === 'professional' ? 'professional' : 'client'} /></AppShell></Route><Route path="/settings"><AppShell role={effectiveRole} setRole={setRole}><SettingsPage /></AppShell></Route><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
  return content;
}

function App() {
  const [role, setRole] = useState<Role>(() => (localStorage.getItem('worky-role') as Role) || 'client');
  const basePath = import.meta.env?.BASE_URL ?? '/';
  return <QueryClientProvider client={queryClient}><AuthProvider><WouterRouter base={basePath.replace(/\/$/, '')}><RouterContent role={role} setRole={(nextRole) => { setRole(nextRole); localStorage.setItem('worky-role', nextRole); }} /></WouterRouter></AuthProvider></QueryClientProvider>;
}

export default App;

const verificationStatusLabels: Record<VerificationDocument['estado'], string> = {
  pending_verification: 'Pendiente de revisión', verified: 'Aprobado', rejected: 'Rechazado',
};

