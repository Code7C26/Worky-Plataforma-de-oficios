import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db, professionalProfiles, users } from "@workspace/db";
import app from "../src/app";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  token?: string;
  body?: unknown;
};

function request(
  server: http.Server,
  path: string,
  options: RequestOptions = {},
): Promise<{ status: number; body: any }> {
  const address = server.address();
  if (!address || typeof address === "string") {
    return Promise.reject(new Error("Test server has no TCP address."));
  }

  const serializedBody = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      path,
      method: options.method ?? "GET",
      agent: false,
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(serializedBody ? { "content-type": "application/json" } : {}),
      },
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { raw += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    if (serializedBody) req.write(serializedBody);
    req.end();
  });
}

async function register(
  server: http.Server,
  email: string,
): Promise<{ token: string; id: number }> {
  const response = await request(server, "/api/v1/auth/register", {
    method: "POST",
    body: { nombre: "Worky Role Test", email, password: "WorkyRoleTest123!", rol: "cliente" },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(typeof response.body.token, "string");
  assert.equal(typeof response.body.usuario.id, "number");
  return { token: response.body.token, id: response.body.usuario.id };
}

async function run() {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));

  let clientId: number | undefined;
  let adminId: number | undefined;
  const suffix = `${process.pid}-${Date.now()}`;

  try {
    const client = await register(server, `role-client-${suffix}@example.test`);
    clientId = client.id;

    const anonymousSwitch = await request(server, "/api/v1/auth/role", {
      method: "PATCH",
      body: { rol: "profesional" },
    });
    assert.equal(anonymousSwitch.status, 401);

    const invalidRole = await request(server, "/api/v1/auth/role", {
      method: "PATCH",
      token: client.token,
      body: { rol: "admin" },
    });
    assert.equal(invalidRole.status, 400);

    const toPartner = await request(server, "/api/v1/auth/role", {
      method: "PATCH",
      token: client.token,
      body: { rol: "profesional" },
    });
    assert.equal(toPartner.status, 200, JSON.stringify(toPartner.body));
    assert.equal(toPartner.body.id, client.id);
    assert.equal(toPartner.body.rol, "profesional");

    const createdProfile = await request(server, "/api/v1/partner-profile", {
      method: "POST",
      token: client.token,
      body: { oficio: "Plomero", categoria: "Plomería" },
    });
    assert.equal(createdProfile.status, 201, JSON.stringify(createdProfile.body));
    assert.equal(createdProfile.body.usuario.id, client.id);

    const toClient = await request(server, "/api/v1/auth/role", {
      method: "PATCH",
      token: client.token,
      body: { rol: "cliente" },
    });
    assert.equal(toClient.status, 200);
    assert.equal(toClient.body.rol, "cliente");

    const account = await request(server, "/api/v1/auth/me", { token: client.token });
    assert.equal(account.status, 200);
    assert.equal(account.body.rol, "cliente");

    const profileAfterSwitch = await request(server, "/api/v1/partner-profile/me", {
      token: client.token,
    });
    assert.equal(profileAfterSwitch.status, 200);
    assert.equal(profileAfterSwitch.body.usuario.id, client.id);
    assert.equal(profileAfterSwitch.body.oficio, "Plomero");
    assert.equal(profileAfterSwitch.body.categoria, "Plomería");

    const repeatSwitch = await request(server, "/api/v1/auth/role", {
      method: "PATCH",
      token: client.token,
      body: { rol: "cliente" },
    });
    assert.equal(repeatSwitch.status, 200);
    assert.equal(repeatSwitch.body.rol, "cliente");

    const admin = await register(server, `role-admin-${suffix}@example.test`);
    adminId = admin.id;
    await db.update(users).set({ rol: "admin" }).where(eq(users.id, admin.id));
    const adminSwitch = await request(server, "/api/v1/auth/role", {
      method: "PATCH",
      token: admin.token,
      body: { rol: "cliente" },
    });
    assert.equal(adminSwitch.status, 403);
    const [storedAdmin] = await db.select({ rol: users.rol }).from(users).where(eq(users.id, admin.id));
    assert.equal(storedAdmin?.rol, "admin");
  } finally {
    if (clientId !== undefined) {
      await db.delete(professionalProfiles).where(eq(professionalProfiles.usuarioId, clientId));
      await db.delete(users).where(eq(users.id, clientId));
    }
    if (adminId !== undefined) await db.delete(users).where(eq(users.id, adminId));
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

run().then(
  () => console.log("Worky account role switch integration tests passed."),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);