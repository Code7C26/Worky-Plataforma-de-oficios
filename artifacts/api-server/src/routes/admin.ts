import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, asc, desc, eq, ilike, inArray, isNotNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { bookings, db, jobs, professionalAssets, professionalProfiles, recommendations, reviews, serviceCatalog, users, payments, workyAuditEvents } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const jobClient = alias(users, "admin_job_client");
const jobPartner = alias(users, "admin_job_partner");
const bookingClient = alias(users, "admin_booking_client");
const bookingPartner = alias(users, "admin_booking_partner");
const paymentClient = alias(users, "admin_payment_client");
const reviewClient = alias(users, "admin_review_client");
const reviewPartner = alias(users, "admin_review_partner");
const recommendationClient = alias(users, "admin_recommendation_client");
const recommendationPartner = alias(users, "admin_recommendation_partner");
const resourcePartner = alias(users, "admin_resource_partner");
const auditActor = alias(users, "admin_audit_actor");
const validCategories = ["Plomería", "Electricidad", "Gas", "Albañilería", "Otro"] as const;
const activeBookingStates = ["solicitada", "confirmada", "en_curso"] as const;
const terminalJobStates = ["finalizada", "cancelada"] as const;
const terminalBookingStates = ["completada", "cancelada"] as const;
const adminId = (req: Request) => req.usuarioId as number;

router.use(requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const [actor] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, adminId(req)), eq(users.activo, true), eq(users.rol, "admin"))).limit(1);
  if (!actor) return res.status(403).json({ error: "Solo una persona administradora puede acceder a estas operaciones." });
  return next();
});

function queryString(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}
function searchPattern(req: Request) {
  const value = queryString(req.query.q);
  return value ? "%" + value.replace(/[\\%_]/g, "\\$&") + "%" : "";
}
function pageOptions(req: Request) {
  const limitValue = Number(req.query.limit);
  const offsetValue = Number(req.query.offset);
  return {
    limit: Number.isInteger(limitValue) ? Math.max(1, Math.min(100, limitValue)) : 30,
    offset: Number.isInteger(offsetValue) ? Math.max(0, Math.min(100000, offsetValue)) : 0,
  };
}
function pageResult<T>(rows: T[], limit: number, offset: number) {
  return { items: rows.slice(0, limit), offset, limit, hasMore: rows.length > limit };
}
function entityId(req: Request) {
  const id = Number(req.params.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function reasonValue(value: unknown) {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason.length >= 5 && reason.length <= 500 ? reason : null;
}
function maskedEmail(email: string) {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "oculto";
  const local = email.slice(0, at);
  return (local.slice(0, 1) + (local.length > 1 ? "•••" : "")) + email.slice(at);
}
function auditValues(actorId: number, entity: string, id: number, action: string, before: string | null, after: string | null, reason: string) {
  return { usuarioId: actorId, entidad: entity, entidadId: id, accion: action, estadoAnterior: before, estadoNuevo: after, metadata: { motivo: reason } };
}

router.get("/admin/cuentas", async (req, res) => {
  const { limit, offset } = pageOptions(req);
  const pattern = searchPattern(req);
  const where = pattern ? or(ilike(users.nombre, pattern), ilike(users.email, pattern), ilike(users.rol, pattern)) : undefined;
  const rows = await db.select({ id: users.id, nombre: users.nombre, email: users.email, rol: users.rol, activo: users.activo, createdAt: users.createdAt })
    .from(users).where(where).orderBy(desc(users.createdAt)).limit(limit + 1).offset(offset);
  return res.json(pageResult(rows.map(({ email, ...row }) => ({ ...row, emailMasked: maskedEmail(email) })), limit, offset));
});

router.patch("/admin/cuentas/:id", async (req, res) => {
  const id = entityId(req);
  const reason = reasonValue(req.body?.motivo);
  if (!id) return res.status(400).json({ error: "El identificador de cuenta no es válido." });
  if (typeof req.body?.activo !== "boolean" || !reason) return res.status(400).json({ error: "Indicá el estado de acceso y un motivo de al menos cinco caracteres." });
  if (id === adminId(req)) return res.status(409).json({ error: "No podés cambiar tu propio acceso desde esta operación." });
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({ id: users.id, activo: users.activo, rol: users.rol }).from(users).where(eq(users.id, id)).limit(1);
    if (!current) return { kind: "missing" as const };
    if (current.rol === "admin") return { kind: "protected" as const };
    if (current.activo === req.body.activo) return { kind: "same" as const };
    const [updated] = await tx.update(users).set({ activo: req.body.activo, updatedAt: new Date() })
      .where(and(eq(users.id, id), eq(users.activo, current.activo))).returning({ id: users.id, nombre: users.nombre, rol: users.rol, activo: users.activo });
    if (!updated) return { kind: "conflict" as const };
    await tx.insert(workyAuditEvents).values(auditValues(adminId(req), "account", id, updated.activo ? "reactivated" : "deactivated", String(current.activo), String(updated.activo), reason));
    return { kind: "ok" as const, row: updated };
  });
  if (result.kind === "missing") return res.status(404).json({ error: "Cuenta no encontrada." });
  if (result.kind === "protected") return res.status(409).json({ error: "Las cuentas administradoras están protegidas." });
  if (result.kind === "same") return res.status(409).json({ error: "La cuenta ya tiene ese estado." });
  if (result.kind === "conflict") return res.status(409).json({ error: "La cuenta cambió mientras se procesaba la solicitud. Actualizá la lista." });
  return res.json(result.row);
});

