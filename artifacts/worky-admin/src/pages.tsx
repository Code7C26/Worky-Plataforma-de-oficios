import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Activity, ArrowRight, BriefcaseBusiness, CircleHelp, ClipboardList, ContactRound,
  FileClock, Hammer, House, Layers3, LockKeyhole, Search, ShieldCheck, Sparkles,
  UsersRound, Wrench, X,
} from 'lucide-react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminOverviewQueryKey, getListAdminCategoriesQueryKey,
  getListAdminHouseholdsQueryKey, getListAdminProfessionalsQueryKey,
  getListAdminServiceRequestsQueryKey, openVerificationDocument,
  useCreateAdminCategory, useDeleteAdminCategory, useGetAdminOverview,
  useListAdminCategories, useListAdminHouseholds, useListAdminProfessionals,
  useListAdminProfessionalDocuments, useListAdminServiceRequests,
  useReviewAdminVerificationDocument, useUpdateAdminCategory,
  useUpdateAdminHousehold, useUpdateAdminProfessional, useUpdateAdminServiceRequest,
} from './lib/admin-api';
import type {
  AdminProfessional, ProfessionalStatus, ServiceRequestStatus, VerificationDocument, WorkCategory,
} from './lib/admin-api';

const labelMap: Record<string, string> = {
  pending_review: 'A revisar', enabled: 'Habilitado', paused: 'Pausado',
  rejected: 'Rechazado', new: 'Nuevo', under_review: 'En revisión',
  assigned: 'Asignado', completed: 'Completado', cancelled: 'Cancelado',
  pending_verification: 'Pendiente', verified: 'Aprobado',
};
const professionalStatuses: ProfessionalStatus[] = ['pending_review', 'enabled', 'paused', 'rejected'];
const requestStatuses: ServiceRequestStatus[] = ['new', 'under_review', 'assigned', 'completed', 'cancelled'];
const dateFmt = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDate = (value?: string | null) => value ? dateFmt.format(new Date(value)) : '—';
const initials = (name?: string | null) => (name || '—').split(' ').slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('es-AR');
const statusClass = (status: string) => `status status-${status}`;

function isDenied(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const err = error as { status?: number; response?: { status?: number } };
  return err.status === 403 || err.response?.status === 403;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'No se pudo completar la operación.';
}

function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  const denied = isDenied(error);
  return (
    <div className="denied-wrap">
      <section className="panel denied-card" aria-live="polite">
        <div className="denied-icon"><LockKeyhole size={22} /></div>
        <p className="eyebrow">{denied ? 'Acceso restringido' : 'No pudimos cargar los datos'}</p>
        <h1>{denied ? 'Tu cuenta no tiene acceso al panel' : 'Hubo un problema de conexión'}</h1>
        <p>{denied
          ? 'El acceso administrativo se valida en el servidor. Iniciar sesión no alcanza para habilitar esta cuenta. Si necesitás acceso, consultá al equipo administrador.'
          : `${errorMessage(error)} No se cargó información de ejemplo. Revisá la conexión e intentá de nuevo.`}</p>
        {!denied && <button className="button button-primary" onClick={retry} data-testid="button-retry">Reintentar</button>}
      </section>
    </div>
  );
}

function MutationAlert({ error, onDismiss }: { error: unknown; onDismiss: () => void }) {
  return <div className="alert" role="alert" data-testid="status-mutation-error"><span>{isDenied(error)
    ? 'El servidor rechazó el cambio. Tu cuenta no tiene permisos administrativos para esta acción.'
    : errorMessage(error)}</span><button className="icon-button" onClick={onDismiss} aria-label="Cerrar mensaje" data-testid="button-dismiss-mutation-error"><X size={13} /></button></div>;
}

function LoadingPanel({ rows = 5 }: { rows?: number }) {
  return <div className="panel loading-stack" aria-label="Cargando"><div className="skeleton" style={{ width: '34%' }} />{Array.from({ length: rows }, (_, i) => <div className="skeleton" key={i} style={{ width: `${88 - (i % 3) * 11}%` }} />)}</div>;
}

