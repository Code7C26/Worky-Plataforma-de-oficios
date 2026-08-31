import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  ArrowDownUp, BriefcaseBusiness, Check, ChevronRight, CircleAlert, Clock3, Inbox, LoaderCircle,
  LockKeyhole, MapPin, Menu, MessageCircle, Plus, Search, Send, ShieldCheck, Sparkles,
  Star, UserRound, X, Bell, CalendarDays, LayoutDashboard, RefreshCw, Trash2, Pencil,
  ImageIcon, Paperclip, LocateFixed,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  getGetJobQueryKey, getGetMyProfessionalProfileQueryKey, getGetProfessionalQueryKey,
  getGetProfessionalReputationQueryKey, getListAssignedJobsQueryKey, getListAvailableJobsQueryKey,
  getListConversationsQueryKey, getListMessagesQueryKey, getListMyJobsQueryKey, getListAppointmentAttemptsQueryKey,
  getListProfessionalsQueryKey, getListAppointmentsQueryKey, markMessagesRead, useAcceptJob, useAcceptAppointment, useCreateJob,
  useCreateMessage, useCreateMyProfessionalProfile, useGetJob, useGetMyProfessionalProfile,
  useGetProfessional, useGetProfessionalReputation,
  useListAssignedJobs, useListAvailableJobs, useListConversations, useListMessages,
  useListAppointments, useListMyJobs, useListProfessionals, useProposeAppointment, useRejectAppointment, useUpdateJob, useUpdateMyProfessionalProfile,
} from '@workspace/api-client-react';
import type { Appointment, AppointmentAttempt, Job, ProfessionalProfile } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import NotFound from '@/pages/not-found';
import { Route, Switch, Link, Router as WouterRouter, useLocation, useParams } from 'wouter';
import { AuthUser, WorkyApiError, addPendingAppointmentAttempt, apiRequest, clearToken, configureApiAuth, currentUser, fetchWorkyObject, getPendingAppointmentAttempts, getToken, login, logout, markNotificationRead, register, savePendingAppointmentAttempts, syncPendingAppointmentAttempts, uploadWorkyFile, type PendingAppointmentAttempt } from '@/lib/api';
import { appointmentErrorMessage, type AppointmentAction } from '@/appointment-errors';

export const queryClient = new QueryClient();
type Role = 'client' | 'professional' | 'admin';
type JobStatus = 'published' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';
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
  professionalName: string | null;
  professionalId: number | null;
  clientId: number;
  createdAt: string;
  calificada: boolean;
};
type ProfileForm = { trade: string; category: string; price: number; experience: number; bio: string; skills: string[]; available: boolean };
const profilePhotosByInitials = new Map<string, string>();
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
type RegistrationData = { name: string; email: string; phone: string; password: string; confirm: string; address: string; city: string; province: string; age: string };

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

type AuthContextValue = { user: AuthUser | null; isAuthenticated: boolean; isLoading: boolean; login: (email: string, password: string) => Promise<void>; register: (payload: RegistrationPayload) => Promise<void>; logout: () => Promise<void>; refreshUser: () => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);
function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('AuthProvider requerido'); return value; }
function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setLoading] = useState(true);
  const setSessionUser = (nextUser: AuthUser | null) => { queryClient.clear(); setUser(nextUser); };
  const refreshUser = async () => { if (!getToken()) { setSessionUser(null); return; } try { setUser(await currentUser()); } catch { clearToken(); setSessionUser(null); } };
  useEffect(() => { void refreshUser().finally(() => setLoading(false)); }, []);
  useEffect(() => { configureApiAuth(() => setSessionUser(null)); }, []);
  const value: AuthContextValue = { user, isAuthenticated: Boolean(user), isLoading, login: async (email, password) => setSessionUser(await login(email, password)), register: async (payload) => setSessionUser(await register(payload)), logout: async () => { await logout(); setSessionUser(null); }, refreshUser };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const categories = ['Plomería', 'Electricidad', 'Gas', 'Albañilería', 'Otro'];
const statusLabels: Record<string, string> = {
  published: 'Publicada', accepted: 'Aceptada', in_progress: 'En curso', completed: 'Completada', cancelled: 'Cancelada',
};
const statusTone: Record<string, string> = {
  published: 'status status-amber', accepted: 'status status-blue', in_progress: 'status status-blue',
  completed: 'status status-green', cancelled: 'status status-red',
};

function money(value: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value);
}

