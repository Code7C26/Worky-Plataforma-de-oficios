import { ChevronRight, MapPin, ShieldCheck, Star } from "lucide-react";

import "./_group.css";

const professional = {
  id: 42,
  name: "Marina Quiroga",
  initials: "MQ",
  trade: "Plomera",
  rating: 4.8,
  reviewsCount: 32,
  jobsCompleted: 61,
  experience: 8,
  price: 11000,
  distanceKm: 2.4,
  available: true,
  verified: true,
};

function money(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

export function Current() {
  return (
    <main className="worky-worker-preview">
      <div className="sample-card">
        <p className="preview-caption">Presentación actual · datos ilustrativos</p>
        <a
          href="#perfil"
          onClick={(event) => event.preventDefault()}
          className="current-card"
          aria-label={`Ver perfil de ${professional.name}`}
        >
          <div className="current-row">
            <div className="current-avatar" aria-hidden="true">{professional.initials}</div>
            <div className="current-copy">
              <div className="current-row" style={{ gap: 6 }}>
                <h2 className="display current-name">{professional.name}</h2>
                {professional.verified ? <ShieldCheck size={15} color="hsl(27 91% 55%)" aria-label="Profesional verificado" /> : null}
              </div>
              <p className="current-trade">{professional.trade}</p>
            </div>
            <span className="current-status">{professional.available ? "Disponible" : "No disponible"}</span>
          </div>
          <div className="current-meta">
            <span className="current-row" style={{ gap: 5 }}>
              <span className="current-rating">
                <Star className="current-star" size={13} fill="currentColor" aria-hidden="true" />
                {professional.rating.toFixed(1)}
              </span>
              <span className="current-muted">({professional.reviewsCount} reseñas)</span>
            </span>
            <span className="current-muted">{professional.experience} años de experiencia</span>
            <span className="current-row current-muted" style={{ gap: 5 }}>
              <MapPin size={13} aria-hidden="true" /> {professional.distanceKm.toFixed(1)} km aprox.
            </span>
            <span className="current-muted">{professional.jobsCompleted} trabajos realizados</span>
          </div>
          <div className="current-footer">
            <span>
              <span className="current-muted" style={{ display: "block", fontSize: 10 }}>Consulta / visita</span>
              <strong className="display" style={{ display: "block", marginTop: 3, fontSize: 18 }}>{money(professional.price)}</strong>
            </span>
            <span className="current-row" style={{ gap: 4, fontSize: 12, fontWeight: 700, color: "hsl(215 45% 23%)" }}>
              Ver perfil <ChevronRight size={15} aria-hidden="true" />
            </span>
          </div>
        </a>
      </div>
    </main>
  );
}