router.get("/admin/partners", async (req, res) => {
  const { limit, offset } = pageOptions(req);
  const pattern = searchPattern(req);
  const partnerFilter = or(eq(users.rol, "profesional"), isNotNull(professionalProfiles.id));
  const searchFilter = pattern ? or(ilike(users.nombre, pattern), ilike(users.email, pattern), ilike(professionalProfiles.oficio, pattern), ilike(professionalProfiles.categoria, pattern)) : undefined;
  const where = searchFilter ? and(partnerFilter, searchFilter) : partnerFilter;
  const rows = await db.select({ id: users.id, nombre: users.nombre, email: users.email, activo: users.activo, createdAt: users.createdAt, oficio: professionalProfiles.oficio, categoria: professionalProfiles.categoria, estadoVerificacion: professionalProfiles.estadoVerificacion, disponible: professionalProfiles.disponible })
    .from(users).leftJoin(professionalProfiles, eq(professionalProfiles.usuarioId, users.id)).where(where)
    .orderBy(desc(users.createdAt)).limit(limit + 1).offset(offset);
  return res.json(pageResult(rows.map(({ email, ...row }) => ({ ...row, emailMasked: maskedEmail(email) })), limit, offset));
});

router.patch("/admin/partners/:id", async (req, res) => {
  const id = entityId(req);
  const reason = reasonValue(req.body?.motivo);
  if (!id) return res.status(400).json({ error: "El identificador del Partner no es válido." });
  if (typeof req.body?.activo !== "boolean" || !reason) return res.status(400).json({ error: "Indicá el estado de acceso y un motivo de al menos cinco caracteres." });
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({ id: users.id, activo: users.activo, rol: users.rol }).from(users).where(eq(users.id, id)).limit(1);
    if (!current) return { kind: "missing" as const };
    const [profile] = await tx.select({ id: professionalProfiles.id }).from(professionalProfiles).where(eq(professionalProfiles.usuarioId, id)).limit(1);
    if (current.rol !== "profesional" && !profile) return { kind: "not-partner" as const };
    if (current.rol === "admin") return { kind: "protected" as const };
    if (current.activo === req.body.activo) return { kind: "same" as const };
    const [updated] = await tx.update(users).set({ activo: req.body.activo, updatedAt: new Date() })
      .where(and(eq(users.id, id), eq(users.activo, current.activo))).returning({ id: users.id, nombre: users.nombre, activo: users.activo });
    if (!updated) return { kind: "conflict" as const };
    await tx.insert(workyAuditEvents).values(auditValues(adminId(req), "partner", id, updated.activo ? "reactivated" : "deactivated", String(current.activo), String(updated.activo), reason));
    return { kind: "ok" as const, row: updated };
  });
  if (result.kind === "missing" || result.kind === "not-partner") return res.status(404).json({ error: "Partner no encontrado." });
  if (result.kind === "protected") return res.status(409).json({ error: "Las cuentas administradoras están protegidas." });
  if (result.kind === "same") return res.status(409).json({ error: "El Partner ya tiene ese estado." });
  if (result.kind === "conflict") return res.status(409).json({ error: "El Partner cambió mientras se procesaba la solicitud. Actualizá la lista." });
  return res.json(result.row);
});

