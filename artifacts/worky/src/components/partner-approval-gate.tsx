import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, uploadWorkyFile } from "@/lib/api";

const verificationDocuments = [
  { type: "dni_frente", label: "DNI frente", accept: "image/*" },
  { type: "dni_dorso", label: "DNI dorso", accept: "image/*" },
  { type: "antecedentes_penales", label: "Antecedentes penales", accept: "application/pdf" },
  { type: "matricula", label: "Matrícula habilitante (opcional)", accept: "image/*,application/pdf" },
] as const;
type Document = { tipo: string; nombre: string; estado: "pending_verification" | "verified" | "rejected" };
type Profile = { verificado: boolean; habilitado: boolean; estadoVerificacion: string };
const statusLabels = { pending_verification: "En revisión", verified: "Aprobado", rejected: "Rechazado: reemplazá este documento" };

export function PartnerApprovalGate({ children, allowEditing }: { children: ReactNode; allowEditing: boolean }) {
  const client = useQueryClient();
  const profile = useQuery({ queryKey: ["partner-approval"], queryFn: () => apiRequest<Profile | null>("/partner-profile/me"), refetchInterval: 15000 });
  const documents = useQuery({ queryKey: ["partner-approval-documents"], queryFn: () => apiRequest<Document[]>("/auth/verification-documents"), refetchInterval: 15000, enabled: Boolean(profile.data) });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const allRequiredUploaded = documents.isSuccess && verificationDocuments
    .filter((document) => document.type !== "matricula")
    .every((required) => documents.data.some((document) => document.tipo === required.type));
  const hasRejectedDocuments = documents.data?.some((document) => document.estado === "rejected") ?? false;
  const upload = async (type: string, file?: File) => {
    if (!file) return;
    setBusy(type); setError(""); setNotice("");
    try {
      const stored = await uploadWorkyFile(file);
      await apiRequest(`/auth/verification-documents/${type}`, {
        method: "PUT",
        body: JSON.stringify({ objectPath: stored.objectPath, nombre: file.name, contentType: file.type, sizeBytes: file.size }),
      });
      await client.invalidateQueries();
      setNotice("Documento recibido. Un administrador debe revisarlo y habilitar tu perfil.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos guardar el documento.");
    } finally { setBusy(null); }
  };
  if (profile.isPending) return <p role="status">Consultando la habilitación de tu perfil…</p>;
  if (profile.isError) return <div role="alert">No pudimos consultar tu habilitación. <button type="button" onClick={() => void profile.refetch()}>Reintentar</button></div>;
  if (profile.data?.habilitado && profile.data.verificado && profile.data.estadoVerificacion === "verified") return children;
  return <>
    <section className="mb-7 space-y-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-[#293a44]" data-testid="partner-approval-pending">
      <div><p className="text-xs font-bold uppercase tracking-wider">Alta profesional</p><h1 className="mt-2 text-2xl font-bold">{allRequiredUploaded && !hasRejectedDocuments ? "Documentos recibidos: esperando habilitación" : "Tu perfil todavía no está habilitado"}</h1>
        <p className="mt-2 text-sm">Ya creaste tu cuenta y verificaste tu email. Los documentos guardados durante el registro se conservan: solo te pedimos los faltantes o rechazados. Las funcionalidades profesionales se habilitan después de la aprobación del administrador.</p></div>
      <ol className="list-inside list-decimal space-y-1 text-sm">
        <li>Cuenta creada.</li><li>Email verificado.</li><li>Documentación privada: revisión administrativa.</li><li>Habilitación para aparecer en búsquedas y aceptar changas.</li>
      </ol>
      {!profile.data ? <Link href="/partner" className="inline-block rounded-xl bg-[#243b49] px-4 py-3 text-sm font-bold text-white">Completar mi perfil profesional</Link> : <>
        <p className="text-sm font-semibold">{hasRejectedDocuments ? "Hay documentos rechazados. Revisá el motivo en tus notificaciones y reemplazá únicamente esos archivos." : profile.data.verificado ? "La documentación fue aprobada. Falta la habilitación final del administrador." : allRequiredUploaded ? "Recibimos tus documentos. No tenés que volver a cargarlos: tu solicitud está en revisión." : "Completá únicamente los documentos faltantes. No necesitás crear otra cuenta."}</p>
        {documents.isPending ? <p role="status">Consultando documentos…</p> : documents.isError ? <p role="alert">No pudimos consultar tus documentos. <button type="button" onClick={() => void documents.refetch()}>Reintentar</button></p> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{verificationDocuments.map((required) => {
          const current = documents.data?.find((doc) => doc.tipo === required.type);
          const needsUpload = !current || current.estado === "rejected";
          const input = <input aria-label={`${current ? "Reemplazar" : "Subir"} ${required.label}`} className="mt-2 block w-full text-xs" type="file" accept={required.accept} disabled={busy !== null} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void upload(required.type, file); }} />;
          return <div key={required.type} className="block rounded-xl border border-amber-200 bg-white p-3 text-sm">
            <span className="font-bold">{required.label}</span><span className="mt-2 block text-xs">{current ? statusLabels[current.estado] : required.type === "matricula" ? "Opcional según tu oficio. Si la adjuntás, también debe aprobarse." : "Pendiente de carga"}</span>
            {current && <span className="mt-1 block break-all text-xs">{current.nombre}</span>}
            {needsUpload && (required.type === "matricula" && !current
              ? <details className="mt-3 text-xs"><summary className="cursor-pointer font-semibold">Agregar matrícula (opcional)</summary>{input}</details>
              : <><span className="mt-3 block text-xs">{busy === required.type ? "Cargando…" : current ? "Reemplazar documento rechazado" : "Subir documento faltante"}</span>{input}</>)}
          </div>;
        })}</div>}
      </>}
      <p className="text-xs">Tus documentos no son públicos. Mientras esperás, las funciones de Profesional permanecen bloqueadas. Podés cambiar a la vista Cliente y seguir usando tu cuenta.</p>
      {error && <p role="alert" className="text-sm font-bold text-red-800">{error}</p>}
      {notice && <p role="status" className="text-sm font-bold">{notice}</p>}
    </section>
    {allowEditing && !profile.data && children}
  </>;
}
