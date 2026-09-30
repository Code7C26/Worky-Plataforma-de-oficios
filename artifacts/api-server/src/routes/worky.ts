import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { chatUploads, db, jobs, messages, passwordRecoveryTokens, professionalProfiles, profilePhotoUploads, users, serviceCatalog, professionalAvailability, professionalAssets, bookings, payments, settlements, workyNotifications, workyAuditEvents, reviews, recommendations, professionalServices, professionalVerificationDocuments } from "@workspace/db";
import { ChangeMyPasswordBody, RequestPasswordRecoveryBody, ResetPasswordRecoveryBody, SwitchAccountRoleBody, SwitchAccountRoleResponse, UpdateMyAccountBody, UpdateProfessionalLocationBody, UpdateProfessionalLocationResponse } from "@workspace/api-zod";
import { requireAuth, signToken, verifyToken } from "../middlewares/auth";
import { deleteObject, isProfilePhotoSourcePath, isValidImageObject, processProfilePhoto } from "../lib/storage";
import { cleanupRejectedChatAttachment } from "./storage";
import { createPasswordRecovery, isPasswordRecoveryTokenValid, passwordRecoveryTokenHash } from "../lib/password-recovery";

const router: IRouter = Router();
type NotificationSubscriber = { res: Response; heartbeat: ReturnType<typeof setInterval> };
const notificationSubscribers = new Map<number, Set<NotificationSubscriber>>();
export const MAX_NOTIFICATION_SUBSCRIBERS_PER_USER = 2;
export function getNotificationSubscriberCount(usuarioId: number) {
  return notificationSubscribers.get(usuarioId)?.size ?? 0;
}
function removeNotificationSubscriber(usuarioId: number, subscribers: Set<NotificationSubscriber>, subscriber: NotificationSubscriber) {
  clearInterval(subscriber.heartbeat);
  subscribers.delete(subscriber);
  if (subscribers.size === 0 && notificationSubscribers.get(usuarioId) === subscribers) notificationSubscribers.delete(usuarioId);
}
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const passwordRecoveryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const categories = ["Plomería", "Electricidad", "Gas", "Albañilería", "Otro"] as const;
const statuses = ["publicada", "aceptada", "en_curso", "finalizada", "cancelada"] as const;
export const LIVE_LOCATION_MAX_AGE_MS = 5 * 60 * 1000;
export const PROFESSIONAL_LOCATION_MAX_AGE_MS = LIVE_LOCATION_MAX_AGE_MS;
const userId = (req: Request) => req.usuarioId as number;
const reauthenticationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(userId(req)),
  message: { error: "Demasiados intentos. Esperá unos minutos antes de volver a intentar." },
});
async function requireAdmin(req: Request, res: Response) {
  const [user] = await db.select({ rol: users.rol }).from(users).where(and(eq(users.id, userId(req)), eq(users.activo, true))).limit(1);
  if (user?.rol !== "admin") {
    res.status(403).json({ error: "Solo una persona administradora puede revisar verificaciones." });
    return false;
  }
  return true;
}
const missing = (values: Record<string, unknown>) => Object.keys(values).filter((key) => values[key] === undefined || values[key] === null || values[key] === "");
const safeUser = (user: typeof users.$inferSelect) => ({
  id: user.id, nombre: user.nombre, email: user.email, telefono: user.telefono, rol: user.rol, ubicacion: user.ubicacion,
  edad: user.edad, fotoObjectPath: user.fotoObjectPath, onboardingEstado: user.onboardingEstado, onboardingPaso: user.onboardingPaso,
});
const publicUser = (user: typeof users.$inferSelect) => {
  const location = user.ubicacion as { ciudad?: unknown; zona?: unknown; direccionTexto?: unknown; coordinates?: unknown } | null;
  const city = typeof location?.ciudad === "string" && location.ciudad
    ? location.ciudad
    : typeof location?.zona === "string" && location.zona
      ? location.zona
      : typeof location?.direccionTexto === "string" && location.direccionTexto ? location.direccionTexto : null;
  return {
    id: user.id,
    nombre: user.nombre,
    edad: user.edad,
    fotoObjectPath: user.fotoObjectPath,
    rol: user.rol,
    ubicacion: city ? {
      ciudad: city,
      zona: typeof location?.zona === "string" ? location.zona : city,
    } : null,
    onboardingRespuestas: user.onboardingRespuestas,
  };
};
const numberValue = (value: unknown) => typeof value === "number" ? value : Number(value);
function coordinatesOf(value: unknown): [number, number] | null {
  const coordinates = (value as { coordinates?: unknown } | null)?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  return Number.isFinite(longitude) && Number.isFinite(latitude) && Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90
    ? [longitude, latitude]
    : null;
}
function freshCoordinatesOf(value: unknown, now = Date.now()): [number, number] | null {
  const coordinates = coordinatesOf(value);
  if (!coordinates) return null;
  const capturedAt = new Date(String((value as { capturedAt?: unknown } | null)?.capturedAt ?? ""));
  return Number.isFinite(capturedAt.getTime()) && now - capturedAt.getTime() <= PROFESSIONAL_LOCATION_MAX_AGE_MS
    ? coordinates
    : null;
}
function distanceInKm(from: [number, number], to: [number, number]) {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(to[1] - from[1]);
  const longitudeDelta = radians(to[0] - from[0]);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from[1])) * Math.cos(radians(to[1])) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}
const profileView = (row: { profile: typeof professionalProfiles.$inferSelect; user: typeof users.$inferSelect }) => ({
  ...row.profile, precioReferencia: Number(row.profile.precioReferencia), rating: Number(row.profile.rating), usuario: publicUser(row.user),
});
async function reputationView(profileId: number) {
  const [reviewStats] = await db.select({ average: sql<number>`coalesce(avg(${reviews.rating}), 0)`, count: sql<number>`count(${reviews.id})` }).from(reviews).where(eq(reviews.profesionalId, profileId));
  const [jobStats] = await db.select({ count: sql<number>`count(${jobs.id})` }).from(jobs).where(and(eq(jobs.profesionalId, profileId), eq(jobs.estado, "finalizada")));
  const [recommendationStats] = await db.select({ count: sql<number>`count(${recommendations.id})` }).from(recommendations).where(and(eq(recommendations.profesionalId, profileId), eq(recommendations.visibilidad, "publica")));
  return { rating: Number(reviewStats?.average || 0), reviewsCount: Number(reviewStats?.count || 0), completedJobs: Number(jobStats?.count || 0), recommendationsCount: Number(recommendationStats?.count || 0) };
}
async function publicProfileView(row: { profile: typeof professionalProfiles.$inferSelect; user: typeof users.$inferSelect }) {
  const reputation = await reputationView(row.profile.usuarioId);
  return { ...profileView(row), ...reputation };
}
const jobView = (row: { job: typeof jobs.$inferSelect; client: typeof users.$inferSelect; professional?: typeof users.$inferSelect | null }) => ({
  ...row.job, precioOfrecido: Number(row.job.precioOfrecido), cliente: safeUser(row.client), profesional: row.professional ? safeUser(row.professional) : null, calificada: false,
});
async function notify(usuarioId: number | null | undefined, titulo: string, detalle: string, href?: string) {
  if (!usuarioId) return;
  const [notification] = await db.insert(workyNotifications)
    .values({ usuarioId, tipo: "actividad", titulo, detalle, href: href ?? null })
    .returning();
  if (!notification) return;
  const subscribers = notificationSubscribers.get(usuarioId);
  if (!subscribers) return;
  const payload = `event: notification\ndata: ${JSON.stringify(notification)}\n\n`;
  for (const subscriber of subscribers) {
    if (subscriber.res.destroyed || subscriber.res.writableEnded) {
      removeNotificationSubscriber(usuarioId, subscribers, subscriber);
      continue;
    }
    try {
      subscriber.res.write(payload);
    } catch {
      removeNotificationSubscriber(usuarioId, subscribers, subscriber);
    }
  }
}
function appointmentNotificationDetail(jobDetail: string | null | undefined, outcome: "propuesta" | "confirmada" | "rechazada") {
  const subject = jobDetail?.trim() ? ` para "${jobDetail.trim().slice(0, 120)}"` : "";
  return outcome === "propuesta"
    ? `Recibiste una nueva propuesta de visita${subject}.`
    : outcome === "confirmada"
      ? `La visita quedó confirmada${subject}.`
      : `La visita fue rechazada${subject}.`;
}
async function conversationJob(changaId: number, usuarioId: number) {
  const [job] = await db.select({ clienteId: jobs.clienteId, profesionalId: jobs.profesionalId, detalle: jobs.detalle })
    .from(jobs).where(eq(jobs.id, changaId)).limit(1);
  if (!job || (job.clienteId !== usuarioId && job.profesionalId !== usuarioId)) return null;
  return job;
}
function requestedConversationRole(req: Request): "cliente" | "profesional" | null | "invalid" {
  const value = req.query.rol;
  if (value === undefined) return null;
  if (typeof value !== "string" || !["cliente", "profesional"].includes(value)) return "invalid";
  return value as "cliente" | "profesional";
}

