import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import rateLimit from "express-rate-limit";
import { and, asc, desc, eq, exists, gt, gte, ilike, inArray, isNotNull, isNull, ne, notExists, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { adminSignupTokens, cashJobCommissions, chatUploads, clientIdentityVerifications, clientVerificationUploads, db, jobs, messages, passwordRecoveryTokens, professionalProfiles, profilePhotoUploads, users, serviceCatalog, professionalAvailability, professionalAssets, bookings, payments, settlements, visitPayments, workyNotifications, workyAuditEvents, reviews, recommendations, professionalServices, professionalVerificationDocuments, mobileLoginChallenges, mobileTrustedDevices, webLoginChallenges } from "@workspace/db";
import { ChangeMyPasswordBody, ConfirmAccountEmailVerificationBody, ConfirmRegistrationEmailVerificationBody, CompleteAdminSignupBody, CompleteAdminSignupResponse, CreatePaymentCheckoutBody, RequestAdminSignupCodeBody, RequestAdminSignupCodeResponse, RequestPasswordRecoveryBody, RequestRegistrationEmailVerificationBody, ResetPasswordRecoveryBody, SwitchAccountRoleBody, SwitchAccountRoleResponse, UpdateJobBody, UpdateMyAccountBody, UpdateTwoFactorSecurityBody } from "@workspace/api-zod";
import { resolveWorkyCategory } from "@workspace/worky-domain";
import { requireAuth, requireAuthAllowingUnverifiedEmail, signToken, verifyToken } from "../middlewares/auth";
import { deleteObject, isClientVerificationUploadPath, isProfilePhotoRenderedPath, isProfilePhotoSourcePath, isValidImageObject, prepareClientVerificationImage, processProfilePhoto } from "../lib/storage";
import { discardClientVerificationUpload, getClientIdentityStatus } from "../lib/client-verification";
import { cleanupRejectedChatAttachment } from "./storage";
import { ADMIN_SIGNUP_CODE_TTL_MS, ADMIN_SIGNUP_MAX_ATTEMPTS, ADMIN_SIGNUP_RESEND_COOLDOWN_MS, createAdminSignupChallenge, getAdminSignupAllowlist, getPrimaryAdminEmail, matchesAdminSignupCode } from "../lib/admin-signup";
import { createPasswordRecovery, isPasswordRecoveryTokenValid, passwordRecoveryFailureDetails, passwordRecoveryTokenHash } from "../lib/password-recovery";
import { confirmEmailVerificationCode, createEmailVerificationChallenge, emailVerificationFailureDetails } from "../lib/email-verification";
import { sendWorkyEmail } from "../lib/worky-email";
import { sendGmailEmail } from "../lib/gmail-mailer";
import { createMercadoPagoPreference, getMercadoPagoPayment, getWorkyPublicOrigin, verifyMercadoPagoWebhookSignature, type MercadoPagoPayment } from "../lib/mercado-pago";
import { requireApprovedProfessional } from "../middlewares/approved-professional";
import { partnerVerificationStatus } from "../lib/partner-verification";
import {
  calculateVisibilityRank,
  confirmedIncidentCountSql,
  isPaidJobRecommendationRankingActive,
  RECOMMENDATION_RISK_DECISION_ACTIONS,
  RECOMMENDATION_RISK_REVIEW_THRESHOLD,
  RECOMMENDATION_RISK_WINDOW_DAYS,
} from "../lib/recommendation-ranking";
import { logger } from "../lib/logger";
import { settleAvailablePartnerCommissions, settleAvailableVisitCommissions } from "../lib/visit-commission-offset";

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
const emailVerificationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const mobileLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const twoFactorLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const adminSignupRequestLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const adminSignupCompleteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const clientVerificationSubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 4,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(userId(req)),
  message: { error: "Llegaste al límite de intentos de verificación. Esperá antes de volver a enviar." },
});
const statuses = ["publicada", "aceptada", "en_curso", "trabajo_realizado", "finalizada", "cancelada"] as const;
const CASH_JOB_COMMISSION_RATE_PERCENT = 15;
const MAX_CHAT_ATTACHMENTS = 5;
const userId = (req: Request) => req.usuarioId as number;
function mercadoPagoCredentials() {
  return process.env.NODE_ENV === "production"
    ? {
      accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN_PRODUCTION,
      webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET_PRODUCTION,
    }
    : {
      accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN_DEVELOPMENT,
      webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET_DEVELOPMENT,
    };
}
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
    res.status(403).json({ error: "Solo una persona administradora puede realizar esta acción." });
    return false;
  }
  return true;
}
async function recentConfirmedActivityIncidents(professionalId: number) {
  const confirmedEvent = alias(workyAuditEvents, "ranking_confirmed_event");
  const laterEvent = alias(workyAuditEvents, "ranking_later_event");
  const cutoff = new Date(Date.now() - RECOMMENDATION_RISK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return db.select({
    jobId: jobs.id,
    category: jobs.categoria,
    reviewedAt: confirmedEvent.createdAt,
  }).from(confirmedEvent)
    .innerJoin(jobs, eq(jobs.id, confirmedEvent.entidadId))
    .where(and(
      eq(confirmedEvent.entidad, "job"),
      eq(confirmedEvent.accion, "recommendation_incident_confirmed"),
      eq(jobs.profesionalId, professionalId),
      gte(confirmedEvent.createdAt, cutoff),
      notExists(db.select({ id: laterEvent.id }).from(laterEvent).where(and(
        eq(laterEvent.entidad, "job"),
        eq(laterEvent.entidadId, confirmedEvent.entidadId),
        inArray(laterEvent.accion, [...RECOMMENDATION_RISK_DECISION_ACTIONS]),
        or(
          gt(laterEvent.createdAt, confirmedEvent.createdAt),
          and(eq(laterEvent.createdAt, confirmedEvent.createdAt), gt(laterEvent.id, confirmedEvent.id)),
        ),
      ))),
    ))
    .orderBy(desc(confirmedEvent.createdAt), desc(confirmedEvent.id));
}
const missing = (values: Record<string, unknown>) => Object.keys(values).filter((key) => values[key] === undefined || values[key] === null || values[key] === "");
const safeAccountLocation = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value ?? null;
  const { coordinates: _coordinates, capturedAt: _capturedAt, ...publicFields } = value as Record<string, unknown>;
  return publicFields;
};
const safeUser = (user: typeof users.$inferSelect) => ({
  id: user.id, nombre: user.nombre, email: user.email, telefono: user.telefono, rol: user.rol, ubicacion: safeAccountLocation(user.ubicacion),
  edad: user.edad, fotoObjectPath: user.fotoObjectPath, onboardingEstado: user.onboardingEstado, onboardingPaso: user.onboardingPaso,
});
const workerFacingClient = (user: typeof users.$inferSelect) => ({
  ...safeUser(user),
  clientVerified: Boolean(user.clientIdentityVerifiedAt),
});
const safeAuthenticatedUser = (user: typeof users.$inferSelect) => ({
  ...safeUser(user),
  emailVerifiedAt: user.emailVerifiedAt,
  username: user.username,
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
function fixedLocationOf(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const location = value as { direccionTexto?: unknown; ciudad?: unknown; provincia?: unknown };
  const direccionTexto = typeof location.direccionTexto === "string" ? location.direccionTexto.trim() : "";
  const ciudad = typeof location.ciudad === "string" ? location.ciudad.trim() : "";
  if (!direccionTexto || !ciudad) return null;
  return {
    direccionTexto,
    ciudad,
    provincia: typeof location.provincia === "string" && location.provincia.trim() ? location.provincia.trim() : null,
  };
}
function normalizeFixedLocation(value: unknown, previous?: unknown) {
  const publicLocation = fixedLocationOf(value);
  if (!publicLocation) return null;
  if (publicLocation.direccionTexto.length > 200 || publicLocation.ciudad.length > 100 || (publicLocation.provincia?.length ?? 0) > 100) return null;
  const nextCoordinates = coordinatesOf(value);
  const hasCoordinates = Boolean(value && typeof value === "object" && "coordinates" in value);
  if (hasCoordinates && !nextCoordinates) return null;
  const retainedCoordinates = nextCoordinates ?? coordinatesOf(previous);
  return {
    ...publicLocation,
    ...(retainedCoordinates ? { coordinates: retainedCoordinates } : {}),
  };
}
function distanceInKm(from: [number, number], to: [number, number]) {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(to[1] - from[1]);
  const longitudeDelta = radians(to[0] - from[0]);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from[1])) * Math.cos(radians(to[1])) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}
const profileView = (row: { profile: typeof professionalProfiles.$inferSelect; user: typeof users.$inferSelect }) => {
  const { ubicacionFija, ...profile } = row.profile;
  return {
    ...profile,
    ubicacionFija: fixedLocationOf(ubicacionFija),
    precioReferencia: Number(row.profile.precioReferencia),
    rating: Number(row.profile.rating),
    usuario: publicUser(row.user),
  };
};
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
const jobView = (
  row: { job: typeof jobs.$inferSelect; client: typeof users.$inferSelect; professional?: typeof users.$inferSelect | null },
  includeClientVerification = false,
) => ({
  ...row.job,
  precioOfrecido: Number(row.job.precioOfrecido),
  cashConfirmedByClient: Boolean(row.job.cashConfirmedByClientAt),
  cashConfirmedByProfessional: Boolean(row.job.cashConfirmedByProfessionalAt),
  cliente: includeClientVerification ? workerFacingClient(row.client) : safeUser(row.client),
  profesional: row.professional ? safeUser(row.professional) : null,
  calificada: false,
});
function changaIdFromNotificationHref(href?: string | null) {
  const match = href?.match(/^\/chat\/(\d+)(?:\?|$)/);
  if (!match) return undefined;
  const changaId = Number(match[1]);
  return Number.isSafeInteger(changaId) && changaId > 0 ? changaId : undefined;
}

async function notify(
  usuarioId: number | null | undefined,
  titulo: string,
  detalle: string,
  href?: string,
  changaId?: number,
) {
  if (!usuarioId) return;
  const linkedChangaId = changaId ?? changaIdFromNotificationHref(href);
  const [notification] = await db.insert(workyNotifications)
    .values({ usuarioId, changaId: linkedChangaId ?? null, tipo: "actividad", titulo, detalle, href: href ?? null })
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
const visitPaymentView = (payment: typeof visitPayments.$inferSelect | undefined) => payment ? ({
  amount: Number(payment.amount),
  commissionAmount: Number(payment.commissionAmount),
  partnerAmount: Number(payment.partnerAmount),
  method: payment.method,
  status: payment.status,
  partnerArrivedAt: payment.partnerArrivedAt,
  completedAt: payment.completedAt,
  releaseAt: payment.releaseAt,
  clientConfirmedAt: payment.clientConfirmedAt,
  issueReportedAt: payment.issueReportedAt,
  issueType: payment.issueType,
  issueDetail: payment.issueDetail,
}) : null;
async function appointmentView(booking: typeof bookings.$inferSelect) {
  const [finance] = await db.select().from(visitPayments).where(eq(visitPayments.bookingId, booking.id)).limit(1);
  return { ...booking, tarifaVisita: Number(booking.tarifaVisita), finanzas: visitPaymentView(finance) };
}
export async function releaseMaturedVisitBalances(now = new Date()) {
  const mature = await db.select({
    id: visitPayments.id, bookingId: visitPayments.bookingId, changaId: bookings.changaId,
    clienteId: visitPayments.clienteId, profesionalId: visitPayments.profesionalId,
  })
    .from(visitPayments).innerJoin(bookings, eq(bookings.id, visitPayments.bookingId))
    .where(and(eq(visitPayments.status, "pending_release"), isNotNull(visitPayments.releaseAt), sql`${visitPayments.releaseAt} <= ${now}`));
  let released = 0;
  for (const candidate of mature) {
    const result = await db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, candidate.profesionalId)).for("update").limit(1);
      const [locked] = await tx.select().from(visitPayments).where(eq(visitPayments.id, candidate.id)).for("update").limit(1);
      if (!locked || locked.status !== "pending_release" || !locked.releaseAt || locked.releaseAt > now) return false;
      await tx.update(visitPayments).set({ status: "available", updatedAt: now }).where(eq(visitPayments.id, locked.id));
      await tx.insert(workyAuditEvents).values({
        entidad: "visit_payment",
        entidadId: locked.id,
        accion: "balance_auto_released",
        estadoAnterior: "pending_release",
        estadoNuevo: "available",
        metadata: { bookingId: locked.bookingId },
      });
      await settleAvailablePartnerCommissions(tx, locked.profesionalId, now);
      return true;
    });
    if (!result) continue;
    released += 1;
    await notify(candidate.profesionalId, "Saldo de visita liberado", "Pasaron 24 horas sin reportes. El saldo quedó disponible y se aplicó automáticamente a comisiones pendientes de visitas y changas en efectivo si correspondía.", "/partner");
    await notify(candidate.clienteId, "Visita cerrada", "La ventana de revisión de la visita terminó sin reportes.", `/chat/${candidate.changaId}`);
  }
  return released;
}

const visitBalanceReleaseTimer = setInterval(() => {
  void releaseMaturedVisitBalances().catch((error) => {
    logger.warn({ error }, "Visit balance release sweep failed; pending balances will retry next cycle");
  });
}, 60_000);
visitBalanceReleaseTimer.unref();
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
type ConversationThread = {
  job: typeof jobs.$inferSelect;
  profesionalId: number | null;
};
async function conversationThread(changaId: number, usuarioId: number, requestedProfessionalId?: number | null): Promise<ConversationThread | null> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, changaId)).limit(1);
  if (!job) return null;

  if (job.clienteId === usuarioId) {
    const profesionalId = requestedProfessionalId === undefined ? job.profesionalId : requestedProfessionalId;
    if (profesionalId === null) {
      return job.profesionalId === null ? { job, profesionalId: null } : null;
    }
    if (job.profesionalId !== null && job.profesionalId !== profesionalId) return null;
    const [priorMessage] = await db.select({ id: messages.id }).from(messages).where(and(
      eq(messages.changaId, changaId),
      or(
        eq(messages.conversacionProfesionalId, profesionalId),
        and(isNull(messages.conversacionProfesionalId), eq(messages.emisorId, profesionalId)),
      ),
    )).limit(1);
    const [profile] = await db.select({ usuarioId: professionalProfiles.usuarioId, categoria: professionalProfiles.categoria }).from(professionalProfiles)
      .innerJoin(users, eq(users.id, professionalProfiles.usuarioId))
      .where(and(
        eq(professionalProfiles.usuarioId, profesionalId),
        eq(professionalProfiles.habilitado, true),
        eq(professionalProfiles.verificado, true),
        eq(professionalProfiles.estadoVerificacion, "verified"),
        eq(users.activo, true),
        isNotNull(users.emailVerifiedAt),
      )).limit(1);
    const [extraService] = profile && profile.categoria !== job.categoria
      ? await db.select({ id: professionalServices.id }).from(professionalServices)
        .where(and(eq(professionalServices.profesionalId, profesionalId), eq(professionalServices.categoria, job.categoria))).limit(1)
      : [null];
    if (job.profesionalId === null && ((!profile || (profile.categoria !== job.categoria && !extraService)) && !priorMessage)) return null;
    return { job, profesionalId };
  }

  if (requestedProfessionalId !== undefined && requestedProfessionalId !== usuarioId) return null;
  if (job.profesionalId !== null && job.profesionalId !== usuarioId) return null;
  const [existingThread] = await db.select({ id: messages.id }).from(messages).where(and(
    eq(messages.changaId, changaId),
    or(
      eq(messages.conversacionProfesionalId, usuarioId),
      and(isNull(messages.conversacionProfesionalId), eq(messages.emisorId, usuarioId)),
    ),
  )).limit(1);
  const [profile] = await db.select({ categoria: professionalProfiles.categoria }).from(professionalProfiles)
    .innerJoin(users, eq(users.id, professionalProfiles.usuarioId))
    .where(and(
      eq(professionalProfiles.usuarioId, usuarioId),
      eq(professionalProfiles.habilitado, true),
      eq(professionalProfiles.verificado, true),
      eq(professionalProfiles.estadoVerificacion, "verified"),
      eq(users.activo, true),
      isNotNull(users.emailVerifiedAt),
    )).limit(1);
  const [extraService] = profile ? await db.select({ categoria: professionalServices.categoria }).from(professionalServices)
    .where(and(eq(professionalServices.profesionalId, usuarioId), eq(professionalServices.categoria, job.categoria))).limit(1) : [null];
  const servesCategory = profile?.categoria === job.categoria || Boolean(extraService);
  if (job.profesionalId === null && !existingThread && (job.estado !== "publicada" || !servesCategory || !profile)) return null;
  return { job, profesionalId: usuarioId };
}
function threadMessagesWhere(changaId: number, clienteId: number, profesionalId: number | null) {
  if (profesionalId === null) {
    return and(eq(messages.changaId, changaId), isNull(messages.conversacionProfesionalId), eq(messages.emisorId, clienteId));
  }
  return and(eq(messages.changaId, changaId), or(
    eq(messages.conversacionProfesionalId, profesionalId),
    and(
      isNull(messages.conversacionProfesionalId),
      or(eq(messages.emisorId, clienteId), eq(messages.emisorId, profesionalId)),
    ),
  ));
}
function requestedConversationRole(req: Request): "cliente" | "profesional" | null | "invalid" {
  const value = req.query.rol;
  if (value === undefined) return null;
  if (typeof value !== "string" || !["cliente", "profesional"].includes(value)) return "invalid";
  return value as "cliente" | "profesional";
}

router.post("/auth/email-verification/registration/request", emailVerificationLimiter, async (req, res): Promise<void> => {
  const parsed = RequestRegistrationEmailVerificationBody.safeParse(req.body);
  if (!parsed.success || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.data?.email.trim() ?? "")) {
    res.status(400).json({ error: "Ingresá un email válido." });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db.select({
    id: users.id,
    nombre: users.nombre,
    email: users.email,
    emailVerifiedAt: users.emailVerifiedAt,
  }).from(users).where(and(eq(users.email, email), eq(users.activo, true))).limit(1);
  if (!user || user.emailVerifiedAt) {
    res.status(202).json({ message: "Si la cuenta necesita verificación, vas a recibir un código por email." });
    return;
  }

  try {
    const result = await createEmailVerificationChallenge({
      email: user.email,
      name: user.nombre,
      purpose: "registration",
      usuarioId: user.id,
    });
    if (result.throttled) {
      res.status(429).json({ error: "Esperá un minuto antes de pedir otro código." });
      return;
    }
  } catch (error) {
    req.log.error({ purpose: "registration", ...emailVerificationFailureDetails(error) }, "No se pudo enviar el código de verificación");
    res.status(503).json({
      error: "No pudimos enviar el código. Intentá nuevamente en unos minutos.",
      code: "EMAIL_VERIFICATION_DELIVERY_FAILED",
    });
    return;
  }

  res.status(202).json({ message: "Te enviamos un código de verificación a tu email." });
});

router.post("/auth/email-verification/registration/confirm", emailVerificationLimiter, async (req, res): Promise<void> => {
  const parsed = ConfirmRegistrationEmailVerificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ingresá un email válido y el código de 6 dígitos." });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db.select().from(users)
    .where(and(eq(users.email, email), eq(users.activo, true), isNull(users.emailVerifiedAt)))
    .limit(1);
  if (!user) {
    res.status(400).json({ error: "El código no es válido o venció. Revisalo o pedí uno nuevo." });
    return;
  }

  const confirmed = await confirmEmailVerificationCode({
    email: user.email,
    purpose: "registration",
    code: parsed.data.code,
    usuarioId: user.id,
    consume: true,
  });
  if (!confirmed) {
    res.status(400).json({ error: "El código no es válido o venció. Revisalo o pedí uno nuevo." });
    return;
  }

  const verifiedAt = new Date();
  const [verifiedUser] = await db.update(users)
    .set({ emailVerifiedAt: verifiedAt, updatedAt: verifiedAt })
    .where(and(eq(users.id, user.id), eq(users.email, user.email), isNull(users.emailVerifiedAt)))
    .returning();
  if (!verifiedUser) {
    res.status(400).json({ error: "El código no es válido o venció. Revisalo o pedí uno nuevo." });
    return;
  }

  res.json({ token: signToken(verifiedUser.id), usuario: safeAuthenticatedUser(verifiedUser) });
});

