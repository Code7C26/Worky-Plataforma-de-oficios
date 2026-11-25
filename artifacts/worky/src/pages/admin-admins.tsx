import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/api";

type ManagedAdmin = { id: number; name: string; email: string; emailVerifiedAt: string | null; createdAt: string };
type AdminList = { isPrimaryAdmin: boolean; primaryAdminId: number | null; items: ManagedAdmin[] };
type Props = { onMessage: (type: "success" | "error", text: string) => void };

export function AdminAdminsPanel({ onMessage }: Props) {
  const [data, setData] = useState<AdminList | null>(null);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => setData(await apiRequest<AdminList>("/admin/admins")), []);
  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo cargar la lista.")); }, [load]);
  const grant = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      await apiRequest("/admin/cuentas/rol", { method: "PATCH", body: JSON.stringify({ email, motivo: reason }) });
      setEmail(""); setReason(""); await load(); onMessage("success", "Administrador delegado correctamente.");
    } catch (error) { onMessage("error", error instanceof Error ? error.message : "No se pudo delegar el rol."); }
    finally { setBusy(false); }
  };
  const revoke = async (admin: ManagedAdmin) => {
    const reason = window.prompt(`Motivo para quitar el rol de ${admin.name} (mínimo 5 caracteres):`);
    if (!reason || reason.trim().length < 5) return;
    setBusy(true);
    try {
      await apiRequest(`/admin/admins/${admin.id}/role`, { method: "PATCH", body: JSON.stringify({ reason }) });
      await load(); onMessage("success", "Rol admin quitado.");
    } catch (error) { onMessage("error", error instanceof Error ? error.message : "No se pudo quitar el rol."); }
    finally { setBusy(false); }
  };
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Cargando administradores…</p>;
  if (!data.isPrimaryAdmin) return <div className="rounded-xl border border-[#e4dfd2] bg-[#fffdf8] p-5 text-sm">Solo el administrador principal puede delegar o quitar roles admin.</div>;
  return <div className="space-y-5">
    <section className="rounded-2xl border border-[#e4dfd2] bg-[#fffdf8] p-5">
      <h2 className="font-bold">Delegar acceso administrador</h2>
      <p className="mt-1 text-sm text-[#68747d]">La cuenta debe existir, estar activa y tener el email verificado. El cambio queda auditado.</p>
      <form onSubmit={grant} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="field" placeholder="correo@ejemplo.com" aria-label="Correo de la cuenta" />
        <input required minLength={5} value={reason} onChange={(event) => setReason(event.target.value)} className="field" placeholder="Motivo de la delegación" aria-label="Motivo" />
        <button disabled={busy} className="rounded-lg bg-[#243b49] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Delegar admin</button>
      </form>
    </section>
    <section className="overflow-hidden rounded-2xl border border-[#e4dfd2] bg-[#fffdf8]">
      <h2 className="border-b border-[#eee9de] px-5 py-4 font-bold">Administradores actuales</h2>
      {data.items.map((admin) => <div key={admin.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eee9de] px-5 py-4 last:border-0">
        <div><div className="font-semibold">{admin.name}</div><div className="text-sm text-[#68747d]">{admin.email}</div></div>
        {admin.id === data.primaryAdminId
          ? <span className="rounded-full bg-[#dcece2] px-3 py-1 text-xs font-bold text-[#276544]">Principal</span>
          : <button disabled={busy} onClick={() => void revoke(admin)} className="rounded-lg border border-[#e1c1bb] px-3 py-2 text-xs font-bold text-[#a23f35] disabled:opacity-50">Quitar rol admin</button>}
      </div>)}
    </section>
  </div>;
}
