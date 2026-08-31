import { Readable } from "node:stream";
import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { createChatAttachmentUploadUrl, createProfilePhotoUploadUrl, createUploadUrl, deleteObject, getObject, isChatAttachmentPath, isProfilePhotoRenderedPath, isProfilePhotoSourcePath } from "../lib/storage";
import { chatUploads, db, jobs, messages, professionalVerificationDocuments, profilePhotoUploads, users } from "@workspace/db";
import { and, asc, eq, lt, or, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();
export const CHAT_ATTACHMENT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;
export const CHAT_ATTACHMENT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const CHAT_ATTACHMENT_CLEANUP_BATCH_SIZE = 100;
export const PROFILE_PHOTO_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;
export const PROFILE_PHOTO_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const PROFILE_PHOTO_CLEANUP_BATCH_SIZE = 100;
function requestedObjectPath(raw: string | string[]) {
  const value = (Array.isArray(raw) ? raw.join("/") : raw).replace(/^\/+/, "");
  return value.startsWith("objects/") ? `/${value}` : `/objects/${value}`;
}

router.get("/storage/public-objects/*filePath", async (req, res): Promise<void> => {
  const raw = req.params.filePath;
  const objectPath = requestedObjectPath(raw);
  const [profilePhoto] = await db.select({ id: users.id }).from(users).where(eq(users.fotoObjectPath, objectPath)).limit(1);
  if (!profilePhoto) { res.status(404).json({ error: "Foto de perfil no encontrada." }); return; }
  const file = await getObject(objectPath);
  if (!file) { res.status(404).json({ error: "Foto de perfil no encontrada." }); return; }
  const [metadata] = await file.getMetadata();
  res.setHeader("Content-Type", String(metadata.contentType || "application/octet-stream"));
  res.setHeader("Cache-Control", "public, max-age=3600");
  Readable.from(file.createReadStream()).pipe(res);
});
router.post("/storage/uploads/request-url", requireAuth, async (req, res): Promise<void> => {
  const { name, size, contentType, purpose } = req.body ?? {};
  if (typeof name !== "string" || !name || !Number.isFinite(Number(size)) || Number(size) <= 0 || typeof contentType !== "string") {
    res.status(400).json({ error: "Metadatos de archivo inválidos." }); return;
  }
  const isProfilePhoto = purpose === "profile_photo";
  const isChatImage = purpose === "chat_image";
  const changaId = Number(req.body?.changaId);
  if (isChatImage && (!Number.isInteger(changaId) || changaId <= 0)) {
    res.status(400).json({ error: "Indicá la conversación para adjuntar la imagen." }); return;
  }
  if (isChatImage) {
    const [job] = await db.select({ clienteId: jobs.clienteId, profesionalId: jobs.profesionalId }).from(jobs).where(eq(jobs.id, changaId)).limit(1);
    if (!job || (job.clienteId !== req.usuarioId && job.profesionalId !== req.usuarioId)) {
      res.status(403).json({ error: "No participás en esta conversación." }); return;
    }
  }
  if (isProfilePhoto && (!contentType.startsWith("image/") || Number(size) > 10 * 1024 * 1024)) {
    res.status(400).json({ error: "Elegí una imagen de hasta 10 MB para tu foto de perfil." }); return;
  }
  if (isChatImage && (!contentType.startsWith("image/") || Number(size) > 10 * 1024 * 1024)) {
    res.status(400).json({ error: "Las imágenes del chat deben pesar hasta 10 MB." }); return;
  }
  try {
    const upload = isProfilePhoto
      ? await createProfilePhotoUploadUrl(req.usuarioId as number)
      : isChatImage
        ? await createChatAttachmentUploadUrl(changaId, req.usuarioId as number)
        : await createUploadUrl();
    let uploadId: number | undefined;
    if (isProfilePhoto || isChatImage) {
      try {
        const [tracked] = isProfilePhoto
          ? await db.insert(profilePhotoUploads).values({
            usuarioId: req.usuarioId as number,
            objectPath: upload.objectPath,
            variante: "source",
          }).returning({ id: profilePhotoUploads.id })
          : await db.insert(chatUploads).values({
            changaId,
            usuarioId: req.usuarioId as number,
            objectPath: upload.objectPath,
          }).returning({ id: chatUploads.id });
        uploadId = tracked?.id;
      } catch (error) {
        await deleteObject(upload.objectPath).catch((cleanupError) => {
          req.log.warn({ err: cleanupError, objectPath: upload.objectPath }, "No se pudo revertir una carga sin registrar");
        });
        throw error;
      }
    }
    res.json({ ...upload, ...(uploadId ? { uploadId } : {}), metadata: { name, size: Number(size), contentType }, purpose: isProfilePhoto ? "profile_photo" : isChatImage ? "chat_image" : "file" });
  } catch (error) {
    req.log.error({ err: error }, "No se pudo generar URL de carga");
    res.status(500).json({ error: "No se pudo preparar la carga." });
  }
});

/**
 * Reclaims only chat uploads that have remained unassociated past the grace
 * period. A row is claimed under a lock before Object Storage is touched, so
 * a concurrent message either associates it first or is rejected as stale.
 */
export async function cleanupAbandonedChatAttachments(now = new Date()) {
  const cutoff = new Date(now.getTime() - CHAT_ATTACHMENT_GRACE_PERIOD_MS);
  const candidates = await db.select({
    id: chatUploads.id,
    objectPath: chatUploads.objectPath,
    changaId: chatUploads.changaId,
    usuarioId: chatUploads.usuarioId,
  })
    .from(chatUploads)
    .where(and(
      or(eq(chatUploads.estado, "pending"), eq(chatUploads.estado, "deleting")),
      lt(chatUploads.createdAt, cutoff),
    ))
    .orderBy(asc(chatUploads.createdAt))
    .limit(CHAT_ATTACHMENT_CLEANUP_BATCH_SIZE);

  let cleaned = 0;
  for (const candidate of candidates) {
    if (!isChatAttachmentPath(candidate.objectPath, candidate.changaId, candidate.usuarioId)) continue;
    const claimed = await db.transaction(async (tx) => {
      const [upload] = await tx.select().from(chatUploads)
        .where(and(
          eq(chatUploads.id, candidate.id),
          or(eq(chatUploads.estado, "pending"), eq(chatUploads.estado, "deleting")),
        ))
        .for("update")
        .limit(1);
      if (!upload) return null;

      const [message] = await tx.select({ id: messages.id }).from(messages).where(and(
        eq(messages.changaId, upload.changaId),
        sql`${messages.adjuntos} @> ${JSON.stringify([{ objectPath: upload.objectPath }])}::jsonb`,
      )).limit(1);
      if (message) {
        await tx.update(chatUploads).set({
          estado: "associated",
          associatedMessageId: message.id,
          updatedAt: now,
        }).where(eq(chatUploads.id, upload.id));
        return null;
      }

      await tx.update(chatUploads).set({ estado: "deleting", updatedAt: now }).where(eq(chatUploads.id, upload.id));
      return upload;
    });

    if (!claimed) continue;
    try {
      if (!(await deleteObject(claimed.objectPath))) {
        throw new Error("Object Storage no confirmó la eliminación.");
      }
      await db.update(chatUploads).set({
        estado: "deleted",
        deletedAt: now,
        updatedAt: now,
      }).where(and(eq(chatUploads.id, claimed.id), eq(chatUploads.estado, "deleting")));
      cleaned += 1;
    } catch (error) {
      logger.warn({ err: error, uploadId: claimed.id, objectPath: claimed.objectPath }, "No se pudo limpiar una carga de chat abandonada");
    }
  }
  return { considered: candidates.length, cleaned };
}

export function startChatAttachmentCleanup() {
  const timer = setInterval(() => {
    void cleanupAbandonedChatAttachments().catch((error) => {
      logger.error({ err: error }, "Falló la limpieza de cargas de chat abandonadas");
    });
  }, CHAT_ATTACHMENT_CLEANUP_INTERVAL_MS);
  timer.unref();
  return timer;
}

/**
 * Claims a rejected chat upload after the error response has been sent and
 * removes its object immediately. A failed deletion intentionally leaves the
 * row in `deleting`, which the periodic cleanup can safely retry later.
 */
export async function cleanupRejectedChatAttachment(
  objectPath: string,
  changaId: number,
  usuarioId: number,
  now = new Date(),
) {
  if (!isChatAttachmentPath(objectPath, changaId, usuarioId)) return false;

  const claimed = await db.transaction(async (tx) => {
    const [upload] = await tx.select({ id: chatUploads.id, objectPath: chatUploads.objectPath })
      .from(chatUploads)
      .where(and(
        eq(chatUploads.changaId, changaId),
        eq(chatUploads.usuarioId, usuarioId),
        eq(chatUploads.objectPath, objectPath),
        eq(chatUploads.estado, "pending"),
      ))
      .for("update")
      .limit(1);
    if (!upload) return null;

    await tx.update(chatUploads).set({ estado: "deleting", updatedAt: now }).where(eq(chatUploads.id, upload.id));
    return upload;
  });

  if (!claimed) return false;
  try {
    if (!(await deleteObject(claimed.objectPath))) {
      throw new Error("Object Storage no confirmó la eliminación.");
    }
    await db.update(chatUploads).set({
      estado: "deleted",
      deletedAt: now,
      updatedAt: now,
    }).where(and(eq(chatUploads.id, claimed.id), eq(chatUploads.estado, "deleting")));
    return true;
  } catch (error) {
    logger.warn({ err: error, uploadId: claimed.id, objectPath: claimed.objectPath }, "No se pudo limpiar una carga de chat rechazada");
    return false;
  }
}

/**
 * Reclaims only profile photo sources and prepared variants that have
 * remained unassociated past the grace period. The account row is locked
 * before the upload row so a concurrent save cannot publish a deleted object.
 */
export async function cleanupAbandonedProfilePhotoUploads(now = new Date()) {
  const cutoff = new Date(now.getTime() - PROFILE_PHOTO_GRACE_PERIOD_MS);
  const candidates = await db.select({
    id: profilePhotoUploads.id,
    usuarioId: profilePhotoUploads.usuarioId,
    objectPath: profilePhotoUploads.objectPath,
    variante: profilePhotoUploads.variante,
  })
    .from(profilePhotoUploads)
    .where(and(
      or(eq(profilePhotoUploads.estado, "pending"), eq(profilePhotoUploads.estado, "deleting")),
      lt(profilePhotoUploads.createdAt, cutoff),
    ))
    .orderBy(asc(profilePhotoUploads.createdAt))
    .limit(PROFILE_PHOTO_CLEANUP_BATCH_SIZE);

  let cleaned = 0;
  for (const candidate of candidates) {
    const validPath = candidate.variante === "source"
      ? isProfilePhotoSourcePath(candidate.objectPath, candidate.usuarioId)
      : isProfilePhotoRenderedPath(candidate.objectPath, candidate.usuarioId);
    if (!validPath) continue;

    const claimed = await db.transaction(async (tx) => {
      const [owner] = await tx.select({ fotoObjectPath: users.fotoObjectPath }).from(users)
        .where(eq(users.id, candidate.usuarioId))
        .for("update")
        .limit(1);
      if (!owner) return null;

      const [upload] = await tx.select().from(profilePhotoUploads)
        .where(and(
          eq(profilePhotoUploads.id, candidate.id),
          or(eq(profilePhotoUploads.estado, "pending"), eq(profilePhotoUploads.estado, "deleting")),
        ))
        .for("update")
        .limit(1);
      if (!upload) return null;

      if (owner.fotoObjectPath === upload.objectPath) {
        await tx.update(profilePhotoUploads).set({
          estado: "associated",
          associatedAt: now,
          updatedAt: now,
        }).where(eq(profilePhotoUploads.id, upload.id));
        return null;
      }

      await tx.update(profilePhotoUploads).set({ estado: "deleting", updatedAt: now }).where(eq(profilePhotoUploads.id, upload.id));
      return upload;
    });

    if (!claimed) continue;
    try {
      if (!(await deleteObject(claimed.objectPath))) {
        throw new Error("Object Storage no confirmó la eliminación.");
      }
      await db.update(profilePhotoUploads).set({
        estado: "deleted",
        deletedAt: now,
        updatedAt: now,
      }).where(and(eq(profilePhotoUploads.id, claimed.id), eq(profilePhotoUploads.estado, "deleting")));
      cleaned += 1;
    } catch (error) {
      logger.warn({ err: error, uploadId: claimed.id, objectPath: claimed.objectPath }, "No se pudo limpiar una carga de foto de perfil abandonada");
    }
  }
  return { considered: candidates.length, cleaned };
}

export function startProfilePhotoCleanup() {
  const timer = setInterval(() => {
    void cleanupAbandonedProfilePhotoUploads().catch((error) => {
      logger.error({ err: error }, "Falló la limpieza de cargas de fotos de perfil abandonadas");
    });
  }, PROFILE_PHOTO_CLEANUP_INTERVAL_MS);
  timer.unref();
  return timer;
}

router.get("/storage/objects/*filePath", requireAuth, async (req, res): Promise<void> => {
  const raw = req.params.filePath;
  const objectPath = requestedObjectPath(raw);
  const ownerId = req.usuarioId as number;
  const [viewer] = await db.select({ rol: users.rol }).from(users).where(and(eq(users.id, ownerId), eq(users.activo, true))).limit(1);
  const [ownedPhoto] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, ownerId), eq(users.fotoObjectPath, objectPath))).limit(1);
  const [ownedDocument] = await db.select({ id: professionalVerificationDocuments.id }).from(professionalVerificationDocuments)
    .where(and(eq(professionalVerificationDocuments.profesionalId, ownerId), eq(professionalVerificationDocuments.objectPath, objectPath))).limit(1);
  const [adminDocument] = viewer?.rol === "admin"
    ? await db.select({ id: professionalVerificationDocuments.id }).from(professionalVerificationDocuments).where(eq(professionalVerificationDocuments.objectPath, objectPath)).limit(1)
    : [null];
  const chatMatch = objectPath.match(/^\/objects\/chat-attachments\/(\d+)\/(\d+)\/([0-9a-f-]{36})$/);
  let chatAttachment = false;
  if (chatMatch) {
    const changaId = Number(chatMatch[1]);
    const [job] = await db.select({ clienteId: jobs.clienteId, profesionalId: jobs.profesionalId }).from(jobs).where(eq(jobs.id, changaId)).limit(1);
    if (job && (job.clienteId === ownerId || job.profesionalId === ownerId)) {
      const [message] = await db.select({ id: messages.id }).from(messages).where(and(
        eq(messages.changaId, changaId),
        sql`${messages.adjuntos} @> ${JSON.stringify([{ objectPath }])}::jsonb`,
      )).limit(1);
      chatAttachment = Boolean(message);
    }
  }
  if (!ownedPhoto && !ownedDocument && !adminDocument && !chatAttachment) { res.status(403).json({ error: "No tenés permiso para acceder a este archivo." }); return; }
  const file = await getObject(objectPath);
  if (!file) { res.status(404).json({ error: "Archivo no encontrado." }); return; }
  const [metadata] = await file.getMetadata();
  res.setHeader("Content-Type", String(metadata.contentType || "application/octet-stream"));
  res.setHeader("Cache-Control", "private, max-age=3600");
  Readable.from(file.createReadStream()).pipe(res);
});
export default router;