router.post("/auth/register", authLimit, async (req, res) => {
  const { nombre, email, password, telefono, ubicacion, edad, fotoObjectPath, rol, onboardingRespuestas } = req.body ?? {};
  const fields = missing({ nombre, email, password });
  if (fields.length || typeof password !== "string" || password.length < 6) return res.status(400).json({ error: "Nombre, email y contraseña de al menos 6 caracteres son obligatorios.", campos_faltantes: fields });
  const normalized = String(email).trim().toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (existing[0]) return res.status(409).json({ error: "Ya existe una cuenta con ese email." });
  const requestedRole = rol === "profesional" ? "profesional" : "cliente";
  const [created] = await db.insert(users).values({
    nombre: String(nombre).trim(), email: normalized, passwordHash: await bcrypt.hash(password, 12),
    telefono: telefono ? String(telefono).trim() : null, ubicacion: ubicacion ?? null,
    edad: Number.isFinite(Number(edad)) ? Number(edad) : null, fotoObjectPath: fotoObjectPath || null,
    rol: requestedRole, onboardingEstado: requestedRole === "profesional" ? "professional_verification_pending" : "registration_started",
    onboardingRespuestas: onboardingRespuestas && typeof onboardingRespuestas === "object" ? onboardingRespuestas : {},
  }).returning();
  return res.status(201).json({ token: signToken(created.id), usuario: safeUser(created) });
});

router.post("/auth/login", authLimit, async (req, res) => {
  const { email, password } = req.body ?? {};
  const [found] = await db.select().from(users).where(and(eq(users.email, String(email ?? "").trim().toLowerCase()), eq(users.activo, true))).limit(1);
  if (!found || typeof password !== "string" || !(await bcrypt.compare(password, found.passwordHash))) return res.status(401).json({ error: "Email o contraseña incorrectos." });
  return res.json({ token: signToken(found.id), usuario: safeUser(found) });
});

router.post("/auth/password-recovery/request", passwordRecoveryLimiter, async (req, res) => {
  const parsed = RequestPasswordRecoveryBody.safeParse(req.body);
  if (!parsed.success || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.data?.email.trim() ?? "")) return res.status(400).json({ error: "Ingresá un email válido." });

  const email = parsed.data.email.trim().toLowerCase();
  try {
    await createPasswordRecovery(email, `${req.protocol}://${req.get("host")}`);
  } catch (error) {
    console.error("No se pudo enviar el correo de recuperación.", error);
    return res.status(503).json({ error: "No pudimos enviar el correo de recuperación. Intentá nuevamente en unos minutos." });
  }

  return res.status(202).json({
    message: "Si existe una cuenta con ese email, vas a recibir un enlace para recuperar tu contraseña.",
  });
});

router.post("/auth/password-recovery/reset", passwordRecoveryLimiter, async (req, res) => {
  const parsed = ResetPasswordRecoveryBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "El enlace no es válido o la contraseña no cumple los requisitos." });

  const now = new Date();
  const tokenHash = passwordRecoveryTokenHash(parsed.data.token);
  const [recovery] = await db.select().from(passwordRecoveryTokens).where(eq(passwordRecoveryTokens.tokenHash, tokenHash)).limit(1);
  if (!recovery || !isPasswordRecoveryTokenValid(recovery.expiresAt, recovery.usedAt, now)) {
    return res.status(400).json({ error: "El enlace de recuperación venció o ya fue utilizado." });
  }

  const [user] = await db.select().from(users).where(and(eq(users.id, recovery.usuarioId), eq(users.activo, true))).limit(1);
  if (!user) return res.status(400).json({ error: "El enlace de recuperación ya no es válido." });
  if (await bcrypt.compare(parsed.data.newPassword, user.passwordHash)) {
    return res.status(400).json({ error: "Elegí una contraseña diferente a la actual." });
  }

  const claimed = await db.transaction(async (tx) => {
    const [claimedToken] = await tx.update(passwordRecoveryTokens)
      .set({ usedAt: now })
      .where(and(
        eq(passwordRecoveryTokens.id, recovery.id),
        isNull(passwordRecoveryTokens.usedAt),
        gt(passwordRecoveryTokens.expiresAt, now),
      ))
      .returning({ id: passwordRecoveryTokens.id });
    if (!claimedToken) return false;

    await tx.update(users)
      .set({ passwordHash: await bcrypt.hash(parsed.data.newPassword, 12), updatedAt: now })
      .where(eq(users.id, user.id));
    await tx.update(passwordRecoveryTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordRecoveryTokens.usuarioId, user.id), isNull(passwordRecoveryTokens.usedAt)));
    return true;
  });

  if (!claimed) return res.status(400).json({ error: "El enlace de recuperación venció o ya fue utilizado." });
  return res.json({ success: true });
});

router.get("/auth/me", requireAuth, async (req, res) => {
  const [user] = await db.select().from(users).where(and(eq(users.id, userId(req)), eq(users.activo, true))).limit(1);
  return user ? res.json(safeUser(user)) : res.status(401).json({ error: "Tu sesión ya no es válida." });
});
router.patch("/auth/me", requireAuth, (req, res, next) => {
  if (typeof req.body?.currentPassword !== "string") return next();
  return reauthenticationLimiter(req, res, next);
}, async (req, res) => {
  const parsed = UpdateMyAccountBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Revisá los datos ingresados y volvé a intentar." });
  if (Object.keys(parsed.data).every((key) => key === "currentPassword")) {
    return res.status(400).json({ error: "No hay cambios para guardar." });
  }

  const [current] = await db.select().from(users).where(and(eq(users.id, userId(req)), eq(users.activo, true))).limit(1);
  if (!current) return res.status(401).json({ error: "Tu sesión ya no es válida." });

  const nombre = parsed.data.nombre?.trim();
  const email = parsed.data.email?.trim().toLowerCase();
  if (nombre !== undefined && nombre.length < 2) return res.status(400).json({ error: "Ingresá tu nombre completo." });
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Ingresá un email válido." });

  if (email !== undefined && email !== current.email) {
    if (!parsed.data.currentPassword || !(await bcrypt.compare(parsed.data.currentPassword, current.passwordHash))) {
      return res.status(401).json({ error: "Ingresá tu contraseña actual para cambiar el email." });
    }
    const [emailOwner] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), ne(users.id, current.id))).limit(1);
    if (emailOwner) return res.status(409).json({ error: "Ese email ya está asociado a otra cuenta." });
  }

  const requestedLocation = parsed.data.ubicacion;
  const cleanLocationValue = (value: string | null | undefined) => {
    const clean = typeof value === "string" ? value.trim() : "";
    return clean || null;
  };
  const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (nombre !== undefined) updates.nombre = nombre;
  if (email !== undefined) updates.email = email;
  if (parsed.data.telefono !== undefined) updates.telefono = cleanLocationValue(parsed.data.telefono);
  if (parsed.data.edad !== undefined) updates.edad = parsed.data.edad;
  if (requestedLocation !== undefined) {
    const addressPatch = {
      direccionTexto: cleanLocationValue(requestedLocation?.direccionTexto),
      ciudad: cleanLocationValue(requestedLocation?.ciudad),
      provincia: cleanLocationValue(requestedLocation?.provincia),
    };
    updates.ubicacion = sql`coalesce(${users.ubicacion}, '{}'::jsonb) || ${JSON.stringify(addressPatch)}::jsonb`;
  }

  try {
    const [updated] = await db.update(users).set(updates).where(eq(users.id, current.id)).returning();
    return res.json(safeUser(updated));
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code
      ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") return res.status(409).json({ error: "Ese email ya está asociado a otra cuenta." });
    throw error;
  }
});
router.patch("/auth/role", requireAuth, async (req, res): Promise<void> => {
  const parsed = SwitchAccountRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Elegí un perfil válido para continuar." });
    return;
  }

  const [current] = await db.select().from(users)
    .where(and(eq(users.id, userId(req)), eq(users.activo, true))).limit(1);
  if (!current) {
    res.status(401).json({ error: "Tu sesión ya no es válida." });
    return;
  }
  if (current.rol === "admin") {
    res.status(403).json({ error: "Las cuentas administradoras no pueden cambiar de perfil." });
    return;
  }
  if (current.rol === parsed.data.rol) {
    res.json(SwitchAccountRoleResponse.parse(safeUser(current)));
    return;
  }

  const [updated] = await db.update(users)
    .set({ rol: parsed.data.rol, updatedAt: new Date() })
    .where(and(eq(users.id, current.id), eq(users.activo, true)))
    .returning();
  if (!updated) {
    res.status(401).json({ error: "Tu sesión ya no es válida." });
    return;
  }

  res.json(SwitchAccountRoleResponse.parse(safeUser(updated)));
});
router.patch("/auth/password", requireAuth, reauthenticationLimiter, async (req, res) => {
  const parsed = ChangeMyPasswordBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres." });
  const [current] = await db.select().from(users).where(and(eq(users.id, userId(req)), eq(users.activo, true))).limit(1);
  if (!current) return res.status(401).json({ error: "Tu sesión ya no es válida." });
  if (!(await bcrypt.compare(parsed.data.currentPassword, current.passwordHash))) {
    return res.status(401).json({ error: "La contraseña actual no es correcta." });
  }
  if (await bcrypt.compare(parsed.data.newPassword, current.passwordHash)) {
    return res.status(400).json({ error: "Elegí una contraseña diferente a la actual." });
  }
  await db.update(users).set({ passwordHash: await bcrypt.hash(parsed.data.newPassword, 12), updatedAt: new Date() }).where(eq(users.id, current.id));
  return res.json({ success: true });
});
router.post("/auth/logout", requireAuth, (_req, res) => res.status(204).send());