router.post("/auth/email-verification/account/request", emailVerificationLimiter, requireAuthAllowingUnverifiedEmail, async (req, res): Promise<void> => {
  const [user] = await db.select({
    id: users.id,
    nombre: users.nombre,
    email: users.email,
    emailVerifiedAt: users.emailVerifiedAt,
  }).from(users).where(and(eq(users.id, userId(req)), eq(users.activo, true))).limit(1);
  if (!user) {
    res.status(401).json({ error: "Tu sesión ya no es válida." });
    return;
  }
  if (user.emailVerifiedAt) {
    res.status(409).json({ error: "Tu email ya está verificado." });
    return;
  }

  try {
    const result = await createEmailVerificationChallenge({
      email: user.email,
      name: user.nombre,
      purpose: "account",
      usuarioId: user.id,
    });
    if (result.throttled) {
      res.status(429).json({ error: "Esperá un minuto antes de pedir otro código." });
      return;
    }
  } catch (error) {
    req.log.error({ purpose: "account", ...emailVerificationFailureDetails(error) }, "No se pudo enviar el código de verificación");
    res.status(503).json({ error: "No pudimos enviar el código. Intentá nuevamente en unos minutos." });
    return;
  }

  res.status(202).json({ message: "Te enviamos un código de verificación a tu email." });
});

router.post("/auth/email-verification/account/confirm", emailVerificationLimiter, requireAuthAllowingUnverifiedEmail, async (req, res): Promise<void> => {
  const parsed = ConfirmAccountEmailVerificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ingresá el código de 6 dígitos." });
    return;
  }
  const [user] = await db.select({
    id: users.id,
    email: users.email,
    emailVerifiedAt: users.emailVerifiedAt,
  }).from(users).where(and(eq(users.id, userId(req)), eq(users.activo, true))).limit(1);
  if (!user) {
    res.status(401).json({ error: "Tu sesión ya no es válida." });
    return;
  }
  if (user.emailVerifiedAt) {
    res.status(409).json({ error: "Tu email ya está verificado." });
    return;
  }

  const confirmed = await confirmEmailVerificationCode({
    email: user.email,
    purpose: "account",
    code: parsed.data.code,
    usuarioId: user.id,
    consume: true,
  });
  if (!confirmed) {
    res.status(400).json({ error: "El código no es válido o venció. Revisalo o pedí uno nuevo." });
    return;
  }

  const verifiedAt = new Date();
  const [verifiedUser] = await db.update(users)
    .set({ emailVerifiedAt: verifiedAt, updatedAt: verifiedAt })
    .where(and(eq(users.id, user.id), eq(users.email, user.email), isNull(users.emailVerifiedAt)))
    .returning({ id: users.id });
  if (!verifiedUser) {
    res.status(409).json({ error: "No pudimos confirmar el estado de verificación. Intentá ingresar nuevamente." });
    return;
  }
  res.json({ verified: true });
});

router.post("/auth/register", authLimit, async (req, res) => {
  const { nombre, email, password, telefono, ubicacion, edad, fotoObjectPath, rol, onboardingRespuestas } = req.body ?? {};
  const fields = missing({ nombre, email, password });
  if (fields.length || typeof password !== "string" || password.length < 6 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? "").trim())) {
    return res.status(400).json({ error: "Ingresá un nombre, un email válido y una contraseña de al menos 6 caracteres.", campos_faltantes: fields });
  }
  const normalized = String(email).trim().toLowerCase();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, normalized)).limit(1);
  if (existing[0]) return res.status(409).json({ error: "Ya existe una cuenta con ese email." });
  const requestedRole = rol === "profesional" ? "profesional" : "cliente";
  let created: typeof users.$inferSelect | undefined;
  try {
    const [account] = await db.insert(users).values({
      nombre: String(nombre).trim(), email: normalized, emailVerifiedAt: null, passwordHash: await bcrypt.hash(password, 12),
      telefono: telefono ? String(telefono).trim() : null, ubicacion: ubicacion ?? null,
      edad: Number.isFinite(Number(edad)) ? Number(edad) : null, fotoObjectPath: fotoObjectPath || null,
      rol: requestedRole, onboardingEstado: requestedRole === "profesional" ? "professional_verification_pending" : "registration_started",
      onboardingRespuestas: onboardingRespuestas && typeof onboardingRespuestas === "object" ? onboardingRespuestas : {},
    }).returning();
    created = account;
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code
      ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") return res.status(409).json({ error: "Ya existe una cuenta con ese email." });
    throw error;
  }

  if (!created) return res.status(500).json({ error: "No pudimos crear tu cuenta." });
  try {
    const result = await createEmailVerificationChallenge({
      email: created.email,
      name: created.nombre,
      purpose: "registration",
      usuarioId: created.id,
    });
    if (result.throttled) {
      return res.status(429).json({
        error: "Esperá un minuto antes de pedir otro código.",
        code: "EMAIL_VERIFICATION_THROTTLED",
      });
    }
  } catch (error) {
    req.log.error({ purpose: "registration", ...emailVerificationFailureDetails(error) }, "No se pudo enviar el código de verificación");
    return res.status(503).json({
      error: "Creamos tu cuenta, pero no pudimos enviar el código. Podés volver a pedirlo en unos minutos.",
      code: "EMAIL_VERIFICATION_DELIVERY_FAILED",
    });
  }
  return res.status(202).json({ message: "Creamos tu cuenta y enviamos un código para verificar tu email." });
});

router.post("/auth/admin-signup/request", adminSignupRequestLimiter, async (req, res) => {
  const parsed = RequestAdminSignupCodeBody.safeParse(req.body);
  if (!parsed.success || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.data.email.trim())) return res.status(400).json({ error: "Ingresá un email válido." });

  const allowlist = getAdminSignupAllowlist();
  if (!allowlist.size) return res.status(503).json({ error: "El alta de administradores no está configurada." });

  const email = parsed.data.email.trim().toLowerCase();
  const genericResponse = RequestAdminSignupCodeResponse.parse({
    message: "Si el correo está habilitado, vas a recibir un código de verificación válido durante 15 minutos.",
  });
  if (!allowlist.has(email) || email !== getPrimaryAdminEmail()) return res.status(202).json(genericResponse);

  const now = new Date();
  const [previousChallenge] = await db.select({
    createdAt: adminSignupTokens.createdAt,
    expiresAt: adminSignupTokens.expiresAt,
    usedAt: adminSignupTokens.usedAt,
  }).from(adminSignupTokens).where(eq(adminSignupTokens.email, email)).limit(1);
  if (previousChallenge && !previousChallenge.usedAt
    && previousChallenge.expiresAt.getTime() > now.getTime()
    && now.getTime() - previousChallenge.createdAt.getTime() < ADMIN_SIGNUP_RESEND_COOLDOWN_MS) {
    return res.status(202).json(genericResponse);
  }

  const challenge = createAdminSignupChallenge(email);
  await db.insert(adminSignupTokens).values({
    email,
    codeHash: challenge.codeHash,
    codeSalt: challenge.salt,
    attempts: 0,
    expiresAt: new Date(now.getTime() + ADMIN_SIGNUP_CODE_TTL_MS),
    usedAt: null,
    createdAt: now,
  }).onConflictDoUpdate({
    target: adminSignupTokens.email,
    set: {
      codeHash: challenge.codeHash,
      codeSalt: challenge.salt,
      attempts: 0,
      expiresAt: new Date(now.getTime() + ADMIN_SIGNUP_CODE_TTL_MS),
      usedAt: null,
      createdAt: now,
    },
  });

  try {
    await sendWorkyEmail({
      to: email,
      subject: "Código para crear tu cuenta administradora de Worky",
      text: `Tu código de verificación es ${challenge.code}. Es válido durante 15 minutos y solo puede usarse una vez. Si no solicitaste este código, ignorá este correo.`,
      html: `<p>Tu código de verificación para Worky Admin es:</p><p style="font-size:28px;font-weight:700;letter-spacing:8px">${challenge.code}</p><p>Es válido durante 15 minutos y solo puede usarse una vez.</p><p>Si no solicitaste este código, ignorá este correo.</p>`,
    });
  } catch {
    await db.update(adminSignupTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(adminSignupTokens.email, email), eq(adminSignupTokens.codeHash, challenge.codeHash), isNull(adminSignupTokens.usedAt)));
    req.log.error({ code: "admin_signup_email_delivery_failed" }, "No se pudo enviar el código de alta admin");
    return res.status(503).json({ error: "No pudimos enviar el código. Intentá nuevamente más tarde." });
  }

  return res.status(202).json(genericResponse);
});

router.post("/auth/admin-signup/complete", adminSignupCompleteLimiter, async (req, res) => {
  const parsed = CompleteAdminSignupBody.safeParse(req.body);
  if (!parsed.success || parsed.data.nombre.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.data.email.trim())) {
    return res.status(400).json({ error: "Revisá los datos y el código de verificación." });
  }

  const allowlist = getAdminSignupAllowlist();
  if (!allowlist.size) return res.status(503).json({ error: "El alta de administradores no está configurada." });

  const email = parsed.data.email.trim().toLowerCase();
  if (!allowlist.has(email) || email !== getPrimaryAdminEmail()) return res.status(400).json({ error: "El código no es válido o venció. Pedí uno nuevo e intentá otra vez." });

  const result = await db.transaction(async (tx) => {
    const now = new Date();
    const [challenge] = await tx.select().from(adminSignupTokens)
      .where(eq(adminSignupTokens.email, email))
      .for("update")
      .limit(1);

    if (!challenge || challenge.usedAt || challenge.expiresAt.getTime() <= now.getTime() || challenge.attempts >= ADMIN_SIGNUP_MAX_ATTEMPTS) {
      return { kind: "invalid" as const };
    }

    const recordFailedAttempt = async () => {
      const attempts = challenge.attempts + 1;
      await tx.update(adminSignupTokens)
        .set({ attempts, usedAt: attempts >= ADMIN_SIGNUP_MAX_ATTEMPTS ? now : null })
        .where(eq(adminSignupTokens.id, challenge.id));
    };

    if (!matchesAdminSignupCode(email, parsed.data.codigo, challenge.codeSalt, challenge.codeHash)) {
      await recordFailedAttempt();
      return { kind: "invalid" as const };
    }

    const [existing] = await tx.select().from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .for("update")
      .limit(1);

    if (existing && !existing.activo) {
      await tx.update(adminSignupTokens).set({ usedAt: now }).where(eq(adminSignupTokens.id, challenge.id));
      return { kind: "inactive" as const };
    }

    if (existing && !(await bcrypt.compare(parsed.data.password, existing.passwordHash))) {
      await recordFailedAttempt();
      return { kind: "password" as const };
    }

    if (!existing && parsed.data.password.length < 12) return { kind: "weak-password" as const };

    let account: typeof users.$inferSelect;
    if (existing) {
      if (existing.rol === "admin") {
        account = existing;
      } else {
        const [promoted] = await tx.update(users)
          .set({ rol: "admin", emailVerifiedAt: existing.emailVerifiedAt ?? now, updatedAt: now })
          .where(eq(users.id, existing.id))
          .returning();
        if (!promoted) return { kind: "invalid" as const };
        account = promoted;
        await tx.insert(workyAuditEvents).values({
          usuarioId: account.id,
          entidad: "account",
          entidadId: account.id,
          accion: "role_granted",
          estadoAnterior: existing.rol,
          estadoNuevo: "admin",
          metadata: { method: "verified_allowlisted_email" },
        });
      }
    } else {
      const [created] = await tx.insert(users).values({
        nombre: parsed.data.nombre.trim(),
        email,
        emailVerifiedAt: now,
        passwordHash: await bcrypt.hash(parsed.data.password, 12),
        rol: "admin",
      }).returning();
      if (!created) return { kind: "invalid" as const };
      account = created;
      await tx.insert(workyAuditEvents).values({
        usuarioId: account.id,
        entidad: "account",
        entidadId: account.id,
        accion: "admin_self_signup",
        estadoAnterior: null,
        estadoNuevo: "admin",
        metadata: { method: "verified_allowlisted_email" },
      });
    }

    await tx.update(adminSignupTokens).set({ usedAt: now }).where(eq(adminSignupTokens.id, challenge.id));
    return { kind: existing ? "authenticated" as const : "created" as const, user: account };
  });

  if (result.kind === "invalid") return res.status(400).json({ error: "El código no es válido o venció. Pedí uno nuevo e intentá otra vez." });
  if (result.kind === "password") return res.status(401).json({ error: "No se pudo completar. Si ya tenés una cuenta Worky, ingresá tu contraseña actual." });
  if (result.kind === "inactive") return res.status(409).json({ error: "No se pudo completar el alta. Contactá al equipo de Worky." });
  if (result.kind === "weak-password") return res.status(422).json({ error: "Para una cuenta nueva, elegí una contraseña de al menos 12 caracteres." });

  const response = CompleteAdminSignupResponse.parse({
    token: signToken(result.user.id),
    usuario: safeAuthenticatedUser(result.user),
  });
  return res.status(result.kind === "created" ? 201 : 200).json(response);
});

const TWO_FACTOR_CODE_TTL_MS = 10 * 60 * 1000;
const TWO_FACTOR_CODE_COOLDOWN_MS = 60 * 1000;
const TWO_FACTOR_MAX_ATTEMPTS = 5;
function twoFactorCodeHash(usuarioId: number, code: string) {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("La clave de sesión de Worky no está configurada.");
  return createHmac("sha256", secret).update(`worky-web-two-factor:${usuarioId}:${code}`).digest("hex");
}
function maskedEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
router.post("/auth/login", authLimit, async (req, res) => {
  const { email, password } = req.body ?? {};
  const [found] = await db.select().from(users).where(and(eq(users.email, String(email ?? "").trim().toLowerCase()), eq(users.activo, true))).limit(1);
  if (!found || typeof password !== "string" || !(await bcrypt.compare(password, found.passwordHash))) return res.status(401).json({ error: "Email o contraseña incorrectos." });
  if (!found.emailVerifiedAt) {
    return res.status(403).json({
      error: "Verificá tu email para ingresar.",
      code: "EMAIL_NOT_VERIFIED",
    });
  }
  if (found.twoFactorEnabled) {
    const now = new Date();
    const [recent] = await db.select({ id: webLoginChallenges.id }).from(webLoginChallenges)
      .where(and(
        eq(webLoginChallenges.usuarioId, found.id),
        isNull(webLoginChallenges.usedAt),
        gt(webLoginChallenges.expiresAt, now),
        gt(webLoginChallenges.createdAt, new Date(now.getTime() - TWO_FACTOR_CODE_COOLDOWN_MS)),
      )).orderBy(desc(webLoginChallenges.createdAt)).limit(1);
    if (recent) return res.status(202).json({ requiresTwoFactor: true, challengeId: recent.id, maskedEmail: maskedEmail(found.email) });

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await db.update(webLoginChallenges).set({ usedAt: now })
      .where(and(eq(webLoginChallenges.usuarioId, found.id), isNull(webLoginChallenges.usedAt)));
    const [challenge] = await db.insert(webLoginChallenges).values({
      usuarioId: found.id,
      codeHash: twoFactorCodeHash(found.id, code),
      expiresAt: new Date(now.getTime() + TWO_FACTOR_CODE_TTL_MS),
    }).returning({ id: webLoginChallenges.id });
    try {
      await sendGmailEmail({
        to: found.email,
        subject: "Código de seguridad para Worky",
        text: `Tu código de seguridad es ${code}. Vence en 10 minutos y solo puede usarse una vez. Si no iniciaste sesión, ignorá este correo.`,
        html: `<p>Tu código de seguridad para iniciar sesión en Worky es:</p><p style="font-size:28px;font-weight:700;letter-spacing:8px">${code}</p><p>Vence en 10 minutos y solo puede usarse una vez.</p><p>Si no iniciaste sesión, ignorá este correo.</p>`,
      });
    } catch {
      await db.update(webLoginChallenges).set({ usedAt: new Date() }).where(eq(webLoginChallenges.id, challenge.id));
      return res.status(503).json({ error: "No pudimos enviar el código. Intentá nuevamente más tarde." });
    }
    return res.status(202).json({ requiresTwoFactor: true, challengeId: challenge.id, maskedEmail: maskedEmail(found.email) });
  }
  return res.json({ token: signToken(found.id), usuario: safeAuthenticatedUser(found) });
});
router.post("/auth/login/verify", twoFactorLoginLimiter, async (req, res) => {
  const challengeId = Number(req.body?.challengeId);
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!Number.isInteger(challengeId) || challengeId < 1 || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "Ingresá el código de seguridad de 6 dígitos." });
  }
  const result = await db.transaction(async (tx) => {
    const [challenge] = await tx.select().from(webLoginChallenges).where(eq(webLoginChallenges.id, challengeId)).for("update").limit(1);
    const now = new Date();
    if (!challenge || challenge.usedAt || challenge.expiresAt.getTime() <= now.getTime() || challenge.attempts >= TWO_FACTOR_MAX_ATTEMPTS) {
      return { kind: "invalid" as const };
    }
    const [user] = await tx.select().from(users).where(eq(users.id, challenge.usuarioId)).limit(1);
    if (!user?.activo || !user.emailVerifiedAt || !user.twoFactorEnabled) return { kind: "invalid" as const };
    const expected = Buffer.from(challenge.codeHash, "hex");
    const actual = Buffer.from(twoFactorCodeHash(user.id, code), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const attempts = challenge.attempts + 1;
      await tx.update(webLoginChallenges).set({ attempts, ...(attempts >= TWO_FACTOR_MAX_ATTEMPTS ? { usedAt: now } : {}) })
        .where(eq(webLoginChallenges.id, challenge.id));
      return { kind: "invalid" as const };
    }
    await tx.update(webLoginChallenges).set({ usedAt: now }).where(eq(webLoginChallenges.id, challenge.id));
    return { kind: "verified" as const, user };
  });
  if (result.kind !== "verified") return res.status(400).json({ error: "El código no es válido o venció. Volvé a ingresar para pedir uno nuevo." });
  return res.json({ token: signToken(result.user.id), usuario: safeAuthenticatedUser(result.user) });
});

function mobileDeviceHash(deviceId: string) {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("La clave de sesión de Worky no está configurada.");
  return createHmac("sha256", secret).update(`worky-mobile-device:${deviceId}`).digest("hex");
}

function mobileLoginCodeHash(usuarioId: number, deviceHash: string, code: string) {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("La clave de sesión de Worky no está configurada.");
  return createHmac("sha256", secret).update(`worky-mobile-login:${usuarioId}:${deviceHash}:${code}`).digest("hex");
}

const MOBILE_LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
const MOBILE_LOGIN_CODE_COOLDOWN_MS = 60 * 1000;
const MOBILE_LOGIN_MAX_ATTEMPTS = 5;

router.post("/auth/mobile-login/request", mobileLoginLimiter, async (req, res) => {
  const body = req.body ?? {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 200 || !/^[a-zA-Z0-9_-]{32,128}$/.test(deviceId)) {
    return res.status(400).json({ error: "Revisá tu email, contraseña y dispositivo." });
  }
  const [found] = await db.select().from(users)
    .where(and(eq(users.email, email), eq(users.activo, true))).limit(1);
  if (!found || !(await bcrypt.compare(password, found.passwordHash))) {
    return res.status(401).json({ error: "Email o contraseña incorrectos." });
  }
  if (!found.emailVerifiedAt) {
    return res.status(403).json({ error: "Verificá tu email para ingresar.", code: "EMAIL_NOT_VERIFIED" });
  }
  const deviceHash = mobileDeviceHash(deviceId);
  const [trusted] = await db.select({ id: mobileTrustedDevices.id })
    .from(mobileTrustedDevices)
    .where(and(eq(mobileTrustedDevices.usuarioId, found.id), eq(mobileTrustedDevices.deviceHash, deviceHash)))
    .limit(1);
  if (trusted && !found.twoFactorEnabled) {
    await db.update(mobileTrustedDevices).set({ lastSeenAt: new Date() }).where(eq(mobileTrustedDevices.id, trusted.id));
    return res.json({ requiresCode: false, token: signToken(found.id), usuario: safeAuthenticatedUser(found) });
  }

  const now = new Date();
  const [recent] = await db.select({ id: mobileLoginChallenges.id })
    .from(mobileLoginChallenges)
    .where(and(
      eq(mobileLoginChallenges.usuarioId, found.id),
      eq(mobileLoginChallenges.deviceHash, deviceHash),
      isNull(mobileLoginChallenges.usedAt),
      gt(mobileLoginChallenges.expiresAt, now),
      gt(mobileLoginChallenges.createdAt, new Date(now.getTime() - MOBILE_LOGIN_CODE_COOLDOWN_MS)),
    ))
    .orderBy(desc(mobileLoginChallenges.createdAt))
    .limit(1);
  if (recent) return res.status(202).json({ requiresCode: true, challengeId: recent.id, message: "Te enviamos un código a tu email." });

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await db.update(mobileLoginChallenges).set({ usedAt: now })
    .where(and(
      eq(mobileLoginChallenges.usuarioId, found.id),
      eq(mobileLoginChallenges.deviceHash, deviceHash),
      isNull(mobileLoginChallenges.usedAt),
    ));
  const [challenge] = await db.insert(mobileLoginChallenges).values({
    usuarioId: found.id,
    deviceHash,
    codeHash: mobileLoginCodeHash(found.id, deviceHash, code),
    expiresAt: new Date(now.getTime() + MOBILE_LOGIN_CODE_TTL_MS),
  }).returning({ id: mobileLoginChallenges.id });
  try {
    await sendGmailEmail({
      to: email,
      subject: "Código para iniciar sesión en Worky",
      text: `Tu código de acceso es ${code}. Vence en 10 minutos y solo puede usarse una vez. Si no iniciaste sesión, ignorá este correo.`,
      html: `<p>Tu código para iniciar sesión en Worky es:</p><p style="font-size:28px;font-weight:700;letter-spacing:8px">${code}</p><p>Vence en 10 minutos y solo puede usarse una vez.</p><p>Si no iniciaste sesión, ignorá este correo.</p>`,
    });
  } catch {
    await db.update(mobileLoginChallenges).set({ usedAt: new Date() }).where(eq(mobileLoginChallenges.id, challenge.id));
    req.log.error({ code: "mobile_device_login_email_failed" }, "No se pudo enviar el código de inicio móvil");
    return res.status(503).json({ error: "No pudimos enviar el código. Intentá nuevamente más tarde." });
  }
  return res.status(202).json({ requiresCode: true, challengeId: challenge.id, message: "Te enviamos un código a tu email." });
});

