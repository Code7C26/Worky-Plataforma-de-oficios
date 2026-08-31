import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <main className="grain flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[4px_4px_0_hsl(var(--accent))]">
          <Compass size={30} />
        </div>
        <p className="eyebrow mt-8">Parece que doblaste de más</p>
        <h1 className="display-font mt-3 text-5xl font-bold tracking-[-.07em]">404</h1>
        <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
          Esta página no existe o ya cambió de lugar. Volvamos a donde están las changas.
        </p>
        <Link href="/home" className="btn focus-ring mt-7 inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--secondary))] px-4 py-3 text-sm font-bold text-white" data-testid="link-not-found-home">
          <ArrowLeft size={16} /> Volver al inicio
        </Link>
      </div>
    </main>
  );
}