type VerificationDocument = {
  id: number; tipo: 'dni_frente' | 'dni_dorso' | 'antecedentes_penales'; objectPath: string; nombre: string;
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
  const location = profile.usuario.ubicacion;
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
    location: (location as (typeof location & { ciudad?: string }) | null)?.ciudad || location?.zona,
    photoUrl,
    reviewsCount: profile.reviewsCount,
    recommendationsCount: profile.recommendationsCount,
    distanceKm: (profile as ProfessionalProfile & { distanceKm?: number | null }).distanceKm,
  };
}
function toJob(job: Job): WorkyJob {
  const statuses: Record<Job['estado'], JobStatus> = {
    publicada: 'published',
    aceptada: 'accepted',
    en_curso: 'in_progress',
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
    professionalName: job.profesional?.nombre ?? null,
    professionalId: job.profesionalId,
    clientId: job.clienteId,
    createdAt: job.createdAt,
    calificada: job.calificada,
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

function AppShell({ children, role, setRole }: { children: ReactNode; role: Role; setRole: (role: Role) => void }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const auth = useAuth();
  const profileQuery = useGetMyProfessionalProfile({ query: { queryKey: getGetMyProfessionalProfileQueryKey(), retry: false, enabled: Boolean(auth.user) } });
  const profile = profileQuery.data ? toProfessional(profileQuery.data) : null;
  const accountName = profile?.name || auth.user?.nombre || 'Tu cuenta';
  const accountInitials = accountName.split(' ').map((part) => part[0]).join('').slice(0, 2);
  const accountPhotoPath = auth.user?.fotoObjectPath;
  if (accountPhotoPath) profilePhotosByInitials.set(accountInitials, `/api/v1/storage/public-objects${accountPhotoPath}`);
  const notifications = useQuery({ queryKey: ['worky-notifications'], queryFn: () => apiRequest<NotificationsResponse>('/notificaciones'), enabled: Boolean(auth.user), refetchInterval: 10000, refetchIntervalInBackground: true, refetchOnWindowFocus: true });
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationReadFailures, setNotificationReadFailures] = useState<Map<number, { id: number; title: string }>>(new Map());
  const [retryingNotificationId, setRetryingNotificationId] = useState<number | null>(null);
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
  const navItems = [
    { href: '/home', label: 'Encontrar profesionales', icon: Search },
    { href: '/jobs', label: 'Mis changas', icon: BriefcaseBusiness },
     { href: '/conversations', label: 'Conversaciones', icon: MessageCircle },
    ...(role === 'professional' ? [
      { href: '/profile', label: 'Mi perfil', icon: UserRound },
      { href: '/services', label: 'Mis servicios', icon: BriefcaseBusiness },
    ] : []),
    ...(role === 'admin' ? [{ href: '/admin/verificaciones', label: 'Verificaciones', icon: ShieldCheck }] : []),
  ];
  return <div className="app-shell grain flex bg-[hsl(var(--background))]">
      <aside className={`fixed inset-y-0 left-0 z-30 flex w-[258px] flex-col bg-[hsl(var(--sidebar))] px-5 py-6 text-[hsl(var(--sidebar-foreground))] transition-transform duration-300 md:fixed md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="mb-9 flex items-center justify-between"><Brand light /><button onClick={() => setMobileOpen(false)} className="text-white/60 md:hidden" data-testid="button-close-menu"><X size={20} /></button></div>
       <div className="mb-7 rounded-2xl border border-white/10 bg-white/[.06] p-3.5"><div className="flex items-center gap-3"><Avatar name={accountName} initials={profile?.initials} size="sm" warm /><div className="min-w-0"><p className="truncate text-xs font-bold">{accountName}</p><p className="mt-0.5 text-[11px] text-white/55">{role === 'professional' ? 'Profesional' : role === 'admin' ? 'Administración' : 'Cliente'}</p></div></div>{role !== 'admin' && <button onClick={() => { if (role === 'client' && !profile) setLocation('/partner'); else setRole(role === 'client' ? 'professional' : 'client'); setMobileOpen(false); }} className="mt-3 flex w-full items-center justify-between border-t border-white/10 pt-3 text-[11px] font-bold text-[hsl(var(--accent))]" data-testid="button-switch-role">{role === 'client' && !profile ? 'Ofrecer mis servicios' : 'Cambiar vista'} <ChevronRight size={13} /></button>}</div>
      <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.17em] text-white/35">Tu espacio</p>
      <nav className="space-y-1.5">{navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`nav-link focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${location === href ? 'bg-[hsl(var(--sidebar-accent))] text-white' : 'text-white/65 hover:bg-white/[.07] hover:text-white'}`} data-testid={`link-nav-${href.slice(1).replace('/', '-')}`}><Icon size={18} strokeWidth={location === href ? 2.5 : 2} /><span>{label}</span>{href === '/jobs' && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />}</Link>)}{role === 'professional' && <Link href="/partner/dashboard" onClick={() => setMobileOpen(false)} className={`nav-link focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${location === '/partner/dashboard' ? 'bg-[hsl(var(--sidebar-accent))] text-white' : 'text-white/65 hover:bg-white/[.07] hover:text-white'}`} data-testid="link-nav-partner-dashboard"><LayoutDashboard size={18} /> <span>Panel Partner</span></Link>}</nav>{role === 'client' && <Link href="/partner" onClick={() => setMobileOpen(false)} className="mt-6 flex items-center gap-2 rounded-xl border border-[hsl(var(--accent)/.35)] px-3 py-2.5 text-xs font-bold text-[hsl(var(--accent))]" data-testid="link-offer-services"><Sparkles size={15} /> Ofrecer mis servicios</Link>}
       {role === 'client' && <div className="mt-auto rounded-2xl bg-[hsl(var(--primary))] p-4 text-[hsl(var(--primary-foreground))]"><Sparkles size={18} /><p className="mt-3 text-sm font-bold leading-snug">La changa justa, con gente de confianza.</p><p className="mt-1 text-[11px] leading-relaxed opacity-75">Todo empieza cerca de casa.</p></div>}
       <button onClick={() => { void auth.logout(); setLocation('/'); }} className="mt-5 flex items-center gap-2 px-3 text-xs font-bold text-white/45 hover:text-white" data-testid="button-logout"><LockKeyhole size={14} /> Salir de Worky</button>
    </aside>
    {mobileOpen && <button aria-label="Cerrar menú" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-20 bg-[hsl(var(--secondary)/.45)] md:hidden" data-testid="button-menu-overlay" />}
          <main className="min-w-0 flex-1 md:ml-[258px]"><header className="relative flex h-[76px] items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/.85)] px-5 backdrop-blur md:px-10"><button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 md:hidden" data-testid="button-open-menu"><Menu size={22} /></button><div className="flex items-center gap-3"><button onClick={() => setShowNotifications(!showNotifications)} className="relative rounded-xl p-2.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" data-testid="button-notifications"><Bell size={19} />{Boolean(notifications.data?.unread) && <span data-testid="notification-unread-count" className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--primary))] px-1 text-[9px] font-bold text-white">{notifications.data?.unread}</span>}</button><Link href="/profile" className="focus-ring flex items-center gap-2" data-testid="link-header-profile"><Avatar name={accountName} initials={profile?.initials} size="sm" warm /><span className="hidden text-xs font-bold sm:block">{accountName.split(' ')[0]}</span></Link></div>{showNotifications && <div className="absolute right-5 top-[66px] z-40 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-2xl md:right-10"><div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-2 pb-3"><p className="display-font font-bold">Notificaciones</p><button className="text-[10px] font-bold text-[hsl(var(--primary))]" onClick={() => { void apiRequest('/notificaciones/leidas', { method: 'POST' }).then(() => notifications.refetch()); }}>Marcar leídas</button></div>{!notifications.data?.items.length ? <p className="px-2 py-6 text-center text-xs text-[hsl(var(--muted-foreground))]">No tenés novedades.</p> : <div className="max-h-72 overflow-auto">{notifications.data.items.slice(0, 6).map((item) => { const className = `block border-b border-[hsl(var(--border))] px-2 py-3 last:border-0 ${item.leida ? 'opacity-55' : ''} ${item.href ? 'cursor-pointer hover:bg-[hsl(var(--muted)/.55)]' : ''}`; const content = <><p className="text-xs font-bold">{item.titulo}</p><p className="mt-1 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">{item.detalle}</p>{item.href && <p className="mt-2 text-[10px] font-bold text-[hsl(var(--primary))]">Abrir conversación <ChevronRight size={12} className="inline" /></p>}</>; return item.href ? <Link key={item.id} href={item.href} onClick={() => { setShowNotifications(false); if (!item.leida) void markNotificationAsRead(item); }} className={className} data-testid={`notification-${item.id}`}>{content}</Link> : <div key={item.id} className={className} data-testid={`notification-${item.id}`}>{content}</div>; })}</div>}</div>}{notificationReadFailures.size > 0 && <div className="absolute left-5 right-5 top-[82px] z-30 flex flex-col gap-2 md:left-auto md:right-10 md:max-w-[360px]">{Array.from(notificationReadFailures.values()).map((failure) => <div key={failure.id} className="flex items-center gap-3 rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--card))] px-4 py-3 text-xs shadow-lg" role="alert" data-testid={`notification-read-error-${failure.id}`}><CircleAlert size={16} className="shrink-0 text-[hsl(var(--destructive))]" /><p className="min-w-0 flex-1 text-[hsl(var(--muted-foreground))]">No pudimos marcar “{failure.title}” como leída. Revisá tu conexión.</p><button onClick={() => { void markNotificationAsRead({ id: failure.id, titulo: failure.title }); }} disabled={retryingNotificationId === failure.id} className="shrink-0 font-bold text-[hsl(var(--primary))] disabled:opacity-50" data-testid={`button-retry-notification-read-${failure.id}`}>{retryingNotificationId === failure.id ? <LoaderCircle size={15} className="animate-spin" aria-label="Reintentando" /> : <><RefreshCw size={14} className="mr-1 inline" />Reintentar</>}</button></div>)}</div>}</header><div className="page-enter mx-auto max-w-[1440px] px-5 py-7 md:px-10 md:py-10">{children}</div></main>
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
      if (mode === 'login') await auth.login(String(values.get('email')), String(values.get('password')));
      else await auth.register({ nombre: String(values.get('name')), email: String(values.get('email')), password: String(values.get('password')) });
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
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [draft] = useState(() => readRegistrationDraft());
  const [step, setStep] = useState(draft?.step ?? 1);
  const [role, setRoleLocal] = useState<Role>(draft?.role ?? 'client');
  const [error, setError] = useState('');
  const setLocation = (next: string) => {
    if (next === '/') {
      setMode('login');
      setStep(1);
      setError('');
    }
    navigate(next);
  };
  const [data, setData] = useState<RegistrationData>({ name: draft?.data.name ?? '', email: draft?.data.email ?? '', phone: draft?.data.phone ?? '', password: '', confirm: '', address: draft?.data.address ?? '', city: draft?.data.city ?? '', province: draft?.data.province ?? '', age: draft?.data.age ?? '' });
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
      data: { name: data.name, email: data.email, phone: data.phone, address: data.address, city: data.city, province: data.province, age: data.age },
      answers, services, docs, photo: photo?.objectPath ? { objectPath: photo.objectPath } : null,
    });
  }, [step, role, data, answers, services, docs, photo]);
  const change = (key: string, value: string) => setData((current) => ({ ...current, [key]: value }));
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
    if (data.password.length < 6 || data.password !== data.confirm) { setError('La contraseña debe tener 6 caracteres y coincidir.'); return; }
    if (!photo?.file && !photo?.objectPath) { setError('Subí una foto de perfil para continuar.'); return; }
    const validServices = services.filter((item) => item.oficio.trim());
    if (role === 'professional' && !validServices.length) { setError('Agregá al menos un oficio.'); return; }
    try {
      await auth.register({ nombre: data.name, email: data.email, password: data.password, telefono: data.phone, edad: Number(data.age), rol: role === 'professional' ? 'profesional' : 'cliente', ubicacion: { direccion: data.address, ciudad: data.city, provincia: data.province } });
      if (photo?.file) {
        const uploadedPhoto = await uploadWorkyFile(photo.file, 'profile_photo');
        await apiRequest('/auth/profile-photo', { method: 'POST', body: JSON.stringify({ objectPath: uploadedPhoto.objectPath }) });
        await auth.refreshUser();
      }
       if (role === 'professional') {
        await apiRequest('/auth/professional-services', { method: 'PUT', body: JSON.stringify({ services: validServices }) });
        await apiRequest('/partner-profile', { method: 'POST', body: JSON.stringify({ oficio: validServices[0].oficio, categoria: validServices[0].categoria, experienciaAnios: validServices[0].experienciaAnios, precioReferencia: 0, skills: validServices.map((item) => item.oficio) }) });
         for (const [tipo, document] of Object.entries(docs)) {
          const selected = selectedFiles[tipo];
          const uploaded = selected ? await uploadWorkyFile(selected) : null;
          const objectPath = uploaded?.objectPath || document.objectPath;
          if (objectPath) await apiRequest(`/auth/verification-documents/${tipo}`, { method: 'PUT', body: JSON.stringify({ objectPath, nombre: document.name, contentType: document.contentType, sizeBytes: document.sizeBytes }) });
        }
      }
      await apiRequest('/auth/onboarding', { method: 'PATCH', body: JSON.stringify({ estado: 'onboarding_completed', paso: 3, respuestas: answers }) });
       clearRegistrationDraft();
       setRole(role); setLocation('/home');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos crear tu cuenta.'); }
  };
  const loginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    try {
      await auth.login(data.email, data.password);
      setRole('client');
      setLocation('/home');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos ingresar. Intentá nuevamente.');
    }
  };
  const input = (key: string, label: string, type = 'text', required = true) => <label className="block"><span className="label !text-white/75">{label}</span><input value={data[key as keyof typeof data]} onChange={(event) => change(key, event.target.value)} type={type} required={required} className="field border-white/15 bg-white/[.08] text-white placeholder:text-white/35" data-testid={`input-auth-${key}`} /></label>;
  const onboardingOptions: Record<string, string[]> = {
    zona: ['CABA', 'Zona Norte', 'Zona Oeste', 'Zona Sur', 'Otra zona'],
    preferencia: ['Rapidez', 'Precio claro', 'Experiencia', 'Recomendaciones'],
    frecuencia: ['Una vez', 'Todas las semanas', 'Todos los meses', 'Cuando surge una urgencia'],
    tipoTrabajo: ['Mantenimiento', 'Reparaciones', 'Instalaciones', 'Urgencias', 'Otro tipo de trabajo'],
    zonaTrabajo: ['CABA', 'Zona Norte', 'Zona Oeste', 'Zona Sur', 'Me muevo por varias zonas'],
    objetivo: ['Conseguir más changas', 'Organizar mejor mi trabajo', 'Mostrar mi experiencia', 'Construir reputación en Worky'],
  };
  const question = (key: string, label: string) => {
    const options = onboardingOptions[key];
    const selected = answers[key] || '';
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
  if (mode === 'login') return <div className="grain flex min-h-[100dvh] flex-col bg-[hsl(var(--secondary))] text-white md:flex-row"><section className="relative hidden w-[46%] overflow-hidden p-12 md:flex md:flex-col"><Brand light /><div className="relative my-auto max-w-md"><p className="eyebrow !text-[hsl(var(--accent))]">La red que mueve tu barrio</p><h1 className="display-font mt-4 text-5xl font-bold leading-[.98] tracking-[-.06em]">Cuando hace falta,<br /><span className="text-[hsl(var(--accent))]">aparece alguien.</span></h1><p className="mt-6 max-w-sm text-base leading-relaxed text-white/65">Una cuenta para encontrar, contratar, ofrecer y recomendar.</p></div></section><section className="flex flex-1 items-center justify-center px-5 py-10"><div className="w-full max-w-[430px]"><div className="mb-8 md:hidden"><Brand light /></div><div className="mb-8"><p className="eyebrow !text-[hsl(var(--accent))]">Volvé a tu red</p><h2 className="display-font mt-3 text-4xl font-bold tracking-[-.06em]">Hola de nuevo.</h2><p className="mt-3 text-sm text-white/60">Ingresá para seguir con tus changas.</p></div><form onSubmit={loginSubmit} className="space-y-4">{input('email', 'Tu email', 'email')}{input('password', 'Contraseña', 'password')} {error && <p className="text-xs font-semibold text-[hsl(var(--accent))]">{error}</p>}<Button type="submit" variant="soft" className="mt-3 w-full py-3.5" disabled={auth.isLoading} testId="button-auth-submit">Entrar a Worky <ChevronRight size={17} /></Button></form><div className="my-7 flex items-center gap-3 text-[11px] text-white/35"><span className="h-px flex-1 bg-white/10" /> acceso simple y seguro <span className="h-px flex-1 bg-white/10" /></div><p className="text-center text-sm text-white/55">¿Todavía no tenés cuenta? <button type="button" onClick={() => { setMode('register'); setStep(1); }} className="font-bold text-[hsl(var(--accent))]" data-testid="button-toggle-auth">Registrate</button></p><p className="mt-7 text-center text-[11px] leading-relaxed text-white/35">Tu información queda protegida.</p></div></section></div>;
  return <div className="grain flex min-h-[100dvh] flex-col bg-[hsl(var(--secondary))] text-white md:flex-row"><section className="relative hidden w-[46%] overflow-hidden p-12 md:flex md:flex-col"><Brand light /><div className="relative my-auto max-w-md"><p className="eyebrow !text-[hsl(var(--accent))]">La red que mueve tu barrio</p><h1 className="display-font mt-4 text-5xl font-bold leading-[.98] tracking-[-.06em]">Cuando hace falta,<br /><span className="text-[hsl(var(--accent))]">aparece alguien.</span></h1><p className="mt-6 max-w-sm text-base leading-relaxed text-white/65">Una cuenta para encontrar, contratar, ofrecer y recomendar.</p></div></section><section className="flex flex-1 items-center justify-center px-5 py-10"><div className="w-full max-w-[600px]"><div className="mb-7 md:hidden"><Brand light /></div><div className="mb-5 flex items-center justify-between"><div><p className="eyebrow !text-[hsl(var(--accent))]">Unite a Worky</p><h2 className="display-font mt-2 text-4xl font-bold tracking-[-.06em]">Empecemos cerca.</h2></div><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">Paso {step} de 3</span></div><div className="mb-6 h-1.5 rounded-full bg-white/10"><div className="h-full rounded-full bg-[hsl(var(--accent))] transition-all" style={{ width: `${step * 33.33}%` }} /></div><form onSubmit={(event) => { event.preventDefault(); if (step < 3) setStep((current) => current + 1); else void finish(); }} className="space-y-4">{step === 1 && <><div className="grid gap-4 sm:grid-cols-2">{input('name', 'Nombre y apellido')}{input('email', 'Email', 'email')}{input('phone', 'Teléfono', 'tel')}{input('age', 'Edad', 'number')}{input('password', 'Contraseña', 'password')}{input('confirm', 'Confirmar contraseña', 'password')}</div><div className="grid gap-4 sm:grid-cols-3">{input('address', 'Dirección')}{input('city', 'Ciudad')}{input('province', 'Provincia')}</div><div><span className="label !text-white/75">Foto de perfil (opcional)</span><label className="inline-flex cursor-pointer items-center rounded-xl border border-dashed border-white/25 px-4 py-3 text-xs font-bold">{photo ? 'Reemplazar foto' : 'Subir foto'}<input type="file" accept="image/*" capture="user" className="hidden" onChange={(event) => void file('photo', event.target.files?.[0])} /></label>{photo && <span className="ml-3 inline-flex items-center gap-2"><img src={photo.preview} alt="Vista previa" className="h-12 w-12 rounded-xl object-cover" /><button type="button" className="text-xs text-[hsl(var(--accent))]" onClick={() => setPhoto(null)}>Eliminar</button></span>}</div><div><span className="label !text-white/75">¿Cómo querés usar Worky?</span><div className="grid gap-3 sm:grid-cols-2">{[['client', 'Buscar ayuda'], ['professional', 'Ofrecer mis servicios']].map(([value, label]) => <button type="button" key={value} onClick={() => setRoleLocal(value as Role)} className={`rounded-2xl border p-4 text-left text-sm font-bold ${role === value ? 'border-[hsl(var(--accent))] bg-white/10' : 'border-white/15 bg-white/[.04]'}`}>{label}<span className="mt-1 block text-xs font-normal text-white/55">{value === 'client' ? 'Encontrá un Partner para tu changa.' : 'Mostrá tus oficios y recibí oportunidades.'}</span></button>)}</div></div></>}{step === 2 && <div className="space-y-4">{role === 'client' ? <><p className="text-sm text-white/65">Personalicemos tu experiencia.</p>{question('zona', '¿En qué zona vivís?')}{question('preferencia', '¿Qué valorás más al contratar?')}{question('frecuencia', '¿Con qué frecuencia necesitás ayuda?')}</> : <><p className="text-sm text-white/65">Contanos qué hacés. La verificación es informativa y no bloquea cuentas de prueba.</p>{services.map((service, index) => <div className="grid gap-2 sm:grid-cols-[1fr_1fr_100px]" key={index}><input value={service.oficio} onChange={(event) => setServices((current) => current.map((item, i) => i === index ? { ...item, oficio: event.target.value } : item))} className="field border-white/15 bg-white/[.08] text-white" placeholder="Oficio" required={index === 0} /><select value={service.categoria} onChange={(event) => setServices((current) => current.map((item, i) => i === index ? { ...item, categoria: event.target.value } : item))} className="field border-white/15 bg-white/[.08] text-white"><option>Plomería</option><option>Electricidad</option><option>Gas</option><option>Albañilería</option><option>Otro</option></select><input type="number" value={service.experienciaAnios} onChange={(event) => setServices((current) => current.map((item, i) => i === index ? { ...item, experienciaAnios: Number(event.target.value) } : item))} className="field border-white/15 bg-white/[.08] text-white" placeholder="Años" /></div>)}<button type="button" className="text-xs font-bold text-[hsl(var(--accent))]" onClick={() => setServices((current) => [...current, { oficio: '', categoria: 'Otro', experienciaAnios: 0 }])}>+ Agregar otro oficio</button></>}</div>}{step === 3 && <div className="space-y-4">{role === 'professional' ? <><p className="text-sm text-white/65">Subí tus documentos. Son privados y solo accesibles para verificación.</p><div className="grid gap-3 sm:grid-cols-3">{[['dni_frente', 'DNI frente', 'image/*'], ['dni_dorso', 'DNI dorso', 'image/*'], ['antecedentes_penales', 'Antecedentes penales PDF', 'application/pdf']].map(([key, label, accept]) => <label key={key} className="rounded-2xl border border-dashed border-white/20 p-3 text-xs font-bold">{label}<input type="file" accept={accept} className="mt-2 block w-full text-[10px]" onChange={(event) => void file(key, event.target.files?.[0])} />{docs[key] && <span className="mt-2 block truncate text-white/60">{docs[key].name}</span>}{uploading === key && <span className="mt-2 block text-[hsl(var(--accent))]">Cargando...</span>}</label>)}</div>{question('tipoTrabajo', '¿Qué trabajos hacés mejor?')}{question('zonaTrabajo', '¿En qué zona trabajás?')}{question('objetivo', '¿Qué esperás de Worky?')}</> : <><p className="text-sm text-white/65">Listo. Revisá tus datos y creá tu cuenta.</p><div className="rounded-2xl bg-white/[.07] p-4 text-sm leading-relaxed"><b>{data.name}</b><br />{data.email}<br />{data.city}, {data.province}</div></>}</div>}{error && <p className="text-xs font-semibold text-[hsl(var(--accent))]">{error}</p>}<div className="flex gap-3"><Button type="button" variant="ghost" className="flex-1 text-white" disabled={step === 1} onClick={() => setStep((current) => current - 1)}>Atrás</Button><Button type="submit" variant="soft" className="flex-1 py-3.5" disabled={auth.isLoading || Boolean(uploading)}>{step < 3 ? 'Continuar' : 'Crear mi cuenta'} <ChevronRight size={17} /></Button></div></form><p className="mt-7 text-center text-sm text-white/55">¿Ya tenés una cuenta? <button type="button" onClick={() => setLocation('/')} className="font-bold text-[hsl(var(--accent))]">Ingresá</button></p></div></section></div>;
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

type HomeCoordinates = [number, number];
function homeCoordinates(value: unknown): HomeCoordinates | null {
  const coordinates = (value as { coordinates?: unknown } | null)?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  return Number.isFinite(longitude) && Number.isFinite(latitude) && Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90
    ? [longitude, latitude]
    : null;
}

function ProfessionalCardWithDistance({ professional }: { professional: WorkyProfessional }) {
  return <Link href={`/professional/${professional.id}`} className="card-lift group block rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5" data-testid={`card-professional-${professional.id}`}><div className="flex items-start justify-between gap-3"><Avatar name={professional.name} initials={professional.initials} photoUrl={professional.photoUrl} size="lg" warm /><span className={`h-2.5 w-2.5 rounded-full ${professional.available ? 'bg-[#49a574]' : 'bg-[hsl(var(--border))]'}`} title={professional.available ? 'Disponible' : 'No disponible'} /></div><div className="mt-5"><div className="flex items-center gap-1.5"><h3 className="display-font text-xl font-bold tracking-[-.03em]">{professional.name}</h3>{professional.verified && <ShieldCheck size={16} className="text-[hsl(var(--primary))]" />}</div><p className="mt-1 text-sm font-semibold text-[hsl(var(--primary))]">{professional.trade}</p><div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]"><span className="flex items-center gap-1 font-bold text-[hsl(var(--foreground))]"><Star size={14} fill="currentColor" className="text-[hsl(var(--primary))]" /> {professional.rating.toFixed(1)} · {professional.reviewsCount} reseñas</span><span>{professional.jobsCompleted} trabajos</span><span>{professional.experience} años</span></div>{professional.distanceKm !== null && professional.distanceKm !== undefined && <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--accent)/.45)] px-2.5 py-1 text-[11px] font-bold text-[hsl(var(--foreground))]" data-testid={`distance-professional-${professional.id}`}><MapPin size={13} /> A {professional.distanceKm.toFixed(1)} km aprox.</span>}<div className="mt-4 flex items-center justify-between border-t border-[hsl(var(--border))] pt-4"><span className="text-sm font-bold">{money(professional.price)} <span className="font-normal text-[hsl(var(--muted-foreground))]">/ visita</span></span><span className="flex items-center gap-1 text-xs font-bold text-[hsl(var(--secondary))] group-hover:text-[hsl(var(--primary))]">Ver perfil <ChevronRight size={15} /></span></div></div></Link>;
}

function HomePage() {
  const auth = useAuth();
  const savedCoordinates = homeCoordinates(auth.user?.ubicacion);
  const [coordinates, setCoordinates] = useState<HomeCoordinates | null>(savedCoordinates);
  const [locationState, setLocationState] = useState<'idle' | 'loading' | 'ready' | 'denied'>(savedCoordinates ? 'ready' : 'idle');
  const [category, setCategory] = useState('');
  const [sortBy, setSortBy] = useState<ProfessionalSort>('recommended');
  useEffect(() => {
    if (savedCoordinates && !coordinates) {
      setCoordinates(savedCoordinates);
      setLocationState('ready');
    }
  }, [auth.user, savedCoordinates, coordinates]);
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
  const professionals = useListProfessionals(params, { query: { queryKey: getListProfessionalsQueryKey(params), staleTime: 30000 } });
  const list = professionals.data?.map(toProfessional) ?? [];
  const visibleList = useMemo(() => {
    if (sortBy === 'recommended') return list;
    return [...list].sort((a, b) => {
      if (sortBy === 'rating') {
        return b.rating - a.rating || b.reviewsCount - a.reviewsCount || b.jobsCompleted - a.jobsCompleted;
      }
      const aDistance = a.distanceKm ?? Number.POSITIVE_INFINITY;
      const bDistance = b.distanceKm ?? Number.POSITIVE_INFINITY;
      return aDistance - bDistance || b.rating - a.rating || b.reviewsCount - a.reviewsCount;
    });
  }, [list, sortBy]);
  const clearFilters = () => { setCategory(''); setSortBy('recommended'); };
  const sortOptions: { value: ProfessionalSort; label: string; detail: string }[] = [
    { value: 'recommended', label: 'Recomendados', detail: 'Una selección equilibrada' },
    { value: 'rating', label: 'Mejor valorados', detail: 'Más confianza primero' },
    { value: 'distance', label: 'Más cercanos', detail: 'Ordenados por distancia' },
  ];
  return <div className="space-y-9"><section className="relative overflow-hidden rounded-[26px] bg-[hsl(var(--secondary))] px-6 py-8 text-white md:px-10 md:py-11"><div className="absolute -right-16 -top-24 h-72 w-72 rounded-full border-[45px] border-[hsl(var(--primary)/.35)]" /><div className="relative max-w-2xl"><p className="eyebrow !text-[hsl(var(--accent))]">El oficio de confiar</p><h1 className="display-font mt-3 text-4xl font-bold leading-[1.02] tracking-[-.055em] md:text-5xl">La persona indicada<br /><span className="text-[hsl(var(--accent))]">para esa changa.</span></h1><p className="mt-4 max-w-lg text-sm leading-relaxed text-white/65 md:text-base">Profesionales verificados, recomendados y listos para darte una mano.</p></div></section><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Cerca tuyo</p><h2 className="display-font mt-2 text-3xl font-bold tracking-[-.05em]">Gente que sabe hacerlo</h2></div><div className="mobile-scroll flex gap-2 pb-1">{['', ...categories].slice(0, 6).map((item) => <button key={item || 'all'} onClick={() => setCategory(item)} className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-bold transition ${category === item ? 'border-[hsl(var(--secondary))] bg-[hsl(var(--secondary))] text-white' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary))]'}`} data-testid={`button-filter-${item || 'all'}`}>{item || 'Todos'}</button>)}</div></div><section className="relative overflow-hidden rounded-[24px] border border-[hsl(var(--border))] bg-gradient-to-br from-[hsl(var(--card))] via-[hsl(var(--card))] to-[hsl(var(--accent)/.18)] p-4 shadow-[0_12px_30px_hsl(var(--secondary)/.04)] sm:p-5" aria-label="Ordenar profesionales"><div className="absolute -right-12 -top-14 h-36 w-36 rounded-full bg-[hsl(var(--accent)/.16)] blur-2xl" /><div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]"><ArrowDownUp size={19} /></span><div><p className="eyebrow">Encontrá tu mejor opción</p><h3 className="display-font mt-1 text-xl font-bold tracking-[-.035em]">Ordená los resultados</h3><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Elegí qué querés priorizar y compará sin perder opciones.</p></div></div><div className="flex items-center gap-2 rounded-full bg-[hsl(var(--muted)/.7)] px-3 py-1.5 text-[11px] font-bold text-[hsl(var(--muted-foreground))]"><span className="h-2 w-2 rounded-full bg-[hsl(var(--primary))]" />{list.length} profesionales</div></div><div className="relative mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]"><div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Criterio de ordenación">{sortOptions.map((option) => <button key={option.value} type="button" onClick={() => setSortBy(option.value)} aria-pressed={sortBy === option.value} className={`group rounded-2xl border px-3.5 py-3 text-left transition ${sortBy === option.value ? 'border-[hsl(var(--secondary))] bg-[hsl(var(--secondary))] text-white shadow-[0_8px_18px_hsl(var(--secondary)/.14)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card)/.72)] hover:-translate-y-0.5 hover:border-[hsl(var(--primary)/.45)] hover:shadow-sm'}`} data-testid={`button-sort-${option.value}`}><span className="block text-xs font-bold">{option.label}</span><span className={`mt-1 block text-[10px] leading-4 ${sortBy === option.value ? 'text-white/65' : 'text-[hsl(var(--muted-foreground))]'}`}>{option.detail}</span></button>)}</div>{locationState !== 'ready' ? <button type="button" onClick={requestLocation} disabled={locationState === 'loading'} className="flex min-h-[58px] items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--primary)/.3)] bg-[hsl(var(--accent)/.2)] px-4 py-3 text-xs font-bold text-[hsl(var(--foreground))] transition hover:-translate-y-0.5 hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--accent)/.35)] disabled:cursor-wait disabled:opacity-70" data-testid="button-use-location"><LocateFixed size={16} className="text-[hsl(var(--primary))]" /> {locationState === 'loading' ? 'Buscando ubicación...' : 'Activar cercanía'}</button> : <div className="flex min-h-[58px] items-center justify-center gap-2 rounded-2xl border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--accent)/.14)] px-4 py-3 text-xs font-bold text-[hsl(var(--foreground))]" data-testid="location-ready"><LocateFixed size={16} className="text-[hsl(var(--primary))]" /> Cercanía disponible</div>}</div>{locationState === 'denied' && <p className="relative mt-3 flex items-start gap-2 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]" role="status"><CircleAlert size={14} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" /> No pudimos acceder a tu ubicación. Podés seguir buscando; para ordenar por cercanía, activá el permiso e intentá de nuevo.</p>}{locationState === 'ready' && <p className="relative mt-3 flex items-start gap-2 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]" role="status"><MapPin size={14} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" /> Distancias aproximadas, sin mostrar tu ubicación exacta.</p>}{sortBy === 'distance' && locationState !== 'ready' && locationState !== 'loading' && <p className="relative mt-3 text-[11px] font-semibold text-[hsl(var(--primary))]" role="status">Activá tu ubicación para que “Más cercanos” pueda ordenar con precisión.</p>}</section>{professionals.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-72" /><Skeleton className="h-72" /><Skeleton className="h-72" /></div> : professionals.isError ? <ErrorState onRetry={() => void professionals.refetch()} /> : visibleList.length === 0 ? <EmptyState icon={Search} title="No encontramos profesionales" copy="Probá elegir otra categoría para ampliar la búsqueda." action={<Button onClick={() => setCategory('')} variant="soft" testId="button-clear-filters">Ver todos los profesionales</Button>} /> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visibleList.map((professional) => <ProfessionalCardWithDistance key={professional.id} professional={professional} />)}</div>}</div>;
}

