import { and, asc, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import {
  clientIdentityVerifications,
  clientVerificationUploads,
  db,
  users,
  workyAuditEvents,
  workyNotifications,
} from "@workspace/db";
import { deleteObject, isClientVerificationReviewPath, isClientVerificationUploadPath } from "./storage";
import { logger } from "./logger";

export const CLIENT_VERIFICATION_UPLOAD_TTL_MS = 5 * 60 * 1000;
export const CLIENT_VERIFICATION_UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;
export const CLIENT_VERIFICATION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 100;

type Decision = "verified" | "rejected";
type ReasonCode = "dni_unreadable" | "selfie_unusable" | "identity_mismatch";

function statusView(row?: typeof clientIdentityVerifications.$inferSelect) {
  return {
    status: row?.estado === "deleting" ? "pending_verification" as const : row?.estado ?? "not_requested" as const,
    submittedAt: row?.submittedAt?.toISOString() ?? null,
    reviewedAt: row?.reviewedAt?.toISOString() ?? null,
    reasonCode: row?.estado === "rejected" ? row.reasonCode as ReasonCode | null : null,
  };
}

export async function getClientIdentityStatus(usuarioId: number) {
  const [row] = await db.select().from(clientIdentityVerifications)
    .where(eq(clientIdentityVerifications.usuarioId, usuarioId)).limit(1);
  return statusView(row);
}

export async function finalizeClientIdentityReview(id: number, now = new Date()) {
  const verification = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(clientIdentityVerifications)
      .where(eq(clientIdentityVerifications.id, id)).for("update").limit(1);
    if (!row || row.estado !== "deleting" || !row.pendingDecision) return null;
    const paths = [row.dniObjectPath, row.selfieObjectPath].filter((path): path is string => Boolean(path));
    const uploads = paths.length
      ? await tx.select().from(clientVerificationUploads).where(and(
        eq(clientVerificationUploads.usuarioId, row.usuarioId),
        inArray(clientVerificationUploads.reviewObjectPath, paths),
      ))
      : [];
    return { row, paths, uploads };
  });
  if (!verification) return { kind: "not-pending" as const };
  const uploadTypes = new Set(verification.uploads.map((upload) => upload.tipo));
  if (verification.paths.length !== 2 || verification.uploads.length !== 2 || !uploadTypes.has("dni") || !uploadTypes.has("selfie")) {
    logger.error({ verificationId: id }, "Expected both private client identity images before resolving the case");
    return { kind: "delete-failed" as const };
  }

  const allPaths = [...new Set([
    ...verification.paths,
    ...verification.uploads.flatMap((upload) => [upload.objectPath, upload.reviewObjectPath]),
  ].filter((path): path is string => Boolean(path)))];
  if (allPaths.some((path) =>
    !isClientVerificationReviewPath(path, verification.row.usuarioId)
    && !isClientVerificationUploadPath(path, verification.row.usuarioId),
  )) {
    logger.error({ verificationId: id }, "Invalid private image path blocked during client verification cleanup");
    return { kind: "delete-failed" as const };
  }

  const deleted = await Promise.all(allPaths.map((path) => deleteObject(path).catch(() => false)));
  if (deleted.some((ok) => !ok)) {
    logger.warn({ verificationId: id }, "Client identity images could not all be deleted; cleanup will retry");
    return { kind: "delete-failed" as const };
  }

  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(clientIdentityVerifications)
      .where(eq(clientIdentityVerifications.id, id)).for("update").limit(1);
    if (!current || current.estado !== "deleting" || !current.pendingDecision) return null;
    const decision = current.pendingDecision as Decision;
    const reviewedAt = current.reviewedAt ?? now;
    const [saved] = await tx.update(clientIdentityVerifications).set({
      estado: decision,
      dniObjectPath: null,
      selfieObjectPath: null,
      pendingDecision: null,
      reviewedAt,
      updatedAt: now,
    }).where(and(
      eq(clientIdentityVerifications.id, id),
      eq(clientIdentityVerifications.estado, "deleting"),
    )).returning();
    if (!saved) return null;

    for (const upload of verification.uploads) {
      const signedUrlMayStillWork = upload.createdAt.getTime() + CLIENT_VERIFICATION_UPLOAD_TTL_MS > now.getTime();
      await tx.update(clientVerificationUploads).set({
        estado: "deleted",
        reviewObjectPath: null,
        contentType: null,
        sizeBytes: null,
        objectPath: signedUrlMayStillWork ? upload.objectPath : null,
        deletedAt: now,
        updatedAt: now,
      }).where(eq(clientVerificationUploads.id, upload.id));
    }
    await tx.update(users).set({
      clientIdentityVerifiedAt: decision === "verified" ? reviewedAt : null,
      updatedAt: now,
    }).where(eq(users.id, current.usuarioId));
    await tx.insert(workyAuditEvents).values({
      usuarioId: current.reviewerId,
      entidad: "client_identity_verification",
      entidadId: current.id,
      accion: decision === "verified" ? "client_identity_approved" : "client_identity_rejected",
      estadoAnterior: "pending_verification",
      estadoNuevo: decision,
      metadata: { reasonCode: current.reasonCode },
      createdAt: now,
    });
    await tx.insert(workyNotifications).values({
      usuarioId: current.usuarioId,
      tipo: "actividad",
      titulo: decision === "verified" ? "Cliente verificado" : "Verificación de cliente resuelta",
      detalle: decision === "verified"
        ? "Tu identidad fue verificada. Los profesionales verán el sello en tus trabajos y conversaciones."
        : "No pudimos verificar tu identidad. Revisá el motivo en tu perfil y podés volver a enviar las imágenes.",
      href: "/profile",
      createdAt: now,
    });
    return saved;
  });
  return result ? { kind: "resolved" as const, status: statusView(result), usuarioId: result.usuarioId } : { kind: "not-pending" as const };
}

