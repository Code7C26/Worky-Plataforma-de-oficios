import { Router, type IRouter, type Request, type RequestHandler } from "express";
import { Readable } from "node:stream";
import { and, asc, count, desc, eq, exists, gte, gt, ilike, inArray, isNotNull, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  bookings,
  clientIdentityVerifications,
  clientVerificationUploads,
  db,
  jobs,
  messages,
  payments,
  professionalAssets,
  professionalProfiles,
  professionalVerificationDocuments,
  profilePhotoUploads,
  recommendations,
  reviews,
  serviceCatalog,
  settlements,
  visitPayments,
  workyNotifications,
  users,
  workyAuditEvents,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { getPrimaryAdminEmail } from "../lib/admin-signup";
import { partnerVerificationStatus } from "../lib/partner-verification";
import { beginClientIdentityReview, finalizeClientIdentityReview } from "../lib/client-verification";
import { getObject, isClientVerificationReviewPath } from "../lib/storage";
import { settleAvailablePartnerCommissions } from "../lib/visit-commission-offset";
import {
  isPaidJobRecommendationRankingActive,
  isReviewableActivitySignal,
  RECOMMENDATION_RISK_DECISION_ACTIONS,
  RECOMMENDATION_RISK_REVIEW_THRESHOLD,
  RECOMMENDATION_RISK_WINDOW_DAYS,
} from "../lib/recommendation-ranking";

const router: IRouter = Router();
const adminClient = alias(users, "admin_client");
const adminPartner = alias(users, "admin_partner");
const accountRoles = ["cliente", "profesional", "admin"] as const;
const verificationStates = ["pending_verification", "verified", "rejected"] as const;
const jobStates = ["publicada", "aceptada", "en_curso", "trabajo_realizado", "finalizada", "cancelada"] as const;
const bookingStates = ["solicitada", "confirmada", "en_curso", "completada", "cancelada"] as const;
const paymentStates = ["pendiente", "iniciado", "aprobado", "rechazado", "reembolsado"] as const;
const settlementStates = ["pendiente", "en_revision", "pagada", "retenida", "cancelada"] as const;
const visibilityStates = ["publica", "privada"] as const;
const categories = ["Plomería", "Electricidad", "Gas", "Albañilería", "Otro"] as const;

const requireAdmin: RequestHandler = async (req, res, next) => {
  try {
    const [account] = await db.select({ role: users.rol, active: users.activo })
      .from(users)
      .where(eq(users.id, req.usuarioId ?? -1))
      .limit(1);
    if (!account?.active) return res.status(401).json({ error: "La cuenta no está activa." });
    if (account.role !== "admin") return res.status(403).json({ error: "Solo una persona administradora puede usar este panel." });
    return next();
  } catch (error) {
    return next(error);
  }
};

router.use(requireAuth, requireAdmin);

const clientIdentityReasonCodes = ["dni_unreadable", "selfie_unusable", "identity_mismatch"] as const;

router.get("/client-verifications", async (req, res) => {
  const { page, limit, offset } = paging(req);
  const search = searchPattern(searchText(req));
  const condition = and(
    eq(clientIdentityVerifications.estado, "pending_verification"),
    search ? or(ilike(users.nombre, search), ilike(users.email, search)) : undefined,
  );
  const [countRows, rows] = await Promise.all([
    db.select({ total: count() }).from(clientIdentityVerifications)
      .innerJoin(users, eq(users.id, clientIdentityVerifications.usuarioId)).where(condition),
    db.select({
      id: clientIdentityVerifications.id,
      userId: users.id,
      name: users.nombre,
      email: users.email,
      submittedAt: clientIdentityVerifications.submittedAt,
      hasDni: clientIdentityVerifications.dniObjectPath,
      hasSelfie: clientIdentityVerifications.selfieObjectPath,
    }).from(clientIdentityVerifications)
      .innerJoin(users, eq(users.id, clientIdentityVerifications.usuarioId))
      .where(condition)
      .orderBy(asc(clientIdentityVerifications.submittedAt), asc(clientIdentityVerifications.id))
      .limit(limit)
      .offset(offset),
  ]);
  return res.json(pageResponse(rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    name: row.name,
    email: row.email,
    submittedAt: row.submittedAt,
    hasDni: Boolean(row.hasDni),
    hasSelfie: Boolean(row.hasSelfie),
  })), Number(countRows[0]?.total ?? 0), page, limit));
});

router.get("/client-verifications/:id/files/:kind", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const kind = req.params.kind;
  if (!Number.isInteger(id) || id < 1 || (kind !== "dni" && kind !== "selfie")) {
    res.status(404).json({ error: "Imagen no encontrada." }); return;
  }
  const [verification] = await db.select({
    usuarioId: clientIdentityVerifications.usuarioId,
    estado: clientIdentityVerifications.estado,
    objectPath: kind === "dni" ? clientIdentityVerifications.dniObjectPath : clientIdentityVerifications.selfieObjectPath,
  }).from(clientIdentityVerifications).where(eq(clientIdentityVerifications.id, id)).limit(1);
  if (!verification || verification.estado !== "pending_verification" || !verification.objectPath
    || !isClientVerificationReviewPath(verification.objectPath, verification.usuarioId)) {
    res.status(404).json({ error: "Imagen no encontrada." }); return;
  }
  const [upload] = await db.select({ contentType: clientVerificationUploads.contentType, sizeBytes: clientVerificationUploads.sizeBytes })
    .from(clientVerificationUploads).where(eq(clientVerificationUploads.reviewObjectPath, verification.objectPath)).limit(1);
  if (upload?.contentType !== "image/webp" || !upload.sizeBytes || upload.sizeBytes > 10 * 1024 * 1024) {
    res.status(404).json({ error: "Imagen no encontrada." }); return;
  }
  const file = await getObject(verification.objectPath);
  if (!file) { res.status(404).json({ error: "Imagen no encontrada." }); return; }
  const [metadata] = await file.getMetadata();
  if (metadata.size !== null && metadata.size > 10 * 1024 * 1024) {
    res.status(404).json({ error: "Imagen no encontrada." }); return;
  }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  Readable.from(file.createReadStream()).pipe(res);
});

router.patch("/client-verifications/:id", async (req, res) => {
  const id = Number(req.params.id);
  const decision = req.body?.decision;
  const reasonCode = req.body?.reasonCode ?? null;
  if (!Number.isInteger(id) || id < 1 || (decision !== "verified" && decision !== "rejected")) {
    return res.status(400).json({ error: "La decisión de verificación no es válida." });
  }
  if (decision === "rejected" && !clientIdentityReasonCodes.includes(reasonCode)) {
    return res.status(400).json({ error: "Elegí un motivo de rechazo." });
  }
  const claimed = await beginClientIdentityReview(
    id,
    req.usuarioId ?? -1,
    decision,
    decision === "rejected" ? reasonCode : null,
  );
  if (!claimed) {
    const [exists] = await db.select({ id: clientIdentityVerifications.id })
      .from(clientIdentityVerifications).where(eq(clientIdentityVerifications.id, id)).limit(1);
    return exists
      ? res.status(409).json({ error: "Esta solicitud ya no está pendiente de revisión." })
      : res.status(404).json({ error: "Solicitud de verificación no encontrada." });
  }
  const result = await finalizeClientIdentityReview(id);
  if (result.kind === "delete-failed") {
    return res.status(500).json({ error: "No pudimos eliminar las imágenes; la resolución se reintentará automáticamente." });
  }
  if (result.kind !== "resolved") {
    return res.status(409).json({ error: "La solicitud cambió durante la revisión. Actualizá la cola e intentá otra vez." });
  }
  return res.json(result.status);
});

