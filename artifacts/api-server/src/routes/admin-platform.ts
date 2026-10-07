import { Router, type IRouter } from "express";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  jobs,
  professionalProfiles,
  professionalServices,
  professionalVerificationDocuments,
  serviceCatalog,
  users,
  workyAuditEvents,
  workyNotifications,
} from "@workspace/db";
import { requireWorkyAdmin } from "../middlewares/workyAdminAuth";

const router: IRouter = Router();
const admin: IRouter = Router();

const requestStatuses = {
  publicada: "new",
  aceptada: "assigned",
  en_curso: "under_review",
  finalizada: "completed",
  cancelada: "cancelled",
} as const;

const requestStatusToDb = {
  new: "publicada",
  assigned: "aceptada",
  under_review: "en_curso",
  completed: "finalizada",
  cancelled: "cancelada",
} as const;

const validCategories = ["Plomería", "Electricidad", "Gas", "Albañilería", "Otro"] as const;
type AdminRequestStatus = keyof typeof requestStatusToDb;

function pathId(value: string | string[] | undefined): number | null {
  const text = Array.isArray(value) ? value[0] : value;
  if (!text || !/^[1-9]\d*$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

function queryText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function locationLabel(location: unknown): string {
  if (!location || typeof location !== "object" || Array.isArray(location)) return "Sin zona";
  const values = location as Record<string, unknown>;
  const parts = [values.barrio, values.localidad, values.ciudad, values.provincia, values.direccionTexto]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => part.trim());
  return parts.length ? [...new Set(parts)].join(", ") : "Sin zona";
}

function requestStatus(status: string): string {
  return Object.hasOwn(requestStatuses, status) ? requestStatuses[status as keyof typeof requestStatuses] : "new";
}

async function audit(
  executor: Pick<typeof db, "insert">,
  usuarioId: number,
  entidad: string,
  entidadId: number,
  accion: string,
  estadoAnterior: string | null,
  estadoNuevo: string | null,
  metadata: Record<string, unknown> = {},
) {
  await executor.insert(workyAuditEvents).values({
    usuarioId,
    entidad,
    entidadId,
    accion,
    estadoAnterior,
    estadoNuevo,
    metadata,
  });
}

admin.use(requireWorkyAdmin);

admin.get("/overview", async (_req, res): Promise<void> => {
  const [
    [householdCount],
    [professionalCount],
    [pendingCount],
    [enabledCount],
    [openRequestCount],
    [newRequestCount],
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.rol, "cliente")),
    db.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.rol, "profesional")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .leftJoin(professionalProfiles, eq(professionalProfiles.usuarioId, users.id))
      .where(
        and(
          eq(users.rol, "profesional"),
          or(isNull(professionalProfiles.id), eq(professionalProfiles.estadoVerificacion, "pending_verification")),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .innerJoin(professionalProfiles, eq(professionalProfiles.usuarioId, users.id))
      .where(and(eq(users.rol, "profesional"), eq(users.activo, true), eq(professionalProfiles.verificado, true))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(inArray(jobs.estado, ["publicada", "aceptada", "en_curso"])),
    db.select({ count: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.estado, "publicada")),
  ]);

  res.json({
    householdCount: householdCount?.count ?? 0,
    professionalCount: professionalCount?.count ?? 0,
    pendingProfessionalCount: pendingCount?.count ?? 0,
    enabledProfessionalCount: enabledCount?.count ?? 0,
    openRequestCount: openRequestCount?.count ?? 0,
    newRequestCount: newRequestCount?.count ?? 0,
  });
});

admin.get("/households", async (req, res): Promise<void> => {
  const search = queryText(req.query.search);
  const rows = await db
    .select()
    .from(users)
    .where(
      search
        ? and(
            eq(users.rol, "cliente"),
            or(ilike(users.nombre, `%${search}%`), ilike(users.email, `%${search}%`), ilike(users.telefono, `%${search}%`)),
          )
        : eq(users.rol, "cliente"),
    )
    .orderBy(desc(users.createdAt))
    .limit(500);

  res.json(
    rows.map((account) => ({
      id: String(account.id),
      fullName: account.nombre,
      email: account.email,
      phone: account.telefono ?? "",
      zone: locationLabel(account.ubicacion),
      active: account.activo,
      createdAt: account.createdAt.toISOString(),
    })),
  );
});

