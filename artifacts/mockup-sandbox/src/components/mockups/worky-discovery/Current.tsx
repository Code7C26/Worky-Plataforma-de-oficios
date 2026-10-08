import { useMemo, useState } from "react";
import { CheckCircle, Plus, Search, Star, WifiOff, ArrowUpRight } from "lucide-react";

import "./_group.css";

type ScreenState = "loading" | "error" | "success";

type Professional = {
  id: number;
  oficio: string;
  categoria: string;
  verificado: boolean;
  about: string | null;
  rating: number;
  reviewsCount: number;
  completedJobs: number;
  distanceKm: number | null;
  usuario: {
    id: number;
    nombre: string;
    fotoObjectPath: string | null;
  };
};

const professionals: Professional[] = [
  {
    id: 101,
    oficio: "Electricista",
    categoria: "Electricidad",
    verificado: true,
    about: "Instalaciones seguras, reparaciones y mantenimiento para tu hogar.",
    rating: 4.9,
    reviewsCount: 38,
    completedJobs: 64,
    distanceKm: 2.4,
    usuario: { id: 21, nombre: "Martín Ríos", fotoObjectPath: null },
  },
  {
    id: 102,
    oficio: "Plomera",
    categoria: "Plomería",
    verificado: true,
    about: "Soluciones rápidas para pérdidas, griferías y redes de agua.",
    rating: 4.8,
    reviewsCount: 27,
    completedJobs: 51,
    distanceKm: 4.1,
    usuario: { id: 22, nombre: "Lucía Ferreyra", fotoObjectPath: null },
  },
  {
    id: 103,
    oficio: "Pintor",
    categoria: "Pintura",
    verificado: false,
    about: "Pintura interior y exterior con terminaciones prolijas.",
    rating: 4.7,
    reviewsCount: 19,
    completedJobs: 35,
    distanceKm: null,
    usuario: { id: 23, nombre: "Nicolás Acosta", fotoObjectPath: null },
  },
];

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function StateMessage({
  icon,
  title,
  message,
  action,
}: {
  icon: "search" | "wifi";
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="state">
      <div className="state-icon" aria-hidden="true">
        {icon === "search" ? <Search size={22} /> : <WifiOff size={22} />}
      </div>
      <strong className="heading">{title}</strong>
      <p className="body muted state-message">{message}</p>
      {action ? <button className="retry" onClick={action.onClick}>{action.label}</button> : null}
    </div>
  );
}

export function Current() {
  const [search, setSearch] = useState("");
  const [screenState, setScreenState] = useState<ScreenState>("success");

  const filteredProfessionals = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return professionals;
    return professionals.filter((professional) =>
      [professional.usuario.nombre, professional.oficio, professional.categoria]
        .some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [search]);

  return (
    <main className="worky-discovery">
      <div className="screen stack">
        <header className="brand-row" aria-label="Worky">
          <div className="brand-plate">
            <span className="brand-mark">w</span>
            <span className="brand-name">worky</span>
          </div>
          <span className="caption">Oficios confiables, cerca tuyo</span>
        </header>

        <section className="stack" style={{ gap: 10 }}>
          <h1 className="title">Encontrá a quien lo resuelve.</h1>
          <p className="body muted" style={{ margin: 0 }}>Profesionales de confianza para tu casa y tu día a día.</p>
        </section>

        <label className="field-wrap" htmlFor="input-professional-search">
          <span className="label field-label">Buscar un oficio</span>
          <input
            id="input-professional-search"
            className="field"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Plomería, electricidad, pintura…"
            autoCapitalize="none"
            type="search"
          />
        </label>

        <button className="post-job" onClick={() => undefined} data-testid="button-post-job-home">
          <span className="post-icon" aria-hidden="true"><Plus size={21} /></span>
          <span className="post-copy">
            <span className="label">¿Necesitás una mano?</span>
            <span className="caption">Publicá un trabajo gratis</span>
          </span>
          <ArrowUpRight className="post-arrow" size={18} aria-hidden="true" />
        </button>

        <div className="section-row">
          <h2 className="heading" style={{ margin: 0 }}>Profesionales</h2>
          <span className="caption">{filteredProfessionals.length} resultados</span>
        </div>

        {screenState === "loading" ? (
          <StateMessage icon="search" title="Buscando perfiles" message="Estamos cargando profesionales disponibles." />
        ) : screenState === "error" ? (
          <StateMessage
            icon="wifi"
            title="No cargó la búsqueda"
            message="Probá de nuevo en unos segundos."
            action={{ label: "Reintentar", onClick: () => setScreenState("success") }}
          />
        ) : filteredProfessionals.length === 0 ? (
          <StateMessage
            icon="search"
            title="Todavía no hay resultados"
            message={search ? "Probá con otro oficio o nombre." : "No encontramos perfiles para mostrar por ahora."}
          />
        ) : (
          <div className="cards">
            {filteredProfessionals.map((professional) => (
              <button
                className="professional-card"
                key={professional.id}
                onClick={() => undefined}
                data-testid={`card-professional-${professional.id}`}
              >
                <div className="person-row">
                  <div className="avatar" aria-hidden="true">{initials(professional.usuario.nombre)}</div>
                  <div className="person-copy">
                    <strong className="heading person-name">{professional.usuario.nombre}</strong>
                    <span className="caption">{professional.oficio} · {professional.categoria}</span>
                  </div>
                  {professional.verificado ? <CheckCircle className="verified" size={19} aria-label="Verificado" /> : null}
                </div>
                <p className="body about">{professional.about || "Perfil profesional en Worky."}</p>
                <div className="meta-row">
                  <span className="rating">
                    <Star className="star" size={14} fill="currentColor" aria-hidden="true" />
                    <strong className="label">{professional.rating.toFixed(1)}</strong>
                    <span className="caption">({professional.reviewsCount})</span>
                  </span>
                  <span className="caption">{professional.completedJobs} trabajos</span>
                  {professional.distanceKm != null ? <span className="caption">{professional.distanceKm.toFixed(1)} km</span> : null}
                  <span className="profile-link label">Ver perfil</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}