function ProfessionalPageLegacy({ professionalId, publicOnly = false }: { professionalId?: number; publicOnly?: boolean }) {
  const params = useParams<{ id: string }>();
  const id = professionalId ?? Number(params.id);
  const professional = useGetProfessional(id, { query: { queryKey: getGetProfessionalQueryKey(id), retry: false } });
  useGetProfessionalReputation(id, { query: { enabled: Number.isInteger(id), queryKey: getGetProfessionalReputationQueryKey(id) } });
  const createJob = useCreateJob();
  const [, setLocation] = useLocation();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ detail: '', location: 'CABA', price: '' });
  if (professional.isLoading) return <LoadingBlock label="Abriendo perfil..." />;
  if (professional.isError || !professional.data) return <ErrorState onRetry={() => void professional.refetch()} />;
  const person = toProfessional(professional.data);
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); createJob.mutate({ data: { categoria: person.category, ubicacion: { direccionTexto: form.location }, precioOfrecido: Number(form.price) || person.price, detalle: form.detail, profesionalId: person.userId } }, { onSuccess: (job) => { queryClient.invalidateQueries({ queryKey: getListMyJobsQueryKey() }); setLocation(`/chat/${job.id}`); } }); };
  return <div className="mx-auto max-w-5xl space-y-7"><Link href="/home" className="focus-ring inline-flex items-center gap-2 text-xs font-bold text-[hsl(var(--muted-foreground))]" data-testid="link-back-home"><ChevronRight className="rotate-180" size={15} /> Volver a profesionales</Link><section className="overflow-hidden rounded-[26px] border border-[hsl(var(--border))] bg-[hsl(var(--card))]"><div className="h-28 bg-[hsl(var(--secondary))] md:h-36" /><div className="relative px-6 pb-7 md:px-10"><div className="-mt-12 flex flex-col gap-5 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between"><Avatar name={person.name} initials={person.initials} size="xl" warm />{!publicOnly && <Button onClick={() => setShowForm(!showForm)} variant={showForm ? 'ghost' : 'primary'} className="sm:mb-1" disabled={createJob.isPending} testId="button-request-job">{showForm ? <><X size={16} /> Cerrar</> : <><Plus size={16} /> Solicitar changa</>}</Button>}</div><div className="mt-5"><div className="flex flex-wrap items-center gap-2"><h1 className="display-font text-3xl font-bold tracking-[-.05em]">{person.name}</h1>{person.verified && <span className="flex items-center gap-1 rounded-full bg-[#e6f4ed] px-2.5 py-1 text-[11px] font-bold text-[#31825a]"><ShieldCheck size={13} /> Verificado</span>}</div><p className="mt-1 font-semibold text-[hsl(var(--primary))]">{person.trade}</p><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[hsl(var(--muted-foreground))]"><span className="flex items-center gap-1.5"><MapPin size={14} /> {person.location || 'Ubicación no informada'}</span><span className="flex items-center gap-1.5 text-[hsl(var(--foreground))]"><Star size={14} fill="currentColor" className="text-[hsl(var(--primary))]" /> {person.rating.toFixed(1)} ({person.reviewsCount} reseñas)</span><span className="flex items-center gap-1.5"><Clock3 size={14} /> {person.available ? 'Disponible ahora' : 'No disponible ahora'}</span></div></div>{!publicOnly && showForm && <form onSubmit={submit} className="mt-7 grid gap-4 rounded-2xl bg-[hsl(var(--muted)/.65)] p-5 md:grid-cols-2"><div className="md:col-span-2"><p className="display-font text-lg font-bold">Contale qué necesitás</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Le vamos a enviar esta solicitud a {person.name.split(' ')[0]}.</p></div><label className="md:col-span-2"><span className="label">Detalle de la changa</span><textarea required minLength={3} value={form.detail} onChange={(event) => setForm({ ...form, detail: event.target.value })} className="field min-h-24 resize-y" placeholder="Ej: Necesito arreglar una pérdida debajo de la pileta..." data-testid="input-request-detail" /></label><label><span className="label">Zona</span><input required value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} className="field" data-testid="input-request-location" /></label><label><span className="label">Presupuesto estimado</span><input required type="number" min="0" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} className="field" placeholder={String(person.price)} data-testid="input-request-price" /></label><div className="md:col-span-2"><Button type="submit" disabled={createJob.isPending} testId="button-submit-request">{createJob.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Send size={16} />} {createJob.isPending ? 'Enviando...' : 'Enviar solicitud'}</Button>{createJob.isError && <p className="mt-2 text-xs font-semibold text-[hsl(var(--destructive))]">No pudimos enviar la solicitud. Intentá nuevamente.</p>}</div></form>}<div className="mt-8 grid gap-8 border-t border-[hsl(var(--border))] pt-7 md:grid-cols-[1.2fr_.8fr]"><div><h2 className="display-font text-xl font-bold">Sobre su trabajo</h2><p className="mt-3 text-sm leading-7 text-[hsl(var(--muted-foreground))]">{person.bio}</p><div className="mt-5 flex flex-wrap gap-2">{person.skills.map((skill) => <span key={skill} className="rounded-full bg-[hsl(var(--muted))] px-3 py-1.5 text-xs font-semibold" data-testid={`skill-${skill}`}>{skill}</span>)}</div></div><div className="rounded-2xl bg-[hsl(var(--muted)/.6)] p-5"><p className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Desde</p><p className="display-font mt-1 text-3xl font-bold">{money(person.price)}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">precio orientativo por visita</p><div className="mt-5 flex items-center gap-3 border-t border-[hsl(var(--border))] pt-4"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#e6f4ed] text-[#31825a]"><ShieldCheck size={18} /></div><p className="text-xs font-semibold leading-relaxed">Identidad y referencias revisadas por Worky.</p></div></div></div></div></section></div>;
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
  const profile = useGetProfessional(auth.user?.id || 0, { query: { enabled: Boolean(auth.user), retry: false, queryKey: getGetProfessionalQueryKey(auth.user?.id || 0) } });
  if (!auth.user) return null;
  if (profile.isLoading) return <LoadingBlock label="Cargando tu perfil público..." />;
  if (profile.isError || !profile.data) {
    return <div className="mx-auto max-w-3xl space-y-7"><div><p className="eyebrow">Tu perfil público</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Todavía no publicaste tu perfil.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Completá tus datos profesionales para que los clientes puedan conocerte y contratarte.</p></div><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 md:p-8"><div className="flex items-start gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"><UserRound size={21} /></div><div><h2 className="display-font text-xl font-bold">Completá Mis servicios</h2><p className="mt-1 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Ahí podés cargar tu oficio, categoría, precio, experiencia, descripción, habilidades y disponibilidad. Después vas a poder ver esta misma ficha como la ven los clientes.</p><Button onClick={() => setLocation('/services')} className="mt-5" testId="button-go-to-services">Completar mis servicios <ChevronRight size={16} /></Button></div></div></section></div>;
  }
  return <><div className="relative mx-auto max-w-5xl"><ProfessionalPageLegacy professionalId={auth.user.id} publicOnly /><Button onClick={() => setLocation('/services')} variant="soft" className="absolute right-4 top-[9.5rem] z-10 sm:right-8" testId="button-edit-own-profile"><Pencil size={16} /> Editar mi perfil</Button></div><div className="mx-auto max-w-5xl pb-8"><ProfessionalReviews professionalId={auth.user.id} /></div></>;
}