router.patch("/auth/location", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateProfessionalLocationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Las coordenadas deben incluir longitud y latitud válidas." });
    return;
  }

  const coordinates = coordinatesOf(parsed.data);
  if (!coordinates) {
    res.status(400).json({ error: "Las coordenadas deben incluir longitud y latitud válidas." });
    return;
  }

  const [current] = await db.select({ rol: users.rol, ubicacion: users.ubicacion })
    .from(users)
    .where(and(eq(users.id, userId(req)), eq(users.activo, true)))
    .limit(1);
  if (!current) {
    res.status(401).json({ error: "Tu sesión ya no es válida." });
    return;
  }
  const hasProfessionalProfile = current.rol === "profesional" || Boolean((await db.select({ id: professionalProfiles.id })
    .from(professionalProfiles)
    .where(eq(professionalProfiles.usuarioId, userId(req)))
    .limit(1))[0]);
  if (!hasProfessionalProfile) {
    res.status(403).json({ error: "Solo los profesionales pueden actualizar su ubicación." });
    return;
  }

  const capturedAt = new Date();
  const locationPatch = { coordinates, capturedAt: capturedAt.toISOString() };
  await db.update(users)
    .set({
      ubicacion: sql`coalesce(${users.ubicacion}, '{}'::jsonb) || ${JSON.stringify(locationPatch)}::jsonb`,
      updatedAt: capturedAt,
    })
    .where(eq(users.id, userId(req)));

  res.json(UpdateProfessionalLocationResponse.parse({ coordinates, capturedAt }));
});

router.patch("/auth/onboarding", requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const allowed = ["registration_started", "basic_info_completed", "professional_verification_pending", "onboarding_completed"] as const;
  if (!allowed.includes(body.estado)) return res.status(400).json({ error: "Estado de onboarding inválido." });
  const [updated] = await db.update(users).set({
    onboardingEstado: body.estado,
    onboardingPaso: Number.isFinite(Number(body.paso)) ? Math.max(1, Math.min(3, Number(body.paso))) : undefined,
    onboardingRespuestas: body.respuestas && typeof body.respuestas === "object" ? body.respuestas : undefined,
    updatedAt: new Date(),
  }).where(eq(users.id, userId(req))).returning();
  return res.json(safeUser(updated));
});

router.post("/auth/profile-photo", requireAuth, async (req, res) => {
  const { objectPath } = req.body ?? {};
  const usuarioId = userId(req);
  if (typeof objectPath !== "string" || !isProfilePhotoSourcePath(objectPath, usuarioId)) {
    return res.status(400).json({ error: "Cargá una nueva foto desde tu cuenta antes de guardarla." });
  }
  const [sourceUpload] = await db.select({ id: profilePhotoUploads.id }).from(profilePhotoUploads).where(and(
    eq(profilePhotoUploads.usuarioId, usuarioId),
    eq(profilePhotoUploads.objectPath, objectPath),
    eq(profilePhotoUploads.variante, "source"),
    eq(profilePhotoUploads.estado, "pending"),
  )).limit(1);
  if (!sourceUpload) return res.status(400).json({ error: "Cargá una nueva foto desde tu cuenta antes de guardarla." });

  let fotoObjectPath: string;
  try {
    fotoObjectPath = await processProfilePhoto(objectPath, usuarioId);
  } catch (error) {
    req.log.warn({ err: error, usuarioId }, "No se pudo preparar la foto de perfil");
    return res.status(400).json({ error: error instanceof Error ? error.message : "No pudimos procesar la foto." });
  }

  let preparedUploadId: number | undefined;
  try {
    const [preparedUpload] = await db.insert(profilePhotoUploads).values({
      usuarioId,
      objectPath: fotoObjectPath,
      variante: "rendered",
    }).returning({ id: profilePhotoUploads.id });
    if (!preparedUpload) throw new Error("No se pudo registrar la versión preparada de la foto.");
    preparedUploadId = preparedUpload.id;

    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx.select({ fotoObjectPath: users.fotoObjectPath }).from(users)
        .where(eq(users.id, usuarioId))
        .for("update")
        .limit(1);
      if (!current) throw new Error("La cuenta ya no está disponible.");

      // A replaced photo is no longer associated; its object gets reclaimed
      // after the grace period just like an abandoned prepared variant.
      await tx.update(profilePhotoUploads).set({
        estado: "pending",
        associatedAt: null,
        updatedAt: now,
      }).where(and(
        eq(profilePhotoUploads.usuarioId, usuarioId),
        eq(profilePhotoUploads.estado, "associated"),
      ));
      const [associated] = await tx.update(profilePhotoUploads).set({
        estado: "associated",
        associatedAt: now,
        updatedAt: now,
      }).where(and(
        eq(profilePhotoUploads.id, preparedUpload.id),
        eq(profilePhotoUploads.estado, "pending"),
      )).returning({ objectPath: profilePhotoUploads.objectPath });
      if (!associated) throw new Error("No se pudo asociar la versión preparada de la foto.");

      const [savedUser] = await tx.update(users).set({ fotoObjectPath: associated.objectPath, updatedAt: now })
        .where(eq(users.id, usuarioId))
        .returning({ fotoObjectPath: users.fotoObjectPath });
      if (!savedUser) throw new Error("La cuenta ya no está disponible.");
      return savedUser;
    });
    return res.json({ fotoObjectPath: updated.fotoObjectPath });
  } catch (error) {
    req.log.warn({ err: error, usuarioId }, "No se pudo asociar la foto de perfil");
    try {
      await deleteObject(fotoObjectPath);
    } catch (cleanupError) {
      req.log.warn({ err: cleanupError, usuarioId, objectPath: fotoObjectPath }, "No se pudo revertir una versión preparada de foto de perfil");
    }
    if (preparedUploadId !== undefined) {
      await db.update(profilePhotoUploads).set({
        estado: "deleted",
        deletedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(profilePhotoUploads.id, preparedUploadId));
    }
    return res.status(500).json({ error: "No pudimos guardar la foto de perfil." });
  }
});

router.get("/auth/verification-documents", requireAuth, async (req, res) => {
  const rows = await db.select({
    id: professionalVerificationDocuments.id, tipo: professionalVerificationDocuments.tipo,
    objectPath: professionalVerificationDocuments.objectPath, nombre: professionalVerificationDocuments.nombre,
    contentType: professionalVerificationDocuments.contentType, sizeBytes: professionalVerificationDocuments.sizeBytes,
    estado: professionalVerificationDocuments.estado, createdAt: professionalVerificationDocuments.createdAt,
  }).from(professionalVerificationDocuments).where(eq(professionalVerificationDocuments.profesionalId, userId(req)));
  return res.json(rows);
});

router.put("/auth/verification-documents/:tipo", requireAuth, async (req, res) => {
  const tipos = ["dni_frente", "dni_dorso", "antecedentes_penales"] as const;
  const tipo = req.params.tipo as typeof tipos[number];
  const { objectPath, nombre, contentType, sizeBytes } = req.body ?? {};
  if (!tipos.includes(tipo) || typeof objectPath !== "string" || !objectPath.startsWith("/objects/") || typeof nombre !== "string" || typeof contentType !== "string" || !Number.isFinite(Number(sizeBytes))) {
    return res.status(400).json({ error: "Documento inválido." });
  }
  const [saved] = await db.insert(professionalVerificationDocuments).values({
    profesionalId: userId(req), tipo, objectPath, nombre, contentType, sizeBytes: Number(sizeBytes), estado: "pending_verification",
  }).onConflictDoUpdate({ target: [professionalVerificationDocuments.profesionalId, professionalVerificationDocuments.tipo], set: {
    objectPath, nombre, contentType, sizeBytes: Number(sizeBytes), estado: "pending_verification", updatedAt: new Date(),
  }}).returning();
  await db.update(users).set({ onboardingEstado: "professional_verification_pending", updatedAt: new Date() }).where(eq(users.id, userId(req)));
  return res.json(saved);
});

router.get("/admin/verificaciones", requireAuth, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const requestedStatus = String(req.query.estado || "pending_verification");
  const statuses = ["pending_verification", "verified", "rejected"] as const;
  const estado = statuses.includes(requestedStatus as typeof statuses[number]) ? requestedStatus as typeof statuses[number] : "pending_verification";
  const rows = await db.select({
    documento: professionalVerificationDocuments,
    partner: users,
    perfil: professionalProfiles,
  }).from(professionalVerificationDocuments)
    .innerJoin(users, eq(users.id, professionalVerificationDocuments.profesionalId))
    .leftJoin(professionalProfiles, eq(professionalProfiles.usuarioId, professionalVerificationDocuments.profesionalId))
    .where(eq(professionalVerificationDocuments.estado, estado))
    .orderBy(asc(professionalVerificationDocuments.createdAt));
  return res.json(rows.map(({ documento, partner, perfil }) => ({
    ...documento,
    objectPath: documento.objectPath,
    partner: { id: partner.id, nombre: partner.nombre, email: partner.email },
    perfil: perfil ? { oficio: perfil.oficio, categoria: perfil.categoria, estadoVerificacion: perfil.estadoVerificacion } : null,
  })));
});

