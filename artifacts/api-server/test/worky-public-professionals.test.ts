import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { inArray } from "drizzle-orm";
import { db, professionalProfiles, users } from "@workspace/db";
import app from "../src/app";

const unique = "public-directory-" + randomUUID();
const householdCategories = ["Plomería", "Electricidad", "Gas", "Albañilería"];

async function createUser(nombre: string, rol: "cliente" | "profesional") {
  const [user] = await db.insert(users).values({
    nombre: unique + " " + nombre,
    email: unique + "-" + nombre + "@example.test",
    passwordHash: "not-used-by-this-test",
    rol,
  }).returning({ id: users.id });
  return user.id;
}

async function createProfile(usuarioId: number, oficio: string, categoria: "Plomería" | "Electricidad" | "Gas" | "Albañilería" | "Otro", disponible = true) {
  await db.insert(professionalProfiles).values({
    usuarioId,
    oficio,
    categoria,
    precioReferencia: "12000",
    disponible,
  });
}

async function run() {
  const server = app.listen(0);
  const userIds: number[] = [];
  try {
    const clientId = await createUser("client-with-legacy-profile", "cliente");
    userIds.push(clientId);
    await createProfile(clientId, "Plomero", "Plomería");

    const gasistaId = await createUser("available-gasista", "profesional");
    userIds.push(gasistaId);
    await createProfile(gasistaId, "Gasista matriculado", "Gas");

    const otherId = await createUser("it-service", "profesional");
    userIds.push(otherId);
    await createProfile(otherId, "Servicios IT", "Otro");

    const unavailableId = await createUser("unavailable-plumber", "profesional");
    userIds.push(unavailableId);
    await createProfile(unavailableId, "Plomero", "Plomería", false);

    const address = server.address();
    assert(address && typeof address !== "string");
    const response = await fetch(
      "http://127.0.0.1:" + address.port + "/api/v1/profesionales?search=" + encodeURIComponent(unique) + "&limit=50",
    );
    assert.equal(response.status, 200);
    const profiles = await response.json() as Array<{ usuario: { id: number; rol: string }; categoria: string }>;
    const listedIds = profiles.map((profile) => profile.usuario.id);
    assert(listedIds.includes(gasistaId), "available household professionals should be listed");
    assert(!listedIds.includes(clientId), "client accounts with legacy profiles must not be listed");
    assert(!listedIds.includes(otherId), "the catch-all category must not expose unrelated services");
    assert(!listedIds.includes(unavailableId), "unavailable profiles must not appear in public search");
    assert(profiles.every((profile) => profile.usuario.rol === "profesional" && householdCategories.includes(profile.categoria)), "all results must be active professional accounts in household categories");
  } finally {
    if (userIds.length) {
      await db.delete(professionalProfiles).where(inArray(professionalProfiles.usuarioId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

run().then(() => {
  console.log("Public professional directory integration test passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});