admin.patch("/households/:id", async (req, res): Promise<void> => {
  const id = pathId(req.params.id);
  if (!id || typeof req.body?.active !== "boolean") {
    res.status(400).json({ error: "Indicá si la cuenta debe quedar activa." });
    return;
  }
  const [account] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.rol, "cliente")))
    .limit(1);
  if (!account) {
    res.status(404).json({ error: "No encontramos ese hogar." });
    return;
  }
  if (!req.body.active) {
    const [openJob] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.clienteId, id), inArray(jobs.estado, ["publicada", "aceptada", "en_curso"])))
      .limit(1);
    if (openJob) {
      res.status(409).json({ error: "Primero resolvé las solicitudes abiertas de este hogar." });
      return;
    }
  }
  await db.transaction(async (tx) => {
    await tx.update(users).set({ activo: req.body.active, updatedAt: new Date() }).where(eq(users.id, id));
    await audit(
      tx,
      req.usuarioId!,
      "household",
      id,
      req.body.active ? "admin_household_reactivated" : "admin_household_paused",
      account.activo ? "active" : "paused",
      req.body.active ? "active" : "paused",
    );
  });
  res.json({ id: String(id), active: req.body.active });
});

admin.get("/professionals", async (req, res): Promise<void> => {
  const search = queryText(req.query.search);
  const status = queryText(req.query.status);
  if (status && !["pending_review", "enabled", "paused", "rejected"].includes(status)) {
    res.status(400).json({ error: "Filtro de estado de profesional inválido." });
    return;
  }
  const result = await db
    .select({ account: users, profile: professionalProfiles })
    .from(users)
    .leftJoin(professionalProfiles, eq(professionalProfiles.usuarioId, users.id))
    .where(and(
      eq(users.rol, "profesional"),
      search
        ? or(
              ilike(users.nombre, `%${search}%`),
              ilike(users.email, `%${search}%`),
              ilike(users.telefono, `%${search}%`),
              ilike(professionalProfiles.oficio, `%${search}%`),
              sql`${professionalProfiles.categoria}::text ILIKE ${`%${search}%`}`,
            )
        : undefined,
      status === "pending_review"
        ? and(
            eq(users.activo, true),
            or(
              isNull(professionalProfiles.id),
              and(
                eq(professionalProfiles.verificado, false),
                or(isNull(professionalProfiles.estadoVerificacion), eq(professionalProfiles.estadoVerificacion, "pending_verification")),
              ),
            ),
          )
        : status === "enabled"
          ? and(
              eq(users.activo, true),
              eq(professionalProfiles.verificado, true),
              or(isNull(professionalProfiles.estadoVerificacion), ne(professionalProfiles.estadoVerificacion, "rejected")),
            )
          : status === "paused"
            ? eq(users.activo, false)
            : status === "rejected"
              ? and(eq(users.activo, true), eq(professionalProfiles.estadoVerificacion, "rejected"))
              : undefined,
    ))
    .orderBy(desc(users.createdAt))
    .limit(500);

  const ids = result.map(({ account }) => account.id);
  const [documents, categories] = ids.length
    ? await Promise.all([
        db
          .select({
            profesionalId: professionalVerificationDocuments.profesionalId,
            estado: professionalVerificationDocuments.estado,
          })
          .from(professionalVerificationDocuments)
          .where(inArray(professionalVerificationDocuments.profesionalId, ids)),
        db.select().from(serviceCatalog),
      ])
    : [[], []];

  const documentCounts = new Map<number, { total: number; pending: number }>();
  for (const document of documents) {
    const current = documentCounts.get(document.profesionalId) ?? { total: 0, pending: 0 };
    current.total += 1;
    if (document.estado === "pending_verification") current.pending += 1;
    documentCounts.set(document.profesionalId, current);
  }

  const rows = result.map(({ account, profile }) => {
    const status = !account.activo
      ? "paused"
      : profile?.estadoVerificacion === "rejected"
        ? "rejected"
        : profile?.verificado
          ? "enabled"
          : "pending_review";
    const catalogItem = profile
      ? categories.find((item) => item.categoria === profile.categoria && item.especialidad === profile.oficio)
      : undefined;
    const docs = documentCounts.get(account.id) ?? { total: 0, pending: 0 };
    return {
      id: String(account.id),
      fullName: account.nombre,
      email: account.email,
      phone: account.telefono ?? "",
      zone: locationLabel(account.ubicacion),
      categoryId: catalogItem ? String(catalogItem.id) : null,
      categoryName: profile?.oficio ?? "Sin oficio informado",
      description: profile?.about ?? "",
      status,
      verified: Boolean(profile?.verificado),
      adminNote: null,
      documentCount: docs.total,
      pendingDocumentCount: docs.pending,
      createdAt: account.createdAt.toISOString(),
    };
  });

  res.json(rows);
});

