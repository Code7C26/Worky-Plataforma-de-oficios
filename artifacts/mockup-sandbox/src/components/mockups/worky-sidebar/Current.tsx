import './_group.css';
import { BriefcaseBusiness, ChevronRight, LockKeyhole, MessageCircle, Search, Settings } from 'lucide-react';

function WorkyBrand() {
  return (
    <a href="#" aria-label="Worky" className="flex items-center">
      <img src="/__mockup/ads/worky-sidebar-logo.png" alt="Worky" className="h-10 w-[124px] object-contain object-left" />
    </a>
  );
}

function AccountAvatar() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--accent))] text-[.68rem] font-bold text-[hsl(var(--foreground))]" aria-hidden="true">
      CT
    </span>
  );
}

export function Current() {
  const navItems = [
    { label: 'Encontrar profesionales', icon: Search, active: false },
    { label: 'Mis changas', icon: BriefcaseBusiness, active: false },
    { label: 'Conversaciones', icon: MessageCircle, active: true },
  ];

  return (
    <div className="worky-sidebar">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-[258px] flex-col overflow-hidden px-5 py-6 text-[hsl(var(--sidebar-foreground))]">
        <div className="brand-surface -mx-5 -mt-6 mb-6 flex min-h-[68px] items-center justify-between px-5 py-3">
          <WorkyBrand />
        </div>

        <div className="mb-5 rounded-2xl border border-white/10 bg-white/[.06] p-3">
          <div className="flex items-center gap-3">
            <AccountAvatar />
            <div className="min-w-0">
              <p className="truncate text-xs font-bold">Camila Torres</p>
              <p className="mt-0.5 text-[11px] text-white/55">Cliente</p>
            </div>
          </div>
          <button type="button" className="focus-ring mt-3 flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[.04] px-2.5 py-2 text-[11px] font-bold text-[hsl(var(--accent))]">
            Cambiar a Profesional <ChevronRight size={13} />
          </button>
        </div>

        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.17em] text-white/35">Tu espacio</p>
        <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto" aria-label="Navegación principal">
          {navItems.map(({ label, icon: Icon, active }) => (
            <a
              key={label}
              href="#"
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${active ? 'bg-[hsl(var(--sidebar-accent))] text-white' : 'text-white/65 hover:bg-white/[.07] hover:text-white'}`}
            >
              <Icon size={18} strokeWidth={active ? 2.5 : 2} />
              <span>{label}</span>
              {label === 'Mis changas' && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />}
            </a>
          ))}
        </nav>

        <div className="mt-4 mb-2">
          <a href="#" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white/65">
            <Settings size={18} /><span>Configuración</span>
          </a>
        </div>
        <button type="button" className="mt-1 flex items-center gap-2 px-3 pb-1 text-xs font-bold text-white/45">
          <LockKeyhole size={14} /> Salir de Worky
        </button>
      </aside>
      <div className="ml-[258px] min-h-screen bg-[hsl(var(--background))]" aria-hidden="true" />
    </div>
  );
}
