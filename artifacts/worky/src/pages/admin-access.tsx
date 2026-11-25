import { useState, type FormEvent } from "react";
import { ArrowLeft, LoaderCircle, MailCheck, ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import { PasswordInput } from "@/components/password-input";
import {
  completeAdminSignup,
  requestAdminSignupCode,
  type AuthUser,
} from "@/lib/api";

type Props = {
  user: AuthUser;
  onPromoted: () => Promise<void>;
};

export function AdminAccessPage({ user, onPromoted }: Props) {
  const [name, setName] = useState(user.nombre);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [busy, setBusy] = useState<"request" | "complete" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const sendCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy("request");
    const normalizedEmail = email.trim().toLowerCase();
    try {
      await requestAdminSignupCode(normalizedEmail);
      setEmail(normalizedEmail);
      setCodeRequested(true);
      setNotice("Si el correo está habilitado y el envío está disponible, vas a recibir un código. Revisá también la carpeta de spam.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos solicitar el código.");
    } finally {
      setBusy(null);
    }
  };

  const completeSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy("complete");
    try {
      const account = await completeAdminSignup({
        nombre: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        codigo: code,
      });
      if (account.rol !== "admin") {
        throw new Error("El servidor no confirmó el rol administrador. No se abrió el panel.");
      }
      await onPromoted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos activar el acceso administrador.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="grain flex min-h-[100dvh] items-center justify-center bg-[#f5f2e9] px-4 py-10 text-[#293a44]">
      <section className="w-full max-w-xl rounded-3xl border border-[#e4dfd2] bg-[#fffdf8] p-6 shadow-[0_12px_40px_rgba(34,48,59,.08)] sm:p-9" data-testid="admin-access">
        <div className="flex items-center gap-2 font-bold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#233a49] text-[#f3b252]">W</span>
          Worky <span className="text-xs font-medium text-[#7b8589]">Admin</span>
        </div>

        <div className="mt-8 flex gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f7e9c8] text-[#8a5a10]">
            <ShieldAlert size={20} />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[.12em] text-[#9a6530]">Acceso restringido</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Tu cuenta todavía no es administradora</h1>
            <p className="mt-2 text-sm leading-relaxed text-[#68747d]">
              Para habilitar el acceso, el correo debe estar autorizado por Worky y confirmarse con un código de un solo uso.
            </p>
          </div>
        </div>

        {!codeRequested ? (
          <form onSubmit={sendCode} className="mt-7 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold">Correo de Worky</span>
              <input
                type="email"
                required
                maxLength={320}
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-[#d8d2c4] bg-white px-3.5 py-3 text-sm outline-none focus:border-[#e87836] focus:ring-2 focus:ring-[#e87836]/20"
                data-testid="input-admin-access-email"
              />
            </label>
            {error && <p role="alert" className="text-sm font-semibold text-[#a23f35]" data-testid="admin-access-error">{error}</p>}
            {notice && <p role="status" className="rounded-xl border border-[#b8d7c1] bg-[#e7f2ea] p-3 text-sm font-semibold text-[#276544]" data-testid="admin-access-notice">{notice}</p>}
            <button
              type="submit"
              disabled={busy !== null}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#243b49] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#314c5b] disabled:cursor-wait disabled:opacity-60"
              data-testid="button-request-admin-code"
            >
              {busy === "request" ? <LoaderCircle size={17} className="animate-spin" /> : <MailCheck size={17} />}
              Solicitar código
            </button>
          </form>
        ) : (
          <form onSubmit={completeSignup} className="mt-7 space-y-4">
            <div className="rounded-xl border border-[#d8e8dc] bg-[#eef6f0] p-3 text-sm leading-relaxed text-[#356447]" role="status" data-testid="admin-access-notice">
              {notice}
              <span className="mt-1 block text-xs">El código vence en 15 minutos y se puede usar una sola vez.</span>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold">Nombre</span>
              <input
                required
                minLength={2}
                maxLength={100}
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-xl border border-[#d8d2c4] bg-white px-3.5 py-3 text-sm outline-none focus:border-[#e87836] focus:ring-2 focus:ring-[#e87836]/20"
                data-testid="input-admin-access-name"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold">Correo autorizado</span>
              <input
                type="email"
                required
                maxLength={320}
                value={email}
                readOnly
                className="w-full rounded-xl border border-[#d8d2c4] bg-[#f7f5ef] px-3.5 py-3 text-sm text-[#68747d]"
                data-testid="input-admin-access-email-locked"
              />
            </label>
            <div>
              <label htmlFor="input-admin-access-password" className="mb-1.5 block text-xs font-bold">Contraseña de Worky</label>
              <PasswordInput
                id="input-admin-access-password"
                required
                minLength={6}
                maxLength={200}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-[#d8d2c4] bg-white px-3.5 py-3 text-sm outline-none focus:border-[#e87836] focus:ring-2 focus:ring-[#e87836]/20"
                data-testid="input-admin-access-password"
              />
              <span className="mt-1 block text-xs leading-relaxed text-[#68747d]">
                Si tu cuenta ya existe, ingresá su contraseña actual. Para crear una cuenta nueva, usá una contraseña de al menos 12 caracteres.
              </span>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold">Código de 6 dígitos</span>
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="w-full rounded-xl border border-[#d8d2c4] bg-white px-3.5 py-3 text-center font-mono text-lg tracking-[.35em] outline-none focus:border-[#e87836] focus:ring-2 focus:ring-[#e87836]/20"
                data-testid="input-admin-access-code"
              />
            </label>
            {error && <p role="alert" className="text-sm font-semibold text-[#a23f35]" data-testid="admin-access-error">{error}</p>}
            <button
              type="submit"
              disabled={busy !== null || code.length !== 6}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#243b49] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#314c5b] disabled:cursor-wait disabled:opacity-60"
              data-testid="button-complete-admin-signup"
            >
              {busy === "complete" ? <LoaderCircle size={17} className="animate-spin" /> : <MailCheck size={17} />}
              Confirmar código y abrir Admin
            </button>
            <button
              type="button"
              onClick={() => {
                setCodeRequested(false);
                setPassword("");
                setCode("");
                setNotice("");
                setError("");
              }}
              disabled={busy !== null}
              className="w-full rounded-xl px-4 py-2 text-sm font-bold text-[#52636c] hover:bg-[#f3efe5] disabled:opacity-50"
              data-testid="button-change-admin-email"
            >
              Usar otro correo
            </button>
          </form>
        )}

        <Link href="/home" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[#52636c] hover:text-[#243b49]" data-testid="link-back-to-worky">
          <ArrowLeft size={16} /> Volver a Worky
        </Link>
        <p className="mt-5 border-t border-[#eee9de] pt-4 text-xs leading-relaxed text-[#748087]">
          El servidor valida el permiso, el código de un solo uso y la contraseña de la cuenta existente. Los cambios de rol quedan auditados.
        </p>
      </section>
    </main>
  );
}