router.get("/admin/trabajos", async (req, res) => {
  const { limit, offset } = pageOptions(req);
  const pattern = searchPattern(req);
  const numericId = Number(queryString(req.query.q));
  const filters = pattern ? or(ilike(jobs.categoria, pattern), ilike(jobs.detalle, pattern), ilike(jobClient.nombre, pattern), ilike(jobPartner.nombre, pattern), Number.isSafeInteger(numericId) && numericId > 0 ? eq(jobs.id, numericId) : undefined) : undefined;
  const rows = await db.select({ id: jobs.id, estado: jobs.estado, categoria: jobs.categoria, detalle: jobs.detalle, precioOfrecido: jobs.precioOfrecido, createdAt: jobs.createdAt, clienteId: jobClient.id, clienteNombre: jobClient.nombre, profesionalId: jobPartner.id, profesionalNombre: jobPartner.nombre })
    .from(jobs).innerJoin(jobClient, eq(jobClient.id, jobs.clienteId)).leftJoin(jobPartner, eq(jobPartner.id, jobs.profesionalId))
    .where(filters).orderBy(desc(jobs.createdAt)).limit(limit + 1).offset(offset);
  return res.json(pageResult(rows.map((row) => ({ id: row.id, estado: row.estado, categoria: row.categoria, detalle: row.detalle ? row.detalle.slice(0, 240) : null, precioOfrecido: Number(row.precioOfrecido), createdAt: row.createdAt, cliente: { id: row.clienteId, nombre: row.clienteNombre }, profesional: row.profesionalId ? { id: row.profesionalId, nombre: row.profesionalNombre } : null })), limit, offset));
});

router.patch("/admin/trabajos/:id/cancelar", async (req, res) => {
  const id = entityId(req);
  const reason = reasonValue(req.body?.motivo);
  if (!id) return res.status(400).json({ error: "El identificador del trabajo no es válido." });
  if (!reason) return res.status(400).json({ error: "Indicá un motivo de al menos cinco caracteres." });
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({ id: jobs.id, estado: jobs.estado }).from(jobs).where(eq(jobs.id, id)).limit(1);
    if (!current) return { kind: "missing" as const };
    if ((terminalJobStates as readonly string[]).includes(current.estado)) return { kind: "terminal" as const };
    const [updated] = await tx.update(jobs).set({ estado: "cancelada", updatedAt: new Date() }).where(and(eq(jobs.id, id), eq(jobs.estado, current.estado))).returning({ id: jobs.id, estado: jobs.estado });
    if (!updated) return { kind: "conflict" as const };
    const activeBookings = await tx.select({ id: bookings.id, estado: bookings.estado }).from(bookings).where(and(eq(bookings.changaId, id), inArray(bookings.estado, activeBookingStates)));
    if (activeBookings.length) {
      await tx.update(bookings).set({ estado: "cancelada", updatedAt: new Date() }).where(and(eq(bookings.changaId, id), inArray(bookings.estado, activeBookingStates)));
      for (const booking of activeBookings) await tx.insert(workyAuditEvents).values(auditValues(adminId(req), "booking", booking.id, "cancelled_by_job", booking.estado, "cancelada", reason));
    }
    await tx.insert(workyAuditEvents).values(auditValues(adminId(req), "job", id, "cancelled", current.estado, updated.estado, reason));
    return { kind: "ok" as const, row: updated };
  });
  if (result.kind === "missing") return res.status(404).json({ error: "Trabajo no encontrado." });
  if (result.kind === "terminal") return res.status(409).json({ error: "El trabajo ya está finalizado o cancelado." });
  if (result.kind === "conflict") return res.status(409).json({ error: "El trabajo cambió mientras se procesaba la solicitud. Actualizá la lista." });
  return res.json(result.row);
});