function EmptyState({ icon: Icon = CircleHelp, title, text }: { icon?: typeof CircleHelp; title: string; text: string }) {
  return <div className="empty-state"><div><div className="empty-symbol"><Icon size={20} /></div><h3>{title}</h3><p>{text}</p></div></div>;
}

function Status({ value, testId }: { value: string; testId?: string }) {
  return <span className={statusClass(value)} data-testid={testId || `status-${value}`}>{labelMap[value] || value}</span>;
}

function PageTitle({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-subtitle">{subtitle}</p></div>{action && <div className="title-actions">{action}</div>}</div>;
}

export function WelcomePage() {
  return (
    <main className="home-page" data-testid="page-welcome">
      <div className="home-inner">
        <nav className="home-nav" aria-label="Navegación principal">
          <Link href="/" className="brand" data-testid="link-home-brand"><span className="brand-mark">w</span><span><span className="brand-name">worky</span><span className="brand-caption">operaciones</span></span></Link>
          <div className="home-links"><a href="#como-funciona" data-testid="link-how-it-works">Cómo funciona</a><Link href="/sign-in" className="button button-primary" data-testid="link-sign-in">Ingresar <ArrowRight size={14} /></Link></div>
        </nav>
        <section className="home-hero">
          <div>
            <div className="hero-label">Panel interno · Argentina</div>
            <h1>El trabajo bien hecho <em>empieza acá.</em></h1>
            <p>Un espacio de operaciones para acompañar cada solicitud, revisar postulaciones y mantener ordenado el marketplace.</p>
            <div className="hero-cta"><Link href="/sign-in" className="button button-primary" data-testid="link-hero-sign-in">Ingresar al panel <ArrowRight size={15} /></Link><span>Acceso exclusivo para el equipo Worky</span></div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit" /><div className="orbit two" />
            <div className="hero-core"><div className="hero-core-inner"><Wrench size={39} strokeWidth={1.6} /></div></div>
            <div className="hero-tag tag-one">Operaciones claras<span>Personas · pedidos · rubros</span></div>
            <div className="hero-tag tag-two">De punta a punta<span>Revisión con criterio humano</span></div>
          </div>
        </section>
        <div className="home-lower">
          <div className="home-proof">
            <div className="proof-item"><div className="proof-icon"><ContactRound size={16} /></div><div className="proof-copy"><strong>Personas primero</strong><span>Hogares y profesionales, con contexto</span></div></div>
            <div className="proof-item"><div className="proof-icon"><ClipboardList size={16} /></div><div className="proof-copy"><strong>Seguimiento simple</strong><span>Estados claros para cada pedido</span></div></div>
            <div className="proof-item"><div className="proof-icon"><ShieldCheck size={16} /></div><div className="proof-copy"><strong>Decisiones del equipo</strong><span>La habilitación siempre es manual</span></div></div>
          </div>
          <section className="home-section" id="como-funciona">
            <div className="home-section-head"><p className="eyebrow">Trabajo cotidiano, bien organizado</p><h2>Una vista común para hacer que las cosas pasen.</h2><p>Worky conecta hogares con profesionales de oficios. Este panel ayuda al equipo a sostener esa coordinación, sin reemplazar el criterio de quienes están detrás.</p></div>
            <div className="pillars">
              <article className="pillar"><span className="pillar-index">01 / PERSONAS</span><h3>Conocé cada lado</h3><p>Consultá los datos de hogares y profesionales con acceso directo a su zona y rubro.</p></article>
              <article className="pillar"><span className="pillar-index">02 / PEDIDOS</span><h3>Seguí cada solicitud</h3><p>Revisá novedades, actualizá el estado y asigná solo profesionales habilitados.</p></article>
              <article className="pillar"><span className="pillar-index">03 / RUBROS</span><h3>Mantené el catálogo</h3><p>Ordená las categorías de trabajo y cuidá las que ya tienen uso en el marketplace.</p></article>
            </div>
          </section>
          <footer className="home-footer"><span><strong>worky</strong> · Operaciones</span><span>Hecho para el equipo que conecta.</span></footer>
        </div>
      </div>
    </main>
  );
}

export function DashboardPage() {
  const overview = useGetAdminOverview();
  const requests = useListAdminServiceRequests({ status: 'new' });
  if (overview.isLoading || requests.isLoading) return <main className="page-wrap"><LoadingPanel rows={7} /></main>;
  if (overview.isError) return <ErrorState error={overview.error} retry={() => overview.refetch()} />;
  if (requests.isError) return <ErrorState error={requests.error} retry={() => requests.refetch()} />;
  const data = overview.data;
  if (!data) return <LoadingPanel />;
  const stats = [
    { label: 'Hogares', value: data.householdCount, note: 'Cuentas registradas', icon: House },
    { label: 'Profesionales', value: data.professionalCount, note: `${data.enabledProfessionalCount} habilitados`, icon: BriefcaseBusiness },
    { label: 'Postulaciones', value: data.pendingProfessionalCount, note: 'Pendientes de revisión', icon: FileClock },
    { label: 'Solicitudes abiertas', value: data.openRequestCount, note: `${data.newRequestCount} nuevas`, icon: ClipboardList },
  ];
  return (
    <main className="page-wrap" data-testid="page-dashboard">
      <PageTitle eyebrow="Vista general" title="Buen día, equipo." subtitle="El pulso del marketplace, con datos actuales del servicio." />
      <section className="metrics" aria-label="Resumen del marketplace">
        {stats.map(({ label, value, note, icon: Icon }) => <article className="panel metric" key={label} data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}><div className="metric-label"><span className="metric-icon"><Icon size={15} /></span>{label}</div><div className="metric-value">{value.toLocaleString('es-AR')}</div><div className="metric-note">{note}</div></article>)}
      </section>
      <div className="dashboard-grid">
        <section className="panel section-panel">
          <div className="section-head"><div><h2 className="section-title">Solicitudes nuevas</h2><div className="section-kicker">Lo último que llegó y necesita una primera mirada</div></div><Link className="text-link" href="/requests" data-testid="link-all-new-requests">Ver solicitudes <ArrowRight size={13} /></Link></div>
          {requests.data?.length ? requests.data.slice(0, 5).map((request) => <div className="queue-card" key={request.id} data-testid={`request-preview-${request.id}`}><span className="queue-marker" /><div className="queue-main"><strong>{request.title}</strong><span>{request.householdName} · {request.categoryName} · {request.zone}</span></div><span className="queue-status">{fmtDate(request.createdAt)}</span></div>) : <EmptyState icon={Sparkles} title="Todo al día" text="No hay solicitudes nuevas para revisar." />}
        </section>
        <section className="panel section-panel">
          <div className="section-head"><div><h2 className="section-title">Ritmo de trabajo</h2><div className="section-kicker">Un flujo claro para cada decisión</div></div><Activity size={17} color="#8c9d92" /></div>
          <div className="workflow">
            <div className="workflow-row"><span className="workflow-num">01</span><div className="workflow-copy"><strong>Revisar postulaciones</strong><span>{data.pendingProfessionalCount} esperando una decisión</span></div></div>
            <div className="workflow-row"><span className="workflow-num">02</span><div className="workflow-copy"><strong>Ordenar solicitudes</strong><span>{data.newRequestCount} nuevas para empezar</span></div></div>
            <div className="workflow-row"><span className="workflow-num">03</span><div className="workflow-copy"><strong>Acompañar el servicio</strong><span>Asigná solo perfiles habilitados</span></div></div>
          </div>
        </section>
      </div>
    </main>
  );
}