router.patch("/admin/verificaciones/:id", requireAuth, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const nextStatus = req.body?.estado;
  const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim().slice(0, 1000) : "";
  if (!["verified", "rejected"].includes(nextStatus) || !motivo) {
    return res.status(400).json({ error: "Indicá si aprobás o rechazás el documento y dejá un motivo." });
  }
  const documentId = numberValue(req.params.id);
  const [current] = await db.select().from(professionalVerificationDocuments).where(eq(professionalVerificationDocuments.id, documentId)).limit(1);
  if (!current) return res.status(404).json({ error: "Documento no encontrado." });
  if (current.estado !== "pending_verification") return res.status(409).json({ error: "Este documento ya fue resuelto." });
  const [updated] = await db.update(professionalVerificationDocuments).set({ estado: nextStatus, updatedAt: new Date() }).where(and(eq(professionalVerificationDocuments.id, documentId), eq(professionalVerificationDocuments.estado, "pending_verification"))).returning();
  if (!updated) return res.status(409).json({ error: "Este documento ya fue resuelto." });
  const documents = await db.select({ estado: professionalVerificationDocuments.estado }).from(professionalVerificationDocuments).where(eq(professionalVerificationDocuments.profesionalId, current.profesionalId));
  const profileStatus = documents.some((item) => item.estado === "rejected") ? "rejected" : documents.length >= 3 && documents.every((item) => item.estado === "verified") ? "verified" : "pending_verification";
  await db.update(professionalProfiles).set({ estadoVerificacion: profileStatus, verificado: profileStatus === "verified", updatedAt: new Date() }).where(eq(professionalProfiles.usuarioId, current.profesionalId));
  await db.insert(workyAuditEvents).values({
    usuarioId: userId(req), entidad: "verification_document", entidadId: updated.id, accion: nextStatus === "verified" ? "approved" : "rejected",
    estadoAnterior: current.estado, estadoNuevo: nextStatus, metadata: { motivo, partnerId: current.profesionalId },
  });
  await notify(current.profesionalId, nextStatus === "verified" ? "Documento aprobado" : "Documento rechazado", nextStatus === "verified" ? "Un documento de verificación fue aprobado." : `Un documento de verificación fue rechazado: ${motivo}`);
  return res.json({ ...updated, profileStatus });
});

router.put("/auth/professional-services", requireAuth, async (req, res) => {
  const services = Array.isArray(req.body?.services) ? req.body.services : [];
  if (!services.length || services.length > 10) return res.status(400).json({ error: "Agregá entre 1 y 10 oficios." });
  if (services.some((item: any) => !String(item.oficio || "").trim() || !categories.includes(item.categoria))) {
    return res.status(400).json({ error: "Cada oficio debe tener un nombre y una categoría válida." });
  }
  await db.delete(professionalServices).where(eq(professionalServices.profesionalId, userId(req)));
  const saved = await db.insert(professionalServices).values(services.map((item: any) => ({
    profesionalId: userId(req), oficio: String(item.oficio || "").trim(), categoria: item.categoria, experienciaAnios: Math.max(0, Number(item.experienciaAnios) || 0),
  }))).returning();
  const primary = saved[0];
  if (primary) {
    const [owner] = await db.select().from(users).where(eq(users.id, userId(req))).limit(1);
    const answers = owner?.onboardingRespuestas as Record<string, unknown> | null;
    const answerText = ["tipoTrabajo", "zonaTrabajo", "objetivo"]
      .map((key) => typeof answers?.[key] === "string" ? `${key}: ${answers[key]}` : "")
      .filter(Boolean)
      .join(" · ");
    await db.insert(professionalProfiles).values({
      usuarioId: userId(req),
      oficio: primary.oficio,
      categoria: primary.categoria,
      experienciaAnios: primary.experienciaAnios,
      precioReferencia: "0",
      skills: saved.map((item) => item.oficio),
      about: answerText || null,
      disponible: true,
    }).onConflictDoUpdate({
      target: professionalProfiles.usuarioId,
      set: {
        oficio: primary.oficio,
        categoria: primary.categoria,
        experienciaAnios: primary.experienciaAnios,
        skills: saved.map((item) => item.oficio),
        about: answerText || undefined,
        updatedAt: new Date(),
      },
    });
  }
  return res.json(saved);
});

router.get("/profesionales", async (req, res) => {
  const page = Math.max(1, numberValue(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, numberValue(req.query.limit) || 12));
  const category = String(req.query.categoria ?? "");
  const search = String(req.query.search ?? "").trim();
  const rows = await db.select({ profile: professionalProfiles, user: users }).from(professionalProfiles).innerJoin(users, eq(users.id, professionalProfiles.usuarioId)).where(and(
    eq(users.activo, true),
    category && categories.includes(category as typeof categories[number]) ? eq(professionalProfiles.categoria, category as typeof categories[number]) : undefined,
    search ? or(ilike(users.nombre, `%${search}%`), ilike(professionalProfiles.oficio, `%${search}%`), ilike(sql<string>`${professionalProfiles.categoria}::text`, `%${search}%`)) : undefined,
  )).orderBy(desc(professionalProfiles.verificado), desc(sql`coalesce((select avg(r.rating) from worky_reviews r where r.profesional_id = ${professionalProfiles.usuarioId}), 0)`), desc(sql`(select count(*) from worky_jobs j where j.profesional_id = ${professionalProfiles.usuarioId} and j.estado = 'finalizada')`)).limit(limit).offset((page - 1) * limit);
  const viewerLongitude = numberValue(req.query.longitud);
  const viewerLatitude = numberValue(req.query.latitud);
  const viewerCoordinates = Number.isFinite(viewerLongitude) && Number.isFinite(viewerLatitude)
    && Math.abs(viewerLongitude) <= 180 && Math.abs(viewerLatitude) <= 90
    ? [viewerLongitude, viewerLatitude] as [number, number]
    : null;
  const now = Date.now();
  return res.json(await Promise.all(rows.map(async (row) => {
    const professionalCoordinates = freshCoordinatesOf(row.user.ubicacion, now);
    return {
      ...(await publicProfileView(row)),
      distanceKm: viewerCoordinates && professionalCoordinates
        ? distanceInKm(viewerCoordinates, professionalCoordinates)
        : null,
    };
  })));
});

// Catálogo único para altas, filtros y oportunidades.
router.get("/catalogo", async (_req, res) => {
  const rows = await db.select().from(serviceCatalog).where(eq(serviceCatalog.activa, true)).orderBy(asc(serviceCatalog.categoria), asc(serviceCatalog.especialidad));
  return res.json(rows);
});
router.get("/catalogo/categorias", async (_req, res) => {
  const rows = await db.select({ categoria: serviceCatalog.categoria }).from(serviceCatalog).where(eq(serviceCatalog.activa, true)).groupBy(serviceCatalog.categoria).orderBy(asc(serviceCatalog.categoria));
  return res.json(rows.map((row) => row.categoria));
});
router.get("/partner/disponibilidad", requireAuth, async (req, res) => {
  const rows = await db.select().from(professionalAvailability).where(eq(professionalAvailability.profesionalId, userId(req))).orderBy(asc(professionalAvailability.diaSemana), asc(professionalAvailability.desde));
  return res.json(rows);
});
router.put("/partner/disponibilidad", requireAuth, async (req, res) => {
  const entries = Array.isArray(req.body) ? req.body : req.body?.disponibilidad;
  if (!Array.isArray(entries)) return res.status(400).json({ error: "Enviá una lista de horarios." });
  await db.delete(professionalAvailability).where(eq(professionalAvailability.profesionalId, userId(req)));
  const valid = entries.filter((item) => Number.isInteger(item?.diaSemana) && item.diaSemana >= 0 && item.diaSemana <= 6 && /^\d{2}:\d{2}$/.test(item.desde) && /^\d{2}:\d{2}$/.test(item.hasta)).map((item) => ({ profesionalId: userId(req), diaSemana: item.diaSemana, desde: item.desde, hasta: item.hasta, estado: item.estado === "pausado" ? "pausado" as const : "disponible" as const, zona: item.zona ? String(item.zona) : null }));
  if (valid.length) await db.insert(professionalAvailability).values(valid);
  return res.json(await db.select().from(professionalAvailability).where(eq(professionalAvailability.profesionalId, userId(req))));
});
router.get("/partner/activos", requireAuth, async (req, res) => {
  const assets = await db.select().from(professionalAssets).where(eq(professionalAssets.profesionalId, userId(req))).orderBy(desc(professionalAssets.createdAt));
  return res.json(assets.map((asset) => ({ ...asset, url: `/api/v1/storage/objects${asset.objectPath}` })));
});
router.post("/partner/activos", requireAuth, async (req, res) => {
  const body = req.body ?? {};
  if (!body.objectPath || !body.nombre || !["portfolio", "foto", "video"].includes(body.tipo)) return res.status(400).json({ error: "Faltan los metadatos del archivo." });
  const [asset] = await db.insert(professionalAssets).values({ profesionalId: userId(req), tipo: body.tipo, objectPath: String(body.objectPath), nombre: String(body.nombre), contentType: String(body.contentType || "application/octet-stream"), sizeBytes: Math.max(0, Number(body.sizeBytes) || 0), altText: body.altText ? String(body.altText) : null }).returning();
  return res.status(201).json({ ...asset, url: `/api/v1/storage/objects${asset.objectPath}` });
});
router.delete("/partner/activos/:id", requireAuth, async (req, res) => {
  const [deleted] = await db.delete(professionalAssets).where(and(eq(professionalAssets.id, numberValue(req.params.id)), eq(professionalAssets.profesionalId, userId(req)))).returning();
  if (!deleted) return res.status(404).json({ error: "Archivo no encontrado." });
  return res.status(204).send();
});

