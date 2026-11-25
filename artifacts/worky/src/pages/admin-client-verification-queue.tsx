import { useState } from "react";
import type { AdminClientIdentityVerification } from "@workspace/api-client-react";
import { Check, Eye, ShieldCheck, UserRoundCheck, X } from "lucide-react";

export type ClientVerificationKind = "dni" | "selfie";
export type ClientVerificationReasonCode = "dni_unreadable" | "selfie_unusable" | "identity_mismatch";

const rejectionReasons: { value: ClientVerificationReasonCode; label: string }[] = [
  { value: "dni_unreadable", label: "La foto del DNI no se puede leer" },
  { value: "selfie_unusable", label: "La selfie no permite revisar la identidad" },
  { value: "identity_mismatch", label: "Los datos no coinciden" },
];

type Props = {
  applications: AdminClientIdentityVerification[];
  total: number;
  busy: boolean;
  docLoading: string | null;
  docError: string;
  onOpen: (application: AdminClientIdentityVerification, kind: ClientVerificationKind) => void;
  onResolve: (
    application: AdminClientIdentityVerification,
    decision: "verified" | "rejected",
    reasonCode?: ClientVerificationReasonCode,
  ) => void;
};

function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Fecha no disponible" : new Intl.DateTimeFormat("es-AR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(parsed);
}

export function AdminClientVerificationQueue({
  applications,
  total,
  busy,
  docLoading,
  docError,
  onOpen,
  onResolve,
}: Props) {
  const [target, setTarget] = useState<{ application: AdminClientIdentityVerification; decision: "verified" | "rejected" } | null>(null);
  const [reasonCode, setReasonCode] = useState<ClientVerificationReasonCode | "">("");

  const closeReview = () => {
    setTarget(null);
    setReasonCode("");
  };

  return <>
    <section className="overflow-hidden rounded-2xl border border-[#e4dfd2] bg-[#fffdf8]" data-testid="client-verification-queue">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eee9de] p-5">
        <div>
          <h2 className="font-bold">Verificación de identidad de clientes</h2>
          <p className="mt-1 max-w-2xl text-sm text-[#68747d]">
            Revisá el DNI y la selfie en el panel privado. Al aprobar o rechazar, Worky elimina las imágenes y conserva solo el resultado y la auditoría.
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold">{total} pendientes</span>
      </header>
      {docError && <p role="alert" className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{docError}</p>}
      {!applications.length ? (
        <p className="p-8 text-center text-sm text-[#68747d]" data-testid="client-verification-empty">
          No hay solicitudes de clientes pendientes.
        </p>
      ) : (
        <div className="divide-y divide-[#e4dfd2]">
          {applications.map((application) => (
            <article key={application.id} className="space-y-5 p-4 sm:p-6" data-testid={`client-verification-${application.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold">{application.name}</h3>
                  <p className="break-all text-sm text-[#68747d]">{application.email}</p>
                  <p className="mt-1 text-xs text-[#68747d]">Enviada {date(application.submittedAt)}</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#f7e9c8] px-3 py-1 text-xs font-bold text-[#8a5a10]">
                  <UserRoundCheck size={14} /> En revisión
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {([
                  ["dni", "Foto del DNI", application.hasDni],
                  ["selfie", "Selfie", application.hasSelfie],
                ] as const).map(([kind, title, available]) => (
                  <div key={kind} className="rounded-xl border border-[#e4dfd2] bg-[#fbf9f3] p-4" data-testid={`client-verification-file-${application.id}-${kind}`}>
                    <h4 className="font-bold">{title}</h4>
                    {available ? (
                      <button
                        type="button"
                        disabled={busy || docLoading !== null}
                        onClick={() => onOpen(application, kind)}
                        className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#d8d2c4] px-3 py-2 text-sm font-bold disabled:opacity-50"
                        data-testid={`button-open-client-verification-${application.id}-${kind}`}
                      >
                        <Eye size={15} /> {docLoading === `${application.id}:${kind}` ? "Abriendo…" : "Ver imagen"}
                      </button>
                    ) : (
                      <p className="mt-3 text-sm text-[#a23f35]">Imagen no disponible</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 rounded-xl bg-[#f2ede1] p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-xl text-xs text-[#68747d]">
                  La decisión crea el sello visible para trabajadores solo después de borrar los archivos.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy || !application.hasDni || !application.hasSelfie}
                    onClick={() => setTarget({ application, decision: "verified" })}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#2f7552] px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    data-testid={`button-approve-client-verification-${application.id}`}
                  >
                    <ShieldCheck size={15} /> Aprobar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setTarget({ application, decision: "rejected" })}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#e1c1bb] px-3 py-2 text-xs font-bold text-[#a23f35] disabled:opacity-50"
                    data-testid={`button-reject-client-verification-${application.id}`}
                  >
                    <X size={15} /> Rechazar
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
    {target && (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4" role="presentation">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="client-verification-review-title"
          className="w-full max-w-md rounded-2xl border border-[#e4dfd2] bg-[#fffdf8] p-5 shadow-2xl"
          data-testid="client-verification-review-dialog"
        >
          <h2 id="client-verification-review-title" className="text-lg font-bold">
            {target.decision === "verified" ? "Aprobar identidad" : "Rechazar identidad"}
          </h2>
          <p className="mt-2 text-sm text-[#68747d]">
            {target.decision === "verified"
              ? `¿Confirmás que ${target.application.name} es la persona de las imágenes? Worky las eliminará al terminar.`
              : `Elegí un motivo claro para ${target.application.name}. Después podrá enviar nuevas imágenes.`}
          </p>
          {target.decision === "rejected" && (
            <label className="mt-4 block text-sm font-semibold">
              Motivo
              <select
                value={reasonCode}
                onChange={(event) => setReasonCode(event.target.value as ClientVerificationReasonCode | "")}
                className="field mt-2 w-full"
                data-testid="select-client-verification-rejection-reason"
              >
                <option value="">Seleccionar motivo</option>
                {rejectionReasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
              </select>
            </label>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={closeReview} className="rounded-lg border border-[#d8d2c4] px-3 py-2 text-sm font-bold disabled:opacity-50" data-testid="button-cancel-client-verification-review">
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy || (target.decision === "rejected" && !reasonCode)}
              onClick={() => {
                if (!target) return;
                onResolve(target.application, target.decision, reasonCode || undefined);
                closeReview();
              }}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-white disabled:opacity-50 ${target.decision === "verified" ? "bg-[#2f7552]" : "bg-[#9f4238]"}`}
              data-testid="button-confirm-client-verification-review"
            >
              {target.decision === "verified" ? <Check size={15} /> : <X size={15} />}
              {target.decision === "verified" ? "Confirmar aprobación" : "Confirmar rechazo"}
            </button>
          </div>
        </section>
      </div>
    )}
  </>;
}