function SearchBar({ value, onChange, placeholder, status, onStatus, statuses }: {
  value: string; onChange: (value: string) => void; placeholder: string;
  status?: string; onStatus?: (value: string) => void; statuses?: string[];
}) {
  return <div className="toolbar"><label className="search-wrap"><Search className="search-icon" size={15} /><input className="search-input" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid="input-search" /></label>{statuses && <select className="filter-select" value={status || ''} onChange={(e) => onStatus?.(e.target.value)} aria-label="Filtrar por estado" data-testid="select-status-filter"><option value="">Todos los estados</option>{statuses.map((key) => <option value={key} key={key}>{labelMap[key]}</option>)}</select>}</div>;
}

function VerificationDocumentsModal({ professional, onClose }: { professional: AdminProfessional; onClose: () => void }) {
  const queryClient = useQueryClient();
  const documents = useListAdminProfessionalDocuments(professional.id);
  const review = useReviewAdminVerificationDocument();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const reasonFor = (documentId: string) => reasons[documentId] || '';

  const reviewDocument = (document: VerificationDocument, status: 'verified' | 'rejected') => {
    const reason = reasonFor(document.id).trim();
    if (reason.length < 3) {
      setError('Escribí un motivo de al menos 3 caracteres para dejar constancia de la revisión.');
      return;
    }
    setError('');
    review.mutate({ documentId: document.id, status, reason }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ['admin', 'verification-documents', professional.id] });
        void queryClient.invalidateQueries({ queryKey: getListAdminProfessionalsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
      },
      onError: (reasonError) => setError(errorMessage(reasonError)),
    });
  };

  return <Modal title="Habilitación profesional" subtitle={`${professional.fullName} · revisá cada documento antes de habilitar`} onClose={onClose}>
    {documents.isLoading ? <LoadingPanel rows={3} /> : documents.isError ? <div className="alert" role="alert">{errorMessage(documents.error)} <button className="button button-soft button-small" onClick={() => void documents.refetch()}>Reintentar</button></div> : documents.data?.length ? <div className="verification-list">
      {documents.data.map((document) => <article className="verification-card" key={document.id}>
        <div className="verification-card-head">
          <div><strong>{document.name}</strong><span className="person-detail">{document.type.replaceAll('_', ' ')} · recibido {fmtDate(document.createdAt)}</span></div>
          <Status value={document.status} />
        </div>
        <button className="button button-soft button-small" type="button" onClick={() => {
          void openVerificationDocument(document.objectPath).catch((reasonError) => setError(errorMessage(reasonError)));
        }}>Abrir documento</button>
        {document.status === 'pending_verification' && <div className="verification-review">
          <label><span className="field-label">Motivo de revisión</span><input className="field-input" value={reasonFor(document.id)} onChange={(event) => setReasons((current) => ({ ...current, [document.id]: event.target.value }))} maxLength={240} placeholder="Dejá constancia del criterio aplicado" /></label>
          <div className="row-actions">
            <button className="button button-soft button-small" type="button" disabled={review.isPending} onClick={() => reviewDocument(document, 'verified')}>Aprobar</button>
            <button className="button button-danger button-small" type="button" disabled={review.isPending} onClick={() => reviewDocument(document, 'rejected')}>Rechazar</button>
          </div>
        </div>}
      </article>)}
    </div> : <EmptyState icon={ShieldCheck} title="Todavía no hay documentos" text="La habilitación se completa cuando el profesional presenta su documentación." />}
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="dialog-actions"><button className="button button-quiet" onClick={onClose}>Cerrar</button></div>
  </Modal>;
}

