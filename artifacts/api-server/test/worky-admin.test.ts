import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import app from "../src/app";
import {
  db,
  professionalProfiles,
  professionalVerificationDocuments,
  users,
  workyAuditEvents,
} from "@workspace/db";

const unique = `admin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const password = "worky-admin-test-password";
const baseUrl = "/api/v1";

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

async function createAccount(name: string, role: "admin" | "cliente" | "profesional") {
  const email = `${unique}-${name}@example.test`;
  const [user] = await db.insert(users).values({
    nombre: name,
    email,
    emailVerifiedAt: new Date(),
    passwordHash: await bcrypt.hash(password, 4),
    rol: role,
  }).returning({ id: users.id });
  const response = await request(server, `${baseUrl}/auth/login`, {
    method: "POST",
    body: { email, password },
  });
  assert.equal(response.status, 200);
  return { id: user.id, token: (response.body as { token: string }).token };
}

const server = app.listen(0);
const accountIds: number[] = [];
let partnerId: number | undefined;

async function run() {
  try {
    const admin = await createAccount("admin", "admin");
    accountIds.push(admin.id);
    const client = await createAccount("client", "cliente");
    accountIds.push(client.id);
    const partner = await createAccount("partner", "profesional");
    accountIds.push(partner.id);
    partnerId = partner.id;

    assert.equal((await request(server, `${baseUrl}/admin/dashboard`)).status, 401);
    assert.equal((await request(server, `${baseUrl}/admin/dashboard`, { token: client.token })).status, 403);
    const dashboard = await request(server, `${baseUrl}/admin/dashboard`, { token: admin.token });
    assert.equal(dashboard.status, 200);
    assert.equal(typeof (dashboard.body as Record<string, unknown>).accountsTotal, "number");

    const profileResponse = await request(server, `${baseUrl}/partner-profile`, {
      method: "POST",
      token: partner.token,
      body: { oficio: "Plomero de prueba", categoria: "Plomería", precioReferencia: 12000 },
    });
    assert.equal(profileResponse.status, 201);
    const [profile] = await db.select({ id: professionalProfiles.id }).from(professionalProfiles)
      .where(eq(professionalProfiles.usuarioId, partner.id)).limit(1);
    assert.ok(profile);
    const blockedEnable = await request(server, `${baseUrl}/admin/partners/${partner.id}/activation`, {
      method: "PATCH",
      token: admin.token,
      body: { enabled: true, reason: "Faltan documentos" },
    });
    assert.equal(blockedEnable.status, 409);
    const requiredDocuments = ["dni_frente", "dni_dorso", "antecedentes_penales"] as const;
    await db.update(professionalProfiles).set({
      estadoVerificacion: "verified",
      verificado: true,
      habilitado: false,
    }).where(eq(professionalProfiles.usuarioId, partner.id));
    await db.insert(professionalVerificationDocuments).values(requiredDocuments.map((tipo) => ({
      profesionalId: partner.id,
      tipo,
      objectPath: `private-test/${unique}/${tipo}.jpg`,
      nombre: `${tipo}.jpg`,
      contentType: "image/jpeg",
      sizeBytes: 1200,
      estado: "verified" as const,
    })));

    const listed = await request(server, `${baseUrl}/admin/partners?search=${encodeURIComponent("Plomero de prueba")}`, { token: admin.token });
    assert.equal(listed.status, 200);
    const partnerRow = (listed.body as { items: Array<Record<string, any>> }).items[0];
    assert.equal(partnerRow.userId, partner.id);
    assert.equal(partnerRow.enabled, false);
    assert.equal(partnerRow.documents.length, 3);
    assert.equal("objectPath" in partnerRow.documents[0], false);

    const publicBefore = await request(server, `${baseUrl}/profesionales?search=${encodeURIComponent("Plomero de prueba")}`);
    assert.equal(publicBefore.status, 200);
    assert.equal((publicBefore.body as Array<Record<string, any>>).some((item) => item.usuario?.id === partner.id), false);
    assert.equal((await request(server, `${baseUrl}/profesionales/${profile.id}`)).status, 404);

    const enabled = await request(server, `${baseUrl}/admin/partners/${partner.id}/activation`, {
      method: "PATCH",
      token: admin.token,
      body: { enabled: true, reason: "Documentación aprobada" },
    });
    assert.equal(enabled.status, 200);
    assert.equal((enabled.body as Record<string, unknown>).enabled, true);
    const publicAfter = await request(server, `${baseUrl}/profesionales?search=${encodeURIComponent("Plomero de prueba")}`);
    assert.equal((publicAfter.body as Array<Record<string, any>>).some((item) => item.usuario?.id === partner.id), true);

    const disabled = await request(server, `${baseUrl}/admin/partners/${partner.id}/activation`, {
      method: "PATCH",
      token: admin.token,
      body: { enabled: false, reason: "Revisión administrativa" },
    });
    assert.equal(disabled.status, 200);
    assert.equal((await request(server, `${baseUrl}/profesionales/${profile.id}`)).status, 404);

    const selfSuspend = await request(server, `${baseUrl}/admin/accounts/${admin.id}/status`, {
      method: "PATCH",
      token: admin.token,
      body: { active: false, reason: "No suspender admins" },
    });
    assert.equal(selfSuspend.status, 409);

    const suspended = await request(server, `${baseUrl}/admin/accounts/${client.id}/status`, {
      method: "PATCH",
      token: admin.token,
      body: { active: false, reason: "Cuenta suspendida por prueba" },
    });
    assert.equal(suspended.status, 200);
    assert.equal((await request(server, `${baseUrl}/admin/dashboard`, { token: client.token })).status, 401);

    const activity = await request(server, `${baseUrl}/admin/activity?entity=professional_profile`, { token: admin.token });
    assert.equal(activity.status, 200);
    assert.ok((activity.body as { items: unknown[] }).items.length > 0);
  } finally {
    if (accountIds.length) {
      await db.delete(workyAuditEvents).where(inArray(workyAuditEvents.usuarioId, accountIds));
      if (partnerId) {
        await db.delete(professionalVerificationDocuments).where(eq(professionalVerificationDocuments.profesionalId, partnerId));
        await db.delete(professionalProfiles).where(eq(professionalProfiles.usuarioId, partnerId));
      }
      await db.delete(users).where(inArray(users.id, accountIds));
    }
    server.close();
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
