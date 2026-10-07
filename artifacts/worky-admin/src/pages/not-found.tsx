import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <main className="denied-wrap">
      <section className="panel denied-card" data-testid="page-not-found">
        <div className="empty-symbol"><Compass size={21} /></div>
        <p className="eyebrow">Error 404 · Worky</p>
        <h1>No encontramos esa sección.</h1>
        <p>La dirección puede haber cambiado o no estar disponible para tu espacio de trabajo.</p>
        <Link className="button button-primary" href="/" data-testid="link-not-found-home"><ArrowLeft size={14} /> Volver al inicio</Link>
      </section>
    </main>
  );
}