export function ProfessionalsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const queryClient = useQueryClient();
  const [reviewProfessional, setReviewProfessional] = useState<AdminProfessional | null>(null);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const params = useMemo(() => ({ ...(search.trim() ? { search: search.trim() } : {}), ...(status ? { status: status as ProfessionalStatus } : {}) }), [search, status]);
  const pros = useListAdminProfessionals(params);
  const update = useUpdateAdminProfessional();
  const saveStatus = (professionalId: string, next: 'enabled' | 'paused') => {
    setMutationError(null);
    update.mutate({ professionalId, data: { status: next } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListAdminProfessionalsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
      }, onError: setMutationError,
    });
  };
  if (pros.isLoading) return <main className="page-wrap"><PageTitle eyebrow="Personas" title="Profesionales" subtitle="Revisá postulaciones y administrá el acceso al marketplace." /><LoadingPanel /></main>;
  if (pros.isError) return <ErrorState error={pros.error} retry={() => pros.refetch()} />;
  return <main className="page-wrap" data-testid="page-professionals">
    <PageTitle eyebrow="Personas" title="Profesionales" subtitle="Revisá la documentación y habilitá perfiles aptos para recibir solicitudes." />
    {mutationError !== null ? <MutationAlert error={mutationError} onDismiss={() => setMutationError(null)} /> : null}
    <SearchBar value={search} onChange={setSearch} placeholder="Buscar por nombre, mail, zona o rubro…" status={status} onStatus={setStatus} statuses={professionalStatuses} />
    <section className="panel section-panel">
      {pros.data?.length ? <>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Profesional</th><th>Rubro</th><th>Zona</th><th>Estado</th><th>Alta</th><th>Acciones</th></tr></thead>
          <tbody>{pros.data.map((pro) => <tr key={pro.id} data-testid={`row-professional-${pro.id}`}>
            <td><div className="person-cell"><span className="initials">{initials(pro.fullName)}</span><span><span className="person-name">{pro.fullName}</span><span className="person-detail">{pro.email || pro.phone || 'Sin contacto informado'}</span></span></div></td>
            <td>{pro.categoryName}</td><td>{pro.zone}</td><td><Status value={pro.status} testId={`status-professional-${pro.id}`} /></td><td className="mono">{fmtDate(pro.createdAt)}</td>
            <td><div className="row-actions">
              {pro.verified && <select className="inline-select" value={pro.status === 'paused' ? 'paused' : 'enabled'} disabled={update.isPending} onChange={(e) => saveStatus(pro.id, e.target.value as 'enabled' | 'paused')} aria-label={`Cambiar acceso de ${pro.fullName}`} data-testid={`select-professional-status-${pro.id}`}><option value="enabled">Habilitado</option><option value="paused">Pausado</option></select>}
              <button className="button button-soft button-small" type="button" disabled={!pro.documentCount} onClick={() => setReviewProfessional(pro)} data-testid={`button-review-documents-${pro.id}`}>{pro.pendingDocumentCount ? `Revisar docs (${pro.pendingDocumentCount})` : `Documentos (${pro.documentCount})`}</button>
            </div></td>
          </tr>)}</tbody></table></div>
        <div className="table-foot"><span>{pros.data.length} {pros.data.length === 1 ? 'profesional' : 'profesionales'}</span><span>La habilitación se confirma después de revisar la documentación.</span></div>
      </> : <EmptyState icon={UsersRound} title="No encontramos profesionales" text={search || status ? 'Probá ajustar la búsqueda o el filtro.' : 'Cuando haya postulaciones o perfiles, los vas a encontrar acá.'} />}
    </section>
    {reviewProfessional && <VerificationDocumentsModal professional={reviewProfessional} onClose={() => setReviewProfessional(null)} />}
  </main>;
}

