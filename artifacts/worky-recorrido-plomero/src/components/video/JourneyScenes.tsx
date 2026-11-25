import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';
import workyLogo from '@assets/video-worky/worky-logo.png';

const EASE = [0.22, 1, 0.36, 1] as const;

function SceneFrame({ className, children }: { className: string; children: ReactNode }) {
  return (
    <motion.section
      className={`film-scene ${className}`}
      initial={{ opacity: 0, scale: 1.035 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.08, filter: 'blur(8px)' }}
      transition={{ duration: 0.52, ease: EASE }}
    >
      {children}
      <div className="illustrative-stamp">RECORRIDO ILUSTRATIVO · EJEMPLO DE USO</div>
    </motion.section>
  );
}

export function Scene01() {
  return (
    <SceneFrame className="cream-bg">
      <div className="s1-pipe" />
      <div className="s1-drop" />
      <div className="s1-ripple" />
      <div className="s1-plip display">PLIP.</div>
      <div className="worky-brand">WORKY / OFICIOS</div>
      <div className="s1-reflection"><div className="tiny-label" style={{ padding: '1.2vmin' }}>Tu solución empieza acá</div></div>
      <div className="s1-headline display">¿Una<br /><span className="orange">pérdida?</span></div>
      <div className="s1-sub">Encontrá un plomero con Worky.</div>
    </SceneFrame>
  );
}

export function Scene02() {
  const [published, setPublished] = useState(false);
  useSceneTimer([{ time: 3250, callback: () => setPublished(true) }]);
  return (
    <SceneFrame className="navy-bg">
      <div className="worky-brand">WORKY / NUEVO TRABAJO</div>
      <div className="s2-copy">
        <div className="eyebrow orange">1 — Elegí cómo empezar</div>
        <div className="s2-title display">Buscá<br />o publicá.</div>
        <div className="s2-caption">Encontrá un trabajo o publicá un pedido con los detalles del oficio que necesitás.</div>
        <div className="s2-options">
          <span>Buscar trabajo</span>
          <span>Publicar un pedido</span>
        </div>
      </div>
      <div className="s2-route" />
      <div className="s2-pin" />
      <div className="phone" style={{ animation: 'snap-in .65s cubic-bezier(.18,.86,.28,1.2) both' }}>
        <div className="phone-notch" />
        <div className="phone-top">
          <div className="tiny-label orange">Ejemplo de uso</div>
          <div className="phone-title" style={{ marginTop: '.6vmin' }}>Nuevo pedido</div>
        </div>
        <div className="phone-content">
          <div className="phone-section"><span className="phone-label">Oficio</span><div className="phone-field">Plomería <span style={{ float: 'right', color: '#f58224' }}>⌄</span></div></div>
          <div className="phone-section"><span className="phone-label">¿Qué necesitás resolver?</span><div className="phone-field" style={{ minHeight: '8.3vmin' }}>Contá qué necesitás resolver</div></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1vmin', margin: '1.5vmin 0' }}>
            <div className="photo-tile">＋</div><div><div style={{ fontSize: '1.45vmin', fontWeight: 800 }}>Fotos o ubicación</div><div style={{ fontSize: '1.15vmin', color: '#788090' }}>Detalles opcionales del pedido</div></div>
          </div>
          <div className="phone-section"><span className="phone-label">Descripción</span><div className="phone-field" style={{ color: '#8a909b' }}>Sumá los detalles que ayuden</div></div>
          <div className="phone-button">{published ? 'Ejemplo de publicación ✓' : 'Publicar pedido'}</div>
        </div>
      </div>
      <div className="s2-status" style={{ opacity: published ? 1 : 0, transform: published ? 'translateY(0)' : 'translateY(1vmin)', transition: 'opacity .3s, transform .3s' }}>Vista ilustrativa</div>
    </SceneFrame>
  );
}