router.get("/admin/reservas", async (req, res) => {
  const { limit, offset } = pageOptions(req);
  const pattern = searchPattern(req);
  const numericId = Number(queryString(req.query.q));
  const filters = pattern ? or(ilike(bookings.estado, pattern), ilike(bookingClient.nombre, pattern), ilike(bookingPartner.nombre, pattern), Number.isSafeInteger(numericId) && numericId > 0 ? eq(bookings.id, numericId) : undefined, Number.isSafeInteger(numericId) && numericId > 0 ? eq(bookings.changaId, numericId) : undefined) : undefined;
  const rows = await db.select({ id: bookings.id, changaId: bookings.changaId, estado: bookings.estado, empiezaAt: bookings.empiezaAt, terminaAt: bookings.terminaAt, createdAt: bookings.createdAt, clienteId: bookingClient.id, clienteNombre: bookingClient.nombre, profesionalId: bookingPartner.id, profesionalNombre: bookingPartner.nombre })
    .from(bookings).innerJoin(bookingClient, eq(bookingClient.id, bookings.clienteId)).innerJoin(bookingPartner, eq(bookingPartner.id, bookings.profesionalId))
    .where(filters).orderBy(desc(bookings.createdAt)).limit(limit + 1).offset(offset);
  return res.json(pageResult(rows.map((row) => ({ id: row.id, changaId: row.changaId, estado: row.estado, empiezaAt: row.empiezaAt, terminaAt: row.terminaAt, createdAt: row.createdAt, cliente: { id: row.clienteId, nombre: row.clienteNombre }, profesional: { id: row.profesionalId, nombre: row.profesionalNombre } })), limit, offset));
});

router.patch("/admin/reservas/:id/cancelar", async (req, res) => {
  const id = entityId(req);
  const reason = reasonValue(req.body?.motivo);
  if (!id) return res.status(400).json({ error: "El identificador de la reserva no es válido." });
  if (!reason) return res.status(400).json({ error: "Indicá un motivo de al menos cinco caracteres." });
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({ id: bookings.id, estado: bookings.estado }).from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!current) return { kind: "missing" as const };
    if ((terminalBookingStates as readonly string[]).includes(current.estado)) return { kind: "terminal" as const };
    const [updated] = await tx.update(bookings).set({ estado: "cancelada", updatedAt: new Date() }).where(and(eq(bookings.id, id), eq(bookings.estado, current.estado))).returning({ id: bookings.id, estado: bookings.estado });
    if (!updated) return { kind: "conflict" as const };
    await tx.insert(workyAuditEvents).values(auditValues(adminId(req), "booking", id, "cancelled", current.estado, updated.estado, reason));
    return { kind: "ok" as const, row: updated };
  });
  if (result.kind === "missing") return res.status(404).json({ error: "Reserva no encontrada." });
  if (result.kind === "terminal") return res.status(409).json({ error: "La reserva ya está completada o cancelada." });
  if (result.kind === "conflict") return res.status(409).json({ error: "La reserva cambió mientras se procesaba la solicitud. Actualizá la lista." });
  return res.json(result.row);
});