export function HouseholdsPage() {
  const [search, setSearch] = useState('');
  const [mutationError, setMutationError] = useState<unknown>(null);
  const queryClient = useQueryClient();
  const params = useMemo(() => search.trim() ? { search: search.trim() } : {}, [search]);
  const households = useListAdminHouseholds(params);
  const update = useUpdateAdminHousehold();
  const toggleActive = (householdId: string, active: boolean, name: string) => {
    if (!active && !window.confirm(`${name} va a perder acceso a Worky. Las solicitudes abiertas deben resolverse antes de continuar.`)) return;
    setMutationError(null);
    update.mutate({ householdId, active }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListAdminHouseholdsQueryKey() });
      },
      onError: setMutationError,
    });
  };
  if (households.isLoading) return <main className="page-wrap"><PageTitle eyebrow="Personas" title="Hogares" subtitle="Directorio de cuentas que publican solicitudes." /><LoadingPanel /></main>;
  if (households.isError) return <ErrorState error={households.error} retry={() => households.refetch()} />;
  return <main className="page-wrap" data-testid="page-households">
    <PageTitle eyebrow="Personas" title="Hogares" subtitle="Directorio de cuentas que publican solicitudes." />
    {mutationError !== null ? <MutationAlert error={mutationError} onDismiss={() => setMutationError(null)} /> : null}
    <SearchBar value={search} onChange={setSearch} placeholder="Buscar por nombre, mail, teléfono o zona…" />
    <section className="panel section-panel">{households.data?.length ? <>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Hogar</th><th>Contacto</th><th>Zona</th><th>Desde</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{households.data.map((household) => <tr key={household.id} data-testid={`row-household-${household.id}`}><td><div className="person-cell"><span className="initials">{initials(household.fullName)}</span><span className="person-name">{household.fullName}</span></div></td><td>{household.email || household.phone || <span className="muted">Sin contacto informado</span>}{household.email && household.phone && <span className="person-detail">{household.phone}</span>}</td><td>{household.zone || <span className="muted">Sin zona</span>}</td><td className="mono">{fmtDate(household.createdAt)}</td><td><Status value={household.active ? 'enabled' : 'paused'} /></td><td><button className={`button button-small ${household.active ? 'button-quiet' : 'button-soft'}`} disabled={update.isPending} onClick={() => toggleActive(household.id, !household.active, household.fullName)} data-testid={`button-household-active-${household.id}`}>{household.active ? 'Desactivar' : 'Reactivar'}</button></td></tr>)}</tbody></table></div>
      <div className="table-foot"><span>{households.data.length} {households.data.length === 1 ? 'hogar' : 'hogares'}</span><span>Datos recibidos desde la API.</span></div>
    </> : <EmptyState icon={House} title="No encontramos hogares" text={search ? 'Probá con otro nombre, contacto o zona.' : 'Todavía no hay cuentas para mostrar.'} />}</section>
  </main>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  return <div className="form-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="form-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header className="dialog-head"><div><h2 id="dialog-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose} aria-label="Cerrar" data-testid="button-close-dialog"><X size={15} /></button></header>{children}</section></div>;
}

