import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, jobs, messages, professionalProfiles, users, webLoginChallenges, workyAuditEvents, workyNotifications } from "@workspace/db";
import app from "../src/app";

const password = "thread-security-test-password";
const stamp = Date.now();
const clientEmail = `thread-client-${stamp}@example.test`;
const professionalAEmail = `thread-professional-a-${stamp}@example.test`;
const professionalBEmail = `thread-professional-b-${stamp}@example.test`;
const originalSessionSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = "thread-security-test-secret";
const originalCreateProxyFetch = ReplitConnectors.prototype.createProxyFetch;
let deliveredCode: string | undefined;
ReplitConnectors.prototype.createProxyFetch = function () {
  return async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    if (path === "/gmail/v1/users/me/profile") return new Response(JSON.stringify({ emailAddress: "worky@example.test" }), { status: 200 });
    if (path === "/gmail/v1/users/me/messages/send") {
      const raw = JSON.parse(String(init?.body)) as { raw?: string };
      assert(raw.raw);
      const message = Buffer.from(raw.raw, "base64url").toString("utf8");
      const textPart = message.match(/Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/i)?.[1];
      assert(textPart);
      deliveredCode = Buffer.from(textPart.replace(/\r\n/g, ""), "base64").toString("utf8").match(/\b(\d{6})\b/)?.[1];
      assert(deliveredCode);
      return new Response(JSON.stringify({ id: "thread-security-test" }), { status: 200 });
    }
    throw new Error("Unexpected Gmail API request.");
  };
};

async function requestApi(server: http.Server, path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const address = server.address();
  assert(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, body: response.status === 204 ? undefined : await response.json() as Record<string, any> | Array<Record<string, any>> };
}

