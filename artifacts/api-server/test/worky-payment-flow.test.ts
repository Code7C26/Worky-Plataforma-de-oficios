import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import app from "../src/app";
import { cashJobCommissions, db, bookings, jobs, payments, professionalProfiles, reviews, users, visitPayments, workyAuditEvents, workyNotifications } from "@workspace/db";

const baseUrl = "/api/v1";
const password = "payment-flow-test-password";

async function request(server: http.Server, path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
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
  const emails = [`payment-client-${suffix}@example.test`, `payment-partner-${suffix}@example.test`, `payment-outsider-${suffix}@example.test`];
  const userIds: number[] = [];
  const jobIds: number[] = [];
  const paymentIds: number[] = [];
  const bookingIds: number[] = [];
  const visitPaymentIds: number[] = [];
  const originalNodeEnvironment = process.env.NODE_ENV;
  let profileId: number | undefined;

  try {
    const passwordHash = await bcrypt.hash(password, 4);
    const [client, partner, outsider] = await db.insert(users).values([
      { nombre: "Cliente de prueba", email: emails[0], emailVerifiedAt: new Date(), passwordHash },
      { nombre: "Profesional de prueba", email: emails[1], emailVerifiedAt: new Date(), passwordHash, rol: "profesional" },
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

    const [clientLogin, partnerLogin, outsiderLogin] = await Promise.all(emails.map((email) => request(server, `${baseUrl}/auth/login`, {
      method: "POST", body: { email, password },
    })));
    const clientToken = (clientLogin.body as Record<string, any>).token as string;
    const partnerToken = (partnerLogin.body as Record<string, any>).token as string;
    const outsiderToken = (outsiderLogin.body as Record<string, any>).token as string;
    assert.ok(clientToken && partnerToken && outsiderToken);
    assert.equal((await request(server, `${baseUrl}/partner/saldo-visitas`, { token: clientToken })).status, 403);
    assert.equal((await request(server, `${baseUrl}/partner/saldo-visitas`, { token: outsiderToken })).status, 403);

    const [cashJob] = await db.insert(jobs).values({
      clienteId: client.id,
      profesionalId: partner.id,
      ubicacion: { direccionTexto: "Alta Gracia", ciudad: "Alta Gracia" },
      categoria: "Plomería",
      precioOfrecido: "12500",
      detalle: "Reparación de prueba",
      estado: "en_curso",
      paymentMethod: "efectivo",
    }).returning();
    jobIds.push(cashJob.id);

    assert.equal((await request(server, `${baseUrl}/trabajos/${cashJob.id}`, {
      method: "PATCH", token: clientToken, body: { estado: "finalizada" },
    })).status, 409, "a client cannot directly finalize a job");
    assert.equal((await request(server, `${baseUrl}/trabajos/${cashJob.id}`, {
      method: "PATCH", token: partnerToken, body: { estado: "finalizada" },
    })).status, 409, "a professional cannot skip payment confirmation");
    const workDone = await request(server, `${baseUrl}/trabajos/${cashJob.id}`, {
      method: "PATCH", token: partnerToken, body: { estado: "trabajo_realizado" },
    });
    assert.equal(workDone.status, 200);
    assert.equal((workDone.body as Record<string, any>).estado, "trabajo_realizado");
    assert.equal((await request(server, `${baseUrl}/reviews`, {
      method: "POST", token: clientToken, body: { changaId: cashJob.id, rating: 5 },
    })).status, 409, "reviews remain locked before payment");
    assert.equal((await request(server, `${baseUrl}/trabajos/${cashJob.id}/confirmar-pago-efectivo`, {
      method: "POST", token: outsiderToken,
    })).status, 403);

    const clientConfirmation = await request(server, `${baseUrl}/trabajos/${cashJob.id}/confirmar-pago-efectivo`, {
      method: "POST", token: clientToken,
    });
    assert.equal(clientConfirmation.status, 200);
    assert.equal((clientConfirmation.body as Record<string, any>).estado, "trabajo_realizado");
    assert.equal((clientConfirmation.body as Record<string, any>).cashConfirmedByClient, true);
    assert.equal((clientConfirmation.body as Record<string, any>).cashConfirmedByProfessional, false);
    const [pendingCash] = await db.select().from(payments).where(and(eq(payments.changaId, cashJob.id), eq(payments.provider, "efectivo")));
    assert.equal(pendingCash?.status, "pendiente");
    if (pendingCash) paymentIds.push(pendingCash.id);

    const partnerConfirmation = await request(server, `${baseUrl}/trabajos/${cashJob.id}/confirmar-pago-efectivo`, {
      method: "POST", token: partnerToken,
    });
    assert.equal(partnerConfirmation.status, 200);
    assert.equal((partnerConfirmation.body as Record<string, any>).estado, "finalizada");
    assert.equal((partnerConfirmation.body as Record<string, any>).cashConfirmedByClient, true);
    assert.equal((partnerConfirmation.body as Record<string, any>).cashConfirmedByProfessional, true);
    assert.equal((await db.select().from(payments).where(and(eq(payments.changaId, cashJob.id), eq(payments.provider, "efectivo"))))[0]?.status, "aprobado");
    const [cashJobCommission] = await db.select().from(cashJobCommissions).where(eq(cashJobCommissions.changaId, cashJob.id));
    assert.ok(cashJobCommission);
    assert.equal(Number(cashJobCommission?.amount), 1875, "a confirmed $12,500 cash job creates a 15% commission");
    assert.equal(Number(cashJobCommission?.remainingAmount), 1875);
    assert.equal(cashJobCommission?.status, "due");
    const duplicateConfirmation = await request(server, `${baseUrl}/trabajos/${cashJob.id}/confirmar-pago-efectivo`, {
      method: "POST", token: partnerToken,
    });
    assert.equal(duplicateConfirmation.status, 200);
    assert.equal((await db.select().from(cashJobCommissions).where(eq(cashJobCommissions.changaId, cashJob.id))).length, 1, "duplicate confirmation cannot create a second commission");
    const cashJobBalance = await request(server, `${baseUrl}/partner/saldo-visitas`, { token: partnerToken });
    assert.equal((cashJobBalance.body as Record<string, any>).cashJobCommissionDue, 1875);
    assert.equal((cashJobBalance.body as Record<string, any>).availableAmount, 0);
    await db.delete(workyAuditEvents).where(and(eq(workyAuditEvents.entidad, "cash_job_commission"), eq(workyAuditEvents.entidadId, cashJobCommission.id)));
    await db.delete(cashJobCommissions).where(eq(cashJobCommissions.changaId, cashJob.id));
    assert.equal((await request(server, `${baseUrl}/reviews`, {
      method: "POST", token: clientToken, body: { changaId: cashJob.id, rating: 5 },
    })).status, 201, "review becomes available after both parties confirm");

    const now = Date.now();
    const [oldJob] = await db.insert(jobs).values({
      clienteId: client.id,
      profesionalId: partner.id,
      ubicacion: { direccionTexto: "Alta Gracia" },
      categoria: "Plomería",
      precioOfrecido: "1000",
      detalle: "Checkout impago 1",
      estado: "trabajo_realizado",
      paymentMethod: "mercado_pago",
    }).returning();
    const [recentJob] = await db.insert(jobs).values({
      clienteId: client.id,
      profesionalId: partner.id,
      ubicacion: { direccionTexto: "Alta Gracia" },
      categoria: "Plomería",
      precioOfrecido: "1000",
      detalle: "Checkout reciente",
      estado: "trabajo_realizado",
      paymentMethod: "mercado_pago",
    }).returning();
    jobIds.push(oldJob.id, recentJob.id);
    const [oldAttempt, recentAttempt] = await db.insert(payments).values([
      {
        changaId: oldJob.id, clienteId: client.id, amount: "1000", provider: "mercado_pago",
        providerPreferenceId: `pref-old-${suffix}`, checkoutUrl: "https://sandbox.mercadopago.com.ar/old",
        status: "iniciado", createdAt: new Date(now - 25 * 60 * 60 * 1000),
      },
      {
        changaId: recentJob.id, clienteId: client.id, amount: "1000", provider: "mercado_pago",
        providerPreferenceId: `pref-recent-${suffix}`, checkoutUrl: "https://sandbox.mercadopago.com.ar/recent",
        status: "iniciado", createdAt: new Date(now - 2 * 60 * 60 * 1000),
      },
    ]).returning();
    paymentIds.push(oldAttempt.id, recentAttempt.id);

    const rankBeforeThreshold = await request(server, `${baseUrl}/profesionales?categoria=Plomer%C3%ADa`);
    const listedBeforeThreshold = (rankBeforeThreshold.body as Array<Record<string, any>>).find((item) => item.usuarioId === partner.id);
    assert.equal(listedBeforeThreshold?.visibilityRank, 0, "one overdue checkout and one recent checkout should not penalize visibility");

    await db.update(payments).set({ createdAt: new Date(now - 26 * 60 * 60 * 1000) }).where(eq(payments.id, recentAttempt.id));
    const rankAfterThreshold = await request(server, `${baseUrl}/profesionales?categoria=Plomer%C3%ADa`);
    const listedAfterThreshold = (rankAfterThreshold.body as Array<Record<string, any>>).find((item) => item.usuarioId === partner.id);
    assert.equal(listedAfterThreshold?.visibilityRank, 1, "two separate checkouts unpaid after 24 hours should reduce discovery rank");

    process.env.NODE_ENV = "production";
    const baselineRankingResponse = await request(server, `${baseUrl}/profesionales?categoria=Plomer%C3%ADa`);
    const baselineVisibilityRank = (baselineRankingResponse.body as Array<Record<string, any>>).find((item) => item.usuarioId === partner.id)?.visibilityRank;
    assert.equal(typeof baselineVisibilityRank, "number");

    const scenarios = [
      { name: "none", balanceAmount: 0, remainingDebt: 15, settledStatus: "cash_commission_due" },
      { name: "partial", balanceAmount: 10, remainingDebt: 5, settledStatus: "cash_commission_due" },
      { name: "total", balanceAmount: 30, remainingDebt: 0, settledStatus: "cash_commission_settled" },
    ] as const;
    for (const scenario of scenarios) {
      const [cashBooking] = await db.insert(bookings).values({
        changaId: cashJob.id,
        clienteId: client.id,
        profesionalId: partner.id,
        empiezaAt: new Date(Date.now() - 60_000),
        tarifaVisita: "100",
        estado: "confirmada",
      }).returning();
      bookingIds.push(cashBooking.id);
      const [cashCommission] = await db.insert(visitPayments).values({
        bookingId: cashBooking.id,
        clienteId: client.id,
        profesionalId: partner.id,
        amount: "100",
        commissionAmount: "15",
        partnerAmount: "85",
        method: "efectivo",
        status: "cash_pending_visit",
        partnerArrivedAt: new Date(),
      }).returning();
      visitPaymentIds.push(cashCommission.id);

      if (scenario.balanceAmount > 0) {
        const [balanceBooking] = await db.insert(bookings).values({
          changaId: cashJob.id,
          clienteId: client.id,
          profesionalId: partner.id,
          empiezaAt: new Date(Date.now() - 60_000),
          tarifaVisita: "100",
          estado: "completada",
        }).returning();
        bookingIds.push(balanceBooking.id);
        const [availableBalance] = await db.insert(visitPayments).values({
          bookingId: balanceBooking.id,
          clienteId: client.id,
          profesionalId: partner.id,
          amount: "100",
          commissionAmount: "15",
          partnerAmount: scenario.balanceAmount.toFixed(2),
          method: "mercado_pago",
          status: "available",
          completedAt: new Date(),
          clientConfirmedAt: new Date(),
        }).returning();
        visitPaymentIds.push(availableBalance.id);
      }

      const arrival = await request(server, `${baseUrl}/citas/${cashBooking.id}/llegada`, {
        method: "POST", token: partnerToken,
      });
      assert.equal(arrival.status, 200, `${scenario.name}: Partner arrival must be recorded`);
      const completedVisit = await request(server, `${baseUrl}/citas/${cashBooking.id}/completar`, {
        method: "POST", token: partnerToken,
      });
      assert.equal(completedVisit.status, 200, `${scenario.name}: cash visit should complete`);
      const clientConfirmation = await request(server, `${baseUrl}/citas/${cashBooking.id}/confirmar-visita`, {
        method: "POST", token: clientToken,
      });
      assert.equal(clientConfirmation.status, 200, `${scenario.name}: client can confirm a completed cash visit`);
      assert.equal(clientConfirmation.body.finanzas.status, scenario.settledStatus, `${scenario.name}: client confirmation must not reopen a settled commission`);
      const [remainingCommission] = await db.select().from(visitPayments).where(eq(visitPayments.id, cashCommission.id));
      assert.equal(Number(remainingCommission.commissionAmount), scenario.remainingDebt, `${scenario.name}: debt ledger must hold only the remaining amount`);
      assert.equal(remainingCommission.status, scenario.settledStatus, `${scenario.name}: debt status must reflect whether it remains open`);

      const balanceResponse = await request(server, `${baseUrl}/partner/saldo-visitas`, { token: partnerToken });
      assert.equal(balanceResponse.status, 200);
      const finance = balanceResponse.body as Record<string, any>;
      assert.equal(finance.cashCommissionDue, scenario.remainingDebt, `${scenario.name}: do not count a commission twice`);
      assert.equal(finance.availableAmount, Math.max(0, scenario.balanceAmount - 15), `${scenario.name}: available cash is reduced by the offset only`);

      const rankingResponse = await request(server, `${baseUrl}/partner/recommendation-ranking`, { token: partnerToken });
      assert.equal(rankingResponse.status, 200);
      assert.equal((rankingResponse.body as Record<string, any>).cashVisitCommissionDue, scenario.remainingDebt);
      assert.equal((rankingResponse.body as Record<string, any>).visibilityAdjusted, scenario.remainingDebt > 0);
      const publicRankingResponse = await request(server, `${baseUrl}/profesionales?categoria=Plomer%C3%ADa`);
      const publicRank = (publicRankingResponse.body as Array<Record<string, any>>).find((item) => item.usuarioId === partner.id)?.visibilityRank;
      assert.equal(publicRank, baselineVisibilityRank + (scenario.remainingDebt > 0 ? 1 : 0), `${scenario.name}: paid debt must stop affecting discovery position`);

      await db.delete(workyAuditEvents).where(and(eq(workyAuditEvents.entidad, "visit_payment"), inArray(workyAuditEvents.entidadId, visitPaymentIds)));
      await db.delete(visitPayments).where(inArray(visitPayments.id, visitPaymentIds));
      await db.delete(bookings).where(inArray(bookings.id, bookingIds));
      visitPaymentIds.length = 0;
      bookingIds.length = 0;
    }
  } finally {
    process.env.NODE_ENV = originalNodeEnvironment;
    if (visitPaymentIds.length) await db.delete(workyAuditEvents).where(and(eq(workyAuditEvents.entidad, "visit_payment"), inArray(workyAuditEvents.entidadId, visitPaymentIds)));
    if (visitPaymentIds.length) await db.delete(visitPayments).where(inArray(visitPayments.id, visitPaymentIds));
    if (bookingIds.length) await db.delete(bookings).where(inArray(bookings.id, bookingIds));
    if (paymentIds.length) await db.delete(payments).where(inArray(payments.id, paymentIds));
    if (jobIds.length) {
      const commissions = await db.select({ id: cashJobCommissions.id }).from(cashJobCommissions)
        .where(inArray(cashJobCommissions.changaId, jobIds));
      if (commissions.length) {
        await db.delete(workyAuditEvents).where(and(
          eq(workyAuditEvents.entidad, "cash_job_commission"),
          inArray(workyAuditEvents.entidadId, commissions.map((commission) => commission.id)),
        ));
      }
      await db.delete(cashJobCommissions).where(inArray(cashJobCommissions.changaId, jobIds));
      await db.delete(payments).where(inArray(payments.changaId, jobIds));
      await db.delete(reviews).where(inArray(reviews.changaId, jobIds));
      await db.delete(workyAuditEvents).where(and(eq(workyAuditEvents.entidad, "job"), inArray(workyAuditEvents.entidadId, jobIds)));
      await db.delete(jobs).where(inArray(jobs.id, jobIds));
    }
    if (profileId) await db.delete(professionalProfiles).where(eq(professionalProfiles.id, profileId));
    if (userIds.length) {
      await db.delete(workyNotifications).where(inArray(workyNotifications.usuarioId, userIds));
      await db.delete(workyAuditEvents).where(inArray(workyAuditEvents.usuarioId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

run().then(() => {
  console.log("Worky payment lifecycle and unpaid-checkout ranking tests passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