function JobCard({ job, onStatus }: { job: WorkyJob; onStatus?: (status: 'accepted' | 'in_progress' | 'completed' | 'cancelled') => void }) {
  const nextAction = job.status === 'published' ? 'Aceptar changa' : job.status === 'accepted' ? 'Marcar en curso' : job.status === 'in_progress' ? 'Completar trabajo' : null;
  return <article className="card-lift rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5" data-testid={`card-job-${job.id}`}><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="text-[11px] font-bold uppercase tracking-[.12em] text-[hsl(var(--primary))]">{job.category}</span><StatusBadge status={job.status} /></div><h3 className="display-font mt-3 text-lg font-bold leading-tight">{job.detail}</h3></div><span className="text-xs text-[hsl(var(--muted-foreground))]">{dateLabel(job.createdAt)}</span></div><div className="mt-5 grid grid-cols-2 gap-3 border-y border-[hsl(var(--border))] py-3 text-xs"><span className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]"><MapPin size={14} /> {job.location}</span><span className="font-bold">{money(job.price)}</span><span className="text-[hsl(var(--muted-foreground))]">Cliente <b className="text-[hsl(var(--foreground))]">{job.clientName}</b></span><span className="text-[hsl(var(--muted-foreground))]">Profesional <b className="text-[hsl(var(--foreground))]">{job.professionalName || 'Por asignar'}</b></span></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><Link href={`/chat/${job.id}`} className="focus-ring flex items-center gap-2 text-xs font-bold text-[hsl(var(--secondary))] hover:text-[hsl(var(--primary))]" data-testid={`link-chat-job-${job.id}`}><MessageCircle size={15} /> Abrir conversación</Link><div className="flex flex-wrap gap-2">{job.status === 'completed' && job.professionalId ? <ReviewButton job={job} /> : null}{nextAction && onStatus && <Button onClick={() => onStatus(job.status === 'published' ? 'accepted' : job.status === 'accepted' ? 'in_progress' : 'completed')} variant="soft" className="px-3 py-2 text-xs" testId={`button-status-job-${job.id}`}>{nextAction} <ChevronRight size={14} /></Button>}</div></div></article>;
}