async function isPrimaryAdmin(userId: number) {
  const [account] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return Boolean(account && account.email.trim().toLowerCase() === getPrimaryAdminEmail());
}


router.patch("/admins/:id/role", async (req, res) => {
  if (!(await isPrimaryAdmin(req.usuarioId ?? -1))) return res.status(403).json({ error: "Solo el administrador principal puede delegar o quitar roles admin." });
  const id = Number(req.params.id);
  const reason = reasonOf(req.body?.reason);
  if (!Number.isInteger(id) || id < 1 || reason.length < 5) return res.status(400).json({ error: "Indicá una cuenta válida y un motivo de al menos 5 caracteres." });
  if (id === req.usuarioId) return res.status(409).json({ error: "No se puede quitar el rol del administrador principal." });
  const result = await db.transaction(async (tx) => {
    const [target] = await tx.select({ id: users.id, email: users.email, role: users.rol })
      .from(users).where(eq(users.id, id)).for("update").limit(1);
    if (!target) return { kind: "missing" as const };
    if (target.email.trim().toLowerCase() === getPrimaryAdminEmail()) return { kind: "primary" as const };
    if (target.role !== "admin") return { kind: "unchanged" as const };
    const [profile] = await tx.select({ id: professionalProfiles.id }).from(professionalProfiles)
      .where(eq(professionalProfiles.usuarioId, target.id)).limit(1);
    const restoredRole = profile ? "profesional" : "cliente";
    const [updated] = await tx.update(users).set({ rol: restoredRole, updatedAt: new Date() })
      .where(and(eq(users.id, target.id), eq(users.rol, "admin"))).returning({ id: users.id });
    if (!updated) return { kind: "conflict" as const };
    await tx.insert(workyAuditEvents).values({
      usuarioId: req.usuarioId!,
      entidad: "account",
      entidadId: target.id,
      accion: "role_revoked",
      estadoAnterior: "admin",
      estadoNuevo: restoredRole,
      metadata: { reason },
    });
    return { kind: "updated" as const, role: restoredRole };
  });
  if (result.kind === "missing") return res.status(404).json({ error: "No encontramos esa cuenta." });
  if (result.kind === "primary") return res.status(409).json({ error: "No se puede quitar el rol del administrador principal." });
  if (result.kind === "conflict") return res.status(409).json({ error: "La cuenta cambió durante la operación. Actualizá e intentá otra vez." });
  return res.json({ id, role: result.kind === "updated" ? result.role : "admin", unchanged: result.kind === "unchanged" });
});