router.get("/admin/pagos", async (req, res) => {
  const { limit, offset } = pageOptions(req);
  const pattern = searchPattern(req);
  const numericId = Number(queryString(req.query.q));
  const filters = pattern ? or(ilike(payments.status, pattern), ilike(paymentClient.nombre, pattern), Number.isSafeInteger(numericId) && numericId > 0 ? eq(payments.id, numericId) : undefined, Number.isSafeInteger(numericId) && numericId > 0 ? eq(payments.changaId, numericId) : undefined) : undefined;
  const rows = await db.select({ id: payments.id, changaId: payments.changaId, amount: payments.amount, currency: payments.currency, status: payments.status, createdAt: payments.createdAt, clienteId: paymentClient.id, clienteNombre: paymentClient.nombre })
    .from(payments).innerJoin(paymentClient, eq(paymentClient.id, payments.clienteId)).where(filters).orderBy(desc(payments.createdAt)).limit(limit + 1).offset(offset);
  return res.json(pageResult(rows.map((row) => ({ id: row.id, changaId: row.changaId, amount: Number(row.amount), currency: row.currency, status: row.status, createdAt: row.createdAt, cliente: { id: row.clienteId, nombre: row.clienteNombre } })), limit, offset));
});

router.get("/admin/resenas", async (req, res) => {
  const { limit, offset } = pageOptions(req);
  const pattern = searchPattern(req);
  const numericId = Number(queryString(req.query.q));
  const filters = pattern ? or(ilike(reviews.comentario, pattern), ilike(reviewClient.nombre, pattern), ilike(reviewPartner.nombre, pattern), Number.isSafeInteger(numericId) && numericId > 0 ? eq(reviews.id, numericId) : undefined, Number.isSafeInteger(numericId) && numericId > 0 ? eq(reviews.changaId, numericId) : undefined) : undefined;
  const rows = await db.select({ id: reviews.id, changaId: reviews.changaId, rating: reviews.rating, comentario: reviews.comentario, createdAt: reviews.createdAt, clienteId: reviewClient.id, clienteNombre: reviewClient.nombre, profesionalId: reviewPartner.id, profesionalNombre: reviewPartner.nombre })
    .from(reviews).innerJoin(reviewClient, eq(reviewClient.id, reviews.clienteId)).innerJoin(reviewPartner, eq(reviewPartner.id, reviews.profesionalId)).where(filters)
    .orderBy(desc(reviews.createdAt)).limit(limit + 1).offset(offset);
  return res.json(pageResult(rows.map((row) => ({ id: row.id, changaId: row.changaId, rating: row.rating, comentario: row.comentario ? row.comentario.slice(0, 240) : null, createdAt: row.createdAt, cliente: { id: row.clienteId, nombre: row.clienteNombre }, profesional: { id: row.profesionalId, nombre: row.profesionalNombre } })), limit, offset));
});

router.get("/admin/recomendaciones", async (req, res) => {
  const { limit, offset } = pageOptions(req);
  const pattern = searchPattern(req);
  const numericId = Number(queryString(req.query.q));
  const filters = pattern ? or(ilike(recommendations.visibilidad, pattern), ilike(recommendations.comentario, pattern), ilike(recommendationClient.nombre, pattern), ilike(recommendationPartner.nombre, pattern), Number.isSafeInteger(numericId) && numericId > 0 ? eq(recommendations.id, numericId) : undefined) : undefined;
  const rows = await db.select({ id: recommendations.id, visibilidad: recommendations.visibilidad, comentario: recommendations.comentario, createdAt: recommendations.createdAt, clienteId: recommendationClient.id, clienteNombre: recommendationClient.nombre, profesionalId: recommendationPartner.id, profesionalNombre: recommendationPartner.nombre })
    .from(recommendations).innerJoin(recommendationClient, eq(recommendationClient.id, recommendations.clienteId)).innerJoin(recommendationPartner, eq(recommendationPartner.id, recommendations.profesionalId)).where(filters)
    .orderBy(desc(recommendations.createdAt)).limit(limit + 1).offset(offset);
  return res.json(pageResult(rows.map((row) => ({ id: row.id, visibilidad: row.visibilidad, comentario: row.comentario ? row.comentario.slice(0, 240) : null, createdAt: row.createdAt, cliente: { id: row.clienteId, nombre: row.clienteNombre }, profesional: { id: row.profesionalId, nombre: row.profesionalNombre } })), limit, offset));
});