router.post("/auth/mobile-login/confirm", mobileLoginLimiter, async (req, res) => {
  const body = req.body ?? {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  const challengeId = Number(body.challengeId);
  const code = typeof body.code === "string" ? body.code : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[a-zA-Z0-9_-]{32,128}$/.test(deviceId)
    || !Number.isInteger(challengeId) || challengeId < 1 || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "Ingresá el código de 6 dígitos recibido por email." });
  }
  const deviceHash = mobileDeviceHash(deviceId);
  const result = await db.transaction(async (tx) => {
    const [challenge] = await tx.select().from(mobileLoginChallenges)
      .where(eq(mobileLoginChallenges.id, challengeId)).for("update").limit(1);
    const now = new Date();
    if (!challenge || challenge.usedAt || challenge.expiresAt.getTime() <= now.getTime()
      || challenge.attempts >= MOBILE_LOGIN_MAX_ATTEMPTS || challenge.deviceHash !== deviceHash) return { kind: "invalid" as const };
    const [user] = await tx.select().from(users).where(eq(users.id, challenge.usuarioId)).limit(1);
    if (!user?.activo || !user.emailVerifiedAt || user.email.trim().toLowerCase() !== email) return { kind: "invalid" as const };
    const expected = Buffer.from(challenge.codeHash, "hex");
    const actual = Buffer.from(mobileLoginCodeHash(user.id, deviceHash, code), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const attempts = challenge.attempts + 1;
      await tx.update(mobileLoginChallenges).set({
        attempts,
        ...(attempts >= MOBILE_LOGIN_MAX_ATTEMPTS ? { usedAt: now } : {}),
      }).where(eq(mobileLoginChallenges.id, challenge.id));
      return { kind: "invalid" as const };
    }
    await tx.update(mobileLoginChallenges).set({ usedAt: now }).where(eq(mobileLoginChallenges.id, challenge.id));
    await tx.insert(mobileTrustedDevices).values({ usuarioId: user.id, deviceHash, lastSeenAt: now })
      .onConflictDoUpdate({
        target: [mobileTrustedDevices.usuarioId, mobileTrustedDevices.deviceHash],
        set: { lastSeenAt: now },
      });
    return { kind: "verified" as const, user };
  });
  if (result.kind !== "verified") return res.status(400).json({ error: "El código no es válido o venció. Solicitá uno nuevo al iniciar sesión." });
  return res.json({ token: signToken(result.user.id), usuario: safeAuthenticatedUser(result.user) });
});

router.get("/auth/mobile-devices", requireAuth, async (req, res) => {
  const devices = await db.select({
    deviceKey: mobileTrustedDevices.deviceKey,
    createdAt: mobileTrustedDevices.createdAt,
    lastSeenAt: mobileTrustedDevices.lastSeenAt,
  })
    .from(mobileTrustedDevices)
    .where(eq(mobileTrustedDevices.usuarioId, userId(req)))
    .orderBy(desc(mobileTrustedDevices.lastSeenAt));
  return res.json(devices);
});

router.delete("/auth/mobile-devices/:deviceKey", requireAuth, async (req, res) => {
  const deviceKey = Array.isArray(req.params.deviceKey) ? req.params.deviceKey[0] : req.params.deviceKey;
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(deviceKey)) {
    return res.status(404).json({ error: "No encontramos esa instalación confiable." });
  }
  const [revoked] = await db.delete(mobileTrustedDevices)
    .where(and(
      eq(mobileTrustedDevices.usuarioId, userId(req)),
      eq(mobileTrustedDevices.deviceKey, deviceKey),
    ))
    .returning({ deviceKey: mobileTrustedDevices.deviceKey });
  if (!revoked) return res.status(404).json({ error: "No encontramos esa instalación confiable." });
  return res.status(204).send();
});

router.patch("/admin/cuentas/rol", requireAuth, async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  const emailInput = typeof body.email === "string" ? body.email : "";
  const email = emailInput.trim().toLowerCase();
  const motivoInput = typeof body.motivo === "string" ? body.motivo : "";
  const motivo = motivoInput.trim();
  const hasUnexpectedFields = Object.keys(body).some((key) => key !== "email" && key !== "motivo");
  if (
    hasUnexpectedFields
    || emailInput.length > 320
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || motivoInput.length > 500
    || motivo.length < 5
  ) {
    res.status(400).json({ error: "Indicá un correo válido y un motivo de al menos 5 caracteres." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [actor] = await tx.select({ id: users.id, email: users.email }).from(users)
      .where(and(
        eq(users.id, userId(req)),
        eq(users.rol, "admin"),
        eq(users.activo, true),
        isNotNull(users.emailVerifiedAt),
      ))
      .for("update")
      .limit(1);
    if (!actor || actor.email.trim().toLowerCase() !== getPrimaryAdminEmail()) return { kind: "forbidden" as const };

    const [target] = await tx.select({
      id: users.id,
      rol: users.rol,
      activo: users.activo,
      emailVerifiedAt: users.emailVerifiedAt,
    }).from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .for("update")
      .limit(1);
    if (!target) return { kind: "not_found" as const };
    if (!target.activo) return { kind: "inactive" as const };
    if (!target.emailVerifiedAt) return { kind: "unverified" as const };
    if (target.rol === "admin") return { kind: "unchanged" as const };

    const [updated] = await tx.update(users)
      .set({ rol: "admin", updatedAt: new Date() })
      .where(and(
        eq(users.id, target.id),
        eq(users.activo, true),
        isNotNull(users.emailVerifiedAt),
        eq(users.rol, target.rol),
      ))
      .returning({ id: users.id });
    if (!updated) return { kind: "conflict" as const };

    await tx.insert(workyAuditEvents).values({
      usuarioId: actor.id,
      entidad: "account",
      entidadId: target.id,
      accion: "role_granted",
      estadoAnterior: target.rol,
      estadoNuevo: "admin",
      metadata: { motivo },
    });
    return { kind: "updated" as const };
  });

  if (result.kind === "forbidden") {
    res.status(403).json({ error: "Solo una persona administradora puede asignar este rol." });
    return;
  }
  if (result.kind === "not_found") {
    res.status(404).json({ error: "No existe una cuenta Worky con ese correo." });
    return;
  }
  if (result.kind === "inactive") {
    res.status(409).json({ error: "La cuenta está desactivada. Reactivala antes de asignar el rol admin." });
    return;
  }
  if (result.kind === "unverified") {
    res.status(409).json({ error: "La persona debe verificar su email antes de recibir el rol admin." });
    return;
  }
  if (result.kind === "conflict") {
    res.status(409).json({ error: "La cuenta cambió durante la asignación. Actualizá la lista e intentá nuevamente." });
    return;
  }
  res.json({ rol: "admin", changed: result.kind === "updated" });
});

router.post("/auth/password-recovery/request", passwordRecoveryLimiter, async (req, res) => {
  const parsed = RequestPasswordRecoveryBody.safeParse(req.body);
  if (!parsed.success || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.data?.email.trim() ?? "")) return res.status(400).json({ error: "Ingresá un email válido." });

  const email = parsed.data.email.trim().toLowerCase();
  try {
    await createPasswordRecovery(email, `${req.protocol}://${req.get("host")}`);
  } catch (error) {
    req.log.error(
      { purpose: "password_recovery", ...passwordRecoveryFailureDetails(error) },
      "No se pudo enviar el correo de recuperación",
    );
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
  return user ? res.json(safeAuthenticatedUser(user)) : res.status(401).json({ error: "Tu sesión ya no es válida." });
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
  const username = parsed.data.username === undefined
    ? undefined
    : typeof parsed.data.username === "string"
      ? parsed.data.username.trim().replace(/^@/, "").toLowerCase()
      : null;
  if (nombre !== undefined && nombre.length < 2) return res.status(400).json({ error: "Ingresá tu nombre completo." });
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Ingresá un email válido." });
  if (username !== undefined && username !== null && !/^[a-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: "El nombre de usuario debe tener entre 3 y 20 caracteres: letras, números o guion bajo." });
  }

  if (email !== undefined && email !== current.email) {
    if (!parsed.data.currentPassword || !(await bcrypt.compare(parsed.data.currentPassword, current.passwordHash))) {
      return res.status(401).json({ error: "Ingresá tu contraseña actual para cambiar el email." });
    }
    const [emailOwner] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), ne(users.id, current.id))).limit(1);
    if (emailOwner) return res.status(409).json({ error: "Ese email ya está asociado a otra cuenta." });
  }
  if (username !== undefined && username !== null && username !== current.username) {
    const [usernameOwner] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.username, username), ne(users.id, current.id))).limit(1);
    if (usernameOwner) return res.status(409).json({ error: "Ese nombre de usuario ya está en uso." });
  }

  const requestedLocation = parsed.data.ubicacion;
  const cleanLocationValue = (value: string | null | undefined) => {
    const clean = typeof value === "string" ? value.trim() : "";
    return clean || null;
  };
  const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (nombre !== undefined) updates.nombre = nombre;
  if (username !== undefined) updates.username = username;
  if (email !== undefined) {
    updates.email = email;
    if (email !== current.email) updates.emailVerifiedAt = null;
  }
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
    return res.json(safeAuthenticatedUser(updated));
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code
      ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505" && username !== undefined && username !== current.username) {
      const [usernameOwner] = username
        ? await db.select({ id: users.id }).from(users).where(and(eq(users.username, username), ne(users.id, current.id))).limit(1)
        : [null];
      if (usernameOwner) return res.status(409).json({ error: "Ese nombre de usuario ya está en uso." });
    }
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
    res.json(SwitchAccountRoleResponse.parse(safeAuthenticatedUser(current)));
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

  res.json(SwitchAccountRoleResponse.parse(safeAuthenticatedUser(updated)));
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
router.get("/auth/security/two-factor", requireAuth, async (req, res) => {
  const [account] = await db.select({ twoFactorEnabled: users.twoFactorEnabled }).from(users)
    .where(and(eq(users.id, userId(req)), eq(users.activo, true))).limit(1);
  if (!account) return res.status(401).json({ error: "Tu sesión ya no es válida." });
  return res.json({ enabled: account.twoFactorEnabled });
});
router.put("/auth/security/two-factor", requireAuth, reauthenticationLimiter, async (req, res) => {
  const parsed = UpdateTwoFactorSecurityBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Revisá la opción y tu contraseña actual." });
  const [account] = await db.select().from(users).where(and(eq(users.id, userId(req)), eq(users.activo, true))).limit(1);
  if (!account) return res.status(401).json({ error: "Tu sesión ya no es válida." });
  if (!(await bcrypt.compare(parsed.data.currentPassword, account.passwordHash))) {
    return res.status(401).json({ error: "La contraseña actual no es correcta." });
  }
  if (parsed.data.enabled && !account.emailVerifiedAt) {
    return res.status(400).json({ error: "Primero verificá tu email para activar el segundo paso." });
  }
  await db.update(users).set({ twoFactorEnabled: parsed.data.enabled, updatedAt: new Date() }).where(eq(users.id, account.id));
  return res.json({ enabled: parsed.data.enabled });
});
router.post("/auth/logout", requireAuth, (_req, res) => res.status(204).send());

router.patch("/auth/onboarding", requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const allowed = ["registration_started", "basic_info_completed", "professional_verification_pending", "onboarding_completed"] as const;
  if (!allowed.includes(body.estado)) return res.status(400).json({ error: "Estado de onboarding inválido." });
  const [profile] = await db.select().from(professionalProfiles).where(eq(professionalProfiles.usuarioId, userId(req))).limit(1);
  const [account] = await db.select({ rol: users.rol }).from(users).where(eq(users.id, userId(req))).limit(1);
  const pendingApproval = (profile || account?.rol === "profesional") &&
    (!profile?.habilitado || !profile.verificado || profile.estadoVerificacion !== "verified");
  const [updated] = await db.update(users).set({
    onboardingEstado: pendingApproval ? "professional_verification_pending" : body.estado,
    onboardingPaso: Number.isFinite(Number(body.paso)) ? Math.max(1, Math.min(3, Number(body.paso))) : undefined,
    onboardingRespuestas: body.respuestas && typeof body.respuestas === "object" ? body.respuestas : undefined,
    updatedAt: new Date(),
  }).where(eq(users.id, userId(req))).returning();
  return res.json(safeUser(updated));
});

router.get("/auth/client-verification", requireAuth, async (req, res) => {
  const [account] = await db.select({ rol: users.rol, activo: users.activo })
    .from(users).where(eq(users.id, userId(req))).limit(1);
  if (!account?.activo || account.rol !== "cliente") {
    return res.status(403).json({ error: "La verificación está disponible para cuentas de cliente." });
  }
  return res.json(await getClientIdentityStatus(userId(req)));
});

router.post("/auth/client-verification", requireAuth, clientVerificationSubmitLimiter, async (req, res) => {
  if (req.body?.consent !== true) {
    return res.status(400).json({ error: "Confirmá el consentimiento para enviar tus imágenes a revisión." });
  }
  const dniUploadId = Number(req.body?.dniUploadId);
  const selfieUploadId = Number(req.body?.selfieUploadId);
  if (!Number.isInteger(dniUploadId) || dniUploadId < 1 || !Number.isInteger(selfieUploadId) || selfieUploadId < 1 || dniUploadId === selfieUploadId) {
    return res.status(400).json({ error: "Seleccioná una foto del DNI y una selfie diferentes." });
  }

  const usuarioId = userId(req);
  const claim = await db.transaction(async (tx) => {
    const [account] = await tx.select({ rol: users.rol, activo: users.activo }).from(users)
      .where(eq(users.id, usuarioId)).for("update").limit(1);
    if (!account?.activo || account.rol !== "cliente") return { kind: "role" as const };

    const [current] = await tx.select().from(clientIdentityVerifications)
      .where(eq(clientIdentityVerifications.usuarioId, usuarioId)).for("update").limit(1);
    if (current?.estado === "pending_verification" || current?.estado === "deleting" || current?.estado === "verified") {
      return { kind: "conflict" as const };
    }

    const uploads = await tx.select().from(clientVerificationUploads)
      .where(and(
        eq(clientVerificationUploads.usuarioId, usuarioId),
        inArray(clientVerificationUploads.id, [dniUploadId, selfieUploadId]),
      )).for("update");
    const dni = uploads.find((upload) => upload.id === dniUploadId);
    const selfie = uploads.find((upload) => upload.id === selfieUploadId);
    if (!dni || !selfie || dni.tipo !== "dni" || selfie.tipo !== "selfie"
      || dni.estado !== "pending" || selfie.estado !== "pending"
      || !dni.objectPath || !selfie.objectPath
      || !isClientVerificationUploadPath(dni.objectPath, usuarioId)
      || !isClientVerificationUploadPath(selfie.objectPath, usuarioId)) {
      return { kind: "invalid-uploads" as const };
    }
    await tx.update(clientVerificationUploads).set({ estado: "processing", updatedAt: new Date() })
      .where(inArray(clientVerificationUploads.id, [dni.id, selfie.id]));
    return { kind: "claimed" as const, current, dni, selfie };
  });
  if (claim.kind === "role") return res.status(403).json({ error: "La verificación está disponible para cuentas de cliente." });
  if (claim.kind === "conflict") return res.status(409).json({ error: "Ya hay una verificación en curso o la cuenta ya está verificada." });
  if (claim.kind === "invalid-uploads") return res.status(400).json({ error: "Volvé a elegir las dos imágenes; una carga ya no está disponible." });

  try {
    const dni = await prepareClientVerificationImage(claim.dni.objectPath!, usuarioId);
    await db.update(clientVerificationUploads).set({
      reviewObjectPath: dni.objectPath, contentType: dni.contentType, sizeBytes: dni.sizeBytes, updatedAt: new Date(),
    }).where(and(eq(clientVerificationUploads.id, claim.dni.id), eq(clientVerificationUploads.estado, "processing")));
    const selfie = await prepareClientVerificationImage(claim.selfie.objectPath!, usuarioId);
    await db.update(clientVerificationUploads).set({
      reviewObjectPath: selfie.objectPath, contentType: selfie.contentType, sizeBytes: selfie.sizeBytes, updatedAt: new Date(),
    }).where(and(eq(clientVerificationUploads.id, claim.selfie.id), eq(clientVerificationUploads.estado, "processing")));

    const sourceDeleted = await Promise.all([
      deleteObject(claim.dni.objectPath!),
      deleteObject(claim.selfie.objectPath!),
    ]);
    if (sourceDeleted.some((deleted) => !deleted)) throw new Error("No pudimos completar el envío seguro. Volvé a intentar.");

    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [account] = await tx.select({ rol: users.rol, activo: users.activo }).from(users)
        .where(eq(users.id, usuarioId)).for("update").limit(1);
      if (!account?.activo || account.rol !== "cliente") return { kind: "role" as const };
      const [current] = await tx.select().from(clientIdentityVerifications)
        .where(eq(clientIdentityVerifications.usuarioId, usuarioId)).for("update").limit(1);
      if (current && current.id !== claim.current?.id) return { kind: "conflict" as const };
      if (current?.estado === "pending_verification" || current?.estado === "deleting" || current?.estado === "verified") {
        return { kind: "conflict" as const };
      }
      const values = {
        usuarioId,
        estado: "pending_verification" as const,
        dniObjectPath: dni.objectPath,
        selfieObjectPath: selfie.objectPath,
        pendingDecision: null,
        reasonCode: null,
        submittedAt: now,
        reviewerId: null,
        reviewedAt: null,
        updatedAt: now,
      };
      const [saved] = current
        ? await tx.update(clientIdentityVerifications).set(values).where(eq(clientIdentityVerifications.id, current.id)).returning()
        : await tx.insert(clientIdentityVerifications).values(values).returning();
      const updatedUploads = await tx.update(clientVerificationUploads).set({
        estado: "associated",
        updatedAt: now,
      }).where(and(
        eq(clientVerificationUploads.usuarioId, usuarioId),
        inArray(clientVerificationUploads.id, [claim.dni.id, claim.selfie.id]),
        eq(clientVerificationUploads.estado, "processing"),
      )).returning({ id: clientVerificationUploads.id });
      if (updatedUploads.length !== 2) throw new Error("Las imágenes de verificación ya no están disponibles.");
      await tx.update(clientVerificationUploads).set({
        reviewObjectPath: dni.objectPath,
        contentType: dni.contentType,
        sizeBytes: dni.sizeBytes,
        updatedAt: now,
      }).where(eq(clientVerificationUploads.id, claim.dni.id));
      await tx.update(clientVerificationUploads).set({
        reviewObjectPath: selfie.objectPath,
        contentType: selfie.contentType,
        sizeBytes: selfie.sizeBytes,
        updatedAt: now,
      }).where(eq(clientVerificationUploads.id, claim.selfie.id));
      await tx.update(users).set({ clientIdentityVerifiedAt: null, updatedAt: now }).where(eq(users.id, usuarioId));
      await tx.insert(workyAuditEvents).values({
        usuarioId,
        entidad: "client_identity_verification",
        entidadId: saved.id,
        accion: "client_identity_submitted",
        estadoAnterior: current?.estado ?? null,
        estadoNuevo: "pending_verification",
        metadata: { documents: ["dni", "selfie"] },
        createdAt: now,
      });
      return { kind: "submitted" as const };
    });
    if (result.kind !== "submitted") {
      await Promise.all([claim.dni.id, claim.selfie.id].map((id) => discardClientVerificationUpload(id)));
      return res.status(result.kind === "role" ? 403 : 409).json({
        error: result.kind === "role" ? "La verificación está disponible para cuentas de cliente." : "Ya hay una verificación en curso o la cuenta ya está verificada.",
      });
    }
    return res.status(201).json(await getClientIdentityStatus(usuarioId));
  } catch (error) {
    await Promise.all([claim.dni.id, claim.selfie.id].map((id) => discardClientVerificationUpload(id)));
    const message = error instanceof Error && [
      "La imagen debe cargarse desde esta cuenta.",
      "No encontramos una de las imágenes que enviaste.",
      "Cada imagen puede pesar hasta 10 MB.",
      "Usá una imagen JPG, PNG o WebP.",
      "No pudimos leer esta imagen. Probá con una foto JPG, PNG o WebP.",
      "La imagen preparada supera el límite de 10 MB.",
      "No pudimos preparar una imagen segura para la revisión.",
      "No pudimos confirmar la imagen preparada.",
      "No pudimos completar el envío seguro. Volvé a intentar.",
    ].includes(error.message) ? error.message : "No pudimos preparar las imágenes. Revisá los archivos e intentá otra vez.";
    req.log.warn({ usuarioId }, "No se pudo enviar una verificación de identidad de cliente");
    return res.status(400).json({ error: message });
  }
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