router.get("/partner/dashboard", requireAuth, async (req, res) => {
  const assigned = await jobsFor(and(eq(jobs.profesionalId, userId(req)), sql`${jobs.estado} in ('aceptada', 'en_curso', 'finalizada')`));
  const upcoming = await db.select().from(bookings).where(and(eq(bookings.profesionalId, userId(req)), sql`${bookings.estado} in ('solicitada', 'confirmada', 'en_curso')`)).orderBy(asc(bookings.empiezaAt));
  const unread = await db.select().from(workyNotifications).where(and(eq(workyNotifications.usuarioId, userId(req)), eq(workyNotifications.leida, false))).orderBy(desc(workyNotifications.createdAt));
  const assetRows = await db.select().from(professionalAssets).where(eq(professionalAssets.profesionalId, userId(req)));
  return res.json({ trabajos: await serializeJobs(assigned), calendario: upcoming, archivos: assetRows, notificacionesNoLeidas: unread.length });
});
router.get("/notificaciones", requireAuth, async (req, res) => {
  const rows = await db.select().from(workyNotifications).where(eq(workyNotifications.usuarioId, userId(req))).orderBy(desc(workyNotifications.createdAt)).limit(50);
  return res.json({ items: rows, unread: rows.filter((item) => !item.leida).length });
});

router.get("/notificaciones/stream", (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  let usuarioId: number;
  try {
    usuarioId = verifyToken(token);
  } catch {
    res.status(401).end();
    return;
  }

  const subscribers = notificationSubscribers.get(usuarioId);
  if (subscribers && subscribers.size >= MAX_NOTIFICATION_SUBSCRIBERS_PER_USER) {
    res.setHeader("Retry-After", "1");
    res.status(429).json({ error: "Alcanzaste el límite de conexiones de notificaciones activas." });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);

  const activeSubscribers = subscribers ?? new Set<NotificationSubscriber>();
  const subscriber: NotificationSubscriber = {
    res,
    heartbeat: setInterval(() => {
      if (res.destroyed || res.writableEnded) {
        removeNotificationSubscriber(usuarioId, activeSubscribers, subscriber);
        return;
      }
      try {
        res.write(": keep-alive\n\n");
      } catch {
        removeNotificationSubscriber(usuarioId, activeSubscribers, subscriber);
        res.end();
      }
    }, 25_000),
  };
  activeSubscribers.add(subscriber);
  notificationSubscribers.set(usuarioId, activeSubscribers);
  req.on("close", () => {
    removeNotificationSubscriber(usuarioId, activeSubscribers, subscriber);
  });
});
router.patch("/notificaciones/:id/leida", requireAuth, async (req, res) => {
  const [updated] = await db.update(workyNotifications).set({ leida: true }).where(and(eq(workyNotifications.id, numberValue(req.params.id)), eq(workyNotifications.usuarioId, userId(req)))).returning();
  if (!updated) return res.status(404).json({ error: "Notificación no encontrada." });
  return res.json(updated);
});
router.post("/notificaciones/leidas", requireAuth, async (req, res) => {
  await db.update(workyNotifications).set({ leida: true }).where(eq(workyNotifications.usuarioId, userId(req)));
  return res.status(204).send();
});
router.get("/partner/liquidaciones", requireAuth, async (req, res) => {
  const rows = await db.select().from(settlements).where(eq(settlements.profesionalId, userId(req))).orderBy(desc(settlements.createdAt));
  return res.json(rows);
});
router.get("/partner/pagos", requireAuth, async (req, res) => {
  const rows = await db.select().from(payments).where(eq(payments.clienteId, userId(req))).orderBy(desc(payments.createdAt));
  return res.json(rows);
});
router.post("/pagos", requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const changaId = numberValue(body.changaId);
  if (!changaId || !Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0) return res.status(400).json({ error: "Indicá la changa y un importe válido." });
  const [created] = await db.insert(payments).values({ changaId, clienteId: userId(req), amount: String(Number(body.amount)), currency: "ARS", provider: "mercado_pago", status: "pendiente" }).returning();
  await db.insert(workyAuditEvents).values({ usuarioId: userId(req), entidad: "payment", entidadId: created.id, accion: "created", estadoNuevo: "pendiente", metadata: { provider: "mercado_pago" } });
  return res.status(201).json({ ...created, checkoutReady: false, message: "Pago creado. Esperando confirmación segura del proveedor." });
});
router.post("/reservas", requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const changaId = numberValue(body.changaId);
  if (!Number.isInteger(changaId) || !body.profesionalId || !body.empiezaAt) return res.status(400).json({ error: "Faltan datos para solicitar la reserva." });
  const [job] = await db.select().from(jobs).where(eq(jobs.id, changaId)).limit(1);
  if (!job || job.clienteId !== userId(req)) return res.status(403).json({ error: "Solo el cliente de la changa puede solicitar una reserva." });
  if (!job.profesionalId || numberValue(body.profesionalId) !== job.profesionalId) return res.status(400).json({ error: "El Partner no corresponde a esta changa." });
  const empiezaAt = new Date(body.empiezaAt);
  if (Number.isNaN(empiezaAt.getTime()) || empiezaAt.getTime() < Date.now()) return res.status(400).json({ error: "Elegí una fecha futura válida." });
  const [created] = await db.insert(bookings).values({ changaId, clienteId: job.clienteId, profesionalId: job.profesionalId, empiezaAt, terminaAt: body.terminaAt ? new Date(body.terminaAt) : null }).returning();
  await db.insert(workyAuditEvents).values({ usuarioId: userId(req), entidad: "booking", entidadId: created.id, accion: "created", estadoNuevo: "solicitada", metadata: {} });
  await db.insert(workyNotifications).values({ usuarioId: created.profesionalId, tipo: "booking", titulo: "Nueva solicitud de reserva", detalle: "Tenés una reserva pendiente de revisar.", href: `/chat/${created.changaId}` });
  return res.status(201).json(created);
});
router.get("/profesionales/:id", async (req, res) => {
  const requestedId = numberValue(req.params.id);
  const [rowByProfileId] = await db.select({ profile: professionalProfiles, user: users }).from(professionalProfiles).innerJoin(users, eq(users.id, professionalProfiles.usuarioId)).where(eq(professionalProfiles.id, requestedId)).limit(1);
  const [rowByUserId] = rowByProfileId ? [] : await db.select({ profile: professionalProfiles, user: users }).from(professionalProfiles).innerJoin(users, eq(users.id, professionalProfiles.usuarioId)).where(eq(professionalProfiles.usuarioId, requestedId)).limit(1);
  const row = rowByProfileId || rowByUserId;
  if (!row) return res.status(404).json({ error: "Profesional no encontrado." });
  return res.json(await publicProfileView(row));
});

async function myProfile(req: Request) {
  return db.select({ profile: professionalProfiles, user: users }).from(professionalProfiles).innerJoin(users, eq(users.id, userId(req))).where(eq(professionalProfiles.usuarioId, userId(req))).limit(1);
}
router.get(["/perfil-profesional/mio", "/partner-profile/me"], requireAuth, async (req, res) => {
  const [row] = await myProfile(req);
  return res.json(row ? await publicProfileView(row) : null);
});
router.post("/partner-profile", requireAuth, async (req, res) => {
  const [existing] = await myProfile(req);
  if (existing) return res.status(200).json(await publicProfileView(existing));
  const body = req.body ?? {};
  if (!body.oficio || !body.categoria) return res.status(400).json({ error: "Indicá el oficio y la categoría para ofrecer tus servicios." });
  if (!categories.includes(body.categoria)) return res.status(400).json({ error: "La categoría seleccionada no es válida." });
  const [created] = await db.insert(professionalProfiles).values({ usuarioId: userId(req), oficio: String(body.oficio), categoria: body.categoria, precioReferencia: String(numberValue(body.precioReferencia) || 0), skills: Array.isArray(body.skills) ? body.skills.map(String) : [], about: body.about || null, experienciaAnios: Math.max(0, numberValue(body.experienciaAnios) || 0), disponible: true }).returning();
  const [owner] = await db.select().from(users).where(eq(users.id, userId(req))).limit(1);
  return res.status(201).json(await publicProfileView({ profile: created, user: owner }));
});
router.put(["/perfil-profesional/mio", "/partner-profile/me"], requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const fields = missing({ oficio: body.oficio, categoria: body.categoria, precioReferencia: body.precioReferencia });
  if (fields.length) return res.status(400).json({ error: "Completá los datos obligatorios del perfil.", campos_faltantes: fields });
  if (!categories.includes(body.categoria)) return res.status(400).json({ error: "La categoría seleccionada no es válida." });
  const values = { usuarioId: userId(req), oficio: String(body.oficio), categoria: body.categoria, matriculaHabilitante: body.matriculaHabilitante || null, skills: Array.isArray(body.skills) ? body.skills.map(String) : [], about: body.about || null, experienciaAnios: Math.max(0, numberValue(body.experienciaAnios) || 0), precioReferencia: String(numberValue(body.precioReferencia)), disponible: body.disponible !== false, updatedAt: new Date() };
  const [saved] = await db.insert(professionalProfiles).values(values).onConflictDoUpdate({ target: professionalProfiles.usuarioId, set: values }).returning();
  const [owner] = await db.select().from(users).where(eq(users.id, userId(req))).limit(1);
  return res.json(await publicProfileView({ profile: saved, user: owner }));
});