admin.get("/professionals/:id/verification-documents", async (req, res): Promise<void> => {
  const id = pathId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Profesional inválido." });
    return;
  }
  const [account] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, id), eq(users.rol, "profesional")))
    .limit(1);
  if (!account) {
    res.status(404).json({ error: "No encontramos ese profesional." });
    return;
  }
  const documents = await db
    .select()
    .from(professionalVerificationDocuments)
    .where(eq(professionalVerificationDocuments.profesionalId, id))
    .orderBy(asc(professionalVerificationDocuments.createdAt));
  res.json(
    documents.map((document) => ({
      id: String(document.id),
      professionalId: String(document.profesionalId),
      type: document.tipo,
      name: document.nombre,
      objectPath: document.objectPath,
      contentType: document.contentType,
      status: document.estado,
      createdAt: document.createdAt.toISOString(),
    })),
  );
});

admin.patch("/professionals/:id", async (req, res): Promise<void> => {
  const id = pathId(req.params.id);
  const desiredStatus = queryText(req.body?.status);
  if (!id || !["enabled", "paused"].includes(desiredStatus)) {
    res.status(400).json({ error: "Estado de profesional inválido." });
    return;
  }

  const [account] = await db.select().from(users).where(and(eq(users.id, id), eq(users.rol, "profesional"))).limit(1);
  if (!account) {
    res.status(404).json({ error: "No encontramos ese profesional." });
    return;
  }
  const [profile] = await db
    .select()
    .from(professionalProfiles)
    .where(eq(professionalProfiles.usuarioId, id))
    .limit(1);
  if (desiredStatus === "enabled" && !profile?.verificado) {
    res.status(409).json({ error: "Primero hay que aprobar la documentación del profesional." });
    return;
  }

  const active = desiredStatus === "enabled";
  if (!active) {
    const [openJob] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.profesionalId, id), inArray(jobs.estado, ["publicada", "aceptada", "en_curso"])))
      .limit(1);
    if (openJob) {
      res.status(409).json({ error: "Primero reasigná o resolvé las solicitudes abiertas de este profesional." });
      return;
    }
  }
  await db.transaction(async (tx) => {
    await tx.update(users).set({ activo: active, updatedAt: new Date() }).where(eq(users.id, id));
    await audit(
      tx,
      req.usuarioId!,
      "professional",
      id,
      active ? "admin_account_enabled" : "admin_account_paused",
      account.activo ? "active" : "paused",
      active ? "active" : "paused",
    );
  });

  res.json({ id: String(id), status: desiredStatus });
});

admin.get("/service-requests", async (req, res): Promise<void> => {
  const client = users;
  const professional = alias(users, "worky_admin_professional");
  const search = queryText(req.query.search);
  const status = queryText(req.query.status);
  if (status && !Object.hasOwn(requestStatusToDb, status)) {
    res.status(400).json({ error: "Filtro de estado de solicitud inválido." });
    return;
  }
  const rows = await db
    .select({
      job: jobs,
      householdName: client.nombre,
      professionalName: professional.nombre,
    })
    .from(jobs)
    .innerJoin(client, eq(jobs.clienteId, client.id))
    .leftJoin(professional, eq(jobs.profesionalId, professional.id))
    .where(and(
      search
        ? or(
            sql`${jobs.categoria}::text ILIKE ${`%${search}%`}`,
            ilike(jobs.detalle, `%${search}%`),
            ilike(client.nombre, `%${search}%`),
            ilike(professional.nombre, `%${search}%`),
          )
        : undefined,
      status ? eq(jobs.estado, requestStatusToDb[status as AdminRequestStatus]) : undefined,
    ))
    .orderBy(desc(jobs.createdAt))
    .limit(500);

  const mapped = rows.map(({ job, householdName, professionalName }) => ({
      id: String(job.id),
      title: `${job.categoria} · #${job.id}`,
      description: job.detalle ?? "",
      householdId: String(job.clienteId),
      householdName,
      professionalId: job.profesionalId === null ? null : String(job.profesionalId),
      professionalName: professionalName ?? null,
      categoryId: null,
      categoryName: job.categoria,
      zone: locationLabel(job.ubicacion),
      status: requestStatus(job.estado),
      adminNote: null,
      price: job.precioOfrecido,
      createdAt: job.createdAt.toISOString(),
    }));
  res.json(mapped);
});