function PartnerJobsSections() {
  const [activeSection, setActiveSection] = useState('opportunities');
  const available = useListAvailableJobs({ query: { queryKey: getListAvailableJobsQueryKey() } });
  const assigned = useListAssignedJobs({ query: { queryKey: getListAssignedJobsQueryKey() } });
  const acceptJob = useAcceptJob();
  const updateJob = useUpdateJob();
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getListAvailableJobsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListAssignedJobsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: ['partner-dashboard'] }),
  ]);
  const update = (id: number, status: 'accepted' | 'in_progress' | 'completed') => {
    if (status === 'accepted') acceptJob.mutate({ id }, { onSuccess: refresh });
    else updateJob.mutate({ id, data: { estado: status === 'in_progress' ? 'en_curso' : 'finalizada' } }, { onSuccess: refresh });
  };
  const opportunities = available.data?.map(toJob) ?? [];
  const assignedJobs = assigned.data?.map(toJob) ?? [];
  const sections = [
    { key: 'opportunities', title: 'Oportunidades', copy: 'Solicitudes nuevas para aceptar.', jobs: opportunities, action: (job: WorkyJob) => update(job.id, 'accepted') },
    { key: 'progress', title: 'En proceso', copy: 'Trabajos aceptados y todavía activos.', jobs: assignedJobs.filter((job) => job.status === 'accepted' || job.status === 'in_progress'), action: (job: WorkyJob) => update(job.id, job.status === 'accepted' ? 'in_progress' : 'completed') },
    { key: 'completed', title: 'Mis trabajos', copy: 'Trabajos que ya realizaste.', jobs: assignedJobs.filter((job) => job.status === 'completed') },
  ];
  if (available.isLoading || assigned.isLoading) return <LoadingBlock label="Buscando tus changas..." />;
  if (available.isError || assigned.isError) return <ErrorState onRetry={() => { void available.refetch(); void assigned.refetch(); }} />;
  const selected = sections.find((section) => section.key === activeSection) ?? sections[0];
  return <div className="space-y-6">
    <div className="grid grid-cols-3 gap-1 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.45)] p-1" role="tablist" aria-label="Secciones de changas">
      {sections.map((section) => <button key={section.key} type="button" role="tab" aria-selected={selected.key === section.key} onClick={() => setActiveSection(section.key)} className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-3 text-xs font-bold transition-colors sm:px-4 ${selected.key === section.key ? 'bg-[hsl(var(--card))] text-[hsl(var(--secondary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`} data-testid={`button-jobs-tab-${section.key}`}><span className="truncate">{section.title}</span><span className={`rounded-full px-2 py-0.5 text-[10px] ${selected.key === section.key ? 'bg-[hsl(var(--primary)/.14)] text-[hsl(var(--primary))]' : 'bg-[hsl(var(--card))]'}`}>{section.jobs.length}</span></button>)}
    </div>
    <section data-testid={`jobs-section-${selected.key}`} aria-labelledby={`jobs-tab-${selected.key}`}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div><p className="eyebrow">{selected.key === 'opportunities' ? 'Para aceptar' : selected.key === 'progress' ? 'En marcha' : 'Historial'}</p><h2 id={`jobs-tab-${selected.key}`} className="display-font mt-1 text-2xl font-bold">{selected.title}</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{selected.copy}</p></div>
        <span className="rounded-full bg-[hsl(var(--muted))] px-2.5 py-1 text-[11px] font-bold">{selected.jobs.length}</span>
      </div>
      {selected.jobs.length ? <div className="grid max-w-4xl gap-4">{selected.jobs.map((job) => <JobCard key={job.id} job={job} onStatus={selected.action ? () => selected.action?.(job) : undefined} />)}</div> : <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-6 text-sm text-[hsl(var(--muted-foreground))]">No hay changas en esta sección por ahora.</div>}
    </section>
  </div>;
}

function JobsPage({ role }: { role: Role | string }) {
  const [view, setView] = useState<'available' | 'mine' | 'all'>(role === 'professional' ? 'available' : 'all');
  const availableJobs = useListAvailableJobs({ query: { enabled: role === 'professional' && view === 'available', queryKey: getListAvailableJobsQueryKey() } });
  const assignedJobs = useListAssignedJobs({ query: { enabled: role === 'professional' && view === 'mine', queryKey: getListAssignedJobsQueryKey() } });
  const myJobs = useListMyJobs({ query: { enabled: role === 'client', queryKey: getListMyJobsQueryKey() } });
  const updateJob = useUpdateJob();
  const acceptJob = useAcceptJob();
  const filters = role === 'professional' ? [{ key: 'available', label: 'Oportunidades' }, { key: 'mine', label: 'Mis trabajos' }] : [{ key: 'all', label: 'Todas mis changas' }];
  const jobs = role === 'client' ? myJobs : view === 'available' ? availableJobs : assignedJobs;
  const list = jobs.data?.map(toJob) ?? [];
  const refreshJobs = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getListAvailableJobsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListAssignedJobsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListMyJobsQueryKey() }),
  ]);
  const update = (id: number, status: 'accepted' | 'in_progress' | 'completed' | 'cancelled') => {
    if (status === 'accepted') acceptJob.mutate({ id }, { onSuccess: refreshJobs });
    else {
      const statuses = { in_progress: 'en_curso', completed: 'finalizada', cancelled: 'cancelada' } as const;
      updateJob.mutate({ id, data: { estado: statuses[status] } }, { onSuccess: refreshJobs });
    }
  };
  if (role === 'professional') return <div className="space-y-8"><div><p className="eyebrow">Changas</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Tu operación, ordenada.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Separá lo que podés aceptar, lo que está en marcha y lo que ya realizaste.</p></div><PartnerJobsSections /></div>;
  return <div className="space-y-8"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Changas</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">{role === 'professional' ? 'Oportunidades que encajan' : 'Lo que está pasando'}</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{role === 'professional' ? 'Elegí un trabajo y hacé que suceda.' : 'Seguimiento simple de tus pedidos y trabajos.'}</p></div>{role === 'client' && <Link href="/jobs/new" className="focus-ring" data-testid="link-new-job"><Button testId="button-new-job"><Plus size={17} /> Publicar changa</Button></Link>}</div><div className="flex gap-2 border-b border-[hsl(var(--border))] pb-3">{filters.map((filter) => <button key={filter.key} onClick={() => setView(filter.key as typeof view)} className={`rounded-lg px-3 py-2 text-xs font-bold ${view === filter.key ? 'bg-[hsl(var(--secondary))] text-white' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`} data-testid={`button-jobs-view-${filter.key}`}>{filter.label}</button>)}</div>{jobs.isLoading ? <LoadingBlock label="Buscando changas..." /> : jobs.isError ? <ErrorState onRetry={() => void jobs.refetch()} /> : list.length === 0 ? <EmptyState icon={BriefcaseBusiness} title={role === 'professional' ? 'No hay oportunidades por ahora' : 'Todavía no publicaste changas'} copy={role === 'professional' ? 'Cuando aparezca una solicitud cerca tuyo, la vas a ver acá.' : 'Publicá tu primera changa y encontrá a alguien que la resuelva.'} action={role === 'client' ? <Link href="/jobs/new" data-testid="link-empty-new-job"><Button variant="primary" testId="button-empty-new-job"><Plus size={16} /> Publicar una changa</Button></Link> : undefined} /> : <div className="grid max-w-4xl gap-4">{list.map((job) => <JobCard key={job.id} job={job} onStatus={role === 'professional' ? (status) => update(job.id, status) : undefined} />)}</div>}{(updateJob.isPending || acceptJob.isPending) && <div className="fixed bottom-5 right-5 flex items-center gap-2 rounded-xl bg-[hsl(var(--secondary))] px-4 py-3 text-xs font-bold text-white shadow-xl" role="status"><LoaderCircle className="animate-spin" size={15} /> Actualizando changa...</div>}</div>;
}

function AppointmentActions({ appointment, clientId, onAccept, onReject, onCancel, pendingAction, history, onRetry, onDelete, syncingId }: { appointment: Appointment; clientId: number; onAccept: (id: number) => void; onReject: (id: number) => void; onCancel: (id: number) => void; pendingAction: AppointmentAction | null; history?: AppointmentAttempt[]; onRetry?: (attempt: PendingAppointmentAttempt) => void; onDelete?: (id: number) => void; syncingId?: number | null }) {
  const auth = useAuth();
  const isAccepting = pendingAction === 'accept';
  const isRejecting = pendingAction === 'reject';
  const isCancelling = pendingAction === 'cancel';
  const canAct = appointment.estado === 'solicitada' && auth.user?.id === clientId;
  const canCancel = (appointment.estado === 'solicitada' || appointment.estado === 'confirmada') && auth.user?.id === clientId;
  return <>{history?.length ? <AppointmentAttemptHistory attempts={history} onRetry={onRetry} onDelete={onDelete} syncingId={syncingId} /> : null}{(canAct || canCancel) && <span className="flex flex-wrap gap-2">{canAct && <><Button onClick={() => onAccept(appointment.id)} disabled={pendingAction !== null} variant="soft" className="px-2 py-1 text-[10px]" testId={`button-accept-appointment-${appointment.id}`}>{isAccepting && <LoaderCircle className="animate-spin" size={12} />} {isAccepting ? 'Aceptando...' : 'Aceptar'}</Button><Button onClick={() => onReject(appointment.id)} disabled={pendingAction !== null} variant="ghost" className="px-2 py-1 text-[10px]" testId={`button-reject-appointment-${appointment.id}`}>{isRejecting && <LoaderCircle className="animate-spin" size={12} />} {isRejecting ? 'Rechazando...' : 'Rechazar'}</Button></>}{canCancel && <Button onClick={() => onCancel(appointment.id)} disabled={pendingAction !== null} variant="ghost" className="px-2 py-1 text-[10px] text-[hsl(var(--destructive))]" testId={`button-cancel-appointment-${appointment.id}`}>{isCancelling && <LoaderCircle className="animate-spin" size={12} />} {isCancelling ? 'Cancelando...' : 'Cancelar visita'}</Button>}</span>}</>;
}

function ConversationsPage() {
  const conversations = useListConversations({ query: { queryKey: getListConversationsQueryKey(), refetchInterval: 30000 } });
  return <div className="mx-auto max-w-4xl space-y-7"><div><p className="eyebrow">Tu bandeja</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Conversaciones en marcha.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Coordiná cada changa sin perder el hilo.</p></div>{conversations.isLoading ? <LoadingBlock label="Cargando conversaciones..." /> : conversations.isError ? <ErrorState onRetry={() => void conversations.refetch()} /> : !conversations.data?.length ? <EmptyState icon={MessageCircle} title="Todavía no hay conversaciones" copy="Cuando publiques o aceptes una changa, la conversación aparece acá." /> : <div className="space-y-3">{conversations.data.map((conversation) => <Link key={conversation.changaId} href={`/chat/${conversation.changaId}`} className="card-lift flex items-center gap-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4" data-testid={`conversation-${conversation.changaId}`}><Avatar name={conversation.interlocutor?.nombre || 'Worky'} size="md" warm /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-bold">{conversation.interlocutor?.nombre || 'Changa sin Partner'}</p><StatusBadge status={conversation.estado === 'publicada' ? 'published' : conversation.estado === 'aceptada' ? 'accepted' : conversation.estado === 'en_curso' ? 'in_progress' : conversation.estado === 'finalizada' ? 'completed' : 'cancelled'} /></div><p className="mt-1 truncate text-xs text-[hsl(var(--muted-foreground))]">{conversation.ultimoMensaje?.texto || conversation.detalle || 'Sin mensajes todavía'}</p></div>{conversation.unread > 0 && <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[hsl(var(--primary))] px-1.5 text-[10px] font-bold text-white">{conversation.unread}</span>}<ChevronRight size={16} className="text-[hsl(var(--muted-foreground))]" /></Link>)}</div>}</div>;
}