router.get("/profesionales/:id/reputacion", async (req, res) => {
  const professionalId = numberValue(req.params.id);
  const [profileById] = await db.select().from(professionalProfiles).where(eq(professionalProfiles.id, professionalId)).limit(1);
  const [profileByUserId] = profileById ? [] : await db.select().from(professionalProfiles).where(eq(professionalProfiles.usuarioId, professionalId)).limit(1);
  const profile = profileById || profileByUserId;
  if (!profile) return res.status(404).json({ error: "Profesional no encontrado." });
  const reputation = await reputationView(profile.usuarioId);
  const rows = await db.select({ review: reviews, author: users }).from(reviews).innerJoin(users, eq(users.id, reviews.clienteId)).where(eq(reviews.profesionalId, profile.usuarioId)).orderBy(desc(reviews.createdAt));
  const publicRecommendations = await db.select({ recommendation: recommendations, author: users }).from(recommendations).innerJoin(users, eq(users.id, recommendations.clienteId)).where(and(eq(recommendations.profesionalId, profile.usuarioId), eq(recommendations.visibilidad, "publica"))).orderBy(desc(recommendations.createdAt));
  return res.json({
    ...reputation,
    reviews: rows.map(({ review, author }) => ({ ...review, adjuntos: review.adjuntos ?? [], autor: { id: author.id, nombre: author.nombre } })),
    recommendations: publicRecommendations.map(({ recommendation, author }) => ({ ...recommendation, autor: { id: author.id, nombre: author.nombre } })),
  });
});

router.post("/reviews", requireAuth, async (req, res) => {
  const changaId = numberValue(req.body?.changaId);
  const rating = numberValue(req.body?.rating);
  if (!Number.isInteger(changaId) || !Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: "Indicá una calificación entre 1 y 5." });
  const [job] = await db.select().from(jobs).where(eq(jobs.id, changaId)).limit(1);
  if (!job || job.clienteId !== userId(req)) return res.status(403).json({ error: "Solo el cliente de la changa puede calificarla." });
  if (job.estado !== "finalizada" || !job.profesionalId) return res.status(409).json({ error: "Solo podés calificar changas finalizadas." });
  const [existing] = await db.select().from(reviews).where(and(eq(reviews.changaId, changaId), eq(reviews.clienteId, userId(req)))).limit(1);
  if (existing) return res.status(409).json({ error: "Ya calificaste esta changa." });
  try {
    const adjuntos = Array.isArray(req.body?.adjuntos)
      ? req.body.adjuntos.filter((item: unknown) => item && typeof item === "object" && typeof (item as { objectPath?: unknown }).objectPath === "string").slice(0, 6).map((item: any) => ({
        objectPath: String(item.objectPath),
        nombre: String(item.nombre || "Archivo del trabajo").slice(0, 120),
        contentType: String(item.contentType || "application/octet-stream").slice(0, 120),
        sizeBytes: Math.max(0, Number(item.sizeBytes) || 0),
      }))
      : [];
    const [created] = await db.insert(reviews).values({ changaId, clienteId: userId(req), profesionalId: job.profesionalId, rating, comentario: req.body?.comentario ? String(req.body.comentario).trim() : null, adjuntos }).returning();
    return res.status(201).json(created);
  } catch {
    return res.status(409).json({ error: "Ya calificaste esta changa." });
  }
});

router.post("/recomendaciones", requireAuth, async (req, res) => {
  const profesionalId = numberValue(req.body?.profesionalId);
  const visibilidad = req.body?.visibilidad === "privada" ? "privada" : "publica";
  if (!Number.isInteger(profesionalId)) return res.status(400).json({ error: "Indicá un Partner válido." });
  if (profesionalId === userId(req)) return res.status(400).json({ error: "No podés recomendarte a vos mismo." });
  const [partner] = await db.select().from(professionalProfiles).where(eq(professionalProfiles.usuarioId, profesionalId)).limit(1);
  if (!partner) return res.status(404).json({ error: "Partner no encontrado." });
  const [existing] = await db.select().from(recommendations).where(and(eq(recommendations.clienteId, userId(req)), eq(recommendations.profesionalId, profesionalId))).limit(1);
  if (existing) return res.status(409).json({ error: "Ya recomendaste a este Partner." });
  try {
    const [created] = await db.insert(recommendations).values({ clienteId: userId(req), profesionalId, visibilidad, comentario: req.body?.comentario ? String(req.body.comentario).trim() : null }).returning();
    return res.status(201).json(created);
  } catch {
    return res.status(409).json({ error: "Ya recomendaste a este Partner." });
  }
});

router.post("/trabajos", requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const fields = missing({ "ubicacion.direccionTexto": body.ubicacion?.direccionTexto, categoria: body.categoria, precioOfrecido: body.precioOfrecido });
  if (fields.length) return res.status(400).json({ error: "Completá ubicación, categoría y precio ofrecido.", campos_faltantes: fields });
  if (!categories.includes(body.categoria)) return res.status(400).json({ error: "La categoría seleccionada no es válida." });
  const requestedProfessionalId = body.profesionalId == null ? null : numberValue(body.profesionalId);
  if (requestedProfessionalId !== null && !Number.isInteger(requestedProfessionalId)) return res.status(400).json({ error: "El Partner seleccionado no es válido." });
  const [targetProfile] = requestedProfessionalId === null ? [null] : await db.select().from(professionalProfiles).where(eq(professionalProfiles.usuarioId, requestedProfessionalId)).limit(1);
  if (requestedProfessionalId !== null && !targetProfile) return res.status(404).json({ error: "El Partner seleccionado no existe." });
  const [created] = await db.insert(jobs).values({
    clienteId: userId(req),
    profesionalId: targetProfile?.usuarioId ?? null,
    ubicacion: { direccionTexto: String(body.ubicacion.direccionTexto), coordinates: body.ubicacion.coordinates ?? null },
    categoria: body.categoria,
    precioOfrecido: String(numberValue(body.precioOfrecido)),
    detalle: body.detalle || null,
    estado: targetProfile ? "aceptada" : "publicada",
  }).returning();
  const [client] = await db.select().from(users).where(eq(users.id, created.clienteId)).limit(1);
  const [professional] = created.profesionalId ? await db.select().from(users).where(eq(users.id, created.profesionalId)).limit(1) : [null];
  await notify(created.profesionalId, "Nueva solicitud de changa", "Un cliente te eligió para una nueva changa.", `/chat/${created.id}`);
  return res.status(201).json(jobView({ job: created, client, professional }));
});
async function jobsFor(where?: SQL) {
  return db.select({ job: jobs, client: users }).from(jobs).innerJoin(users, eq(users.id, jobs.clienteId)).where(where).orderBy(desc(jobs.createdAt));
}
async function serializeJobs(rows: Awaited<ReturnType<typeof jobsFor>>) {
  return Promise.all(rows.map(async (row) => {
    const [professional] = row.job.profesionalId ? await db.select().from(users).where(eq(users.id, row.job.profesionalId)).limit(1) : [null];
    const [review] = await db.select({ id: reviews.id }).from(reviews).where(and(
      eq(reviews.changaId, row.job.id),
      eq(reviews.clienteId, row.job.clienteId),
    )).limit(1);
    return { ...jobView({ ...row, professional }), calificada: Boolean(review) };
  }));
}
router.get("/trabajos/mias", requireAuth, async (req, res) => res.json(await serializeJobs(await jobsFor(eq(jobs.clienteId, userId(req))))));
router.get("/trabajos/disponibles", requireAuth, async (req, res) => {
  const [profile] = await db.select().from(professionalProfiles).where(eq(professionalProfiles.usuarioId, userId(req))).limit(1);
  if (!profile) return res.json([]);
  const page = Math.max(1, numberValue(req.query.page) || 1); const limit = Math.min(50, Math.max(1, numberValue(req.query.limit) || 12));
  const rows = await jobsFor(and(eq(jobs.estado, "publicada"), eq(jobs.categoria, profile.categoria)));
  return res.json(await serializeJobs(rows.slice((page - 1) * limit, page * limit)));
});
router.get("/trabajos/asignadas", requireAuth, async (req, res) => res.json(await serializeJobs(await jobsFor(and(eq(jobs.profesionalId, userId(req)), sql`${jobs.estado} in ('aceptada', 'en_curso', 'finalizada')`)))));
router.patch("/trabajos/:id/aceptar", requireAuth, async (req, res) => {
  const [updated] = await db.update(jobs).set({ profesionalId: userId(req), estado: "aceptada", updatedAt: new Date() }).where(and(eq(jobs.id, numberValue(req.params.id)), eq(jobs.estado, "publicada"), sql`${jobs.profesionalId} IS NULL`)).returning();
  if (!updated) return res.status(409).json({ error: "Esta changa ya no está disponible." });
  const [client] = await db.select().from(users).where(eq(users.id, updated.clienteId)).limit(1);
  const [professional] = await db.select().from(users).where(eq(users.id, userId(req))).limit(1);
  await db.update(professionalProfiles).set({ cantidadChangas: sql`${professionalProfiles.cantidadChangas} + 1`, updatedAt: new Date() }).where(eq(professionalProfiles.usuarioId, userId(req)));
  return res.json(jobView({ job: updated, client, professional }));
});
router.patch("/trabajos/:id", requireAuth, async (req, res) => {
  const next = req.body?.estado;
  if (!statuses.includes(next)) return res.status(400).json({ error: "El estado de la changa no es válido." });
  const [current] = await db.select().from(jobs).where(eq(jobs.id, numberValue(req.params.id))).limit(1);
  if (!current) return res.status(404).json({ error: "Changa no encontrada." });
  if (current.clienteId !== userId(req) && current.profesionalId !== userId(req)) return res.status(403).json({ error: "No podés modificar esta changa." });
  const allowed: Record<string, string[]> = { publicada: ["cancelada"], aceptada: ["en_curso", "cancelada"], en_curso: ["finalizada", "cancelada"], finalizada: [], cancelada: [] };
  if (!allowed[current.estado].includes(next) || (current.clienteId !== userId(req) && next === "cancelada" && current.profesionalId !== userId(req))) return res.status(409).json({ error: "Esta transición de estado no está permitida." });
  const [updated] = await db.update(jobs).set({ estado: next, updatedAt: new Date() }).where(eq(jobs.id, current.id)).returning();
  const [client] = await db.select().from(users).where(eq(users.id, updated.clienteId)).limit(1);
  const [professional] = updated.profesionalId ? await db.select().from(users).where(eq(users.id, updated.profesionalId)).limit(1) : [null];
  await db.insert(workyAuditEvents).values({ usuarioId: userId(req), entidad: "job", entidadId: updated.id, accion: "status_changed", estadoAnterior: current.estado, estadoNuevo: next, metadata: {} });
  await notify(userId(req) === updated.clienteId ? updated.profesionalId : updated.clienteId, "La changa cambió de estado", `Ahora está: ${next.replace("_", " ")}.`, `/chat/${updated.id}`);
  return res.json(jobView({ job: updated, client, professional }));
});
router.get("/trabajos/:id", requireAuth, async (req, res) => {
  const [row] = await db.select({ job: jobs, client: users }).from(jobs).innerJoin(users, eq(users.id, jobs.clienteId)).where(eq(jobs.id, numberValue(req.params.id))).limit(1);
  if (!row) return res.status(404).json({ error: "Changa no encontrada." });
  if (row.job.clienteId !== userId(req) && row.job.profesionalId !== userId(req)) return res.status(403).json({ error: "No participás en esta changa." });
  const [professional] = row.job.profesionalId ? await db.select().from(users).where(eq(users.id, row.job.profesionalId)).limit(1) : [null];
  return res.json(jobView({ ...row, professional }));
});