router.get("/admins", async (req, res) => {
  const primary = await isPrimaryAdmin(req.usuarioId ?? -1);
  if (!primary) return res.json({ isPrimaryAdmin: false, primaryAdminId: null, items: [] });
  const primaryEmail = getPrimaryAdminEmail();
  const [primaryAccount] = primaryEmail
    ? await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${primaryEmail}`).limit(1)
    : [];
  const rows = await db.select({
    id: users.id,
    name: users.nombre,
    email: users.email,
    emailVerifiedAt: users.emailVerifiedAt,
    createdAt: users.createdAt,
  }).from(users).where(eq(users.rol, "admin")).orderBy(asc(users.createdAt), asc(users.id));
  return res.json({ isPrimaryAdmin: true, primaryAdminId: primaryAccount?.id ?? null, items: rows });
});

function paging(req: Request) {
  const requestedPage = Number(req.query.page);
  const requestedLimit = Number(req.query.limit);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(100, requestedLimit) : 25;
  return { page, limit, offset: (page - 1) * limit };
}

function searchText(req: Request) {
  return String(req.query.search ?? "").trim().slice(0, 120);
}

function searchPattern(search: string) {
  return search ? `%${search}%` : undefined;
}

function queryBoolean(req: Request, key: string): boolean | undefined | null {
  const value = req.query[key];
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function queryEnum<T extends readonly string[]>(req: Request, key: string, allowed: T): T[number] | undefined | null {
  const value = String(req.query[key] ?? "");
  if (!value) return undefined;
  return allowed.includes(value) ? value as T[number] : null;
}

function reasonOf(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 1000) : "";
}

function pageResponse<T>(items: T[], total: number, page: number, limit: number) {
  return { items, total, page, limit };
}

function cityOf(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const location = value as Record<string, unknown>;
  if (typeof location.ciudad === "string" && location.ciudad.trim()) return location.ciudad.trim();
  if (typeof location.zona === "string" && location.zona.trim()) return location.zona.trim();
  return null;
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(token|secret|password|object.?path|coordinate|address|direccion|email)/i.test(key)));
}

async function auditPage(page: number, limit: number, entity?: string) {
  const condition = entity ? eq(workyAuditEvents.entidad, entity) : undefined;
  const [totalRows, rows] = await Promise.all([
    db.select({ total: count() }).from(workyAuditEvents).where(condition),
    db.select({
      event: workyAuditEvents,
      actorName: users.nombre,
    }).from(workyAuditEvents)
      .leftJoin(users, eq(users.id, workyAuditEvents.usuarioId))
      .where(condition)
      .orderBy(desc(workyAuditEvents.createdAt), desc(workyAuditEvents.id))
      .limit(limit)
      .offset((page - 1) * limit),
  ]);
  const items = rows.map(({ event, actorName }) => ({
    id: event.id,
    actorId: event.usuarioId,
    actorName: actorName ?? null,
    entity: event.entidad,
    entityId: event.entidadId,
    action: event.accion,
    previousState: event.estadoAnterior,
    nextState: event.estadoNuevo,
    metadata: safeMetadata(event.metadata),
    createdAt: event.createdAt,
  }));
  return pageResponse(items, Number(totalRows[0]?.total ?? 0), page, limit);
}

async function partnerRecord(userId: number) {
  const [row] = await db.select({
    profile: professionalProfiles,
    id: users.id,
    name: users.nombre,
    email: users.email,
    phone: users.telefono,
    accountActive: users.activo,
  }).from(professionalProfiles)
    .innerJoin(users, eq(users.id, professionalProfiles.usuarioId))
    .where(eq(professionalProfiles.usuarioId, userId))
    .limit(1);
  if (!row) return null;
  const documents = await db.select({
    id: professionalVerificationDocuments.id,
    type: professionalVerificationDocuments.tipo,
    status: professionalVerificationDocuments.estado,
    name: professionalVerificationDocuments.nombre,
    sizeBytes: professionalVerificationDocuments.sizeBytes,
    createdAt: professionalVerificationDocuments.createdAt,
  }).from(professionalVerificationDocuments)
    .where(eq(professionalVerificationDocuments.profesionalId, userId))
    .orderBy(asc(professionalVerificationDocuments.tipo));
  return {
    userId: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    trade: row.profile.oficio,
    category: row.profile.categoria,
    verificationStatus: row.profile.estadoVerificacion,
    verified: row.profile.verificado,
    enabled: row.profile.habilitado,
    accountActive: row.accountActive,
    available: row.profile.disponible,
    experienceYears: row.profile.experienciaAnios,
    referencePrice: Number(row.profile.precioReferencia),
    rating: Number(row.profile.rating),
    createdAt: row.profile.createdAt,
    documents,
  };
}

router.get("/dashboard", async (_req, res) => {
  const [
    accountsTotal,
    accountsActive,
    partnersTotal,
    partnersPendingReview,
    partnersVerified,
    partnersEnabled,
    jobsTotal,
    bookingsTotal,
    paymentsTotal,
    settlementsTotal,
    reviewsTotal,
    recommendationsTotal,
    catalogItems,
    portfolioAssets,
    profilePhotos,
    chatMessages,
    recentActivity,
  ] = await Promise.all([
    db.select({ total: count() }).from(users),
    db.select({ total: count() }).from(users).where(eq(users.activo, true)),
    db.select({ total: count() }).from(professionalProfiles),
    db.select({ total: count() }).from(professionalProfiles).where(eq(professionalProfiles.habilitado, false)),
    db.select({ total: count() }).from(professionalProfiles).where(eq(professionalProfiles.verificado, true)),
    db.select({ total: count() }).from(professionalProfiles).innerJoin(users, eq(users.id, professionalProfiles.usuarioId))
      .where(and(eq(professionalProfiles.habilitado, true), eq(professionalProfiles.verificado, true), eq(users.activo, true))),
    db.select({ total: count() }).from(jobs),
    db.select({ total: count() }).from(bookings),
    db.select({ total: count() }).from(payments),
    db.select({ total: count() }).from(settlements),
    db.select({ total: count() }).from(reviews),
    db.select({ total: count() }).from(recommendations),
    db.select({ total: count() }).from(serviceCatalog),
    db.select({ total: count() }).from(professionalAssets),
    db.select({ total: count() }).from(users).where(isNotNull(users.fotoObjectPath)),
    db.select({ total: count() }).from(messages),
    auditPage(1, 6),
  ]);
  return res.json({
    accountsTotal: Number(accountsTotal[0]?.total ?? 0),
    accountsActive: Number(accountsActive[0]?.total ?? 0),
    partnersTotal: Number(partnersTotal[0]?.total ?? 0),
    partnersPendingReview: Number(partnersPendingReview[0]?.total ?? 0),
    partnersVerified: Number(partnersVerified[0]?.total ?? 0),
    partnersEnabled: Number(partnersEnabled[0]?.total ?? 0),
    jobsTotal: Number(jobsTotal[0]?.total ?? 0),
    bookingsTotal: Number(bookingsTotal[0]?.total ?? 0),
    paymentsTotal: Number(paymentsTotal[0]?.total ?? 0),
    settlementsTotal: Number(settlementsTotal[0]?.total ?? 0),
    reviewsTotal: Number(reviewsTotal[0]?.total ?? 0),
    recommendationsTotal: Number(recommendationsTotal[0]?.total ?? 0),
    catalogItems: Number(catalogItems[0]?.total ?? 0),
    portfolioAssets: Number(portfolioAssets[0]?.total ?? 0),
    profilePhotos: Number(profilePhotos[0]?.total ?? 0),
    chatMessages: Number(chatMessages[0]?.total ?? 0),
    recentActivity: recentActivity.items,
  });
});

router.get("/accounts", async (req, res) => {
  const role = queryEnum(req, "role", accountRoles);
  const active = queryBoolean(req, "active");
  if (role === null || active === null) return res.status(400).json({ error: "El filtro de cuentas no es válido." });
  const { page, limit, offset } = paging(req);
  const search = searchPattern(searchText(req));
  const condition = and(
    role ? eq(users.rol, role) : undefined,
    active !== undefined ? eq(users.activo, active) : undefined,
    search ? or(ilike(users.nombre, search), ilike(users.email, search), ilike(users.telefono, search)) : undefined,
  );
  const [countRows, rows] = await Promise.all([
    db.select({ total: count() }).from(users).where(condition),
    db.select({
      id: users.id,
      name: users.nombre,
      email: users.email,
      phone: users.telefono,
      role: users.rol,
      active: users.activo,
      emailVerifiedAt: users.emailVerifiedAt,
      createdAt: users.createdAt,
      location: users.ubicacion,
    }).from(users).where(condition).orderBy(desc(users.createdAt), desc(users.id)).limit(limit).offset(offset),
  ]);
  return res.json(pageResponse(rows.map((row) => ({
    ...row,
    city: cityOf(row.location),
  })).map(({ location: _location, ...row }) => row), Number(countRows[0]?.total ?? 0), page, limit));
});

router.patch("/accounts/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const active = req.body?.active;
  const reason = reasonOf(req.body?.reason);
  if (!Number.isInteger(id) || id < 1 || typeof active !== "boolean" || reason.length < 5) {
    return res.status(400).json({ error: "Indicá el estado de la cuenta y un motivo de al menos 5 caracteres." });
  }
  const [current] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!current) return res.status(404).json({ error: "No encontramos esa cuenta." });
  if (current.rol === "admin" || current.id === req.usuarioId) {
    return res.status(409).json({ error: "No se pueden suspender cuentas administradoras desde este panel." });
  }
  if (current.activo !== active) {
    await db.update(users).set({ activo: active, updatedAt: new Date() }).where(eq(users.id, id));
    await db.insert(workyAuditEvents).values({
      usuarioId: req.usuarioId!,
      entidad: "account",
      entidadId: id,
      accion: active ? "reactivated" : "suspended",
      estadoAnterior: String(current.activo),
      estadoNuevo: String(active),
      metadata: { motivo: reason },
    });
  }
  const [updated] = await db.select({
    id: users.id,
    name: users.nombre,
    email: users.email,
    phone: users.telefono,
    role: users.rol,
    active: users.activo,
    emailVerifiedAt: users.emailVerifiedAt,
    createdAt: users.createdAt,
    location: users.ubicacion,
  }).from(users).where(eq(users.id, id)).limit(1);
  if (!updated) return res.status(404).json({ error: "No encontramos esa cuenta." });
  const { location, ...account } = updated;
  return res.json({ ...account, city: cityOf(location) });
});

router.get("/partners", async (req, res) => {
  const verificationStatus = queryEnum(req, "verificationStatus", verificationStates);
  const enabled = queryBoolean(req, "enabled");
  if (verificationStatus === null || enabled === null) return res.status(400).json({ error: "El filtro de Partners no es válido." });
  const { page, limit, offset } = paging(req);
  const search = searchPattern(searchText(req));
  const condition = and(
    verificationStatus ? eq(professionalProfiles.estadoVerificacion, verificationStatus) : undefined,
    enabled !== undefined ? eq(professionalProfiles.habilitado, enabled) : undefined,
    search ? or(
      ilike(users.nombre, search),
      ilike(users.email, search),
      ilike(professionalProfiles.oficio, search),
      ilike(sql<string>`${professionalProfiles.categoria}::text`, search),
    ) : undefined,
  );
  const [countRows, rows] = await Promise.all([
    db.select({ total: count() }).from(professionalProfiles)
      .innerJoin(users, eq(users.id, professionalProfiles.usuarioId)).where(condition),
    db.select({
      profile: professionalProfiles,
      userId: users.id,
      name: users.nombre,
      email: users.email,
      phone: users.telefono,
      accountActive: users.activo,
    }).from(professionalProfiles)
      .innerJoin(users, eq(users.id, professionalProfiles.usuarioId))
      .where(condition)
      .orderBy(desc(professionalProfiles.estadoVerificacion), desc(professionalProfiles.createdAt))
      .limit(limit)
      .offset(offset),
  ]);
  const ids = rows.map((row) => row.userId);
  const documents = ids.length
    ? await db.select({
      id: professionalVerificationDocuments.id,
      profesionalId: professionalVerificationDocuments.profesionalId,
      type: professionalVerificationDocuments.tipo,
      status: professionalVerificationDocuments.estado,
      name: professionalVerificationDocuments.nombre,
      sizeBytes: professionalVerificationDocuments.sizeBytes,
      createdAt: professionalVerificationDocuments.createdAt,
    }).from(professionalVerificationDocuments)
      .where(inArray(professionalVerificationDocuments.profesionalId, ids))
    : [];
  const documentsByPartner = new Map<number, typeof documents>();
  for (const document of documents) {
    const partnerDocuments = documentsByPartner.get(document.profesionalId) ?? [];
    partnerDocuments.push(document);
    documentsByPartner.set(document.profesionalId, partnerDocuments);
  }
  const items = rows.map(({ profile, accountActive, ...user }) => ({
    ...user,
    trade: profile.oficio,
    category: profile.categoria,
    verificationStatus: profile.estadoVerificacion,
    verified: profile.verificado,
    enabled: profile.habilitado,
    accountActive,
    available: profile.disponible,
    experienceYears: profile.experienciaAnios,
    referencePrice: Number(profile.precioReferencia),
    rating: Number(profile.rating),
    createdAt: profile.createdAt,
    documents: (documentsByPartner.get(user.userId) ?? []).map(({ profesionalId: _professionalId, ...document }) => document),
  }));
  return res.json(pageResponse(items, Number(countRows[0]?.total ?? 0), page, limit));
});

router.get("/partner-applications", async (req, res) => {
  const { page, limit, offset } = paging(req);
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
  const where = and(eq(professionalProfiles.habilitado, false), search
    ? or(ilike(users.nombre, `%${search}%`), ilike(users.email, `%${search}%`), ilike(professionalProfiles.oficio, `%${search}%`))
    : undefined);
  const [total] = await db.select({ value: count() }).from(professionalProfiles)
    .innerJoin(users, eq(users.id, professionalProfiles.usuarioId)).where(where);
  const rows = await db.select({
    profile: professionalProfiles, id: users.id, name: users.nombre, email: users.email, emailVerifiedAt: users.emailVerifiedAt,
  }).from(professionalProfiles).innerJoin(users, eq(users.id, professionalProfiles.usuarioId))
    .where(where).orderBy(desc(professionalProfiles.updatedAt), desc(professionalProfiles.id)).limit(limit).offset(offset);
  const items = await Promise.all(rows.map(async (row) => {
    const documents = await db.select().from(professionalVerificationDocuments)
      .where(eq(professionalVerificationDocuments.profesionalId, row.id))
      .orderBy(asc(professionalVerificationDocuments.tipo));
    return {
      partner: await partnerRecord(row.id),
      emailVerifiedAt: row.emailVerifiedAt,
      matriculaHabilitante: row.profile.matriculaHabilitante,
      documents: documents.map((doc) => ({
        ...doc,
        partner: { id: row.id, nombre: row.name, email: row.email },
        perfil: { oficio: row.profile.oficio, categoria: row.profile.categoria, estadoVerificacion: row.profile.estadoVerificacion },
      })),
    };
  }));
  return res.json({ items, total: Number(total.value), page, limit });
});

router.patch("/partners/:id/activation", async (req, res) => {
  const id = Number(req.params.id);
  const enabled = req.body?.enabled;
  const reason = reasonOf(req.body?.reason);
  if (!Number.isInteger(id) || id < 1 || typeof enabled !== "boolean" || reason.length < 5) {
    return res.status(400).json({ error: "Indicá el estado del Partner y un motivo de al menos 5 caracteres." });
  }
  const [current] = await db.select({
    profile: professionalProfiles,
    accountActive: users.activo,
    emailVerifiedAt: users.emailVerifiedAt,
  }).from(professionalProfiles)
    .innerJoin(users, eq(users.id, professionalProfiles.usuarioId))
    .where(eq(professionalProfiles.usuarioId, id))
    .limit(1);
  if (!current) return res.status(404).json({ error: "No encontramos ese Partner." });
  if (enabled) {
    const docs = await db.select({ tipo: professionalVerificationDocuments.tipo, estado: professionalVerificationDocuments.estado })
      .from(professionalVerificationDocuments)
      .where(eq(professionalVerificationDocuments.profesionalId, id));
    const allDocumentsApproved = partnerVerificationStatus(docs) === "verified";
    if (!current.profile.verificado || current.profile.estadoVerificacion !== "verified" || !allDocumentsApproved || !current.accountActive || !current.emailVerifiedAt) {
      return res.status(409).json({ error: "Para habilitar al Partner, la cuenta debe estar activa, el email verificado, los tres documentos obligatorios aprobados y también la matrícula si fue adjuntada." });
    }
  }
  if (current.profile.habilitado !== enabled) {
    await db.update(professionalProfiles).set({ habilitado: enabled, updatedAt: new Date() })
      .where(eq(professionalProfiles.usuarioId, id));
    await db.update(users).set({
      onboardingEstado: enabled ? "onboarding_completed" : "professional_verification_pending",
      updatedAt: new Date(),
    }).where(eq(users.id, id));
    await db.insert(workyAuditEvents).values({
      usuarioId: req.usuarioId!,
      entidad: "professional_profile",
      entidadId: id,
      accion: enabled ? "enabled" : "suspended",
      estadoAnterior: String(current.profile.habilitado),
      estadoNuevo: String(enabled),
      metadata: { motivo: reason },
    });
  }
  const updated = await partnerRecord(id);
  return res.json(updated);
});

router.get("/jobs", async (req, res) => {
  const status = queryEnum(req, "status", jobStates);
  if (status === null) return res.status(400).json({ error: "El estado de trabajo no es válido." });
  const { page, limit, offset } = paging(req);
  const search = searchPattern(searchText(req));
  const condition = and(
    status ? eq(jobs.estado, status) : undefined,
    search ? or(
      ilike(jobs.detalle, search),
      ilike(adminClient.nombre, search),
      ilike(adminPartner.nombre, search),
      ilike(sql<string>`${jobs.id}::text`, search),
    ) : undefined,
  );
  const [countRows, rows] = await Promise.all([
    db.select({ total: count() }).from(jobs)
      .innerJoin(adminClient, eq(adminClient.id, jobs.clienteId))
      .leftJoin(adminPartner, eq(adminPartner.id, jobs.profesionalId)).where(condition),
    db.select({
      id: jobs.id,
      category: jobs.categoria,
      status: jobs.estado,
      clientId: jobs.clienteId,
      clientName: adminClient.nombre,
      partnerId: jobs.profesionalId,
      partnerName: adminPartner.nombre,
      detail: jobs.detalle,
      offeredPrice: jobs.precioOfrecido,
      createdAt: jobs.createdAt,
    }).from(jobs)
      .innerJoin(adminClient, eq(adminClient.id, jobs.clienteId))
      .leftJoin(adminPartner, eq(adminPartner.id, jobs.profesionalId))
      .where(condition)
      .orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(limit)
      .offset(offset),
  ]);
  return res.json(pageResponse(rows.map((row) => ({ ...row, offeredPrice: Number(row.offeredPrice) })), Number(countRows[0]?.total ?? 0), page, limit));
});

router.get("/bookings", async (req, res) => {
  const status = queryEnum(req, "status", bookingStates);
  if (status === null) return res.status(400).json({ error: "El estado de la reserva no es válido." });
  const { page, limit, offset } = paging(req);
  const search = searchPattern(searchText(req));
  const condition = and(
    status ? eq(bookings.estado, status) : undefined,
    search ? or(
      ilike(adminClient.nombre, search),
      ilike(adminPartner.nombre, search),
      ilike(sql<string>`${bookings.changaId}::text`, search),
    ) : undefined,
  );
  const [countRows, rows] = await Promise.all([
    db.select({ total: count() }).from(bookings)
      .innerJoin(adminClient, eq(adminClient.id, bookings.clienteId))
      .innerJoin(adminPartner, eq(adminPartner.id, bookings.profesionalId)).where(condition),
    db.select({
      id: bookings.id,
      jobId: bookings.changaId,
      clientId: bookings.clienteId,
      clientName: adminClient.nombre,
      partnerId: bookings.profesionalId,
      partnerName: adminPartner.nombre,
      startsAt: bookings.empiezaAt,
      endsAt: bookings.terminaAt,
      status: bookings.estado,
      createdAt: bookings.createdAt,
    }).from(bookings)
      .innerJoin(adminClient, eq(adminClient.id, bookings.clienteId))
      .innerJoin(adminPartner, eq(adminPartner.id, bookings.profesionalId))
      .where(condition)
      .orderBy(desc(bookings.createdAt), desc(bookings.id))
      .limit(limit)
      .offset(offset),
  ]);
  return res.json(pageResponse(rows, Number(countRows[0]?.total ?? 0), page, limit));
});

router.get("/payments", async (req, res) => {
  const status = queryEnum(req, "status", paymentStates);
  if (status === null) return res.status(400).json({ error: "El estado del pago no es válido." });
  const { page, limit, offset } = paging(req);
  const search = searchPattern(searchText(req));
  const condition = and(
    status ? eq(payments.status, status) : undefined,
    search ? or(
      ilike(adminClient.nombre, search),
      ilike(adminClient.email, search),
      ilike(sql<string>`${payments.changaId}::text`, search),
    ) : undefined,
  );
  const [countRows, rows] = await Promise.all([
    db.select({ total: count() }).from(payments)
      .innerJoin(adminClient, eq(adminClient.id, payments.clienteId)).where(condition),
    db.select({
      id: payments.id,
      jobId: payments.changaId,
      clientId: payments.clienteId,
      clientName: adminClient.nombre,
      amount: payments.amount,
      currency: payments.currency,
      status: payments.status,
      provider: payments.provider,
      createdAt: payments.createdAt,
      updatedAt: payments.updatedAt,
    }).from(payments)
      .innerJoin(adminClient, eq(adminClient.id, payments.clienteId))
      .where(condition)
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit(limit)
      .offset(offset),
  ]);
  return res.json(pageResponse(rows.map((row) => ({ ...row, amount: Number(row.amount) })), Number(countRows[0]?.total ?? 0), page, limit));
});

router.get("/settlements", async (req, res) => {
  const status = queryEnum(req, "status", settlementStates);
  if (status === null) return res.status(400).json({ error: "El estado de la liquidación no es válido." });
  const { page, limit, offset } = paging(req);
  const search = searchPattern(searchText(req));
  const condition = and(
    status ? eq(settlements.status, status) : undefined,
    search ? or(
      ilike(adminPartner.nombre, search),
      ilike(adminPartner.email, search),
      ilike(sql<string>`${settlements.changaId}::text`, search),
    ) : undefined,
  );
  const [countRows, rows] = await Promise.all([
    db.select({ total: count() }).from(settlements)
      .innerJoin(adminPartner, eq(adminPartner.id, settlements.profesionalId)).where(condition),
    db.select({
      id: settlements.id,
      jobId: settlements.changaId,
      partnerId: settlements.profesionalId,
      partnerName: adminPartner.nombre,
      amount: settlements.amount,
      status: settlements.status,
      createdAt: settlements.createdAt,
      updatedAt: settlements.updatedAt,
    }).from(settlements)
      .innerJoin(adminPartner, eq(adminPartner.id, settlements.profesionalId))
      .where(condition)
      .orderBy(desc(settlements.createdAt), desc(settlements.id))
      .limit(limit)
      .offset(offset),
  ]);
  return res.json(pageResponse(rows.map((row) => ({ ...row, amount: Number(row.amount) })), Number(countRows[0]?.total ?? 0), page, limit));
});

router.get("/visits", async (req, res) => {
  const status = String(req.query.status ?? "");
  const allowed = ["checkout_started", "pending_release", "available", "cash_pending_visit", "cash_commission_due", "cash_commission_settled", "under_review", "payment_failed", "refunded"];
  if (status && !allowed.includes(status)) return res.status(400).json({ error: "El estado del pago de visita no es válido." });
  const { page, limit, offset } = paging(req);
  const condition = and(
    status ? eq(visitPayments.status, status as typeof visitPayments.$inferSelect.status) : undefined,
  );
  const [countRows, rows] = await Promise.all([
    db.select({ total: count() }).from(visitPayments)
      .innerJoin(adminClient, eq(adminClient.id, visitPayments.clienteId))
      .innerJoin(adminPartner, eq(adminPartner.id, visitPayments.profesionalId))
      .where(condition),
    db.select({
      id: visitPayments.id,
      bookingId: visitPayments.bookingId,
      clientId: visitPayments.clienteId,
      clientName: adminClient.nombre,
      partnerId: visitPayments.profesionalId,
      partnerName: adminPartner.nombre,
      amount: visitPayments.amount,
      commissionAmount: visitPayments.commissionAmount,
      partnerAmount: visitPayments.partnerAmount,
      method: visitPayments.method,
      status: visitPayments.status,
      issueType: visitPayments.issueType,
      issueDetail: visitPayments.issueDetail,
      completedAt: visitPayments.completedAt,
      releaseAt: visitPayments.releaseAt,
      createdAt: visitPayments.createdAt,
      updatedAt: visitPayments.updatedAt,
    }).from(visitPayments)
      .innerJoin(adminClient, eq(adminClient.id, visitPayments.clienteId))
      .innerJoin(adminPartner, eq(adminPartner.id, visitPayments.profesionalId))
      .where(condition)
      .orderBy(desc(visitPayments.createdAt), desc(visitPayments.id))
      .limit(limit)
      .offset(offset),
  ]);
  return res.json(pageResponse(rows.map((row) => ({
    ...row,
    amount: Number(row.amount),
    commissionAmount: Number(row.commissionAmount),
    partnerAmount: Number(row.partnerAmount),
  })), Number(countRows[0]?.total ?? 0), page, limit));
});

router.post("/visits/:id/resolver", async (req, res) => {
  const id = Number(req.params.id);
  const detail = reasonOf(req.body?.detail);
  if (!Number.isInteger(id) || id < 1 || detail.length < 5) return res.status(400).json({ error: "Indicá un pago de visita y una resolución de al menos 5 caracteres." });
  const result = await db.transaction(async (tx) => {
    const [owner] = await tx.select({ profesionalId: visitPayments.profesionalId }).from(visitPayments)
      .where(eq(visitPayments.id, id)).limit(1);
    if (!owner) return { kind: "missing" as const };
    await tx.select({ id: users.id }).from(users).where(eq(users.id, owner.profesionalId)).for("update").limit(1);
    const [current] = await tx.select().from(visitPayments).where(eq(visitPayments.id, id)).for("update").limit(1);
    if (!current) return { kind: "missing" as const };
    if (current.status !== "under_review") return { kind: "conflict" as const };
    if (current.method === "mercado_pago" && !current.completedAt) return { kind: "not-completed" as const };
    const [booking] = await tx.select({ changaId: bookings.changaId }).from(bookings)
      .where(eq(bookings.id, current.bookingId)).limit(1);
    if (!booking) return { kind: "missing" as const };
    const status = current.method === "mercado_pago"
      ? "available" as const
      : current.completedAt
        ? Number(current.commissionAmount) > 0 ? "cash_commission_due" as const : "cash_commission_settled" as const
        : "cash_pending_visit" as const;
    const now = new Date();
    const [updated] = await tx.update(visitPayments).set({
      status,
      resolutionAt: now,
      resolutionBy: req.usuarioId!,
      resolutionDetail: detail,
      updatedAt: now,
    }).where(eq(visitPayments.id, current.id)).returning();
    await tx.insert(workyAuditEvents).values({
      usuarioId: req.usuarioId!, entidad: "visit_payment", entidadId: current.id,
      accion: "admin_released_after_review", estadoAnterior: current.status, estadoNuevo: status,
      metadata: { bookingId: current.bookingId, detail },
    });
    await settleAvailablePartnerCommissions(tx, current.profesionalId, now);
    const [settledPayment] = await tx.select().from(visitPayments).where(eq(visitPayments.id, current.id)).limit(1);
    return { kind: "resolved" as const, payment: settledPayment ?? updated, partnerId: current.profesionalId, clientId: current.clienteId, changaId: booking.changaId };
  });
  if (result.kind === "missing") return res.status(404).json({ error: "Pago de visita no encontrado." });
  if (result.kind === "conflict") return res.status(409).json({ error: "Este pago no está retenido por una revisión." });
  if (result.kind === "not-completed") return res.status(409).json({ error: "La visita no está marcada como realizada. No liberes el saldo: gestioná primero la devolución del pago en Mercado Pago." });
  const [client] = await db.select({ name: users.nombre }).from(users).where(eq(users.id, result.payment.clienteId)).limit(1);
  const [partner] = await db.select({ name: users.nombre }).from(users).where(eq(users.id, result.payment.profesionalId)).limit(1);
  await db.insert(workyNotifications).values([
    { usuarioId: result.partnerId, tipo: "actividad", titulo: "Revisión de visita resuelta", detalle: "La revisión administrativa fue cerrada y el saldo correspondiente quedó actualizado.", href: "/partner" },
    { usuarioId: result.clientId, changaId: result.changaId, tipo: "actividad", titulo: "Revisión de visita resuelta", detalle: "Worky terminó de revisar el reporte de la visita.", href: `/chat/${result.changaId}` },
  ]);
  return res.json({
    id: result.payment.id,
    bookingId: result.payment.bookingId,
    clientId: result.payment.clienteId,
    clientName: client?.name ?? "Cliente",
    partnerId: result.payment.profesionalId,
    partnerName: partner?.name ?? "Partner",
    amount: Number(result.payment.amount),
    commissionAmount: Number(result.payment.commissionAmount),
    partnerAmount: Number(result.payment.partnerAmount),
    method: result.payment.method,
    status: result.payment.status,
    issueType: result.payment.issueType,
    issueDetail: result.payment.issueDetail,
    completedAt: result.payment.completedAt,
    releaseAt: result.payment.releaseAt,
    createdAt: result.payment.createdAt,
    updatedAt: result.payment.updatedAt,
  });
});

router.get("/reviews", async (req, res) => {
  const { page, limit, offset } = paging(req);
  const search = searchPattern(searchText(req));
  const condition = search ? or(
    ilike(adminClient.nombre, search),
    ilike(adminPartner.nombre, search),
    ilike(reviews.comentario, search),
    ilike(sql<string>`${reviews.changaId}::text`, search),
  ) : undefined;
  const [countRows, rows] = await Promise.all([
    db.select({ total: count() }).from(reviews)
      .innerJoin(adminClient, eq(adminClient.id, reviews.clienteId))
      .innerJoin(adminPartner, eq(adminPartner.id, reviews.profesionalId)).where(condition),
    db.select({
      id: reviews.id,
      jobId: reviews.changaId,
      clientId: reviews.clienteId,
      clientName: adminClient.nombre,
      partnerId: reviews.profesionalId,
      partnerName: adminPartner.nombre,
      rating: reviews.rating,
      comment: reviews.comentario,
      createdAt: reviews.createdAt,
    }).from(reviews)
      .innerJoin(adminClient, eq(adminClient.id, reviews.clienteId))
      .innerJoin(adminPartner, eq(adminPartner.id, reviews.profesionalId))
      .where(condition)
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(limit)
      .offset(offset),
  ]);
  return res.json(pageResponse(rows, Number(countRows[0]?.total ?? 0), page, limit));
});

router.get("/recommendations", async (req, res) => {
  const visibility = queryEnum(req, "visibility", visibilityStates);
  if (visibility === null) return res.status(400).json({ error: "La visibilidad no es válida." });
  const { page, limit, offset } = paging(req);
  const search = searchPattern(searchText(req));
  const condition = and(
    visibility ? eq(recommendations.visibilidad, visibility) : undefined,
    search ? or(
      ilike(adminClient.nombre, search),
      ilike(adminPartner.nombre, search),
      ilike(recommendations.comentario, search),
    ) : undefined,
  );
  const [countRows, rows] = await Promise.all([
    db.select({ total: count() }).from(recommendations)
      .innerJoin(adminClient, eq(adminClient.id, recommendations.clienteId))
      .innerJoin(adminPartner, eq(adminPartner.id, recommendations.profesionalId)).where(condition),
    db.select({
      id: recommendations.id,
      clientId: recommendations.clienteId,
      clientName: adminClient.nombre,
      partnerId: recommendations.profesionalId,
      partnerName: adminPartner.nombre,
      visibility: recommendations.visibilidad,
      comment: recommendations.comentario,
      createdAt: recommendations.createdAt,
      updatedAt: recommendations.updatedAt,
    }).from(recommendations)
      .innerJoin(adminClient, eq(adminClient.id, recommendations.clienteId))
      .innerJoin(adminPartner, eq(adminPartner.id, recommendations.profesionalId))
      .where(condition)
      .orderBy(desc(recommendations.createdAt), desc(recommendations.id))
      .limit(limit)
      .offset(offset),
  ]);
  return res.json(pageResponse(rows, Number(countRows[0]?.total ?? 0), page, limit));
});

router.patch("/recommendations/:id/visibility", async (req, res) => {
  const id = Number(req.params.id);
  const visibility = req.body?.visibility;
  const reason = reasonOf(req.body?.reason);
  if (!Number.isInteger(id) || id < 1 || typeof visibility !== "string" || !visibilityStates.includes(visibility as typeof visibilityStates[number]) || reason.length < 5) {
    return res.status(400).json({ error: "Indicá una visibilidad válida y un motivo de al menos 5 caracteres." });
  }
  const nextVisibility = visibility as typeof visibilityStates[number];
  const [current] = await db.select().from(recommendations).where(eq(recommendations.id, id)).limit(1);
  if (!current) return res.status(404).json({ error: "No encontramos esa recomendación." });
  if (current.visibilidad !== nextVisibility) {
    const [updated] = await db.update(recommendations).set({ visibilidad: nextVisibility, updatedAt: new Date() })
      .where(eq(recommendations.id, id)).returning();
    await db.insert(workyAuditEvents).values({
      usuarioId: req.usuarioId!,
      entidad: "recommendation",
      entidadId: id,
      accion: "visibility_changed",
      estadoAnterior: current.visibilidad,
      estadoNuevo: nextVisibility,
      metadata: { motivo: reason },
    });
    const [client] = await db.select({ name: users.nombre }).from(users).where(eq(users.id, updated.clienteId)).limit(1);
    const [partner] = await db.select({ name: users.nombre }).from(users).where(eq(users.id, updated.profesionalId)).limit(1);
    return res.json({
      id: updated.id,
      clientId: updated.clienteId,
      clientName: client?.name ?? "",
      partnerId: updated.profesionalId,
      partnerName: partner?.name ?? "",
      visibility: updated.visibilidad,
      comment: updated.comentario,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  }
  const [client] = await db.select({ name: users.nombre }).from(users).where(eq(users.id, current.clienteId)).limit(1);
  const [partner] = await db.select({ name: users.nombre }).from(users).where(eq(users.id, current.profesionalId)).limit(1);
  return res.json({
    id: current.id,
    clientId: current.clienteId,
    clientName: client?.name ?? "",
    partnerId: current.profesionalId,
    partnerName: partner?.name ?? "",
    visibility: current.visibilidad,
    comment: current.comentario,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  });
});

router.get("/ranking", async (_req, res) => {
  const active = await isPaidJobRecommendationRankingActive();
  if (!active) {
    return res.json({
      active: false,
      windowDays: RECOMMENDATION_RISK_WINDOW_DAYS,
      incidentThreshold: RECOMMENDATION_RISK_REVIEW_THRESHOLD,
      candidates: [],
      incidents: [],
    });
  }

  const cutoff = new Date(Date.now() - RECOMMENDATION_RISK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const acceptedVisit = alias(workyAuditEvents, "ranking_accepted_visit");
  const previousDecision = alias(workyAuditEvents, "ranking_previous_decision");
  const candidates = await db.select({
    jobId: jobs.id,
    partnerId: jobs.profesionalId,
    partnerName: adminPartner.nombre,
    clientId: jobs.clienteId,
    clientName: adminClient.nombre,
    category: jobs.categoria,
    updatedAt: jobs.updatedAt,
    messageCount: sql<number>`(select count(*)::int from worky_messages signal_message where signal_message.changa_id = ${jobs.id})`,
    acceptedVisitCount: sql<number>`(
      select count(*)::int from worky_audit_events signal_visit
      where signal_visit.entidad = 'appointment_attempt'
        and signal_visit.entidad_id = ${jobs.id}
        and signal_visit.accion = 'aceptar'
        and signal_visit.estado_nuevo = 'exitoso'
        and signal_visit.created_at >= ${cutoff}
    )`,
  }).from(jobs)
    .innerJoin(adminClient, eq(adminClient.id, jobs.clienteId))
    .innerJoin(adminPartner, eq(adminPartner.id, jobs.profesionalId))
    .where(and(
      eq(jobs.estado, "cancelada"),
      gte(jobs.updatedAt, cutoff),
      exists(db.select({ id: messages.id }).from(messages).where(eq(messages.changaId, jobs.id))),
      exists(db.select({ id: acceptedVisit.id }).from(acceptedVisit).where(and(
        eq(acceptedVisit.entidad, "appointment_attempt"),
        eq(acceptedVisit.entidadId, jobs.id),
        eq(acceptedVisit.accion, "aceptar"),
        eq(acceptedVisit.estadoNuevo, "exitoso"),
        gte(acceptedVisit.createdAt, cutoff),
      ))),
      notExists(db.select({ id: previousDecision.id }).from(previousDecision).where(and(
        eq(previousDecision.entidad, "job"),
        eq(previousDecision.entidadId, jobs.id),
        inArray(previousDecision.accion, [...RECOMMENDATION_RISK_DECISION_ACTIONS]),
      ))),
      notExists(db.select({ id: payments.id }).from(payments).where(and(
        eq(payments.changaId, jobs.id),
        inArray(payments.status, ["aprobado", "reembolsado"]),
      ))),
    ))
    .orderBy(desc(jobs.updatedAt), desc(jobs.id))
    .limit(100);

  const decisionEvent = alias(workyAuditEvents, "ranking_decision_event");
  const laterDecision = alias(workyAuditEvents, "ranking_later_decision");
  const incidents = await db.select({
    jobId: jobs.id,
    partnerId: jobs.profesionalId,
    partnerName: adminPartner.nombre,
    clientName: adminClient.nombre,
    category: jobs.categoria,
    decision: decisionEvent.accion,
    reason: sql<string>`${decisionEvent.metadata}->>'reason'`,
    reviewedAt: decisionEvent.createdAt,
  }).from(decisionEvent)
    .innerJoin(jobs, eq(jobs.id, decisionEvent.entidadId))
    .innerJoin(adminClient, eq(adminClient.id, jobs.clienteId))
    .innerJoin(adminPartner, eq(adminPartner.id, jobs.profesionalId))
    .where(and(
      eq(decisionEvent.entidad, "job"),
      inArray(decisionEvent.accion, [...RECOMMENDATION_RISK_DECISION_ACTIONS]),
      gte(decisionEvent.createdAt, cutoff),
      notExists(db.select({ id: laterDecision.id }).from(laterDecision).where(and(
        eq(laterDecision.entidad, "job"),
        eq(laterDecision.entidadId, decisionEvent.entidadId),
        inArray(laterDecision.accion, [...RECOMMENDATION_RISK_DECISION_ACTIONS]),
        or(
          gt(laterDecision.createdAt, decisionEvent.createdAt),
          and(eq(laterDecision.createdAt, decisionEvent.createdAt), gt(laterDecision.id, decisionEvent.id)),
        ),
      ))),
    ))
    .orderBy(desc(decisionEvent.createdAt), desc(decisionEvent.id))
    .limit(100);

  const [activationPayment] = await db.select({
    createdAt: payments.createdAt,
    provider: payments.provider,
  }).from(payments)
    .innerJoin(jobs, eq(jobs.id, payments.changaId))
    .where(and(
      eq(payments.status, "aprobado"),
      inArray(payments.provider, ["mercado_pago", "efectivo"]),
      eq(jobs.estado, "finalizada"),
    ))
    .orderBy(asc(payments.createdAt), asc(payments.id))
    .limit(1);

  return res.json({
    active: true,
    windowDays: RECOMMENDATION_RISK_WINDOW_DAYS,
    incidentThreshold: RECOMMENDATION_RISK_REVIEW_THRESHOLD,
    activatedAt: activationPayment?.createdAt ?? null,
    activationProvider: activationPayment?.provider ?? null,
    candidates,
    incidents: incidents.map((incident) => ({
      ...incident,
      decision: incident.decision === "recommendation_incident_confirmed" ? "confirmed" : "dismissed",
    })),
  });
});

router.post("/ranking/incidents/:jobId", async (req, res) => {
  if (!(await isPaidJobRecommendationRankingActive())) {
    return res.status(409).json({ error: "La revisión de señales se habilita después de un pago real confirmado en producción." });
  }
  const jobId = Number(req.params.jobId);
  const decision = req.body?.decision;
  const reason = reasonOf(req.body?.reason);
  if (!Number.isInteger(jobId) || jobId < 1 || (decision !== "confirmed" && decision !== "dismissed") || reason.length < 5) {
    return res.status(400).json({ error: "Indicá una decisión válida y un motivo de al menos 5 caracteres." });
  }

  const cutoff = new Date(Date.now() - RECOMMENDATION_RISK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const outcome = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update").limit(1);
    if (!job) return { kind: "missing" as const };
    if (!job.profesionalId) return { kind: "not-reviewable" as const };

    const [currentDecision] = await tx.select().from(workyAuditEvents).where(and(
      eq(workyAuditEvents.entidad, "job"),
      eq(workyAuditEvents.entidadId, job.id),
      inArray(workyAuditEvents.accion, [...RECOMMENDATION_RISK_DECISION_ACTIONS]),
    )).orderBy(desc(workyAuditEvents.createdAt), desc(workyAuditEvents.id)).limit(1);
    const action = decision === "confirmed" ? "recommendation_incident_confirmed" : "recommendation_incident_dismissed";
    if (currentDecision?.accion === action) return { kind: "unchanged" as const, decision };
    const isReversingConfirmation = decision === "dismissed" && currentDecision?.accion === "recommendation_incident_confirmed";

    let messageCount = 0;
    let acceptedVisitCount = 0;
    if (!isReversingConfirmation) {
      if (job.updatedAt < cutoff || job.estado !== "cancelada") return { kind: "not-reviewable" as const };
      const [messageTotal] = await tx.select({ total: count() }).from(messages).where(eq(messages.changaId, job.id));
      const [visitTotal] = await tx.select({ total: count() }).from(workyAuditEvents).where(and(
        eq(workyAuditEvents.entidad, "appointment_attempt"),
        eq(workyAuditEvents.entidadId, job.id),
        eq(workyAuditEvents.accion, "aceptar"),
        eq(workyAuditEvents.estadoNuevo, "exitoso"),
        gte(workyAuditEvents.createdAt, cutoff),
      ));
      const [paid] = await tx.select({ id: payments.id }).from(payments).where(and(
        eq(payments.changaId, job.id),
        inArray(payments.status, ["aprobado", "reembolsado"]),
      )).limit(1);
      messageCount = Number(messageTotal?.total ?? 0);
      acceptedVisitCount = Number(visitTotal?.total ?? 0);
      if (paid || !isReviewableActivitySignal({
        jobStatus: job.estado,
        messageCount,
        acceptedVisitCount,
      })) return { kind: "not-reviewable" as const };
    }

    await tx.insert(workyAuditEvents).values({
      usuarioId: req.usuarioId!,
      entidad: "job",
      entidadId: job.id,
      accion: action,
      estadoAnterior: currentDecision?.accion ?? null,
      estadoNuevo: decision,
      metadata: {
        reason,
        ...(isReversingConfirmation
          ? { reversesDecisionEventId: currentDecision.id }
          : { evidence: { messageCount, acceptedVisitCount } }),
        reviewWindowDays: RECOMMENDATION_RISK_WINDOW_DAYS,
      },
    });
    return { kind: "updated" as const, decision, partnerId: job.profesionalId };
  });

  if (outcome.kind === "missing") return res.status(404).json({ error: "No encontramos ese trabajo." });
  if (outcome.kind === "not-reviewable") return res.status(409).json({ error: "La señal ya no cumple los criterios de revisión; no se cambió la visibilidad." });
  return res.json({ jobId, decision: outcome.decision, unchanged: outcome.kind === "unchanged" });
});

router.get("/catalog", async (_req, res) => {
  const rows = await db.select().from(serviceCatalog).orderBy(asc(serviceCatalog.categoria), asc(serviceCatalog.especialidad));
  return res.json(rows.map((row) => ({
    id: row.id,
    category: row.categoria,
    specialty: row.especialidad,
    active: row.activa,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })));
});

router.post("/catalog", async (req, res) => {
  const category = typeof req.body?.category === "string" ? req.body.category.trim() : "";
  const specialty = typeof req.body?.specialty === "string" ? req.body.specialty.trim() : "";
  if (!categories.includes(category as typeof categories[number]) || !specialty || specialty.length > 120) {
    return res.status(400).json({ error: "Elegí una categoría válida e indicá una especialidad de hasta 120 caracteres." });
  }
  try {
    const [created] = await db.insert(serviceCatalog).values({ categoria: category, especialidad: specialty, activa: true }).returning();
    await db.insert(workyAuditEvents).values({
      usuarioId: req.usuarioId!,
      entidad: "catalog_item",
      entidadId: created.id,
      accion: "created",
      estadoNuevo: "active",
      metadata: { categoria: category, especialidad: specialty },
    });
    return res.status(201).json({
      id: created.id,
      category: created.categoria,
      specialty: created.especialidad,
      active: created.activa,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") return res.status(409).json({ error: "Esa especialidad ya existe para la categoría." });
    throw error;
  }
});

router.patch("/catalog/:id", async (req, res) => {
  const id = Number(req.params.id);
  const category = req.body?.category;
  const specialty = req.body?.specialty;
  const active = req.body?.active;
  if (!Number.isInteger(id) || id < 1
    || (category === undefined && specialty === undefined && active === undefined)
    || (category !== undefined && (typeof category !== "string" || !categories.includes(category.trim() as typeof categories[number])))
    || (specialty !== undefined && (typeof specialty !== "string" || !specialty.trim() || specialty.trim().length > 120))
    || (active !== undefined && typeof active !== "boolean")) {
    return res.status(400).json({ error: "Los datos del catálogo no son válidos." });
  }
  const [current] = await db.select().from(serviceCatalog).where(eq(serviceCatalog.id, id)).limit(1);
  if (!current) return res.status(404).json({ error: "No encontramos esa especialidad." });
  const values = {
    categoria: category === undefined ? current.categoria : (category as string).trim(),
    especialidad: specialty === undefined ? current.especialidad : (specialty as string).trim(),
    activa: active === undefined ? current.activa : active as boolean,
    updatedAt: new Date(),
  };
  try {
    const [updated] = await db.update(serviceCatalog).set(values).where(eq(serviceCatalog.id, id)).returning();
    await db.insert(workyAuditEvents).values({
      usuarioId: req.usuarioId!,
      entidad: "catalog_item",
      entidadId: id,
      accion: "updated",
      estadoAnterior: current.activa ? "active" : "inactive",
      estadoNuevo: updated.activa ? "active" : "inactive",
      metadata: { motivo: "Actualización administrativa", categoria: updated.categoria, especialidad: updated.especialidad },
    });
    return res.json({
      id: updated.id,
      category: updated.categoria,
      specialty: updated.especialidad,
      active: updated.activa,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") return res.status(409).json({ error: "Esa especialidad ya existe para la categoría." });
    throw error;
  }
});

router.get("/resources", async (req, res) => {
  const { page, limit, offset } = paging(req);
  const search = searchText(req).toLowerCase();
  const [assets, photos] = await Promise.all([
    db.select({
      id: professionalAssets.id,
      ownerId: users.id,
      ownerName: users.nombre,
      kind: sql<"portfolio">`'portfolio'`,
      name: professionalAssets.nombre,
      contentType: professionalAssets.contentType,
      sizeBytes: professionalAssets.sizeBytes,
      createdAt: professionalAssets.createdAt,
    }).from(professionalAssets).innerJoin(users, eq(users.id, professionalAssets.profesionalId)),
    db.select({
      id: profilePhotoUploads.id,
      ownerId: users.id,
      ownerName: users.nombre,
      kind: sql<"profile_photo">`'profile_photo'`,
      name: sql<string>`'Foto de perfil'`,
      contentType: sql<string>`'image/*'`,
      sizeBytes: sql<null>`null`,
      createdAt: profilePhotoUploads.associatedAt,
    }).from(profilePhotoUploads)
      .innerJoin(users, and(
        eq(users.id, profilePhotoUploads.usuarioId),
        eq(users.fotoObjectPath, profilePhotoUploads.objectPath),
      ))
      .where(and(eq(profilePhotoUploads.estado, "associated"), isNotNull(profilePhotoUploads.associatedAt))),
  ]);
  const filtered = [...assets, ...photos]
    .filter((item) => !search || `${item.ownerName} ${item.name} ${item.contentType}`.toLowerCase().includes(search))
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  return res.json(pageResponse(filtered.slice(offset, offset + limit), filtered.length, page, limit));
});

router.get("/activity", async (req, res) => {
  const { page, limit } = paging(req);
  const entity = String(req.query.entity ?? "").trim().slice(0, 80);
  return res.json(await auditPage(page, limit, entity || undefined));
});

export default router;