router.delete("/auth/profile-photo", requireAuth, async (req, res): Promise<void> => {
  const usuarioId = userId(req);
  const now = new Date();
  const removal = await db.transaction(async (tx) => {
    const [current] = await tx.select({ fotoObjectPath: users.fotoObjectPath }).from(users)
      .where(and(eq(users.id, usuarioId), eq(users.activo, true)))
      .for("update")
      .limit(1);
    if (!current) return { missingAccount: true as const, objectPath: null, uploadId: null };

    const objectPath = current.fotoObjectPath;
    if (!objectPath) return { missingAccount: false as const, objectPath: null, uploadId: null };

    let uploadId: number | null = null;
    if (isProfilePhotoRenderedPath(objectPath, usuarioId)) {
      const [upload] = await tx.select({ id: profilePhotoUploads.id }).from(profilePhotoUploads)
        .where(and(
          eq(profilePhotoUploads.usuarioId, usuarioId),
          eq(profilePhotoUploads.objectPath, objectPath),
        ))
        .for("update")
        .limit(1);
      if (upload) {
        await tx.update(profilePhotoUploads).set({
          estado: "deleting",
          updatedAt: now,
        }).where(eq(profilePhotoUploads.id, upload.id));
        uploadId = upload.id;
      } else {
        const [tracked] = await tx.insert(profilePhotoUploads).values({
          usuarioId,
          objectPath,
          variante: "rendered",
          estado: "deleting",
        }).returning({ id: profilePhotoUploads.id });
        uploadId = tracked?.id ?? null;
      }
    }

    await tx.update(users).set({ fotoObjectPath: null, updatedAt: now })
      .where(and(eq(users.id, usuarioId), eq(users.fotoObjectPath, objectPath)));
    return { missingAccount: false as const, objectPath, uploadId };
  });
  if (removal.missingAccount) {
    res.status(401).json({ error: "Tu sesión ya no es válida." });
    return;
  }

  if (removal.objectPath && removal.uploadId) {
    try {
      if (await deleteObject(removal.objectPath)) {
        await db.update(profilePhotoUploads).set({
          estado: "deleted",
          deletedAt: now,
          updatedAt: now,
        }).where(and(
          eq(profilePhotoUploads.id, removal.uploadId),
          eq(profilePhotoUploads.estado, "deleting"),
        ));
      } else {
        req.log.warn({ usuarioId, objectPath: removal.objectPath }, "No se pudo confirmar la eliminación de la foto; queda pendiente de limpieza");
      }
    } catch (error) {
      req.log.warn({ err: error, usuarioId, objectPath: removal.objectPath }, "No se pudo eliminar la foto; queda pendiente de limpieza");
    }
  }

  res.json({ fotoObjectPath: null });
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
  const tipos = ["dni_frente", "dni_dorso", "antecedentes_penales", "matricula"] as const;
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
  await db.update(professionalProfiles).set({
    estadoVerificacion: "pending_verification",
    verificado: false,
    habilitado: false,
    updatedAt: new Date(),
  }).where(eq(professionalProfiles.usuarioId, userId(req)));
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
  const documents = await db.select({ tipo: professionalVerificationDocuments.tipo, estado: professionalVerificationDocuments.estado }).from(professionalVerificationDocuments).where(eq(professionalVerificationDocuments.profesionalId, current.profesionalId));
  const profileStatus = partnerVerificationStatus(documents);
  await db.update(professionalProfiles).set(profileStatus === "verified"
    ? { estadoVerificacion: profileStatus, verificado: true, updatedAt: new Date() }
    : { estadoVerificacion: profileStatus, verificado: false, habilitado: false, updatedAt: new Date() })
    .where(eq(professionalProfiles.usuarioId, current.profesionalId));
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
  if (services.some((item: any) => !String(item.oficio || "").trim() || !resolveWorkyCategory(item.categoria))) {
    return res.status(400).json({ error: "Cada oficio debe tener un nombre y una categoría válida." });
  }
  const normalizedServices = services.map((item: any) => ({
    ...item,
    categoria: resolveWorkyCategory(item.categoria)!.category,
  }));
  await db.delete(professionalServices).where(eq(professionalServices.profesionalId, userId(req)));
  const saved = await db.insert(professionalServices).values(normalizedServices.map((item: any) => ({
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
  const category = resolveWorkyCategory(req.query.categoria)?.category;
  const search = String(req.query.search ?? "").trim();
  const rankingActive = await isPaidJobRecommendationRankingActive();
  const visibilityRankSql = sql<number>`(
    select case when count(*) >= 2 then 1 else 0 end
    from (
      select overdue_job.id
      from worky_jobs overdue_job
      where overdue_job.profesional_id = ${professionalProfiles.usuarioId}
        and overdue_job.estado = 'trabajo_realizado'
        and overdue_job.payment_method = 'mercado_pago'
        and exists (
          select 1
          from worky_payments overdue_payment
          where overdue_payment.changa_id = overdue_job.id
            and overdue_payment.provider = 'mercado_pago'
            and overdue_payment.provider_preference_id is not null
            and overdue_payment.created_at >= now() - interval '30 days'
            and overdue_payment.created_at <= now() - interval '24 hours'
            and overdue_payment.created_at = (
              select max(retry_payment.created_at)
              from worky_payments retry_payment
              where retry_payment.changa_id = overdue_job.id
                and retry_payment.provider = 'mercado_pago'
                and retry_payment.provider_preference_id is not null
            )
            and overdue_payment.status in ('pendiente', 'iniciado', 'rechazado')
        )
    ) overdue_jobs
  )`;
  const pendingVisitCommissionSql = sql<number>`(
    select coalesce(sum(balance_row.commission_amount), 0)
    from worky_visit_payments balance_row
    where balance_row.profesional_id = ${professionalProfiles.usuarioId}
      and balance_row.status = 'cash_commission_due'
  )`;
  const recentIncidentCount = confirmedIncidentCountSql(professionalProfiles.usuarioId);
  const extendedVisibilityRankSql = rankingActive
    ? sql<number>`(
      ${visibilityRankSql}
      + case when ${pendingVisitCommissionSql} > 0 then ${1} else 0 end
      + case when ${recentIncidentCount} >= ${RECOMMENDATION_RISK_REVIEW_THRESHOLD} then ${1} else 0 end
    )`
    : visibilityRankSql;
  const filters = and(
    eq(users.activo, true),
    eq(users.rol, "profesional"),
    isNotNull(users.emailVerifiedAt),
    eq(professionalProfiles.verificado, true),
    eq(professionalProfiles.habilitado, true),
    eq(professionalProfiles.estadoVerificacion, "verified"),
    category ? eq(professionalProfiles.categoria, category) : undefined,
    search ? or(ilike(users.nombre, `%${search}%`), ilike(professionalProfiles.oficio, `%${search}%`), ilike(sql<string>`${professionalProfiles.categoria}::text`, `%${search}%`)) : undefined,
  );
  const ratingOrder = desc(sql`coalesce((select avg(r.rating) from worky_reviews r where r.profesional_id = ${professionalProfiles.usuarioId}), 0)`);
  const completedJobsOrder = desc(sql`(select count(*) from worky_jobs j where j.profesional_id = ${professionalProfiles.usuarioId} and j.estado = 'finalizada')`);
  const rows = rankingActive
    ? await db.select({ profile: professionalProfiles, user: users, visibilityRank: extendedVisibilityRankSql })
      .from(professionalProfiles)
      .innerJoin(users, eq(users.id, professionalProfiles.usuarioId))
      .where(filters)
      .orderBy(
        asc(extendedVisibilityRankSql),
        desc(professionalProfiles.verificado),
        ratingOrder,
        completedJobsOrder,
        desc(professionalProfiles.experienciaAnios),
        desc(sql`(select count(*) from worky_recommendations r where r.profesional_id = ${professionalProfiles.usuarioId} and r.visibilidad = 'publica')`),
      )
      .limit(limit)
      .offset((page - 1) * limit)
    : await db.select({ profile: professionalProfiles, user: users, visibilityRank: visibilityRankSql })
      .from(professionalProfiles)
      .innerJoin(users, eq(users.id, professionalProfiles.usuarioId))
      .where(filters)
      .orderBy(
        asc(visibilityRankSql),
        desc(professionalProfiles.verificado),
        ratingOrder,
        completedJobsOrder,
      )
      .limit(limit)
      .offset((page - 1) * limit);
  const viewerLongitude = numberValue(req.query.longitud);
  const viewerLatitude = numberValue(req.query.latitud);
  const viewerCoordinates = Number.isFinite(viewerLongitude) && Number.isFinite(viewerLatitude)
    && Math.abs(viewerLongitude) <= 180 && Math.abs(viewerLatitude) <= 90
    ? [viewerLongitude, viewerLatitude] as [number, number]
    : null;
  return res.json(await Promise.all(rows.map(async (row) => {
    const professionalCoordinates = coordinatesOf(row.profile.ubicacionFija);
    return {
      ...(await publicProfileView(row)),
      visibilityRank: rankingActive ? Number(row.visibilityRank) : Number(row.visibilityRank) >= 1 ? 1 : 0,
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
router.get("/partner/disponibilidad", requireAuth, requireApprovedProfessional, async (req, res) => {
  const rows = await db.select().from(professionalAvailability).where(eq(professionalAvailability.profesionalId, userId(req))).orderBy(asc(professionalAvailability.diaSemana), asc(professionalAvailability.desde));
  return res.json(rows);
});
router.put("/partner/disponibilidad", requireAuth, requireApprovedProfessional, async (req, res) => {
  const entries = Array.isArray(req.body) ? req.body : req.body?.disponibilidad;
  if (!Array.isArray(entries)) return res.status(400).json({ error: "Enviá una lista de horarios." });
  await db.delete(professionalAvailability).where(eq(professionalAvailability.profesionalId, userId(req)));
  const valid = entries.filter((item) => Number.isInteger(item?.diaSemana) && item.diaSemana >= 0 && item.diaSemana <= 6 && /^\d{2}:\d{2}$/.test(item.desde) && /^\d{2}:\d{2}$/.test(item.hasta)).map((item) => ({ profesionalId: userId(req), diaSemana: item.diaSemana, desde: item.desde, hasta: item.hasta, estado: item.estado === "pausado" ? "pausado" as const : "disponible" as const, zona: item.zona ? String(item.zona) : null }));
  if (valid.length) await db.insert(professionalAvailability).values(valid);
  return res.json(await db.select().from(professionalAvailability).where(eq(professionalAvailability.profesionalId, userId(req))));
});
router.get("/partner/activos", requireAuth, requireApprovedProfessional, async (req, res) => {
  const assets = await db.select().from(professionalAssets).where(eq(professionalAssets.profesionalId, userId(req))).orderBy(desc(professionalAssets.createdAt));
  return res.json(assets.map((asset) => ({ ...asset, url: `/api/v1/storage/objects${asset.objectPath}` })));
});
router.post("/partner/activos", requireAuth, requireApprovedProfessional, async (req, res) => {
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

router.get("/partner/dashboard", requireAuth, requireApprovedProfessional, async (req, res) => {
  const assigned = await jobsFor(and(eq(jobs.profesionalId, userId(req)), sql`${jobs.estado} in ('aceptada', 'en_curso', 'trabajo_realizado', 'finalizada')`));
  const upcoming = await db.select().from(bookings).where(and(eq(bookings.profesionalId, userId(req)), sql`${bookings.estado} in ('solicitada', 'confirmada', 'en_curso')`)).orderBy(asc(bookings.empiezaAt));
  const unread = await db.select().from(workyNotifications).where(and(eq(workyNotifications.usuarioId, userId(req)), eq(workyNotifications.leida, false))).orderBy(desc(workyNotifications.createdAt));
  const assetRows = await db.select().from(professionalAssets).where(eq(professionalAssets.profesionalId, userId(req)));
  return res.json({ trabajos: await serializeJobs(assigned), calendario: upcoming, archivos: assetRows, notificacionesNoLeidas: unread.length });
});

async function notificationsWithJobContext(
  rows: (typeof workyNotifications.$inferSelect)[],
  authenticatedUserId: number,
) {
  const changaIdByNotification = new Map<number, number>();
  for (const row of rows) {
    const changaId = row.changaId ?? changaIdFromNotificationHref(row.href);
    if (changaId) changaIdByNotification.set(row.id, changaId);
  }
  const changaIds = [...new Set(changaIdByNotification.values())];
  if (changaIds.length === 0) {
    return rows.map((row) => ({ ...row, changaId: null, jobContext: null }));
  }

  const jobRows = await db.select({
    id: jobs.id,
    clientId: jobs.clienteId,
    professionalId: jobs.profesionalId,
    category: jobs.categoria,
    price: jobs.precioOfrecido,
    paymentMethod: jobs.paymentMethod,
    cashConfirmedByClientAt: jobs.cashConfirmedByClientAt,
    cashConfirmedByProfessionalAt: jobs.cashConfirmedByProfessionalAt,
    workerName: users.nombre,
    workerTrade: professionalProfiles.oficio,
  }).from(jobs)
    .leftJoin(users, eq(users.id, jobs.profesionalId))
    .leftJoin(professionalProfiles, eq(professionalProfiles.usuarioId, jobs.profesionalId))
    .where(and(
      inArray(jobs.id, changaIds),
      or(eq(jobs.clienteId, authenticatedUserId), eq(jobs.profesionalId, authenticatedUserId)),
    ));
  if (jobRows.length === 0) {
    return rows.map((row) => ({ ...row, changaId: null, jobContext: null }));
  }

  const accessibleIds = jobRows.map((job) => job.id);
  const paymentRows = await db.select({
    id: payments.id,
    changaId: payments.changaId,
    amount: payments.amount,
    status: payments.status,
    updatedAt: payments.updatedAt,
  }).from(payments)
    .where(inArray(payments.changaId, accessibleIds))
    .orderBy(desc(payments.updatedAt), desc(payments.id));
  const latestPaymentByJob = new Map<number, (typeof paymentRows)[number]>();
  for (const payment of paymentRows) {
    if (!latestPaymentByJob.has(payment.changaId)) latestPaymentByJob.set(payment.changaId, payment);
  }
  const jobById = new Map(jobRows.map((job) => [job.id, job]));

  return rows.map((row) => {
    const changaId = changaIdByNotification.get(row.id);
    const job = changaId ? jobById.get(changaId) : undefined;
    if (!job) return { ...row, changaId: null, jobContext: null };

    const payment = latestPaymentByJob.get(job.id);
    const cashConfirmationTimes = [job.cashConfirmedByClientAt, job.cashConfirmedByProfessionalAt]
      .filter((value): value is Date => value instanceof Date);
    const cashConfirmedAt = cashConfirmationTimes.length
      ? new Date(Math.max(...cashConfirmationTimes.map((value) => value.getTime())))
      : null;
    const paymentStatus = payment?.status ?? (
      job.paymentMethod === "efectivo" && cashConfirmationTimes.length === 2 ? "aprobado" : "pendiente"
    );
    const paymentConfirmedAt = paymentStatus === "aprobado"
      ? (job.paymentMethod === "efectivo" ? cashConfirmedAt ?? payment?.updatedAt ?? null : payment?.updatedAt ?? null)
      : null;

    return {
      ...row,
      changaId: job.id,
      jobContext: {
        changaId: job.id,
        price: Number(payment?.amount ?? job.price),
        paymentMethod: job.paymentMethod,
        paymentStatus,
        paymentConfirmedAt,
        workerName: job.workerName,
        trade: job.workerTrade?.trim() || job.category,
      },
    };
  });
}

router.get("/notificaciones", requireAuth, async (req, res) => {
  const rows = await db.select().from(workyNotifications).where(eq(workyNotifications.usuarioId, userId(req))).orderBy(desc(workyNotifications.createdAt)).limit(50);
  return res.json({
    items: await notificationsWithJobContext(rows, userId(req)),
    unread: rows.filter((item) => !item.leida).length,
  });
});

router.get("/notificaciones/stream", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  let usuarioId: number;
  try {
    usuarioId = verifyToken(token);
  } catch {
    res.status(401).end();
    return;
  }
  const [account] = await db.select({ active: users.activo }).from(users).where(eq(users.id, usuarioId)).limit(1);
  if (!account?.active) {
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
router.get("/partner/saldo-visitas", requireAuth, requireApprovedProfessional, async (req, res) => {
  await releaseMaturedVisitBalances();
  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId(req))).for("update").limit(1);
    await settleAvailablePartnerCommissions(tx, userId(req), new Date());
  });
  const rows = await db.select().from(visitPayments).where(eq(visitPayments.profesionalId, userId(req))).orderBy(desc(visitPayments.createdAt));
  const jobCommissionRows = await db.select().from(cashJobCommissions)
    .where(eq(cashJobCommissions.profesionalId, userId(req)))
    .orderBy(desc(cashJobCommissions.createdAt));
  const availableBeforeCommission = rows.filter((row) => row.status === "available").reduce((total, row) => total + Number(row.partnerAmount), 0);
  const pendingAmount = rows.filter((row) => row.status === "pending_release").reduce((total, row) => total + Number(row.partnerAmount), 0);
  const cashCommissionDue = rows.filter((row) => row.status === "cash_commission_due").reduce((total, row) => total + Number(row.commissionAmount), 0);
  const cashJobCommissionDue = jobCommissionRows
    .filter((row) => row.status === "due")
    .reduce((total, row) => total + Number(row.remainingAmount), 0);
  return res.json({
    availableAmount: Math.round(availableBeforeCommission * 100) / 100,
    pendingAmount: Math.round(pendingAmount * 100) / 100,
    cashCommissionDue: Math.round(cashCommissionDue * 100) / 100,
    cashJobCommissionDue: Math.round(cashJobCommissionDue * 100) / 100,
    items: rows.map((row) => ({
      bookingId: row.bookingId,
      amount: Number(row.amount),
      commissionAmount: Number(row.commissionAmount),
      partnerAmount: Number(row.partnerAmount),
      method: row.method,
      status: row.status,
      releaseAt: row.releaseAt,
      createdAt: row.createdAt,
    })),
    cashJobCommissions: jobCommissionRows.map((row) => ({
      changaId: row.changaId,
      commissionRate: Number(row.commissionRate),
      amount: Number(row.amount),
      remainingAmount: Number(row.remainingAmount),
      status: row.status,
      createdAt: row.createdAt,
      settledAt: row.settledAt,
    })),
  });
});
router.get("/partner/recommendation-ranking", requireAuth, requireApprovedProfessional, async (req, res) => {
  const active = await isPaidJobRecommendationRankingActive();
  if (!active) return res.json({ active: false });

  const professionalId = userId(req);
  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, professionalId)).for("update").limit(1);
    await settleAvailableVisitCommissions(tx, professionalId, new Date());
  });
  const balanceRows = await db.select({ commissionAmount: visitPayments.commissionAmount })
    .from(visitPayments)
    .where(and(eq(visitPayments.profesionalId, professionalId), eq(visitPayments.status, "cash_commission_due")));
  const cashVisitCommissionDue = balanceRows.reduce((total, row) => total + Number(row.commissionAmount), 0);
  const incidents = await recentConfirmedActivityIncidents(professionalId);
  const visibilityAdjusted = calculateVisibilityRank({
    currentVisibilityRank: 0,
    rankingActive: true,
    cashVisitCommissionDue,
    confirmedRecentIncidents: incidents.length,
  }) > 0;

  return res.json({
    active: true,
    windowDays: RECOMMENDATION_RISK_WINDOW_DAYS,
    incidentThreshold: RECOMMENDATION_RISK_REVIEW_THRESHOLD,
    confirmedRecentIncidentCount: incidents.length,
    cashVisitCommissionDue: Math.round(cashVisitCommissionDue * 100) / 100,
    visibilityAdjusted,
    incidents: incidents.map((incident) => ({
      jobId: incident.jobId,
      category: incident.category,
      reviewedAt: incident.reviewedAt,
    })),
  });
});
router.get("/partner/pagos", requireAuth, async (req, res) => {
  const rows = await db.select().from(payments).where(eq(payments.clienteId, userId(req))).orderBy(desc(payments.createdAt));
  return res.json(rows);
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
  await db.insert(workyNotifications).values({ usuarioId: created.profesionalId, changaId: created.changaId, tipo: "booking", titulo: "Nueva solicitud de reserva", detalle: "Tenés una reserva pendiente de revisar.", href: `/chat/${created.changaId}` });
  return res.status(201).json(created);
});
router.get("/profesionales/:id", async (req, res) => {
  const requestedId = numberValue(req.params.id);
  const publicProfileConditions = and(
    eq(users.activo, true),
    eq(users.rol, "profesional"),
    isNotNull(users.emailVerifiedAt),
    eq(professionalProfiles.verificado, true),
    eq(professionalProfiles.habilitado, true),
    eq(professionalProfiles.estadoVerificacion, "verified"),
  );
  const [rowByProfileId] = await db.select({ profile: professionalProfiles, user: users }).from(professionalProfiles).innerJoin(users, eq(users.id, professionalProfiles.usuarioId)).where(and(eq(professionalProfiles.id, requestedId), publicProfileConditions)).limit(1);
  const [rowByUserId] = rowByProfileId ? [] : await db.select({ profile: professionalProfiles, user: users }).from(professionalProfiles).innerJoin(users, eq(users.id, professionalProfiles.usuarioId)).where(and(eq(professionalProfiles.usuarioId, requestedId), publicProfileConditions)).limit(1);
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
  const category = resolveWorkyCategory(body.categoria);
  if (!category) return res.status(400).json({ error: "Indicá un oficio válido." });
  const fixedLocation = normalizeFixedLocation(body.ubicacionFija);
  if (!fixedLocation) return res.status(400).json({ error: "Indicá la dirección exacta del taller y la ciudad para mostrar en tu perfil." });
  const [created] = await db.insert(professionalProfiles).values({ usuarioId: userId(req), oficio: String(body.oficio), categoria: category.category, ubicacionFija: fixedLocation, precioReferencia: String(numberValue(body.precioReferencia) || 0), skills: Array.isArray(body.skills) ? body.skills.map(String) : [], about: body.about || null, experienciaAnios: Math.max(0, numberValue(body.experienciaAnios) || 0), disponible: true, habilitado: false }).returning();
  const [owner] = await db.select().from(users).where(eq(users.id, userId(req))).limit(1);
  return res.status(201).json(await publicProfileView({ profile: created, user: owner }));
});
router.put(["/perfil-profesional/mio", "/partner-profile/me"], requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const fields = missing({ oficio: body.oficio, categoria: body.categoria, precioReferencia: body.precioReferencia });
  if (fields.length) return res.status(400).json({ error: "Completá los datos obligatorios del perfil.", campos_faltantes: fields });
  const category = resolveWorkyCategory(body.categoria);
  if (!category) return res.status(400).json({ error: "Indicá un oficio válido." });
  const [existing] = await myProfile(req);
  const fixedLocation = normalizeFixedLocation(body.ubicacionFija, existing?.profile.ubicacionFija);
  if (!fixedLocation) return res.status(400).json({ error: "Indicá la dirección exacta del taller y la ciudad para mostrar en tu perfil." });
  const values = { usuarioId: userId(req), oficio: String(body.oficio), categoria: category.category, ubicacionFija: fixedLocation, matriculaHabilitante: body.matriculaHabilitante || null, skills: Array.isArray(body.skills) ? body.skills.map(String) : [], about: body.about || null, experienciaAnios: Math.max(0, numberValue(body.experienciaAnios) || 0), precioReferencia: String(numberValue(body.precioReferencia)), disponible: body.disponible !== false, updatedAt: new Date() };
  const [saved] = await db.insert(professionalProfiles).values({ ...values, habilitado: false }).onConflictDoUpdate({ target: professionalProfiles.usuarioId, set: values }).returning();
  const [owner] = await db.select().from(users).where(eq(users.id, userId(req))).limit(1);
  return res.json(await publicProfileView({ profile: saved, user: owner }));
});

router.get("/profesionales/:id/reputacion", async (req, res) => {
  const professionalId = numberValue(req.params.id);
  const visibleProfile = and(
    eq(professionalProfiles.verificado, true),
    eq(professionalProfiles.habilitado, true),
  );
  const [profileById] = await db.select().from(professionalProfiles).where(and(eq(professionalProfiles.id, professionalId), visibleProfile)).limit(1);
  const [profileByUserId] = profileById ? [] : await db.select().from(professionalProfiles).where(and(eq(professionalProfiles.usuarioId, professionalId), visibleProfile)).limit(1);
  const profile = profileById || profileByUserId;
  if (!profile) return res.status(404).json({ error: "Profesional no encontrado." });
  const [owner] = await db.select({ active: users.activo }).from(users).where(eq(users.id, profile.usuarioId)).limit(1);
  if (!owner?.active) return res.status(404).json({ error: "Profesional no encontrado." });
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
  if (job.trabajoRealizadoAt && job.paymentMethod === "mercado_pago") {
    const [approvedPayment] = await db.select({ id: payments.id }).from(payments)
      .where(and(eq(payments.changaId, changaId), eq(payments.provider, "mercado_pago"), eq(payments.status, "aprobado")))
      .limit(1);
    if (!approvedPayment) return res.status(409).json({ error: "La reseña se habilita cuando Mercado Pago confirma el pago." });
  }
  if (job.trabajoRealizadoAt && job.paymentMethod === "efectivo" && (!job.cashConfirmedByClientAt || !job.cashConfirmedByProfessionalAt)) {
    return res.status(409).json({ error: "La reseña se habilita cuando ambas partes confirman el pago en efectivo." });
  }
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
  const category = resolveWorkyCategory(body.categoria);
  if (!category) return res.status(400).json({ error: "Escribí un oficio para el trabajo." });
  const requestedProfessionalId = body.profesionalId == null ? null : numberValue(body.profesionalId);
  if (requestedProfessionalId !== null && !Number.isInteger(requestedProfessionalId)) return res.status(400).json({ error: "El Partner seleccionado no es válido." });
  const paymentMethod = body.paymentMethod === undefined ? "mercado_pago" : body.paymentMethod;
  if (paymentMethod !== "mercado_pago" && paymentMethod !== "efectivo") return res.status(400).json({ error: "Elegí Mercado Pago o efectivo como medio de pago." });
  const [targetProfile] = requestedProfessionalId === null ? [null] : await db.select({ usuarioId: professionalProfiles.usuarioId }).from(professionalProfiles)
    .innerJoin(users, eq(users.id, professionalProfiles.usuarioId))
    .where(and(eq(professionalProfiles.usuarioId, requestedProfessionalId), eq(professionalProfiles.habilitado, true), eq(professionalProfiles.verificado, true), eq(professionalProfiles.estadoVerificacion, "verified"), eq(users.activo, true), isNotNull(users.emailVerifiedAt))).limit(1);
  if (requestedProfessionalId !== null && !targetProfile) return res.status(409).json({ error: "El Partner seleccionado todavía no está habilitado." });
  const [created] = await db.insert(jobs).values({
    clienteId: userId(req),
    profesionalId: targetProfile?.usuarioId ?? null,
    ubicacion: { direccionTexto: String(body.ubicacion.direccionTexto), coordinates: body.ubicacion.coordinates ?? null },
    categoria: category.category,
    precioOfrecido: String(numberValue(body.precioOfrecido)),
    paymentMethod,
    detalle: category.preserveOriginalTrade
      ? [`Oficio solicitado: ${category.original}`, String(body.detalle ?? "").trim()].filter(Boolean).join("\n\n")
      : body.detalle || null,
    estado: targetProfile ? "aceptada" : "publicada",
  }).returning();
  const [client] = await db.select().from(users).where(eq(users.id, created.clienteId)).limit(1);
  const [professional] = created.profesionalId ? await db.select().from(users).where(eq(users.id, created.profesionalId)).limit(1) : [null];
  await notify(created.profesionalId, "Nueva solicitud de changa", "Un cliente te eligió para una nueva changa.", `/chat/${created.id}`);
  return res.status(201).json(jobView({ job: created, client, professional }));
});

router.get("/pagos", requireAuth, async (req, res) => {
  const rows = await db.select().from(payments)
    .where(and(eq(payments.clienteId, userId(req)), eq(payments.provider, "mercado_pago")))
    .orderBy(desc(payments.createdAt), desc(payments.id));
  return res.json(rows.map((payment) => ({
    id: payment.id,
    changaId: payment.changaId,
    amount: Number(payment.amount),
    currency: payment.currency,
    status: payment.status,
    checkoutUrl: payment.checkoutUrl,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  })));
});

const mercadoPagoReturnLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

router.get("/pagos/retorno", mercadoPagoReturnLimiter, async (req, res) => {
  const rawChangaId = req.query.changaId;
  const changaId = typeof rawChangaId === "string" ? Number(rawChangaId) : Number.NaN;
  if (!Number.isSafeInteger(changaId) || changaId < 1) {
    return res.status(400).send("No pudimos identificar el trabajo.");
  }

  let origin: string;
  try {
    origin = getWorkyPublicOrigin();
  } catch {
    return res.status(503).send("Worky no está disponible para volver del pago.");
  }

  const rawPaymentId = req.query.payment_id ?? req.query.collection_id;
  const providerPaymentId = typeof rawPaymentId === "string" ? rawPaymentId : "";
  if (/^\d{1,30}$/.test(providerPaymentId)) {
    const { accessToken } = mercadoPagoCredentials();
    if (accessToken) {
      try {
        const providerPayment = await getMercadoPagoPayment({ paymentId: providerPaymentId, accessToken });
        const nextStatus = mapMercadoPagoPaymentStatus(providerPayment.status);
        if (String(providerPayment.id) === providerPaymentId && nextStatus) {
          const outcome = await reconcileMercadoPagoJobPayment(providerPayment, nextStatus, changaId);
          if (outcome.kind === "updated" && outcome.transitionedToApproved) {
            await notify(outcome.clientId, "Pago confirmado", outcome.jobFinalized
              ? "Mercado Pago confirmó el pago. El trabajo quedó finalizado y ya podés dejar una reseña."
              : "Mercado Pago confirmó el cobro de tu trabajo.", `/jobs`, outcome.changaId);
            await notify(outcome.partnerId, outcome.jobFinalized ? "Trabajo pagado" : "Pago confirmado", outcome.jobFinalized
              ? "El cliente pagó a Worky y el trabajo quedó finalizado."
              : "Mercado Pago confirmó el pago del trabajo.", `/jobs`, outcome.changaId);
          }
        }
      } catch (error) {
        logger.warn({ error }, "Mercado Pago return verification failed; webhook reconciliation remains available");
      }
    }
  }

  res.set("Cache-Control", "no-store");
  const userAgent = req.get("user-agent") ?? "";
  if (/(Android|iPhone|iPad|iPod)/i.test(userAgent)) {
    return res.redirect(302, `worky-mobile://jobs?jobId=${changaId}`);
  }
  return res.redirect(302, `${origin}/jobs?payment=return&changaId=${changaId}`);
});

router.post("/pagos", requireAuth, async (req, res) => {
  const parsedBody = CreatePaymentCheckoutBody.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: "Indicá un trabajo válido." });
  const changaId = Number(parsedBody.data.changaId);
  if (!Number.isInteger(changaId) || changaId < 1) return res.status(400).json({ error: "Indicá un trabajo válido." });
  const { accessToken } = mercadoPagoCredentials();
  if (!accessToken) return res.status(503).json({ error: "El pago todavía no está configurado." });
  const isProduction = process.env.NODE_ENV === "production";
  let origin: string;
  try {
    origin = getWorkyPublicOrigin();
  } catch {
    return res.status(503).json({ error: "La dirección pública de Worky no está configurada para recibir pagos." });
  }

  const reservation = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, changaId)).for("update").limit(1);
    if (!job) return { kind: "not-found" as const };
    if (job.clienteId !== userId(req)) return { kind: "forbidden" as const };
      if (job.estado !== "trabajo_realizado" || !job.profesionalId || job.paymentMethod !== "mercado_pago") return { kind: "not-ready" as const };

    const [paid] = await tx.select().from(payments)
      .where(and(eq(payments.changaId, job.id), eq(payments.clienteId, job.clienteId), eq(payments.status, "aprobado")))
      .orderBy(desc(payments.createdAt), desc(payments.id)).limit(1);
    if (paid) return { kind: "already-paid" as const };

    const [active] = await tx.select().from(payments)
      .where(and(eq(payments.changaId, job.id), eq(payments.clienteId, job.clienteId), eq(payments.status, "iniciado")))
      .orderBy(desc(payments.createdAt), desc(payments.id)).limit(1);
    if (active) {
      if (active.checkoutUrl && active.providerPreferenceId) return { kind: "existing" as const, payment: active };
      return { kind: "create" as const, payment: active, created: false };
    }

    const amount = Math.round(Number(job.precioOfrecido) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return { kind: "invalid-amount" as const };
    const [created] = await tx.insert(payments).values({
      changaId: job.id,
      clienteId: job.clienteId,
      amount: amount.toFixed(2),
      currency: "ARS",
      status: "iniciado",
      provider: "mercado_pago",
    }).returning();
    if (!created) return { kind: "not-found" as const };
    return { kind: "create" as const, payment: created, created: true };
  });

  if (reservation.kind === "not-found") return res.status(404).json({ error: "Trabajo no encontrado." });
  if (reservation.kind === "forbidden") return res.status(403).json({ error: "Solo quien publicó el trabajo puede pagarlo." });
  if (reservation.kind === "not-ready") return res.status(409).json({ error: "El pago de Mercado Pago estará disponible cuando el profesional marque el trabajo como realizado." });
  if (reservation.kind === "already-paid") return res.status(409).json({ error: "Este trabajo ya tiene un pago aprobado." });
  if (reservation.kind === "invalid-amount") return res.status(409).json({ error: "El trabajo no tiene un presupuesto válido para cobrar." });
  if (reservation.kind === "existing") {
    return res.json({
      id: reservation.payment.id,
      changaId: reservation.payment.changaId,
      amount: Number(reservation.payment.amount),
      currency: reservation.payment.currency,
      status: reservation.payment.status,
      checkoutUrl: reservation.payment.checkoutUrl,
    });
  }

  const payment = reservation.payment;
  try {
    const preference = await createMercadoPagoPreference({
      accessToken,
      idempotencyKey: `worky-payment-${payment.id}`,
      request: {
        items: [{
          id: `worky-job-${payment.changaId}`,
          title: `Trabajo Worky · ${payment.changaId}`,
          quantity: 1,
          currency_id: "ARS",
          unit_price: Number(payment.amount),
        }],
        external_reference: String(payment.id),
        notification_url: `${origin}/api/v1/webhooks/mercadopago`,
        back_urls: {
          success: `${origin}/api/v1/pagos/retorno?changaId=${payment.changaId}`,
          failure: `${origin}/api/v1/pagos/retorno?changaId=${payment.changaId}`,
          pending: `${origin}/api/v1/pagos/retorno?changaId=${payment.changaId}`,
        },
        auto_return: "approved",
      },
    });
    const checkoutUrl = isProduction ? preference.init_point : preference.sandbox_init_point;
    const checkoutHost = checkoutUrl ? new URL(checkoutUrl).hostname : "";
    const isMercadoPagoHost = /^([a-z0-9-]+\.)*mercadopago\.(?:com(?:\.[a-z]{2})?|[a-z]{2})$/i.test(checkoutHost);
    const hasSandboxHost = checkoutHost.split(".").includes("sandbox");
    if (!checkoutUrl || !isMercadoPagoHost || (isProduction ? hasSandboxHost : !hasSandboxHost)) {
      throw new Error("Mercado Pago no devolvió una URL de pago segura.");
    }
    const [updated] = await db.update(payments).set({
      status: "iniciado",
      providerPreferenceId: preference.id,
      checkoutUrl,
      updatedAt: new Date(),
    }).where(eq(payments.id, payment.id)).returning();
    if (!updated) return res.status(500).json({ error: "No pudimos guardar el pago." });
    await db.insert(workyAuditEvents).values({
      usuarioId: userId(req),
      entidad: "payment",
      entidadId: updated.id,
      accion: "checkout_started",
      estadoAnterior: reservation.created ? null : "iniciado",
      estadoNuevo: "iniciado",
      metadata: { provider: "mercado_pago", preferenceId: preference.id },
    });
    return res.status(reservation.created ? 201 : 200).json({
      id: updated.id,
      changaId: updated.changaId,
      amount: Number(updated.amount),
      currency: updated.currency,
      status: updated.status,
      checkoutUrl: updated.checkoutUrl,
    });
  } catch {
    await db.update(payments).set({ status: "rechazado", updatedAt: new Date() }).where(eq(payments.id, payment.id));
    return res.status(502).json({ error: "No pudimos iniciar el pago. Probá nuevamente más tarde." });
  }
});

type WorkyMercadoPagoStatus = "aprobado" | "reembolsado" | "rechazado" | "iniciado";

function mapMercadoPagoPaymentStatus(status: string): WorkyMercadoPagoStatus | null {
  if (status === "approved") return "aprobado";
  if (status === "refunded" || status === "charged_back") return "reembolsado";
  if (status === "rejected" || status === "cancelled") return "rechazado";
  if (status === "pending" || status === "in_process" || status === "authorized") return "iniciado";
  return null;
}

async function reconcileMercadoPagoJobPayment(
  providerPayment: MercadoPagoPayment,
  nextStatus: WorkyMercadoPagoStatus,
  expectedChangaId?: number,
) {
  const paymentId = Number(providerPayment.external_reference);
  if (!Number.isInteger(paymentId) || paymentId < 1) return { kind: "ignored" as const };

  return db.transaction(async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update").limit(1);
    if (!payment || payment.provider !== "mercado_pago" || payment.currency !== "ARS") return { kind: "ignored" as const };
    if (expectedChangaId !== undefined && payment.changaId !== expectedChangaId) return { kind: "ignored" as const };
    if (!payment.providerPreferenceId || payment.providerPreferenceId !== providerPayment.preference_id) return { kind: "ignored" as const };
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, payment.changaId)).for("update").limit(1);
    if (!job || job.clienteId !== payment.clienteId || job.paymentMethod !== "mercado_pago") return { kind: "ignored" as const };
    const providerAmount = Number(providerPayment.transaction_amount);
    if (!Number.isFinite(providerAmount) || Math.abs(Number(payment.amount) - providerAmount) > 0.01 || providerPayment.currency_id !== "ARS") {
      return { kind: "ignored" as const };
    }
    if (payment.status === "reembolsado" || (payment.status === "aprobado" && nextStatus !== "reembolsado")) {
      return { kind: "unchanged" as const };
    }
    if (payment.status === nextStatus && payment.providerPaymentId === String(providerPayment.id)) {
      return { kind: "unchanged" as const };
    }

    const transitionedToApproved = payment.status !== "aprobado" && nextStatus === "aprobado";
    const shouldFinalizeJob = transitionedToApproved && job.estado === "trabajo_realizado";
    await tx.update(payments).set({
      status: nextStatus,
      providerPaymentId: String(providerPayment.id),
      updatedAt: new Date(),
    }).where(eq(payments.id, payment.id));
    if (shouldFinalizeJob) {
      await tx.update(jobs).set({ estado: "finalizada", updatedAt: new Date() })
        .where(and(eq(jobs.id, job.id), eq(jobs.estado, "trabajo_realizado"), eq(jobs.paymentMethod, "mercado_pago")));
      await tx.insert(workyAuditEvents).values({
        entidad: "job",
        entidadId: job.id,
        accion: "job_finalized_after_payment",
        estadoAnterior: "trabajo_realizado",
        estadoNuevo: "finalizada",
        metadata: { paymentId: payment.id, provider: "mercado_pago" },
      });
    }
    await tx.insert(workyAuditEvents).values({
      entidad: "payment",
      entidadId: payment.id,
      accion: "provider_status_updated",
      estadoAnterior: payment.status,
      estadoNuevo: nextStatus,
      metadata: { provider: "mercado_pago", providerPaymentId: String(providerPayment.id) },
    });
    return {
      kind: "updated" as const,
      transitionedToApproved,
      clientId: payment.clienteId,
      changaId: payment.changaId,
      partnerId: job.profesionalId,
      jobFinalized: shouldFinalizeJob,
    };
  });
}

