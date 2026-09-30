import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import app from "../src/app";

const unique = `account-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const originalPassword = "account-settings-password";
const newPassword = "account-settings-new-password";
const firstEmail = `${unique}-first@example.test`;
const secondEmail = `${unique}-second@example.test`;
const changedEmail = `${unique}-changed@example.test`;
const concurrentEmail = `${unique}-concurrent@example.test`;
const throttledEmail = `${unique}-throttled@example.test`;
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
  return { status: response.status, body: text ? JSON.parse(text) as Record<string, any> : null };
}

async function register(server: http.Server, nombre: string, email: string) {
  const response = await request(server, `${baseUrl}/auth/register`, {
    method: "POST",
    body: {
      nombre,
      email,
      password: originalPassword,
      telefono: "351 000 0000",
      edad: 30,
      ubicacion: {
        direccionTexto: "Dirección original 123",
        ciudad: "Córdoba",
        provincia: "Córdoba",
        coordinates: [-64.1888, -31.4201],
        capturedAt: new Date().toISOString(),
      },
    },
  });
  assert.equal(response.status, 201);
  return response.body as { token: string; usuario: { id: number } };
}

async function run() {
  const server = app.listen(0);
  const createdUserIds: number[] = [];

  try {
    const first = await register(server, "Cuenta Configuración", firstEmail);
    const second = await register(server, "Cuenta Ocupada", secondEmail);
    const throttled = await register(server, "Cuenta Limitada", throttledEmail);
    createdUserIds.push(first.usuario.id, second.usuario.id, throttled.usuario.id);

    const updated = await request(server, `${baseUrl}/auth/me`, {
      method: "PATCH",
      token: first.token,
      body: {
        nombre: "Cuenta Actualizada",
        email: firstEmail,
        telefono: "351 555 0101",
        edad: 31,
        ubicacion: {
          direccionTexto: "Nueva dirección 456",
          ciudad: "Villa Allende",
          provincia: "Córdoba",
        },
      },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.nombre, "Cuenta Actualizada");
    assert.equal(updated.body.telefono, "351 555 0101");
    assert.equal(updated.body.edad, 31);
    assert.equal(updated.body.ubicacion.direccionTexto, "Nueva dirección 456");

    const [storedAfterAddress] = await db.select({ ubicacion: users.ubicacion }).from(users).where(eq(users.id, first.usuario.id));
    assert.deepEqual((storedAfterAddress.ubicacion as { coordinates?: unknown }).coordinates, [-64.1888, -31.4201]);

    const addressOnly = await request(server, `${baseUrl}/auth/me`, {
      method: "PATCH",
      token: first.token,
      body: {
        ubicacion: {
          direccionTexto: "Dirección final 789",
          ciudad: "Mendiolaza",
          provincia: "Córdoba",
        },
      },
    });
    assert.equal(addressOnly.status, 200);
    assert.equal(addressOnly.body.telefono, "351 555 0101");
    assert.equal(addressOnly.body.edad, 31);

    await db.update(users).set({ rol: "profesional" }).where(eq(users.id, first.usuario.id));
    const [addressRace, locationRace] = await Promise.all([
      request(server, `${baseUrl}/auth/me`, {
        method: "PATCH",
        token: first.token,
        body: {
          ubicacion: {
            direccionTexto: "Dirección concurrente 321",
            ciudad: "Unquillo",
            provincia: "Córdoba",
          },
        },
      }),
      request(server, `${baseUrl}/auth/location`, {
        method: "PATCH",
        token: first.token,
        body: { coordinates: [-64.32, -31.24] },
      }),
    ]);
    assert.equal(addressRace.status, 200);
    assert.equal(locationRace.status, 200);
    const [storedAfterRace] = await db.select({ ubicacion: users.ubicacion }).from(users).where(eq(users.id, first.usuario.id));
    const racedLocation = storedAfterRace.ubicacion as { direccionTexto?: string; coordinates?: number[] };
    assert.equal(racedLocation.direccionTexto, "Dirección concurrente 321");
    assert.deepEqual(racedLocation.coordinates, [-64.32, -31.24]);

    const emailWithoutPassword = await request(server, `${baseUrl}/auth/me`, {
      method: "PATCH",
      token: first.token,
      body: { nombre: "Cuenta Actualizada", email: changedEmail },
    });
    assert.equal(emailWithoutPassword.status, 401);

    const occupiedEmail = await request(server, `${baseUrl}/auth/me`, {
      method: "PATCH",
      token: first.token,
      body: { nombre: "Cuenta Actualizada", email: secondEmail, currentPassword: originalPassword },
    });
    assert.equal(occupiedEmail.status, 409);

    const concurrentEmailChanges = await Promise.all([
      request(server, `${baseUrl}/auth/me`, {
        method: "PATCH",
        token: first.token,
        body: { email: concurrentEmail, currentPassword: originalPassword },
      }),
      request(server, `${baseUrl}/auth/me`, {
        method: "PATCH",
        token: second.token,
        body: { email: concurrentEmail, currentPassword: originalPassword },
      }),
    ]);
    assert.deepEqual(concurrentEmailChanges.map(({ status }) => status).sort(), [200, 409]);

    const changed = await request(server, `${baseUrl}/auth/me`, {
      method: "PATCH",
      token: first.token,
      body: { email: changedEmail.toUpperCase(), currentPassword: originalPassword },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.email, changedEmail);

    const wrongCurrentPassword = await request(server, `${baseUrl}/auth/password`, {
      method: "PATCH",
      token: first.token,
      body: { currentPassword: "incorrect-password", newPassword },
    });
    assert.equal(wrongCurrentPassword.status, 401);

    const samePassword = await request(server, `${baseUrl}/auth/password`, {
      method: "PATCH",
      token: first.token,
      body: { currentPassword: originalPassword, newPassword: originalPassword },
    });
    assert.equal(samePassword.status, 400);

    const passwordChanged = await request(server, `${baseUrl}/auth/password`, {
      method: "PATCH",
      token: first.token,
      body: { currentPassword: originalPassword, newPassword },
    });
    assert.equal(passwordChanged.status, 200);
    assert.equal(passwordChanged.body.success, true);

    const oldLogin = await request(server, `${baseUrl}/auth/login`, {
      method: "POST",
      body: { email: changedEmail, password: originalPassword },
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await request(server, `${baseUrl}/auth/login`, {
      method: "POST",
      body: { email: changedEmail, password: newPassword },
    });
    assert.equal(newLogin.status, 200);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const wrongPassword = await request(server, `${baseUrl}/auth/password`, {
        method: "PATCH",
        token: throttled.token,
        body: { currentPassword: `incorrect-${attempt}`, newPassword },
      });
      assert.equal(wrongPassword.status, 401);
    }
    const throttledAttempt = await request(server, `${baseUrl}/auth/password`, {
      method: "PATCH",
      token: throttled.token,
      body: { currentPassword: "incorrect-final", newPassword },
    });
    assert.equal(throttledAttempt.status, 429);
  } finally {
    for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

run().then(() => {
  console.log("Worky account settings integration tests passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});