export function RequestsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [mutationError, setMutationError] = useState<unknown>(null);
  const queryClient = useQueryClient();
  const params = useMemo(() => ({ ...(search.trim() ? { search: search.trim() } : {}), ...(status ? { status: status as ServiceRequestStatus } : {}) }), [search, status]);
  const requests = useListAdminServiceRequests(params);
  const pros = useListAdminProfessionals({ status: 'enabled' });
  const update = useUpdateAdminServiceRequest();
  const changeRequest = (requestId: string, data: { status?: ServiceRequestStatus; professionalId?: string | null }) => {
    setMutationError(null);
    update.mutate({ requestId, data }, { onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getListAdminServiceRequestsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
    }, onError: setMutationError });
  };
  if (requests.isLoading || pros.isLoading) return <main className="page-wrap"><PageTitle eyebrow="Marketplace" title="Solicitudes" subtitle="Seguí cada pedido y coordiná su asignación." /><LoadingPanel /></main>;
  if (requests.isError) return <ErrorState error={requests.error} retry={() => requests.refetch()} />;
  if (pros.isError) return <ErrorState error={pros.error} retry={() => pros.refetch()} />;
  return <main className="page-wrap" data-testid="page-requests">
    <PageTitle eyebrow="Marketplace" title="Solicitudes" subtitle="Seguí cada pedido y coordiná su asignación." />
    {mutationError !== null ? <MutationAlert error={mutationError} onDismiss={() => setMutationError(null)} /> : null}
    <SearchBar value={search} onChange={setSearch} placeholder="Buscar por pedido, hogar, zona o rubro…" status={status} onStatus={setStatus} statuses={requestStatuses} />
    <section className="panel section-panel">{requests.data?.length ? <>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Pedido</th><th>Hogar / zona</th><th>Estado</th><th>Asignar profesional</th><th>Fecha</th></tr></thead>
        <tbody>{requests.data.map((request) => <tr key={request.id} data-testid={`row-request-${request.id}`}>
          <td><div className="person-name">{request.title}</div><div className="person-detail">{request.categoryName}</div><div className="person-detail request-description" title={request.description}>{request.description}</div></td>
          <td><div className="person-name">{request.householdName}</div><div className="person-detail">{request.zone}</div></td>
          <td><select className="inline-select" value={request.status} disabled={update.isPending} onChange={(e) => changeRequest(request.id, { status: e.target.value as ServiceRequestStatus })} aria-label={`Estado de ${request.title}`} data-testid={`select-request-status-${request.id}`}>{requestStatuses.map((s) => <option key={s} value={s} disabled={['assigned', 'under_review', 'completed'].includes(s) && !request.professionalId}>{labelMap[s]}</option>)}</select></td>
          <td><select className="inline-select" value={request.professionalId || ''} disabled={update.isPending || request.status === 'completed' || request.status === 'cancelled'} onChange={(e) => changeRequest(request.id, { professionalId: e.target.value || null, ...(!e.target.value && request.status === 'assigned' ? { status: 'under_review' as const } : {}) })} aria-label={`Asignar profesional a ${request.title}`} data-testid={`select-request-professional-${request.id}`}><option value="">Sin asignar</option>{request.professionalId && !pros.data?.some((pro) => pro.id === request.professionalId) && <option value={request.professionalId}>{request.professionalName || 'Profesional asignado'} · asignado actualmente</option>}{pros.data?.map((pro) => <option value={pro.id} key={pro.id}>{pro.fullName} · {pro.categoryName}</option>)}</select><div className="person-detail">{request.status === 'completed' || request.status === 'cancelled' ? 'La solicitud está cerrada' : pros.data?.length ? `${pros.data.length} profesionales habilitados` : 'No hay profesionales habilitados'}</div></td>
          <td className="mono">{fmtDate(request.createdAt)}</td>
        </tr>)}</tbody></table></div>
      <div className="table-foot"><span>{requests.data.length} {requests.data.length === 1 ? 'solicitud' : 'solicitudes'}</span><span>La asignación se limita a perfiles habilitados.</span></div>
    </> : <EmptyState icon={ClipboardList} title="No hay solicitudes para mostrar" text={search || status ? 'Probá cambiar los filtros.' : 'Cuando llegue un pedido, va a aparecer acá.'} />}</section>
  </main>;
}