router.post("/webhooks/mercadopago", async (req, res) => {
  const eventType = String(req.query.type ?? req.body?.type ?? "");
  const action = String(req.body?.action ?? "");
  if (eventType !== "payment" && !action.startsWith("payment.")) return res.sendStatus(200);

  const { webhookSecret } = mercadoPagoCredentials();
  if (!webhookSecret) return res.status(503).json({ error: "Webhook de pagos no configurado." });
  const dataId = String(req.query["data.id"] ?? req.body?.data?.id ?? "");
  const requestId = req.header("x-request-id");
  const signature = req.header("x-signature");
  if (!/^\d{1,30}$/.test(dataId) || !verifyMercadoPagoWebhookSignature({ signature, requestId, dataId, secret: webhookSecret })) {
    return res.status(401).json({ error: "Firma de notificación inválida." });
  }

  const { accessToken } = mercadoPagoCredentials();
  if (!accessToken) return res.status(503).json({ error: "El proveedor de pagos no está configurado." });
  let providerPayment;
  try {
    providerPayment = await getMercadoPagoPayment({ paymentId: dataId, accessToken });
  } catch {
    return res.status(502).json({ error: "No pudimos verificar el pago con Mercado Pago." });
  }

  if (String(providerPayment.id) !== dataId) return res.status(400).json({ error: "La referencia del pago no coincide." });
  const nextStatus = mapMercadoPagoPaymentStatus(providerPayment.status);
  if (!nextStatus) return res.sendStatus(200);

  const visitReference = /^visit_payment:(\d+)$/.exec(String(providerPayment.external_reference ?? ""));
  if (visitReference) {
    const visitPaymentId = Number(visitReference[1]);
    const visitOutcome = await db.transaction(async (tx) => {
      const [finance] = await tx.select().from(visitPayments).where(eq(visitPayments.id, visitPaymentId)).for("update").limit(1);
      if (!finance || finance.method !== "mercado_pago" || finance.providerPreferenceId !== providerPayment.preference_id) return { kind: "ignored" as const };
      const [bookingContext] = await tx.select({ changaId: bookings.changaId }).from(bookings)
        .where(eq(bookings.id, finance.bookingId)).limit(1);
      const providerAmount = Number(providerPayment.transaction_amount);
      if (!Number.isFinite(providerAmount) || Math.abs(Number(finance.amount) - providerAmount) > 0.01 || providerPayment.currency_id !== "ARS") return { kind: "ignored" as const };
      if (finance.status === "refunded" || (finance.status === "available" && nextStatus !== "reembolsado")) return { kind: "unchanged" as const };
      if (nextStatus === "reembolsado") {
        await tx.update(visitPayments).set({ status: "refunded", providerPaymentId: String(providerPayment.id), updatedAt: new Date() }).where(eq(visitPayments.id, finance.id));
        await tx.insert(workyAuditEvents).values({
          entidad: "visit_payment", entidadId: finance.id, accion: "provider_refund_confirmed",
          estadoAnterior: finance.status, estadoNuevo: "refunded",
          metadata: { bookingId: finance.bookingId, provider: "mercado_pago", providerPaymentId: String(providerPayment.id) },
        });
        return { kind: "refunded" as const, clientId: finance.clienteId, partnerId: finance.profesionalId, changaId: bookingContext?.changaId };
      }
      if (nextStatus === "rechazado") {
        if (finance.status !== "checkout_started") return { kind: "unchanged" as const };
        await tx.update(visitPayments).set({ status: "payment_failed", providerPaymentId: String(providerPayment.id), updatedAt: new Date() }).where(eq(visitPayments.id, finance.id));
        await tx.insert(workyAuditEvents).values({
          entidad: "visit_payment", entidadId: finance.id, accion: "provider_payment_rejected",
          estadoAnterior: finance.status, estadoNuevo: "payment_failed", metadata: { bookingId: finance.bookingId },
        });
        return { kind: "rejected" as const, clientId: finance.clienteId, changaId: bookingContext?.changaId };
      }
      if (nextStatus !== "aprobado" || finance.status !== "checkout_started") return { kind: "unchanged" as const };
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, finance.bookingId)).for("update").limit(1);
      if (!booking || booking.clienteId !== finance.clienteId || booking.profesionalId !== finance.profesionalId || booking.estado !== "solicitada") return { kind: "ignored" as const };
      await tx.update(visitPayments).set({
        status: "pending_release", providerPaymentId: String(providerPayment.id), updatedAt: new Date(),
      }).where(eq(visitPayments.id, finance.id));
      const [confirmed] = await tx.update(bookings).set({ estado: "confirmada", updatedAt: new Date() }).where(eq(bookings.id, booking.id)).returning();
      await tx.insert(workyAuditEvents).values({
        entidad: "visit_payment", entidadId: finance.id, accion: "provider_payment_confirmed",
        estadoAnterior: finance.status, estadoNuevo: "pending_release",
        metadata: { bookingId: booking.id, provider: "mercado_pago", providerPaymentId: String(providerPayment.id) },
      });
      await tx.insert(workyAuditEvents).values({
        entidad: "appointment_attempt", entidadId: booking.changaId, accion: "aceptar",
        estadoAnterior: booking.estado, estadoNuevo: "exitoso",
        metadata: { appointmentId: booking.id, empiezaAt: booking.empiezaAt.toISOString(), paymentMethod: "mercado_pago" },
      });
      return { kind: "approved" as const, clientId: finance.clienteId, partnerId: finance.profesionalId, booking: confirmed };
    });
    if (visitOutcome.kind === "approved") {
      await notify(visitOutcome.clientId, "Pago de visita confirmado", "Mercado Pago confirmó el pago y la visita quedó aceptada. El 85% del Partner queda retenido hasta que se complete la visita.", `/chat/${visitOutcome.booking.changaId}`);
      await notify(visitOutcome.partnerId, "Visita aceptada y pagada", "El cliente pagó la visita. Registrá tu llegada; tu 85% quedará retenido hasta la confirmación o el cierre de 24 horas.", `/chat/${visitOutcome.booking.changaId}`);
    } else if (visitOutcome.kind === "rejected") {
      if (visitOutcome.changaId) await notify(visitOutcome.clientId, "No se confirmó el pago de la visita", "Podés volver a aceptar la propuesta e intentar el pago otra vez.", `/chat/${visitOutcome.changaId}`);
    } else if (visitOutcome.kind === "refunded") {
      if (visitOutcome.changaId) {
        await notify(visitOutcome.clientId, "Pago de visita reembolsado", "Mercado Pago confirmó la devolución del pago.", `/chat/${visitOutcome.changaId}`);
        await notify(visitOutcome.partnerId, "Pago de visita reembolsado", "Mercado Pago confirmó una devolución para esta visita.", `/chat/${visitOutcome.changaId}`);
      }
    }
    return res.sendStatus(200);
  }

  const outcome = await reconcileMercadoPagoJobPayment(providerPayment, nextStatus);

  if (outcome.kind === "updated" && outcome.transitionedToApproved) {
    await notify(outcome.clientId, "Pago confirmado", outcome.jobFinalized
      ? "Mercado Pago confirmó el pago. El trabajo quedó finalizado y ya podés dejar una reseña."
      : "Mercado Pago confirmó el cobro de tu trabajo.", `/jobs`, outcome.changaId);
    await notify(outcome.partnerId, outcome.jobFinalized ? "Trabajo pagado" : "Pago confirmado", outcome.jobFinalized
      ? "El cliente pagó a Worky y el trabajo quedó finalizado."
      : "Mercado Pago confirmó el pago del trabajo.", `/jobs`, outcome.changaId);
  }
  return res.sendStatus(200);
});

