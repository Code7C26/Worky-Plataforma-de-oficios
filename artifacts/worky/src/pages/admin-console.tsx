import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  Activity, BadgeCheck, Banknote, BriefcaseBusiness, CalendarDays,
  Check, ChevronLeft, ChevronRight, CircleAlert, Eye, EyeOff, FileText, Filter,
  LayoutDashboard, LockKeyhole, Menu, Package, RefreshCw, Search, Shield, ShieldAlert,
  Star, Users, X,
} from "lucide-react";
import {
  getGetAdminDashboardQueryKey, getListAdminAccountsQueryKey, getListAdminActivityQueryKey,
  getListAdminBookingsQueryKey, getListAdminCatalogQueryKey, getListAdminJobsQueryKey,
  getListAdminPartnersQueryKey, getListAdminPaymentsQueryKey, getListAdminRecommendationsQueryKey,
  getListAdminResourcesQueryKey, getListAdminReviewsQueryKey, getListAdminSettlementsQueryKey,
  getListAdminVerificationsQueryKey, useCreateAdminCatalogItem, useGetAdminDashboard,
  useListAdminAccounts, useListAdminActivity, useListAdminBookings, useListAdminCatalog,
  useListAdminJobs, useListAdminPartners, useListAdminPayments, useListAdminRecommendations,
  useListAdminResources, useListAdminReviews, useListAdminSettlements, useListAdminVerifications,
  useResolveAdminVerification, useUpdateAdminAccountStatus, useUpdateAdminCatalogItem,
  useUpdateAdminPartnerActivation, useUpdateAdminRecommendationVisibility,
  type AdminAccount, type AdminActivityEvent, type AdminBooking, type AdminCatalogItem, type AdminDashboard,
  type AdminJob, type AdminPartner, type AdminPayment, type AdminRecommendation,
  type AdminResource, type AdminReview, type AdminSettlement, type AdminVerificationDocument,
  type ListAdminPartnersParams, type ListAdminRecommendationsParams,
} from "@workspace/api-client-react";
import { fetchWorkyObject } from "@/lib/api";

