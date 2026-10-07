import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { FormEvent, ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, ChevronRight, LogOut, Menu, X } from 'lucide-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { DashboardPage, HouseholdsPage, CategoriesPage, ProfessionalsPage, RequestsPage, WelcomePage, navItems } from './pages';
import {
  clearWorkyToken,
  getCurrentWorkyUser,
  getWorkyToken,
  loginWorkyAdmin,
  logoutWorkySession,
  setWorkyToken,
} from './lib/admin-api';
import type { AdminUser } from './lib/admin-api';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
type SessionValue = {
  user: AdminUser | null;
  ready: boolean;
  message: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};
const SessionContext = createContext<SessionValue | null>(null);

function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    const token = getWorkyToken();
    if (!token) {
      setReady(true);
      return () => { alive = false; };
    }
    getCurrentWorkyUser()
      .then((account) => {
        if (!alive) return;
        if (account.rol !== 'admin') {
          client.clear();
          setMessage('Esta cuenta no tiene acceso al panel de administración.');
          return;
        }
        setUser(account);
      })
      .catch(() => {
        if (alive && getWorkyToken()) {
          setMessage('No pudimos validar tu sesión. Intentá nuevamente en unos minutos.');
        }
      })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [client]);

  useEffect(() => {
    const expire = () => {
      clearWorkyToken();
      client.clear();
      setUser(null);
      setMessage('La sesión venció. Ingresá de nuevo.');
    };
    window.addEventListener('worky:session-expired', expire);
    return () => window.removeEventListener('worky:session-expired', expire);
  }, [client]);

  const login = useCallback(async (email: string, password: string) => {
    setMessage('');
    const result = await loginWorkyAdmin(email, password);
    if (result.usuario.rol !== 'admin') {
      throw new Error('La cuenta no tiene permisos para ingresar al panel.');
    }
    client.clear();
    setWorkyToken(result.token);
    setUser(result.usuario);
    setReady(true);
  }, [client]);

  const logout = useCallback(() => {
    logoutWorkySession();
    client.clear();
    setUser(null);
    setMessage('');
  }, [client]);

  return <SessionContext.Provider value={{ user, ready, message, login, logout }}>{children}</SessionContext.Provider>;
}

function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('SessionProvider is missing.');
  return session;
}

function SignInPage() {
  const { login, ready, user, message } = useSession();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { if (ready && user) setLocation('/dashboard', { replace: true }); }, [ready, user, setLocation]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      setLocation('/dashboard');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo iniciar sesión.');
    } finally {
      setSubmitting(false);
    }
  };
  return <main className="sign-screen">
    <div className="sign-context">
      <Link className="brand" href="/" data-testid="link-signin-brand"><span className="brand-mark">w</span><span><span className="brand-name">worky</span><span className="brand-caption">operaciones</span></span></Link>
      <p className="eyebrow">Administración · Argentina</p>
      <h1>La coordinación<br />también es un oficio.</h1>
      <p>Entrá con tu cuenta Worky para gestionar solicitudes y habilitaciones.</p>
      <Link href="/" className="sign-home-link" data-testid="link-signin-home">Volver al inicio <ArrowRight size={14} /></Link>
    </div>
    <div className="sign-card-wrap">
      <section className="sign-card panel">
        <p className="eyebrow">Acceso del equipo</p>
        <h2>Hola de nuevo</h2>
        <p className="sign-card-copy">Ingresá con las credenciales de tu cuenta administrativa Worky.</p>
        <form className="sign-form" onSubmit={submit}>
          <label><span className="field-label">Correo electrónico</span><input className="field-input" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@ejemplo.com" data-testid="input-admin-email" /></label>
          <label><span className="field-label">Contraseña</span><input className="field-input" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} data-testid="input-admin-password" /></label>
          {(error || message) && <div className="alert" role="alert">{error || message}</div>}
          <button className="button button-primary sign-submit" type="submit" disabled={submitting}>{submitting ? 'Ingresando…' : 'Ingresar al panel'} <ArrowRight size={15} /></button>
        </form>
        <p className="sign-card-foot">Acceso exclusivo para cuentas Worky con rol administrador.</p>
      </section>
    </div>
  </main>;
}

