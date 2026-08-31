import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const roleEnum = pgEnum("worky_role", ["cliente", "profesional", "admin"]);
export const categoryEnum = pgEnum("worky_category", ["Plomería", "Electricidad", "Gas", "Albañilería", "Otro"]);
export const jobStatusEnum = pgEnum("worky_job_status", ["publicada", "aceptada", "en_curso", "finalizada", "cancelada"]);
export const availabilityStatusEnum = pgEnum("worky_availability_status", ["disponible", "ocupado", "pausado"]);
export const assetTypeEnum = pgEnum("worky_asset_type", ["portfolio", "foto", "video"]);
export const bookingStatusEnum = pgEnum("worky_booking_status", ["solicitada", "confirmada", "en_curso", "completada", "cancelada"]);
export const paymentStatusEnum = pgEnum("worky_payment_status", ["pendiente", "iniciado", "aprobado", "rechazado", "reembolsado"]);
export const settlementStatusEnum = pgEnum("worky_settlement_status", ["pendiente", "en_revision", "pagada", "retenida", "cancelada"]);
export const recommendationVisibilityEnum = pgEnum("worky_recommendation_visibility", ["publica", "privada"]);
export const onboardingStatusEnum = pgEnum("worky_onboarding_status", ["registration_started", "basic_info_completed", "professional_verification_pending", "onboarding_completed"]);
export const verificationStatusEnum = pgEnum("worky_verification_status", ["pending_verification", "verified", "rejected"]);
export const privateDocumentTypeEnum = pgEnum("worky_private_document_type", ["dni_frente", "dni_dorso", "antecedentes_penales"]);
export const chatUploadStatusEnum = pgEnum("worky_chat_upload_status", ["pending", "associated", "deleting", "deleted"]);
export const profilePhotoUploadStatusEnum = pgEnum("worky_profile_photo_upload_status", ["pending", "associated", "deleting", "deleted"]);
export const profilePhotoVariantEnum = pgEnum("worky_profile_photo_variant", ["source", "rendered"]);

export const users = pgTable("worky_users", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  telefono: text("telefono"),
  edad: integer("edad"),
  fotoObjectPath: text("foto_object_path"),
  onboardingEstado: onboardingStatusEnum("onboarding_estado").notNull().default("registration_started"),
  onboardingPaso: integer("onboarding_paso").notNull().default(1),
  onboardingRespuestas: jsonb("onboarding_respuestas").notNull().default({}),
  rol: roleEnum("rol").notNull().default("cliente"),
  ubicacion: jsonb("ubicacion"),
  activo: boolean("activo").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("worky_users_email_idx").on(table.email)]);

export const professionalProfiles = pgTable("worky_professional_profiles", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").notNull().unique().references(() => users.id),
  oficio: text("oficio").notNull(),
  categoria: categoryEnum("categoria").notNull(),
  matriculaHabilitante: text("matricula_habilitante"),
  verificado: boolean("verificado").notNull().default(false),
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
}, (table) => [index("worky_profiles_category_idx").on(table.categoria)]);

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
  texto: text("texto").notNull(),
  adjuntos: jsonb("adjuntos").notNull().default([]),
  leido: boolean("leido").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("worky_messages_job_idx").on(table.changaId, table.createdAt)]);

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
  estado: bookingStatusEnum("estado").notNull().default("solicitada"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("worky_bookings_professional_date_idx").on(table.profesionalId, table.empiezaAt)]);

export const payments = pgTable("worky_payments", {
  id: serial("id").primaryKey(),
  changaId: integer("changa_id").notNull().references(() => jobs.id),
  clienteId: integer("cliente_id").notNull().references(() => users.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("ARS"),
  status: paymentStatusEnum("status").notNull().default("pendiente"),
  provider: text("provider").notNull().default("mercado_pago"),
  providerPaymentId: text("provider_payment_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

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
export const insertSettlementSchema = createInsertSchema(settlements);
export const insertNotificationSchema = createInsertSchema(workyNotifications);
export const insertAuditEventSchema = createInsertSchema(workyAuditEvents);