import type { AdminPartner, AdminPartnerApplication, AdminVerificationDocument } from "@workspace/api-client-react";
import { Check, Eye, FileText, ShieldCheck, X } from "lucide-react";

const documentTypes = [
  { type: "dni_frente", label: "DNI frente", required: true },
  { type: "dni_dorso", label: "DNI dorso", required: true },
  { type: "antecedentes_penales", label: "Antecedentes penales", required: true },
  { type: "matricula", label: "Matrícula habilitante", required: false },
] as const;
const statuses = { pending_verification: "En revisión", verified: "Aprobado", rejected: "Rechazado" };

export function canEnableApplication(application: AdminPartnerApplication) {
  const { partner, documents, emailVerifiedAt } = application;
  return Boolean(emailVerifiedAt && partner.accountActive && partner.verified && !partner.enabled &&
    partner.verificationStatus === "verified" &&
    documentTypes.filter((type) => type.required).every((type) =>
      documents.some((document) => document.tipo === type.type && document.estado === "verified")) &&
    documents.every((document) => document.estado === "verified"));
}

type Props = {
  applications: AdminPartnerApplication[];
  total: number;
  busy: boolean;
  docLoading: number | null;
  docError: string;
  onOpen: (document: AdminVerificationDocument) => void;
  onResolve: (document: AdminVerificationDocument, status: "verified" | "rejected") => void;
  onEnable: (partner: AdminPartner) => void;
};

export function AdminVerificationQueue({ applications, total, busy, docLoading, docError, onOpen, onResolve, onEnable }: Props) {
  return <section className="overflow-hidden rounded-2xl border border-[#e4dfd2] bg-[#fffdf8]">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eee9de] p-5">
      <div><h2 className="font-bold">Solicitudes de habilitación</h2>
        <p className="mt-1 text-sm text-[#68747d]">Revisá la documentación de cada perfil y otorgá su habilitación final. Los archivos son privados.</p></div>
      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold">{total} perfiles sin habilitar</span>
    </header>
    {docError && <p role="alert" className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{docError}</p>}
    {!applications.length ? <p className="p-8 text-center text-sm text-[#68747d]">No hay perfiles pendientes para esta búsqueda.</p> :
      <div className="divide-y divide-[#e4dfd2]">{applications.map((application) => {
        const { partner, documents, emailVerifiedAt, matriculaHabilitante } = application;
        const ready = canEnableApplication(application);
        const missing = documentTypes.filter((type) => type.required && !documents.some((doc) => doc.tipo === type.type));
        return <article key={partner.userId} className="space-y-5 p-4 sm:p-6" data-testid={`card-application-${partner.userId}`}>
          <div className="flex flex-wrap justify-between gap-3">
            <div className="min-w-0"><h3 className="text-lg font-bold">{partner.name}</h3>
              <p className="break-all text-sm text-[#68747d]">{partner.email}</p>
              <p className="mt-1 text-sm">{partner.trade} · {partner.category}</p>
              {matriculaHabilitante && <p className="mt-1 break-words text-xs">Matrícula declarada: {matriculaHabilitante}</p>}</div>
            <div className="flex flex-wrap items-start gap-2 text-xs font-semibold">
              <span className={`rounded-full px-3 py-1 ${emailVerifiedAt ? "bg-green-50 text-green-800" : "bg-amber-100 text-amber-900"}`}>{emailVerifiedAt ? "Email verificado" : "Email pendiente de verificación"}</span>
              <span className={`rounded-full px-3 py-1 ${partner.accountActive ? "bg-[#f2ede1]" : "bg-red-50 text-red-800"}`}>{partner.accountActive ? "Cuenta activa" : "Cuenta suspendida"}</span>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {documentTypes.map((type) => {
              const doc = documents.find((document) => document.tipo === type.type);
              return <div key={type.type} className="flex min-w-0 flex-col rounded-xl border border-[#e4dfd2] bg-[#fbf9f3] p-4" data-testid={`document-${partner.userId}-${type.type}`}>
                <h4 className="flex items-center gap-2 text-sm font-bold"><FileText size={16} className="shrink-0" />{type.label}</h4>
                <p className="mt-1 text-xs text-[#68747d]">{type.required ? "Obligatorio" : "Opcional según el oficio"}</p>
                {!doc ? <p className="mt-4 text-sm font-semibold text-[#68747d]">{type.required ? "Sin adjuntar" : "No adjuntada"}</p> : <>
                  <p className={`mt-4 text-xs font-bold ${doc.estado === "verified" ? "text-green-800" : doc.estado === "rejected" ? "text-red-800" : "text-amber-800"}`}>{statuses[doc.estado]}</p>
                  <p className="mt-1 break-all text-sm">{doc.nombre}</p>
                  <p className="mb-3 mt-1 text-xs text-[#68747d]">{new Date(doc.createdAt).toLocaleDateString("es-AR")} · {Math.ceil(doc.sizeBytes / 1024)} KB</p>
                  <div className="mt-auto space-y-2 pt-2">
                    <button type="button" disabled={docLoading !== null} onClick={() => onOpen(doc)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#d8d2c4] px-2 py-2 text-xs font-bold disabled:opacity-50" data-testid={`button-open-document-${doc.id}`}><Eye size={14} />{docLoading === doc.id ? "Abriendo…" : "Ver archivo"}</button>
                    {doc.estado === "pending_verification" && <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={() => onResolve(doc, "verified")} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#2f7552] px-2 py-2 text-xs font-bold text-white disabled:opacity-50" data-testid={`button-approve-document-${doc.id}`}><Check size={14} />Aprobar</button>
                      <button type="button" disabled={busy} onClick={() => onResolve(doc, "rejected")} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-[#e1c1bb] px-2 py-2 text-xs font-bold text-[#a23f35] disabled:opacity-50" data-testid={`button-reject-document-${doc.id}`}><X size={14} />Rechazar</button>
                    </div>}
                  </div>
                </>}
              </div>;
            })}
          </div>
          <footer className="flex flex-col justify-between gap-3 rounded-xl bg-[#f2ede1] p-4 lg:flex-row lg:items-center">
            <div className="text-sm">
              <p className="font-bold">{ready ? "Documentación aprobada: listo para habilitar" : "Habilitación pendiente"}</p>
              <p className="mt-1 text-xs text-[#68747d]">{missing.length ? `Falta adjuntar: ${missing.map((type) => type.label).join(", ")}. ` : ""}{!emailVerifiedAt ? "Debe verificar su email. " : ""}{!partner.accountActive ? "La cuenta está suspendida. " : ""}DNI y antecedentes deben estar aprobados; la matrícula también si fue adjuntada.</p>
            </div>
            <button type="button" disabled={busy || !ready} onClick={() => onEnable(partner)} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#243b49] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40" data-testid={`button-enable-application-${partner.userId}`}><ShieldCheck size={17} />Habilitar como Partner</button>
          </footer>
        </article>;
      })}</div>}
  </section>;
}
