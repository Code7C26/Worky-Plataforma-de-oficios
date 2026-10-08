import assert from "node:assert/strict";
import http from "node:http";
import { and, eq } from "drizzle-orm";
import { db, users, workyAuditEvents } from "@workspace/db";
import app from "../src/app";

type RequestOptions = { method?: "GET" | "POST" | "PATCH"; token?: string; body?: unknown };
type ResponseData = { status: number; body: any };

function request(server: http.Server, path: string, options: RequestOptions = {}): Promise<ResponseData> {
  const address = server.address();
  if (!address || typeof address === "string") return Promise.reject(new Error("Test server has no TCP address."));
  const serializedBody = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port: address.port, path, method: options.method ?? "GET", agent: false,
      headers: { ...(options.token ? { authorization: "Bearer " + options.token } : {}), ...(serializedBody ? { "content-type": "application/json" } : {}) },
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { raw += chunk; });
      res.on("end", () => { try { resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null }); } catch (error) { reject(error); } });
    });
    req.on("error", reject);
    if (serializedBody) req.write(serializedBody);
    req.end();
  });
}

const unique = "admin-role-grant-" + process.pid + "-" + Date.now() + "-" + Math.random().toString(36).slice(2);
const password = "WorkyRoleGrantTest123!";

async function register(server: http.Server, label: string): Promise<{ token: string; id: number; email: string }> {
  const email = unique + "-" + label + "@example.test";
  const response = await request(server, "/api/v1/auth/register", { method: "POST", body: { nombre: "Role Grant Test", email, password, rol: "cliente" } });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(typeof response.body.token, "string");
  return { token: response.body.token, id: response.body.usuario.id, email };
}

async function run() {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  let adminId: number | undefined;
  let targetId: number | undefined;
  let inactiveId: number | undefined;
  try {
    const admin = await register(server, "admin");
    adminId = admin.id;
    await db.update(users).set({ rol: "admin" }).where(eq(users.id, adminId));
    const target = await register(server, "target");
    targetId = target.id;
    const inactive = await register(server, "inactive");
    inactiveId = inactive.id;
    await db.update(users).set({ activo: false }).where(eq(users.id, inactiveId));
    const endpoint = "/api/v1/admin/cuentas/rol";
    const validBody = { email: target.email, motivo: "Alta administrativa aprobada" };

    assert.equal((await request(server, endpoint, { method: "PATCH", body: validBody })).status, 401);
    assert.equal((await request(server, endpoint, { method: "PATCH", token: target.token, body: validBody })).status, 403);
    assert.equal((await request(server, endpoint, { method: "PATCH", token: admin.token, body: { email: "invalid", motivo: "Motivo válido" } })).status, 400);
    assert.equal((await request(server, endpoint, { method: "PATCH", token: admin.token, body: { email: target.email } })).status, 400);
    assert.equal((await request(server, endpoint, { method: "PATCH", token: admin.token, body: { ...validBody, password: "must-not-be-accepted" } })).status, 400);
    assert.equal((await request(server, endpoint, { method: "PATCH", token: admin.token, body: { email: "missing-" + unique + "@example.test", motivo: "Cuenta que no existe" } })).status, 404);
    assert.equal((await request(server, endpoint, { method: "PATCH", token: admin.token, body: { email: inactive.email, motivo: "Cuenta desactivada" } })).status, 409);

    const promoted = await request(server, endpoint, { method: "PATCH", token: admin.token, body: { email: target.email.toUpperCase(), motivo: "Alta administrativa aprobada" } });
    assert.equal(promoted.status, 200);
    assert.deepEqual(promoted.body, { rol: "admin", changed: true });
    assert.equal(JSON.stringify(promoted.body).includes(target.email), false);
    const [promotedUser] = await db.select({ rol: users.rol, activo: users.activo }).from(users).where(eq(users.id, targetId));
    assert.deepEqual(promotedUser, { rol: "admin", activo: true });

    const repeated = await request(server, endpoint, { method: "PATCH", token: admin.token, body: { ...validBody, motivo: "Promoción repetida" } });
    assert.deepEqual(repeated.body, { rol: "admin", changed: false });
    const auditRows = await db.select().from(workyAuditEvents).where(and(eq(workyAuditEvents.entidad, "account"), eq(workyAuditEvents.entidadId, targetId)));
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0]?.usuarioId, adminId);
    assert.equal(auditRows[0]?.accion, "role_granted");
    assert.equal(auditRows[0]?.estadoAnterior, "cliente");
    assert.equal(auditRows[0]?.estadoNuevo, "admin");
    assert.deepEqual(auditRows[0]?.metadata, { motivo: "Alta administrativa aprobada" });

    const login = await request(server, "/api/v1/auth/login", { method: "POST", body: { email: target.email, password } });
    assert.equal(login.status, 200);
    assert.equal(login.body.usuario.rol, "admin");
  } finally {
    if (adminId !== undefined) await db.delete(workyAuditEvents).where(eq(workyAuditEvents.usuarioId, adminId));
    if (targetId !== undefined) await db.delete(workyAuditEvents).where(and(eq(workyAuditEvents.entidad, "account"), eq(workyAuditEvents.entidadId, targetId)));
    if (targetId !== undefined) await db.delete(users).where(eq(users.id, targetId));
    if (inactiveId !== undefined) await db.delete(users).where(eq(users.id, inactiveId));
    if (adminId !== undefined) await db.delete(users).where(eq(users.id, adminId));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

run().then(
  () => console.log("Worky admin role grant integration tests passed."),
  (error) => { console.error(error); process.exitCode = 1; },
);