test("separate professional threads per job and enforce optional email two-factor login", async () => {
  const server = app.listen(0);
  const createdUsers: number[] = [];
  const createdJobs: number[] = [];
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const hashedPassword = await bcrypt.hash(password, 4);
    const [client] = await db.insert(users).values({
      nombre: "Cliente de prueba",
      email: clientEmail,
      emailVerifiedAt: new Date(),
      passwordHash: hashedPassword,
      rol: "cliente",
    }).returning({ id: users.id });
    const [professionalA] = await db.insert(users).values({
      nombre: "Profesional A",
      email: professionalAEmail,
      emailVerifiedAt: new Date(),
      passwordHash: hashedPassword,
      rol: "profesional",
    }).returning({ id: users.id });
    const [professionalB] = await db.insert(users).values({
      nombre: "Profesional B",
      email: professionalBEmail,
      emailVerifiedAt: new Date(),
      passwordHash: hashedPassword,
      rol: "profesional",
    }).returning({ id: users.id });
    createdUsers.push(client.id, professionalA.id, professionalB.id);
    await db.insert(professionalProfiles).values([
      { usuarioId: professionalA.id, oficio: "Plomero A", categoria: "Plomería", precioReferencia: "100", habilitado: true, verificado: true, estadoVerificacion: "verified" },
      { usuarioId: professionalB.id, oficio: "Plomero B", categoria: "Plomería", precioReferencia: "100", habilitado: true, verificado: true, estadoVerificacion: "verified" },
    ]);
    const [job] = await db.insert(jobs).values({
      clienteId: client.id,
      ubicacion: { direccionTexto: "Alta Gracia" },
      categoria: "Plomería",
      precioOfrecido: "1000",
      detalle: "Reparar una pérdida",
      estado: "publicada",
    }).returning({ id: jobs.id });
    createdJobs.push(job.id);
    const [editableJob] = await db.insert(jobs).values({
      clienteId: client.id,
      ubicacion: { direccionTexto: "Barrio Norte" },
      categoria: "Plomería",
      precioOfrecido: "2000",
      detalle: "Antes de publicar la respuesta",
      estado: "publicada",
    }).returning({ id: jobs.id });
    const [emptyJob] = await db.insert(jobs).values({
      clienteId: client.id,
      ubicacion: { direccionTexto: "Centro" },
      categoria: "Plomería",
      precioOfrecido: "500",
      detalle: "Changa que se eliminará",
      estado: "publicada",
    }).returning({ id: jobs.id });
    createdJobs.push(editableJob.id, emptyJob.id);

    const [clientLogin, loginA, loginB] = await Promise.all([
      requestApi(server, "/auth/login", { method: "POST", body: { email: clientEmail, password } }),
      requestApi(server, "/auth/login", { method: "POST", body: { email: professionalAEmail, password } }),
      requestApi(server, "/auth/login", { method: "POST", body: { email: professionalBEmail, password } }),
    ]);
    const clientToken = (clientLogin.body as Record<string, any>).token as string;
    const tokenA = (loginA.body as Record<string, any>).token as string;
    const tokenB = (loginB.body as Record<string, any>).token as string;

    const edited = await requestApi(server, `/trabajos/${editableJob.id}`, {
      method: "PATCH",
      token: clientToken,
      body: {
        categoria: "Plomería",
        ubicacion: { direccionTexto: "Nueva dirección 123" },
        precioOfrecido: 3500,
        detalle: "Descripción corregida",
        profesionalId: professionalA.id,
      },
    });
    assert.equal(edited.status, 200);
    assert.equal((edited.body as Record<string, any>).profesionalId, professionalA.id);
    assert.equal((edited.body as Record<string, any>).estado, "aceptada");
    assert.equal((await requestApi(server, `/trabajos/${editableJob.id}`, { method: "DELETE", token: clientToken })).status, 409);
    assert.equal((await requestApi(server, `/trabajos/${emptyJob.id}`, { method: "DELETE", token: clientToken })).status, 204);

    assert.equal((await requestApi(server, `/chats/${job.id}/mensajes`, {
      method: "POST", token: clientToken, body: { texto: "Te cuento el problema inicial." },
    })).status, 201);
    assert.equal((await requestApi(server, `/chats/${job.id}/hilos/${professionalA.id}/mensajes`, {
      method: "POST", token: tokenA, body: { texto: "Respuesta del profesional A." },
    })).status, 201);
    assert.equal((await requestApi(server, `/chats/${job.id}/hilos/${professionalB.id}/mensajes`, {
      method: "POST", token: tokenB, body: { texto: "Respuesta del profesional B." },
    })).status, 201);

    const clientInbox = await requestApi(server, "/conversaciones?rol=cliente", { token: clientToken });
    assert.equal(clientInbox.status, 200);
    assert.equal((clientInbox.body as Array<Record<string, any>>).length, 2);
    const threadA = await requestApi(server, `/chats/${job.id}/hilos/${professionalA.id}/mensajes`, { token: clientToken });
    const threadB = await requestApi(server, `/chats/${job.id}/hilos/${professionalB.id}/mensajes`, { token: clientToken });
    assert.deepEqual((threadA.body as Array<Record<string, any>>).map((item) => item.texto), [
      "Te cuento el problema inicial.",
      "Respuesta del profesional A.",
    ]);
    assert.deepEqual((threadB.body as Array<Record<string, any>>).map((item) => item.texto), [
      "Te cuento el problema inicial.",
      "Respuesta del profesional B.",
    ]);
    assert.equal((await requestApi(server, "/conversaciones?rol=profesional", { token: tokenA })).body instanceof Array, true);
    const inboxA = await requestApi(server, "/conversaciones?rol=profesional", { token: tokenA });
    assert.equal((inboxA.body as Array<Record<string, any>>).length, 1);
    assert.equal((inboxA.body as Array<Record<string, any>>)[0].profesionalId, professionalA.id);
    assert.equal((await requestApi(server, `/chats/${job.id}/hilos/${professionalB.id}/mensajes`, { token: tokenA })).status, 403);
    assert.equal((await requestApi(server, `/trabajos/${job.id}`, { method: "DELETE", token: clientToken })).status, 409);

    const securityEnabled = await requestApi(server, "/auth/security/two-factor", {
      method: "PUT", token: clientToken, body: { enabled: true, currentPassword: password },
    });
    assert.deepEqual(securityEnabled.body, { enabled: true });
    assert.deepEqual((await requestApi(server, "/auth/security/two-factor", { token: clientToken })).body, { enabled: true });
    const challengedLogin = await requestApi(server, "/auth/login", {
      method: "POST", body: { email: clientEmail, password },
    });
    assert.equal(challengedLogin.status, 202);
    assert.equal((challengedLogin.body as Record<string, any>).requiresTwoFactor, true);
    assert(deliveredCode);
    const challengeId = (challengedLogin.body as Record<string, any>).challengeId as number;
    const confirmed = await requestApi(server, "/auth/login/verify", {
      method: "POST", body: { challengeId, code: deliveredCode },
    });
    assert.equal(confirmed.status, 200);
    assert.equal(typeof (confirmed.body as Record<string, any>).token, "string");
    assert.equal((await requestApi(server, "/auth/login/verify", {
      method: "POST", body: { challengeId, code: deliveredCode },
    })).status, 400, "A verification code cannot be reused.");
    assert.deepEqual((await requestApi(server, "/auth/security/two-factor", {
      method: "PUT", token: (confirmed.body as Record<string, any>).token, body: { enabled: false, currentPassword: password },
    })).body, { enabled: false });
    assert.equal((await requestApi(server, "/auth/login", {
      method: "POST", body: { email: clientEmail, password },
    })).status, 200);
  } finally {
    for (const jobId of createdJobs) {
      await db.delete(messages).where(eq(messages.changaId, jobId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
    }
    for (const id of createdUsers) {
      await db.delete(workyAuditEvents).where(eq(workyAuditEvents.usuarioId, id));
      await db.delete(workyNotifications).where(eq(workyNotifications.usuarioId, id));
      await db.delete(webLoginChallenges).where(eq(webLoginChallenges.usuarioId, id));
      await db.delete(professionalProfiles).where(eq(professionalProfiles.usuarioId, id));
      await db.delete(users).where(eq(users.id, id));
    }
    ReplitConnectors.prototype.createProxyFetch = originalCreateProxyFetch;
    if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSessionSecret;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