router.patch("/admin/recomendaciones/:id", async (req, res) => {
  const id = entityId(req);
  const reason = reasonValue(req.body?.motivo);
  const visibility = req.body?.visibilidad;
  if (!id) return res.status(400).json({ error: "El identificador de la recomendación no es válido." });
  if ((visibility !== "publica" && visibility !== "privada") || !reason) return res.status(400).json({ error: "Indicá la visibilidad y un motivo de al menos cinco caracteres." });
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({ id: recommendations.id, visibilidad: recommendations.visibilidad }).from(recommendations).where(eq(recommendations.id, id)).limit(1);
    if (!current) return { kind: "missing" as const };
    if (current.visibilidad === visibility) return { kind: "same" as const };
    const [updated] = await tx.update(recommendations).set({ visibilidad: visibility, updatedAt: new Date() }).where(and(eq(recommendations.id, id), eq(recommendations.visibilidad, current.visibilidad))).returning({ id: recommendations.id, visibilidad: recommendations.visibilidad });
    if (!updated) return { kind: "conflict" as const };
    await tx.insert(workyAuditEvents).values(auditValues(adminId(req), "recommendation", id, "visibility_changed", current.visibilidad, updated.visibilidad, reason));
    return { kind: "ok" as const, row: updated };
  });
  if (result.kind === "missing") return res.status(404).json({ error: "Recomendación no encontrada." });
  if (result.kind === "same") return res.status(409).json({ error: "La recomendación ya tiene esa visibilidad." });
  if (result.kind === "conflict") return res.status(409).json({ error: "La recomendación cambió mientras se procesaba la solicitud. Actualizá la lista." });
  return res.json(result.row);
});

router.get("/admin/catalogo", async (req, res) => {
  const { limit, offset } = pageOptions(req);
  const pattern = searchPattern(req);
  const where = pattern ? or(ilike(serviceCatalog.categoria, pattern), ilike(serviceCatalog.especialidad, pattern)) : undefined;
  const rows = await db.select({ id: serviceCatalog.id, categoria: serviceCatalog.categoria, especialidad: serviceCatalog.especialidad, activa: serviceCatalog.activa, createdAt: serviceCatalog.createdAt })
    .from(serviceCatalog).where(where).orderBy(asc(serviceCatalog.categoria), asc(serviceCatalog.especialidad)).limit(limit + 1).offset(offset);
  return res.json(pageResult(rows, limit, offset));
});

router.post("/admin/catalogo", async (req, res) => {
  const categoria = typeof req.body?.categoria === "string" ? req.body.categoria.trim() : "";
  const especialidad = typeof req.body?.especialidad === "string" ? req.body.especialidad.trim() : "";
  if (!(validCategories as readonly string[]).includes(categoria) || especialidad.length < 2 || especialidad.length > 120) return res.status(400).json({ error: "Elegí una categoría válida e indicá una especialidad de 2 a 120 caracteres." });
  const created = await db.transaction(async (tx) => {
    const [row] = await tx.insert(serviceCatalog).values({ categoria, especialidad, activa: true }).onConflictDoNothing().returning({ id: serviceCatalog.id, categoria: serviceCatalog.categoria, especialidad: serviceCatalog.especialidad, activa: serviceCatalog.activa, createdAt: serviceCatalog.createdAt });
    if (!row) return null;
    await tx.insert(workyAuditEvents).values({ usuarioId: adminId(req), entidad: "catalog_item", entidadId: row.id, accion: "created", estadoAnterior: null, estadoNuevo: "activa", metadata: { categoria, especialidad } });
    return row;
  });
  if (!created) return res.status(409).json({ error: "Esa especialidad ya existe en la categoría." });
  return res.status(201).json(created);
});