admin.patch("/service-requests/:id", async (req, res): Promise<void> => {
  const id = pathId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Solicitud inválida." });
    return;
  }
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) {
    res.status(404).json({ error: "No encontramos esa solicitud." });
    return;
  }

  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  if (Object.hasOwn(body, "adminNote")) {
    res.status(400).json({ error: "Las notas internas no están disponibles en el sistema actual." });
    return;
  }
  const requestedStatus = typeof body.status === "string" ? body.status : null;
  if (requestedStatus && !Object.hasOwn(requestStatusToDb, requestedStatus)) {
    res.status(400).json({ error: "Estado de solicitud inválido." });
    return;
  }

  let profesionalId = job.profesionalId;
  if (Object.hasOwn(body, "professionalId")) {
    if (body.professionalId === null || body.professionalId === "") {
      profesionalId = null;
    } else if (typeof body.professionalId === "string" && /^[1-9]\d*$/.test(body.professionalId)) {
      profesionalId = Number(body.professionalId);
      if (!Number.isSafeInteger(profesionalId)) {
        res.status(400).json({ error: "Profesional inválido." });
        return;
      }
    } else {
      res.status(400).json({ error: "Profesional inválido." });
      return;
    }
  }

  let estado = requestedStatus ? requestStatusToDb[requestedStatus as AdminRequestStatus] : job.estado;
  if (Object.hasOwn(body, "professionalId") && profesionalId !== null && !requestedStatus && estado === "publicada") {
    estado = "aceptada";
  }
  if (["aceptada", "en_curso", "finalizada"].includes(estado) && profesionalId === null) {
    res.status(409).json({ error: "Asigná un profesional antes de cambiar la solicitud a ese estado." });
    return;
  }
  if (profesionalId !== null && profesionalId !== job.profesionalId) {
    const [professional] = await db
      .select({ activo: users.activo, verificado: professionalProfiles.verificado, categoria: professionalProfiles.categoria })
      .from(users)
      .innerJoin(professionalProfiles, eq(professionalProfiles.usuarioId, users.id))
      .where(and(eq(users.id, profesionalId), eq(users.rol, "profesional")))
      .limit(1);
    if (!professional || !professional.activo || !professional.verificado) {
      res.status(409).json({ error: "Solo se pueden asignar profesionales activos y habilitados." });
      return;
    }
    if (professional.categoria !== job.categoria) {
      res.status(409).json({ error: "El oficio del profesional no coincide con esta solicitud." });
      return;
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(jobs)
      .set({ profesionalId, estado, updatedAt: new Date() })
      .where(eq(jobs.id, id));

    await audit(
      tx,
      req.usuarioId!,
      "job",
      id,
      "admin_request_updated",
      job.estado,
      estado,
      { profesionalId },
    );

    if (estado !== job.estado) {
      await tx.insert(workyNotifications).values({
        usuarioId: job.clienteId,
        tipo: "job_status",
        titulo: "Actualizamos tu solicitud",
        detalle: `El estado de tu solicitud de ${job.categoria} cambió.`,
        href: `/trabajos/${job.id}`,
      });
    }
    if (profesionalId !== null && profesionalId !== job.profesionalId) {
      await tx.insert(workyNotifications).values({
        usuarioId: profesionalId,
        tipo: "job_assigned",
        titulo: "Te asignaron una solicitud",
        detalle: `Hay una solicitud de ${job.categoria} para revisar.`,
        href: `/trabajos/${job.id}`,
      });
    }
  });

  res.json({ id: String(id), status: requestStatus(estado), professionalId: profesionalId === null ? null : String(profesionalId) });
});

function serializeCategory(row: typeof serviceCatalog.$inferSelect) {
  return {
    id: String(row.id),
    name: row.especialidad,
    description: row.categoria,
    category: row.categoria,
    active: row.activa,
    createdAt: row.createdAt.toISOString(),
  };
}

admin.get("/categories", async (_req, res): Promise<void> => {
  const rows = await db.select().from(serviceCatalog).orderBy(asc(serviceCatalog.categoria), asc(serviceCatalog.especialidad));
  res.json(rows.map(serializeCategory));
});

admin.post("/categories", async (req, res): Promise<void> => {
  const category = queryText(req.body?.category);
  const specialty = queryText(req.body?.specialty);
  const active = typeof req.body?.active === "boolean" ? req.body.active : true;
  if (!validCategories.includes(category as (typeof validCategories)[number]) || specialty.length < 2 || specialty.length > 80) {
    res.status(400).json({ error: "Completá un rubro y una especialidad válidos." });
    return;
  }

  const [duplicate] = await db
    .select({ id: serviceCatalog.id })
    .from(serviceCatalog)
    .where(and(eq(serviceCatalog.categoria, category), sql`lower(${serviceCatalog.especialidad}) = lower(${specialty})`))
    .limit(1);
  if (duplicate) {
    res.status(409).json({ error: "Esa especialidad ya existe dentro del rubro." });
    return;
  }

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(serviceCatalog)
      .values({ categoria: category, especialidad: specialty, activa: active })
      .returning();
    await audit(tx, req.usuarioId!, "service_catalog", row.id, "admin_category_created", null, active ? "active" : "inactive", {
      categoria: category,
      especialidad: specialty,
    });
    return row;
  });
  res.status(201).json(serializeCategory(created));
});