router.get("/conversaciones", requireAuth, async (req, res) => {
  const role = requestedConversationRole(req);
  if (role === "invalid") return res.status(400).json({ error: "El rol de la bandeja no es válido." });
  const participantFilter = role === "cliente"
    ? eq(jobs.clienteId, userId(req))
    : role === "profesional"
      ? eq(jobs.profesionalId, userId(req))
      : sql`${jobs.clienteId} = ${userId(req)} OR ${jobs.profesionalId} = ${userId(req)}`;
  const owned = await db.select({ job: jobs, client: users }).from(jobs).innerJoin(users, eq(users.id, jobs.clienteId))
    .where(participantFilter).orderBy(desc(jobs.updatedAt));
  const items = await Promise.all(owned.map(async ({ job, client }) => {
    const [last] = await db.select({ message: messages, sender: users }).from(messages).innerJoin(users, eq(users.id, messages.emisorId))
      .where(eq(messages.changaId, job.id)).orderBy(desc(messages.createdAt)).limit(1);
    const unread = await db.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.changaId, job.id), eq(messages.leido, false), sql`${messages.emisorId} <> ${userId(req)}`));
    const otherId = job.clienteId === userId(req) ? job.profesionalId : job.clienteId;
    const [other] = otherId ? await db.select().from(users).where(eq(users.id, otherId)).limit(1) : [null];
    return {
      changaId: job.id, estado: job.estado, categoria: job.categoria, detalle: job.detalle,
      updatedAt: job.updatedAt, unread: unread.length, interlocutor: other ? safeUser(other) : null,
      ultimoMensaje: last ? { ...last.message, emisor: safeUser(last.sender) } : null,
    };
  }));
  return res.json(items.sort((a, b) => new Date(b.ultimoMensaje?.createdAt ?? b.updatedAt).getTime() - new Date(a.ultimoMensaje?.createdAt ?? a.updatedAt).getTime()));
});

