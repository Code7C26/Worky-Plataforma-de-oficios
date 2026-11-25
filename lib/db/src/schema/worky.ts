import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const roleEnum = pgEnum("worky_role", ["cliente", "profesional", "admin"]);
export const categoryEnum = pgEnum("worky_category", ["Plomería", "Electricidad", "Gas", "Albañilería", "Otro"]);
export const jobStatusEnum = pgEnum("worky_job_status", ["publicada", "aceptada", "en_curso", "trabajo_realizado", "finalizada", "cancelada"]);
export const jobPaymentMethodEnum = pgEnum("worky_job_payment_method", ["mercado_pago", "efectivo"]);
export const availabilityStatusEnum = pgEnum("worky_availability_status", ["disponible", "ocupado", "pausado"]);
export const assetTypeEnum = pgEnum("worky_asset_type", ["portfolio", "foto", "video"]);
export const bookingStatusEnum = pgEnum("worky_booking_status", ["solicitada", "confirmada", "en_curso", "completada", "cancelada"]);
export const paymentStatusEnum = pgEnum("worky_payment_status", ["pendiente", "iniciado", "aprobado", "rechazado", "reembolsado"]);
export const settlementStatusEnum = pgEnum("worky_settlement_status", ["pendiente", "en_revision", "pagada", "retenida", "cancelada"]);
export const visitPaymentMethodEnum = pgEnum("worky_visit_payment_method", ["mercado_pago", "efectivo"]);
export const visitPaymentStatusEnum = pgEnum("worky_visit_payment_status", ["checkout_started", "pending_release", "available", "cash_pending_visit", "cash_commission_due", "cash_commission_settled", "under_review", "payment_failed", "refunded"]);
export const cashJobCommissionStatusEnum = pgEnum("worky_cash_job_commission_status", ["due", "settled"]);
export const recommendationVisibilityEnum = pgEnum("worky_recommendation_visibility", ["publica", "privada"]);
export const onboardingStatusEnum = pgEnum("worky_onboarding_status", ["registration_started", "basic_info_completed", "professional_verification_pending", "onboarding_completed"]);
export const verificationStatusEnum = pgEnum("worky_verification_status", ["pending_verification", "verified", "rejected"]);
export const privateDocumentTypeEnum = pgEnum("worky_private_document_type", ["dni_frente", "dni_dorso", "antecedentes_penales", "matricula"]);
export const chatUploadStatusEnum = pgEnum("worky_chat_upload_status", ["pending", "associated", "deleting", "deleted"]);
export const profilePhotoUploadStatusEnum = pgEnum("worky_profile_photo_upload_status", ["pending", "associated", "deleting", "deleted"]);
export const profilePhotoVariantEnum = pgEnum("worky_profile_photo_variant", ["source", "rendered"]);
export const clientIdentityVerificationStatusEnum = pgEnum("worky_client_identity_verification_status", ["pending_verification", "deleting", "verified", "rejected"]);
export const clientIdentityVerificationDecisionEnum = pgEnum("worky_client_identity_verification_decision", ["verified", "rejected"]);
export const clientVerificationDocumentTypeEnum = pgEnum("worky_client_verification_document_type", ["dni", "selfie"]);
export const clientVerificationUploadStatusEnum = pgEnum("worky_client_verification_upload_status", ["pending", "processing", "associated", "deleting", "deleted"]);
export const emailVerificationPurposeEnum = pgEnum("worky_email_verification_purpose", ["registration", "account"]);

export const users = pgTable("worky_users", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  email: text("email").notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  clientIdentityVerifiedAt: timestamp("client_identity_verified_at", { withTimezone: true }),
  passwordHash: text("password_hash").notNull(),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  telefono: text("telefono"),
  edad: integer("edad"),
  fotoObjectPath: text("foto_object_path"),
  username: text("username"),
  onboardingEstado: onboardingStatusEnum("onboarding_estado").notNull().default("registration_started"),
  onboardingPaso: integer("onboarding_paso").notNull().default(1),
  onboardingRespuestas: jsonb("onboarding_respuestas").notNull().default({}),
  rol: roleEnum("rol").notNull().default("cliente"),
  ubicacion: jsonb("ubicacion"),
  activo: boolean("activo").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("worky_users_email_idx").on(table.email),
  uniqueIndex("worky_users_username_idx").on(table.username),
]);