type Section = "overview" | "verifications" | "accounts" | "partners" | "jobs" | "bookings" | "payments" | "reviews" | "recommendations" | "catalog" | "resources" | "activity";
type Props = { initialSection?: "overview" | "verifications" };
const PAGE_SIZE = 20;
const sections: { id: Section; label: string; icon: typeof LayoutDashboard; group: string }[] = [
  { id: "overview", label: "Resumen", icon: LayoutDashboard, group: "Operación" },
  { id: "verifications", label: "Verificaciones", icon: Shield, group: "Operación" },
  { id: "accounts", label: "Cuentas", icon: Users, group: "Operación" },
  { id: "partners", label: "Partners", icon: BadgeCheck, group: "Operación" },
  { id: "jobs", label: "Trabajos", icon: BriefcaseBusiness, group: "Marketplace" },
  { id: "bookings", label: "Reservas", icon: CalendarDays, group: "Marketplace" },
  { id: "payments", label: "Pagos y liquidaciones", icon: Banknote, group: "Marketplace" },
  { id: "reviews", label: "Reseñas", icon: Star, group: "Marketplace" },
  { id: "recommendations", label: "Recomendaciones", icon: Eye, group: "Marketplace" },
  { id: "catalog", label: "Catálogo", icon: Package, group: "Configuración" },
  { id: "resources", label: "Recursos", icon: FileText, group: "Configuración" },
  { id: "activity", label: "Actividad", icon: Activity, group: "Configuración" },
];
function date(value?: string | null, time = false) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("es-AR", {
    day: "2-digit", month: "short", year: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(parsed);
}
function money(value: number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}
function bytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
function label(value?: string | null) {
  if (!value) return "Sin dato";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return "No pudimos completar la acción. Volvé a intentar.";
}
function Badge({ children, tone = "neutral", testId }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "blue"; testId?: string }) {
  const colors = { neutral: "bg-[#ece8dc] text-[#4f5a64]", good: "bg-[#dcece2] text-[#276544]", warn: "bg-[#f7e9c8] text-[#8a5a10]", bad: "bg-[#f5dfdb] text-[#a23f35]", blue: "bg-[#e0e8ef] text-[#365c78]" };
  return <span data-testid={testId} className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold leading-none ${colors[tone]}`}>{children}</span>;
}
function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-[#e4dfd2] bg-[#fffdf8] shadow-[0_6px_20px_rgba(34,48,59,.035)] ${className}`}>{children}</section>;
}
function Notice({ message, onDismiss }: { message: { type: "success" | "error"; text: string } | null; onDismiss: () => void }) {
  if (!message) return null;
  const good = message.type === "success";
  return <div data-testid={`notice-${message.type}`} role="status" className={`mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-semibold ${good ? "border-[#b8d7c1] bg-[#e7f2ea] text-[#276544]" : "border-[#e7bbb4] bg-[#fbebe8] text-[#963d34]"}`}>
    <span className="flex items-center gap-2">{good ? <Check size={17} /> : <CircleAlert size={17} />}{message.text}</span>
    <button onClick={onDismiss} aria-label="Cerrar aviso" data-testid="button-dismiss-notice"><X size={16} /></button>
  </div>;
}
function BusyOrError({ loading, error, retry, children }: { loading: boolean; error: unknown; retry: () => void; children: ReactNode }) {
  if (loading) return <Panel className="p-5" ><div role="status" data-testid="state-loading" className="space-y-3"><div className="h-5 w-40 animate-pulse rounded bg-[#eee9dd]" /><div className="h-16 animate-pulse rounded-xl bg-[#f2eee4]" /><div className="h-16 animate-pulse rounded-xl bg-[#f2eee4]" /><span className="sr-only">Cargando información</span></div></Panel>;
  if (error) return <Panel className="flex flex-col items-center p-10 text-center" data-testid="state-error"><CircleAlert className="mb-3 text-[#b1493e]" /><h3 className="font-bold">No se pudo cargar esta sección</h3><p className="mt-1 text-sm text-[#68747d]">{errorText(error)}</p><button onClick={retry} data-testid="button-retry" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#d8d2c4] px-3 py-2 text-sm font-bold hover:bg-[#f3efe5]"><RefreshCw size={15} /> Reintentar</button></Panel>;
  return <>{children}</>;
}
function Empty({ text }: { text: string }) {
  return <div data-testid="state-empty" className="px-5 py-12 text-center text-sm text-[#737d83]"><div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#f1ede3] text-[#68747d]"><Filter size={18} /></div>{text}</div>;
}
function Table({ headers, children, testId }: { headers: string[]; children: ReactNode; testId: string }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm" data-testid={testId}><thead className="border-b border-[#e9e4d9] bg-[#f8f5ed] text-[10px] uppercase tracking-[.12em] text-[#69747b]"><tr>{headers.map((head) => <th key={head} className="px-4 py-3 font-bold">{head}</th>)}</tr></thead><tbody className="divide-y divide-[#eee9de]">{children}</tbody></table></div>;
}
function Cell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}
function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <div className="flex items-center justify-between gap-3 border-t border-[#eee9de] px-4 py-3 text-xs text-[#68747d]" data-testid="pagination">
    <span data-testid="text-pagination-count">{total ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} de ${total}` : "0 resultados"}</span>
    <div className="flex items-center gap-2">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="button-page-previous" className="rounded-lg border border-[#dfd9cc] p-2 disabled:opacity-35"><ChevronLeft size={16} /></button>
      <span className="min-w-16 text-center font-semibold" data-testid="text-page-number">Página {page} / {pages}</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid="button-page-next" className="rounded-lg border border-[#dfd9cc] p-2 disabled:opacity-35"><ChevronRight size={16} /></button>
    </div>
  </div>;
}

export function AdminConsolePage({ initialSection = "overview" }: Props) {
  const client = useQueryClient();
  const [section, setSection] = useState<Section>(initialSection);
  const [mobileNav, setMobileNav] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [reasonDialog, setReasonDialog] = useState<{ title: string; detail: string; onSubmit: (reason: string) => void } | null>(null);
  const [reason, setReason] = useState("");
  const [catalogEditing, setCatalogEditing] = useState<AdminCatalogItem | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogCategory, setCatalogCategory] = useState("");
  const [catalogSpecialty, setCatalogSpecialty] = useState("");
  const [docViewer, setDocViewer] = useState<{ url: string; type: string; title: string } | null>(null);
  const [docLoading, setDocLoading] = useState<number | null>(null);
  const [docError, setDocError] = useState("");
  const is = (target: Section) => section === target;
  const params = useMemo(() => ({ ...(search.trim() ? { search: search.trim() } : {}), page, limit: PAGE_SIZE }), [search, page]);
  const accountParams = useMemo(() => ({ ...params, ...(roleFilter ? { role: roleFilter as "cliente" | "profesional" | "admin" } : {}), ...(status ? { active: status === "active" } : {}) }), [params, roleFilter, status]);
  const partnerParams = useMemo<ListAdminPartnersParams>(() => ({ ...params, ...(status === "pending_verification" || status === "verified" || status === "rejected" ? { verificationStatus: status } : {}), ...(status === "enabled" || status === "disabled" ? { enabled: status === "enabled" } : {}) }), [params, status]);
  const stateParams = useMemo(() => ({ ...params, ...(status ? { status } : {}) }), [params, status]);
  const recommendationParams = useMemo<ListAdminRecommendationsParams>(() => ({ ...params, ...(status === "publica" || status === "privada" ? { visibility: status } : {}) }), [params, status]);

  const dashboard = useGetAdminDashboard({ query: { queryKey: getGetAdminDashboardQueryKey(), enabled: is("overview"), staleTime: 30_000, refetchOnMount: "always" } });
  const accounts = useListAdminAccounts(accountParams, { query: { queryKey: getListAdminAccountsQueryKey(accountParams), enabled: is("accounts"), staleTime: 15_000, refetchOnMount: "always" } });
  const partners = useListAdminPartners(partnerParams, { query: { queryKey: getListAdminPartnersQueryKey(partnerParams), enabled: is("partners"), staleTime: 15_000, refetchOnMount: "always" } });
  const jobs = useListAdminJobs(stateParams, { query: { queryKey: getListAdminJobsQueryKey(stateParams), enabled: is("jobs"), staleTime: 15_000, refetchOnMount: "always" } });
  const bookings = useListAdminBookings(stateParams, { query: { queryKey: getListAdminBookingsQueryKey(stateParams), enabled: is("bookings"), staleTime: 15_000, refetchOnMount: "always" } });
  const payments = useListAdminPayments(stateParams, { query: { queryKey: getListAdminPaymentsQueryKey(stateParams), enabled: is("payments"), staleTime: 15_000, refetchOnMount: "always" } });
  const settlements = useListAdminSettlements(stateParams, { query: { queryKey: getListAdminSettlementsQueryKey(stateParams), enabled: is("payments"), staleTime: 15_000, refetchOnMount: "always" } });
  const reviews = useListAdminReviews(params, { query: { queryKey: getListAdminReviewsQueryKey(params), enabled: is("reviews"), staleTime: 15_000, refetchOnMount: "always" } });
  const recommendations = useListAdminRecommendations(recommendationParams, { query: { queryKey: getListAdminRecommendationsQueryKey(recommendationParams), enabled: is("recommendations"), staleTime: 15_000, refetchOnMount: "always" } });
  const catalog = useListAdminCatalog({ query: { queryKey: getListAdminCatalogQueryKey(), enabled: is("catalog"), staleTime: 15_000, refetchOnMount: "always" } });
  const resources = useListAdminResources(params, { query: { queryKey: getListAdminResourcesQueryKey(params), enabled: is("resources"), staleTime: 15_000, refetchOnMount: "always" } });
  const activityParams = useMemo(() => ({ page, limit: PAGE_SIZE }), [page]);
  const activity = useListAdminActivity(activityParams, { query: { queryKey: getListAdminActivityQueryKey(activityParams), enabled: is("activity"), staleTime: 15_000, refetchOnMount: "always" } });
  const verifications = useListAdminVerifications({ estado: "pending_verification" }, { query: { queryKey: getListAdminVerificationsQueryKey({ estado: "pending_verification" }), enabled: is("verifications"), staleTime: 10_000, refetchOnMount: "always" } });

  const accountMutation = useUpdateAdminAccountStatus();
  const partnerMutation = useUpdateAdminPartnerActivation();
  const recommendationMutation = useUpdateAdminRecommendationVisibility();
  const createCatalogMutation = useCreateAdminCatalogItem();
  const updateCatalogMutation = useUpdateAdminCatalogItem();
  const verificationMutation = useResolveAdminVerification();
  const mutationBusy = accountMutation.isPending || partnerMutation.isPending || recommendationMutation.isPending || createCatalogMutation.isPending || updateCatalogMutation.isPending || verificationMutation.isPending;

  useEffect(() => {
    setPage(1);
    setSearch("");
    setStatus("");
    setRoleFilter("");
  }, [section]);
  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);
  useEffect(() => {
    if (!docViewer) return;
    return () => URL.revokeObjectURL(docViewer.url);
  }, [docViewer]);

  const invalidateOperational = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() }),
      client.invalidateQueries({ queryKey: getListAdminAccountsQueryKey() }),
      client.invalidateQueries({ queryKey: getListAdminPartnersQueryKey() }),
      client.invalidateQueries({ queryKey: getListAdminJobsQueryKey() }),
      client.invalidateQueries({ queryKey: getListAdminBookingsQueryKey() }),
      client.invalidateQueries({ queryKey: getListAdminPaymentsQueryKey() }),
      client.invalidateQueries({ queryKey: getListAdminSettlementsQueryKey() }),
      client.invalidateQueries({ queryKey: getListAdminReviewsQueryKey() }),
      client.invalidateQueries({ queryKey: getListAdminRecommendationsQueryKey() }),
      client.invalidateQueries({ queryKey: getListAdminCatalogQueryKey() }),
      client.invalidateQueries({ queryKey: getListAdminResourcesQueryKey() }),
      client.invalidateQueries({ queryKey: getListAdminActivityQueryKey() }),
      client.invalidateQueries({ queryKey: getListAdminVerificationsQueryKey() }),
    ]);
  };
  const success = (text: string) => { setNotice({ type: "success", text }); void invalidateOperational(); };
  const failure = (error: unknown) => setNotice({ type: "error", text: errorText(error) });
  const resetFilters = () => { setPage(1); setSearch(""); setStatus(""); setRoleFilter(""); };
  const openReason = (title: string, detail: string, action: (value: string) => void) => {
    setReason(""); setReasonDialog({ title, detail, onSubmit: action });
  };
  const showDocument = async (document: AdminVerificationDocument) => {
    setDocLoading(document.id); setDocError("");
    try {
      const blob = await fetchWorkyObject(document.objectPath);
      const url = URL.createObjectURL(blob);
      setDocViewer({ url, type: document.contentType || blob.type, title: `${label(document.tipo)} · ${document.partner.nombre}` });
    } catch (error) { setDocError(errorText(error)); }
    finally { setDocLoading(null); }
  };
  const resolveVerification = (doc: AdminVerificationDocument, estado: "verified" | "rejected") => {
    const go = (motivo: string) => verificationMutation.mutate({ id: doc.id, data: { estado, motivo } }, {
      onSuccess: () => { setReasonDialog(null); success(estado === "verified" ? "Documento aprobado." : "Documento rechazado."); },
      onError: failure,
    });
    if (estado === "rejected") openReason("Rechazar documento", `Indicá el motivo para ${doc.partner.nombre}.`, go);
    else openReason("Aprobar documento", `Confirmá la revisión de ${doc.nombre}. Dejá un motivo para el registro.`, go);
  };
  const openCatalogForm = (item?: AdminCatalogItem) => {
    setCatalogEditing(item ?? null);
    setCatalogCategory(item?.category ?? "");
    setCatalogSpecialty(item?.specialty ?? "");
    setCatalogOpen(true);
  };
  const submitCatalog = (event: FormEvent) => {
    event.preventDefault();
    if (!catalogCategory.trim() || !catalogSpecialty.trim()) return;
    if (catalogEditing) {
      updateCatalogMutation.mutate({ id: catalogEditing.id, data: { category: catalogCategory.trim(), specialty: catalogSpecialty.trim() } }, {
        onSuccess: () => { setCatalogOpen(false); success("Servicio actualizado."); }, onError: failure,
      });
    } else {
      createCatalogMutation.mutate({ data: { category: catalogCategory.trim(), specialty: catalogSpecialty.trim() } }, {
        onSuccess: () => { setCatalogOpen(false); success("Servicio creado."); }, onError: failure,
      });
    }
  };
  const title = sections.find((item) => item.id === section)?.label ?? "Resumen";
  const pageHeader = <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
    <div><div className="eyebrow">Worky · Administración</div><h1 className="mt-1 text-[2rem] font-bold tracking-[-.045em] text-[#23333d]" data-testid="text-section-title">{title}</h1><p className="mt-1 text-sm text-[#68747d]">Un puesto de control para cuidar cada operación.</p></div>
    <div className="flex items-center gap-2 text-xs font-semibold text-[#68747d]" data-testid="text-console-scope"><span className="h-2 w-2 rounded-full bg-[#4b9469]" /> Datos operativos · acceso interno</div>
  </div>;
  const filterBar = (hasStatus = true, statusOptions: [string, string][] = []) => <div className="mb-4 flex flex-col gap-2 sm:flex-row">
    <label className="relative min-w-0 flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7c8589]" /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar por nombre, correo o referencia" className="field !min-h-10 !rounded-lg !py-2 !pl-9 !text-sm" data-testid={`input-search-${section}`} /></label>
    {hasStatus && statusOptions.length > 0 && <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="field !min-h-10 !w-full !rounded-lg !py-2 !text-sm sm:!w-48" data-testid={`select-status-${section}`}><option value="">Todos los estados</option>{statusOptions.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>}
    {(search || status || roleFilter) && <button onClick={resetFilters} className="rounded-lg border border-[#ded8ca] px-3 py-2 text-sm font-semibold hover:bg-[#f3efe5]" data-testid={`button-clear-filters-${section}`}>Limpiar</button>}
  </div>;
  const paginated = (data: { total: number } | undefined) => <Pager page={page} total={data?.total ?? 0} onPage={setPage} />;
  const sectionRows = <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
    {pageHeader}<Notice message={notice} onDismiss={() => setNotice(null)} />
    {is("overview") && <Overview query={dashboard} onGo={setSection} />}
    {is("accounts") && <BusyOrError loading={accounts.isLoading} error={accounts.error} retry={() => void accounts.refetch()}>
      <Panel className="overflow-hidden"><div className="border-b border-[#eee9de] p-4">{filterBar(false)}<div className="flex flex-wrap gap-2">
        <select value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPage(1); }} className="field !min-h-9 !w-auto !rounded-lg !py-1.5 !text-xs" data-testid="select-account-role"><option value="">Todos los perfiles</option><option value="cliente">Cliente</option><option value="profesional">Partner</option><option value="admin">Administración</option></select>
        <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="field !min-h-9 !w-auto !rounded-lg !py-1.5 !text-xs" data-testid="select-status-accounts"><option value="">Todos los estados</option><option value="active">Activas</option><option value="inactive">Suspendidas</option></select>
      </div></div>
      {!accounts.data?.items.length ? <Empty text="No hay cuentas que coincidan con esta búsqueda." /> : <Table headers={["Cuenta", "Perfil", "Alta", "Ciudad", "Estado", "Acción"]} testId="table-admin-accounts">{accounts.data.items.map((item: AdminAccount) => <tr key={item.id} data-testid={`row-account-${item.id}`}><Cell><div className="font-bold text-[#293a44]">{item.name}</div><div className="text-xs text-[#748087]">{item.email}</div></Cell><Cell><Badge tone="blue">{label(item.role)}</Badge></Cell><Cell>{date(item.createdAt)}</Cell><Cell>{item.city || "—"}</Cell><Cell><Badge tone={item.active ? "good" : "bad"} testId={`status-account-${item.id}`}>{item.active ? "Activa" : "Suspendida"}</Badge></Cell><Cell><button disabled={item.role === "admin" || mutationBusy} onClick={() => openReason(item.active ? "Suspender cuenta" : "Reactivar cuenta", `El cambio quedará registrado en la auditoría para ${item.name}.`, (why) => accountMutation.mutate({ id: item.id, data: { active: !item.active, reason: why } }, { onSuccess: () => { setReasonDialog(null); success(item.active ? "Cuenta suspendida." : "Cuenta reactivada."); }, onError: failure }))} className="rounded-lg border border-[#ded8ca] px-3 py-1.5 text-xs font-bold disabled:opacity-40" data-testid={`button-account-toggle-${item.id}`}>{item.active ? "Suspender" : "Reactivar"}</button></Cell></tr>)}</Table>}{paginated(accounts.data)}</Panel>
    </BusyOrError>}
    {is("partners") && <BusyOrError loading={partners.isLoading} error={partners.error} retry={() => void partners.refetch()}>
      <Panel className="overflow-hidden"><div className="border-b border-[#eee9de] p-4">{filterBar(true, [["pending_verification", "Pendiente"], ["verified", "Verificado"], ["rejected", "Rechazado"], ["enabled", "Habilitado"], ["disabled", "Suspendido"]])}</div>
      {!partners.data?.items.length ? <Empty text="No hay Partners para los filtros elegidos." /> : <Table headers={["Partner", "Servicio", "Verificación", "Cuenta", "Perfil", "Documentos", "Control"]} testId="table-admin-partners">{partners.data.items.map((item: AdminPartner) => <tr key={item.userId} data-testid={`row-partner-${item.userId}`}><Cell><div className="font-bold">{item.name}</div><div className="text-xs text-[#748087]">{item.email}</div></Cell><Cell>{item.trade}<div className="text-xs text-[#748087]">{item.category}</div></Cell><Cell><Badge tone={item.verified ? "good" : item.verificationStatus === "rejected" ? "bad" : "warn"}>{label(item.verificationStatus)}</Badge></Cell><Cell><Badge tone={item.accountActive ? "good" : "bad"}>{item.accountActive ? "Activa" : "Suspendida"}</Badge></Cell><Cell><Badge tone={item.enabled ? "good" : "neutral"}>{item.enabled ? "Habilitado" : "Suspendido"}</Badge></Cell><Cell>{item.documents.length} archivo{item.documents.length === 1 ? "" : "s"}</Cell><Cell><button disabled={mutationBusy || (!item.enabled && (!item.verified || !item.accountActive))} onClick={() => openReason(item.enabled ? "Suspender Partner" : "Habilitar Partner", "Solo se habilita con documentación verificada y cuenta activa. El motivo se guarda en la auditoría.", (why) => partnerMutation.mutate({ id: item.userId, data: { enabled: !item.enabled, reason: why } }, { onSuccess: () => { setReasonDialog(null); success(item.enabled ? "Partner suspendido." : "Partner habilitado."); }, onError: failure }))} title={!item.enabled && (!item.verified || !item.accountActive) ? "Requiere documentación verificada y cuenta activa" : ""} className="rounded-lg border border-[#ded8ca] px-3 py-1.5 text-xs font-bold disabled:opacity-40" data-testid={`button-partner-toggle-${item.userId}`}>{item.enabled ? "Suspender" : "Habilitar"}</button></Cell></tr>)}</Table>}{paginated(partners.data)}
      <p className="border-t border-[#eee9de] px-4 py-3 text-xs text-[#68747d]">Habilitar requiere documentos verificados y una cuenta activa. La disponibilidad del Partner no se modifica desde aquí.</p></Panel>
    </BusyOrError>}
    {is("verifications") && <VerificationQueue query={verifications} busy={mutationBusy || docLoading !== null} docLoading={docLoading} docError={docError} onOpen={showDocument} onResolve={resolveVerification} />}
    {is("jobs") && <BusyOrError loading={jobs.isLoading} error={jobs.error} retry={() => void jobs.refetch()}><Panel className="overflow-hidden"><div className="p-4">{filterBar(true, [["publicada", "Publicada"], ["aceptada", "Aceptada"], ["en_curso", "En curso"], ["finalizada", "Finalizada"], ["cancelada", "Cancelada"]])}</div>{!jobs.data?.items.length ? <Empty text="No hay trabajos para mostrar." /> : <Table headers={["Trabajo", "Estado", "Cliente", "Partner", "Oferta", "Creado"]} testId="table-admin-jobs">{jobs.data.items.map((item: AdminJob) => <tr key={item.id} data-testid={`row-job-${item.id}`}><Cell><b>#{item.id} · {item.category}</b>{item.detail && <div className="max-w-[260px] truncate text-xs text-[#748087]">{item.detail}</div>}</Cell><Cell><Badge tone={item.status === "completed" || item.status === "finalizada" ? "good" : item.status === "cancelled" || item.status === "cancelada" ? "bad" : "blue"} testId={`status-job-${item.id}`}>{label(item.status)}</Badge></Cell><Cell>{item.clientName}</Cell><Cell>{item.partnerName || "Sin asignar"}</Cell><Cell>{money(item.offeredPrice)}</Cell><Cell>{date(item.createdAt)}</Cell></tr>)}</Table>}{paginated(jobs.data)}</Panel></BusyOrError>}
    {is("bookings") && <BusyOrError loading={bookings.isLoading} error={bookings.error} retry={() => void bookings.refetch()}><Panel className="overflow-hidden"><div className="p-4">{filterBar(true, [["solicitada", "Solicitada"], ["confirmada", "Confirmada"], ["en_curso", "En curso"], ["completada", "Completada"], ["cancelada", "Cancelada"]])}</div>{!bookings.data?.items.length ? <Empty text="No hay reservas para mostrar." /> : <Table headers={["Reserva", "Estado", "Cliente", "Partner", "Inicio", "Fin"]} testId="table-admin-bookings">{bookings.data.items.map((item: AdminBooking) => <tr key={item.id} data-testid={`row-booking-${item.id}`}><Cell><b>#{item.id}</b><div className="text-xs text-[#748087]">Trabajo #{item.jobId}</div></Cell><Cell><Badge tone="blue" testId={`status-booking-${item.id}`}>{label(item.status)}</Badge></Cell><Cell>{item.clientName}</Cell><Cell>{item.partnerName}</Cell><Cell>{date(item.startsAt, true)}</Cell><Cell>{date(item.endsAt, true)}</Cell></tr>)}</Table>}{paginated(bookings.data)}</Panel></BusyOrError>}
    {is("payments") && <div className="space-y-4">
      <ReadOnlyList title="Pagos" loading={payments.isLoading} error={payments.error} retry={() => void payments.refetch()} empty={!payments.data?.items.length} emptyText="No hay pagos para mostrar." pager={paginated(payments.data)}><Table headers={["Pago", "Trabajo", "Cliente", "Importe", "Estado", "Proveedor", "Actualizado"]} testId="table-admin-payments">{payments.data?.items.map((item: AdminPayment) => <tr key={item.id} data-testid={`row-payment-${item.id}`}><Cell><b>#{item.id}</b></Cell><Cell>#{item.jobId}</Cell><Cell>{item.clientName}</Cell><Cell>{money(item.amount, item.currency)}</Cell><Cell><Badge tone="blue" testId={`status-payment-${item.id}`}>{label(item.status)}</Badge></Cell><Cell>{label(item.provider)}</Cell><Cell>{date(item.updatedAt)}</Cell></tr>)}</Table></ReadOnlyList>
      <ReadOnlyList title="Liquidaciones" loading={settlements.isLoading} error={settlements.error} retry={() => void settlements.refetch()} empty={!settlements.data?.items.length} emptyText="No hay liquidaciones para mostrar." pager={paginated(settlements.data)}><Table headers={["Liquidación", "Trabajo", "Partner", "Importe", "Estado", "Actualizado"]} testId="table-admin-settlements">{settlements.data?.items.map((item: AdminSettlement) => <tr key={item.id} data-testid={`row-settlement-${item.id}`}><Cell><b>#{item.id}</b></Cell><Cell>#{item.jobId}</Cell><Cell>{item.partnerName}</Cell><Cell>{money(item.amount)}</Cell><Cell><Badge tone="blue" testId={`status-settlement-${item.id}`}>{label(item.status)}</Badge></Cell><Cell>{date(item.updatedAt)}</Cell></tr>)}</Table></ReadOnlyList>
      <p className="flex items-center gap-2 text-xs text-[#68747d]" data-testid="text-payments-readonly"><LockKeyhole size={14} /> Vista de solo lectura. No se modifican pagos ni resultados de liquidación.</p>
    </div>}
    {is("reviews") && <BusyOrError loading={reviews.isLoading} error={reviews.error} retry={() => void reviews.refetch()}><Panel className="overflow-hidden"><div className="p-4">{filterBar(false)}</div>{!reviews.data?.items.length ? <Empty text="Todavía no hay reseñas para mostrar." /> : <Table headers={["Reseña", "Puntaje", "Cliente", "Partner", "Comentario", "Fecha"]} testId="table-admin-reviews">{reviews.data.items.map((item: AdminReview) => <tr key={item.id} data-testid={`row-review-${item.id}`}><Cell><b>#{item.id}</b><div className="text-xs text-[#748087]">Trabajo #{item.jobId}</div></Cell><Cell><span className="inline-flex items-center gap-1 font-bold"><Star size={14} className="fill-[#df9c35] text-[#df9c35]" />{item.rating}</span></Cell><Cell>{item.clientName}</Cell><Cell>{item.partnerName}</Cell><Cell className="max-w-[260px] truncate">{item.comment || "Sin comentario"}</Cell><Cell>{date(item.createdAt)}</Cell></tr>)}</Table>}{paginated(reviews.data)}<p className="border-t border-[#eee9de] px-4 py-3 text-xs text-[#68747d]">Reseñas en modo lectura. No se muestran adjuntos.</p></Panel></BusyOrError>}
    {is("recommendations") && <BusyOrError loading={recommendations.isLoading} error={recommendations.error} retry={() => void recommendations.refetch()}><Panel className="overflow-hidden"><div className="p-4">{filterBar(true, [["publica", "Pública"], ["privada", "Privada"]])}</div>{!recommendations.data?.items.length ? <Empty text="No hay recomendaciones para mostrar." /> : <Table headers={["Recomendación", "Cliente", "Partner", "Visibilidad", "Texto", "Fecha", "Acción"]} testId="table-admin-recommendations">{recommendations.data.items.map((item: AdminRecommendation) => <tr key={item.id} data-testid={`row-recommendation-${item.id}`}><Cell><b>#{item.id}</b></Cell><Cell>{item.clientName}</Cell><Cell>{item.partnerName}</Cell><Cell><Badge tone={item.visibility === "publica" ? "good" : "neutral"} testId={`status-recommendation-${item.id}`}>{item.visibility === "publica" ? "Pública" : "Privada"}</Badge></Cell><Cell className="max-w-[240px] truncate">{item.comment || "Sin comentario"}</Cell><Cell>{date(item.updatedAt)}</Cell><Cell><button disabled={mutationBusy} onClick={() => openReason(item.visibility === "publica" ? "Ocultar recomendación" : "Publicar recomendación", "El cambio de visibilidad requiere un motivo y se registra en la auditoría.", (why) => recommendationMutation.mutate({ id: item.id, data: { visibility: item.visibility === "publica" ? "privada" : "publica", reason: why } }, { onSuccess: () => { setReasonDialog(null); success("Visibilidad actualizada."); }, onError: failure }))} className="inline-flex items-center gap-1 rounded-lg border border-[#ded8ca] px-2.5 py-1.5 text-xs font-bold" data-testid={`button-recommendation-visibility-${item.id}`}>{item.visibility === "publica" ? <><EyeOff size={13} /> Hacer privada</> : <><Eye size={13} /> Hacer pública</>}</button></Cell></tr>)}</Table>}{paginated(recommendations.data)}</Panel></BusyOrError>}
    {is("catalog") && <BusyOrError loading={catalog.isLoading} error={catalog.error} retry={() => void catalog.refetch()}><Panel className="overflow-hidden"><div className="flex flex-col gap-3 border-b border-[#eee9de] p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold">Servicios y especialidades</h2><p className="text-xs text-[#68747d]">La activación controla la disponibilidad pública en el catálogo.</p></div><button onClick={() => openCatalogForm()} className="inline-flex items-center justify-center rounded-lg bg-[#e87836] px-4 py-2 text-sm font-bold text-white hover:bg-[#d9682c]" data-testid="button-catalog-create">Nuevo servicio</button></div>{!catalog.data?.length ? <Empty text="El catálogo todavía no tiene servicios." /> : <Table headers={["Categoría", "Especialidad", "Estado", "Actualizado", "Acciones"]} testId="table-admin-catalog">{catalog.data.map((item: AdminCatalogItem) => <tr key={item.id} data-testid={`row-catalog-${item.id}`}><Cell><b>{item.category}</b></Cell><Cell>{item.specialty}</Cell><Cell><Badge tone={item.active ? "good" : "neutral"} testId={`status-catalog-${item.id}`}>{item.active ? "Activo" : "Inactivo"}</Badge></Cell><Cell>{date(item.updatedAt)}</Cell><Cell><div className="flex gap-2"><button onClick={() => openCatalogForm(item)} className="rounded-lg border border-[#ded8ca] px-2.5 py-1.5 text-xs font-bold" data-testid={`button-catalog-edit-${item.id}`}>Editar</button><button disabled={mutationBusy} onClick={() => updateCatalogMutation.mutate({ id: item.id, data: { active: !item.active } }, { onSuccess: () => success(item.active ? "Servicio desactivado." : "Servicio activado."), onError: failure })} className="rounded-lg border border-[#ded8ca] px-2.5 py-1.5 text-xs font-bold" data-testid={`button-catalog-toggle-${item.id}`}>{item.active ? "Desactivar" : "Activar"}</button></div></Cell></tr>)}</Table>}</Panel></BusyOrError>}
    {is("resources") && <BusyOrError loading={resources.isLoading} error={resources.error} retry={() => void resources.refetch()}><Panel className="overflow-hidden"><div className="p-4">{filterBar(false)}</div>{!resources.data?.items.length ? <Empty text="No hay recursos cargados." /> : <Table headers={["Recurso", "Propietario", "Tipo", "Formato", "Tamaño", "Fecha"]} testId="table-admin-resources">{resources.data.items.map((item: AdminResource) => <tr key={`${item.kind}-${item.id}`} data-testid={`row-resource-${item.kind}-${item.id}`}><Cell><b>{item.name}</b><div className="text-xs text-[#748087]">Recurso #{item.id}</div></Cell><Cell>{item.ownerName}</Cell><Cell>{item.kind === "portfolio" ? "Portfolio" : "Foto de perfil"}</Cell><Cell>{item.contentType}</Cell><Cell>{item.sizeBytes === null ? "No disponible" : bytes(item.sizeBytes)}</Cell><Cell>{date(item.createdAt)}</Cell></tr>)}</Table>}{paginated(resources.data)}<p className="border-t border-[#eee9de] px-4 py-3 text-xs text-[#68747d]">Solo metadatos. No se muestran ni se abren rutas privadas de archivos.</p></Panel></BusyOrError>}
    {is("activity") && <BusyOrError loading={activity.isLoading} error={activity.error} retry={() => void activity.refetch()}><Panel className="overflow-hidden"><div className="flex items-center justify-between border-b border-[#eee9de] px-4 py-3"><h2 className="font-bold">Registro de auditoría</h2><span className="text-xs text-[#68747d]">Eventos administrativos · lectura</span></div>{!activity.data?.items.length ? <Empty text="No hay eventos de actividad para mostrar." /> : <Table headers={["Momento", "Actor", "Entidad", "Acción", "Cambio"]} testId="table-admin-activity">{activity.data.items.map((item: AdminActivityEvent) => <tr key={item.id} data-testid={`row-activity-${item.id}`}><Cell>{date(item.createdAt, true)}</Cell><Cell>{item.actorName || "Sistema"}</Cell><Cell>{label(item.entity)} <span className="text-xs text-[#748087]">#{item.entityId}</span></Cell><Cell>{label(item.action)}</Cell><Cell>{item.previousState || "—"}{item.previousState && item.nextState ? " → " : ""}{item.nextState || ""}</Cell></tr>)}</Table>}{paginated(activity.data)}<p className="border-t border-[#eee9de] px-4 py-3 text-xs text-[#68747d]">Se omiten detalles internos de metadatos para proteger información sensible.</p></Panel></BusyOrError>}
  </main>;

  return <div className="min-h-[100dvh] bg-[#f5f2e9] text-[#293a44]" data-testid="admin-console">
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#e4dfd2] bg-[#fbf9f2]/95 px-4 backdrop-blur sm:hidden">
      <div className="flex items-center gap-2 font-bold tracking-tight"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#233a49] text-[#f3b252]">W</span> Worky <span className="text-xs font-medium text-[#7b8589]">Admin</span></div>
      <button onClick={() => setMobileNav(!mobileNav)} aria-label="Abrir navegación" data-testid="button-mobile-nav" className="rounded-lg border border-[#ded8ca] p-2"><Menu size={18} /></button>
    </header>
    <div className="mx-auto flex min-h-[100dvh] max-w-[1680px]">
      <aside className={`${mobileNav ? "fixed inset-y-14 left-0 z-40 flex shadow-xl" : "hidden"} w-[268px] shrink-0 flex-col bg-[#243b49] px-4 pb-5 pt-5 text-[#e9eee9] sm:sticky sm:top-0 sm:flex sm:h-[100dvh]`}>
        <div className="mb-8 hidden items-center gap-3 px-2 sm:flex"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#e87836] font-bold text-[#253b48]">W</div><div><div className="font-bold tracking-tight">Worky</div><div className="text-[10px] uppercase tracking-[.18em] text-[#aebdbd]">Control desk</div></div></div>
        <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-[#9eafae]">Consola interna</div>
        {["Operación", "Marketplace", "Configuración"].map((group) => <div key={group} className="mb-4"><div className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[.15em] text-[#819594]">{group}</div>{sections.filter((item) => item.group === group).map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => { setSection(item.id); setMobileNav(false); }} className={`mb-0.5 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition-colors ${is(item.id) ? "bg-[#e87836] text-[#243b49]" : "text-[#d8e1dd] hover:bg-[#ffffff12]"}`} data-testid={`nav-admin-${item.id}`}><Icon size={16} />{item.label}{item.id === "verifications" && dashboard.data?.partnersPendingReview ? <span className="ml-auto rounded-full bg-[#f1ba64] px-2 py-0.5 text-[10px] font-bold text-[#293a44]">{dashboard.data.partnersPendingReview}</span> : null}</button>; })}</div>)}
        <div className="mt-auto rounded-xl border border-[#ffffff1c] bg-[#ffffff08] p-3"><div className="flex items-center gap-2 text-xs font-bold"><Shield size={14} className="text-[#edaa55]" /> Acceso de administración</div><p className="mt-1 text-[11px] leading-relaxed text-[#aebdbd]">Las decisiones críticas requieren un motivo y quedan auditadas.</p></div>
      </aside>
      {sectionRows}
    </div>
    {reasonDialog && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#15242dcc] p-4" role="presentation"><form onSubmit={(event) => { event.preventDefault(); if (reason.trim().length < 5) return; reasonDialog.onSubmit(reason.trim()); }} className="w-full max-w-md rounded-2xl border border-[#e5dfd1] bg-[#fffdf8] p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="reason-title" data-testid="dialog-reason"><div className="flex items-start justify-between"><div><div className="eyebrow">Acción registrada</div><h2 id="reason-title" className="mt-1 text-xl font-bold">{reasonDialog.title}</h2></div><button type="button" onClick={() => setReasonDialog(null)} aria-label="Cerrar" data-testid="button-close-reason"><X size={18} /></button></div><p className="mt-2 text-sm text-[#68747d]">{reasonDialog.detail}</p><label className="label mt-4" htmlFor="admin-reason">Motivo (mínimo 5 caracteres)</label><textarea id="admin-reason" value={reason} onChange={(event) => setReason(event.target.value)} required minLength={5} maxLength={1000} className="field !min-h-28 resize-y" data-testid="input-admin-reason" placeholder="Escribí el motivo para el registro de auditoría" /><div className="mt-1 text-right text-[11px] text-[#748087]">{reason.length}/1000</div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setReasonDialog(null)} className="rounded-lg border border-[#ded8ca] px-3 py-2 text-sm font-bold" data-testid="button-cancel-reason">Cancelar</button><button disabled={reason.trim().length < 5 || mutationBusy} className="rounded-lg bg-[#243b49] px-4 py-2 text-sm font-bold text-white disabled:opacity-45" data-testid="button-confirm-reason">{mutationBusy ? "Guardando…" : "Confirmar cambio"}</button></div></form></div>}
    {catalogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#15242dcc] p-4"><form onSubmit={submitCatalog} className="w-full max-w-md rounded-2xl bg-[#fffdf8] p-5 shadow-2xl" role="dialog" aria-modal="true" data-testid="dialog-catalog"><div className="flex items-start justify-between"><div><div className="eyebrow">Catálogo de servicios</div><h2 className="mt-1 text-xl font-bold">{catalogEditing ? "Editar servicio" : "Nuevo servicio"}</h2></div><button type="button" onClick={() => setCatalogOpen(false)} aria-label="Cerrar" data-testid="button-close-catalog"><X size={18} /></button></div><label className="label mt-5" htmlFor="catalog-category">Categoría</label><input id="catalog-category" required maxLength={100} value={catalogCategory} onChange={(event) => setCatalogCategory(event.target.value)} className="field" data-testid="input-catalog-category" /><label className="label mt-4" htmlFor="catalog-specialty">Especialidad</label><input id="catalog-specialty" required maxLength={120} value={catalogSpecialty} onChange={(event) => setCatalogSpecialty(event.target.value)} className="field" data-testid="input-catalog-specialty" /><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setCatalogOpen(false)} className="rounded-lg border border-[#ded8ca] px-3 py-2 text-sm font-bold" data-testid="button-cancel-catalog">Cancelar</button><button disabled={mutationBusy} className="rounded-lg bg-[#e87836] px-4 py-2 text-sm font-bold text-white disabled:opacity-45" data-testid="button-save-catalog">{mutationBusy ? "Guardando…" : "Guardar"}</button></div></form></div>}
    {docViewer && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#15242de8] p-3 sm:p-6"><div className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-[#fffdf8] shadow-2xl" role="dialog" aria-modal="true" aria-label="Vista previa de documento" data-testid="dialog-document-viewer"><div className="flex items-center justify-between border-b border-[#e4dfd2] px-4 py-3"><div className="min-w-0"><div className="eyebrow">Documento privado · revisión autenticada</div><div className="truncate text-sm font-bold">{docViewer.title}</div></div><button onClick={() => setDocViewer(null)} aria-label="Cerrar documento" className="rounded-lg border border-[#ded8ca] p-2" data-testid="button-close-document"><X size={17} /></button></div><div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#e8e6df] p-3">{docViewer.type.startsWith("image/") ? <img src={docViewer.url} alt="Documento de verificación" className="max-h-[75dvh] max-w-full object-contain" data-testid="image-private-document" /> : <iframe title={docViewer.title} src={docViewer.url} className="h-[75dvh] w-full rounded-lg bg-white" data-testid="frame-private-document" />}</div></div></div>}
    {docError && !docViewer && <div className="fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-[#e7bbb4] bg-[#fbebe8] p-4 text-sm text-[#963d34] shadow-xl" role="alert" data-testid="error-document"><CircleAlert size={18} /><span>{docError}</span><button onClick={() => setDocError("")} aria-label="Cerrar aviso" data-testid="button-dismiss-document-error"><X size={16} /></button></div>}
  </div>;
}

function Overview({ query, onGo }: { query: UseQueryResult<AdminDashboard>; onGo: (section: Section) => void }) {
  const data = query.data;
  return <BusyOrError loading={query.isLoading} error={query.error} retry={() => void query.refetch()}>
    {data && <div className="space-y-5" data-testid="overview-content">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Cuentas activas" value={data.accountsActive} caption={`${data.accountsTotal} totales`} accent="orange" />
        <Metric label="Partners pendientes" value={data.partnersPendingReview} caption={`${data.partnersVerified} verificados`} accent="gold" onClick={() => onGo("verifications")} />
        <Metric label="Partners habilitados" value={data.partnersEnabled} caption={`${data.partnersTotal} perfiles`} accent="green" onClick={() => onGo("partners")} />
        <Metric label="Trabajos publicados" value={data.jobsTotal} caption={`${data.bookingsTotal} reservas`} accent="blue" onClick={() => onGo("jobs")} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
        <Panel className="overflow-hidden"><div className="flex items-center justify-between border-b border-[#eee9de] px-5 py-4"><div><div className="eyebrow">Pulso del marketplace</div><h2 className="mt-1 text-lg font-bold">Volumen total</h2></div><span className="rounded-lg bg-[#f3efe5] p-2 text-[#61727b]"><Activity size={18} /></span></div><div className="grid grid-cols-2 divide-x divide-y divide-[#eee9de] sm:grid-cols-3 sm:divide-y-0">{[
          ["Pagos", data.paymentsTotal, "payments"], ["Liquidaciones", data.settlementsTotal, "payments"], ["Reseñas", data.reviewsTotal, "reviews"],
          ["Recomendaciones", data.recommendationsTotal, "recommendations"], ["Servicios", data.catalogItems, "catalog"], ["Activos de portfolio", data.portfolioAssets, "resources"],
        ].map(([text, amount, dest]) => <button key={String(text)} onClick={() => onGo(dest as Section)} className="group p-4 text-left hover:bg-[#faf7ef]" data-testid={`metric-total-${String(text).toLowerCase().replaceAll(" ", "-")}`}><div className="text-xs font-semibold text-[#68747d]">{text}</div><div className="mt-1 text-2xl font-bold tracking-tight">{amount}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#b86636]">Ver detalle →</div></button>)}</div></Panel>
        <Panel className="p-5"><div className="eyebrow">Control de calidad</div><h2 className="mt-1 text-lg font-bold">Cola de verificación</h2><div className="mt-4 flex items-end justify-between"><div className="text-5xl font-bold tracking-[-.06em] text-[#263b49]" data-testid="metric-verification-pending">{data.partnersPendingReview}</div><div className="mb-1 text-right text-xs text-[#68747d]">Partners esperando<br />revisión documental</div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[#eee9de]"><div className="h-full rounded-full bg-[#e87836]" style={{ width: `${data.partnersTotal ? Math.min(100, data.partnersVerified / data.partnersTotal * 100) : 0}%` }} /></div><div className="mt-2 flex justify-between text-[11px] text-[#68747d]"><span>{data.partnersVerified} verificados</span><span>{data.partnersTotal} perfiles</span></div><button onClick={() => onGo("verifications")} className="mt-5 flex w-full items-center justify-between rounded-xl bg-[#243b49] px-4 py-3 text-sm font-bold text-white hover:bg-[#314c5b]" data-testid="button-open-verifications">Revisar documentación <ChevronRight size={16} /></button></Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
        <Panel className="overflow-hidden"><div className="flex items-center justify-between border-b border-[#eee9de] px-5 py-4"><div><div className="eyebrow">Trazabilidad</div><h2 className="mt-1 text-lg font-bold">Actividad reciente</h2></div><button onClick={() => onGo("activity")} className="text-xs font-bold text-[#b86636]" data-testid="button-open-activity">Ver historial →</button></div>{data.recentActivity.length ? <div className="divide-y divide-[#eee9de]">{data.recentActivity.slice(0, 6).map((event) => <div key={event.id} className="flex items-start gap-3 px-5 py-3" data-testid={`recent-activity-${event.id}`}><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#df9650]" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{event.actorName || "Sistema"} · {label(event.action)}</div><div className="text-xs text-[#748087]">{label(event.entity)} #{event.entityId}</div></div><time className="shrink-0 text-[11px] text-[#7b8589]">{date(event.createdAt, true)}</time></div>)}</div> : <Empty text="No hay actividad reciente." />}</Panel>
        <Panel className="p-5"><div className="eyebrow">Inventario de recursos</div><h2 className="mt-1 text-lg font-bold">Contenido del marketplace</h2><div className="mt-4 space-y-3">{[["Fotos de perfil", data.profilePhotos], ["Portfolio", data.portfolioAssets], ["Mensajes de chat", data.chatMessages]].map(([name, amount]) => <div key={String(name)} className="flex items-center justify-between border-b border-[#eee9de] pb-3 last:border-0"><span className="text-sm text-[#56646c]">{name}</span><span className="font-mono text-sm font-bold" data-testid={`metric-resource-${String(name).toLowerCase().replaceAll(" ", "-")}`}>{amount}</span></div>)}</div><button onClick={() => onGo("resources")} className="mt-2 text-xs font-bold text-[#b86636]" data-testid="button-open-resources">Abrir metadatos de recursos →</button></Panel>
      </div>
    </div>}
  </BusyOrError>;
}
function Metric({ label: name, value, caption, accent, onClick }: { label: string; value: number; caption: string; accent: "orange" | "gold" | "green" | "blue"; onClick?: () => void }) {
  const accents = { orange: "border-t-[#e87836]", gold: "border-t-[#e0a64b]", green: "border-t-[#518764]", blue: "border-t-[#5b7c92]" };
  const content = <><div className="text-xs font-semibold text-[#68747d]">{name}</div><div className="mt-2 text-3xl font-bold tracking-[-.05em]">{value.toLocaleString("es-AR")}</div><div className="mt-1 text-[11px] text-[#748087]">{caption}</div></>;
  return onClick ? <button onClick={onClick} className={`rounded-2xl border border-[#e4dfd2] border-t-[3px] ${accents[accent]} bg-[#fffdf8] p-4 text-left shadow-[0_6px_20px_rgba(34,48,59,.035)] hover:-translate-y-0.5`} data-testid={`metric-${name.toLowerCase().replaceAll(" ", "-")}`}>{content}</button> : <div className={`rounded-2xl border border-[#e4dfd2] border-t-[3px] ${accents[accent]} bg-[#fffdf8] p-4 shadow-[0_6px_20px_rgba(34,48,59,.035)]`} data-testid={`metric-${name.toLowerCase().replaceAll(" ", "-")}`}>{content}</div>;
}
function VerificationQueue({ query, busy, docLoading, docError, onOpen, onResolve }: { query: UseQueryResult<AdminVerificationDocument[]>; busy: boolean; docLoading: number | null; docError: string; onOpen: (doc: AdminVerificationDocument) => void; onResolve: (doc: AdminVerificationDocument, estado: "verified" | "rejected") => void }) {
  return <BusyOrError loading={query.isLoading} error={query.error} retry={() => void query.refetch()}>
    <Panel className="overflow-hidden"><div className="flex flex-col justify-between gap-2 border-b border-[#eee9de] px-4 py-4 sm:flex-row sm:items-center"><div><h2 className="font-bold">Documentación pendiente</h2><p className="text-xs text-[#68747d]">Los archivos privados se consultan con la sesión autenticada y no exponen sus rutas.</p></div><Badge tone="warn">{query.data?.length ?? 0} en cola</Badge></div>
      {docError && <div role="alert" data-testid="text-document-error" className="mx-4 mt-4 rounded-lg bg-[#fbebe8] px-3 py-2 text-xs font-semibold text-[#963d34]">{docError}</div>}
      {!query.data?.length ? <Empty text="La cola está al día. No hay documentos pendientes." /> : <div className="divide-y divide-[#eee9de]">{query.data.map((doc: AdminVerificationDocument) => <article key={doc.id} className="p-4 sm:p-5" data-testid={`card-verification-${doc.id}`}><div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center"><div className="flex min-w-0 items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f2ede1] text-[#b86636]"><FileText size={19} /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{doc.partner.nombre}</h3><Badge tone="warn">{label(doc.estado)}</Badge></div><div className="mt-0.5 text-xs text-[#68747d]">{doc.partner.email} · {doc.perfil ? `${doc.perfil.oficio} · ${doc.perfil.categoria}` : "Perfil no disponible"}</div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#56646c]"><span className="font-semibold">{label(doc.tipo)}</span><span>{doc.nombre}</span><span>{bytes(doc.sizeBytes)}</span><span>{date(doc.createdAt)}</span></div></div></div><div className="flex shrink-0 flex-wrap gap-2"><button disabled={docLoading !== null} onClick={() => onOpen(doc)} className="inline-flex items-center gap-2 rounded-lg border border-[#d8d2c4] px-3 py-2 text-xs font-bold hover:bg-[#f3efe5] disabled:opacity-50" data-testid={`button-open-document-${doc.id}`}>{docLoading === doc.id ? "Abriendo…" : <><Eye size={14} /> Abrir documento</>}</button><button disabled={busy} onClick={() => onResolve(doc, "verified")} className="inline-flex items-center gap-1.5 rounded-lg bg-[#2f7552] px-3 py-2 text-xs font-bold text-white disabled:opacity-50" data-testid={`button-approve-document-${doc.id}`}><Check size={14} /> Aprobar</button><button disabled={busy} onClick={() => onResolve(doc, "rejected")} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e1c1bb] px-3 py-2 text-xs font-bold text-[#a23f35] disabled:opacity-50" data-testid={`button-reject-document-${doc.id}`}><X size={14} /> Rechazar</button></div></div></article>)}</div>}
      <div className="flex items-start gap-2 border-t border-[#eee9de] bg-[#fbf8f0] px-4 py-3 text-xs leading-relaxed text-[#68747d]"><ShieldAlert size={15} className="mt-0.5 shrink-0 text-[#b86636]" />La revisión del documento no habilita por sí sola al Partner. Para activarlo también deben estar aprobadas sus verificaciones y su cuenta debe permanecer activa.</div>
    </Panel>
  </BusyOrError>;
}
function ReadOnlyList({ title, loading, error, retry, empty, emptyText, pager, children }: { title: string; loading: boolean; error: unknown; retry: () => void; empty: boolean; emptyText: string; pager: ReactNode; children: ReactNode }) {
  return <BusyOrError loading={loading} error={error} retry={retry}><Panel className="overflow-hidden"><div className="border-b border-[#eee9de] px-4 py-3 font-bold">{title}</div>{empty ? <Empty text={emptyText} /> : children}{pager}</Panel></BusyOrError>;
}
