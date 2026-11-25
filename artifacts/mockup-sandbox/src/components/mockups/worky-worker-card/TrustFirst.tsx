import { BriefcaseBusiness, ChevronRight, Heart, MapPin, ShieldCheck, Star } from "lucide-react";

import "./_group.css";

const professional = {
  id: 42,
  name: "Marina Quiroga",
  initials: "MQ",
  trade: "Plomera",
  category: "Plomería",
  rating: 4.8,
  reviewsCount: 32,
  jobsCompleted: 61,
  experience: 8,
  price: 11000,
  distanceKm: 2.4,
  available: true,
  verified: true,
  recommendationsCount: 14,
  bio: "Reparaciones de agua y desagües con atención clara para tu hogar.",
  skills: ["Pérdidas", "Baños", "Desagües"],
};

function money(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

export function TrustFirst() {
  const ratingLabel = professional.reviewsCount
    ? `${professional.rating.toFixed(1)} de 5, ${professional.reviewsCount} reseñas`
    : "Sin reseñas todavía";

  return (
    <main className="worky-worker-preview">
      <div className="sample-card">
        <p className="preview-caption">Propuesta · confianza visible · datos ilustrativos</p>
        <a
          href="#perfil"
          onClick={(event) => event.preventDefault()}
          className="trust-card"
          aria-label={`Ver perfil de ${professional.name}, ${professional.trade}`}
        >
          <div className="trust-head">
            <div className="trust-avatar" aria-hidden="true">{professional.initials}</div>
            <div className="trust-identity">
              <h2 className="trust-name">{professional.name}</h2>
              <p className="trust-trade">{professional.trade} · {professional.category}</p>
            </div>
            <div className="trust-badges">
              {professional.verified ? (
                <span className="trust-badge">
                  <ShieldCheck size={12} aria-hidden="true" /> Verificado
                </span>
              ) : null}
              <span className={`trust-available ${professional.available ? "" : "trust-unavailable"}`}>
                {professional.available ? "Disponible" : "No disponible"}
              </span>
            </div>
          </div>

          {professional.bio ? <p className="trust-about">{professional.bio}</p> : null}

          {professional.skills.length ? (
            <div className="trust-skills" aria-label="Especialidades">
              {professional.skills.slice(0, 3).map((skill) => <span className="trust-skill" key={skill}>{skill}</span>)}
            </div>
          ) : null}

          <div className="trust-metrics" aria-label="Experiencia y reputación">
            <div className="trust-metric">
              <span className="trust-metric-value">
                {professional.reviewsCount ? (
                  <><Star size={14} fill="currentColor" color="hsl(27 91% 55%)" aria-hidden="true" /> {professional.rating.toFixed(1)}</>
                ) : "—"}
              </span>
              <span className="trust-metric-label">{professional.reviewsCount ? `${professional.reviewsCount} reseñas` : "Sin reseñas"}</span>
            </div>
            <div className="trust-metric">
              <span className="trust-metric-value"><BriefcaseBusiness size={14} color="hsl(27 91% 55%)" aria-hidden="true" /> {professional.jobsCompleted}</span>
              <span className="trust-metric-label">trabajos realizados</span>
            </div>
            <div className="trust-metric">
              <span className="trust-metric-value">{professional.experience}</span>
              <span className="trust-metric-label">{professional.experience === 1 ? "año de experiencia" : "años de experiencia"}</span>
            </div>
          </div>

          <div className="trust-proofline">
            {professional.recommendationsCount > 0 ? (
              <span className="trust-recommendations">
                <Heart size={13} fill="currentColor" aria-hidden="true" />
                {professional.recommendationsCount} recomendaciones
              </span>
            ) : <span />}
            <span className="trust-distance">
              <MapPin size={12} aria-hidden="true" />
              {professional.distanceKm != null ? `${professional.distanceKm.toFixed(1)} km aprox.` : "Distancia no disponible"}
            </span>
          </div>

          <div className="trust-footer">
            <span>
              <span className="trust-price-label">Consulta / visita</span>
              <strong className="trust-price">{professional.price > 0 ? money(professional.price) : "A consultar"}</strong>
            </span>
            <span className="trust-cta">Ver perfil <ChevronRight size={15} aria-hidden="true" /></span>
          </div>
        </a>
      </div>
    </main>
  );
}