export async function discardClientVerificationUpload(uploadId: number, now = new Date()) {
  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(clientVerificationUploads)
      .where(eq(clientVerificationUploads.id, uploadId)).for("update").limit(1);
    if (!row || row.estado === "associated" || row.estado === "deleted") return null;
    await tx.update(clientVerificationUploads).set({ estado: "deleting", updatedAt: now })
      .where(eq(clientVerificationUploads.id, row.id));
    return row;
  });
  if (!claimed) return false;
  const paths = [claimed.objectPath, claimed.reviewObjectPath].filter((path): path is string => Boolean(path));
  if (paths.some((path) =>
    !isClientVerificationUploadPath(path, claimed.usuarioId)
    && !isClientVerificationReviewPath(path, claimed.usuarioId),
  )) return false;
  const results = await Promise.all(paths.map((path) => deleteObject(path).catch(() => false)));
  if (results.some((ok) => !ok)) return false;
  await db.update(clientVerificationUploads).set({
    estado: "deleted",
    objectPath: null,
    reviewObjectPath: null,
    contentType: null,
    sizeBytes: null,
    deletedAt: now,
    updatedAt: now,
  }).where(eq(clientVerificationUploads.id, claimed.id));
  return true;
}

export async function beginClientIdentityReview(
  id: number,
  reviewerId: number,
  decision: Decision,
  reasonCode: ReasonCode | null,
  now = new Date(),
) {
  const [row] = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(clientIdentityVerifications)
      .where(eq(clientIdentityVerifications.id, id)).for("update").limit(1);
    if (!current) return [null];
    if (current.estado !== "pending_verification" || !current.dniObjectPath || !current.selfieObjectPath) return [null];
    return tx.update(clientIdentityVerifications).set({
      estado: "deleting",
      pendingDecision: decision,
      reasonCode,
      reviewerId,
      reviewedAt: now,
      updatedAt: now,
    }).where(eq(clientIdentityVerifications.id, id)).returning();
  });
  return row ?? null;
}