export const passwordRecoveryTokens = pgTable("worky_password_recovery_tokens", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("worky_password_recovery_token_hash_idx").on(table.tokenHash),
  index("worky_password_recovery_user_idx").on(table.usuarioId),
]);

export const emailVerificationTokens = pgTable("worky_email_verification_tokens", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  purpose: emailVerificationPurposeEnum("purpose").notNull(),
  tokenHash: text("token_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("worky_email_verification_token_hash_idx").on(table.tokenHash),
  index("worky_email_verification_user_idx").on(table.usuarioId),
  index("worky_email_verification_email_purpose_idx").on(table.email, table.purpose, table.createdAt),
]);

export const adminSignupTokens = pgTable("worky_admin_signup_tokens", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  codeSalt: text("code_salt").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("worky_admin_signup_email_idx").on(table.email),
  uniqueIndex("worky_admin_signup_code_hash_idx").on(table.codeHash),
]);

export const mobileLoginChallenges = pgTable("worky_mobile_login_challenges", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deviceHash: text("device_hash").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("worky_mobile_login_challenge_device_created_idx").on(table.usuarioId, table.deviceHash, table.createdAt),
]);

export const mobileTrustedDevices = pgTable("worky_mobile_trusted_devices", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deviceKey: uuid("device_key").defaultRandom().notNull(),
  deviceHash: text("device_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("worky_mobile_trusted_device_key_idx").on(table.deviceKey),
  uniqueIndex("worky_mobile_trusted_device_user_device_idx").on(table.usuarioId, table.deviceHash),
  index("worky_mobile_trusted_device_user_idx").on(table.usuarioId),
]);

export const webLoginChallenges = pgTable("worky_web_login_challenges", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("worky_web_login_challenge_user_created_idx").on(table.usuarioId, table.createdAt),
]);

export const professionalProfiles = pgTable("worky_professional_profiles", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").notNull().unique().references(() => users.id),
  oficio: text("oficio").notNull(),
  categoria: categoryEnum("categoria").notNull(),
  ubicacionFija: jsonb("ubicacion_fija"),
  matriculaHabilitante: text("matricula_habilitante"),
  verificado: boolean("verificado").notNull().default(false),
  habilitado: boolean("habilitado").notNull().default(true),
  estadoVerificacion: verificationStatusEnum("estado_verificacion").notNull().default("pending_verification"),
  skills: text("skills").array().notNull().default([]),
  about: text("about"),
  experienciaAnios: integer("experiencia_anios").notNull().default(0),
  precioReferencia: numeric("precio_referencia", { precision: 12, scale: 2 }).notNull(),
  disponible: boolean("disponible").notNull().default(true),
  rating: numeric("rating", { precision: 3, scale: 2 }).notNull().default("0"),
  cantidadChangas: integer("cantidad_changas").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("worky_profiles_category_idx").on(table.categoria),
  index("worky_profiles_public_state_idx").on(table.habilitado, table.verificado, table.categoria),
]);

/** Catálogo administrable: estas filas son la única fuente para filtros y oportunidades. */
export const serviceCatalog = pgTable("worky_service_catalog", {
  id: serial("id").primaryKey(),
  categoria: text("categoria").notNull(),
  especialidad: text("especialidad").notNull(),
  activa: boolean("activa").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("worky_catalog_category_specialty_idx").on(table.categoria, table.especialidad)]);