export function CategoriesPage() {
  const queryClient = useQueryClient();
  const categories = useListAdminCategories();
  const create = useCreateAdminCategory();
  const update = useUpdateAdminCategory();
  const remove = useDeleteAdminCategory();
  const [editing, setEditing] = useState<WorkCategory | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ category: 'Plomería', specialty: '', active: true });
  const [errorText, setErrorText] = useState('');
  const busy = create.isPending || update.isPending || remove.isPending;
  const startNew = () => { setEditing(null); setForm({ category: 'Plomería', specialty: '', active: true }); setErrorText(''); setFormOpen(true); };
  const startEdit = (category: WorkCategory) => { setEditing(category); setForm({ category: category.category, specialty: category.name, active: category.active }); setErrorText(''); setFormOpen(true); };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListAdminCategoriesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListAdminProfessionalsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListAdminServiceRequestsQueryKey() });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (form.specialty.trim().length < 2) { setErrorText('La especialidad debe tener al menos 2 caracteres.'); return; }
    setErrorText('');
    const payload = { category: form.category, specialty: form.specialty.trim(), active: form.active };
    if (editing) update.mutate({ categoryId: editing.id, data: payload }, { onSuccess: () => { refresh(); setFormOpen(false); }, onError: (e) => setErrorText(isDenied(e) ? 'Tu cuenta no tiene permisos para modificar categorías.' : 'No se pudo guardar. Probá de nuevo.') });
    else create.mutate(payload, { onSuccess: () => { refresh(); setFormOpen(false); }, onError: (e) => setErrorText(isDenied(e) ? 'Tu cuenta no tiene permisos para crear categorías.' : errorMessage(e)) });
  };
  if (categories.isLoading) return <main className="page-wrap"><PageTitle eyebrow="Configuración" title="Rubros" subtitle="Administrá el catálogo de oficios del marketplace." /><LoadingPanel /></main>;
  if (categories.isError) return <ErrorState error={categories.error} retry={() => categories.refetch()} />;
  return <main className="page-wrap" data-testid="page-categories">
    <PageTitle eyebrow="Configuración" title="Rubros y especialidades" subtitle="Este catálogo es compartido por la app y la plataforma Worky." action={<button className="button button-primary" onClick={startNew} data-testid="button-create-category"><Layers3 size={14} /> Nueva especialidad</button>} />
    <section className="panel section-panel">{categories.data?.length ? <>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Rubro</th><th>Especialidad</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{categories.data.map((category) => <tr key={category.id} data-testid={`row-category-${category.id}`}>
        <td>{category.category}</td><td><div className="person-name">{category.name}</div><div className="person-detail">Creada {fmtDate(category.createdAt)}</div></td>
        <td><span className={`status ${category.active ? 'status-enabled' : 'status-paused'}`}>{category.active ? 'Activo' : 'Inactivo'}</span></td>
        <td><div className="row-actions"><button className="button button-soft button-small" onClick={() => startEdit(category)} data-testid={`button-edit-category-${category.id}`}>Editar</button><button className="button button-quiet button-small" disabled={busy} onClick={() => update.mutate({ categoryId: category.id, data: { active: !category.active } }, { onSuccess: refresh, onError: (e) => setErrorText(isDenied(e) ? 'Tu cuenta no tiene permisos para cambiar categorías.' : errorMessage(e)) })} data-testid={`button-toggle-category-${category.id}`}>{category.active ? 'Desactivar' : 'Activar'}</button><button className="button button-danger button-small" disabled={busy} title="Eliminar especialidad" onClick={() => { if (window.confirm(`¿Eliminar “${category.name}” del rubro ${category.category}? Esta acción no se puede deshacer.`)) remove.mutate({ categoryId: category.id }, { onSuccess: refresh, onError: (e) => setErrorText(isDenied(e) ? 'Tu cuenta no tiene permisos para eliminar categorías.' : errorMessage(e)) }); }} data-testid={`button-delete-category-${category.id}`}>Eliminar</button></div></td>
      </tr>)}</tbody></table></div>
      <div className="table-foot"><span>{categories.data.length} {categories.data.length === 1 ? 'especialidad' : 'especialidades'}</span><span>Las especialidades usadas no se pueden eliminar; podés desactivarlas.</span></div>
    </> : <EmptyState icon={Hammer} title="El catálogo está vacío" text="Creá el primer rubro para organizar los oficios." />}</section>
    {errorText && <div className="alert" role="alert" data-testid="status-category-error"><span>{errorText}</span><button className="icon-button" onClick={() => setErrorText('')} aria-label="Cerrar mensaje" data-testid="button-dismiss-category-error"><X size={13} /></button></div>}
    {formOpen && <Modal title={editing ? 'Editar especialidad' : 'Nueva especialidad'} subtitle="Los cambios se reflejan en el catálogo compartido por Worky." onClose={() => setFormOpen(false)}>
      <form onSubmit={submit}>
        <div className="form-fields">
          <label><span className="field-label">Rubro</span><select className="field-input" value={form.category} onChange={(e) => setForm((current) => ({ ...current, category: e.target.value }))} data-testid="select-category-parent">{['Plomería', 'Electricidad', 'Gas', 'Albañilería', 'Otro'].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <label><span className="field-label">Especialidad</span><input className="field-input" value={form.specialty} onChange={(e) => setForm((current) => ({ ...current, specialty: e.target.value }))} maxLength={80} required minLength={2} placeholder="Ej. Instalación de grifería" autoFocus data-testid="input-category-name" /></label>
          <label className="checkline"><input type="checkbox" checked={form.active} onChange={(e) => setForm((current) => ({ ...current, active: e.target.checked }))} data-testid="checkbox-category-active" /> Rubro activo</label>
          {errorText && <div className="alert" role="alert" data-testid="status-category-form-error">{errorText}</div>}
        </div>
        <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={() => setFormOpen(false)} data-testid="button-cancel-category">Cancelar</button><button type="submit" className="button button-primary" disabled={busy} data-testid="button-save-category">{busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear especialidad'}</button></div>
      </form>
    </Modal>}
  </main>;
}

export const navItems = [
  { href: '/dashboard', label: 'Resumen', icon: Activity },
  { href: '/professionals', label: 'Profesionales', icon: BriefcaseBusiness },
  { href: '/households', label: 'Hogares', icon: House },
  { href: '/requests', label: 'Solicitudes', icon: ClipboardList },
  { href: '/categories', label: 'Rubros', icon: Layers3 },
];
