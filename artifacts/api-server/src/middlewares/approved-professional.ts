import { and, eq } from "drizzle-orm";
import { db, professionalProfiles, users } from "@workspace/db";
import type { RequestHandler } from "express";

/** This guard follows requireAuth, which already checks an active, verified account. */
export const requireApprovedProfessional: RequestHandler = async (req, res, next) => {
  const [profile] = await db.select({ id: professionalProfiles.id })
    .from(professionalProfiles)
    .innerJoin(users, eq(users.id, professionalProfiles.usuarioId))
    .where(and(
      eq(users.id, req.usuarioId!),
      eq(users.activo, true),
      eq(professionalProfiles.verificado, true),
      eq(professionalProfiles.estadoVerificacion, "verified"),
      eq(professionalProfiles.habilitado, true),
    )).limit(1);
  if (!profile) {
    res.status(403).json({
      code: "PARTNER_APPROVAL_REQUIRED",
      error: "Tu perfil profesional está pendiente de habilitación. Un administrador debe revisar y aprobar tus documentos antes de que puedas trabajar en Worky.",
    });
    return;
  }
  next();
};
