import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import app from "../src/app";
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
  let body: Record<string, any> | any[] | string | null = null;
  if (text) {
    try { body = JSON.parse(text) as Record<string, any> | any[]; }
    catch { body = text; }
  }
  return { status: response.status, body };
}

async function register(server: http.Server, name: string, rol: "cliente" | "profesional") {
  const email = `${unique}-${name}@example.test`;
  const [user] = await db.insert(users).values({
    nombre: name,
    email,
    emailVerifiedAt: new Date(),
    passwordHash: await bcrypt.hash(password, 12),
    rol,
    ...(rol === "profesional" ? { onboardingEstado: "professional_verification_pending" as const } : {}),
  }).returning({ id: users.id });
  const response = await request(server, `${baseUrl}/auth/login`, {
    method: "POST",
    body: { email, password },
  });
  assert.equal(response.status, 200);
  return { ...(response.body as { token: string }), usuario: { id: user.id } };
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
      body: {
        oficio: "Plomero de ubicación",
        categoria: "Plomería",
        precioReferencia: 15000,
        ubicacionFija: {
          direccionTexto: "San Martín 123",
          ciudad: "Córdoba",
          provincia: "Córdoba",
          coordinates: [-64.1833, -31.4167],
        },
      },
    });
    assert.equal(profile.status, 201);
    assert.deepEqual(profile.body.ubicacionFija, {
      direccionTexto: "San Martín 123",
      ciudad: "Córdoba",
      provincia: "Córdoba",
    });
    assert.equal("coordinates" in profile.body.ubicacionFija, false);
    await db.update(professionalProfiles).set({
      verificado: true,
      estadoVerificacion: "verified",
      habilitado: true,
    }).where(eq(professionalProfiles.usuarioId, professional.usuario.id));

    const [saved] = await db.select({ ubicacionFija: professionalProfiles.ubicacionFija }).from(professionalProfiles).where(eq(professionalProfiles.usuarioId, professionalId));
    assert.deepEqual((saved?.ubicacionFija as { coordinates?: unknown })?.coordinates, [-64.1833, -31.4167]);

    const publicProfiles = await request(server, `${baseUrl}/profesionales?search=professional&longitud=-64.1833&latitud=-31.4167`);
    assert.equal(publicProfiles.status, 200);
    const publicProfile = publicProfiles.body.find((item: any) => item.usuario?.id === professionalId);
    assert.ok(publicProfile);
    assert.equal("coordinates" in (publicProfile.ubicacionFija ?? {}), false);
    assert.equal(publicProfile.ubicacionFija.direccionTexto, "San Martín 123");
    assert.equal(typeof publicProfile.distanceKm, "number");
    assert.equal(publicProfile.distanceKm, 0);

    const nearbyProfiles = await request(server, `${baseUrl}/profesionales?search=professional&latitud=-31.42&longitud=-64.2`);
    assert.equal(nearbyProfiles.status, 200);
    const nearbyProfile = nearbyProfiles.body.find((item: any) => item.usuario?.id === professionalId);
    assert.ok(nearbyProfile);
    assert.equal(typeof nearbyProfile.distanceKm, "number");
    assert.ok(nearbyProfile.distanceKm > 0);
    const noClientLocation = await request(server, `${baseUrl}/profesionales?search=professional`);
    const noLocationProfile = noClientLocation.body.find((item: any) => item.usuario?.id === professionalId);
    assert.equal(noLocationProfile.distanceKm, null);

    const profileUpdate = await request(server, `${baseUrl}/partner-profile/me`, {
      method: "PUT",
      token: professional.token,
      body: {
        oficio: "Plomero de ubicación",
        categoria: "Plomería",
        precioReferencia: 15000,
        ubicacionFija: { direccionTexto: "San Martín 456", ciudad: "Córdoba", provincia: "Córdoba" },
      },
    });
    assert.equal(profileUpdate.status, 200);
    assert.equal(profileUpdate.body.ubicacionFija.direccionTexto, "San Martín 456");
    assert.equal("coordinates" in profileUpdate.body.ubicacionFija, false);
    const [preservedLocation] = await db.select({ ubicacionFija: professionalProfiles.ubicacionFija }).from(professionalProfiles).where(eq(professionalProfiles.usuarioId, professionalId));
    assert.deepEqual((preservedLocation?.ubicacionFija as { coordinates?: unknown })?.coordinates, [-64.1833, -31.4167]);

    const invalidFixedLocation = await request(server, `${baseUrl}/partner-profile/me`, {
      method: "PUT",
      token: professional.token,
      body: {
        oficio: "Plomero de ubicación",
        categoria: "Plomería",
        precioReferencia: 15000,
        ubicacionFija: { direccionTexto: "San Martín 123", ciudad: "Córdoba", coordinates: [-181, -31] },
      },
    });
    assert.equal(invalidFixedLocation.status, 400);

    await db.update(users).set({
      ubicacion: { direccionTexto: "Domicilio anterior", ciudad: "Córdoba", coordinates: [-58.3816, -34.6037], capturedAt: new Date().toISOString() },
    }).where(eq(users.id, professionalId));
    const authenticatedAccount = await request(server, `${baseUrl}/auth/me`, { token: professional.token });
    assert.equal(authenticatedAccount.status, 200);
    assert.equal("coordinates" in authenticatedAccount.body.ubicacion, false);
    assert.equal("capturedAt" in authenticatedAccount.body.ubicacion, false);

    const deprecatedLiveLocation = await request(server, `${baseUrl}/auth/location`, {
      method: "PATCH",
      token: professional.token,
      body: { coordinates: [-58.3816, -34.6037] },
    });
    assert.equal(deprecatedLiveLocation.status, 404);
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