import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import app from "../src/app";
import { db, jobs, payments, professionalProfiles, users, workyNotifications } from "@workspace/db";

const baseUrl = "/api/v1";
const password = "notification-context-test-password";

async function request(
  server: http.Server,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
) {
  const address = server.address();
  assert(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Record<string, any> | any[] : null };
}

async function run() {
  const server = app.listen(0);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emails = [
    `notification-client-${suffix}@example.test`,
    `notification-partner-${suffix}@example.test`,
    `notification-outsider-${suffix}@example.test`,
  ];
  const userIds: number[] = [];
  const jobIds: number[] = [];
  let profileId: number | undefined;

  try {
    const passwordHash = await bcrypt.hash(password, 4);
    const [client, partner, outsider] = await db.insert(users).values([
      { nombre: "Cliente de prueba", email: emails[0], emailVerifiedAt: new Date(), passwordHash },
      { nombre: "Worker de prueba", email: emails[1], emailVerifiedAt: new Date(), passwordHash, rol: "profesional" },
      { nombre: "Tercero de prueba", email: emails[2], emailVerifiedAt: new Date(), passwordHash },
    ]).returning();
    userIds.push(client.id, partner.id, outsider.id);

    const [profile] = await db.insert(professionalProfiles).values({
      usuarioId: partner.id,
      oficio: "Plomero",
      categoria: "Plomería",
      precioReferencia: "100",
      habilitado: true,
      verificado: true,
      estadoVerificacion: "verified",
    }).returning({ id: professionalProfiles.id });
    profileId = profile.id;

    const logins = await Promise.all(emails.map((email) => request(server, `${baseUrl}/auth/login`, {
      method: "POST",
      body: { email, password },
    })));
    const [clientToken, partnerToken, outsiderToken] = logins.map((login) => (login.body as Record<string, any>).token as string);
    assert.ok(clientToken && partnerToken && outsiderToken);

    const cashClientConfirmedAt = new Date("2026-11-25T10:20:00.000Z");
    const cashWorkerConfirmedAt = new Date("2026-11-25T10:23:00.000Z");
    const mpConfirmedAt = new Date("2026-11-25T11:35:00.000Z");
    const noticeCreatedAt = new Date("2026-11-25T12:00:00.000Z");
    const [cashJob, mpJob, pendingJob, unassignedJob, privateJob] = await db.insert(jobs).values([
      {
        clienteId: client.id, profesionalId: partner.id, ubicacion: { ciudad: "Alta Gracia" },
        categoria: "Plomería", precioOfrecido: "12500", detalle: "Changa en efectivo",
        estado: "finalizada", paymentMethod: "efectivo",
        cashConfirmedByClientAt: cashClientConfirmedAt, cashConfirmedByProfessionalAt: cashWorkerConfirmedAt,
      },
      {
        clienteId: client.id, profesionalId: partner.id, ubicacion: { ciudad: "Alta Gracia" },
        categoria: "Plomería", precioOfrecido: "18000", detalle: "Changa con Mercado Pago",
        estado: "finalizada", paymentMethod: "mercado_pago",
      },
      {
        clienteId: client.id, profesionalId: partner.id, ubicacion: { ciudad: "Alta Gracia" },
        categoria: "Plomería", precioOfrecido: "9000", detalle: "Pago pendiente",
        estado: "trabajo_realizado", paymentMethod: "mercado_pago",
      },
      {
        clienteId: client.id, profesionalId: null, ubicacion: { ciudad: "Alta Gracia" },
        categoria: "Albañilería", precioOfrecido: "7000", detalle: "Sin asignar",
        estado: "publicada", paymentMethod: "mercado_pago",
      },
      {
        clienteId: outsider.id, profesionalId: partner.id, ubicacion: { ciudad: "Alta Gracia" },
        categoria: "Plomería", precioOfrecido: "30000", detalle: "Trabajo privado de otra cuenta",
        estado: "finalizada", paymentMethod: "mercado_pago",
      },
    ]).returning();
    jobIds.push(cashJob.id, mpJob.id, pendingJob.id, unassignedJob.id, privateJob.id);

    const [cashPayment, mpPayment, pendingPayment] = await db.insert(payments).values([
      {
        changaId: cashJob.id, clienteId: client.id, amount: "12500", provider: "efectivo",
        status: "aprobado", createdAt: cashClientConfirmedAt, updatedAt: cashWorkerConfirmedAt,
      },
      {
        changaId: mpJob.id, clienteId: client.id, amount: "18000", provider: "mercado_pago",
        status: "aprobado", providerPaymentId: `approved-${suffix}`, createdAt: noticeCreatedAt, updatedAt: mpConfirmedAt,
      },
      {
        changaId: pendingJob.id, clienteId: client.id, amount: "9000", provider: "mercado_pago",
        status: "iniciado", providerPreferenceId: `pending-${suffix}`, createdAt: noticeCreatedAt, updatedAt: noticeCreatedAt,
      },
    ]).returning();
    assert.ok(cashPayment && mpPayment && pendingPayment);

    const [cashNotice, mpNotice, pendingNotice, unassignedNotice, genericNotice, privateNotice, legacyNotice] = await db.insert(workyNotifications).values([
      { usuarioId: client.id, changaId: cashJob.id, tipo: "actividad", titulo: "Pago en efectivo confirmado", detalle: "La changa se completó.", href: "/jobs", createdAt: noticeCreatedAt },
      { usuarioId: client.id, changaId: mpJob.id, tipo: "actividad", titulo: "Pago confirmado", detalle: "Mercado Pago confirmó el cobro.", href: "/jobs", createdAt: new Date(noticeCreatedAt.getTime() - 1) },
      { usuarioId: partner.id, changaId: pendingJob.id, tipo: "actividad", titulo: "Pago pendiente", detalle: "Esperando confirmación.", href: "/jobs", createdAt: new Date(noticeCreatedAt.getTime() - 2) },
      { usuarioId: client.id, changaId: unassignedJob.id, tipo: "actividad", titulo: "Nueva changa", detalle: "Aún sin Worker.", href: "/jobs", createdAt: new Date(noticeCreatedAt.getTime() - 3) },
      { usuarioId: client.id, tipo: "actividad", titulo: "Aviso general", detalle: "Sin relación con una changa.", href: "/profile", createdAt: new Date(noticeCreatedAt.getTime() - 4) },
      { usuarioId: client.id, changaId: privateJob.id, tipo: "actividad", titulo: "Referencia inválida", detalle: "No debe filtrar datos.", href: "/jobs", createdAt: new Date(noticeCreatedAt.getTime() - 5) },
      { usuarioId: client.id, tipo: "actividad", titulo: "Aviso histórico", detalle: "Se enlaza con el chat.", href: `/chat/${cashJob.id}`, createdAt: new Date(noticeCreatedAt.getTime() - 6) },
    ]).returning();

    const clientList = await request(server, `${baseUrl}/notificaciones`, { token: clientToken });
    assert.equal(clientList.status, 200);
    const clientItems = (clientList.body as Record<string, any>).items as Array<Record<string, any>>;
    const itemByTitle = new Map(clientItems.map((item) => [item.titulo, item]));
    const cashContext = itemByTitle.get("Pago en efectivo confirmado")?.jobContext;
    assert.equal(cashContext?.price, 12500);
    assert.equal(cashContext?.paymentMethod, "efectivo");
    assert.equal(cashContext?.paymentStatus, "aprobado");
    assert.equal(cashContext?.paymentConfirmedAt, cashWorkerConfirmedAt.toISOString(), "cash confirmation uses the later participant confirmation, not notification time");
    assert.equal(cashContext?.workerName, "Worker de prueba");
    assert.equal(cashContext?.trade, "Plomero");

    const mpContext = itemByTitle.get("Pago confirmado")?.jobContext;
    assert.equal(mpContext?.paymentConfirmedAt, mpConfirmedAt.toISOString(), "Mercado Pago confirmation uses the server payment record");
    assert.notEqual(mpContext?.paymentConfirmedAt, itemByTitle.get("Pago confirmado")?.createdAt);
    assert.equal(mpContext?.price, 18000);

    const legacyContext = itemByTitle.get("Aviso histórico")?.jobContext;
    assert.equal(legacyContext?.changaId, cashJob.id, "old chat links still resolve a job context");
    assert.equal(itemByTitle.get("Aviso general")?.jobContext, null, "general notifications remain without job details");
    assert.equal(itemByTitle.get("Referencia inválida")?.jobContext, null, "a notification cannot expose a job unrelated to its owner");
    assert.equal(itemByTitle.get("Referencia inválida")?.changaId, null);
    assert.equal(itemByTitle.get("Nueva changa")?.jobContext?.workerName, null, "unassigned work does not invent a Worker");
    assert.equal(itemByTitle.get("Nueva changa")?.jobContext?.trade, "Albañilería");

    const partnerList = await request(server, `${baseUrl}/notificaciones`, { token: partnerToken });
    const partnerItem = ((partnerList.body as Record<string, any>).items as Array<Record<string, any>>)
      .find((item) => item.titulo === "Pago pendiente");
    assert.equal(partnerItem?.jobContext?.paymentStatus, "iniciado");
    assert.equal(partnerItem?.jobContext?.paymentConfirmedAt, null, "unconfirmed payments must not show a made-up time");
    assert.equal(partnerItem?.jobContext?.price, 9000);

    const outsiderList = await request(server, `${baseUrl}/notificaciones`, { token: outsiderToken });
    assert.deepEqual((outsiderList.body as Record<string, any>).items, []);

    const markedRead = await request(server, `${baseUrl}/notificaciones/${cashNotice.id}/leida`, {
      method: "PATCH",
      token: clientToken,
    });
    assert.equal(markedRead.status, 200, "mark-read behavior remains available");
    const afterRead = await request(server, `${baseUrl}/notificaciones`, { token: clientToken });
    const rereadCash = ((afterRead.body as Record<string, any>).items as Array<Record<string, any>>)
      .find((item) => item.id === cashNotice.id);
    assert.equal(rereadCash?.leida, true);
    assert.equal(rereadCash?.jobContext?.changaId, cashJob.id);
  } finally {
    if (userIds.length) await db.delete(workyNotifications).where(inArray(workyNotifications.usuarioId, userIds));
    if (jobIds.length) {
      await db.delete(payments).where(inArray(payments.changaId, jobIds));
      await db.delete(jobs).where(inArray(jobs.id, jobIds));
    }
    if (profileId) await db.delete(professionalProfiles).where(eq(professionalProfiles.id, profileId));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