export const professionalAvailability = pgTable("worky_professional_availability", {
  id: serial("id").primaryKey(),
  profesionalId: integer("profesional_id").notNull().references(() => users.id),
  diaSemana: integer("dia_semana").notNull(),
  desde: text("desde").notNull(),
  hasta: text("hasta").notNull(),
  estado: availabilityStatusEnum("estado").notNull().default("disponible"),
  zona: text("zona"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("worky_availability_unique_idx").on(table.profesionalId, table.diaSemana, table.desde)]);

export const jobs = pgTable("worky_jobs", {
  id: serial("id").primaryKey(),
  clienteId: integer("cliente_id").notNull().references(() => users.id),
  profesionalId: integer("profesional_id").references(() => users.id),
  ubicacion: jsonb("ubicacion").notNull(),
  categoria: categoryEnum("categoria").notNull(),
  precioOfrecido: numeric("precio_ofrecido", { precision: 12, scale: 2 }).notNull(),
  detalle: text("detalle"),
  estado: jobStatusEnum("estado").notNull().default("publicada"),
  paymentMethod: jobPaymentMethodEnum("payment_method").notNull().default("mercado_pago"),
  trabajoRealizadoAt: timestamp("trabajo_realizado_at", { withTimezone: true }),
  cashConfirmedByClientAt: timestamp("cash_confirmed_by_client_at", { withTimezone: true }),
  cashConfirmedByProfessionalAt: timestamp("cash_confirmed_by_professional_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("worky_jobs_status_category_idx").on(table.estado, table.categoria)]);

export const reviews = pgTable("worky_reviews", {
  id: serial("id").primaryKey(),
  changaId: integer("changa_id").notNull().references(() => jobs.id),
  clienteId: integer("cliente_id").notNull().references(() => users.id),
  profesionalId: integer("profesional_id").notNull().references(() => users.id),
  rating: integer("rating").notNull(),
  comentario: text("comentario"),
  adjuntos: jsonb("adjuntos").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("worky_reviews_job_client_idx").on(table.changaId, table.clienteId),
  index("worky_reviews_professional_idx").on(table.profesionalId, table.createdAt),
]);

export const recommendations = pgTable("worky_recommendations", {
  id: serial("id").primaryKey(),
  clienteId: integer("cliente_id").notNull().references(() => users.id),
  profesionalId: integer("profesional_id").notNull().references(() => users.id),
  visibilidad: recommendationVisibilityEnum("visibilidad").notNull().default("publica"),
  comentario: text("comentario"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("worky_recommendations_client_professional_idx").on(table.clienteId, table.profesionalId),
  index("worky_recommendations_professional_visibility_idx").on(table.profesionalId, table.visibilidad),
]);

export const messages = pgTable("worky_messages", {
  id: serial("id").primaryKey(),
  changaId: integer("changa_id").notNull().references(() => jobs.id),
  emisorId: integer("emisor_id").notNull().references(() => users.id),
  conversacionProfesionalId: integer("conversacion_profesional_id").references(() => users.id),
  texto: text("texto").notNull(),
  adjuntos: jsonb("adjuntos").notNull().default([]),
  leido: boolean("leido").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("worky_messages_job_idx").on(table.changaId, table.createdAt),
  index("worky_messages_thread_idx").on(table.changaId, table.conversacionProfesionalId, table.createdAt),
]);

/**
 * Tracks only chat attachment paths issued by the upload endpoint. The path
 * stays private and can be safely reclaimed while it is still pending.
 */
export const chatUploads = pgTable("worky_chat_uploads", {
  id: serial("id").primaryKey(),
  changaId: integer("changa_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  usuarioId: integer("usuario_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull(),
  estado: chatUploadStatusEnum("estado").notNull().default("pending"),
  associatedMessageId: integer("associated_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("worky_chat_uploads_object_path_idx").on(table.objectPath),
  index("worky_chat_uploads_cleanup_idx").on(table.estado, table.createdAt),
]);

/**
 * Tracks profile photo source uploads and prepared variants independently
 * from chat attachments, verification documents, and professional assets.
 */
export const profilePhotoUploads = pgTable("worky_profile_photo_uploads", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull(),
  variante: profilePhotoVariantEnum("variante").notNull(),
  estado: profilePhotoUploadStatusEnum("estado").notNull().default("pending"),
  associatedAt: timestamp("associated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("worky_profile_photo_uploads_object_path_idx").on(table.objectPath),
  index("worky_profile_photo_uploads_cleanup_idx").on(table.estado, table.createdAt),
  index("worky_profile_photo_uploads_user_idx").on(table.usuarioId, table.createdAt),
]);

export const professionalAssets = pgTable("worky_professional_assets", {
  id: serial("id").primaryKey(),
  profesionalId: integer("profesional_id").notNull().references(() => users.id),
  tipo: assetTypeEnum("tipo").notNull(),
  objectPath: text("object_path").notNull(),
  nombre: text("nombre").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  altText: text("alt_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("worky_assets_professional_idx").on(table.profesionalId, table.tipo)]);

export const bookings = pgTable("worky_bookings", {
  id: serial("id").primaryKey(),
  changaId: integer("changa_id").notNull().references(() => jobs.id),
  clienteId: integer("cliente_id").notNull().references(() => users.id),
  profesionalId: integer("profesional_id").notNull().references(() => users.id),
  empiezaAt: timestamp("empieza_at", { withTimezone: true }).notNull(),
  terminaAt: timestamp("termina_at", { withTimezone: true }),
  tarifaVisita: numeric("tarifa_visita", { precision: 12, scale: 2 }).notNull().default("0"),
  estado: bookingStatusEnum("estado").notNull().default("solicitada"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("worky_bookings_professional_date_idx").on(table.profesionalId, table.empiezaAt)]);

/** Cobro y saldo de una visita coordinada, separado de los pagos de trabajos. */
export const visitPayments = pgTable("worky_visit_payments", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  clienteId: integer("cliente_id").notNull().references(() => users.id),
  profesionalId: integer("profesional_id").notNull().references(() => users.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  commissionAmount: numeric("commission_amount", { precision: 12, scale: 2 }).notNull(),
  partnerAmount: numeric("partner_amount", { precision: 12, scale: 2 }).notNull(),
  method: visitPaymentMethodEnum("method").notNull(),
  status: visitPaymentStatusEnum("status").notNull(),
  providerPaymentId: text("provider_payment_id"),
  providerPreferenceId: text("provider_preference_id"),
  checkoutUrl: text("checkout_url"),
  partnerArrivedAt: timestamp("partner_arrived_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  releaseAt: timestamp("release_at", { withTimezone: true }),
  clientConfirmedAt: timestamp("client_confirmed_at", { withTimezone: true }),
  issueReportedAt: timestamp("issue_reported_at", { withTimezone: true }),
  issueReportedBy: integer("issue_reported_by").references(() => users.id),
  issueType: text("issue_type"),
  issueDetail: text("issue_detail"),
  resolutionAt: timestamp("resolution_at", { withTimezone: true }),
  resolutionBy: integer("resolution_by").references(() => users.id),
  resolutionDetail: text("resolution_detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("worky_visit_payments_booking_idx").on(table.bookingId),
  index("worky_visit_payments_release_idx").on(table.status, table.releaseAt),
  index("worky_visit_payments_partner_status_idx").on(table.profesionalId, table.status),
]);

export const payments = pgTable("worky_payments", {
  id: serial("id").primaryKey(),
  changaId: integer("changa_id").notNull().references(() => jobs.id),
  clienteId: integer("cliente_id").notNull().references(() => users.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("ARS"),
  status: paymentStatusEnum("status").notNull().default("pendiente"),
  provider: text("provider").notNull().default("mercado_pago"),
  providerPaymentId: text("provider_payment_id"),
  providerPreferenceId: text("provider_preference_id"),
  checkoutUrl: text("checkout_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Comisión de Worky por una changa cobrada en efectivo, compensada con saldo futuro. */
export const cashJobCommissions = pgTable("worky_cash_job_commissions", {
  id: serial("id").primaryKey(),
  changaId: integer("changa_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  profesionalId: integer("profesional_id").notNull().references(() => users.id),
  commissionRate: numeric("commission_rate", { precision: 5, scale: 2 }).notNull().default("15.00"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  remainingAmount: numeric("remaining_amount", { precision: 12, scale: 2 }).notNull(),
  status: cashJobCommissionStatusEnum("status").notNull().default("due"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("worky_cash_job_commissions_job_idx").on(table.changaId),
  index("worky_cash_job_commissions_partner_status_idx").on(table.profesionalId, table.status, table.createdAt),
]);

/** Oficios adicionales del Partner; el perfil existente se conserva como oficio principal. */
export const professionalServices = pgTable("worky_professional_services", {
  id: serial("id").primaryKey(),
  profesionalId: integer("profesional_id").notNull().references(() => users.id),
  oficio: text("oficio").notNull(),
  categoria: categoryEnum("categoria").notNull(),
  experienciaAnios: integer("experiencia_anios").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("worky_professional_services_unique_idx").on(table.profesionalId, table.oficio)]);

/** Documentación de verificación, siempre privada y separada del portfolio público. */
export const professionalVerificationDocuments = pgTable("worky_professional_verification_documents", {
  id: serial("id").primaryKey(),
  profesionalId: integer("profesional_id").notNull().references(() => users.id),
  tipo: privateDocumentTypeEnum("tipo").notNull(),
  objectPath: text("object_path").notNull(),
  nombre: text("nombre").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  estado: verificationStatusEnum("estado").notNull().default("pending_verification"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("worky_verification_documents_unique_idx").on(table.profesionalId, table.tipo)]);

/**
 * Customer identity evidence is kept separate from Partner approval. Image
 * paths are private and cleared once an administrator resolves the case.
 */
export const clientIdentityVerifications = pgTable("worky_client_identity_verifications", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  estado: clientIdentityVerificationStatusEnum("estado").notNull().default("pending_verification"),
  dniObjectPath: text("dni_object_path"),
  selfieObjectPath: text("selfie_object_path"),
  pendingDecision: clientIdentityVerificationDecisionEnum("pending_decision"),
  reasonCode: text("reason_code"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
  reviewerId: integer("reviewer_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("worky_client_identity_verification_user_idx").on(table.usuarioId),
  index("worky_client_identity_verification_queue_idx").on(table.estado, table.submittedAt),
]);

/**
 * Tracks temporary signed uploads so unsubmitted identity images can be
 * reclaimed and reviewed images can be deleted without retaining their paths.
 */
export const clientVerificationUploads = pgTable("worky_client_verification_uploads", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tipo: clientVerificationDocumentTypeEnum("tipo").notNull(),
  objectPath: text("object_path"),
  reviewObjectPath: text("review_object_path"),
  contentType: text("content_type"),
  sizeBytes: integer("size_bytes"),
  estado: clientVerificationUploadStatusEnum("estado").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("worky_client_verification_upload_object_path_idx").on(table.objectPath),
  index("worky_client_verification_upload_cleanup_idx").on(table.estado, table.createdAt),
  index("worky_client_verification_upload_user_idx").on(table.usuarioId, table.createdAt),
]);

export const settlements = pgTable("worky_settlements", {
  id: serial("id").primaryKey(),
  changaId: integer("changa_id").notNull().references(() => jobs.id),
  profesionalId: integer("profesional_id").notNull().references(() => users.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  status: settlementStatusEnum("status").notNull().default("pendiente"),
  audit: jsonb("audit").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const workyNotifications = pgTable("worky_notifications", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").notNull().references(() => users.id),
  changaId: integer("changa_id").references(() => jobs.id, { onDelete: "set null" }),
  tipo: text("tipo").notNull(),
  titulo: text("titulo").notNull(),
  detalle: text("detalle").notNull(),
  href: text("href"),
  leida: boolean("leida").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("worky_notifications_user_read_idx").on(table.usuarioId, table.leida, table.createdAt)]);

export const workyAuditEvents = pgTable("worky_audit_events", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").references(() => users.id),
  entidad: text("entidad").notNull(),
  entidadId: integer("entidad_id").notNull(),
  accion: text("accion").notNull(),
  estadoAnterior: text("estado_anterior"),
  estadoNuevo: text("estado_nuevo"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("worky_audit_entity_idx").on(table.entidad, table.entidadId, table.createdAt)]);

export const insertUserSchema = createInsertSchema(users);
export const insertProfessionalProfileSchema = createInsertSchema(professionalProfiles);
export const insertJobSchema = createInsertSchema(jobs);
export const insertReviewSchema = createInsertSchema(reviews);
export const insertRecommendationSchema = createInsertSchema(recommendations);
export const insertMessageSchema = createInsertSchema(messages);
export const insertCatalogSchema = createInsertSchema(serviceCatalog);
export const insertAvailabilitySchema = createInsertSchema(professionalAvailability);
export const insertAssetSchema = createInsertSchema(professionalAssets);
export const insertProfessionalServiceSchema = createInsertSchema(professionalServices);
export const insertVerificationDocumentSchema = createInsertSchema(professionalVerificationDocuments);
export const insertBookingSchema = createInsertSchema(bookings);
export const insertPaymentSchema = createInsertSchema(payments);
export const insertCashJobCommissionSchema = createInsertSchema(cashJobCommissions);
export const insertSettlementSchema = createInsertSchema(settlements);
export const insertNotificationSchema = createInsertSchema(workyNotifications);
export const insertAuditEventSchema = createInsertSchema(workyAuditEvents);
export type CashJobCommission = typeof cashJobCommissions.$inferSelect;
export type InsertCashJobCommission = typeof cashJobCommissions.$inferInsert;
