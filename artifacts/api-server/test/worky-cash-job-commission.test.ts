import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import app from "../src/app";
import {
  bookings,
  cashJobCommissions,
  db,
  jobs,
  payments,
  professionalProfiles,
  users,
  visitPayments,
  workyAuditEvents,
  workyNotifications,
} from "@workspace/db";

const baseUrl = "/api/v1";

async function request(server: http.Server, path: string, options: { method?: string; token?: string } = {}) {
  const address = server.address();
  assert(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: options.method ?? "GET",
    headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Record<string, any> : null };
}

async function run() {
  const server = app.listen(0);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emails = [
    `cash-commission-client-${suffix}@example.test`,
    `cash-commission-partner-${suffix}@example.test`,
    `cash-commission-outsider-${suffix}@example.test`,
  ];
  const userIds: number[] = [];
  const jobIds: number[] = [];
  const bookingIds: number[] = [];
  const visitPaymentIds: number[] = [];
  let professionalProfileId: number | undefined;
  const commissionIds: number[] = [];

  try {
    const passwordHash = await bcrypt.hash("cash-commission-test-password", 4);
    const [client, partner, outsider] = await db.insert(users).values([
      { nombre: "Cliente de prueba", email: emails[0], emailVerifiedAt: new Date(), passwordHash },
      { nombre: "Partner de prueba", email: emails[1], emailVerifiedAt: new Date(), passwordHash, rol: "profesional" },
      { nombre: "Otra cuenta", email: emails[2], emailVerifiedAt: new Date(), passwordHash },
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
    professionalProfileId = profile.id;

    const address = server.address();
    assert(address && typeof address !== "string");
    const loginResponses = await Promise.all(emails.map((email) => fetch(`http://127.0.0.1:${address.port}${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "cash-commission-test-password" }),
    }).then(async (response) => ({ status: response.status, body: await response.json() as Record<string, any> }))));
    assert.deepEqual(loginResponses.map((response) => response.status), [200, 200, 200]);
    const clientToken = loginResponses[0].body.token as string;
    const partnerToken = loginResponses[1].body.token as string;
    const outsiderToken = loginResponses[2].body.token as string;
    assert.ok(clientToken && partnerToken && outsiderToken);
    assert.equal((await request(server, `${baseUrl}/partner/saldo-visitas`, { token: clientToken })).status, 403);
    assert.equal((await request(server, `${baseUrl}/partner/saldo-visitas`, { token: outsiderToken })).status, 403);

    const createJob = async (price: string, paymentMethod: "efectivo" | "mercado_pago") => {
      const [job] = await db.insert(jobs).values({
        clienteId: client.id,
        profesionalId: partner.id,
        ubicacion: { direccionTexto: "Alta Gracia", ciudad: "Alta Gracia" },
        categoria: "Plomería",
        precioOfrecido: price,
        detalle: "Trabajo de prueba",
        estado: "trabajo_realizado",
        paymentMethod,
        trabajoRealizadoAt: new Date(),
      }).returning();
      jobIds.push(job.id);
      return job;
    };
    const confirmCashJob = async (jobId: number) => {
      const clientConfirmation = await request(server, `${baseUrl}/trabajos/${jobId}/confirmar-pago-efectivo`, {
        method: "POST",
        token: clientToken,
      });
      assert.equal(clientConfirmation.status, 200, "client can confirm their cash payment");
      const [beforePartnerConfirmation] = await db.select().from(cashJobCommissions)
        .where(eq(cashJobCommissions.changaId, jobId));
      assert.equal(beforePartnerConfirmation, undefined, "one confirmation must not accrue a commission yet");

      const partnerConfirmation = await request(server, `${baseUrl}/trabajos/${jobId}/confirmar-pago-efectivo`, {
        method: "POST",
        token: partnerToken,
      });
      assert.equal(partnerConfirmation.status, 200, "Partner can confirm their cash payment");
      const [commission] = await db.select().from(cashJobCommissions)
        .where(eq(cashJobCommissions.changaId, jobId));
      assert.ok(commission, "mutual cash confirmation creates the commission");
      commissionIds.push(commission.id);
      return commission;
    };

    const firstJob = await createJob("200.00", "efectivo");
    const firstCommission = await confirmCashJob(firstJob.id);
    assert.equal(Number(firstCommission.amount), 30);
    assert.equal(Number(firstCommission.remainingAmount), 30);
    assert.equal(firstCommission.status, "due");

    const duplicateConfirmation = await request(server, `${baseUrl}/trabajos/${firstJob.id}/confirmar-pago-efectivo`, {
      method: "POST",
      token: partnerToken,
    });
    assert.equal(duplicateConfirmation.status, 200);
    assert.equal((await db.select().from(cashJobCommissions).where(eq(cashJobCommissions.changaId, firstJob.id))).length, 1);

    const addAvailableVisitBalance = async (amount: string) => {
      const [booking] = await db.insert(bookings).values({
        changaId: firstJob.id,
        clienteId: client.id,
        profesionalId: partner.id,
        empiezaAt: new Date(Date.now() - 60_000),
        tarifaVisita: amount,
        estado: "completada",
      }).returning();
      bookingIds.push(booking.id);
      const [visitPayment] = await db.insert(visitPayments).values({
        bookingId: booking.id,
        clienteId: client.id,
        profesionalId: partner.id,
        amount,
        commissionAmount: "0",
        partnerAmount: amount,
        method: "mercado_pago",
        status: "available",
        completedAt: new Date(),
        clientConfirmedAt: new Date(),
      }).returning();
      visitPaymentIds.push(visitPayment.id);
    };

    const unpaidBalance = await request(server, `${baseUrl}/partner/saldo-visitas`, { token: partnerToken });
    assert.equal(unpaidBalance.status, 200);
    assert.equal(unpaidBalance.body.cashJobCommissionDue, 30);
    assert.equal(unpaidBalance.body.availableAmount, 0);

    await addAvailableVisitBalance("10.00");
    const partialOffset = await request(server, `${baseUrl}/partner/saldo-visitas`, { token: partnerToken });
    assert.equal(partialOffset.body.cashJobCommissionDue, 20);
    assert.equal(partialOffset.body.availableAmount, 0);
    const [partiallyPaidCommission] = await db.select().from(cashJobCommissions)
      .where(eq(cashJobCommissions.changaId, firstJob.id));
    assert.equal(Number(partiallyPaidCommission.remainingAmount), 20);
    assert.equal(partiallyPaidCommission.status, "due");

    await addAvailableVisitBalance("30.00");
    const fullyOffset = await request(server, `${baseUrl}/partner/saldo-visitas`, { token: partnerToken });
    assert.equal(fullyOffset.body.cashJobCommissionDue, 0);
    assert.equal(fullyOffset.body.availableAmount, 10);
    const [settledCommission] = await db.select().from(cashJobCommissions)
      .where(eq(cashJobCommissions.changaId, firstJob.id));
    assert.equal(Number(settledCommission.remainingAmount), 0);
    assert.equal(settledCommission.status, "settled");
    assert.ok(settledCommission.settledAt);

    const repeatedBalance = await request(server, `${baseUrl}/partner/saldo-visitas`, { token: partnerToken });
    assert.equal(repeatedBalance.body.cashJobCommissionDue, 0);
    assert.equal(repeatedBalance.body.availableAmount, 10, "re-reading a settled balance cannot deduct twice");

    const secondJob = await createJob("50.00", "efectivo");
    const secondCommission = await confirmCashJob(secondJob.id);
    assert.equal(Number(secondCommission.amount), 7.5);
    assert.equal(secondCommission.status, "settled", "a new cash commission is immediately offset from available balance");
    const afterNewCashJob = await request(server, `${baseUrl}/partner/saldo-visitas`, { token: partnerToken });
    assert.equal(afterNewCashJob.body.cashJobCommissionDue, 0);
    assert.equal(afterNewCashJob.body.availableAmount, 2.5);

    const onlineJob = await createJob("200.00", "mercado_pago");
    const wrongMethodConfirmation = await request(server, `${baseUrl}/trabajos/${onlineJob.id}/confirmar-pago-efectivo`, {
      method: "POST",
      token: clientToken,
    });
    assert.equal(wrongMethodConfirmation.status, 409);
    assert.equal((await db.select().from(cashJobCommissions).where(eq(cashJobCommissions.changaId, onlineJob.id))).length, 0);
  } finally {
    server.close();
    if (commissionIds.length) {
      await db.delete(workyAuditEvents).where(and(
        eq(workyAuditEvents.entidad, "cash_job_commission"),
        inArray(workyAuditEvents.entidadId, commissionIds),
      ));
    }
    if (jobIds.length) await db.delete(cashJobCommissions).where(inArray(cashJobCommissions.changaId, jobIds));
    if (visitPaymentIds.length) {
      await db.delete(workyAuditEvents).where(and(
        eq(workyAuditEvents.entidad, "visit_payment"),
        inArray(workyAuditEvents.entidadId, visitPaymentIds),
      ));
      await db.delete(visitPayments).where(inArray(visitPayments.id, visitPaymentIds));
    }
    if (bookingIds.length) await db.delete(bookings).where(inArray(bookings.id, bookingIds));
    if (jobIds.length) {
      await db.delete(payments).where(inArray(payments.changaId, jobIds));
      await db.delete(workyAuditEvents).where(and(eq(workyAuditEvents.entidad, "job"), inArray(workyAuditEvents.entidadId, jobIds)));
      await db.delete(jobs).where(inArray(jobs.id, jobIds));
    }
    if (professionalProfileId) await db.delete(professionalProfiles).where(eq(professionalProfiles.id, professionalProfileId));
    if (userIds.length) {
      await db.delete(workyNotifications).where(inArray(workyNotifications.usuarioId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  }
}

run().then(() => {
  console.log("Cash job commission flow passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
