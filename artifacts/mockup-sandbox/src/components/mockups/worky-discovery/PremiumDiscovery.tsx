import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  WifiOff,
  X,
} from "lucide-react";

import "./_group.css";
import "./PremiumDiscovery.css";
import workyLogo from "./worky-logo.png";

type Role = "cliente" | "partner";
type ScreenState = "loading" | "error" | "success";
type Pro = {
  id: number;
  name: string;
  oficio: string;
  category: string;
  verified: boolean;
  about: string;
  rating: number;
  reviews: number;
  jobs: number;
  distance: number | null;
  initials: string;
  tint: string;
  availability: string;
};
type Job = {
  id: number;
  trade: string;
  title: string;
  detail: string;
  neighborhood: string;
  timing: string;
  budget: string;
};

const pros: Pro[] = [
  {
    id: 101,
    name: "Martín Ríos",
    oficio: "Electricista matriculado",
    category: "Electricidad",
    verified: true,
    about: "Instalaciones seguras, reparaciones y mantenimiento para tu hogar.",
    rating: 4.9,
    reviews: 38,
    jobs: 64,
    distance: 2.4,
    initials: "MR",
    tint: "clay",
    availability: "Disponible esta semana",
  },
  {
    id: 102,
    name: "Lucía Ferreyra",
    oficio: "Plomera",
    category: "Plomería",
    verified: true,
    about: "Soluciones rápidas para pérdidas, griferías y redes de agua.",
    rating: 4.8,
    reviews: 27,
    jobs: 51,
    distance: 4.1,
    initials: "LF",
    tint: "sage",
    availability: "Responde en el día",
  },
  {
    id: 103,
    name: "Nicolás Acosta",
    oficio: "Pintor",
    category: "Pintura",
    verified: false,
    about: "Pintura interior y exterior con terminaciones prolijas.",
    rating: 4.7,
    reviews: 19,
    jobs: 35,
    distance: null,
    initials: "NA",
    tint: "gold",
    availability: "Agenda abierta",
  },
];

const jobs: Job[] = [
  {
    id: 201,
    trade: "Electricidad",
    title: "Revisar instalación de cocina",
    detail: "Salta la térmica al prender el horno.",
    neighborhood: "Villa Crespo",
    timing: "Para esta semana",
    budget: "A convenir",
  },
  {
    id: 202,
    trade: "Plomería",
    title: "Pérdida debajo de la pileta",
    detail: "Ya tengo los repuestos, necesito la instalación.",
    neighborhood: "Almagro",
    timing: "Cuando puedas",
    budget: "A convenir",
  },
  {
    id: 203,
    trade: "Pintura",
    title: "Pintar living y pasillo",
    detail: "Departamento vacío, paredes en buen estado.",
    neighborhood: "Palermo",
    timing: "Próximos 10 días",
    budget: "A convenir",
  },
];

const categories = ["Todos", "Plomería", "Electricidad", "Pintura", "Gas"];