router.patch("/admin/catalogo/:id", async (req, res) => {
  const id = entityId(req);
  const reason = reasonValue(req.body?.motivo);
  if (!id) return res.status(400).json({ error: "El identificador del registro no es válido." });
  if (typeof req.body?.activa !== "boolean" || !reason) return res.status(400).json({ error: "Indicá el estado y un motivo de al menos cinco caracteres." });
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({ id: serviceCatalog.id, activa: serviceCatalog.activa }).from(serviceCatalog).where(eq(serviceCatalog.id, id)).limit(1);
    if (!current) return { kind: "missing" as const };
    if (current.activa === req.body.activa) return { kind: "same" as const };
    const [updated] = await tx.update(serviceCatalog).set({ activa: req.body.activa, updatedAt: new Date() }).where(and(eq(serviceCatalog.id, id), eq(serviceCatalog.activa, current.activa))).returning({ id: serviceCatalog.id, categoria: serviceCatalog.categoria, especialidad: serviceCatalog.especialidad, activa: serviceCatalog.activa });
    if (!updated) return { kind: "conflict" as const };
    await tx.insert(workyAuditEvents).values(auditValues(adminId(req), "catalog_item", id, updated.activa ? "activated" : "deactivated", String(current.activa), String(updated.activa), reason));
    return { kind: "ok" as const, row: updated };
  });
  if (result.kind === "missing") return res.status(404).json({ error: "Especialidad no encontrada." });
  if (result.kind === "same") return res.status(409).json({ error: "La especialidad ya tiene ese estado." });
  if (result.kind === "conflict") return res.status(409).json({ error: "La especialidad cambió mientras se procesaba la solicitud. Actualizá la lista." });
  return res.json(result.row);
});

router.get("/admin/recursos", async (req, res) => {
  const { limit, offset } = pageOptions(req);
  const pattern = searchPattern(req);
  const where = pattern ? or(ilike(professionalAssets.nombre, pattern), ilike(professionalAssets.tipo, pattern), ilike(resourcePartner.nombre, pattern)) : undefined;
  const rows = await db.select({ id: professionalAssets.id, profesionalId: professionalAssets.profesionalId, profesionalNombre: resourcePartner.nombre, tipo: professionalAssets.tipo, nombre: professionalAssets.nombre, contentType: professionalAssets.contentType, sizeBytes: professionalAssets.sizeBytes, altText: professionalAssets.altText, createdAt: professionalAssets.createdAt })
    .from(professionalAssets).innerJoin(resourcePartner, eq(resourcePartner.id, professionalAssets.profesionalId)).where(where)
    .orderBy(desc(professionalAssets.createdAt)).limit(limit + 1).offset(offset);
  return res.json(pageResult(rows.map((row) => ({ ...row, altText: row.altText ? row.altText.slice(0, 160) : null })), limit, offset));
});

router.get("/admin/actividad", async (req, res) => {
  const { limit, offset } = pageOptions(req);
  const pattern = searchPattern(req);
  const numericId = Number(queryString(req.query.q));
  const filters = pattern ? or(ilike(workyAuditEvents.entidad, pattern), ilike(workyAuditEvents.accion, pattern), ilike(auditActor.nombre, pattern), ilike(workyAuditEvents.estadoAnterior, pattern), ilike(workyAuditEvents.estadoNuevo, pattern), Number.isSafeInteger(numericId) && numericId > 0 ? eq(workyAuditEvents.entidadId, numericId) : undefined) : undefined;
  const rows = await db.select({ id: workyAuditEvents.id, usuarioId: workyAuditEvents.usuarioId, usuarioNombre: auditActor.nombre, entidad: workyAuditEvents.entidad, entidadId: workyAuditEvents.entidadId, accion: workyAuditEvents.accion, estadoAnterior: workyAuditEvents.estadoAnterior, estadoNuevo: workyAuditEvents.estadoNuevo, createdAt: workyAuditEvents.createdAt })
    .from(workyAuditEvents).leftJoin(auditActor, eq(auditActor.id, workyAuditEvents.usuarioId)).where(filters)
    .orderBy(desc(workyAuditEvents.createdAt)).limit(limit + 1).offset(offset);
  return res.json(pageResult(rows, limit, offset));
});

export default router;
