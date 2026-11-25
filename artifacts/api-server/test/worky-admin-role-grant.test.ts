import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, users, workyAuditEvents } from "@workspace/db";
import app from "../src/app";

const unique = `admin-role-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const password = "worky-admin-role-test-password";
const baseUrl = "/api/v1";
const server = app.listen(0);
const accountIds: number[] = [];
const previousInitialAdminEmail = process.env.WORKY_INITIAL_ADMIN_EMAIL;
const previousPrimaryAdminEmail = process.env.WORKY_ADMIN_PRIMARY_EMAIL;

async function request(
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
  return { status: response.status, body: text ? JSON.parse(text) as Record<string, any> : null };
}

async function createAccount(
  label: string,
  role: "admin" | "cliente",
  verified: boolean,
  active = true,
) {
  const email = `${unique}-${label}@example.test`;
  const [user] = await db.insert(users).values({
    nombre: `Role Grant ${label}`,
    email,
    emailVerifiedAt: verified ? new Date() : null,
    passwordHash: await bcrypt.hash(password, 4),
    rol: role,
    activo: active,
  }).returning({ id: users.id });
  accountIds.push(user.id);
  return { id: user.id, email };
}

async function login(email: string) {
  return request(`${baseUrl}/auth/login`, {
    method: "POST",
    body: { email, password },
  });
}

async function run() {
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const [existingVerifiedAdmin] = await db.select({ id: users.id }).from(users)
      .where(and(
        eq(users.rol, "admin"),
        eq(users.activo, true),
        isNotNull(users.emailVerifiedAt),
      ))
      .limit(1);

    const blockedAdmin = await createAccount("existing-admin", "admin", true);
    const blockedTarget = await createAccount("blocked-bootstrap", "cliente", true);
    process.env.WORKY_INITIAL_ADMIN_EMAIL = blockedTarget.email;

    const blockedLogin = await login(blockedTarget.email);
    assert.equal(blockedLogin.status, 200);
    assert.equal(blockedLogin.body.usuario.rol, "cliente");
    const [stillClient] = await db.select({ rol: users.rol }).from(users).where(eq(users.id, blockedTarget.id));
    assert.equal(stillClient?.rol, "cliente");

    await db.delete(users).where(eq(users.id, blockedAdmin.id));
    const firstAdmin = await createAccount("initial-admin", "cliente", false);
    process.env.WORKY_INITIAL_ADMIN_EMAIL = firstAdmin.email;
    const beforeVerification = await login(firstAdmin.email);
    assert.equal(beforeVerification.status, 403);
    assert.equal(beforeVerification.body.code, "EMAIL_NOT_VERIFIED");
    const [beforeGrant] = await db.select({ rol: users.rol }).from(users).where(eq(users.id, firstAdmin.id));
    assert.equal(beforeGrant?.rol, "cliente");

    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, firstAdmin.id));
    const firstAdminLogin = await login(firstAdmin.email);
    assert.equal(firstAdminLogin.status, 200);
    assert.equal(firstAdminLogin.body.usuario.rol, existingVerifiedAdmin ? "cliente" : "admin");
    const [firstAdminAfterLogin] = await db.select({ rol: users.rol }).from(users).where(eq(users.id, firstAdmin.id));
    assert.equal(firstAdminAfterLogin?.rol, existingVerifiedAdmin ? "cliente" : "admin");

    const bootstrapAudit = await db.select().from(workyAuditEvents)
      .where(and(
        eq(workyAuditEvents.entidad, "account"),
        eq(workyAuditEvents.entidadId, firstAdmin.id),
        eq(workyAuditEvents.accion, "role_granted"),
      ));
    if (existingVerifiedAdmin) {
      assert.equal(bootstrapAudit.length, 0);
    } else {
      assert.equal(bootstrapAudit.length, 1);
      assert.equal(bootstrapAudit[0]?.usuarioId, null);
      assert.deepEqual(bootstrapAudit[0]?.metadata, {
        source: "verified_initial_admin_bootstrap",
        reason: "First administrator assigned after email verification",
      });
    }

    const roleGrantAdmin = await createAccount("role-grant-admin", "admin", true);
    process.env.WORKY_ADMIN_PRIMARY_EMAIL = roleGrantAdmin.email;
    const roleGrantAdminLogin = await login(roleGrantAdmin.email);
    assert.equal(roleGrantAdminLogin.status, 200);
    assert.equal(roleGrantAdminLogin.body.usuario.rol, "admin");
    const adminToken = roleGrantAdminLogin.body.token as string;

    const regularClient = await createAccount("regular-client", "cliente", true);
    const regularClientLogin = await login(regularClient.email);
    assert.equal(regularClientLogin.status, 200);

    const unverifiedTarget = await createAccount("unverified-target", "cliente", false);
    const inactiveTarget = await createAccount("inactive-target", "cliente", true, false);
    const endpoint = `${baseUrl}/admin/cuentas/rol`;
    const reason = "Alta administrativa aprobada";
    const body = { email: regularClient.email, motivo: reason };

    assert.equal((await request(endpoint, { method: "PATCH", body })).status, 401);
    assert.equal((await request(endpoint, {
      method: "PATCH",
      token: regularClientLogin.body.token,
      body,
    })).status, 403);
    assert.equal((await request(endpoint, {
      method: "PATCH",
      token: adminToken,
      body: { email: "invalid", motivo: reason },
    })).status, 400);
    assert.equal((await request(endpoint, {
      method: "PATCH",
      token: adminToken,
      body: { ...body, unexpected: true },
    })).status, 400);
    assert.equal((await request(endpoint, {
      method: "PATCH",
      token: adminToken,
      body: { email: unverifiedTarget.email, motivo: reason },
    })).status, 409);
    assert.equal((await request(endpoint, {
      method: "PATCH",
      token: adminToken,
      body: { email: inactiveTarget.email, motivo: reason },
    })).status, 409);
    assert.equal((await request(endpoint, {
      method: "PATCH",
      token: adminToken,
      body: { email: `${unique}-missing@example.test`, motivo: reason },
    })).status, 404);

    const promoted = await request(endpoint, {
      method: "PATCH",
      token: adminToken,
      body: { email: regularClient.email.toUpperCase(), motivo: reason },
    });
    assert.equal(promoted.status, 200);
    assert.deepEqual(promoted.body, { rol: "admin", changed: true });
    assert.equal(JSON.stringify(promoted.body).includes(regularClient.email), false);

    const repeated = await request(endpoint, { method: "PATCH", token: adminToken, body });
    assert.deepEqual(repeated.body, { rol: "admin", changed: false });

    const [promotedUser] = await db.select({ rol: users.rol }).from(users).where(eq(users.id, regularClient.id));
    assert.equal(promotedUser?.rol, "admin");
    const grantAudit = await db.select().from(workyAuditEvents)
      .where(and(
        eq(workyAuditEvents.entidad, "account"),
        eq(workyAuditEvents.entidadId, regularClient.id),
        eq(workyAuditEvents.accion, "role_granted"),
      ));
    assert.equal(grantAudit.length, 1);
    assert.equal(grantAudit[0]?.usuarioId, roleGrantAdmin.id);
    assert.equal(grantAudit[0]?.estadoAnterior, "cliente");
    assert.equal(grantAudit[0]?.estadoNuevo, "admin");
    assert.deepEqual(grantAudit[0]?.metadata, { motivo: reason });
  } finally {
    if (accountIds.length) {
      await db.delete(workyAuditEvents).where(and(
        eq(workyAuditEvents.entidad, "account"),
        inArray(workyAuditEvents.entidadId, accountIds),
      ));
      await db.delete(workyAuditEvents).where(inArray(workyAuditEvents.usuarioId, accountIds));
      await db.delete(users).where(inArray(users.id, accountIds));
    }
    if (previousInitialAdminEmail === undefined) delete process.env.WORKY_INITIAL_ADMIN_EMAIL;
    else process.env.WORKY_INITIAL_ADMIN_EMAIL = previousInitialAdminEmail;
    if (previousPrimaryAdminEmail === undefined) delete process.env.WORKY_ADMIN_PRIMARY_EMAIL;
    else process.env.WORKY_ADMIN_PRIMARY_EMAIL = previousPrimaryAdminEmail;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

void run().then(
  () => console.log("Worky admin bootstrap and role-grant integration tests passed."),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
