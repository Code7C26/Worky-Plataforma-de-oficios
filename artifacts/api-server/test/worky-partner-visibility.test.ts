import assert from "node:assert/strict";
import http from "node:http";
import { and, eq } from "drizzle-orm";
import app from "../src/app";
import {
  db,
  professionalProfiles,
  users,
  workyAuditEvents,
} from "@workspace/db";

const unique =
  "partner-visibility-" +
  Date.now() +
  "-" +
  Math.random().toString(36).slice(2);
const password = "partner-visibility-test-password";
const baseUrl = "/api/v1";

type Role = "cliente" | "profesional";

async function request(
  server: http.Server,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
) {
  const address = server.address();
  assert(address && typeof address !== "string");
  const response = await fetch("http://127.0.0.1:" + address.port + path, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: "Bearer " + options.token } : {}),
      ...(options.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as any) : null,
  };
}

async function register(server: http.Server, name: string, rol: Role) {
  const email = unique + "-" + name + "@example.test";
  const response = await request(server, baseUrl + "/auth/register", {
    method: "POST",
    body: { nombre: name, email, password, rol },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return {
    token: response.body.token as string,
    id: response.body.usuario.id as number,
    email,
  };
}

async function run() {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  let adminId: number | undefined;
  let partnerId: number | undefined;
  let profileId: number | undefined;

  try {
    const admin = await register(server, "admin", "cliente");
    adminId = admin.id;
    const partner = await register(server, "partner", "profesional");
    partnerId = partner.id;
    await db.update(users).set({ rol: "admin" }).where(eq(users.id, adminId));

    const createdProfile = await request(server, baseUrl + "/partner-profile", {
      method: "POST",
      token: partner.token,
      body: {
        oficio: "Plomero de pruebas",
        categoria: "Plomería",
        precioReferencia: 15000,
      },
    });
    assert.equal(createdProfile.status, 201);
    profileId = createdProfile.body.id as number;

    const partnerPath = baseUrl + "/admin/partners/" + partnerId + "/estado";
    const anonymousUpdate = await request(server, partnerPath, {
      method: "PATCH",
      body: { activo: false, motivo: "Prueba de autorización" },
    });
    assert.equal(anonymousUpdate.status, 401);
    const partnerUpdate = await request(server, partnerPath, {
      method: "PATCH",
      token: partner.token,
      body: { activo: false, motivo: "Prueba de autorización" },
    });
    assert.equal(partnerUpdate.status, 403);
    const missingReason = await request(server, partnerPath, {
      method: "PATCH",
      token: admin.token,
      body: { activo: false },
    });
    assert.equal(missingReason.status, 400);

    const query =
      baseUrl + "/profesionales?search=" + encodeURIComponent(unique);
    const pendingList = await request(server, query);
    assert.equal(pendingList.status, 200);
    assert.equal(
      pendingList.body.some((item: any) => item.usuario?.id === partnerId),
      false,
    );
    assert.equal(
      (await request(server, baseUrl + "/profesionales/" + profileId)).status,
      404,
    );
    assert.equal(
      (
        await request(
          server,
          baseUrl + "/profesionales/" + profileId + "/reputacion",
        )
      ).status,
      404,
    );

    await db
      .update(professionalProfiles)
      .set({ verificado: true, estadoVerificacion: "verified" })
      .where(eq(professionalProfiles.usuarioId, partnerId));
    const approvedList = await request(server, query);
    assert.equal(approvedList.status, 200);
    assert.ok(
      approvedList.body.some((item: any) => item.usuario?.id === partnerId),
    );
    assert.equal(
      (await request(server, baseUrl + "/profesionales/" + profileId)).status,
      200,
    );
    assert.equal(
      (
        await request(
          server,
          baseUrl + "/profesionales/" + profileId + "/reputacion",
        )
      ).status,
      200,
    );

    const disabled = await request(server, partnerPath, {
      method: "PATCH",
      token: admin.token,
      body: { activo: false, motivo: "Deshabilitación de prueba" },
    });
    assert.equal(disabled.status, 200);
    assert.deepEqual(disabled.body, {
      partnerId,
      activo: false,
      changed: true,
    });
    assert.equal(
      (await request(server, query)).body.some(
        (item: any) => item.usuario?.id === partnerId,
      ),
      false,
    );
    assert.equal(
      (await request(server, baseUrl + "/profesionales/" + profileId)).status,
      404,
    );
    assert.equal(
      (
        await request(
          server,
          baseUrl + "/profesionales/" + profileId + "/reputacion",
        )
      ).status,
      404,
    );
    const disabledLogin = await request(server, baseUrl + "/auth/login", {
      method: "POST",
      body: { email: partner.email, password },
    });
    assert.equal(disabledLogin.status, 401);

    const repeatedDisable = await request(server, partnerPath, {
      method: "PATCH",
      token: admin.token,
      body: { activo: false, motivo: "Repetición idempotente" },
    });
    assert.deepEqual(repeatedDisable.body, {
      partnerId,
      activo: false,
      changed: false,
    });

    const enabled = await request(server, partnerPath, {
      method: "PATCH",
      token: admin.token,
      body: { activo: true, motivo: "Rehabilitación de prueba" },
    });
    assert.deepEqual(enabled.body, { partnerId, activo: true, changed: true });
    assert.equal(
      (await request(server, query)).body.some(
        (item: any) => item.usuario?.id === partnerId,
      ),
      true,
    );

    const auditRows = await db
      .select()
      .from(workyAuditEvents)
      .where(
        and(
          eq(workyAuditEvents.entidad, "partner"),
          eq(workyAuditEvents.entidadId, partnerId),
        ),
      );
    assert.equal(auditRows.length, 2);
    const disableEvent = auditRows.find((event) => event.accion === "disabled");
    const enableEvent = auditRows.find((event) => event.accion === "enabled");
    assert.equal(disableEvent?.usuarioId, adminId);
    assert.equal(disableEvent?.estadoAnterior, "activo");
    assert.equal(disableEvent?.estadoNuevo, "inactivo");
    assert.equal(
      (disableEvent?.metadata as { motivo?: string }).motivo,
      "Deshabilitación de prueba",
    );
    assert.equal(enableEvent?.usuarioId, adminId);
    assert.equal(enableEvent?.estadoAnterior, "inactivo");
    assert.equal(enableEvent?.estadoNuevo, "activo");
  } finally {
    if (adminId !== undefined)
      await db
        .delete(workyAuditEvents)
        .where(eq(workyAuditEvents.usuarioId, adminId));
    if (partnerId !== undefined) {
      await db
        .delete(workyAuditEvents)
        .where(
          and(
            eq(workyAuditEvents.entidad, "partner"),
            eq(workyAuditEvents.entidadId, partnerId),
          ),
        );
      await db
        .delete(professionalProfiles)
        .where(eq(professionalProfiles.usuarioId, partnerId));
      await db.delete(users).where(eq(users.id, partnerId));
    }
    if (adminId !== undefined)
      await db.delete(users).where(eq(users.id, adminId));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

run()
  .then(() => {
    console.log("Worky Partner visibility integration tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