async function jobsFor(where?: SQL) {
  return db.select({ job: jobs, client: users }).from(jobs).innerJoin(users, eq(users.id, jobs.clienteId)).where(where).orderBy(desc(jobs.createdAt));
}
async function serializeJobs(rows: Awaited<ReturnType<typeof jobsFor>>, includeClientVerification = false) {
  return Promise.all(rows.map(async (row) => {
    const [professional] = row.job.profesionalId ? await db.select().from(users).where(eq(users.id, row.job.profesionalId)).limit(1) : [null];
    const [review] = await db.select({ id: reviews.id }).from(reviews).where(and(
      eq(reviews.changaId, row.job.id),
      eq(reviews.clienteId, row.job.clienteId),
    )).limit(1);
    return { ...jobView({ ...row, professional }, includeClientVerification), calificada: Boolean(review) };
  }));
}
router.get("/trabajos/mias", requireAuth, async (req, res) => res.json(await serializeJobs(await jobsFor(eq(jobs.clienteId, userId(req))))));
router.get("/trabajos/disponibles", requireAuth, requireApprovedProfessional, async (req, res) => {
  const [profile] = await db.select().from(professionalProfiles).where(eq(professionalProfiles.usuarioId, userId(req))).limit(1);
  if (!profile) return res.json([]);
  const page = Math.max(1, numberValue(req.query.page) || 1); const limit = Math.min(50, Math.max(1, numberValue(req.query.limit) || 12));
  const rows = await jobsFor(and(eq(jobs.estado, "publicada"), eq(jobs.categoria, profile.categoria)));
  return res.json(await serializeJobs(rows.slice((page - 1) * limit, page * limit), true));
});
router.get("/trabajos/asignadas", requireAuth, async (req, res) => res.json(await serializeJobs(await jobsFor(and(eq(jobs.profesionalId, userId(req)), sql`${jobs.estado} in ('aceptada', 'en_curso', 'trabajo_realizado', 'finalizada')`)), true)));
router.patch("/trabajos/:id/aceptar", requireAuth, requireApprovedProfessional, async (req, res) => {
  const [updated] = await db.update(jobs).set({ profesionalId: userId(req), estado: "aceptada", updatedAt: new Date() }).where(and(eq(jobs.id, numberValue(req.params.id)), eq(jobs.estado, "publicada"), sql`${jobs.profesionalId} IS NULL`)).returning();
  if (!updated) return res.status(409).json({ error: "Esta changa ya no está disponible." });
  const [client] = await db.select().from(users).where(eq(users.id, updated.clienteId)).limit(1);
  const [professional] = await db.select().from(users).where(eq(users.id, userId(req))).limit(1);
  await db.update(professionalProfiles).set({ cantidadChangas: sql`${professionalProfiles.cantidadChangas} + 1`, updatedAt: new Date() }).where(eq(professionalProfiles.usuarioId, userId(req)));
  return res.json(jobView({ job: updated, client, professional }, true));
});
router.patch("/trabajos/:id", requireAuth, async (req, res) => {
  const parsed = UpdateJobBody.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "Revisá los datos de la changa." });
  const [current] = await db.select().from(jobs).where(eq(jobs.id, numberValue(req.params.id))).limit(1);
  if (!current) return res.status(404).json({ error: "Changa no encontrada." });
  const actorId = userId(req);
  const editsContent = ["ubicacion", "categoria", "precioOfrecido", "detalle", "profesionalId", "paymentMethod"].some((key) => Object.prototype.hasOwnProperty.call(parsed.data, key));
  let updated: typeof jobs.$inferSelect;
  if (editsContent) {
    if (current.clienteId !== actorId) return res.status(403).json({ error: "Solo quien publicó la changa puede editar sus datos." });
    if (current.estado !== "publicada" || current.profesionalId !== null || parsed.data.estado !== undefined) {
      return res.status(409).json({ error: "Solo se pueden editar changas publicadas que todavía no fueron aceptadas. Cancelalas para conservar su historial." });
    }
    const changes: Partial<typeof jobs.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.categoria !== undefined) {
      const category = resolveWorkyCategory(parsed.data.categoria);
      if (!category) return res.status(400).json({ error: "Elegí un oficio válido." });
      changes.categoria = category.category;
    }
    if (parsed.data.ubicacion !== undefined) {
      const currentLocation = current.ubicacion as Record<string, unknown> | null;
      const nextAddress = String(parsed.data.ubicacion.direccionTexto ?? "").trim();
      if (nextAddress.length < 3) return res.status(400).json({ error: "Ingresá una dirección o zona válida." });
      changes.ubicacion = {
        ...(currentLocation ?? {}),
        ...parsed.data.ubicacion,
        direccionTexto: nextAddress,
      };
    }
    if (parsed.data.precioOfrecido !== undefined) changes.precioOfrecido = String(parsed.data.precioOfrecido);
    if (parsed.data.detalle !== undefined) changes.detalle = parsed.data.detalle?.trim() || null;
    if (parsed.data.paymentMethod !== undefined) changes.paymentMethod = parsed.data.paymentMethod;
    if (parsed.data.profesionalId !== undefined) {
      const requestedProfessionalId = parsed.data.profesionalId;
      if (requestedProfessionalId === null) {
        changes.profesionalId = null;
      } else {
        const category = (changes.categoria ?? current.categoria) as typeof current.categoria;
        const [target] = await db.select({ usuarioId: professionalProfiles.usuarioId, categoria: professionalProfiles.categoria }).from(professionalProfiles)
          .innerJoin(users, eq(users.id, professionalProfiles.usuarioId))
          .where(and(
            eq(professionalProfiles.usuarioId, requestedProfessionalId),
            eq(professionalProfiles.habilitado, true),
            eq(professionalProfiles.verificado, true),
            eq(professionalProfiles.estadoVerificacion, "verified"),
            eq(users.activo, true),
            isNotNull(users.emailVerifiedAt),
          )).limit(1);
        const [extraService] = target && target.categoria !== category
          ? await db.select({ id: professionalServices.id }).from(professionalServices)
            .where(and(eq(professionalServices.profesionalId, requestedProfessionalId), eq(professionalServices.categoria, category))).limit(1)
          : [null];
        if (!target || (target.categoria !== category && !extraService)) return res.status(409).json({ error: "Ese profesional no está habilitado para este oficio." });
        changes.profesionalId = target.usuarioId;
        changes.estado = "aceptada";
      }
    }
    [updated] = await db.update(jobs).set(changes).where(and(eq(jobs.id, current.id), eq(jobs.estado, "publicada"), isNull(jobs.profesionalId))).returning();
    if (!updated) return res.status(409).json({ error: "La changa cambió mientras la editabas. Actualizá la pantalla e intentá otra vez." });
  } else {
    const next = parsed.data.estado;
    if (!next || !statuses.includes(next)) return res.status(400).json({ error: "El estado de la changa no es válido." });
    if (current.clienteId !== actorId && current.profesionalId !== actorId) return res.status(403).json({ error: "No podés modificar esta changa." });
    const allowed: Record<string, string[]> = {
      publicada: ["cancelada"],
      aceptada: ["en_curso", "cancelada"],
      en_curso: ["trabajo_realizado", "cancelada"],
      trabajo_realizado: [],
      finalizada: [],
      cancelada: [],
    };
    if (!allowed[current.estado].includes(next)
      || (current.clienteId !== actorId && next === "cancelada" && current.profesionalId !== actorId)
      || (next === "en_curso" && current.profesionalId !== actorId)
      || (next === "trabajo_realizado" && current.profesionalId !== actorId)) {
      return res.status(409).json({ error: "Esta transición no está permitida. Solo el profesional asignado puede iniciar o marcar el trabajo como realizado." });
    }
    const now = new Date();
    [updated] = await db.update(jobs).set({
      estado: next,
      ...(next === "trabajo_realizado" ? { trabajoRealizadoAt: now } : {}),
      updatedAt: now,
    }).where(and(eq(jobs.id, current.id), eq(jobs.estado, current.estado))).returning();
    if (!updated) return res.status(409).json({ error: "La changa cambió mientras actualizabas el estado. Actualizá la pantalla e intentá otra vez." });
  }
  const [client] = await db.select().from(users).where(eq(users.id, updated.clienteId)).limit(1);
  const [professional] = updated.profesionalId ? await db.select().from(users).where(eq(users.id, updated.profesionalId)).limit(1) : [null];
  if (!editsContent) {
    await db.insert(workyAuditEvents).values({ usuarioId: actorId, entidad: "job", entidadId: updated.id, accion: "status_changed", estadoAnterior: current.estado, estadoNuevo: updated.estado, metadata: {} });
    if (updated.estado === "trabajo_realizado") {
      const paymentCopy = updated.paymentMethod === "mercado_pago"
        ? "El trabajo está marcado como realizado. Confirmá el pago en Mercado Pago para finalizar y habilitar la reseña."
        : "El trabajo está marcado como realizado. Cliente y profesional deben confirmar el pago en efectivo para finalizarlo.";
      await notify(updated.clienteId, "Trabajo realizado · pago pendiente", paymentCopy, `/jobs`, updated.id);
      await notify(updated.profesionalId, "Trabajo realizado", updated.paymentMethod === "mercado_pago"
        ? "Avisamos al cliente que el pago está pendiente."
        : "Confirmá el pago en efectivo y esperá la confirmación del cliente.", `/jobs`, updated.id);
    } else {
      await notify(actorId === updated.clienteId ? updated.profesionalId : updated.clienteId, "La changa cambió de estado", `Ahora está: ${updated.estado.replace("_", " ")}.`, `/chat/${updated.id}`);
    }
  } else if (current.profesionalId !== updated.profesionalId && updated.profesionalId) {
    await db.insert(workyAuditEvents).values({
      usuarioId: actorId,
      entidad: "job",
      entidadId: updated.id,
      accion: "professional_assigned_by_client",
      estadoAnterior: current.estado,
      estadoNuevo: updated.estado,
      metadata: { professionalId: updated.profesionalId },
    });
    await notify(updated.profesionalId, "Te asignaron una changa", "Un cliente te eligió para un trabajo.", `/chat/${updated.id}`);
  }
  return res.json(jobView({ job: updated, client, professional }, actorId === updated.profesionalId));
});
router.post("/trabajos/:id/confirmar-pago-efectivo", requireAuth, async (req, res) => {
  const changaId = numberValue(req.params.id);
  if (!Number.isInteger(changaId) || changaId < 1) return res.status(400).json({ error: "Indicá un trabajo válido." });
  const actorId = userId(req);
  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(jobs).where(eq(jobs.id, changaId)).for("update").limit(1);
    if (!current) return { kind: "not-found" as const };
    if (current.clienteId !== actorId && current.profesionalId !== actorId) return { kind: "forbidden" as const };
    const cashAlreadyFinalized = current.estado === "finalizada"
      && current.paymentMethod === "efectivo"
      && current.cashConfirmedByClientAt
      && current.cashConfirmedByProfessionalAt;
    if (cashAlreadyFinalized) return { kind: "ok" as const, job: current, changed: false, finalized: true };
    if (current.estado !== "trabajo_realizado" || current.paymentMethod !== "efectivo" || !current.profesionalId) {
      return { kind: "not-ready" as const };
    }

    const now = new Date();
    const cashConfirmedByClientAt = current.clienteId === actorId
      ? current.cashConfirmedByClientAt ?? now
      : current.cashConfirmedByClientAt;
    const cashConfirmedByProfessionalAt = current.profesionalId === actorId
      ? current.cashConfirmedByProfessionalAt ?? now
      : current.cashConfirmedByProfessionalAt;
    const finalized = Boolean(cashConfirmedByClientAt && cashConfirmedByProfessionalAt);
    const [updated] = await tx.update(jobs).set({
      cashConfirmedByClientAt,
      cashConfirmedByProfessionalAt,
      ...(finalized ? { estado: "finalizada" as const } : {}),
      updatedAt: now,
    }).where(eq(jobs.id, current.id)).returning();
    if (!updated) return { kind: "not-found" as const };

    const [cashPayment] = await tx.select().from(payments)
      .where(and(eq(payments.changaId, current.id), eq(payments.provider, "efectivo")))
      .for("update").limit(1);
    if (cashPayment) {
      await tx.update(payments).set({ status: finalized ? "aprobado" : "pendiente", updatedAt: now })
        .where(eq(payments.id, cashPayment.id));
    } else {
      await tx.insert(payments).values({
        changaId: current.id,
        clienteId: current.clienteId,
        amount: Number(current.precioOfrecido).toFixed(2),
        currency: "ARS",
        provider: "efectivo",
        status: finalized ? "aprobado" : "pendiente",
      });
    }
    if (finalized) {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, current.profesionalId)).for("update").limit(1);
      const jobAmountCents = Math.max(0, Math.round(Number(current.precioOfrecido) * 100));
      const commissionCents = Math.round(jobAmountCents * CASH_JOB_COMMISSION_RATE_PERCENT / 100);
      if (commissionCents > 0) {
        const commissionAmount = (commissionCents / 100).toFixed(2);
        const [commission] = await tx.insert(cashJobCommissions).values({
          changaId: current.id,
          profesionalId: current.profesionalId,
          commissionRate: CASH_JOB_COMMISSION_RATE_PERCENT.toFixed(2),
          amount: commissionAmount,
          remainingAmount: commissionAmount,
        }).onConflictDoNothing({ target: cashJobCommissions.changaId }).returning();
        if (commission) {
          await tx.insert(workyAuditEvents).values({
            usuarioId: actorId,
            entidad: "cash_job_commission",
            entidadId: commission.id,
            accion: "cash_job_commission_created",
            estadoNuevo: "due",
            metadata: { changaId: current.id, commissionRate: CASH_JOB_COMMISSION_RATE_PERCENT, amount: commissionAmount },
          });
        }
        await settleAvailablePartnerCommissions(tx, current.profesionalId, now);
      }
    }
    await tx.insert(workyAuditEvents).values({
      usuarioId: actorId,
      entidad: "job",
      entidadId: current.id,
      accion: "cash_payment_confirmed",
      estadoAnterior: current.estado,
      estadoNuevo: updated.estado,
      metadata: { confirmedBy: current.clienteId === actorId ? "cliente" : "profesional", finalized },
    });
    return { kind: "ok" as const, job: updated, changed: true, finalized };
  });

  if (outcome.kind === "not-found") return res.status(404).json({ error: "Trabajo no encontrado." });
  if (outcome.kind === "forbidden") return res.status(403).json({ error: "Solo el cliente y el profesional asignado pueden confirmar el pago." });
  if (outcome.kind === "not-ready") return res.status(409).json({ error: "El trabajo no está esperando confirmaciones de pago en efectivo." });

  if (outcome.changed) {
    if (outcome.finalized) {
      await notify(outcome.job.clienteId, "Pago en efectivo confirmado", "Ambas partes confirmaron el pago. El trabajo quedó finalizado y ya se puede reseñar.", `/jobs`, outcome.job.id);
      await notify(outcome.job.profesionalId, "Pago en efectivo confirmado", `Ambas partes confirmaron el pago y el trabajo quedó finalizado. Worky registró la comisión del ${CASH_JOB_COMMISSION_RATE_PERCENT}%; revisá su estado en tu saldo.`, `/jobs`, outcome.job.id);
    } else {
      const otherRole = actorId === outcome.job.clienteId ? "el profesional" : "el cliente";
      await notify(outcome.job.clienteId, "Confirmación de pago en efectivo", `Registramos una confirmación. Falta que ${otherRole} confirme para finalizar el trabajo.`, `/jobs`, outcome.job.id);
      await notify(outcome.job.profesionalId, "Confirmación de pago en efectivo", `Registramos una confirmación. Falta que ${otherRole} confirme para finalizar el trabajo.`, `/jobs`, outcome.job.id);
    }
  }
  const [client] = await db.select().from(users).where(eq(users.id, outcome.job.clienteId)).limit(1);
  const [professional] = outcome.job.profesionalId
    ? await db.select().from(users).where(eq(users.id, outcome.job.profesionalId)).limit(1)
    : [null];
  return res.json(jobView({ job: outcome.job, client, professional }, userId(req) === outcome.job.profesionalId));
});
router.delete("/trabajos/:id", requireAuth, async (req, res) => {
  const changaId = numberValue(req.params.id);
  const [current] = await db.select().from(jobs).where(eq(jobs.id, changaId)).limit(1);
  if (!current) return res.status(404).json({ error: "Changa no encontrada." });
  if (current.clienteId !== userId(req)) return res.status(403).json({ error: "Solo quien publicó la changa puede eliminarla." });
  if (current.estado !== "publicada" || current.profesionalId !== null) {
    return res.status(409).json({ error: "Solo se pueden eliminar changas publicadas que todavía no fueron aceptadas." });
  }
  const [message, booking, payment, review, audit, upload] = await Promise.all([
    db.select({ id: messages.id }).from(messages).where(eq(messages.changaId, changaId)).limit(1),
    db.select({ id: bookings.id }).from(bookings).where(eq(bookings.changaId, changaId)).limit(1),
    db.select({ id: payments.id }).from(payments).where(eq(payments.changaId, changaId)).limit(1),
    db.select({ id: reviews.id }).from(reviews).where(eq(reviews.changaId, changaId)).limit(1),
    db.select({ id: workyAuditEvents.id }).from(workyAuditEvents).where(and(eq(workyAuditEvents.entidad, "job"), eq(workyAuditEvents.entidadId, changaId))).limit(1),
    db.select({ id: chatUploads.id }).from(chatUploads).where(eq(chatUploads.changaId, changaId)).limit(1),
  ]);
  if (message.length || booking.length || payment.length || review.length || audit.length || upload.length) {
    return res.status(409).json({ error: "Esta changa ya tiene actividad o historial. No se puede borrar; cancelala para conservarlo." });
  }
  const [deleted] = await db.delete(jobs).where(and(
    eq(jobs.id, changaId),
    eq(jobs.clienteId, userId(req)),
    eq(jobs.estado, "publicada"),
    isNull(jobs.profesionalId),
  )).returning({ id: jobs.id });
  if (!deleted) return res.status(409).json({ error: "La changa cambió mientras la eliminabas. Actualizá la pantalla e intentá otra vez." });
  return res.status(204).send();
});
router.get("/trabajos/:id", requireAuth, async (req, res) => {
  const [row] = await db.select({ job: jobs, client: users }).from(jobs).innerJoin(users, eq(users.id, jobs.clienteId)).where(eq(jobs.id, numberValue(req.params.id))).limit(1);
  if (!row) return res.status(404).json({ error: "Changa no encontrada." });
  if (row.job.clienteId !== userId(req) && row.job.profesionalId !== userId(req)) return res.status(403).json({ error: "No participás en esta changa." });
  const [professional] = row.job.profesionalId ? await db.select().from(users).where(eq(users.id, row.job.profesionalId)).limit(1) : [null];
  const [review] = await db.select({ id: reviews.id }).from(reviews)
    .where(and(eq(reviews.changaId, row.job.id), eq(reviews.clienteId, row.job.clienteId))).limit(1);
  return res.json({ ...jobView({ ...row, professional }, row.job.profesionalId === userId(req)), calificada: Boolean(review) });
});
router.get("/trabajos/:id/hilos/:profesionalId", requireAuth, async (req, res) => {
  const changaId = numberValue(req.params.id);
  const profesionalId = numberValue(req.params.profesionalId);
  const thread = await conversationThread(changaId, userId(req), profesionalId);
  if (!thread) return res.status(403).json({ error: "No participás en esta conversación." });
  const [row] = await db.select({ client: users }).from(jobs).innerJoin(users, eq(users.id, jobs.clienteId)).where(eq(jobs.id, changaId)).limit(1);
  if (!row) return res.status(404).json({ error: "Changa no encontrada." });
  const [professional] = await db.select().from(users).where(eq(users.id, profesionalId)).limit(1);
  const [review] = await db.select({ id: reviews.id }).from(reviews)
    .where(and(eq(reviews.changaId, changaId), eq(reviews.clienteId, thread.job.clienteId))).limit(1);
  return res.json({ ...jobView({ job: thread.job, client: row.client, professional }, thread.profesionalId === userId(req)), calificada: Boolean(review) });
});

