import assert from "node:assert/strict";
import http from "node:http";
import app from "../src/app";
import { PROFESSIONAL_LOCATION_MAX_AGE_MS } from "../src/routes/worky";
import { eq } from "drizzle-orm";
import { db, professionalProfiles, users } from "@workspace/db";

const unique = `location-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const password = "location-test-password";
const baseUrl = "/api/v1";

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

async function register(server: http.Server, name: string, rol: "cliente" | "profesional") {
  const response = await request(server, `${baseUrl}/auth/register`, {
    method: "POST",
    body: { nombre: name, email: `${unique}-${name}@example.test`, password, rol },
  });
  assert.equal(response.status, 201);
  return response.body as { token: string; usuario: { id: number } };
}

async function run() {
  const server = app.listen(0);
  let professionalId: number | undefined;
  let clientId: number | undefined;

  try {
    const professional = await register(server, "professional", "profesional");
    const client = await register(server, "client", "cliente");
    professionalId = professional.usuario.id;
    clientId = client.usuario.id;

    const profile = await request(server, `${baseUrl}/partner-profile`, {
      method: "POST",
      token: professional.token,
      body: { oficio: "Plomero de ubicación", categoria: "Plomería", precioReferencia: 15000 },
    });
    assert.equal(profile.status, 201);
    await db.update(professionalProfiles).set({ verificado: true, estadoVerificacion: "verified" }).where(eq(professionalProfiles.usuarioId, professionalId));

    const firstUpdate = await request(server, `${baseUrl}/auth/location`, {
      method: "PATCH",
      token: professional.token,
      body: { coordinates: [-58.3816, -34.6037] },
    });
    assert.equal(firstUpdate.status, 200);
    assert.deepEqual(firstUpdate.body.coordinates, [-58.3816, -34.6037]);
    assert.equal(typeof firstUpdate.body.capturedAt, "string");

    const [saved] = await db.select({ ubicacion: users.ubicacion }).from(users).where(eq(users.id, professionalId));
    assert.deepEqual((saved?.ubicacion as { coordinates?: unknown })?.coordinates, [-58.3816, -34.6037]);
    assert.equal(typeof (saved?.ubicacion as { capturedAt?: unknown })?.capturedAt, "string");

    const publicProfiles = await request(server, `${baseUrl}/profesionales?search=professional&longitud=-58.3816&latitud=-34.6037`);
    assert.equal(publicProfiles.status, 200);
    const publicProfile = publicProfiles.body.find((item: any) => item.usuario?.id === professionalId);
    assert.ok(publicProfile);
    assert.equal("coordinates" in (publicProfile.usuario.ubicacion ?? {}), false);
    assert.equal(typeof publicProfile.distanceKm, "number");

    const nearbyProfiles = await request(server, `${baseUrl}/profesionales?search=professional&latitud=-34.61&longitud=-58.4`);
    assert.equal(nearbyProfiles.status, 200);
    const nearbyProfile = nearbyProfiles.body.find((item: any) => item.usuario?.id === professionalId);
    assert.ok(nearbyProfile);
    assert.equal(typeof nearbyProfile.distanceKm, "number");
    assert.ok(nearbyProfile.distanceKm > 0);

    await db.update(users).set({
      ubicacion: {
        coordinates: [-58.3816, -34.6037],
        capturedAt: new Date(Date.now() - PROFESSIONAL_LOCATION_MAX_AGE_MS - 1).toISOString(),
      },
    }).where(eq(users.id, professionalId));
    const expiredProfiles = await request(server, `${baseUrl}/profesionales?search=professional&longitud=-58.3816&latitud=-34.6037`);
    assert.equal(expiredProfiles.status, 200);
    const expiredProfile = expiredProfiles.body.find((item: any) => item.usuario?.id === professionalId);
    assert.ok(expiredProfile);
    assert.equal(expiredProfile.distanceKm, null);
    assert.equal("coordinates" in (expiredProfile.usuario.ubicacion ?? {}), false);

    const recoveredUpdate = await request(server, `${baseUrl}/auth/location`, {
      method: "PATCH",
      token: professional.token,
      body: { coordinates: [-58.3816, -34.6037] },
    });
    assert.equal(recoveredUpdate.status, 200);
    const recoveredProfiles = await request(server, `${baseUrl}/profesionales?search=professional&longitud=-58.3816&latitud=-34.6037`);
    assert.equal(recoveredProfiles.status, 200);
    const recoveredProfile = recoveredProfiles.body.find((item: any) => item.usuario?.id === professionalId);
    assert.ok(recoveredProfile);
    assert.equal(typeof recoveredProfile.distanceKm, "number");
    assert.equal("coordinates" in (recoveredProfile.usuario.ubicacion ?? {}), false);

    const clientUpdate = await request(server, `${baseUrl}/auth/location`, {
      method: "PATCH",
      token: client.token,
      body: { coordinates: [-58.4, -34.61] },
    });
    assert.equal(clientUpdate.status, 403);

    const invalidUpdate = await request(server, `${baseUrl}/auth/location`, {
      method: "PATCH",
      token: professional.token,
      body: { coordinates: [-181, -34.61] },
    });
    assert.equal(invalidUpdate.status, 400);
  } finally {
    if (professionalId) {
      await db.delete(professionalProfiles).where(eq(professionalProfiles.usuarioId, professionalId));
      await db.delete(users).where(eq(users.id, professionalId));
    }
    if (clientId) await db.delete(users).where(eq(users.id, clientId));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

run().then(() => {
  console.log("Worky location integration tests passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});