export async function cleanupPendingClientVerificationUploads(now = new Date()) {
  const uploadCutoff = new Date(now.getTime() - CLIENT_VERIFICATION_UPLOAD_GRACE_MS);
  const expiredUrlCutoff = new Date(now.getTime() - CLIENT_VERIFICATION_UPLOAD_TTL_MS - 60_000);
  const candidates = await db.select({
    id: clientVerificationUploads.id,
    usuarioId: clientVerificationUploads.usuarioId,
    objectPath: clientVerificationUploads.objectPath,
    reviewObjectPath: clientVerificationUploads.reviewObjectPath,
    estado: clientVerificationUploads.estado,
    createdAt: clientVerificationUploads.createdAt,
  }).from(clientVerificationUploads).where(or(
    and(
      inArray(clientVerificationUploads.estado, ["pending", "processing", "deleting"]),
      lt(clientVerificationUploads.createdAt, uploadCutoff),
    ),
    and(
      eq(clientVerificationUploads.estado, "deleted"),
      isNotNull(clientVerificationUploads.objectPath),
      lt(clientVerificationUploads.createdAt, expiredUrlCutoff),
    ),
  )).orderBy(asc(clientVerificationUploads.createdAt)).limit(CLEANUP_BATCH_SIZE);

  let cleaned = 0;
  for (const candidate of candidates) {
    const paths = [candidate.objectPath, candidate.reviewObjectPath].filter((path): path is string => Boolean(path));
    if (paths.some((path) =>
      !isClientVerificationUploadPath(path, candidate.usuarioId)
      && !isClientVerificationReviewPath(path, candidate.usuarioId),
    )) {
      logger.error({ uploadId: candidate.id }, "Invalid private image path blocked during abandoned upload cleanup");
      continue;
    }
    const claimed = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(clientVerificationUploads)
        .where(eq(clientVerificationUploads.id, candidate.id)).for("update").limit(1);
      if (!row) return null;
      if (row.estado === "associated") return null;
      if (row.estado === "deleted" && (!row.objectPath || row.createdAt >= expiredUrlCutoff)) return null;
      if (row.estado !== "deleted") {
        await tx.update(clientVerificationUploads).set({ estado: "deleting", updatedAt: now })
          .where(eq(clientVerificationUploads.id, row.id));
      }
      return row;
    });
    if (!claimed) continue;
    const stillPresent = [claimed.objectPath, claimed.reviewObjectPath].filter((path): path is string => Boolean(path));
    const results = await Promise.all(stillPresent.map((path) => deleteObject(path).catch(() => false)));
    if (results.some((ok) => !ok)) {
      logger.warn({ uploadId: claimed.id }, "An abandoned client identity image could not be deleted; cleanup will retry");
      continue;
    }
    await db.update(clientVerificationUploads).set({
      estado: "deleted",
      objectPath: null,
      reviewObjectPath: null,
      contentType: null,
      sizeBytes: null,
      deletedAt: now,
      updatedAt: now,
    }).where(eq(clientVerificationUploads.id, claimed.id));
    cleaned += 1;
  }
  return { considered: candidates.length, cleaned };
}

export async function cleanupDeletingClientIdentityCases(now = new Date()) {
  const candidates = await db.select({ id: clientIdentityVerifications.id })
    .from(clientIdentityVerifications)
    .where(eq(clientIdentityVerifications.estado, "deleting"))
    .orderBy(asc(clientIdentityVerifications.updatedAt))
    .limit(CLEANUP_BATCH_SIZE);
  let resolved = 0;
  for (const candidate of candidates) {
    const result = await finalizeClientIdentityReview(candidate.id, now);
    if (result.kind === "resolved") resolved += 1;
  }
  return resolved;
}

export function startClientIdentityCleanup() {
  const timer = setInterval(() => {
    void Promise.all([
      cleanupPendingClientVerificationUploads(),
      cleanupDeletingClientIdentityCases(),
    ]).catch((error) => logger.error({ err: error }, "Client identity cleanup failed"));
  }, CLIENT_VERIFICATION_CLEANUP_INTERVAL_MS);
  timer.unref();
  return timer;
}
