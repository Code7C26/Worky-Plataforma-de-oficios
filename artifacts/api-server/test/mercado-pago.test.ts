import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import app from "../src/app";
import { buildMercadoPagoWebhookSignature } from "../src/lib/mercado-pago";
import { and, eq } from "drizzle-orm";
import { db, jobs, payments, users, workyAuditEvents, workyNotifications } from "@workspace/db";

const baseUrl = "/api/v1";
const secret = "unit-test-webhook-secret";
const unique = `mp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function request(server: http.Server, path: string, options: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const address = server.address();
  assert(address && typeof address !== "string");
  return await new Promise<{ status: number; body: any; location?: string }>((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      path,
      method: options.method ?? "GET",
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
        ...options.headers,
      },
    }, (res) => {
      let responseText = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { responseText += chunk; });
      res.on("end", () => {
        let responseBody: unknown = responseText || null;
        try {
          responseBody = responseText ? JSON.parse(responseText) : null;
        } catch {
          // Successful webhook acknowledgements are plain text.
        }
        resolve({ status: res.statusCode ?? 0, body: responseBody, location: res.headers.location });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function run() {
  const server = app.listen(0);
  const originalFetch = globalThis.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnv = {
    token: process.env.MERCADOPAGO_ACCESS_TOKEN_DEVELOPMENT,
    webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET_DEVELOPMENT,
    publicUrl: process.env.WORKY_PUBLIC_URL,
  };
  const ids: number[] = [];
  let changaId: number | undefined;
  let unfinishedChangaId: number | undefined;
  let paymentRowId: number | undefined;
  let providerPreferenceCalls = 0;
  const preference = {
    id: "test-preference-123",
    sandbox_init_point: "https://sandbox.mercadopago.com/checkout/v1/redirect?pref_id=test-preference-123",
    init_point: "https://www.mercadopago.com/checkout/v1/redirect?pref_id=test-preference-123",
  };

  try {
    process.env.NODE_ENV = "development";
    process.env.MERCADOPAGO_ACCESS_TOKEN_DEVELOPMENT = "APP_USR-worky-fake-test-token";
    process.env.MERCADOPAGO_WEBHOOK_SECRET_DEVELOPMENT = secret;
    process.env.WORKY_PUBLIC_URL = "https://worky.example";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://api.mercadopago.com/checkout/preferences") {
        providerPreferenceCalls += 1;
        assert.equal((init?.headers as Record<string, string>)["X-Idempotency-Key"]?.startsWith("worky-payment-"), true);
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.items[0].unit_price, 12500);
        assert.equal(payload.items[0].currency_id, "ARS");
        assert.equal(payload.notification_url, "https://worky.example/api/v1/webhooks/mercadopago");
        assert.deepEqual(payload.back_urls, {
          success: `https://worky.example/api/v1/pagos/retorno?changaId=${changaId}`,
          failure: `https://worky.example/api/v1/pagos/retorno?changaId=${changaId}`,
          pending: `https://worky.example/api/v1/pagos/retorno?changaId=${changaId}`,
        });
        return new Response(JSON.stringify(preference), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.mercadopago.com/v1/payments/987654321") {
        return new Response(JSON.stringify({
          id: 987654321,
          status: "approved",
          external_reference: String(paymentId),
          preference_id: preference.id,
          transaction_amount: 12500,
          currency_id: "ARS",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected provider request: ${url}`);
    }) as typeof fetch;

    const passwordHash = await bcrypt.hash("mercado-pago-test-password", 4);
    const [client] = await db.insert(users).values({
      nombre: `${unique} client`,
      email: `${unique}@example.test`,
      emailVerifiedAt: new Date(),
      passwordHash,
    }).returning();
    const [otherClient] = await db.insert(users).values({
      nombre: `${unique} other`,
      email: `${unique}-other@example.test`,
      emailVerifiedAt: new Date(),
      passwordHash,
    }).returning();
    const [partner] = await db.insert(users).values({
      nombre: `${unique} partner`,
      email: `${unique}-partner@example.test`,
      emailVerifiedAt: new Date(),
      passwordHash,
      rol: "profesional",
    }).returning();
    ids.push(client.id, otherClient.id, partner.id);

    const [job] = await db.insert(jobs).values({
      clienteId: client.id,
      profesionalId: partner.id,
      ubicacion: { direccionTexto: "Alta Gracia" },
      categoria: "Plomería",
      precioOfrecido: "12500.00",
      detalle: "Trabajo de prueba Mercado Pago",
      estado: "trabajo_realizado",
      paymentMethod: "mercado_pago",
      trabajoRealizadoAt: new Date(),
    }).returning();
    changaId = job.id;
    const [unfinishedJob] = await db.insert(jobs).values({
      clienteId: client.id,
      profesionalId: partner.id,
      ubicacion: { direccionTexto: "Alta Gracia" },
      categoria: "Plomería",
      precioOfrecido: "9000.00",
      detalle: "Trabajo todavía en curso",
      estado: "en_curso",
    }).returning();
    unfinishedChangaId = unfinishedJob.id;

    const login = await request(server, `${baseUrl}/auth/login`, {
      method: "POST",
      body: { email: client.email, password: "mercado-pago-test-password" },
    });
    assert.equal(login.status, 200);
    const otherLogin = await request(server, `${baseUrl}/auth/login`, {
      method: "POST",
      body: { email: otherClient.email, password: "mercado-pago-test-password" },
    });
    assert.equal(otherLogin.status, 200);

    const unauthorized = await request(server, `${baseUrl}/pagos`, { method: "POST", body: { changaId } });
    assert.equal(unauthorized.status, 401);
    const wrongOwner = await request(server, `${baseUrl}/pagos`, {
      method: "POST",
      token: otherLogin.body.token,
      body: { changaId },
    });
    assert.equal(wrongOwner.status, 403, JSON.stringify(wrongOwner.body));
    const unfinished = await request(server, `${baseUrl}/pagos`, {
      method: "POST",
      token: login.body.token,
      body: { changaId: unfinishedChangaId },
    });
    assert.equal(unfinished.status, 409);

    const mobileReturn = await request(server, `${baseUrl}/pagos/retorno?changaId=${changaId}`, {
      headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36" },
    });
    assert.equal(mobileReturn.status, 302);
    assert.equal(mobileReturn.location, `worky-mobile://jobs?jobId=${changaId}`);
    const desktopReturn = await request(server, `${baseUrl}/pagos/retorno?changaId=${changaId}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36" },
    });
    assert.equal(desktopReturn.status, 302);
    assert.equal(desktopReturn.location, `https://worky.example/jobs?payment=return&changaId=${changaId}`);
    const invalidReturn = await request(server, `${baseUrl}/pagos/retorno?changaId=not-a-job`);
    assert.equal(invalidReturn.status, 400);

    const checkout = await request(server, `${baseUrl}/pagos`, {
      method: "POST",
      token: login.body.token,
      body: { changaId, amount: 1 },
    });
    assert.equal(checkout.status, 201);
    assert.equal(checkout.body.amount, 12500);
    assert.equal(checkout.body.checkoutUrl, preference.sandbox_init_point);
    const beforeWebhook = await db.select({ estado: jobs.estado }).from(jobs).where(eq(jobs.id, changaId)).limit(1);
    assert.equal(beforeWebhook[0]?.estado, "trabajo_realizado");
    const paymentId = checkout.body.id as number;
    paymentRowId = paymentId;
    assert.equal(providerPreferenceCalls, 1);

    const resumed = await request(server, `${baseUrl}/pagos`, {
      method: "POST",
      token: login.body.token,
      body: { changaId },
    });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.id, paymentId);
    assert.equal(providerPreferenceCalls, 1);

    const paymentList = await request(server, `${baseUrl}/pagos`, { token: login.body.token });
    assert.equal(paymentList.status, 200);
    assert.equal(paymentList.body[0].status, "iniciado");
    assert.equal(paymentList.body[0].checkoutUrl, preference.sandbox_init_point);

    const dataId = "987654321";
    const statusOnlyReturn = await request(server, `${baseUrl}/pagos/retorno?changaId=${changaId}&status=approved`, {
      headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36" },
    });
    assert.equal(statusOnlyReturn.status, 302);
    assert.equal(statusOnlyReturn.location, `worky-mobile://jobs?jobId=${changaId}`);
    const stillUnconfirmed = await request(server, `${baseUrl}/pagos`, { token: login.body.token });
    assert.equal(stillUnconfirmed.body[0].status, "iniciado");

    const mismatchedReturn = await request(server, `${baseUrl}/pagos/retorno?changaId=${unfinishedChangaId}&payment_id=${dataId}`, {
      headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36" },
    });
    assert.equal(mismatchedReturn.status, 302);
    const remainsUnconfirmed = await request(server, `${baseUrl}/pagos`, { token: login.body.token });
    assert.equal(remainsUnconfirmed.body[0].status, "iniciado");

    const approvedReturn = await request(server, `${baseUrl}/pagos/retorno?changaId=${changaId}&payment_id=${dataId}`, {
      headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36" },
    });
    assert.equal(approvedReturn.status, 302);
    assert.equal(approvedReturn.location, `worky-mobile://jobs?jobId=${changaId}`);
    const afterReturn = await db.select({ estado: jobs.estado }).from(jobs).where(eq(jobs.id, changaId)).limit(1);
    assert.equal(afterReturn[0]?.estado, "finalizada");
    const paymentAfterReturn = await request(server, `${baseUrl}/pagos`, { token: login.body.token });
    assert.equal(paymentAfterReturn.body[0].status, "aprobado");

    const requestId = "mercadopago-test-request";
    const timestamp = "1700000000000";
    const signature = buildMercadoPagoWebhookSignature({ requestId, dataId, timestamp, secret });
    const invalidSignature = await request(server, `${baseUrl}/webhooks/mercadopago?type=payment&data.id=${dataId}`, {
      method: "POST",
      body: { type: "payment", action: "payment.updated", data: { id: dataId } },
      headers: { "x-request-id": requestId, "x-signature": `ts=${timestamp},v1=${"0".repeat(64)}` },
    });
    assert.equal(invalidSignature.status, 401);

    const webhook = await request(server, `${baseUrl}/webhooks/mercadopago?type=payment&data.id=${dataId}`, {
      method: "POST",
      body: { type: "payment", action: "payment.updated", data: { id: dataId } },
      headers: { "x-request-id": requestId, "x-signature": `ts=${timestamp},v1=${signature}` },
    });
    assert.equal(webhook.status, 200);
    const afterWebhook = await db.select({ estado: jobs.estado }).from(jobs).where(eq(jobs.id, changaId)).limit(1);
    assert.equal(afterWebhook[0]?.estado, "finalizada");
    const confirmed = await request(server, `${baseUrl}/pagos`, { token: login.body.token });
    assert.equal(confirmed.body[0].status, "aprobado");
    const duplicatePayment = await request(server, `${baseUrl}/pagos`, {
      method: "POST",
      token: login.body.token,
      body: { changaId },
    });
    assert.equal(duplicatePayment.status, 409);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalEnv.token === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN_DEVELOPMENT;
    else process.env.MERCADOPAGO_ACCESS_TOKEN_DEVELOPMENT = originalEnv.token;
    if (originalEnv.webhookSecret === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET_DEVELOPMENT;
    else process.env.MERCADOPAGO_WEBHOOK_SECRET_DEVELOPMENT = originalEnv.webhookSecret;
    if (originalEnv.publicUrl === undefined) delete process.env.WORKY_PUBLIC_URL;
    else process.env.WORKY_PUBLIC_URL = originalEnv.publicUrl;
    if (changaId) {
      await db.delete(payments).where(eq(payments.changaId, changaId));
      await db.delete(jobs).where(eq(jobs.id, changaId));
    }
    if (paymentRowId) await db.delete(workyAuditEvents).where(and(
      eq(workyAuditEvents.entidad, "payment"),
      eq(workyAuditEvents.entidadId, paymentRowId),
    ));
    if (unfinishedChangaId) await db.delete(jobs).where(eq(jobs.id, unfinishedChangaId));
    if (ids.length) {
      await db.delete(workyNotifications).where(eq(workyNotifications.usuarioId, ids[0]));
      await db.delete(workyNotifications).where(eq(workyNotifications.usuarioId, ids[1]));
      await db.delete(workyNotifications).where(eq(workyNotifications.usuarioId, ids[2]));
      await db.delete(users).where(eq(users.id, ids[0]));
      await db.delete(users).where(eq(users.id, ids[1]));
      await db.delete(users).where(eq(users.id, ids[2]));
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

run().then(() => {
  console.log("Mercado Pago checkout and webhook tests passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
