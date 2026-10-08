import './_group.css';
import { Activity, Briefcase, ChevronRight, MessageCircle, Search, UserRound } from 'lucide-react';

const mockConversations = [
  {
    changaId: 101,
    name: 'Sol Acosta',
    category: 'Pintura',
    preview: 'Genial, ¿a qué hora pasás mañana?',
    updatedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
    unread: 2,
  },
  {
    changaId: 102,
    name: 'Andrés Sánchez',
    category: 'Plomería',
    preview: 'Te mandé la ubicación del domicilio.',
    updatedAt: new Date(Date.now() - 28 * 60 * 60_000).toISOString(),
    unread: 1,
  },
  {
    changaId: 103,
    name: 'Ana Poyet',
    category: 'Electricidad',
    preview: 'Gracias, ya quedó todo funcionando.',
    updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
    unread: 0,
  },
  {
    changaId: 104,
    name: 'Familia Ríos',
    category: 'Jardinería',
    preview: 'Mañana te confirmo el horario.',
    updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
    unread: 0,
  },
  {
    changaId: 105,
    name: 'María López',
    category: 'Carpintería',
    preview: 'Me encantó el trabajo, muchas gracias.',
    updatedAt: new Date(Date.now() - 4 * 24 * 60 * 60_000).toISOString(),
    unread: 0,
  },
];

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function formatCurrentDate(value: string) {
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(new Date(value));
}

function BottomNavigation() {
  const items = [
    { label: 'Buscar', Icon: Search },
    { label: 'Actividad', Icon: Activity },
    { label: 'Trabajos', Icon: Briefcase, center: true },
    { label: 'Mensajes', Icon: MessageCircle, active: true },
    { label: 'Perfil', Icon: UserRound },
  ];

  return (
    <div className="bottom-nav-shell">
      <nav className="bottom-nav" aria-label="Navegación principal de Worky">
        {items.map(({ label, Icon, center, active }) => (
          <button
            key={label}
            type="button"
            className={`nav-item ${center ? 'nav-item-center' : ''} ${active ? 'nav-item-active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {center ? (
              <>
                <span className="nav-center"><Icon size={22} strokeWidth={2.2} /></span>
                <span className="nav-label nav-center-label">{label}</span>
              </>
            ) : (
              <>
                <span className="nav-icon"><Icon size={20} strokeWidth={2} /></span>
                <span className="nav-label">{label}</span>
              </>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

export function Current() {
  return (
    <div className="worky-conversations">
      <main className="mobile-frame screen">
        <header className="page-header">
          <p className="eyebrow">En contacto</p>
          <h1 className="title">Mensajes</h1>
          <p className="description">Coordiná cada trabajo desde una conversación.</p>
        </header>

        <section className="current-list" aria-label="Conversaciones recientes">
          {mockConversations.map((conversation) => (
            <button
              key={conversation.changaId}
              type="button"
              className="current-row"
              aria-label={`Abrir conversación con ${conversation.name}`}
            >
              <span className="avatar" aria-hidden="true">{initials(conversation.name)}</span>
              <span className="current-copy">
                <span className="current-topline">
                  <span className="person-name">{conversation.name}</span>
                  <time className="timestamp">{formatCurrentDate(conversation.updatedAt)}</time>
                </span>
                <span className="category current-category">{conversation.category}</span>
                <span className="preview">{conversation.preview}</span>
              </span>
              {conversation.unread > 0 ? (
                <span className="current-badge" aria-label={`${conversation.unread} sin leer`}>{conversation.unread}</span>
              ) : (
                <ChevronRight className="chevron" size={18} aria-hidden="true" />
              )}
            </button>
          ))}
        </section>
      </main>
      <BottomNavigation />
    </div>
  );
}