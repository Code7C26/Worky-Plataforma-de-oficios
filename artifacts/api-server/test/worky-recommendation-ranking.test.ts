import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import app from "../src/app";
import {
  db,
  jobs,
  messages,
  payments,
  professionalProfiles,
  users,
  workyAuditEvents,
} from "@workspace/db";
import {
  calculateVisibilityRank,
  isReviewableActivitySignal,
  shouldActivatePaidJobRanking,
} from "../src/lib/recommendation-ranking";

const baseUrl = "/api/v1";
const password = "recommendation-ranking-test-password";
const previousNodeEnvironment = process.env.NODE_ENV;

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
  assert.equal(shouldActivatePaidJobRanking("development", true), false);
  assert.equal(shouldActivatePaidJobRanking("test", true), false);
  assert.equal(shouldActivatePaidJobRanking("production", false), false);
  assert.equal(shouldActivatePaidJobRanking("production", true), true);
  assert.equal(calculateVisibilityRank({
    currentVisibilityRank: 1,
    rankingActive: false,
    cashVisitCommissionDue: 500,
    confirmedRecentIncidents: 8,
  }), 1, "new signals do not change the old rank until the production gate opens");
  assert.equal(calculateVisibilityRank({
    currentVisibilityRank: 0,
    rankingActive: true,
    cashVisitCommissionDue: 0,
    confirmedRecentIncidents: 1,
  }), 0, "one reviewed signal is not enough for a risk penalty");
  assert.equal(calculateVisibilityRank({
    currentVisibilityRank: 0,
    rankingActive: true,
    cashVisitCommissionDue: 200,
    confirmedRecentIncidents: 2,
  }), 2, "confirmed visit debt and two reviewed signals lower visibility without hiding the profile");
  assert.equal(isReviewableActivitySignal({ jobStatus: "cancelada", messageCount: 1, acceptedVisitCount: 0 }), false);
  assert.equal(isReviewableActivitySignal({ jobStatus: "publicada", messageCount: 2, acceptedVisitCount: 1 }), false);
  assert.equal(isReviewableActivitySignal({ jobStatus: "cancelada", messageCount: 1, acceptedVisitCount: 1 }), true);

  const server = app.listen(0);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emails = {
    admin: `ranking-admin-${suffix}@example.test`,
    client: `ranking-client-${suffix}@example.test`,
    partner: `ranking-partner-${suffix}@example.test`,
    otherPartner: `ranking-other-partner-${suffix}@example.test`,
  };
  const userIds: number[] = [];
  const jobIds: number[] = [];
  const paymentIds: number[] = [];
  let originalEnvironment: string | undefined;

  try {
    originalEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    const passwordHash = await bcrypt.hash(password, 4);
    const accounts = await db.insert(users).values([
      { nombre: "Admin ranking", email: emails.admin, emailVerifiedAt: new Date(), passwordHash, rol: "admin" },
      { nombre: "Cliente ranking", email: emails.client, emailVerifiedAt: new Date(), passwordHash },
      { nombre: "Partner ranking", email: emails.partner, emailVerifiedAt: new Date(), passwordHash, rol: "profesional" },
      { nombre: "Partner control", email: emails.otherPartner, emailVerifiedAt: new Date(), passwordHash, rol: "profesional" },
    ]).returning();
    const [admin, client, partner, otherPartner] = accounts;
    userIds.push(...accounts.map((account) => account.id));

    await db.insert(professionalProfiles).values([
      { usuarioId: partner.id, oficio: "Plomero ranking", categoria: "Plomería", precioReferencia: "1000", habilitado: true, verificado: true, estadoVerificacion: "verified" },
      { usuarioId: otherPartner.id, oficio: "Plomero control", categoria: "Plomería", precioReferencia: "1000", habilitado: true, verificado: true, estadoVerificacion: "verified" },
    ]);

    const login = async (email: string) => {
      const result = await request(server, `${baseUrl}/auth/login`, { method: "POST", body: { email, password } });
      assert.equal(result.status, 200);
      return (result.body as { token: string }).token;
    };
    const [adminToken, partnerToken] = await Promise.all([login(emails.admin), login(emails.partner)]);

    const [paidJob] = await db.insert(jobs).values({
      clienteId: client.id,
      profesionalId: partner.id,
      ubicacion: { direccionTexto: "Alta Gracia", ciudad: "Alta Gracia" },
      categoria: "Plomería",
      precioOfrecido: "12000",
      detalle: "Trabajo pagado para probar el gate",
      estado: "finalizada",
      paymentMethod: "efectivo",
    }).returning();
    jobIds.push(paidJob.id);
    const [approvedPayment] = await db.insert(payments).values({
      changaId: paidJob.id,
      clienteId: client.id,
      amount: "12000",
      provider: "efectivo",
      status: "aprobado",
    }).returning();
    paymentIds.push(approvedPayment.id);

    const createReviewableJob = async (detail: string) => {
      const [job] = await db.insert(jobs).values({
        clienteId: client.id,
        profesionalId: partner.id,
        ubicacion: { direccionTexto: "Alta Gracia", ciudad: "Alta Gracia" },
        categoria: "Plomería",
        precioOfrecido: "1000",
        detalle: detail,
        estado: "cancelada",
        paymentMethod: "efectivo",
      }).returning();
      jobIds.push(job.id);
      await db.insert(messages).values({
        changaId: job.id,
        emisorId: client.id,
        texto: "Mensaje de fixture; no se usa en la evaluación.",
      });
      await db.insert(workyAuditEvents).values({
        usuarioId: client.id,
        entidad: "appointment_attempt",
        entidadId: job.id,
        accion: "aceptar",
        estadoNuevo: "exitoso",
        metadata: { appointmentId: job.id },
      });
      return job;
    };
    const firstIncidentJob = await createReviewableJob("Señal candidata 1");
    const secondIncidentJob = await createReviewableJob("Señal candidata 2");

    const rankingBeforeProduction = await request(server, `${baseUrl}/admin/ranking`, { token: adminToken });
    assert.equal(rankingBeforeProduction.status, 200);
    assert.equal((rankingBeforeProduction.body as { active: boolean }).active, false, "approved test data must not open the production gate");

    process.env.NODE_ENV = "production";
    const activeRanking = await request(server, `${baseUrl}/admin/ranking`, { token: adminToken });
    assert.equal(activeRanking.status, 200);
    assert.equal((activeRanking.body as { active: boolean }).active, true);
    const candidates = (activeRanking.body as { candidates: Array<{ jobId: number; messageCount: number; acceptedVisitCount: number }> }).candidates;
    assert.equal(candidates.length, 2);
    assert.ok(candidates.every((candidate) => candidate.messageCount > 0 && candidate.acceptedVisitCount > 0));

    const rankWhileProductionGateClosed = await request(server, `${baseUrl}/profesionales?categoria=Plomer%C3%ADa`);
    assert.equal((rankWhileProductionGateClosed.body as Array<{ usuarioId: number; visibilityRank: number }>).find((item) => item.usuarioId === partner.id)?.visibilityRank, 0);

    const confirmIncident = (jobId: number) => request(server, `${baseUrl}/admin/ranking/incidents/${jobId}`, {
      method: "POST",
      token: adminToken,
      body: { decision: "confirmed", reason: "Señal operativa revisada con evidencia objetiva." },
    });
    assert.equal((await confirmIncident(firstIncidentJob.id)).status, 200);
    const duplicateDecision = await confirmIncident(firstIncidentJob.id);
    assert.equal((duplicateDecision.body as { unchanged: boolean }).unchanged, true, "repeated review requests must not create duplicate signals");

    const oneReviewedSignal = await request(server, `${baseUrl}/partner/recommendation-ranking`, { token: partnerToken });
    assert.equal((oneReviewedSignal.body as { confirmedRecentIncidentCount: number; visibilityAdjusted: boolean }).confirmedRecentIncidentCount, 1);
    assert.equal((oneReviewedSignal.body as { visibilityAdjusted: boolean }).visibilityAdjusted, false);
    assert.equal((await request(server, `${baseUrl}/profesionales?categoria=Plomer%C3%ADa`)).status, 200);
    const rankAfterOneSignal = await request(server, `${baseUrl}/profesionales?categoria=Plomer%C3%ADa`);
    assert.equal((rankAfterOneSignal.body as Array<{ usuarioId: number; visibilityRank: number }>).find((item) => item.usuarioId === partner.id)?.visibilityRank, 0);

    assert.equal((await confirmIncident(secondIncidentJob.id)).status, 200);
    const twoReviewedSignals = await request(server, `${baseUrl}/partner/recommendation-ranking`, { token: partnerToken });
    assert.equal((twoReviewedSignals.body as { confirmedRecentIncidentCount: number; visibilityAdjusted: boolean }).confirmedRecentIncidentCount, 2);
    assert.equal((twoReviewedSignals.body as { visibilityAdjusted: boolean }).visibilityAdjusted, true);
    const rankAfterTwoSignals = await request(server, `${baseUrl}/profesionales?categoria=Plomer%C3%ADa`);
    const rankingRows = rankAfterTwoSignals.body as Array<{ usuarioId: number; visibilityRank: number }>;
    assert.equal(rankingRows.find((item) => item.usuarioId === partner.id)?.visibilityRank, 1);
    assert.equal(rankingRows.find((item) => item.usuarioId === otherPartner.id)?.visibilityRank, 0);

    const revoke = await request(server, `${baseUrl}/admin/ranking/incidents/${firstIncidentJob.id}`, {
      method: "POST",
      token: adminToken,
      body: { decision: "dismissed", reason: "Se revierte tras revisar información adicional." },
    });
    assert.equal(revoke.status, 200);
    const afterRevoke = await request(server, `${baseUrl}/partner/recommendation-ranking`, { token: partnerToken });
    assert.equal((afterRevoke.body as { confirmedRecentIncidentCount: number; visibilityAdjusted: boolean }).confirmedRecentIncidentCount, 1);
    assert.equal((afterRevoke.body as { visibilityAdjusted: boolean }).visibilityAdjusted, false);
  } finally {
    process.env.NODE_ENV = originalEnvironment ?? previousNodeEnvironment ?? "test";
    if (paymentIds.length) await db.delete(payments).where(inArray(payments.id, paymentIds));
    if (jobIds.length) {
      await db.delete(messages).where(inArray(messages.changaId, jobIds));
      await db.delete(workyAuditEvents).where(and(
        eq(workyAuditEvents.entidad, "job"),
        inArray(workyAuditEvents.entidadId, jobIds),
      ));
      await db.delete(workyAuditEvents).where(and(
        eq(workyAuditEvents.entidad, "appointment_attempt"),
        inArray(workyAuditEvents.entidadId, jobIds),
      ));
      await db.delete(payments).where(inArray(payments.changaId, jobIds));
      await db.delete(jobs).where(inArray(jobs.id, jobIds));
    }
    if (userIds.length) {
      await db.delete(professionalProfiles).where(inArray(professionalProfiles.usuarioId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

run().then(() => {
  console.log("Production-gated recommendation ranking tests passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