router.get("/chats/:changaId/mensajes", requireAuth, async (req, res) => {
  const changaId = numberValue(req.params.changaId);
  const job = await conversationJob(changaId, userId(req));
  if (!job) return res.status(403).json({ error: "No participás en esta conversación." });
  const rows = await db.select({ message: messages, sender: users }).from(messages).innerJoin(users, eq(users.id, messages.emisorId)).where(eq(messages.changaId, changaId)).orderBy(asc(messages.createdAt));
  return res.json(rows.map(({ message, sender }) => ({ ...message, emisor: safeUser(sender), texto: message.texto, adjuntos: message.adjuntos ?? [] })));
});
router.post("/chats/:changaId/leidos", requireAuth, async (req, res) => {
  const changaId = numberValue(req.params.changaId);
  const job = await conversationJob(changaId, userId(req));
  if (!job) return res.status(403).json({ error: "No participás en esta conversación." });
  await db.update(messages).set({ leido: true }).where(and(eq(messages.changaId, changaId), sql`${messages.emisorId} <> ${userId(req)}`));
  return res.status(204).send();
});
router.post("/chats/:changaId/mensajes", requireAuth, async (req, res) => {
  const changaId = numberValue(req.params.changaId);
  const job = await conversationJob(changaId, userId(req));
  if (!job) return res.status(403).json({ error: "No participás en esta conversación." });
  const texto = String(req.body?.texto ?? "").trim();
  const attachments = Array.isArray(req.body?.adjuntos) ? req.body.adjuntos.filter((item: unknown) => item && typeof item === "object" && typeof (item as { objectPath?: unknown }).objectPath === "string").slice(0, 5) : [];
  if (!texto && !attachments.length) return res.status(400).json({ error: "El mensaje no puede estar vacío." });
  for (const attachment of attachments) {
    const objectPath = String((attachment as { objectPath: string }).objectPath);
    const match = objectPath.match(/^\/objects\/chat-attachments\/(\d+)\/(\d+)\/([0-9a-f-]{36})$/);
    if (!match || Number(match[1]) !== changaId || Number(match[2]) !== userId(req)) {
      return res.status(400).json({ error: "Uno de los adjuntos no pertenece a esta conversación." });
    }
  }
  const objectPaths = attachments.map((attachment: any) => String((attachment as { objectPath: string }).objectPath));
  if (new Set(objectPaths).size !== objectPaths.length) return res.status(400).json({ error: "No repitas un adjunto en el mismo mensaje." });
  for (const objectPath of objectPaths) {
    if (!(await isValidImageObject(objectPath))) {
      res.status(400).json({ error: "Uno de los adjuntos no es una imagen válida o ya no está disponible." });
      void cleanupRejectedChatAttachment(objectPath, changaId, userId(req)).catch((error) => {
        req.log.warn({ err: error, changaId, objectPath }, "No se pudo iniciar la limpieza de una carga de chat rechazada");
      });
      return;
    }
  }
  let created: typeof messages.$inferSelect;
  try {
    created = await db.transaction(async (tx) => {
      const trackedUploads = objectPaths.length
        ? await tx.select().from(chatUploads).where(and(
          eq(chatUploads.changaId, changaId),
          eq(chatUploads.usuarioId, userId(req)),
          inArray(chatUploads.objectPath, objectPaths),
        )).for("update")
        : [];
      if (trackedUploads.length !== objectPaths.length || trackedUploads.some((upload) => upload.estado !== "pending")) {
        throw new Error("Uno de los adjuntos ya no está disponible. Volvé a cargarlo.");
      }
      const [message] = await tx.insert(messages).values({ changaId, emisorId: userId(req), texto: texto || "Imagen adjunta", adjuntos: attachments }).returning();
      if (objectPaths.length) {
        const associated = await tx.update(chatUploads).set({
          estado: "associated",
          associatedMessageId: message.id,
          updatedAt: new Date(),
        }).where(and(
          eq(chatUploads.changaId, changaId),
          eq(chatUploads.usuarioId, userId(req)),
          inArray(chatUploads.objectPath, objectPaths),
          eq(chatUploads.estado, "pending"),
        )).returning({ id: chatUploads.id });
        if (associated.length !== objectPaths.length) {
          throw new Error("Uno de los adjuntos ya no está disponible. Volvé a cargarlo.");
        }
      }
      return message;
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("adjuntos")) return res.status(400).json({ error: error.message });
    throw error;
  }
  await db.update(jobs).set({ updatedAt: new Date() }).where(eq(jobs.id, changaId));
  const [sender] = await db.select().from(users).where(eq(users.id, userId(req))).limit(1);
  await notify(userId(req) === job.clienteId ? job.profesionalId : job.clienteId, "Nuevo mensaje", "Tenés una respuesta en una conversación activa.", `/chat/${req.params.changaId}`);
  return res.status(201).json({ ...created, emisor: safeUser(sender), adjuntos: created.adjuntos ?? [] });
});

router.get("/chats/:changaId/citas", requireAuth, async (req, res) => {
  const changaId = numberValue(req.params.changaId);
  const job = await conversationJob(changaId, userId(req));
  if (!job) return res.status(403).json({ error: "No participás en esta conversación." });
  if (!job.profesionalId) return res.json([]);
  return res.json(await db.select().from(bookings).where(and(eq(bookings.changaId, changaId), eq(bookings.clienteId, job.clienteId), eq(bookings.profesionalId, job.profesionalId))).orderBy(desc(bookings.empiezaAt)));
});
router.post("/chats/:changaId/citas", requireAuth, async (req, res) => {
  const changaId = numberValue(req.params.changaId);
  const [job] = await db.select().from(jobs).where(eq(jobs.id, changaId)).limit(1);
  const empiezaAt = new Date(req.body?.empiezaAt);
  if (!job || !job.profesionalId || (job.clienteId !== userId(req) && job.profesionalId !== userId(req))) return res.status(403).json({ error: "No participás en esta conversación." });
  if (job.profesionalId !== userId(req)) return res.status(403).json({ error: "Solo el Partner puede proponer una visita." });
  if (Number.isNaN(empiezaAt.getTime()) || empiezaAt.getTime() < Date.now()) return res.status(400).json({ error: "Elegí una fecha futura válida." });
  const [activeAppointment] = await db.select({ id: bookings.id }).from(bookings).where(and(
    eq(bookings.changaId, changaId),
    sql`${bookings.estado} in ('solicitada', 'confirmada', 'en_curso')`,
  )).limit(1);
  if (activeAppointment) return res.status(409).json({ error: "Ya existe una visita activa para esta changa." });
  const terminaAt = req.body?.terminaAt ? new Date(req.body.terminaAt) : null;
  const [created] = await db.insert(bookings).values({ changaId, clienteId: job.clienteId, profesionalId: job.profesionalId, empiezaAt, terminaAt, estado: "solicitada" }).returning();
  await db.insert(workyAuditEvents).values({ usuarioId: userId(req), entidad: "appointment_attempt", entidadId: changaId, accion: "proponer", estadoNuevo: "exitoso", metadata: { appointmentId: created.id, empiezaAt: created.empiezaAt.toISOString() } });
  await notify(job.clienteId, "Nueva propuesta de visita", appointmentNotificationDetail(job.detalle, "propuesta"), `/chat/${changaId}`);
  return res.status(201).json(created);
});
const appointmentAttemptView = (event: typeof workyAuditEvents.$inferSelect) => {
  const metadata = (event.metadata && typeof event.metadata === "object" ? event.metadata : {}) as { appointmentId?: unknown; empiezaAt?: unknown; detalle?: unknown };
  return {
    id: event.id,
    changaId: event.entidadId,
    accion: event.accion,
    resultado: event.estadoNuevo,
    detalle: typeof metadata.detalle === "string" ? metadata.detalle : null,
    appointmentId: Number.isFinite(Number(metadata.appointmentId)) ? Number(metadata.appointmentId) : null,
    empiezaAt: typeof metadata.empiezaAt === "string" ? metadata.empiezaAt : null,
    createdAt: event.createdAt,
  };
};
router.get("/chats/:changaId/historial-visitas", requireAuth, async (req, res) => {
  const changaId = numberValue(req.params.changaId);
  const job = await conversationJob(changaId, userId(req));
  if (!job) return res.status(403).json({ error: "No participás en esta conversación." });
  const events = await db.select().from(workyAuditEvents).where(and(eq(workyAuditEvents.entidad, "appointment_attempt"), eq(workyAuditEvents.entidadId, changaId))).orderBy(desc(workyAuditEvents.createdAt));
  return res.json(events.map(appointmentAttemptView));
});
router.post("/chats/:changaId/historial-visitas", requireAuth, async (req, res) => {
  const changaId = numberValue(req.params.changaId);
  const job = await conversationJob(changaId, userId(req));
  const accion = req.body?.accion;
  const resultado = req.body?.resultado;
  if (!job) return res.status(403).json({ error: "No participás en esta conversación." });
  if (!["proponer", "aceptar", "rechazar", "cancelar"].includes(accion) || !["error_permiso", "error_validacion", "error_red"].includes(resultado)) return res.status(400).json({ error: "El intento de coordinación no es válido." });
  const [event] = await db.insert(workyAuditEvents).values({ usuarioId: userId(req), entidad: "appointment_attempt", entidadId: changaId, accion, estadoNuevo: resultado, metadata: { detalle: String(req.body?.detalle ?? "").slice(0, 500) } }).returning();
  return res.status(201).json(appointmentAttemptView(event));
});
const updateAppointment = async (req: Request, res: Response) => {
  const [current] = await db.select().from(bookings).where(eq(bookings.id, numberValue(req.params.id))).limit(1);
  if (!current || (current.clienteId !== userId(req) && current.profesionalId !== userId(req))) return res.status(404).json({ error: "Cita no encontrada." });
  const job = await conversationJob(current.changaId, userId(req));
  if (!job || job.clienteId !== current.clienteId || job.profesionalId !== current.profesionalId) return res.status(404).json({ error: "Cita no encontrada." });
  const action = req.body?.accion;
  if (!["aceptar", "rechazar", "cancelar", "completar"].includes(action)) return res.status(400).json({ error: "La acción de la visita no es válida." });
  const nextStatus = action === "aceptar" ? "confirmada" : action === "rechazar" || action === "cancelar" ? "cancelada" : "completada";
  if (action === "aceptar" && current.clienteId !== userId(req)) return res.status(403).json({ error: "Solo el cliente puede aceptar la visita." });
  if (action === "rechazar" && current.clienteId !== userId(req)) return res.status(403).json({ error: "Solo el cliente puede rechazar la visita." });
  if (action === "cancelar" && current.clienteId !== userId(req)) return res.status(403).json({ error: "Solo el cliente puede cancelar la visita." });
  if (action === "aceptar" && current.estado !== "solicitada") return res.status(409).json({ error: "Esta visita ya no está pendiente." });
  if (action === "rechazar" && current.estado !== "solicitada") return res.status(409).json({ error: "Esta visita ya no está pendiente." });
  if (action === "cancelar" && !["solicitada", "confirmada"].includes(current.estado)) return res.status(409).json({ error: "Solo podés cancelar una visita solicitada o confirmada." });
  const empiezaAt = req.body?.empiezaAt ? new Date(req.body.empiezaAt) : current.empiezaAt;
  if (action !== "rechazar" && action !== "cancelar" && (Number.isNaN(empiezaAt.getTime()) || empiezaAt.getTime() < Date.now())) return res.status(400).json({ error: "Elegí una fecha futura válida." });
  const [updated] = await db.update(bookings).set({ empiezaAt, estado: nextStatus, updatedAt: new Date() }).where(eq(bookings.id, current.id)).returning();
  await db.insert(workyAuditEvents).values({ usuarioId: userId(req), entidad: "appointment_attempt", entidadId: current.changaId, accion: action === "aceptar" ? "aceptar" : action === "cancelar" ? "cancelar" : "rechazar", estadoAnterior: current.estado, estadoNuevo: action === "rechazar" ? "rechazado" : "exitoso", metadata: { appointmentId: current.id, empiezaAt: updated.empiezaAt.toISOString() } });
  const outcome = nextStatus === "confirmada" ? "confirmada" : action === "cancelar" ? "cancelada" : "rechazada";
  await notify(
    userId(req) === current.clienteId ? current.profesionalId : current.clienteId,
    action === "aceptar" ? "Visita confirmada" : action === "cancelar" ? "Visita cancelada" : "Visita rechazada",
    outcome === "cancelada" ? `La visita fue cancelada${job.detalle?.trim() ? ` para "${job.detalle.trim().slice(0, 120)}"` : ""}.` : appointmentNotificationDetail(job.detalle, outcome),
    `/chat/${current.changaId}`,
  );
  return res.json(updated);
};
router.patch("/citas/:id", requireAuth, updateAppointment);
router.post("/citas/:id/aceptar", requireAuth, (req, res) => {
  req.body = { ...(req.body ?? {}), accion: "aceptar" };
  return updateAppointment(req, res);
});
router.post("/citas/:id/rechazar", requireAuth, (req, res) => {
  req.body = { ...(req.body ?? {}), accion: "rechazar" };
  return updateAppointment(req, res);
});

export default router;