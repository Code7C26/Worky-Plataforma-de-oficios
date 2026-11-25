import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import { and, asc, eq, inArray } from "drizzle-orm";
import app from "../src/app";
import {
  db,
  clientIdentityVerifications,
  pool,
  jobs,
  professionalProfiles,
  professionalVerificationDocuments,
  users,
  workyAuditEvents,
  workyNotifications,
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
let clientJobId: number | undefined;
const previousPrimaryAdminEmail = process.env.WORKY_ADMIN_PRIMARY_EMAIL;

async function run() {
  try {
    const admin = await createAccount("admin", "admin");
    accountIds.push(admin.id);
    process.env.WORKY_ADMIN_PRIMARY_EMAIL = `${unique}-admin@example.test`;
    const client = await createAccount("client", "cliente");
    accountIds.push(client.id);
    const delegated = await createAccount("delegated", "cliente");
    accountIds.push(delegated.id);
    const managedClient = await createAccount("managed-client", "cliente");
    accountIds.push(managedClient.id);
    const partner = await createAccount("partner", "profesional");
    accountIds.push(partner.id);
    partnerId = partner.id;

    assert.equal((await request(server, `${baseUrl}/admin/dashboard`)).status, 401);
    assert.equal((await request(server, `${baseUrl}/admin/dashboard`, { token: client.token })).status, 403);
    assert.equal((await request(server, `${baseUrl}/admin/partner-applications`)).status, 401);
    assert.equal((await request(server, `${baseUrl}/admin/partner-applications`, { token: client.token })).status, 403);
    const dashboard = await request(server, `${baseUrl}/admin/dashboard`, { token: admin.token });
    assert.equal(dashboard.status, 200);
    assert.equal(typeof (dashboard.body as Record<string, unknown>).accountsTotal, "number");

    assert.equal((await request(server, `${baseUrl}/admin/client-verifications`)).status, 401);
    assert.equal((await request(server, `${baseUrl}/admin/client-verifications`, { token: client.token })).status, 403);
    const missingClientConsent = await request(server, `${baseUrl}/auth/client-verification`, {
      method: "POST", token: client.token, body: { dniUploadId: 1, selfieUploadId: 2 },
    });
    assert.equal(missingClientConsent.status, 400);
    assert.match(missingClientConsent.body.error, /consentimiento/);
    const [clientCase] = await db.insert(clientIdentityVerifications).values({
      usuarioId: client.id,
      dniObjectPath: `/objects/client-verification/${client.id}/review/${crypto.randomUUID()}.webp`,
      selfieObjectPath: `/objects/client-verification/${client.id}/review/${crypto.randomUUID()}.webp`,
    }).returning();
    const statusView = await request(server, `${baseUrl}/auth/client-verification`, { token: client.token });
    assert.equal(statusView.status, 200);
    assert.equal(statusView.body.status, "pending_verification");
    assert.equal("dniObjectPath" in statusView.body, false);
    assert.equal("selfieObjectPath" in statusView.body, false);
    const invalidIdentityImage = await request(server, `${baseUrl}/storage/uploads/request-url`, {
      method: "POST",
      token: client.token,
      body: { name: "dni.txt", size: 64, contentType: "text/plain", purpose: "client_verification", documentType: "dni" },
    });
    assert.equal(invalidIdentityImage.status, 400);
    const adminQueue = await request(server, `${baseUrl}/admin/client-verifications?search=${unique}`, { token: admin.token });
    assert.equal(adminQueue.status, 200);
    const publicQueueRecord = adminQueue.body.items.find((item: Record<string, unknown>) => item.id === clientCase.id);
    assert.deepEqual(Object.keys(publicQueueRecord).sort(), ["email", "hasDni", "hasSelfie", "id", "name", "submittedAt", "userId"]);
    assert.equal((await request(server, `${baseUrl}/admin/client-verifications/${clientCase.id}/files/dni`, { token: client.token })).status, 403);

    const profileResponse = await request(server, `${baseUrl}/partner-profile`, {
      method: "POST",
      token: partner.token,
      body: { oficio: "Plomero de prueba", categoria: "Plomería", precioReferencia: 12000, ubicacionFija: { direccionTexto: "Av. Siempre Viva 123", ciudad: "Córdoba" } },
    });
    assert.equal(profileResponse.status, 201);
    const [profile] = await db.select({ id: professionalProfiles.id }).from(professionalProfiles)
      .where(eq(professionalProfiles.usuarioId, partner.id)).limit(1);
    assert.ok(profile);
    assert.equal((await request(server, `${baseUrl}/trabajos/disponibles`, { token: partner.token })).status, 403);
    assert.equal((await request(server, `${baseUrl}/trabajos/1/aceptar`, { method: "PATCH", token: partner.token })).status, 403);
    assert.equal((await request(server, `${baseUrl}/partner/disponibilidad`, { token: partner.token })).status, 403);
    assert.equal((await request(server, `${baseUrl}/partner/disponibilidad`, { method: "PUT", token: partner.token, body: [] })).status, 403);
    assert.equal((await request(server, `${baseUrl}/partner/activos`, { token: partner.token })).status, 403);
    assert.equal((await request(server, `${baseUrl}/partner/activos`, { method: "POST", token: partner.token, body: {} })).status, 403);
    const pendingOnboarding = await request(server, `${baseUrl}/auth/onboarding`, {
      method: "PATCH", token: partner.token, body: { estado: "onboarding_completed", paso: 3 },
    });
    assert.equal(pendingOnboarding.status, 200);
    const [pendingAccount] = await db.select().from(users).where(eq(users.id, partner.id));
    assert.equal(pendingAccount.onboardingEstado, "professional_verification_pending");
    const blockedDirectJob = await request(server, `${baseUrl}/trabajos`, {
      method: "POST", token: client.token,
      body: { profesionalId: partner.id, categoria: "Plomería", precioOfrecido: 12000, ubicacion: { direccionTexto: "Zona de prueba" } },
    });
    assert.equal(blockedDirectJob.status, 409);
    const blockedEnable = await request(server, `${baseUrl}/admin/partners/${partner.id}/activation`, {
      method: "PATCH",
      token: admin.token,
      body: { enabled: true, reason: "Faltan documentos" },
    });
    assert.equal(blockedEnable.status, 409);
    const applicationsPath = `${baseUrl}/admin/partner-applications?search=${unique}`;
    const missingFiles = await request(server, applicationsPath, { token: admin.token });
    assert.equal(missingFiles.status, 200);
    const missingApplication = (missingFiles.body as Record<string, any>).items.find((item: any) => item.partner.userId === partner.id);
    assert.ok(missingApplication, "A profile without documents must still appear");
    assert.deepEqual(missingApplication.documents, []);
    const requiredDocuments = ["dni_frente", "dni_dorso", "antecedentes_penales"] as const;
    const docs = await db.insert(professionalVerificationDocuments).values(requiredDocuments.map((tipo) => ({
      profesionalId: partner.id,
      tipo,
      objectPath: `private-test/${unique}/${tipo}.jpg`,
      nombre: `${tipo}.jpg`,
      contentType: "image/jpeg",
      sizeBytes: 1200,
      estado: "pending_verification" as const,
    }))).returning();
    for (const doc of docs) {
      const approval = await request(server, `${baseUrl}/admin/verificaciones/${doc.id}`, {
        method: "PATCH", token: admin.token, body: { estado: "verified", motivo: "Documentación de QA revisada" },
      });
      assert.equal(approval.status, 200);
    }
    // Document approval alone never enables the professional.
    assert.equal((await request(server, `${baseUrl}/trabajos/disponibles`, { token: partner.token })).status, 403);

    const reviewedApplication = (await request(server, applicationsPath, { token: admin.token })).body as Record<string, any>;
    assert.equal(reviewedApplication.items[0].partner.userId, partner.id);
    assert.equal(reviewedApplication.items[0].documents.length, 3);
    assert.ok(reviewedApplication.items[0].documents.every((doc: any) => doc.estado === "verified"));
    assert.ok(reviewedApplication.items[0].emailVerifiedAt);
    assert.equal((await request(server, `${baseUrl}/partner/disponibilidad`, { token: partner.token })).status, 403, "Approved documents alone are not final enablement");
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

    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, partner.id));
    assert.equal((await request(server, `${baseUrl}/admin/partners/${partner.id}/activation`, {
      method: "PATCH", token: admin.token, body: { enabled: true, reason: "Debe verificar email" },
    })).status, 409);
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, partner.id));
    const enabled = await request(server, `${baseUrl}/admin/partners/${partner.id}/activation`, {
      method: "PATCH",
      token: admin.token,
      body: { enabled: true, reason: "Documentación aprobada" },
    });
    assert.equal(enabled.status, 200);
    assert.equal((enabled.body as Record<string, unknown>).enabled, true);
    assert.equal(((await request(server, applicationsPath, { token: admin.token })).body as Record<string, any>).total, 0);
    assert.equal((await request(server, `${baseUrl}/trabajos/disponibles`, { token: partner.token })).status, 200);
    assert.equal((await request(server, `${baseUrl}/partner/disponibilidad`, { token: partner.token })).status, 200);
    assert.equal((await request(server, `${baseUrl}/partner/activos`, { token: partner.token })).status, 200);
    const verifiedAt = new Date();
    await db.update(clientIdentityVerifications).set({
      estado: "verified", dniObjectPath: null, selfieObjectPath: null, reviewedAt: verifiedAt,
    }).where(eq(clientIdentityVerifications.id, clientCase.id));
    await db.update(users).set({ clientIdentityVerifiedAt: verifiedAt }).where(eq(users.id, client.id));
    const createdClientJob = await request(server, `${baseUrl}/trabajos`, {
      method: "POST", token: client.token,
      body: { categoria: "Plomería", precioOfrecido: 12000, ubicacion: { direccionTexto: "Zona de prueba" }, detalle: "Trabajo de prueba de identidad" },
    });
    assert.equal(createdClientJob.status, 201);
    clientJobId = createdClientJob.body.id as number;
    const ownJobs = await request(server, `${baseUrl}/trabajos/mias`, { token: client.token });
    const ownClient = ownJobs.body.find((job: Record<string, any>) => job.id === clientJobId).cliente;
    assert.equal("clientVerified" in ownClient, false, "la cuenta cliente no recibe el sello en su propia vista");
    const availableJobs = await request(server, `${baseUrl}/trabajos/disponibles`, { token: partner.token });
    assert.equal(availableJobs.body.find((job: Record<string, any>) => job.id === clientJobId).cliente.clientVerified, true);
    const acceptedClientJob = await request(server, `${baseUrl}/trabajos/${clientJobId}/aceptar`, { method: "PATCH", token: partner.token });
    assert.equal(acceptedClientJob.body.cliente.clientVerified, true);
    const workerJobView = await request(server, `${baseUrl}/trabajos/${clientJobId}`, { token: partner.token });
    assert.equal(workerJobView.body.cliente.clientVerified, true);
    const clientJobView = await request(server, `${baseUrl}/trabajos/${clientJobId}`, { token: client.token });
    assert.equal("clientVerified" in clientJobView.body.cliente, false, "la API no devuelve el sello al cliente");
    const [approvedAccount] = await db.select().from(users).where(eq(users.id, partner.id));
    assert.equal(approvedAccount.onboardingEstado, "onboarding_completed");
    const publicAfter = await request(server, `${baseUrl}/profesionales?search=${encodeURIComponent("Plomero de prueba")}`);
    assert.equal((publicAfter.body as Array<Record<string, any>>).some((item) => item.usuario?.id === partner.id), true);

    const disabled = await request(server, `${baseUrl}/admin/partners/${partner.id}/activation`, {
      method: "PATCH",
      token: admin.token,
      body: { enabled: false, reason: "Revisión administrativa" },
    });
    assert.equal(disabled.status, 200);
    assert.equal((await request(server, `${baseUrl}/profesionales/${profile.id}`)).status, 404);

    const licenceUpload = await request(server, `${baseUrl}/auth/verification-documents/matricula`, {
      method: "PUT", token: partner.token,
      body: { objectPath: `/objects/private-test/${unique}/matricula.pdf`, nombre: "matricula.pdf", contentType: "application/pdf", sizeBytes: 1500 },
    });
    assert.equal(licenceUpload.status, 200);
    const licenceId = (licenceUpload.body as Record<string, any>).id;
    const pendingLicence = (await request(server, applicationsPath, { token: admin.token })).body as Record<string, any>;
    assert.equal(pendingLicence.items[0].documents.length, 4);
    assert.equal(pendingLicence.items[0].documents.find((doc: any) => doc.tipo === "matricula").estado, "pending_verification");
    assert.equal((await request(server, `${baseUrl}/admin/partners/${partner.id}/activation`, {
      method: "PATCH", token: admin.token, body: { enabled: true, reason: "Matrícula todavía sin revisar" },
    })).status, 409);
    const licenceApproval = await request(server, `${baseUrl}/admin/verificaciones/${licenceId}`, {
      method: "PATCH", token: admin.token, body: { estado: "verified", motivo: "Matrícula revisada en QA" },
    });
    assert.equal(licenceApproval.status, 200);
    assert.equal((licenceApproval.body as Record<string, any>).profileStatus, "verified");
    assert.equal((await request(server, `${baseUrl}/admin/verificaciones/${licenceId}`, {
      method: "PATCH", token: admin.token, body: { estado: "verified", motivo: "No duplicar revisión" },
    })).status, 409);
    assert.equal((await request(server, `${baseUrl}/admin/partners/${partner.id}/activation`, {
      method: "PATCH", token: admin.token, body: { enabled: true, reason: "Matrícula adjunta y aprobada" },
    })).status, 200);

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

    const adminList = await request(server, `${baseUrl}/admin/admins`, { token: admin.token });
    assert.equal(adminList.status, 200);
    assert.equal((adminList.body as { isPrimaryAdmin: boolean }).isPrimaryAdmin, true);
    const promotion = await request(server, `${baseUrl}/admin/cuentas/rol`, {
      method: "PATCH", token: admin.token,
      body: { email: `${unique}-delegated@example.test`, motivo: "Delegación QA aprobada" },
    });
    assert.deepEqual(promotion.body, { rol: "admin", changed: true });
    assert.equal((await request(server, `${baseUrl}/admin/dashboard`, { token: delegated.token })).status, 200);

    const managedResource = await request(server, `${baseUrl}/admin/accounts/${managedClient.id}/status`, {
      method: "PATCH", token: delegated.token,
      body: { active: false, reason: "Gestión de cuenta QA" },
    });
    assert.equal(managedResource.status, 200);
    assert.equal((managedResource.body as Record<string, unknown>).active, false);

    const delegatedView = await request(server, `${baseUrl}/admin/admins`, { token: delegated.token });
    assert.deepEqual(delegatedView.body, { isPrimaryAdmin: false, primaryAdminId: null, items: [] });
    const blockedGrant = await request(server, `${baseUrl}/admin/cuentas/rol`, {
      method: "PATCH", token: delegated.token,
      body: { email: `${unique}-client@example.test`, motivo: "Intento delegado" },
    });
    assert.equal(blockedGrant.status, 403);
    const blockedRevoke = await request(server, `${baseUrl}/admin/admins/${admin.id}/role`, {
      method: "PATCH", token: delegated.token, body: { reason: "Intento delegado" },
    });
    assert.equal(blockedRevoke.status, 403);

    const selfRevoke = await request(server, `${baseUrl}/admin/admins/${admin.id}/role`, {
      method: "PATCH", token: admin.token, body: { reason: "Intento de auto quitar" },
    });
    assert.equal(selfRevoke.status, 409);

    const restoreManagedResource = await request(server, `${baseUrl}/admin/accounts/${managedClient.id}/status`, {
      method: "PATCH", token: admin.token,
      body: { active: true, reason: "Restauración de cuenta QA" },
    });
    assert.equal(restoreManagedResource.status, 200);
    assert.equal((restoreManagedResource.body as Record<string, unknown>).active, true);

    const revoke = await request(server, `${baseUrl}/admin/admins/${delegated.id}/role`, {
      method: "PATCH", token: admin.token, body: { reason: "Fin de delegación de prueba" },
    });
    assert.equal(revoke.status, 200);
    const [demoted] = await db.select({ role: users.rol }).from(users).where(eq(users.id, delegated.id));
    assert.equal(demoted?.role, "cliente");
    const roleAudit = await db.select({
      actorId: workyAuditEvents.usuarioId,
      entityId: workyAuditEvents.entidadId,
      action: workyAuditEvents.accion,
      previousState: workyAuditEvents.estadoAnterior,
      nextState: workyAuditEvents.estadoNuevo,
    }).from(workyAuditEvents).where(and(
      eq(workyAuditEvents.entidad, "account"),
      inArray(workyAuditEvents.entidadId, [delegated.id]),
    )).orderBy(asc(workyAuditEvents.id));
    assert.deepEqual(roleAudit, [
      {
        actorId: admin.id,
        entityId: delegated.id,
        action: "role_granted",
        previousState: "cliente",
        nextState: "admin",
      },
      {
        actorId: admin.id,
        entityId: delegated.id,
        action: "role_revoked",
        previousState: "admin",
        nextState: "cliente",
      },
    ]);
    assert.equal((await request(server, `${baseUrl}/admin/dashboard`, { token: delegated.token })).status, 403);
  } finally {
    if (previousPrimaryAdminEmail === undefined) delete process.env.WORKY_ADMIN_PRIMARY_EMAIL;
    else process.env.WORKY_ADMIN_PRIMARY_EMAIL = previousPrimaryAdminEmail;
    if (accountIds.length) {
      if (clientJobId) await db.delete(jobs).where(eq(jobs.id, clientJobId));
      await db.delete(workyNotifications).where(inArray(workyNotifications.usuarioId, accountIds));
      await db.delete(workyAuditEvents).where(inArray(workyAuditEvents.usuarioId, accountIds));
      if (partnerId) {
        await db.delete(professionalVerificationDocuments).where(eq(professionalVerificationDocuments.profesionalId, partnerId));
        await db.delete(professionalProfiles).where(eq(professionalProfiles.usuarioId, partnerId));
      }
      await db.delete(users).where(inArray(users.id, accountIds));
    }
    server.close();
    await pool.end();
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