router.get("/conversaciones", requireAuth, async (req, res) => {
  const role = requestedConversationRole(req);
  if (role === "invalid") return res.status(400).json({ error: "El rol de la bandeja no es válido." });
  const participantFilter = role === "cliente"
    ? eq(jobs.clienteId, userId(req))
    : role === "profesional"
      ? or(
        eq(jobs.profesionalId, userId(req)),
        exists(db.select({ id: messages.id }).from(messages).where(and(eq(messages.changaId, jobs.id), eq(messages.emisorId, userId(req))))),
      )
      : or(
        eq(jobs.clienteId, userId(req)),
        eq(jobs.profesionalId, userId(req)),
        exists(db.select({ id: messages.id }).from(messages).where(and(eq(messages.changaId, jobs.id), eq(messages.emisorId, userId(req))))),
      );
  const owned = await db.select({ job: jobs, client: users }).from(jobs).innerJoin(users, eq(users.id, jobs.clienteId))
    .where(participantFilter).orderBy(desc(jobs.updatedAt));
  const items = (await Promise.all(owned.map(async ({ job, client }) => {
    const allMessages = await db.select({ message: messages, sender: users }).from(messages).innerJoin(users, eq(users.id, messages.emisorId))
      .where(eq(messages.changaId, job.id)).orderBy(asc(messages.createdAt));
    const professionalIds = new Set<number>();
    for (const { message } of allMessages) {
      const professionalId = message.conversacionProfesionalId ?? (message.emisorId === job.clienteId ? job.profesionalId : message.emisorId);
      if (professionalId) professionalIds.add(professionalId);
    }
    const relevantProfessionalIds = role === "profesional"
      ? [...professionalIds].filter((professionalId) => professionalId === userId(req))
      : [...professionalIds];
    return Promise.all(relevantProfessionalIds.map(async (profesionalId) => {
      const thread = allMessages.filter(({ message }) =>
        message.conversacionProfesionalId === profesionalId
        || (message.conversacionProfesionalId === null && (message.emisorId === job.clienteId || message.emisorId === profesionalId)),
      );
      const last = thread.at(-1);
      if (!last) return null;
      const unread = thread.filter(({ message }) => !message.leido && message.emisorId !== userId(req)).length;
      const other = job.clienteId === userId(req)
        ? allMessages.find(({ message }) => message.emisorId === profesionalId)?.sender
          ?? (await db.select().from(users).where(eq(users.id, profesionalId)).limit(1))[0]
        : client;
      return {
        changaId: job.id, profesionalId, estado: job.estado, categoria: job.categoria, detalle: job.detalle,
        updatedAt: last.message.createdAt, unread,
        interlocutor: other ? (role === "profesional" && other.id === job.clienteId ? workerFacingClient(other) : safeUser(other)) : null,
        ultimoMensaje: {
          ...last.message,
          emisor: role === "profesional" && last.sender.id === job.clienteId ? workerFacingClient(last.sender) : safeUser(last.sender),
        },
      };
    }));
  }))).flat().filter((item): item is NonNullable<typeof item> => Boolean(item));
  return res.json(items.sort((a, b) => new Date(b.ultimoMensaje?.createdAt ?? b.updatedAt).getTime() - new Date(a.ultimoMensaje?.createdAt ?? a.updatedAt).getTime()));
});

async function listThreadMessages(changaId: number, requestedProfessionalId: number | undefined, usuarioId: number, res: Response) {
  const thread = await conversationThread(changaId, usuarioId, requestedProfessionalId);
  if (!thread) return res.status(403).json({ error: "No participás en esta conversación." });
  const rows = await db.select({ message: messages, sender: users }).from(messages).innerJoin(users, eq(users.id, messages.emisorId))
    .where(threadMessagesWhere(changaId, thread.job.clienteId, thread.profesionalId)).orderBy(asc(messages.createdAt));
  return res.json(rows.map(({ message, sender }) => ({
    ...message,
    emisor: thread.profesionalId === usuarioId && sender.id === thread.job.clienteId
      ? workerFacingClient(sender)
      : safeUser(sender),
    adjuntos: message.adjuntos ?? [],
  })));
}
async function markThreadMessagesRead(changaId: number, requestedProfessionalId: number | undefined, usuarioId: number, res: Response) {
  const thread = await conversationThread(changaId, usuarioId, requestedProfessionalId);
  if (!thread) return res.status(403).json({ error: "No participás en esta conversación." });
  await db.update(messages).set({ leido: true }).where(and(
    threadMessagesWhere(changaId, thread.job.clienteId, thread.profesionalId),
    sql`${messages.emisorId} <> ${usuarioId}`,
  ));
  return res.status(204).send();
}
async function createThreadMessage(changaId: number, requestedProfessionalId: number | undefined, req: Request, res: Response) {
  const thread = await conversationThread(changaId, userId(req), requestedProfessionalId);
  if (!thread) return res.status(403).json({ error: "No participás en esta conversación." });
  const job = thread.job;
  const texto = String(req.body?.texto ?? "").trim();
  const rawAttachments = Array.isArray(req.body?.adjuntos) ? req.body.adjuntos : [];
  if (rawAttachments.length > MAX_CHAT_ATTACHMENTS) {
    return res.status(400).json({ error: "Podés adjuntar hasta 5 imágenes por mensaje." });
  }
  const attachments = rawAttachments.filter((item: unknown) => item && typeof item === "object" && typeof (item as { objectPath?: unknown }).objectPath === "string");
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
      const [message] = await tx.insert(messages).values({
        changaId,
        emisorId: userId(req),
        conversacionProfesionalId: thread.profesionalId,
        texto: texto || "Imagen adjunta",
        adjuntos: attachments,
      }).returning();
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
  const recipientId = userId(req) === job.clienteId ? thread.profesionalId : job.clienteId;
  await notify(recipientId, "Nuevo mensaje", "Tenés una respuesta en una conversación activa.", `/chat/${changaId}${thread.profesionalId ? `?profesionalId=${thread.profesionalId}` : ""}`);
  return res.status(201).json({ ...created, emisor: safeUser(sender), adjuntos: created.adjuntos ?? [] });
}
router.get("/chats/:changaId/mensajes", requireAuth, async (req, res) => {
  const changaId = numberValue(req.params.changaId);
  const requestedProfessionalId = userId(req);
  return listThreadMessages(changaId, undefined, requestedProfessionalId, res);
});
router.get("/chats/:changaId/hilos/:profesionalId/mensajes", requireAuth, async (req, res) => {
  return listThreadMessages(numberValue(req.params.changaId), numberValue(req.params.profesionalId), userId(req), res);
});
router.post("/chats/:changaId/leidos", requireAuth, async (req, res) => {
  return markThreadMessagesRead(numberValue(req.params.changaId), undefined, userId(req), res);
});
router.post("/chats/:changaId/hilos/:profesionalId/leidos", requireAuth, async (req, res) => {
  return markThreadMessagesRead(numberValue(req.params.changaId), numberValue(req.params.profesionalId), userId(req), res);
});
router.post("/chats/:changaId/mensajes", requireAuth, async (req, res) => {
  return createThreadMessage(numberValue(req.params.changaId), undefined, req, res);
});
router.post("/chats/:changaId/hilos/:profesionalId/mensajes", requireAuth, async (req, res) => {
  return createThreadMessage(numberValue(req.params.changaId), numberValue(req.params.profesionalId), req, res);
});

router.get("/chats/:changaId/citas", requireAuth, async (req, res) => {
  const changaId = numberValue(req.params.changaId);
  const job = await conversationJob(changaId, userId(req));
  if (!job) return res.status(403).json({ error: "No participás en esta conversación." });
  if (!job.profesionalId) return res.json([]);
  await releaseMaturedVisitBalances();
  const rows = await db.select().from(bookings).where(and(eq(bookings.changaId, changaId), eq(bookings.clienteId, job.clienteId), eq(bookings.profesionalId, job.profesionalId))).orderBy(desc(bookings.empiezaAt));
  return res.json(await Promise.all(rows.map(appointmentView)));
});
router.post("/chats/:changaId/citas", requireAuth, requireApprovedProfessional, async (req, res) => {
  const changaId = numberValue(req.params.changaId);
  const [job] = await db.select().from(jobs).where(eq(jobs.id, changaId)).limit(1);
  const empiezaAt = new Date(req.body?.empiezaAt);
  if (!job || !job.profesionalId || (job.clienteId !== userId(req) && job.profesionalId !== userId(req))) return res.status(403).json({ error: "No participás en esta conversación." });
  if (job.profesionalId !== userId(req)) return res.status(403).json({ error: "Solo el Partner puede proponer una visita." });
  if (Number.isNaN(empiezaAt.getTime()) || empiezaAt.getTime() < Date.now()) return res.status(400).json({ error: "Elegí una fecha futura válida." });
  const tarifaVisita = Number(req.body?.tarifaVisita);
  if (!Number.isFinite(tarifaVisita) || tarifaVisita < 1 || tarifaVisita > 10_000_000) return res.status(400).json({ error: "Indicá una tarifa de visita válida." });
  const [activeAppointment] = await db.select({ id: bookings.id }).from(bookings).where(and(
    eq(bookings.changaId, changaId),
    sql`${bookings.estado} in ('solicitada', 'confirmada', 'en_curso')`,
  )).limit(1);
  if (activeAppointment) return res.status(409).json({ error: "Ya existe una visita activa para esta changa." });
  const terminaAt = req.body?.terminaAt ? new Date(req.body.terminaAt) : null;
  const [created] = await db.insert(bookings).values({ changaId, clienteId: job.clienteId, profesionalId: job.profesionalId, empiezaAt, terminaAt, tarifaVisita: tarifaVisita.toFixed(2), estado: "solicitada" }).returning();
  await db.insert(workyAuditEvents).values({ usuarioId: userId(req), entidad: "appointment_attempt", entidadId: changaId, accion: "proponer", estadoNuevo: "exitoso", metadata: { appointmentId: created.id, empiezaAt: created.empiezaAt.toISOString(), tarifaVisita } });
  await notify(job.clienteId, "Nueva propuesta de visita", appointmentNotificationDetail(job.detalle, "propuesta"), `/chat/${changaId}`);
  return res.status(201).json(await appointmentView(created));
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
const acceptAppointment = async (req: Request, res: Response): Promise<void> => {
  const appointmentId = numberValue(req.params.id);
  const method = req.body?.paymentMethod;
  if (method !== "mercado_pago" && method !== "efectivo") {
    res.status(400).json({ error: "Elegí Mercado Pago o efectivo para pagar la visita." });
    return;
  }
  const { accessToken } = mercadoPagoCredentials();
  if (method === "mercado_pago" && !accessToken) {
    res.status(503).json({ error: "El pago de visitas por Mercado Pago todavía no está configurado." });
    return;
  }
  let origin = "";
  if (method === "mercado_pago") {
    try {
      origin = getWorkyPublicOrigin();
    } catch {
      res.status(503).json({ error: "La dirección pública de Worky no está configurada para recibir pagos." });
      return;
    }
  }
  const reserved = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(bookings).where(eq(bookings.id, appointmentId)).for("update").limit(1);
    if (!current) return { kind: "missing" as const };
    if (current.clienteId !== userId(req)) return { kind: "forbidden" as const };
    if (current.estado !== "solicitada") return { kind: "conflict" as const };
    const amount = Math.round(Number(current.tarifaVisita) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return { kind: "invalid-amount" as const };
    const commission = Math.round(amount * 15) / 100;
    const partnerAmount = Math.round((amount - commission) * 100) / 100;
    const [existing] = await tx.select().from(visitPayments).where(eq(visitPayments.bookingId, current.id)).for("update").limit(1);
    if (existing && existing.status !== "payment_failed") {
      if (existing.method === method && existing.status === "checkout_started" && existing.checkoutUrl) {
        return { kind: "existing-checkout" as const, booking: current, payment: existing };
      }
      return { kind: "already-started" as const };
    }
    const nextStatus = method === "efectivo" ? "cash_pending_visit" as const : "checkout_started" as const;
    const payment = existing
      ? (await tx.update(visitPayments).set({
        amount: amount.toFixed(2), commissionAmount: commission.toFixed(2), partnerAmount: partnerAmount.toFixed(2),
        method, status: nextStatus, providerPaymentId: null, providerPreferenceId: null, checkoutUrl: null,
        updatedAt: new Date(),
      }).where(eq(visitPayments.id, existing.id)).returning())[0]
      : (await tx.insert(visitPayments).values({
        bookingId: current.id, clienteId: current.clienteId, profesionalId: current.profesionalId,
        amount: amount.toFixed(2), commissionAmount: commission.toFixed(2), partnerAmount: partnerAmount.toFixed(2),
        method, status: nextStatus,
      }).returning())[0];
    if (method === "efectivo") {
      await tx.update(bookings).set({ estado: "confirmada", updatedAt: new Date() }).where(eq(bookings.id, current.id));
      await tx.insert(workyAuditEvents).values({
        usuarioId: userId(req), entidad: "appointment_attempt", entidadId: current.changaId,
        accion: "aceptar", estadoAnterior: current.estado, estadoNuevo: "exitoso",
        metadata: { appointmentId: current.id, empiezaAt: current.empiezaAt.toISOString(), paymentMethod: method },
      });
    }
    await tx.insert(workyAuditEvents).values({
      usuarioId: userId(req), entidad: "visit_payment", entidadId: payment.id,
      accion: method === "efectivo" ? "cash_visit_accepted" : "checkout_started",
      estadoAnterior: existing?.status ?? null, estadoNuevo: nextStatus,
      metadata: { bookingId: current.id, amount, commissionAmount: commission, partnerAmount },
    });
    return { kind: method === "efectivo" ? "cash-accepted" as const : "create-checkout" as const, booking: current, payment };
  });
  if (reserved.kind === "missing") { res.status(404).json({ error: "Visita no encontrada." }); return; }
  if (reserved.kind === "forbidden") { res.status(403).json({ error: "Solo el cliente puede aceptar y pagar la visita." }); return; }
  if (reserved.kind === "conflict") { res.status(409).json({ error: "Esta visita ya no está pendiente." }); return; }
  if (reserved.kind === "invalid-amount") { res.status(409).json({ error: "La propuesta no tiene una tarifa válida. Pedile al Partner que envíe otra." }); return; }
  if (reserved.kind === "already-started") { res.status(409).json({ error: "Esta visita ya tiene un pago registrado." }); return; }
  if (reserved.kind === "existing-checkout") {
    res.json({ appointment: await appointmentView(reserved.booking), checkoutUrl: reserved.payment.checkoutUrl });
    return;
  }
  if (reserved.kind === "cash-accepted") {
    const [updated] = await db.select().from(bookings).where(eq(bookings.id, reserved.booking.id)).limit(1);
    await notify(reserved.booking.profesionalId, "Visita confirmada", "El cliente aceptó la propuesta y eligió pagar en efectivo. Worky registrará su comisión del 15% cuando confirmes que la visita se realizó.", `/chat/${reserved.booking.changaId}`);
    res.json({ appointment: await appointmentView(updated), checkoutUrl: null });
    return;
  }
  try {
    const preference = await createMercadoPagoPreference({
      accessToken: accessToken!,
      idempotencyKey: `worky-visit-${reserved.payment.id}`,
      request: {
        items: [{
          id: `worky-visit-${reserved.booking.id}`,
          title: `Visita Worky · ${reserved.booking.id}`,
          quantity: 1,
          currency_id: "ARS",
          unit_price: Number(reserved.payment.amount),
        }],
        external_reference: `visit_payment:${reserved.payment.id}`,
        notification_url: `${origin}/api/v1/webhooks/mercadopago`,
        back_urls: {
          success: `${origin}/chat/${reserved.booking.changaId}?visitPayment=return`,
          failure: `${origin}/chat/${reserved.booking.changaId}?visitPayment=return`,
          pending: `${origin}/chat/${reserved.booking.changaId}?visitPayment=return`,
        },
        auto_return: "approved",
      },
    });
    const checkoutUrl = process.env.NODE_ENV === "production" ? preference.init_point : preference.sandbox_init_point;
    const host = checkoutUrl ? new URL(checkoutUrl).hostname : "";
    const isMercadoPagoHost = /^([a-z0-9-]+\.)*mercadopago\.(?:com(?:\.[a-z]{2})?|[a-z]{2})$/i.test(host);
    const hasSandboxHost = host.split(".").includes("sandbox");
    if (!checkoutUrl || !isMercadoPagoHost || (process.env.NODE_ENV === "production" ? hasSandboxHost : !hasSandboxHost)) {
      throw new Error("Mercado Pago no devolvió una URL segura.");
    }
    const [payment] = await db.update(visitPayments).set({
      providerPreferenceId: preference.id, checkoutUrl, updatedAt: new Date(),
    }).where(eq(visitPayments.id, reserved.payment.id)).returning();
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, reserved.booking.id)).limit(1);
    res.json({ appointment: await appointmentView(booking), checkoutUrl: payment.checkoutUrl });
  } catch (error) {
    await db.update(visitPayments).set({ status: "payment_failed", updatedAt: new Date() }).where(eq(visitPayments.id, reserved.payment.id));
    res.status(502).json({ error: "No pudimos iniciar el pago de la visita. Probá nuevamente más tarde." });
  }
};