function PrivateRoute({ component: Component }: { component: () => ReactElement }) {
  const { ready, user } = useSession();
  if (!ready) return <main className="page-wrap"><div className="panel loading-stack"><div className="skeleton" style={{ width: '32%' }} /><div className="skeleton" style={{ width: '70%' }} /><div className="skeleton" style={{ width: '58%' }} /></div></main>;
  if (!user) return <Redirect to="/sign-in" />;
  return <AppShell><Component /></AppShell>;
}

function HomeRoute() {
  const { ready, user, message } = useSession();
  if (!ready) return <WelcomePage />;
  if (user?.rol === 'admin') return <Redirect to="/dashboard" />;
  if (message && getWorkyToken()) return <Redirect to="/sign-in" />;
  return <WelcomePage />;
}

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, logout } = useSession();
  const active = navItems.find((item) => item.href === location);
  const currentDate = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date());
  const userInitial = (user?.nombre || user?.email || 'W').slice(0, 1).toUpperCase();
  return <div className="app-shell">
    {menuOpen && <button className="mobile-backdrop" aria-label="Cerrar navegación" onClick={() => setMenuOpen(false)} data-testid="button-close-menu-backdrop" />}
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <Link href="/dashboard" className="brand" onClick={() => setMenuOpen(false)} data-testid="link-sidebar-brand"><span className="brand-mark">w</span><span><span className="brand-name">worky</span><span className="brand-caption">operaciones</span></span></Link>
      <div className="nav-label">Espacio de trabajo</div>
      <nav className="nav-list" aria-label="Secciones de administración">
        {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href ? 'active' : ''}`} onClick={() => setMenuOpen(false)} data-testid={`link-nav-${href.slice(1)}`}><Icon size={16} strokeWidth={1.8} /><span>{label}</span>{location === href && <ChevronRight className="nav-count" size={14} />}</Link>)}
      </nav>
      <div className="sidebar-foot"><span className="live-mark" />Panel conectado<br /><span style={{ paddingLeft: 14 }}>Datos en tiempo real desde Worky</span></div>
    </aside>
    <div className="main-area">
      <header className="topbar">
        <button className="menu-toggle" aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} onClick={() => setMenuOpen((value) => !value)} data-testid="button-toggle-menu">{menuOpen ? <X size={19} /> : <Menu size={19} />}</button>
        <div className="crumb"><span>Worky</span><ChevronRight size={13} /><strong>{active?.label || 'Operaciones'}</strong></div>
         <div className="topbar-right"><span className="date-chip"><CalendarDays size={12} /> {currentDate}</span><span className="user-dot" aria-label={`Cuenta de ${user?.nombre || 'equipo'}`} title={user?.email}>{userInitial}</span><button className="icon-button" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={logout} data-testid="button-sign-out"><LogOut size={14} /></button></div>
      </header>
      {children}
    </div>
  </div>;
}

function RouterContent() {
  return <QueryClientProvider client={queryClient}>
    <SessionProvider>
      <TooltipProvider>
        <ErrorBoundary>
          <Switch>
            <Route path="/" component={HomeRoute} />
            <Route path="/sign-in" component={SignInPage} />
            <Route path="/dashboard">{() => <PrivateRoute component={DashboardPage} />}</Route>
            <Route path="/professionals">{() => <PrivateRoute component={ProfessionalsPage} />}</Route>
            <Route path="/households">{() => <PrivateRoute component={HouseholdsPage} />}</Route>
            <Route path="/requests">{() => <PrivateRoute component={RequestsPage} />}</Route>
            <Route path="/categories">{() => <PrivateRoute component={CategoriesPage} />}</Route>
            <Route component={NotFound} />
          </Switch>
        </ErrorBoundary>
        <Toaster />
      </TooltipProvider>
    </SessionProvider>
  </QueryClientProvider>;
}

function App() {
  return <WouterRouter base={basePath}><RouterContent /></WouterRouter>;
}

export default App;