admin.patch("/categories/:id", async (req, res): Promise<void> => {
  const id = pathId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Categoría inválida." });
    return;
  }
  const [current] = await db.select().from(serviceCatalog).where(eq(serviceCatalog.id, id)).limit(1);
  if (!current) {
    res.status(404).json({ error: "No encontramos esa especialidad." });
    return;
  }

  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const category = Object.hasOwn(body, "category") ? queryText(body.category) : current.categoria;
  const specialty = Object.hasOwn(body, "specialty") ? queryText(body.specialty) : current.especialidad;
  const active = typeof body.active === "boolean" ? body.active : current.activa;
  if (!validCategories.includes(category as (typeof validCategories)[number]) || specialty.length < 2 || specialty.length > 80) {
    res.status(400).json({ error: "Completá un rubro y una especialidad válidos." });
    return;
  }

  const [duplicate] = await db
    .select({ id: serviceCatalog.id })
    .from(serviceCatalog)
    .where(
      and(
        eq(serviceCatalog.categoria, category),
        sql`lower(${serviceCatalog.especialidad}) = lower(${specialty})`,
        sql`${serviceCatalog.id} <> ${id}`,
      ),
    )
    .limit(1);
  if (duplicate) {
    res.status(409).json({ error: "Esa especialidad ya existe dentro del rubro." });
    return;
  }

  if (category !== current.categoria || specialty !== current.especialidad) {
    const [profileUse, serviceUse] = await Promise.all([
      db
        .select({ id: professionalProfiles.id })
        .from(professionalProfiles)
        .where(
          and(
            eq(professionalProfiles.categoria, current.categoria as (typeof validCategories)[number]),
            eq(professionalProfiles.oficio, current.especialidad),
          ),
        )
        .limit(1),
      db
        .select({ id: professionalServices.id })
        .from(professionalServices)
        .where(
          and(
            eq(professionalServices.categoria, current.categoria as (typeof validCategories)[number]),
            eq(professionalServices.oficio, current.especialidad),
          ),
        )
        .limit(1),
    ]);
    if (profileUse.length || serviceUse.length) {
      res.status(409).json({ error: "Hay profesionales que usan esta especialidad. Desactivala y creá una nueva para evitar cambiar sus perfiles." });
      return;
    }
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(serviceCatalog)
      .set({ categoria: category, especialidad: specialty, activa: active, updatedAt: new Date() })
      .where(eq(serviceCatalog.id, id))
      .returning();
    await audit(tx, req.usuarioId!, "service_catalog", id, "admin_category_updated", current.activa ? "active" : "inactive", active ? "active" : "inactive", {
      categoria: category,
      especialidad: specialty,
    });
    return row;
  });
  res.json(serializeCategory(updated));
});

admin.delete("/categories/:id", async (req, res): Promise<void> => {
  const id = pathId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Categoría inválida." });
    return;
  }
  const [current] = await db.select().from(serviceCatalog).where(eq(serviceCatalog.id, id)).limit(1);
  if (!current) {
    res.status(404).json({ error: "No encontramos esa especialidad." });
    return;
  }
  const category = validCategories.find((value) => value === current.categoria);
  if (!category) {
    res.status(409).json({ error: "Este rubro no está disponible para el catálogo actual." });
    return;
  }
  const [profileUse] = await db
    .select({ id: professionalProfiles.id })
    .from(professionalProfiles)
    .where(and(eq(professionalProfiles.categoria, category), eq(professionalProfiles.oficio, current.especialidad)))
    .limit(1);
  const [serviceUse] = await db
    .select({ id: professionalServices.id })
    .from(professionalServices)
    .where(and(eq(professionalServices.categoria, category), eq(professionalServices.oficio, current.especialidad)))
    .limit(1);
  if (profileUse || serviceUse) {
    res.status(409).json({ error: "No se puede borrar: hay profesionales que usan esta especialidad. Desactivala en su lugar." });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(serviceCatalog).where(eq(serviceCatalog.id, id));
    await audit(tx, req.usuarioId!, "service_catalog", id, "admin_category_deleted", current.activa ? "active" : "inactive", "deleted", {
      categoria: current.categoria,
      especialidad: current.especialidad,
    });
  });
  res.sendStatus(204);
});

router.use("/admin", admin);
export default router;