export function Scene03() {
  const [revealed, setRevealed] = useState(0);
  useSceneTimer([
    { time: 1100, callback: () => setRevealed(1) },
    { time: 1900, callback: () => setRevealed(2) },
    { time: 2700, callback: () => setRevealed(3) },
  ]);
  const pros = [
    { name: 'Perfil de plomería', meta: 'Servicios · Descripción' },
    { name: 'Perfil de plomería', meta: 'Servicios · Experiencia' },
    { name: 'Perfil de plomería', meta: 'Servicios · Información' },
  ];
  return (
    <SceneFrame className="navy-bg">
      <div className="s3-map">
        <div className="map-street a" /><div className="map-street b" /><div className="map-street c" />
        <div className="map-block" style={{ left: '9%', top: '38%', width: '22%', height: '16%' }} />
        <div className="map-block" style={{ left: '60%', top: '15%', width: '25%', height: '19%' }} />
        <div className="map-block" style={{ left: '66%', top: '66%', width: '20%', height: '14%' }} />
        <div className="map-radius" /><div className="map-pin" />
        <div className="s3-label eyebrow">2 — Buscá y revisá</div>
        <div className="s3-copy"><div className="s3-head display">Encontrá<br />una opción.</div><div style={{ marginTop: '2vmin', color: '#d8dce3', fontSize: '1.8vmin' }}>Trabajos y perfiles de ejemplo</div></div>
      </div>
      <div className="s3-results">
        {pros.map((pro, index) => (
          <div key={index} className={`result-card ${index === 0 ? 'primary' : ''}`} style={{ opacity: revealed > index ? 1 : 0, animation: revealed > index ? `snap-in .42s ${index * .08}s both` : 'none', transform: index === 0 ? 'scale(1.04)' : undefined }}>
            <div className="avatar-mini" aria-hidden="true" />
            <div style={{ minWidth: 0 }}>
              <div className="result-name">{pro.name}</div>
              <div className="result-meta">{pro.meta}</div>
            </div>
            {index === 0 && <div className="result-open">Ver<br />perfil</div>}
          </div>
        ))}
      </div>
    </SceneFrame>
  );
}

export function Scene04() {
  return (
    <SceneFrame className="blue-bg">
      <div className="worky-brand">WORKY / PERFIL PROFESIONAL</div>
      <div className="s4-back-number">PERFIL</div>
      <div className="s4-note">Abrí el<br />perfil.</div>
      <div className="profile-card">
        <div className="profile-example">VISTA DE EJEMPLO</div>
        <div className="profile-top">
          <div className="profile-avatar" aria-hidden="true" />
          <div><div className="profile-name">Profesional</div><div className="profile-sub">Plomería</div></div>
        </div>
        <div className="profile-stats">
          <div className="stat-box"><div className="stat-number">Servicios</div><div className="stat-caption">qué ofrece</div></div>
          <div className="stat-box"><div className="stat-number">Info</div><div className="stat-caption">revisá el perfil</div></div>
        </div>
        <div className="tiny-label" style={{ color: '#6f7785', marginTop: '1.3vmin' }}>Antes de contactar</div>
        <div><span className="skill-chip">Servicios</span><span className="skill-chip">Descripción</span><span className="skill-chip">Experiencia</span></div>
        <div className="review-box"><span style={{ color: '#ab770e', fontWeight: 800 }}>01</span> Revisá la información que comparte el perfil.<div style={{ color: '#838a96', fontSize: '1.2vmin', marginTop: '.5vmin' }}>La información varía según cada profesional.</div></div>
        <div className="profile-message">Enviar mensaje</div>
        <div className="profile-guide">Podés conversar desde el chat asociado al trabajo.</div>
      </div>
    </SceneFrame>
  );
}

export function Scene05() {
  const [confirmed, setConfirmed] = useState(false);
  useSceneTimer([{ time: 2850, callback: () => setConfirmed(true) }]);
  return (
    <SceneFrame className="navy-bg">
      <div className="s5-title eyebrow">3 — Conversación y visita</div>
      <div className="s5-chat">
        <div className="chat-head">
          <div className="chat-avatar">W</div>
          <div><div className="chat-title">Chat del trabajo</div><div className="chat-status">Conversación asociada al pedido</div></div>
          <div style={{ marginLeft: 'auto', fontSize: '1.25vmin', color: '#778092' }}>Ejemplo</div>
        </div>
        <div className="chat-body">
          <div className="bubble incoming" style={{ animation: 'snap-in .45s .25s both' }}>Hola, vi tu pedido. ¿Podemos coordinar una visita?</div>
          <div className="bubble outgoing" style={{ animation: 'snap-in .45s 1.05s both' }}>Sí, conversemos el horario.</div>
          <div style={{ color: '#778092', fontSize: '1.35vmin', marginTop: '1vmin' }}>Acordá los detalles antes de empezar.</div>
        </div>
      </div>
      <div className="s5-calendar" style={{ animation: 'snap-in .6s 1.8s both' }}>
        <div className="calendar-top"><div className="calendar-icon">▦</div><div>COORDINACIÓN</div></div>
        <div className="calendar-day">Visita</div>
        <div className="calendar-time">A coordinar</div>
        <div style={{ height: '.2vmin', background: '#17223a22', margin: '1.6vmin 0' }} />
        <div style={{ fontSize: '1.45vmin', fontWeight: 700 }}>Definan los detalles<br />en la conversación.</div>
        <div className="calendar-confirm" style={{ opacity: confirmed ? 1 : 0, transition: 'opacity .35s' }}>Coordinen los detalles</div>
      </div>
    </SceneFrame>
  );
}

