export const requiredPartnerDocuments = ["dni_frente", "dni_dorso", "antecedentes_penales"] as const;

/** The licence is optional, but once submitted it must also pass review. */
export function partnerVerificationStatus(documents: ReadonlyArray<{ tipo: string; estado: string }>): "verified" | "rejected" | "pending_verification" {
  if (documents.some((document) => document.estado === "rejected")) return "rejected";
  const requiredApproved = requiredPartnerDocuments.every((type) =>
    documents.some((document) => document.tipo === type && document.estado === "verified"));
  return requiredApproved && documents.every((document) => document.estado === "verified")
    ? "verified" : "pending_verification";
}