function StatePanel({
  kind,
  onRetry,
}: {
  kind: "loading" | "error" | "empty";
  onRetry: () => void;
}) {
  if (kind === "loading") {
    return (
      <div className="wd-skeleton-list" aria-label="Cargando profesionales" aria-live="polite">
        {[0, 1].map((item) => (
          <div className="wd-skeleton-card" key={item}>
            <div className="wd-skeleton-person">
              <span className="wd-shimmer wd-skeleton-avatar" />
              <span className="wd-skeleton-lines">
                <i className="wd-shimmer wd-line wd-line-name" />
                <i className="wd-shimmer wd-line wd-line-trade" />
              </span>
            </div>
            <i className="wd-shimmer wd-line wd-line-copy" />
            <i className="wd-shimmer wd-line wd-line-meta" />
          </div>
        ))}
      </div>
    );
  }

  if (kind === "error") {
    return (
      <div className="wd-state-panel" role="alert">
        <div className="wd-state-icon wd-error-icon"><WifiOff size={21} /></div>
        <p className="wd-state-title">No cargó la búsqueda</p>
        <p className="wd-state-copy">No pudimos traer los perfiles. Probá de nuevo en unos segundos.</p>
        <button className="wd-retry-button" onClick={onRetry} type="button" data-testid="button-retry">
          Reintentar <ArrowRight size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="wd-state-panel" role="status">
      <div className="wd-state-icon"><Search size={21} /></div>
      <p className="wd-state-title">Todavía no hay resultados</p>
      <p className="wd-state-copy">Probá con otro oficio o nombre. Estamos para ayudarte a encontrar a la persona indicada.</p>
      <button className="wd-reset-search" onClick={onRetry} type="button">Limpiar búsqueda</button>
    </div>
  );
}

function ProfessionalCard({ pro, onOpen }: { pro: Pro; onOpen: (pro: Pro) => void }) {
  return (
    <button
      className="wd-pro-card"
      type="button"
      onClick={() => onOpen(pro)}
      data-testid={`card-professional-${pro.id}`}
      aria-label={`Ver perfil de ${pro.name}, ${pro.oficio}, ${pro.rating.toFixed(1)} estrellas`}
    >
      <div className="wd-pro-top">
        <span className={`wd-avatar wd-avatar-${pro.tint}`} aria-hidden="true">{pro.initials}</span>
        <span className="wd-pro-main">
          <span className="wd-pro-name">{pro.name}</span>
          <span className="wd-pro-trade">{pro.oficio}</span>
        </span>
        {pro.verified ? (
          <span className="wd-verified" aria-label="Profesional verificado">
            <BadgeCheck size={19} />
          </span>
        ) : null}
      </div>
      <span className="wd-pro-about">{pro.about}</span>
      <span className="wd-pro-status"><span className="wd-status-dot" />{pro.availability}</span>
      <span className="wd-pro-divider" />
      <span className="wd-pro-metrics">
        <span className="wd-rating"><Star size={14} fill="currentColor" /> <b>{pro.rating.toFixed(1)}</b> <span>({pro.reviews})</span></span>
        <span className="wd-metric"><CheckCircle2 size={14} />{pro.jobs} trabajos</span>
        {pro.distance !== null ? <span className="wd-metric"><MapPin size={14} />{pro.distance.toFixed(1)} km</span> : null}
        <span className="wd-profile-arrow"><ArrowUpRight size={17} /></span>
      </span>
    </button>
  );
}

function JobCard({ job, interested, onInterest }: { job: Job; interested: boolean; onInterest: () => void }) {
  return (
    <article className="wd-job-card" data-testid={`card-job-${job.id}`}>
      <div className="wd-job-head">
        <span className="wd-job-category">{job.trade}</span>
        <span className="wd-job-budget">{job.budget}</span>
      </div>
      <h3>{job.title}</h3>
      <p>{job.detail}</p>
      <div className="wd-job-meta">
        <span><MapPin size={14} />{job.neighborhood}</span>
        <span><Clock3 size={14} />{job.timing}</span>
      </div>
      <button
        className={`wd-interest-button${interested ? " is-interested" : ""}`}
        type="button"
        onClick={onInterest}
        aria-pressed={interested}
        data-testid={`button-interest-${job.id}`}
      >
        {interested ? <><Check size={15} /> Interés guardado</> : <>Me interesa <ArrowRight size={15} /></>}
      </button>
    </article>
  );
}

export function PremiumDiscovery() {
  const [role, setRole] = useState<Role>("cliente");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("Todos");
  const [screenState, setScreenState] = useState<ScreenState>(() => {
    const requestedState = new URLSearchParams(window.location.search).get("state");
    return requestedState === "error" || requestedState === "loading" ? requestedState : "success";
  });
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [profile, setProfile] = useState<Pro | null>(null);
  const [jobTitle, setJobTitle] = useState("");
  const [jobDetail, setJobDetail] = useState("");
  const [jobPosted, setJobPosted] = useState(false);
  const [interestedJobs, setInterestedJobs] = useState<number[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!search.trim()) return undefined;
    setScreenState("loading");
    const timer = window.setTimeout(() => setScreenState("success"), 360);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const filteredPros = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-AR");
    return pros.filter((pro) => {
      const matchesTerm = !term || [pro.name, pro.oficio, pro.category]
        .some((value) => value.toLocaleLowerCase("es-AR").includes(term));
      return matchesTerm && (activeCategory === "Todos" || pro.category === activeCategory);
    });
  }, [activeCategory, search]);

  const filteredJobs = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-AR");
    return jobs.filter((job) =>
      (!term || [job.title, job.detail, job.trade, job.neighborhood]
        .some((value) => value.toLocaleLowerCase("es-AR").includes(term))) &&
      (activeCategory === "Todos" || job.trade === activeCategory),
    );
  }, [activeCategory, search]);

  const isPartner = role === "partner";
  const visibleCount = isPartner ? filteredJobs.length : filteredPros.length;

  const retry = () => {
    setScreenState("loading");
    window.setTimeout(() => setScreenState("success"), 420);
  };

  const chooseRole = (nextRole: Role) => {
    setRole(nextRole);
    setSearch("");
    setActiveCategory("Todos");
    setScreenState("success");
    setNotice(nextRole === "cliente" ? "Estás viendo Worky como cliente." : "Estás viendo oportunidades como partner.");
  };

  const postJob = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!jobTitle.trim()) return;
    setJobPosted(true);
  };

  return (
    <main className="worky-discovery premium-discovery">
      <div className="wd-screen">
        <header className="wd-header">
          <a className="wd-brand" href="#inicio" aria-label="Worky, inicio">
            <span className="wd-logo-wrap"><img src={workyLogo} alt="Worky" /></span>
          </a>
          <span className="wd-location"><MapPin size={13} /> Buenos Aires</span>
        </header>

        <section className="wd-role-section" aria-label="Elegí tu perfil">
          <span className="wd-role-prompt">¿Cómo querés usar Worky?</span>
          <div className="wd-role-switch" role="group" aria-label="Cambiar tipo de cuenta">
            <button
              className={!isPartner ? "is-active" : ""}
              type="button"
              aria-pressed={!isPartner}
              onClick={() => chooseRole("cliente")}
              data-testid="button-role-cliente"
            >
              <span className="wd-role-glyph"><Search size={14} /></span>
              Cliente
            </button>
            <button
              className={isPartner ? "is-active" : ""}
              type="button"
              aria-pressed={isPartner}
              onClick={() => chooseRole("partner")}
              data-testid="button-role-partner"
            >
              <span className="wd-role-glyph"><BriefcaseBusiness size={14} /></span>
              Partner
            </button>
          </div>
        </section>

        <section className="wd-hero" id="inicio">
          <div className="wd-hero-copy">
            <span className="wd-eyebrow"><Sparkles size={13} /> {isPartner ? "TU PRÓXIMO TRABAJO" : "UNA MANO CONFIABLE, CERCA"}</span>
            <h1>{isPartner ? <>Trabajos buenos.<br /><em>Personas reales.</em></> : <>Encontrá a quien<br /><em>lo resuelve.</em></>}</h1>
            <p>{isPartner
              ? "Conectá con hogares de tu zona y elegí los trabajos que mejor van con vos."
              : "Profesionales de confianza para tu casa y tu día a día."}</p>
          </div>
          <div className="wd-hero-mark" aria-hidden="true">
            <span className="wd-orbit wd-orbit-one" />
            <span className="wd-orbit wd-orbit-two" />
            <span className="wd-spark"><Sparkles size={27} /></span>
            <span className="wd-hero-dot" />
          </div>
        </section>

        <div className="wd-search-area">
          <label className="wd-search-label" htmlFor="input-worky-search">
            {isPartner ? "Buscá trabajos por oficio o zona" : "¿Qué necesitás resolver?"}
          </label>
          <div className="wd-search-field">
            <Search size={19} aria-hidden="true" />
            <input
              id="input-worky-search"
              type="search"
              value={search}
              onChange={(event) => {
                const value = event.target.value;
                setSearch(value);
                if (!value.trim()) setScreenState("success");
              }}
              placeholder={isPartner ? "Ej. electricidad, Palermo…" : "Plomería, electricidad, pintura…"}
              autoCapitalize="none"
              autoComplete="off"
              data-testid="input-professional-search"
            />
            <button
              type="button"
              className="wd-filter-button"
              aria-label="Limpiar búsqueda"
              onClick={() => { setSearch(""); setScreenState("success"); setActiveCategory("Todos"); }}
              data-testid="button-clear-search"
            >
              {search ? <X size={16} /> : <SlidersHorizontal size={17} />}
            </button>
          </div>
        </div>

        {!isPartner ? (
          <button className="wd-primary-action" type="button" onClick={() => { setJobDialogOpen(true); setJobPosted(false); }} data-testid="button-post-job-home">
            <span className="wd-action-icon"><Plus size={20} /></span>
            <span className="wd-action-copy"><b>¿Necesitás una mano?</b><small>Publicá un trabajo gratis</small></span>
            <ArrowUpRight className="wd-action-arrow" size={19} />
          </button>
        ) : (
          <button className="wd-primary-action wd-partner-action" type="button" onClick={() => { setSearch(""); setActiveCategory("Todos"); setNotice("Mostrando oportunidades de tu zona."); }} data-testid="button-explore-jobs">
            <span className="wd-action-icon"><BriefcaseBusiness size={19} /></span>
            <span className="wd-action-copy"><b>Explorá trabajos cerca</b><small>Elegí los que van con vos</small></span>
            <ArrowUpRight className="wd-action-arrow" size={19} />
          </button>
        )}

        <section className="wd-discovery">
          <div className="wd-section-heading">
            <div>
              <span className="wd-section-kicker">{isPartner ? "OPORTUNIDADES ABIERTAS" : "GENTE QUE SABE"}</span>
              <h2>{isPartner ? "Trabajos para vos" : "Profesionales cerca"}</h2>
            </div>
            <span className="wd-result-count" aria-live="polite">{visibleCount} {visibleCount === 1 ? "resultado" : "resultados"}</span>
          </div>

          <div className="wd-categories" role="group" aria-label="Filtrar por oficio">
            {categories.map((category) => (
              <button
                key={category}
                className={activeCategory === category ? "is-selected" : ""}
                type="button"
                aria-pressed={activeCategory === category}
                onClick={() => setActiveCategory(category)}
                data-testid={`filter-${category.toLowerCase().replaceAll("í", "i")}`}
              >
                {category}
              </button>
            ))}
          </div>

          {screenState === "loading" ? (
            <StatePanel kind="loading" onRetry={retry} />
          ) : screenState === "error" ? (
            <StatePanel kind="error" onRetry={retry} />
          ) : isPartner ? (
            filteredJobs.length ? (
              <div className="wd-job-list">
                {filteredJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    interested={interestedJobs.includes(job.id)}
                    onInterest={() => {
                      setInterestedJobs((current) => current.includes(job.id)
                        ? current.filter((id) => id !== job.id)
                        : [...current, job.id]);
                      setNotice(interestedJobs.includes(job.id)
                        ? "Quitaste tu interés de este trabajo."
                        : "Interés guardado solo en esta vista de prueba.");
                    }}
                  />
                ))}
              </div>
            ) : (
              <StatePanel kind="empty" onRetry={() => { setSearch(""); setActiveCategory("Todos"); }} />
            )
          ) : filteredPros.length ? (
            <div className="wd-pro-list">
              {filteredPros.map((pro) => <ProfessionalCard key={pro.id} pro={pro} onOpen={setProfile} />)}
            </div>
          ) : (
            <StatePanel kind="empty" onRetry={() => { setSearch(""); setActiveCategory("Todos"); }} />
          )}
        </section>

        <footer className="wd-trust-note">
          <span className="wd-trust-icon"><ShieldCheck size={16} /></span>
          <span><b>Tu casa, en buenas manos.</b><small>Perfiles revisados y opiniones reales.</small></span>
          <CircleHelp size={16} aria-hidden="true" />
        </footer>
      </div>

      {notice ? <div className="wd-toast" role="status"><CheckCircle2 size={17} />{notice}</div> : null}

      {jobDialogOpen ? (
        <div className="wd-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setJobDialogOpen(false);
        }}>
          <section className="wd-dialog" role="dialog" aria-modal="true" aria-labelledby="wd-job-dialog-title">
            <button className="wd-dialog-close" type="button" onClick={() => setJobDialogOpen(false)} aria-label="Cerrar publicación" data-testid="button-close-job-dialog"><X size={19} /></button>
            {jobPosted ? (
              <div className="wd-success-view">
                <div className="wd-success-icon"><Check size={25} /></div>
                <span className="wd-modal-kicker">TRABAJO PREPARADO</span>
                <h2 id="wd-job-dialog-title">Ya diste el primer paso.</h2>
                <p>Tu pedido <b>“{jobTitle}”</b> está listo para publicar. En esta vista de prueba no se envía ni se publica nada.</p>
                <button className="wd-modal-submit" type="button" onClick={() => setJobDialogOpen(false)}>Volver a profesionales</button>
              </div>
            ) : (
              <>
                <span className="wd-modal-kicker">SIN COSTO · SIN COMPROMISO</span>
                <h2 id="wd-job-dialog-title">Contanos qué necesitás.</h2>
                <p className="wd-modal-intro">Te ayudamos a encontrar profesionales que puedan resolverlo.</p>
                <form className="wd-job-form" onSubmit={postJob}>
                  <label htmlFor="wd-job-title">¿Qué trabajo necesitás?</label>
                  <input id="wd-job-title" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder="Ej. Arreglar una canilla" required autoFocus />
                  <label htmlFor="wd-job-detail">Un poco más de detalle <span>(opcional)</span></label>
                  <textarea id="wd-job-detail" value={jobDetail} onChange={(event) => setJobDetail(event.target.value)} placeholder="Contanos qué está pasando…" rows={3} />
                  <button className="wd-modal-submit" type="submit" disabled={!jobTitle.trim()} data-testid="button-submit-job">
                    Preparar publicación gratis <ArrowRight size={17} />
                  </button>
                  <small className="wd-demo-disclaimer">Vista de demostración · no se contacta a nadie</small>
                </form>
              </>
            )}
          </section>
        </div>
      ) : null}

      {profile ? (
        <div className="wd-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setProfile(null);
        }}>
          <section className="wd-dialog wd-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="wd-profile-title">
            <button className="wd-dialog-close" type="button" onClick={() => setProfile(null)} aria-label="Cerrar perfil"><X size={19} /></button>
            <div className="wd-profile-portrait">
              <span className={`wd-avatar wd-avatar-large wd-avatar-${profile.tint}`}>{profile.initials}</span>
              <span className="wd-profile-portrait-copy">
                <span className="wd-profile-verified"><BadgeCheck size={15} /> Perfil verificado</span>
                <b id="wd-profile-title">{profile.name}</b>
                <small>{profile.oficio}</small>
              </span>
            </div>
            <div className="wd-profile-score">
              <span><Star size={16} fill="currentColor" /> <b>{profile.rating.toFixed(1)}</b> <small>({profile.reviews} opiniones)</small></span>
              <span><CheckCircle2 size={15} /> {profile.jobs} trabajos realizados</span>
            </div>
            <p className="wd-profile-about">{profile.about}</p>
            <div className="wd-profile-area"><MapPin size={15} />{profile.distance === null ? "Distancia no disponible" : `A ${profile.distance.toFixed(1)} km de tu zona`} <span>·</span> {profile.availability}</div>
            <button className="wd-modal-submit" type="button" onClick={() => { setProfile(null); setNotice(`Podés contactar a ${profile.name} después de publicar tu trabajo.`); }}>
              Consultar disponibilidad <ChevronRight size={17} />
            </button>
            <small className="wd-demo-disclaimer">La consulta no se envía en esta vista de prueba.</small>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default PremiumDiscovery;