export function Scene06() {
  const [stage, setStage] = useState(0);
  useSceneTimer([
    { time: 800, callback: () => setStage(1) },
    { time: 1900, callback: () => setStage(2) },
    { time: 3050, callback: () => setStage(3) },
  ]);
  return (
    <SceneFrame className="cream-bg">
      <div className="worky-brand">WORKY / SEGUIMIENTO</div>
      <div className="s6-title display">Seguí.<br />Confirmá.<br /><span className="orange">Cerrá.</span></div>
      <div className="pipe-joint" style={{ animation: 'float-a 2s ease-in-out infinite' }} />
      <div className="work-rail" />
      <div className="work-rail-fill" style={{ transform: `scaleX(${stage >= 3 ? .9 : stage >= 2 ? .62 : stage >= 1 ? .36 : .08})`, transition: 'transform .65s cubic-bezier(.2,.8,.2,1)' }} />
      <div className="work-step one" /><div className="work-step two" /><div className="work-step three" />
      <div className="work-step-label step-label-one">Trabajo en curso</div>
      <div className="work-step-label step-label-two" style={{ opacity: stage >= 1 ? 1 : .45 }}>Trabajo realizado</div>
      <div className="work-step-label step-label-three" style={{ opacity: stage >= 2 ? 1 : .45 }}>{stage >= 3 ? 'Pago confirmado' : 'Confirmá el pago'}</div>
      <div className="receipt">
        <div className="receipt-head">ANTES DE CERRAR</div>
        <div className="receipt-state">{stage >= 3 ? 'Pago confirmado' : stage >= 2 ? 'Marcar pago confirmado' : 'Seguí el estado'}</div>
        <div className="receipt-check">{stage >= 3 ? '✓' : stage >= 2 ? '→' : '…'}</div>
      </div>
      <div className="review-stars">
        {['☆', '☆', '☆', '☆', '☆'].map((star, index) => <span key={index} className="review-star" style={{ opacity: stage >= 3 ? 1 : 0, transform: stage >= 3 ? 'scale(1)' : 'scale(.7)', transition: `opacity .3s ${index * .08}s, transform .3s ${index * .08}s` }}>{star}</span>)}
        <span className="review-copy" style={{ opacity: stage >= 3 ? 1 : .35 }}>Después de finalizar: reseñá tu experiencia</span>
      </div>
      <div className="s6-final">{stage >= 3 ? 'Trabajo finalizado' : 'Confirmá el pago antes de cerrar'}</div>
    </SceneFrame>
  );
}

export function Scene07() {
  return (
    <SceneFrame className="blue-bg">
      <div className="s7-band">
        <img className="s7-logo" src={workyLogo} alt="Worky" />
        <div className="s7-copy display">El oficio que<br />necesitás,<br /><span className="orange">más cerca.</span></div>
      </div>
      <div className="s7-tagline">BUSCÁ O PUBLICÁ · ABRÍ UN PERFIL · CONVERSÁ · CONFIRMÁ EL PAGO ANTES DE CERRAR · RESEÑÁ DESPUÉS</div>
      <div className="s7-loop-drop" />
      <div style={{ position: 'absolute', left: '9%', bottom: '7%', color: '#f9f6f099', fontSize: '1.3vmin', letterSpacing: '.16em', fontWeight: 800 }}>WORKY · PLATAFORMA DE OFICIOS</div>
    </SceneFrame>
  );
}