function PartnerDashboard() {
  const dashboard = useQuery({ queryKey: ['partner-dashboard'], queryFn: () => apiRequest<{ trabajos: Job[]; calendario: Array<{ id: number; empiezaAt: string; estado: string; changaId: number }>; archivos: Array<{ id: number }>; notificacionesNoLeidas: number }>('/partner/dashboard'), refetchInterval: 30000 });
  if (dashboard.isLoading) return <LoadingBlock label="Cargando tu operación..." />;
  if (dashboard.isError || !dashboard.data) return <ErrorState onRetry={() => void dashboard.refetch()} />;
  const data = dashboard.data;
  const jobs = data.trabajos.map(toJob);
  return <div className="space-y-8"><div><p className="eyebrow">Operación Partner</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Todo lo que tenés en marcha.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Trabajos, agenda y conversaciones en un solo lugar.</p></div><div className="grid gap-4 sm:grid-cols-3"><div className="rounded-2xl bg-[hsl(var(--secondary))] p-5 text-white"><BriefcaseBusiness size={19} className="text-[hsl(var(--accent))]" /><p className="mt-5 text-3xl font-bold">{jobs.length}</p><p className="mt-1 text-xs text-white/60">trabajos activos</p></div><div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><CalendarDays size={19} className="text-[hsl(var(--primary))]" /><p className="mt-5 text-3xl font-bold">{data.calendario.length}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">eventos en agenda</p></div><div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"><Bell size={19} className="text-[hsl(var(--primary))]" /><p className="mt-5 text-3xl font-bold">{data.notificacionesNoLeidas}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">novedades sin leer</p></div></div><div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]"><section><div className="mb-4 flex items-center justify-between"><h2 className="display-font text-xl font-bold">Trabajos recientes</h2><Link href="/jobs" className="text-xs font-bold text-[hsl(var(--primary))]">Ver todos</Link></div>{jobs.length ? <div className="space-y-3">{jobs.slice(0, 5).map((job) => <JobCard key={job.id} job={job} />)}</div> : <EmptyState icon={BriefcaseBusiness} title="Todavía no hay trabajos" copy="Las oportunidades que aceptes van a aparecer acá." />}</section><section className="space-y-6"><div><h2 className="mb-4 display-font text-xl font-bold">Próximamente</h2><div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">{data.calendario.length ? data.calendario.slice(0, 4).map((event) => <Link href={`/chat/${event.changaId}`} key={event.id} className="flex items-center gap-3 border-b border-[hsl(var(--border))] py-3 last:border-0"><CalendarDays size={17} className="text-[hsl(var(--primary))]" /><span><b className="block text-xs">{dateLabel(event.empiezaAt)}</b><small className="text-[11px] text-[hsl(var(--muted-foreground))]">Reserva {event.estado}</small></span></Link>) : <p className="py-5 text-center text-xs text-[hsl(var(--muted-foreground))]">Tu agenda está despejada.</p>}</div></div><div className="rounded-2xl bg-[hsl(var(--accent))] p-5"><p className="text-xs font-bold">Portfolio conectado</p><p className="mt-2 text-sm leading-relaxed">Tus archivos se guardan en almacenamiento seguro; Worky conserva solo sus metadatos.</p><Link href="/profile" className="mt-4 inline-flex text-xs font-bold underline">Administrar perfil y archivos</Link></div></section></div></div>;
}

function NewJobPage() {
  const createJob = useCreateJob();
  const [, setLocation] = useLocation();
  const [form, setForm] = useState({ category: '', location: '', price: '', detail: '' });
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); createJob.mutate({ data: { categoria: form.category, ubicacion: { direccionTexto: form.location }, precioOfrecido: Number(form.price), detalle: form.detail, profesionalId: null } }, { onSuccess: (job) => { queryClient.invalidateQueries({ queryKey: getListMyJobsQueryKey() }); setLocation(`/chat/${job.id}`); } }); };
  return <div className="mx-auto max-w-3xl space-y-7"><Link href="/jobs" className="focus-ring inline-flex items-center gap-2 text-xs font-bold text-[hsl(var(--muted-foreground))]" data-testid="link-back-jobs"><ChevronRight className="rotate-180" size={15} /> Volver a changas</Link><div><p className="eyebrow">Nueva publicación</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">¿Qué necesitás resolver?</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Cuanto más detalle compartas, mejores propuestas vas a recibir.</p></div><form onSubmit={submit} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 md:p-8"><div className="grid gap-5 md:grid-cols-2"><label><span className="label">Oficio</span><select required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="field" data-testid="select-job-category"><option value="">Elegí una categoría</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label><span className="label">Zona</span><div className="relative"><MapPin size={16} className="absolute left-3 top-3.5 text-[hsl(var(--muted-foreground))]" /><input required minLength={3} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} className="field pl-9" placeholder="Ej: Villa Urquiza, CABA" data-testid="input-job-location" /></div></label><label><span className="label">Presupuesto orientativo</span><div className="relative"><span className="absolute left-3 top-3 text-sm font-bold text-[hsl(var(--muted-foreground))]">$</span><input required type="number" min="0" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} className="field pl-8" placeholder="45000" data-testid="input-job-price" /></div></label><div className="rounded-xl bg-[hsl(var(--muted)/.7)] p-3 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]"><ShieldCheck size={16} className="mb-1 text-[hsl(var(--primary))]" /><b className="text-[hsl(var(--foreground))]">Publicación cuidada.</b> Tu contacto se comparte solo cuando aceptás una propuesta.</div><label className="md:col-span-2"><span className="label">Contá qué hay que hacer</span><textarea required minLength={3} value={form.detail} onChange={(event) => setForm({ ...form, detail: event.target.value })} className="field min-h-36 resize-y" placeholder="Describí el problema, medidas, materiales o cualquier dato que ayude..." data-testid="textarea-job-detail" /></label></div><div className="mt-7 flex flex-col-reverse gap-3 border-t border-[hsl(var(--border))] pt-6 sm:flex-row sm:justify-end"><Link href="/jobs" className="focus-ring" data-testid="link-cancel-job"><Button variant="ghost" className="w-full sm:w-auto" testId="button-cancel-job">Cancelar</Button></Link><Button type="submit" disabled={createJob.isPending} className="w-full sm:w-auto" testId="button-publish-job">{createJob.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Plus size={17} />} {createJob.isPending ? 'Publicando...' : 'Publicar changa'}</Button></div>{createJob.isError && <p className="mt-4 text-right text-xs font-bold text-[hsl(var(--destructive))]" data-testid="text-job-error">No se pudo publicar. Revisá los datos e intentá de nuevo.</p>}</form></div>;
}

function AppointmentAttemptHistoryLegacy({ attempts }: { attempts: AppointmentAttempt[] }) {
  return <div className="mt-5 border-t border-[hsl(var(--border)/.6)] pt-4"><p className="mb-3 text-xs font-bold">Historial de intentos</p>{attempts.length ? <div className="space-y-2" data-testid="appointment-attempt-history">{attempts.map((attempt) => { const labels = appointmentAttemptLabel(attempt); return <div key={attempt.id} className="rounded-xl bg-white/60 px-3 py-2 text-xs"><div className="flex items-start justify-between gap-3"><span className="font-bold">{labels.action}</span><span className={`text-right font-bold ${attemptResultTone(attempt.resultado)}`}>{labels.result}</span></div><p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(attempt.createdAt))}{attempt.detalle ? ` · ${attempt.detalle}` : ''}</p></div>; })}</div> : <p className="text-xs text-[hsl(var(--muted-foreground))]">Todavía no hay intentos registrados.</p>}</div>;
}