const updateAppointment = async (req: Request, res: Response): Promise<void> => {
  const [current] = await db.select().from(bookings).where(eq(bookings.id, numberValue(req.params.id))).limit(1);
  if (!current || (current.clienteId !== userId(req) && current.profesionalId !== userId(req))) {
    res.status(404).json({ error: "Cita no encontrada." });
    return;
  }
  const job = await conversationJob(current.changaId, userId(req));
  if (!job || job.clienteId !== current.clienteId || job.profesionalId !== current.profesionalId) {
    res.status(404).json({ error: "Cita no encontrada." });
    return;
  }
  const action = req.body?.accion;
  if (!["rechazar", "cancelar"].includes(action)) {
    res.status(400).json({ error: "La acción de la visita no es válida." });
    return;
  }
  const nextStatus = action === "rechazar" || action === "cancelar" ? "cancelada" : current.estado;
  if (action === "rechazar" && current.clienteId !== userId(req)) {
    res.status(403).json({ error: "Solo el cliente puede rechazar la visita." });
    return;
  }
  if (action === "cancelar" && current.clienteId !== userId(req)) {
    res.status(403).json({ error: "Solo el cliente puede cancelar la visita." });
    return;
  }
  if (action === "rechazar" && current.estado !== "solicitada") {
    res.status(409).json({ error: "Esta visita ya no está pendiente." });
    return;
  }
  if (action === "cancelar" && !["solicitada", "confirmada"].includes(current.estado)) {
    res.status(409).json({ error: "Solo podés cancelar una visita solicitada o confirmada." });
    return;
  }
  if (action === "cancelar") {
    const [finance] = await db.select().from(visitPayments).where(eq(visitPayments.bookingId, current.id)).limit(1);
    if (finance && finance.status !== "payment_failed") {
      res.status(409).json({ error: "Una visita aceptada no se puede cancelar automáticamente: contactá a Worky para revisar el cobro." });
      return;
    }
  }
  const [updated] = await db.update(bookings).set({ estado: nextStatus, updatedAt: new Date() }).where(eq(bookings.id, current.id)).returning();
  await db.insert(workyAuditEvents).values({ usuarioId: userId(req), entidad: "appointment_attempt", entidadId: current.changaId, accion: action === "cancelar" ? "cancelar" : "rechazar", estadoAnterior: current.estado, estadoNuevo: action === "rechazar" ? "rechazado" : "exitoso", metadata: { appointmentId: current.id, empiezaAt: updated.empiezaAt.toISOString() } });
  const outcome = action === "cancelar" ? "cancelada" : "rechazada";
  await notify(
    userId(req) === current.clienteId ? current.profesionalId : current.clienteId,
    action === "aceptar" ? "Visita confirmada" : action === "cancelar" ? "Visita cancelada" : "Visita rechazada",
    outcome === "cancelada" ? `La visita fue cancelada${job.detalle?.trim() ? ` para "${job.detalle.trim().slice(0, 120)}"` : ""}.` : appointmentNotificationDetail(job.detalle, outcome),
    `/chat/${current.changaId}`,
  );
  res.json(await appointmentView(updated));
};
router.patch("/citas/:id", requireAuth, updateAppointment);
router.post("/citas/:id/aceptar", requireAuth, (req, res) => {
  return acceptAppointment(req, res);
});
router.post("/citas/:id/rechazar", requireAuth, (req, res) => {
  req.body = { ...(req.body ?? {}), accion: "rechazar" };
  return updateAppointment(req, res);
});
router.post("/citas/:id/llegada", requireAuth, requireApprovedProfessional, async (req, res): Promise<void> => {
  const appointmentId = numberValue(req.params.id);
  const result = await db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, appointmentId)).for("update").limit(1);
    if (!booking) return { kind: "missing" as const };
    if (booking.profesionalId !== userId(req)) return { kind: "forbidden" as const };
    if (booking.estado !== "confirmada" && booking.estado !== "en_curso") return { kind: "conflict" as const };
    if (Date.now() < booking.empiezaAt.getTime() - 30 * 60 * 1000) return { kind: "too-early" as const };
    const [finance] = await tx.select().from(visitPayments).where(eq(visitPayments.bookingId, booking.id)).for("update").limit(1);
    if (!finance || !["pending_release", "cash_pending_visit"].includes(finance.status)) return { kind: "unpaid" as const };
    if (finance.partnerArrivedAt) return { kind: "already-recorded" as const, booking };
    await tx.update(visitPayments).set({ partnerArrivedAt: new Date(), updatedAt: new Date() }).where(eq(visitPayments.id, finance.id));
    await tx.insert(workyAuditEvents).values({
      usuarioId: userId(req), entidad: "visit_payment", entidadId: finance.id,
      accion: "partner_arrival_recorded", estadoAnterior: finance.status, estadoNuevo: finance.status,
      metadata: { bookingId: booking.id, arrivedAt: new Date().toISOString() },
    });
    return { kind: "recorded" as const, booking };
  });
  if (result.kind === "missing") { res.status(404).json({ error: "Visita no encontrada." }); return; }
  if (result.kind === "forbidden") { res.status(403).json({ error: "Solo el Partner de la visita puede registrar su llegada." }); return; }
  if (result.kind === "conflict") { res.status(409).json({ error: "La visita debe estar confirmada para registrar la llegada." }); return; }
  if (result.kind === "too-early") { res.status(409).json({ error: "La llegada se habilita hasta 30 minutos antes del horario de la visita." }); return; }
  if (result.kind === "unpaid") { res.status(409).json({ error: "La visita no tiene un pago confirmado." }); return; }
  if (result.kind === "recorded") await notify(result.booking.clienteId, "El Partner llegó", "El profesional registró su llegada. Si la visita se concreta, vas a poder confirmarla desde esta conversación.", `/chat/${result.booking.changaId}`);
  res.json(await appointmentView(result.booking));
});
router.post("/citas/:id/completar", requireAuth, requireApprovedProfessional, async (req, res): Promise<void> => {
  const appointmentId = numberValue(req.params.id);
  const result = await db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, appointmentId)).for("update").limit(1);
    if (!booking) return { kind: "missing" as const };
    if (booking.profesionalId !== userId(req)) return { kind: "forbidden" as const };
    if (booking.estado !== "confirmada" && booking.estado !== "en_curso") return { kind: "conflict" as const };
    await tx.select({ id: users.id }).from(users).where(eq(users.id, booking.profesionalId)).for("update").limit(1);
    const [finance] = await tx.select().from(visitPayments).where(eq(visitPayments.bookingId, booking.id)).for("update").limit(1);
    if (!finance || !finance.partnerArrivedAt) return { kind: "arrival-required" as const };
    if (!["pending_release", "cash_pending_visit"].includes(finance.status)) return { kind: "conflict" as const };
    const now = new Date();
    const nextFinanceStatus = finance.method === "efectivo" ? "cash_commission_due" as const : "pending_release" as const;
    const releaseAt = finance.method === "mercado_pago" ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : null;
    const [updatedBooking] = await tx.update(bookings).set({ estado: "completada", updatedAt: now }).where(eq(bookings.id, booking.id)).returning();
    await tx.update(visitPayments).set({ status: nextFinanceStatus, completedAt: now, releaseAt, updatedAt: now }).where(eq(visitPayments.id, finance.id));
    await tx.insert(workyAuditEvents).values({
      usuarioId: userId(req), entidad: "visit_payment", entidadId: finance.id,
      accion: "visit_completed", estadoAnterior: finance.status, estadoNuevo: nextFinanceStatus,
      metadata: { bookingId: booking.id, releaseAt: releaseAt?.toISOString() ?? null },
    });
    if (finance.method === "efectivo") await settleAvailablePartnerCommissions(tx, booking.profesionalId, now);
    const [updatedFinance] = await tx.select({ status: visitPayments.status }).from(visitPayments)
      .where(eq(visitPayments.id, finance.id)).limit(1);
    return {
      kind: "completed" as const,
      booking: updatedBooking,
      clientId: booking.clienteId,
      partnerId: booking.profesionalId,
      method: finance.method,
      commissionSettled: updatedFinance?.status === "cash_commission_settled",
    };
  });
  if (result.kind === "missing") { res.status(404).json({ error: "Visita no encontrada." }); return; }
  if (result.kind === "forbidden") { res.status(403).json({ error: "Solo el Partner puede cerrar la visita." }); return; }
  if (result.kind === "arrival-required") { res.status(409).json({ error: "Primero registrá tu llegada a la visita." }); return; }
  if (result.kind === "conflict") { res.status(409).json({ error: "La visita no se puede completar en su estado actual." }); return; }
  await notify(result.clientId, "Visita realizada", "El Partner marcó la visita como realizada. Confirmala si estás de acuerdo; si no informás un problema, el saldo se libera después de 24 horas.", `/chat/${result.booking.changaId}`);
  if (result.method === "mercado_pago") {
    await notify(result.partnerId, "Saldo de visita retenido", "El 85% quedó pendiente durante 24 horas. El cliente puede confirmarlo antes; si reporta un problema, se pausa para revisión.", "/partner");
  } else {
    await notify(
      result.partnerId,
      result.commissionSettled ? "Comisión de visita saldada" : "Comisión de visita registrada",
      result.commissionSettled
        ? "Worky compensó el 15% de esta visita en efectivo con tu saldo disponible. Ya no queda deuda pendiente por esta comisión."
        : "Worky registró el 15% de comisión de esta visita en efectivo para descontarlo de tu saldo futuro.",
      "/partner",
    );
  }
  res.json(await appointmentView(result.booking));
});
router.post("/citas/:id/confirmar-visita", requireAuth, async (req, res): Promise<void> => {
  const appointmentId = numberValue(req.params.id);
  const result = await db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, appointmentId)).for("update").limit(1);
    if (!booking) return { kind: "missing" as const };
    if (booking.clienteId !== userId(req)) return { kind: "forbidden" as const };
    await tx.select({ id: users.id }).from(users).where(eq(users.id, booking.profesionalId)).for("update").limit(1);
    const [finance] = await tx.select().from(visitPayments).where(eq(visitPayments.bookingId, booking.id)).for("update").limit(1);
    if (booking.estado !== "completada" || !finance || !finance.completedAt) return { kind: "conflict" as const };
    if (finance.status === "under_review") return { kind: "under-review" as const };
    if (finance.status !== "pending_release" && finance.status !== "cash_commission_due" && finance.status !== "cash_commission_settled") return { kind: "conflict" as const };
    const now = new Date();
    const nextStatus = finance.method === "mercado_pago"
      ? "available" as const
      : finance.status === "cash_commission_settled" ? "cash_commission_settled" as const : "cash_commission_due" as const;
    await tx.update(visitPayments).set({ status: nextStatus, clientConfirmedAt: now, updatedAt: now }).where(eq(visitPayments.id, finance.id));
    await tx.insert(workyAuditEvents).values({
      usuarioId: userId(req), entidad: "visit_payment", entidadId: finance.id,
      accion: finance.method === "mercado_pago" ? "client_confirmed_balance_released" : "client_confirmed_cash_visit",
      estadoAnterior: finance.status, estadoNuevo: nextStatus, metadata: { bookingId: booking.id },
    });
    await settleAvailablePartnerCommissions(tx, booking.profesionalId, now);
    return {
      kind: "confirmed" as const,
      booking,
      partnerId: booking.profesionalId,
      method: finance.method,
      commissionSettled: finance.status === "cash_commission_settled",
    };
  });
  if (result.kind === "missing") { res.status(404).json({ error: "Visita no encontrada." }); return; }
  if (result.kind === "forbidden") { res.status(403).json({ error: "Solo el cliente puede confirmar la visita." }); return; }
  if (result.kind === "under-review") { res.status(409).json({ error: "La visita está en revisión y no se puede cerrar todavía." }); return; }
  if (result.kind === "conflict") { res.status(409).json({ error: "La visita todavía no puede confirmarse." }); return; }
  await notify(
    result.partnerId,
    result.method === "mercado_pago" ? "Saldo de visita disponible" : "Visita en efectivo confirmada",
    result.method === "mercado_pago"
      ? "El cliente confirmó la visita. El 85% ya está disponible en tu saldo Worky."
      : result.commissionSettled
        ? "El cliente confirmó que la visita se realizó. La comisión quedó saldada con tu saldo Worky disponible."
        : "El cliente confirmó que la visita se realizó. La comisión del 15% queda registrada para descontarse de tu saldo futuro.",
    "/partner",
  );
  res.json(await appointmentView(result.booking));
});
router.post("/citas/:id/reportar-problema", requireAuth, async (req, res): Promise<void> => {
  const appointmentId = numberValue(req.params.id);
  const issueType = req.body?.issueType;
  const detail = typeof req.body?.detail === "string" ? req.body.detail.trim().slice(0, 1000) : "";
  if (!["partner_no_show", "client_no_show", "other"].includes(issueType) || detail.length < 5) {
    res.status(400).json({ error: "Indicá el tipo de problema y describilo con al menos 5 caracteres." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, appointmentId)).for("update").limit(1);
    if (!booking) return { kind: "missing" as const };
    if (booking.clienteId !== userId(req) && booking.profesionalId !== userId(req)) return { kind: "forbidden" as const };
    if ((issueType === "partner_no_show" && booking.clienteId !== userId(req))
      || (issueType === "client_no_show" && booking.profesionalId !== userId(req))) return { kind: "forbidden" as const };
    const [finance] = await tx.select().from(visitPayments).where(eq(visitPayments.bookingId, booking.id)).for("update").limit(1);
    if (!finance || !["pending_release", "cash_pending_visit", "cash_commission_due", "cash_commission_settled"].includes(finance.status)) return { kind: "conflict" as const };
    const tenMinutesAfterStart = booking.empiezaAt.getTime() + 10 * 60 * 1000;
    if ((issueType === "partner_no_show" || issueType === "client_no_show") && Date.now() < tenMinutesAfterStart) return { kind: "wait" as const };
    if (issueType === "client_no_show" && !finance.partnerArrivedAt) return { kind: "arrival-required" as const };
    await tx.update(visitPayments).set({
      status: "under_review", issueReportedAt: new Date(), issueReportedBy: userId(req),
      issueType, issueDetail: detail, updatedAt: new Date(),
    }).where(eq(visitPayments.id, finance.id));
    await tx.insert(workyAuditEvents).values({
      usuarioId: userId(req), entidad: "visit_payment", entidadId: finance.id,
      accion: "issue_reported", estadoAnterior: finance.status, estadoNuevo: "under_review",
      metadata: { bookingId: booking.id, issueType },
    });
    return { kind: "reported" as const, booking, clientId: booking.clienteId, partnerId: booking.profesionalId };
  });
  if (result.kind === "missing") { res.status(404).json({ error: "Visita no encontrada." }); return; }
  if (result.kind === "forbidden") { res.status(403).json({ error: "No podés reportar este motivo para esta visita." }); return; }
  if (result.kind === "conflict") { res.status(409).json({ error: "No hay un saldo de visita activo que pueda retenerse." }); return; }
  if (result.kind === "wait") { res.status(409).json({ error: "Para reportar una ausencia, esperá 10 minutos después del horario acordado." }); return; }
  if (result.kind === "arrival-required") { res.status(409).json({ error: "Registrá tu llegada y esperá 10 minutos antes de informar que el cliente no se presentó." }); return; }
  await notify(result.clientId, "Visita en revisión", "Se reportó un problema. El saldo quedó retenido hasta que Worky revise el caso.", `/chat/${result.booking.changaId}`);
  await notify(result.partnerId, "Visita en revisión", "Se reportó un problema. El saldo o la comisión quedó en pausa hasta que Worky revise el caso.", `/chat/${result.booking.changaId}`);
  res.json(await appointmentView(result.booking));
});

export default router;