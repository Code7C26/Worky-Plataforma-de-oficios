import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import app from "../src/app";
import { db, jobs, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const baseUrl = "/api/v1";
const password = "category-test-password";

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
  return { status: response.status, body: text ? JSON.parse(text) as Record<string, any> : null };
}

async function run() {
  const server = app.listen(0);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `job-category-${suffix}@example.test`;
  let userId: number | undefined;

  try {
    const passwordHash = await bcrypt.hash(password, 4);
    const [user] = await db.insert(users).values({
      nombre: "Cliente de prueba",
      email,
      emailVerifiedAt: new Date(),
      passwordHash,
    }).returning({ id: users.id });
    userId = user.id;

    const login = await request(server, `${baseUrl}/auth/login`, {
      method: "POST",
      body: { email, password },
    });
    assert.equal(login.status, 200);
    const token = login.body?.token as string;
    assert.ok(token);

    const masonryJob = await request(server, `${baseUrl}/trabajos`, {
      method: "POST",
      token,
      body: {
        ubicacion: { direccionTexto: "Calle de prueba 123", ciudad: "Ciudad de prueba" },
        categoria: "Albañil",
        precioOfrecido: 12000,
        detalle: "Reparar una pared",
      },
    });
    assert.equal(masonryJob.status, 201);
    assert.equal(masonryJob.body?.categoria, "Albañilería");

    const paintingJob = await request(server, `${baseUrl}/trabajos`, {
      method: "POST",
      token,
      body: {
        ubicacion: { direccionTexto: "Calle de prueba 456", ciudad: "Ciudad de prueba" },
        categoria: "Pintor",
        precioOfrecido: 15000,
        detalle: "Pintar una habitación",
      },
    });
    assert.equal(paintingJob.status, 201);
    assert.equal(paintingJob.body?.categoria, "Otro");
    assert.match(paintingJob.body?.detalle ?? "", /^Oficio solicitado: Pintor/);

    const stored = await db.select({ categoria: jobs.categoria }).from(jobs).where(eq(jobs.clienteId, userId));
    assert.deepEqual(stored.map((job) => job.categoria), ["Albañilería", "Otro"]);
  } finally {
    if (userId !== undefined) {
      await db.delete(jobs).where(eq(jobs.clienteId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

void run();