function AppointmentAttemptHistory({ attempts, onRetry, onDelete, syncingId }: { attempts: AppointmentAttempt[]; onRetry?: (attempt: PendingAppointmentAttempt) => void; onDelete?: (id: number) => void; syncingId?: number | null }) {
  return <div className="mt-5 border-t border-[hsl(var(--border)/.6)] pt-4"><div className="mb-3 flex items-center justify-between gap-3"><p className="text-xs font-bold">Historial de intentos</p><span className="text-[10px] text-[hsl(var(--muted-foreground))]">{attempts.length} registro{attempts.length === 1 ? '' : 's'}</span></div>{attempts.length ? <div className="space-y-2" data-testid="appointment-attempt-history">{attempts.map((attempt) => { const labels = appointmentAttemptLabel(attempt); const pending = attempt.id < 0; return <div key={attempt.id} className={`rounded-xl px-3 py-2 text-xs ${pending ? 'border border-[hsl(var(--accent)/.7)] bg-[hsl(var(--accent)/.18)]' : 'bg-white/60'}`}><div className="flex items-start justify-between gap-3"><span className="font-bold">{labels.action}</span><span className={`text-right font-bold ${pending ? 'text-[hsl(var(--primary))]' : attemptResultTone(attempt.resultado)}`}>{pending ? 'Pendiente de sincronización' : labels.result}</span></div><p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(attempt.createdAt))}{attempt.detalle ? ` · ${attempt.detalle}` : ''}</p>{pending && onRetry && onDelete && <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => onRetry(attempt as PendingAppointmentAttempt)} disabled={syncingId === attempt.id} className="inline-flex items-center gap-1 rounded-lg bg-[hsl(var(--primary))] px-2 py-1 text-[10px] font-bold text-white disabled:opacity-60" data-testid={`button-retry-attempt-${attempt.id}`}>{syncingId === attempt.id ? <LoaderCircle className="animate-spin" size={12} /> : <RefreshCw size={12} />} {syncingId === attempt.id ? 'Sincronizando...' : 'Reintentar'}</button><button type="button" onClick={() => onDelete(attempt.id)} disabled={syncingId === attempt.id} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.08)] disabled:opacity-60" data-testid={`button-delete-attempt-${attempt.id}`}><Trash2 size={12} /> Eliminar</button></div>}</div>; })}</div> : <p className="text-xs text-[hsl(var(--muted-foreground))]">Todavía no hay intentos registrados.</p>}</div>;
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

function ChatPageLegacy() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const auth = useAuth();
  const job = useGetJob(id, { query: { queryKey: getGetJobQueryKey(id), retry: false } });
  const messages = useListMessages(id, { query: { queryKey: getListMessagesQueryKey(id), refetchInterval: 10000 } });
  const createMessage = useCreateMessage();
  const appointmentQuery = useListAppointments(id, { query: { queryKey: getListAppointmentsQueryKey(id), refetchInterval: 10000 } });
  const attemptHistory = useQuery({
    queryKey: getListAppointmentAttemptsQueryKey(id),
    queryFn: () => apiRequest<AppointmentAttempt[]>(`/chats/${id}/historial-visitas`),
    // Keep an open conversation current when the other participant proposes,
    // accepts, or rejects a visit in another session.
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
  const proposeAppointmentMutation = useProposeAppointment();
  const acceptAppointmentMutation = useAcceptAppointment();
  const rejectAppointmentMutation = useRejectAppointment();
  const [body, setBody] = useState('');
  const [appointmentDate, setAppointmentDate] = useState('');
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
  useEffect(() => { void markMessagesRead(id).then(() => queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() })).catch(() => undefined); }, [id]);
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
    if ((!body.trim() && !chatFiles.length) || sendingMessage || createMessage.isPending) return;
    setChatError('');
    setSendingMessage(true);
    try {
      const adjuntos = await Promise.all(chatFiles.map(({ file }) => uploadWorkyFile(file, 'chat_image', id)));
      await createMessage.mutateAsync({ changaId: id, data: { texto: body.trim() || 'Imagen adjunta', adjuntos } });
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
      await proposeAppointmentMutation.mutateAsync({ changaId: id, data: { empiezaAt: new Date(appointmentDate).toISOString() } });
      setAppointmentDate('');
      await appointments.refetch();
    } catch (error) {
      setAppointmentActionError(appointmentErrorMessage('propose', error));
      await rememberFailedAttempt('proponer', error);
    } finally {
      setPendingAppointmentAction(null);
    }
  };
  const runAppointmentAction = async (action: 'accept' | 'reject' | 'cancel', appointmentId: number) => {
    if (pendingAppointmentAction) return;
    setAppointmentActionError('');
    setPendingAppointmentAction(action);
    try {
      if (action === 'accept') await acceptAppointmentMutation.mutateAsync({ id: appointmentId });
      else if (action === 'reject') await rejectAppointmentMutation.mutateAsync({ id: appointmentId });
      else await apiRequest(`/citas/${appointmentId}`, { method: 'PATCH', body: JSON.stringify({ accion: 'cancelar' }) });
      await appointments.refetch();
    } catch (error) {
       setAppointmentActionError(appointmentErrorMessage(action, error));
       await rememberFailedAttempt(action === 'accept' ? 'aceptar' : action === 'cancel' ? 'cancelar' : 'rechazar', error);
    } finally {
      setPendingAppointmentAction(null);
    }
  };
  if (job.isLoading) return <LoadingBlock label="Abriendo conversación..." />;
  if (job.isError || !job.data) return <ErrorState onRetry={() => void job.refetch()} />;
  const currentJob = toJob(job.data);
  const list = messages.data || [];
  const remoteAttempts = attemptHistory.data || [];
  const remoteFingerprints = new Set(remoteAttempts.map((attempt) => `${attempt.accion}|${attempt.resultado}|${attempt.detalle || ''}`));
  const historyRows = [...remoteAttempts, ...localAttempts.filter((attempt) => !remoteFingerprints.has(`${attempt.accion}|${attempt.resultado}|${attempt.detalle || ''}`))].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const appointments = { ...appointmentQuery, data: appointmentQuery.data?.length ? appointmentQuery.data : historyRows.length ? [{ id: -1, changaId: id, clienteId: currentJob.clientId, profesionalId: currentJob.professionalId || 0, empiezaAt: new Date().toISOString(), terminaAt: null, estado: 'cancelada' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] : appointmentQuery.data };
  const activeAppointment = appointmentQuery.data?.some((appointment) => ['solicitada', 'confirmada', 'en_curso'].includes(appointment.estado));
  // Do not expose the proposal form while the server is still checking the
  // current appointments; otherwise a confirmed visit briefly looks
  // available again on the Partner's first render.
  const canProposeAppointment = appointmentQuery.isSuccess && auth.user?.id === currentJob.professionalId && !activeAppointment;
  const appointmentRows = appointments.data?.map((appointment, index) => appointment.id < 0 ? <AppointmentAttemptHistory key={appointment.id} attempts={historyRows} onRetry={retryPendingAttempt} onDelete={removePendingAttempt} syncingId={syncingAttemptId} /> : <div key={appointment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/60 px-3 py-2 text-xs"><span>{new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(appointment.empiezaAt))}</span><span className="font-bold">{appointment.estado}</span><AppointmentActions appointment={appointment} clientId={currentJob.clientId} onAccept={(appointmentId) => void runAppointmentAction('accept', appointmentId)} onReject={(appointmentId) => void runAppointmentAction('reject', appointmentId)} onCancel={(appointmentId) => void runAppointmentAction('cancel', appointmentId)} pendingAction={pendingAppointmentAction} history={index === 0 ? historyRows : undefined} onRetry={retryPendingAttempt} onDelete={removePendingAttempt} syncingId={syncingAttemptId} /></div>);
    return <div className="mx-auto max-w-3xl"><Link href="/conversations" className="focus-ring mb-6 inline-flex items-center gap-2 text-xs font-bold text-[hsl(var(--muted-foreground))]" data-testid="link-back-from-chat"><ChevronRight className="rotate-180" size={15} /> Volver a conversaciones</Link><section className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]"><header className="flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)] px-5 py-4"><div className="flex items-center gap-3"><Link href={currentJob.professionalId ? `/professional/${currentJob.professionalId}` : '/home'} className="focus-ring flex items-center gap-3 rounded-xl" data-testid="link-chat-professional-profile" aria-label={`Abrir perfil de ${currentJob.professionalName || 'Partner'}`}><Avatar initials={(currentJob.professionalName || currentJob.clientName).split(' ').map((part) => part[0]).slice(0, 2).join('')} size="sm" warm /><span className="text-xs font-bold">{currentJob.professionalName || currentJob.clientName}</span></Link><div><p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">{currentJob.category} · {currentJob.location}</p></div></div><StatusBadge status={currentJob.status} /></header><div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--accent)/.25)] p-4"><div className="mb-3 flex items-center gap-2"><CalendarDays size={16} className="text-[hsl(var(--primary))]" /><p className="text-xs font-bold">Visitas coordinadas</p></div>{appointments.data?.length ? <div className="space-y-2">{appointmentRows}</div> : <p className="text-xs text-[hsl(var(--muted-foreground))]">Todavía no hay una visita propuesta.</p>}{appointmentActionError && <p className="appointment-error mt-3" role="alert" data-testid="text-appointment-error"><CircleAlert size={15} /> {appointmentActionError}</p>}{auth.user?.id === currentJob.professionalId ? canProposeAppointment ? <form onSubmit={proposeAppointment} className="mt-3 flex flex-col gap-2 sm:flex-row"><input type="datetime-local" required value={appointmentDate} onChange={(event) => setAppointmentDate(event.target.value)} className="field flex-1 bg-white/75" aria-label="Fecha y hora de visita" /><Button type="submit" disabled={pendingAppointmentAction !== null} variant="soft" className="whitespace-nowrap" testId="button-propose-appointment">{pendingAppointmentAction === 'propose' && <LoaderCircle className="animate-spin" size={15} />} {pendingAppointmentAction === 'propose' ? 'Proponiendo...' : 'Proponer visita'}</Button></form> : <p className="mt-3 text-xs font-semibold text-[hsl(var(--muted-foreground))]">Ya hay una visita activa. Esperá a que se cancele o finalice antes de proponer otra.</p> : null}</div><div className="flex min-h-[430px] flex-col gap-4 bg-[hsl(var(--background)/.5)] p-5 md:p-8" data-testid="list-messages">{messages.isLoading ? <LoadingBlock label="Cargando mensajes..." /> : messages.isError ? <ErrorState onRetry={() => void messages.refetch()} /> : list.length === 0 ? <EmptyState icon={MessageCircle} title="Arranquen la conversación" copy="Coordiná detalles, horarios y expectativas antes de empezar." /> : list.map((message) => <div key={message.id} className={`flex ${message.emisor.id === currentJob.clientId ? 'justify-end' : 'justify-start'}`} data-testid={`message-${message.id}`}><div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.emisor.id === currentJob.clientId ? 'rounded-br-md bg-[hsl(var(--secondary))] text-white' : 'rounded-bl-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`}><p>{message.texto}</p>{message.adjuntos.map((attachment) => <ChatAttachment key={attachment.objectPath} attachment={attachment} outgoing={message.emisor.id === currentJob.clientId} />)}<p className={`mt-1.5 text-[10px] ${message.emisor.id === currentJob.clientId ? 'text-white/45' : 'text-[hsl(var(--muted-foreground))]'}`}>{message.emisor.nombre} · {dateLabel(message.createdAt)}</p></div></div>)}</div><form onSubmit={send} className="border-t border-[hsl(var(--border))] p-4"><div className="mb-3 flex flex-wrap gap-2">{chatFiles.map((item, index) => <div key={`${item.file.name}-${index}`} className="relative"><img src={item.preview} alt={item.file.name} className="h-14 w-14 rounded-lg object-cover" /><button type="button" onClick={() => removeChatFile(index)} className="absolute -right-1.5 -top-1.5 rounded-full bg-[hsl(var(--secondary))] p-1 text-white" aria-label={`Quitar ${item.file.name}`}><X size={12} /></button></div>)}</div>{chatError && <p className="mb-2 text-xs font-semibold text-[hsl(var(--destructive))]" role="alert">{chatError}</p>}<div className="flex items-end gap-2"><label className="flex h-[46px] w-[46px] shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" aria-label="Adjuntar imágenes"><Paperclip size={18} /><input type="file" accept="image/*" multiple className="hidden" onChange={(event) => { selectChatFiles(event.target.files); event.currentTarget.value = ''; }} data-testid="input-chat-images" /></label><textarea value={body} onChange={(event) => setBody(event.target.value)} className="field min-h-[46px] max-h-32 resize-none" rows={1} placeholder="Escribí un mensaje..." maxLength={1000} data-testid="textarea-message" /><Button type="submit" disabled={sendingMessage || createMessage.isPending || (!body.trim() && !chatFiles.length)} className="h-[46px] w-[46px] shrink-0 p-0" testId="button-send-message">{sendingMessage || createMessage.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Send size={17} />}</Button></div></form></section></div>;
}

function ChatPage() {
  return <ChatPageLegacy />;
}

function ClientProfilePage() {
  const auth = useAuth();
  const user = auth.user;
  if (!user) return <LoadingBlock label="Cargando tu cuenta..." />;
  const initials = user.nombre.split(' ').map((part) => part[0]).join('').slice(0, 2);
  return <div className="mx-auto max-w-3xl space-y-8" data-testid="client-profile-page"><div><p className="eyebrow">Tu cuenta</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Tu perfil de cliente.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Desde acá contratás profesionales y seguís tus changas.</p></div><section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 md:p-8"><div className="flex items-center gap-4 border-b border-[hsl(var(--border))] pb-6"><Avatar name={user.nombre} initials={initials} size="lg" warm /><div><h2 className="display-font text-xl font-bold">{user.nombre}</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{user.email}</p></div></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><div className="rounded-xl bg-[hsl(var(--muted)/.7)] p-4"><p className="text-xs font-bold">Usás Worky como cliente</p><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Podés publicar changas, conversar y calificar trabajos finalizados.</p></div><div className="rounded-xl bg-[hsl(var(--accent)/.35)] p-4"><p className="text-xs font-bold">¿También ofrecés servicios?</p><p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Activá tu perfil Partner sin crear otra cuenta.</p><Link href="/partner" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[hsl(var(--primary))]" data-testid="link-create-partner-from-client-profile">Ofrecer mis servicios <ChevronRight size={14} /></Link></div></div></section></div>;
}

function PartnerProfilePage() {
  const profile = useGetMyProfessionalProfile({ query: { queryKey: getGetMyProfessionalProfileQueryKey(), retry: false } });
  const update = useUpdateMyProfessionalProfile();
  const [form, setForm] = useState<ProfileForm | null>(null);
  const person = profile.data ? toProfessional(profile.data) : null;
  const current = form || (person ? { trade: person.trade, category: person.category, price: person.price, experience: person.experience, bio: person.bio, skills: person.skills, available: person.available } : null);
  if (profile.isLoading) return <LoadingBlock label="Cargando tu perfil..." />;
  if (profile.isError) return <ErrorState onRetry={() => void profile.refetch()} />;
  if (!profile.data || !person || !current) return <PartnerServiceSetupPage />;
  const value = current;
  const setField = <K extends keyof ProfileForm>(key: K, next: ProfileForm[K]) => setForm({ ...value, [key]: next });
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); update.mutate({ data: { oficio: value.trade, categoria: value.category, precioReferencia: value.price, experienciaAnios: value.experience, about: value.bio, skills: value.skills, disponible: value.available } }, { onSuccess: () => { setForm(null); queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() }); queryClient.invalidateQueries({ queryKey: getListProfessionalsQueryKey() }); } }); };
  return <PartnerProfileEditor person={person} value={value} setField={setField} submit={submit} update={update} verificationStatus={profile.data.estadoVerificacion} />;
}

function ProfilePage({ role }: { role: Role }) {
  return role === 'professional' ? <MyPublicProfilePage /> : <ClientProfilePage />;
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
  return <div className="mx-auto max-w-4xl space-y-8"><div><p className="eyebrow">Tu presencia</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Que tu perfil hable por vos.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Las personas eligen mejor cuando pueden conocerte un poco antes.</p></div><div className={`flex items-center gap-3 rounded-2xl border p-4 ${verificationStatus === 'verified' ? 'border-[#49a574]/30 bg-[#e6f4ed]' : verificationStatus === 'rejected' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}><ShieldCheck size={21} /><div><p className="text-sm font-bold">Verificación: {verificationStatusLabels[verificationStatus as VerificationDocument['estado']] || 'Pendiente de revisión'}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">El estado es privado de tu cuenta; tus documentos nunca aparecen en el perfil público.</p></div></div><form onSubmit={submit} className="grid gap-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 md:grid-cols-2 md:p-8"><div className="md:col-span-2 flex flex-wrap items-center gap-4 border-b border-[hsl(var(--border))] pb-6"><Avatar name={person.name} initials={person.initials} photoUrl={person.photoUrl} size="lg" warm /><div className="min-w-0 flex-1"><h2 className="display-font text-xl font-bold">{person.name}</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Perfil profesional · {person.location || 'Buenos Aires'}</p></div>{photoControl}</div><label><span className="label">Oficio principal</span><input required minLength={2} value={value.trade} onChange={(event) => setField('trade', event.target.value)} className="field" data-testid="input-profile-trade" /></label><label><span className="label">Categoría</span><select required value={value.category} onChange={(event) => setField('category', event.target.value)} className="field" data-testid="select-profile-category"><option value="">Elegí una categoría</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label><span className="label">Precio por visita</span><input required type="number" min="0" value={value.price} onChange={(event) => setField('price', Number(event.target.value))} className="field" data-testid="input-profile-price" /></label><label><span className="label">Años de experiencia</span><input required type="number" min="0" value={value.experience} onChange={(event) => setField('experience', Number(event.target.value))} className="field" data-testid="input-profile-experience" /></label><label className="md:col-span-2"><span className="label">Sobre tu trabajo</span><textarea required value={value.bio} onChange={(event) => setField('bio', event.target.value)} className="field min-h-32 resize-y" placeholder="Contá qué hacés, cómo trabajás y qué te diferencia..." data-testid="textarea-profile-bio" /></label><label className="md:col-span-2"><span className="label">Habilidades</span><SkillsInput skills={value.skills} onChange={(skills) => setField('skills', skills)} /><span className="sr-only">Separá cada habilidad con espacio, Enter o coma.</span></label><div className="md:col-span-2 flex items-center justify-between rounded-xl bg-[hsl(var(--muted)/.7)] p-4"><div><p className="text-sm font-bold">Estoy disponible para nuevas changas</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Tu perfil aparece activo en las búsquedas.</p></div><button type="button" onClick={() => setField('available', !value.available)} className={`relative h-7 w-12 rounded-full transition-colors ${value.available ? 'bg-[#49a574]' : 'bg-[hsl(var(--border))]'}`} data-testid="button-toggle-availability"><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${value.available ? 'translate-x-6' : 'translate-x-1'}`} /></button></div><div className="md:col-span-2 flex flex-col-reverse gap-3 border-t border-[hsl(var(--border))] pt-6 sm:flex-row sm:items-center sm:justify-end"><span className="mr-auto text-xs text-[hsl(var(--muted-foreground))]">{update.isSuccess ? 'Cambios guardados' : 'Tus cambios se guardan al confirmar.'}</span><Button type="submit" disabled={update.isPending} testId="button-save-profile">{update.isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Check size={17} />} {update.isPending ? 'Guardando...' : 'Guardar cambios'}</Button></div>{update.isError && <p className="md:col-span-2 text-xs font-bold text-[hsl(var(--destructive))]">No pudimos guardar los cambios. Intentá nuevamente.</p>}</form></div>;
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
  });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const createProfile = useCreateMyProfessionalProfile();
  const [, setLocation] = useLocation();
  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    try {
      await createProfile.mutateAsync({ data: { ...form, precioReferencia: Number(form.precioReferencia) || 0 } });
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
  const auth = useAuth();
  const registrationDraft = readRegistrationDraft();
  const primaryService = registrationDraft?.services?.[0];
  const [form, setForm] = useState(() => ({
    oficio: primaryService?.oficio ?? '',
    categoria: primaryService?.categoria ?? '',
    experienciaAnios: primaryService?.experienciaAnios ?? 0,
    skills: registrationDraft?.services?.map((service) => service.oficio).filter(Boolean) ?? [],
    precioReferencia: '',
    about: '',
  }));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const createProfile = useCreateMyProfessionalProfile();
  const [, setLocation] = useLocation();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setSaved(false);
    try { await createProfile.mutateAsync({ data: { ...form, precioReferencia: Number(form.precioReferencia) || 0 } }); await queryClient.invalidateQueries({ queryKey: getGetMyProfessionalProfileQueryKey() }); setSaved(true); setLocation('/profile'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos crear tu perfil Partner.'); }
  };
  return <div className="mx-auto max-w-3xl space-y-7"><div><p className="eyebrow">Tu cuenta Worky</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Ofrecé lo que sabés hacer.</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Usás la misma cuenta para contratar y ofrecer servicios. Completá estos datos para aparecer como Partner.</p></div><form onSubmit={submit} className="grid gap-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 md:grid-cols-2 md:p-8"><label><span className="label">¿Qué oficio ofrecés?</span><input required minLength={2} value={form.oficio} onChange={(e) => setForm({ ...form, oficio: e.target.value })} className="field" placeholder="Ej: Electricista" data-testid="input-partner-trade" /></label><label><span className="label">Categoría</span><select required value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} className="field"><option value="">Elegí una categoría</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label><span className="label">Precio de referencia</span><input type="number" min="0" value={form.precioReferencia} onChange={(e) => setForm({ ...form, precioReferencia: e.target.value })} className="field" placeholder="12000" /></label><label className="md:col-span-2"><span className="label">Contá brevemente sobre tu trabajo</span><textarea value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} className="field min-h-32 resize-y" placeholder="Experiencia, especialidades y zonas donde trabajás..." /></label>{error && <p className="md:col-span-2 text-xs font-bold text-[hsl(var(--destructive))]">{error}</p>}{saved && <p className="md:col-span-2 text-xs font-bold text-[#31825a]">Tu perfil Partner fue creado.</p>}<div className="md:col-span-2 flex justify-end border-t border-[hsl(var(--border))] pt-5"><Button type="submit" testId="button-create-partner">Empezar como Partner <ChevronRight size={16} /></Button></div></form></div>;
}

function AdminVerificationsPage() {
  const [reasonById, setReasonById] = useState<Record<number, string>>({});
  const [actionId, setActionId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const documents = useQuery({
    queryKey: ['admin-verifications'],
    queryFn: () => apiRequest<VerificationDocument[]>('/admin/verificaciones'),
    refetchInterval: 15000,
  });
  const resolve = async (document: VerificationDocument, estado: 'verified' | 'rejected') => {
    const motivo = reasonById[document.id]?.trim() || '';
    if (!motivo) { setError(`Agregá un motivo para ${verificationLabels[document.tipo].toLowerCase()}.`); return; }
    setActionId(document.id); setError('');
    try {
      await apiRequest(`/admin/verificaciones/${document.id}`, { method: 'PATCH', body: JSON.stringify({ estado, motivo }) });
      await documents.refetch();
      queryClient.invalidateQueries({ queryKey: ['worky-notifications'] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos guardar la decisión.');
    } finally { setActionId(null); }
  };
  if (documents.isLoading) return <LoadingBlock label="Cargando verificaciones pendientes..." />;
  if (documents.isError) return <ErrorState onRetry={() => void documents.refetch()} />;
  const rows = documents.data || [];
  return <div className="mx-auto max-w-5xl space-y-8" data-testid="admin-verifications-page">
    <div><p className="eyebrow">Operaciones</p><h1 className="display-font mt-2 text-4xl font-bold tracking-[-.055em]">Verificaciones de Partners.</h1><p className="mt-2 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">Revisá la documentación privada y dejá una decisión clara para cada caso. Solo el equipo administrador puede acceder a estos archivos.</p></div>
    {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700" role="alert">{error}</p>}
    {!rows.length ? <EmptyState icon={ShieldCheck} title="No hay verificaciones pendientes" copy="La cola está al día. Los nuevos documentos van a aparecer acá cuando un Partner complete su alta." /> :
      <div className="space-y-4">{rows.map((document) => <article key={document.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 md:p-6" data-testid={`verification-${document.id}`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="display-font text-xl font-bold">{document.partner.nombre}</h2><span className="status status-amber">{verificationStatusLabels[document.estado]}</span></div><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{document.partner.email} · {document.perfil?.oficio || 'Perfil sin oficio'} · {document.perfil?.categoria || 'Sin categoría'}</p></div><span className="text-xs text-[hsl(var(--muted-foreground))]">Recibido {dateLabel(document.createdAt)}</span></div>
        <div className="mt-5 flex flex-col gap-4 rounded-xl bg-[hsl(var(--muted)/.65)] p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-bold">{verificationLabels[document.tipo]}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{document.nombre} · {Math.round(document.sizeBytes / 1024)} KB</p></div><Button variant="ghost" onClick={() => { void openPrivateDocument(document.objectPath).catch((cause) => setError(cause instanceof Error ? cause.message : 'No pudimos abrir el documento.')); }} testId={`button-open-verification-${document.id}`}>Abrir documento</Button></div>
        <div className="mt-4"><label><span className="label">Motivo de la decisión</span><textarea value={reasonById[document.id] || ''} onChange={(event) => setReasonById((current) => ({ ...current, [document.id]: event.target.value }))} className="field min-h-20 resize-y" maxLength={1000} placeholder="Ej: La imagen se ve nítida y los datos coinciden..." data-testid={`textarea-verification-reason-${document.id}`} /></label><div className="mt-3 flex flex-wrap justify-end gap-2"><Button variant="danger" disabled={actionId === document.id} onClick={() => void resolve(document, 'rejected')} testId={`button-reject-verification-${document.id}`}>{actionId === document.id ? <LoaderCircle className="animate-spin" size={15} /> : null} Rechazar</Button><Button disabled={actionId === document.id} onClick={() => void resolve(document, 'verified')} testId={`button-approve-verification-${document.id}`}>{actionId === document.id ? <LoaderCircle className="animate-spin" size={15} /> : null} Aprobar</Button></div></div>
      </article>)}</div>}
  </div>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function RouterContent({ role, setRole }: { role: Role; setRole: (role: Role) => void }) {
  const auth = useAuth();
  const [location] = useLocation();
  const basePath = import.meta.env?.BASE_URL ?? '/';
  if (auth.isLoading) return <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))]"><LoadingBlock label="Recuperando tu sesión..." /></div>;
  if (!auth.isAuthenticated) return <RoutedErrorBoundary><AuthPage setRole={setRole} /></RoutedErrorBoundary>;
  const effectiveRole: Role = auth.user?.rol === 'admin' ? 'admin' : auth.user?.rol === 'profesional' ? 'professional' : role === 'professional' ? 'professional' : 'client';
  if (location === '/services') return <AppShell role="professional" setRole={setRole}><PartnerProfilePage /></AppShell>;
  return <RoutedErrorBoundary><Switch><Route path="/" component={() => { window.history.replaceState({}, '', `${basePath}home`); return null; }} /><Route path="/home"><AppShell role={effectiveRole} setRole={setRole}><HomePage /></AppShell></Route><Route path="/professional/:id"><AppShell role={effectiveRole} setRole={setRole}><ProfessionalPage /></AppShell></Route><Route path="/admin/verificaciones">{effectiveRole === 'admin' ? <AppShell role="admin" setRole={setRole}><AdminVerificationsPage /></AppShell> : <NotFound />}</Route><Route path="/partner/dashboard"><AppShell role="professional" setRole={setRole}><PartnerDashboard /></AppShell></Route><Route path="/jobs/new"><AppShell role={effectiveRole} setRole={setRole}><NewJobPage /></AppShell></Route><Route path="/jobs"><AppShell role={effectiveRole} setRole={setRole}><JobsPage role={effectiveRole === 'professional' ? 'professional' : 'client'} /></AppShell></Route><Route path="/conversations"><AppShell role={effectiveRole} setRole={setRole}><ConversationsPage /></AppShell></Route><Route path="/chat/:id"><AppShell role={effectiveRole} setRole={setRole}><ChatPage /></AppShell></Route><Route path="/partner"><AppShell role={effectiveRole} setRole={setRole}><PartnerPage /></AppShell></Route><Route path="/profile"><AppShell role={effectiveRole} setRole={setRole}><ProfilePage role={effectiveRole === 'professional' ? 'professional' : 'client'} /></AppShell></Route><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
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

const verificationLabels: Record<VerificationDocument['tipo'], string> = {
  dni_frente: 'DNI — frente', dni_dorso: 'DNI — dorso', antecedentes_penales: 'Antecedentes penales',
};

async function openPrivateDocument(objectPath: string) {
  const response = await fetch(`/api/v1/storage/objects${objectPath}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!response.ok) throw new Error('No pudimos abrir el documento.');
  const url = URL.createObjectURL(await response.blob());
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
