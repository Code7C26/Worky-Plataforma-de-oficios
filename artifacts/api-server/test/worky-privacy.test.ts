import assert from "node:assert/strict";
import http from "node:http";
import { TextDecoder } from "node:util";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import app from "../src/app";
import { getNotificationSubscriberCount, releaseMaturedVisitBalances } from "../src/routes/worky";
import { CHAT_ATTACHMENT_GRACE_PERIOD_MS, cleanupAbandonedChatAttachments, cleanupAbandonedProfilePhotoUploads, PROFILE_PHOTO_GRACE_PERIOD_MS } from "../src/routes/storage";
import { beginClientIdentityReview, finalizeClientIdentityReview, getClientIdentityStatus } from "../src/lib/client-verification";
import { deleteObject, getObject } from "../src/lib/storage";
import { and, eq, inArray, or } from "drizzle-orm";
import { chatUploads, clientIdentityVerifications, clientVerificationUploads, db, bookings, jobs, messages, payments, professionalProfiles, profilePhotoUploads, reviews, users, visitPayments, workyAuditEvents, workyNotifications } from "@workspace/db";

const unique = `privacy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const password = "privacy-test-password";
const baseUrl = "/api/v1";

type ResponseBody = Record<string, any> | any[];
type SseReader = ReturnType<NonNullable<Response["body"]>["getReader"]>;
type NotificationStream = {
  controller: AbortController;
  reader: SseReader;
  buffer: string;
};

async function openNotificationStream(server: http.Server, token: string): Promise<NotificationStream> {
  const address = server.address();
  assert(address && typeof address !== "string");
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}${baseUrl}/notificaciones/stream?token=${encodeURIComponent(token)}`, {
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert(response.body);
  return { controller, reader: response.body.getReader(), buffer: "" };
}

async function readSseEvent(stream: NotificationStream, timeoutMs = 1_500): Promise<{ event: string; data: any } | null> {
  const decoder = new TextDecoder();
  while (true) {
    const boundary = stream.buffer.indexOf("\n\n");
    if (boundary >= 0) {
      const block = stream.buffer.slice(0, boundary);
      stream.buffer = stream.buffer.slice(boundary + 2);
      const event = block.split("\n").find((line) => line.startsWith("event: "))?.slice("event: ".length);
      const data = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice("data: ".length)).join("\n");
      assert(event);
      assert(data);
      return { event, data: JSON.parse(data) };
    }

    const next = await Promise.race([
      stream.reader.read(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (next === null || next.done) return null;
    stream.buffer += decoder.decode(next.value, { stream: true });
  }
}

async function closeNotificationStream(stream: NotificationStream) {
  stream.controller.abort();
  await stream.reader.closed.catch(() => undefined);
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(await predicate(), true, "La condición no se cumplió a tiempo.");
}

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
  return { status: response.status, body: text ? JSON.parse(text) as ResponseBody : null };
}

async function absoluteUrl(server: http.Server, path: string) {
  const address = server.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}${path}`;
}

async function uploadChatImage(server: http.Server, token: string, participantId: number, changaId: number, image: Buffer, name: string, contentType = "image/png") {
  const prepared = await request(server, `${baseUrl}/storage/uploads/request-url`, {
    method: "POST",
    token,
    body: {
      name,
      size: image.length,
      contentType,
      purpose: "chat_image",
      changaId,
    },
  });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.purpose, "chat_image");
  assert.deepEqual(prepared.body.metadata, { name, size: image.length, contentType });
  const objectPath = prepared.body.objectPath as string;
  assert.match(objectPath, new RegExp(`^/objects/chat-attachments/${changaId}/${participantId}/[0-9a-f-]{36}$`));

  const uploaded = await fetch(prepared.body.uploadURL, {
    method: "PUT",
    headers: { "Content-Type": contentType, "Content-Length": String(image.length) },
    body: image,
  });
  assert.equal(uploaded.ok, true);
  return objectPath;
}

async function uploadClientVerificationImage(server: http.Server, token: string, documentType: "dni" | "selfie", image: Buffer) {
  const prepared = await request(server, `${baseUrl}/storage/uploads/request-url`, {
    method: "POST",
    token,
    body: {
      name: `${documentType}.png`,
      size: image.length,
      contentType: "image/png",
      purpose: "client_verification",
      documentType,
    },
  });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.purpose, "client_verification");
  const uploaded = await fetch(prepared.body.uploadURL, {
    method: "PUT",
    headers: { "Content-Type": "image/png", "Content-Length": String(image.length) },
    body: image,
  });
  assert.equal(uploaded.ok, true);
  return { uploadId: prepared.body.uploadId as number, objectPath: prepared.body.objectPath as string };
}

async function register(server: http.Server, name: string) {
  const email = `${unique}-${name}@example.test`;
  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db.insert(users).values({
    nombre: name,
    email,
    emailVerifiedAt: new Date(),
    passwordHash,
  }).returning({ id: users.id });
  const response = await request(server, `${baseUrl}/auth/login`, {
    method: "POST",
    body: { email, password },
  });
  assert.equal(response.status, 200);
  return { ...(response.body as { token: string }), usuario: { id: user.id } };
}

async function notifications(server: http.Server, token: string) {
  const response = await request(server, `${baseUrl}/notificaciones`, { token });
  assert.equal(response.status, 200);
  return response.body as { items: Array<{ id: number; usuarioId: number; titulo: string; detalle: string; href: string | null; leida: boolean }>; unread: number };
}

async function run() {
  const server = app.listen(0);
  let clientId: number | undefined;
  let partnerId: number | undefined;
  let outsiderId: number | undefined;
  let changaId: number | undefined;
  let secondChangaId: number | undefined;
  let streamChangaId: number | undefined;
  let clientVerificationId: number | undefined;
  const clientVerificationObjectPaths: string[] = [];
  let partnerStream: NotificationStream | undefined;
  let partnerSurvivorStream: NotificationStream | undefined;
  let outsiderStream: NotificationStream | undefined;

  try {
    const client = await register(server, "privacy-client");
    const partner = await register(server, "privacy-partner");
    const outsider = await register(server, "privacy-outsider");
    clientId = client.usuario.id;
    partnerId = partner.usuario.id;
    outsiderId = outsider.usuario.id;

    const sourceImage = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: { r: 35, g: 112, b: 94 },
      },
    }).png().toBuffer();
    const missingConsent = await request(server, `${baseUrl}/auth/client-verification`, {
      method: "POST",
      token: client.token,
      body: { dniUploadId: 1, selfieUploadId: 2 },
    });
    assert.equal(missingConsent.status, 400);
    assert.match(missingConsent.body.error, /consentimiento/);
    const dniUpload = await uploadClientVerificationImage(server, client.token, "dni", sourceImage);
    const selfieUpload = await uploadClientVerificationImage(server, client.token, "selfie", sourceImage);
    clientVerificationObjectPaths.push(dniUpload.objectPath, selfieUpload.objectPath);
    const submittedVerification = await request(server, `${baseUrl}/auth/client-verification`, {
      method: "POST",
      token: client.token,
      body: { dniUploadId: dniUpload.uploadId, selfieUploadId: selfieUpload.uploadId, consent: true },
    });
    assert.equal(submittedVerification.status, 201);
    assert.equal(submittedVerification.body.status, "pending_verification");
    assert.deepEqual(Object.keys(submittedVerification.body).sort(), ["reasonCode", "reviewedAt", "status", "submittedAt"]);
    const [verificationCase] = await db.select().from(clientIdentityVerifications)
      .where(eq(clientIdentityVerifications.usuarioId, clientId));
    assert.ok(verificationCase);
    clientVerificationId = verificationCase.id;
    const reviewPaths = [verificationCase.dniObjectPath, verificationCase.selfieObjectPath]
      .filter((path): path is string => Boolean(path));
    assert.equal(reviewPaths.length, 2);
    clientVerificationObjectPaths.push(...reviewPaths);
    for (const path of reviewPaths) assert.ok(await getObject(path), "la copia privada debe estar disponible solo para revisión");
    const uploadIds = [dniUpload.uploadId, selfieUpload.uploadId];
    await db.update(clientVerificationUploads).set({
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
    }).where(inArray(clientVerificationUploads.id, uploadIds));
    assert.ok(await beginClientIdentityReview(clientVerificationId, partnerId, "verified", null));
    const identityOriginalFetch = globalThis.fetch;
    let identityFailedDeletes = 0;
    globalThis.fetch = async (input, init) => {
      if (init?.method === "DELETE") {
        identityFailedDeletes += 1;
        return new Response("temporary storage failure", { status: 503 });
      }
      return identityOriginalFetch(input, init);
    };
    try {
      const temporaryFailure = await finalizeClientIdentityReview(clientVerificationId);
      assert.equal(temporaryFailure.kind, "delete-failed");
      assert.ok(identityFailedDeletes > 0);
    } finally {
      globalThis.fetch = identityOriginalFetch;
    }
    const [waitingForCleanup] = await db.select().from(clientIdentityVerifications)
      .where(eq(clientIdentityVerifications.id, clientVerificationId));
    assert.equal(waitingForCleanup.estado, "deleting");
    assert.equal((await db.select({ clientIdentityVerifiedAt: users.clientIdentityVerifiedAt }).from(users)
      .where(eq(users.id, clientId)))[0]?.clientIdentityVerifiedAt, null);
    const resolvedVerification = await finalizeClientIdentityReview(clientVerificationId);
    assert.equal(resolvedVerification.kind, "resolved");
    assert.equal((await getClientIdentityStatus(clientId)).status, "verified");
    const [resolvedCase] = await db.select().from(clientIdentityVerifications)
      .where(eq(clientIdentityVerifications.id, clientVerificationId));
    assert.equal(resolvedCase.dniObjectPath, null);
    assert.equal(resolvedCase.selfieObjectPath, null);
    const resolvedUploads = await db.select().from(clientVerificationUploads)
      .where(inArray(clientVerificationUploads.id, uploadIds));
    assert.equal(resolvedUploads.length, 2);
    assert.ok(resolvedUploads.every((upload) =>
      upload.estado === "deleted" && upload.objectPath === null && upload.reviewObjectPath === null
      && upload.contentType === null && upload.sizeBytes === null,
    ));
    for (const path of clientVerificationObjectPaths) assert.equal(await getObject(path), null);
    const [approvalAudit] = await db.select().from(workyAuditEvents).where(and(
      eq(workyAuditEvents.entidad, "client_identity_verification"),
      eq(workyAuditEvents.entidadId, clientVerificationId),
      eq(workyAuditEvents.accion, "client_identity_approved"),
    ));
    assert.deepEqual(approvalAudit?.metadata, { reasonCode: null });

    const rejectedDniUpload = await uploadClientVerificationImage(server, outsider.token, "dni", sourceImage);
    const rejectedSelfieUpload = await uploadClientVerificationImage(server, outsider.token, "selfie", sourceImage);
    clientVerificationObjectPaths.push(rejectedDniUpload.objectPath, rejectedSelfieUpload.objectPath);
    const rejectedSubmission = await request(server, `${baseUrl}/auth/client-verification`, {
      method: "POST",
      token: outsider.token,
      body: { dniUploadId: rejectedDniUpload.uploadId, selfieUploadId: rejectedSelfieUpload.uploadId, consent: true },
    });
    assert.equal(rejectedSubmission.status, 201);
    const [rejectedCase] = await db.select().from(clientIdentityVerifications)
      .where(eq(clientIdentityVerifications.usuarioId, outsiderId));
    assert.ok(rejectedCase);
    const rejectedReviewPaths = [rejectedCase.dniObjectPath, rejectedCase.selfieObjectPath]
      .filter((path): path is string => Boolean(path));
    clientVerificationObjectPaths.push(...rejectedReviewPaths);
    await db.update(clientVerificationUploads).set({
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
    }).where(inArray(clientVerificationUploads.id, [rejectedDniUpload.uploadId, rejectedSelfieUpload.uploadId]));
    assert.ok(await beginClientIdentityReview(rejectedCase.id, partner.usuario.id, "rejected", "dni_unreadable"));
    assert.equal((await finalizeClientIdentityReview(rejectedCase.id)).kind, "resolved");
    const rejectedStatus = await getClientIdentityStatus(outsiderId);
    assert.equal(rejectedStatus.status, "rejected");
    assert.equal(rejectedStatus.reasonCode, "dni_unreadable");
    assert.equal((await db.select({ clientIdentityVerifiedAt: users.clientIdentityVerifiedAt }).from(users)
      .where(eq(users.id, outsiderId)))[0]?.clientIdentityVerifiedAt, null);
    const reuploadDni = await uploadClientVerificationImage(server, outsider.token, "dni", sourceImage);
    const reuploadSelfie = await uploadClientVerificationImage(server, outsider.token, "selfie", sourceImage);
    clientVerificationObjectPaths.push(reuploadDni.objectPath, reuploadSelfie.objectPath);
    const resubmittedVerification = await request(server, `${baseUrl}/auth/client-verification`, {
      method: "POST",
      token: outsider.token,
      body: { dniUploadId: reuploadDni.uploadId, selfieUploadId: reuploadSelfie.uploadId, consent: true },
    });
    assert.equal(resubmittedVerification.status, 201);
    assert.equal(resubmittedVerification.body.status, "pending_verification");
    const [resubmittedCase] = await db.select().from(clientIdentityVerifications)
      .where(eq(clientIdentityVerifications.usuarioId, outsiderId));
    assert.ok(resubmittedCase);
    clientVerificationObjectPaths.push(
      ...[resubmittedCase.dniObjectPath, resubmittedCase.selfieObjectPath]
        .filter((path): path is string => Boolean(path)),
    );

    const uploadUrlResponse = await request(server, `${baseUrl}/storage/uploads/request-url`, {
      method: "POST",
      token: partner.token,
      body: {
        name: "profile-source.png",
        size: sourceImage.length,
        contentType: "image/png",
        purpose: "profile_photo",
      },
    });
    assert.equal(uploadUrlResponse.status, 200);
    const sourcePath = uploadUrlResponse.body.objectPath as string;
    assert.match(sourcePath, new RegExp(`^/objects/profile-photos/${partnerId}/source/[0-9a-f-]{36}$`));
    const sourceUpload = await fetch(uploadUrlResponse.body.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": "image/png", "Content-Length": String(sourceImage.length) },
      body: sourceImage,
    });
    assert.equal(sourceUpload.ok, true);

    const sourcePublicResponse = await fetch(await absoluteUrl(server, `${baseUrl}/storage/public-objects${sourcePath}`));
    assert.equal(sourcePublicResponse.status, 404);
    assert.deepEqual(await sourcePublicResponse.json(), { error: "Foto de perfil no encontrada." });

    const orphanUploadUrlResponse = await request(server, `${baseUrl}/storage/uploads/request-url`, {
      method: "POST",
      token: partner.token,
      body: { name: "orphan.png", size: sourceImage.length, contentType: "image/png" },
    });
    assert.equal(orphanUploadUrlResponse.status, 200);
    const orphanUpload = await fetch(orphanUploadUrlResponse.body.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": "image/png", "Content-Length": String(sourceImage.length) },
      body: sourceImage,
    });
    assert.equal(orphanUpload.ok, true);
    const orphanPublicResponse = await fetch(await absoluteUrl(server, `${baseUrl}/storage/public-objects${orphanUploadUrlResponse.body.objectPath}`));
    assert.equal(orphanPublicResponse.status, 404);
    assert.deepEqual(await orphanPublicResponse.json(), { error: "Foto de perfil no encontrada." });

    const processedPhoto = await request(server, `${baseUrl}/auth/profile-photo`, {
      method: "POST",
      token: partner.token,
      body: { objectPath: sourcePath },
    });
    assert.equal(processedPhoto.status, 200);
    const renderedPath = processedPhoto.body.fotoObjectPath as string;
    assert.match(renderedPath, new RegExp(`^/objects/profile-photos/${partnerId}/rendered/[0-9a-f-]{36}\\.webp$`));

    const publicPhotoResponse = await fetch(await absoluteUrl(server, `${baseUrl}/storage/public-objects${renderedPath}`));
    assert.equal(publicPhotoResponse.status, 200);
    assert.match(publicPhotoResponse.headers.get("content-type") || "", /^image\/webp(?:;|$)/);
    const publicPhoto = Buffer.from(await publicPhotoResponse.arrayBuffer());
    assert.ok(publicPhoto.length > 0);
    const publicPhotoMetadata = await sharp(publicPhoto).metadata();
    assert.equal(publicPhotoMetadata.format, "webp");
    assert.equal(publicPhotoMetadata.width, 512);
    assert.equal(publicPhotoMetadata.height, 512);

    const replacementUploadUrlResponse = await request(server, `${baseUrl}/storage/uploads/request-url`, {
      method: "POST",
      token: partner.token,
      body: { name: "replacement.png", size: sourceImage.length, contentType: "image/png", purpose: "profile_photo" },
    });
    assert.equal(replacementUploadUrlResponse.status, 200);
    const replacementSourcePath = replacementUploadUrlResponse.body.objectPath as string;
    const replacementUpload = await fetch(replacementUploadUrlResponse.body.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": "image/png", "Content-Length": String(sourceImage.length) },
      body: sourceImage,
    });
    assert.equal(replacementUpload.ok, true);
    const replacementPhoto = await request(server, `${baseUrl}/auth/profile-photo`, {
      method: "POST",
      token: partner.token,
      body: { objectPath: replacementSourcePath },
    });
    assert.equal(replacementPhoto.status, 200);
    const replacementRenderedPath = replacementPhoto.body.fotoObjectPath as string;
    assert.notEqual(replacementRenderedPath, renderedPath);

    const staleAt = new Date(Date.now() - PROFILE_PHOTO_GRACE_PERIOD_MS - 1_000);
    await db.update(profilePhotoUploads).set({ createdAt: staleAt }).where(or(
      eq(profilePhotoUploads.objectPath, sourcePath),
      eq(profilePhotoUploads.objectPath, renderedPath),
    ));
    const profileCleanup = await cleanupAbandonedProfilePhotoUploads();
    assert.equal(profileCleanup.cleaned, 2);
    const [cleanedSource] = await db.select().from(profilePhotoUploads).where(eq(profilePhotoUploads.objectPath, sourcePath));
    const [cleanedRendered] = await db.select().from(profilePhotoUploads).where(eq(profilePhotoUploads.objectPath, renderedPath));
    assert.equal(cleanedSource?.estado, "deleted");
    assert.equal(cleanedRendered?.estado, "deleted");
    const currentPhotoResponse = await fetch(await absoluteUrl(server, `${baseUrl}/storage/public-objects${replacementRenderedPath}`));
    assert.equal(currentPhotoResponse.status, 200);

    // Hold the account row while the save registers its prepared variant. The
    // cleanup query starts after that row exists, so both operations contend for
    // the same lock and the save must publish the variant before cleanup checks
    // users.fotoObjectPath.
    const raceUploadUrlResponse = await request(server, `${baseUrl}/storage/uploads/request-url`, {
      method: "POST",
      token: partner.token,
      body: { name: "race-source.png", size: sourceImage.length, contentType: "image/png", purpose: "profile_photo" },
    });
    assert.equal(raceUploadUrlResponse.status, 200);
    const raceSourcePath = raceUploadUrlResponse.body.objectPath as string;
    const raceSourceUpload = await fetch(raceUploadUrlResponse.body.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": "image/png", "Content-Length": String(sourceImage.length) },
      body: sourceImage,
    });
    assert.equal(raceSourceUpload.ok, true);
    const raceStaleAt = new Date(Date.now() - PROFILE_PHOTO_GRACE_PERIOD_MS - 1_000);
    await db.update(profilePhotoUploads).set({ createdAt: raceStaleAt }).where(eq(profilePhotoUploads.objectPath, raceSourcePath));

    let releaseUserLock!: () => void;
    let userLockAcquired!: () => void;
    const userLockReady = new Promise<void>((resolve) => { userLockAcquired = resolve; });
    const userLockRelease = new Promise<void>((resolve) => { releaseUserLock = resolve; });
    const heldUserLock = db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users)
        .where(eq(users.id, partnerId))
        .for("share")
        .limit(1);
      userLockAcquired();
      await userLockRelease;
    });
    await userLockReady;

    const raceSave = request(server, `${baseUrl}/auth/profile-photo`, {
      method: "POST",
      token: partner.token,
      body: { objectPath: raceSourcePath },
    });
    let raceRenderedPath: string | undefined;
    await waitFor(async () => {
      const [prepared] = await db.select({ objectPath: profilePhotoUploads.objectPath }).from(profilePhotoUploads).where(and(
        eq(profilePhotoUploads.usuarioId, partnerId),
        eq(profilePhotoUploads.variante, "rendered"),
        eq(profilePhotoUploads.estado, "pending"),
      )).orderBy(profilePhotoUploads.createdAt);
      if (!prepared) return false;
      raceRenderedPath = prepared.objectPath;
      return true;
    });
    assert(raceRenderedPath);
    const [preparedDuringRace] = await db.select({ estado: profilePhotoUploads.estado }).from(profilePhotoUploads).where(eq(profilePhotoUploads.objectPath, raceRenderedPath));
    assert.equal(preparedDuringRace?.estado, "pending");

    const raceCleanup = cleanupAbandonedProfilePhotoUploads();
    await new Promise((resolve) => setTimeout(resolve, 25));
    releaseUserLock();
    const [raceSaveResponse, raceCleanupResult] = await Promise.all([raceSave, raceCleanup, heldUserLock]);
    assert.equal(raceSaveResponse.status, 200);
    assert.equal(raceCleanupResult.cleaned, 1);
    assert.equal(raceSaveResponse.body.fotoObjectPath, raceRenderedPath);

    const [raceUser] = await db.select({ fotoObjectPath: users.fotoObjectPath }).from(users).where(eq(users.id, partnerId));
    assert.equal(raceUser?.fotoObjectPath, raceRenderedPath);
    const [raceSourceUploadRow] = await db.select({ estado: profilePhotoUploads.estado }).from(profilePhotoUploads).where(eq(profilePhotoUploads.objectPath, raceSourcePath));
    assert.equal(raceSourceUploadRow?.estado, "deleted");
    assert.equal(await getObject(raceSourcePath), null);
    const raceCurrentPhotoResponse = await fetch(await absoluteUrl(server, `${baseUrl}/storage/public-objects${raceRenderedPath}`));
    assert.equal(raceCurrentPhotoResponse.status, 200);

    const removedProfilePhoto = await request(server, `${baseUrl}/auth/profile-photo`, {
      method: "DELETE",
      token: partner.token,
    });
    assert.equal(removedProfilePhoto.status, 200);
    assert.deepEqual(removedProfilePhoto.body, { fotoObjectPath: null });
    const removedPhotoPublicResponse = await fetch(await absoluteUrl(server, `${baseUrl}/storage/public-objects${raceRenderedPath}`));
    assert.equal(removedPhotoPublicResponse.status, 404);
    const [photoRemovedFromAccount] = await db.select({ fotoObjectPath: users.fotoObjectPath }).from(users).where(eq(users.id, partnerId));
    assert.equal(photoRemovedFromAccount?.fotoObjectPath, null);
    const [removedPhotoUpload] = await db.select({ estado: profilePhotoUploads.estado }).from(profilePhotoUploads)
      .where(eq(profilePhotoUploads.objectPath, raceRenderedPath));
    assert.equal(removedPhotoUpload?.estado, "deleted");

    const profile = await request(server, `${baseUrl}/partner-profile`, {
      method: "POST",
      token: partner.token,
      body: { oficio: "Gasista de pruebas", categoria: "Gas", precioReferencia: 12000, ubicacionFija: { direccionTexto: "San Martín 45", ciudad: "Alta Gracia" } },
    });
    assert.equal(profile.status, 201);
    await db.update(users).set({ rol: "profesional" }).where(eq(users.id, partnerId));
    await db.update(professionalProfiles).set({
      verificado: true,
      estadoVerificacion: "verified",
      habilitado: true,
    }).where(eq(professionalProfiles.usuarioId, partnerId));
    const publicProfiles = await request(server, `${baseUrl}/profesionales?search=privacy-partner`);
    assert.equal(publicProfiles.status, 200);
    const publicProfile = publicProfiles.body.find((item: any) => item.id === profile.body.id);
    assert.ok(publicProfile);
    assert.equal("email" in publicProfile.usuario, false);
    assert.equal("telefono" in publicProfile.usuario, false);
    assert.equal("direccionTexto" in (publicProfile.usuario.ubicacion ?? {}), false);
    assert.equal("coordinates" in (publicProfile.usuario.ubicacion ?? {}), false);
    const publicDetail = await request(server, `${baseUrl}/profesionales/${profile.body.id}`);
    assert.equal(publicDetail.status, 200);
    assert.equal("email" in publicDetail.body.usuario, false);
    assert.equal("telefono" in publicDetail.body.usuario, false);

    partnerStream = await openNotificationStream(server, partner.token);
    partnerSurvivorStream = await openNotificationStream(server, partner.token);
    const limitedStreamResponse = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}${baseUrl}/notificaciones/stream?token=${encodeURIComponent(partner.token)}`);
    assert.equal(limitedStreamResponse.status, 429);
    assert.equal(limitedStreamResponse.headers.get("retry-after"), "1");
    assert.deepEqual(await limitedStreamResponse.json(), { error: "Alcanzaste el límite de conexiones de notificaciones activas." });
    assert.equal(getNotificationSubscriberCount(partnerId), 2);
    outsiderStream = await openNotificationStream(server, outsider.token);
    const [partnerReady, partnerSurvivorReady, outsiderReady] = await Promise.all([
      readSseEvent(partnerStream),
      readSseEvent(partnerSurvivorStream),
      readSseEvent(outsiderStream),
    ]);
    assert.equal(partnerReady?.event, "ready");
    assert.equal(partnerSurvivorReady?.event, "ready");
    assert.equal(outsiderReady?.event, "ready");
    assert.equal(getNotificationSubscriberCount(partnerId), 2);

    await closeNotificationStream(partnerStream);
    partnerStream = undefined;
    await waitFor(() => getNotificationSubscriberCount(partnerId) === 1);

    const streamJob = await request(server, `${baseUrl}/trabajos`, {
      method: "POST",
      token: client.token,
      body: {
        profesionalId: partnerId,
        ubicacion: { direccionTexto: `${unique} - domicilio SSE` },
        categoria: "Gas",
        precioOfrecido: 17000,
        detalle: `${unique} - detalle SSE`,
      },
    });
    assert.equal(streamJob.status, 201);
    streamChangaId = streamJob.body.id;
    const partnerNotificationEvent = await readSseEvent(partnerSurvivorStream);
    assert.equal(partnerNotificationEvent?.event, "notification");
    assert.ok(partnerNotificationEvent?.data);
    const partnerNotification = partnerNotificationEvent.data;
    assert.equal(partnerNotification.usuarioId, partnerId);
    assert.equal(partnerNotification.titulo, "Nueva solicitud de changa");
    assert.equal(partnerNotification.detalle, "Un cliente te eligió para una nueva changa.");
    assert.equal(partnerNotification.href, `/chat/${streamChangaId}`);
    assert.equal(partnerNotification.changaId, streamChangaId);
    assert.equal(typeof partnerNotification.id, "number");
    const storedPartnerNotification = (await notifications(server, partner.token)).items.find((item) => item.id === partnerNotification.id);
    assert.equal(storedPartnerNotification?.changaId, streamChangaId);
    assert.equal(storedPartnerNotification?.jobContext?.price, 17000);
    assert.equal(storedPartnerNotification?.jobContext?.workerName, "privacy-partner");
    assert.equal(storedPartnerNotification?.jobContext?.trade, "Gasista de pruebas");
    assert.equal(await readSseEvent(outsiderStream, 500), null);

    const created = await request(server, `${baseUrl}/trabajos`, {
      method: "POST",
      token: client.token,
      body: {
        ubicacion: { direccionTexto: `${unique} - domicilio aislado` },
        categoria: "Gas",
        precioOfrecido: 15000,
        detalle: `${unique} - detalle privado`,
        paymentMethod: "efectivo",
      },
    });
    assert.equal(created.status, 201);
    changaId = created.body.id;
    await db.delete(messages).where(eq(messages.changaId, changaId));
    // A failed prior run may leave audit rows after its job is removed. The new
    // job owns this id, so clear only its appointment history before exercising it.
    await db.delete(workyAuditEvents).where(and(
      eq(workyAuditEvents.entidad, "appointment_attempt"),
      eq(workyAuditEvents.entidadId, changaId),
    ));

    const accepted = await request(server, `${baseUrl}/trabajos/${changaId}/aceptar`, {
      method: "PATCH",
      token: partner.token,
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await db.select({ id: messages.id, emisorId: messages.emisorId }).from(messages).where(eq(messages.changaId, changaId)), []);
    const emptyClientInbox = await request(server, `${baseUrl}/conversaciones`, { token: client.token });
    const emptyPartnerInbox = await request(server, `${baseUrl}/conversaciones`, { token: partner.token });
    assert.equal(emptyClientInbox.body.some((item: any) => item.changaId === changaId), false, JSON.stringify(emptyClientInbox.body.filter((item: any) => item.changaId === changaId)));
    assert.equal(emptyPartnerInbox.body.some((item: any) => item.changaId === changaId), false, JSON.stringify(emptyPartnerInbox.body.filter((item: any) => item.changaId === changaId)));

    const outsiderPaths = [
      `${baseUrl}/trabajos/${changaId}`,
      `${baseUrl}/chats/${changaId}/mensajes`,
      `${baseUrl}/chats/${changaId}/citas`,
    ];
    for (const path of outsiderPaths) {
      assert.equal((await request(server, path, { token: outsider.token })).status, 403, path);
    }
    assert.equal((await request(server, `${baseUrl}/chats/${changaId}/mensajes`, {
      method: "POST", token: outsider.token, body: { texto: `${unique} - fuga` },
    })).status, 403);
    assert.equal((await request(server, `${baseUrl}/chats/${changaId}/leidos`, {
      method: "POST", token: outsider.token,
    })).status, 403);

    const clientMessage = `${unique} - mensaje del cliente`;
    const partnerMessage = `${unique} - mensaje del partner`;
    assert.equal((await request(server, `${baseUrl}/chats/${changaId}/mensajes`, {
      method: "POST", token: client.token, body: { texto: clientMessage },
    })).status, 201);
    let partnerConversations = await request(server, `${baseUrl}/conversaciones`, { token: partner.token });
    assert.equal(partnerConversations.status, 200);
    assert.equal(partnerConversations.body.some((item: any) => item.changaId === changaId), true);
    let clientConversations = await request(server, `${baseUrl}/conversaciones`, { token: client.token });
    assert.equal(clientConversations.body.some((item: any) => item.changaId === changaId), true);
    const partnerRoleConversations = await request(server, `${baseUrl}/conversaciones?rol=profesional`, { token: partner.token });
    assert.equal(partnerRoleConversations.status, 200);
    assert.equal(partnerRoleConversations.body.some((item: any) => item.changaId === changaId), true);
    const partnerClientView = await request(server, `${baseUrl}/conversaciones?rol=cliente`, { token: partner.token });
    assert.equal(partnerClientView.status, 200);
    assert.equal(partnerClientView.body.some((item: any) => item.changaId === changaId), false);
    const clientRoleConversations = await request(server, `${baseUrl}/conversaciones?rol=cliente`, { token: client.token });
    assert.equal(clientRoleConversations.status, 200);
    assert.equal(clientRoleConversations.body.some((item: any) => item.changaId === changaId), true);
    const clientProfessionalView = await request(server, `${baseUrl}/conversaciones?rol=profesional`, { token: client.token });
    assert.equal(clientProfessionalView.status, 200);
    assert.equal(clientProfessionalView.body.some((item: any) => item.changaId === changaId), false);
    assert.equal((await request(server, `${baseUrl}/conversaciones?rol=admin`, { token: client.token })).status, 400);

    const partnerSent = await request(server, `${baseUrl}/chats/${changaId}/mensajes`, {
      method: "POST", token: partner.token, body: { texto: partnerMessage },
    });
    assert.equal(partnerSent.status, 201);
    const clientMessages = await request(server, `${baseUrl}/chats/${changaId}/mensajes`, { token: client.token });
    assert.deepEqual(clientMessages.body.map((item: any) => item.texto), [clientMessage, partnerMessage]);
    partnerConversations = await request(server, `${baseUrl}/conversaciones`, { token: partner.token });
    const partnerConversation = partnerConversations.body.find((item: any) => item.changaId === changaId);
    assert.equal(partnerConversation.unread, 1);
    clientConversations = await request(server, `${baseUrl}/conversaciones`, { token: client.token });
    assert.equal(clientConversations.body.some((item: any) => item.changaId === changaId), true);
    assert.equal(clientConversations.body.find((item: any) => item.changaId === changaId).unread, 1);
    const partnerRoleInboxAfterReply = await request(server, `${baseUrl}/conversaciones?rol=profesional`, { token: partner.token });
    assert.equal(partnerRoleInboxAfterReply.body.some((item: any) => item.changaId === changaId), true);
    const clientRoleInboxAfterReply = await request(server, `${baseUrl}/conversaciones?rol=cliente`, { token: client.token });
    assert.equal(clientRoleInboxAfterReply.body.some((item: any) => item.changaId === changaId), true);
    assert.equal((await request(server, `${baseUrl}/chats/${changaId}/leidos`, {
      method: "POST", token: client.token,
    })).status, 204);
    clientConversations = await request(server, `${baseUrl}/conversaciones`, { token: client.token });
    assert.equal(clientConversations.body.find((item: any) => item.changaId === changaId).unread, 0);

    const clientChatImagePath = await uploadChatImage(server, client.token, clientId, changaId, sourceImage, "client-chat-image.png");
    const partnerChatImagePath = await uploadChatImage(server, partner.token, partnerId, changaId, sourceImage, "partner-chat-image.png");
    const trackedUploads = await db.select().from(chatUploads).where(eq(chatUploads.changaId, changaId));
    assert.deepEqual(trackedUploads.map((upload) => ({ objectPath: upload.objectPath, estado: upload.estado })).sort((a, b) => a.objectPath.localeCompare(b.objectPath)), [
      { objectPath: clientChatImagePath, estado: "pending" },
      { objectPath: partnerChatImagePath, estado: "pending" },
    ].sort((a, b) => a.objectPath.localeCompare(b.objectPath)));
    const clientAttachment = { objectPath: clientChatImagePath, nombre: "client-chat-image.png", contentType: "image/png", sizeBytes: sourceImage.length };
    const partnerAttachment = { objectPath: partnerChatImagePath, nombre: "partner-chat-image.png", contentType: "image/png", sizeBytes: sourceImage.length };

    const clientImageMessage = await request(server, `${baseUrl}/chats/${changaId}/mensajes`, {
      method: "POST", token: client.token, body: { adjuntos: [clientAttachment] },
    });
    assert.equal(clientImageMessage.status, 201);
    assert.deepEqual(clientImageMessage.body.adjuntos, [clientAttachment]);
    const captionedPath = await uploadChatImage(server, client.token, clientId, changaId, sourceImage, "captioned-chat-image.png");
    const captionedAttachment = { objectPath: captionedPath, nombre: "captioned-chat-image.png", contentType: "image/png", sizeBytes: sourceImage.length };
    const captionedMessage = await request(server, `${baseUrl}/chats/${changaId}/mensajes`, {
      method: "POST",
      token: client.token,
      body: { texto: "Te comparto una foto del trabajo.", adjuntos: [captionedAttachment] },
    });
    assert.equal(captionedMessage.status, 201);
    assert.equal(captionedMessage.body.texto, "Te comparto una foto del trabajo.");
    assert.deepEqual(captionedMessage.body.adjuntos, [captionedAttachment]);
    const tooManyAttachments = await request(server, `${baseUrl}/chats/${changaId}/mensajes`, {
      method: "POST",
      token: client.token,
      body: { adjuntos: Array.from({ length: 6 }, () => clientAttachment) },
    });
    assert.equal(tooManyAttachments.status, 400);
    assert.match(tooManyAttachments.body.error, /hasta 5 imágenes/);
    const partnerImageMessage = await request(server, `${baseUrl}/chats/${changaId}/mensajes`, {
      method: "POST", token: partner.token, body: { adjuntos: [partnerAttachment] },
    });
    assert.equal(partnerImageMessage.status, 201);
    assert.deepEqual(partnerImageMessage.body.adjuntos, [partnerAttachment]);
    const associatedUploads = await db.select().from(chatUploads).where(eq(chatUploads.changaId, changaId));
    assert.deepEqual(associatedUploads.map((upload) => ({ objectPath: upload.objectPath, estado: upload.estado, messageId: upload.associatedMessageId })), [
      { objectPath: clientChatImagePath, estado: "associated", messageId: clientImageMessage.body.id },
      { objectPath: captionedPath, estado: "associated", messageId: captionedMessage.body.id },
      { objectPath: partnerChatImagePath, estado: "associated", messageId: partnerImageMessage.body.id },
    ]);

    const jpegImage = await sharp({
      create: {
        width: 24,
        height: 24,
        channels: 3,
        background: { r: 112, g: 35, b: 94 },
      },
    }).jpeg().toBuffer();
    const jpegPath = await uploadChatImage(server, client.token, clientId, changaId, jpegImage, "client-chat-image.jpg", "image/jpeg");
    const jpegAttachment = { objectPath: jpegPath, nombre: "client-chat-image.jpg", contentType: "image/jpeg", sizeBytes: jpegImage.length };
    const jpegMessage = await request(server, `${baseUrl}/chats/${changaId}/mensajes`, {
      method: "POST", token: client.token, body: { adjuntos: [jpegAttachment] },
    });
    assert.equal(jpegMessage.status, 201);
    assert.deepEqual(jpegMessage.body.adjuntos, [jpegAttachment]);

    const fakeImage = Buffer.from("contenido que no es una imagen");
    const fakeImagePath = await uploadChatImage(server, client.token, clientId, changaId, fakeImage, "fake-image.png");
    const fakeImageMessage = await request(server, `${baseUrl}/chats/${changaId}/mensajes`, {
      method: "POST",
      token: client.token,
      body: { adjuntos: [{ objectPath: fakeImagePath, nombre: "fake-image.png", contentType: "image/png", sizeBytes: fakeImage.length }] },
    });
    assert.equal(fakeImageMessage.status, 400);
    assert.match(fakeImageMessage.body.error, /imagen válida/);
    await waitFor(async () => {
      const [upload] = await db.select({ estado: chatUploads.estado }).from(chatUploads).where(eq(chatUploads.objectPath, fakeImagePath));
      return upload?.estado === "deleted";
    });
    const [rejectedUpload] = await db.select().from(chatUploads).where(eq(chatUploads.objectPath, fakeImagePath));
    assert.equal(rejectedUpload?.estado, "deleted");
    assert.equal((await request(server, `${baseUrl}/storage/objects${fakeImagePath}`, { token: client.token })).status, 403);

    const failedCleanupPath = await uploadChatImage(server, client.token, clientId, changaId, fakeImage, "failed-cleanup-image.png");
    const originalFetch = globalThis.fetch;
    let deleteAttempts = 0;
    globalThis.fetch = async (input, init) => {
      if (init?.method === "DELETE") {
        deleteAttempts += 1;
        return new Response("temporary storage failure", { status: 503 });
      }
      return originalFetch(input, init);
    };
    try {
      const failedCleanupMessage = await request(server, `${baseUrl}/chats/${changaId}/mensajes`, {
        method: "POST",
        token: client.token,
        body: { adjuntos: [{ objectPath: failedCleanupPath, nombre: "failed-cleanup-image.png", contentType: "image/png", sizeBytes: fakeImage.length }] },
      });
      assert.equal(failedCleanupMessage.status, 400);
      await waitFor(() => deleteAttempts === 1);
      const [failedCleanupUpload] = await db.select().from(chatUploads).where(eq(chatUploads.objectPath, failedCleanupPath));
      assert.equal(failedCleanupUpload?.estado, "deleting");
    } finally {
      globalThis.fetch = originalFetch;
    }

    await db.update(chatUploads).set({ createdAt: new Date(Date.now() - CHAT_ATTACHMENT_GRACE_PERIOD_MS - 1_000) })
      .where(eq(chatUploads.objectPath, failedCleanupPath));
    const retryCleanupResult = await cleanupAbandonedChatAttachments();
    assert.equal(retryCleanupResult.cleaned, 1);
    const [retriedUpload] = await db.select().from(chatUploads).where(eq(chatUploads.objectPath, failedCleanupPath));
    assert.equal(retriedUpload?.estado, "deleted");
    assert.equal((await request(server, `${baseUrl}/storage/objects${failedCleanupPath}`, { token: client.token })).status, 403);

    const messagesForClient = await request(server, `${baseUrl}/chats/${changaId}/mensajes`, { token: client.token });
    const messagesForPartner = await request(server, `${baseUrl}/chats/${changaId}/mensajes`, { token: partner.token });
    for (const visibleMessages of [messagesForClient, messagesForPartner]) {
      assert.equal(visibleMessages.status, 200);
      assert.deepEqual(visibleMessages.body.find((item: any) => item.id === clientImageMessage.body.id).adjuntos, [clientAttachment]);
      assert.deepEqual(visibleMessages.body.find((item: any) => item.id === captionedMessage.body.id).adjuntos, [captionedAttachment]);
      assert.equal(visibleMessages.body.find((item: any) => item.id === captionedMessage.body.id).texto, "Te comparto una foto del trabajo.");
      assert.deepEqual(visibleMessages.body.find((item: any) => item.id === partnerImageMessage.body.id).adjuntos, [partnerAttachment]);
    }

    for (const token of [client.token, partner.token]) {
      for (const objectPath of [clientChatImagePath, partnerChatImagePath]) {
        const objectResponse = await fetch(await absoluteUrl(server, `${baseUrl}/storage/objects${objectPath}`), {
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(objectResponse.status, 200);
        assert.match(objectResponse.headers.get("content-type") || "", /^image\/png(?:;|$)/);
        const downloadedImage = Buffer.from(await objectResponse.arrayBuffer());
        assert.deepEqual(downloadedImage, sourceImage);
      }
    }
    const jpegResponse = await fetch(await absoluteUrl(server, `${baseUrl}/storage/objects${jpegPath}`), {
      headers: { authorization: `Bearer ${client.token}` },
    });
    assert.equal(jpegResponse.status, 200);
    assert.match(jpegResponse.headers.get("content-type") || "", /^image\/jpeg(?:;|$)/);
    assert.deepEqual(Buffer.from(await jpegResponse.arrayBuffer()), jpegImage);

    const outsiderUpload = await request(server, `${baseUrl}/storage/uploads/request-url`, {
      method: "POST",
      token: outsider.token,
      body: {
        name: "outsider-chat-image.png",
        size: sourceImage.length,
        contentType: "image/png",
        purpose: "chat_image",
        changaId,
      },
    });
    assert.equal(outsiderUpload.status, 403);

    for (const invalidUpload of [
      { name: "document.pdf", size: sourceImage.length, contentType: "application/pdf" },
      { name: "too-large.png", size: 10 * 1024 * 1024 + 1, contentType: "image/png" },
    ]) {
      const rejected = await request(server, `${baseUrl}/storage/uploads/request-url`, {
        method: "POST",
        token: client.token,
        body: { ...invalidUpload, purpose: "chat_image", changaId },
      });
      assert.equal(rejected.status, 400);
      if (invalidUpload.name === "too-large.png") {
        assert.match(rejected.body.error, /10 MB/);
      }
    }

    const abandonedChatPath = await uploadChatImage(server, client.token, clientId, changaId, sourceImage, "abandoned-chat-image.png");
    await db.update(chatUploads).set({ createdAt: new Date(Date.now() - CHAT_ATTACHMENT_GRACE_PERIOD_MS - 1_000) })
      .where(eq(chatUploads.objectPath, abandonedChatPath));
    const cleanupResult = await cleanupAbandonedChatAttachments();
    assert.equal(cleanupResult.cleaned, 1);
    const [cleanedUpload] = await db.select().from(chatUploads).where(eq(chatUploads.objectPath, abandonedChatPath));
    assert.equal(cleanedUpload?.estado, "deleted");
    assert.equal((await request(server, `${baseUrl}/storage/objects${abandonedChatPath}`, { token: client.token })).status, 403);
    assert.equal((await request(server, `${baseUrl}/chats/${changaId}/mensajes`, {
      method: "POST",
      token: client.token,
      body: { texto: "No debería enviarse", adjuntos: [{ objectPath: abandonedChatPath }] },
    })).status, 400);
    const [stillAssociated] = await db.select().from(chatUploads).where(eq(chatUploads.objectPath, clientChatImagePath));
    assert.equal(stillAssociated?.estado, "associated");

    const manipulatedAttachment = {
      ...clientAttachment,
      objectPath: clientChatImagePath.replace(`/chat-attachments/${changaId}/${clientId}/`, `/chat-attachments/${changaId}/${partnerId}/`),
    };
    const manipulatedMessage = await request(server, `${baseUrl}/chats/${changaId}/mensajes`, {
      method: "POST", token: client.token, body: { adjuntos: [manipulatedAttachment] },
    });
    assert.equal(manipulatedMessage.status, 400);
    const manipulatedPath = clientChatImagePath.replace(/[^/]+$/, crypto.randomUUID());
    const manipulatedRead = await request(server, `${baseUrl}/storage/objects${manipulatedPath}`, { token: client.token });
    assert.equal(manipulatedRead.status, 403);
    for (const objectPath of [clientChatImagePath, partnerChatImagePath]) {
      assert.equal((await request(server, `${baseUrl}/storage/objects${objectPath}`, { token: outsider.token })).status, 403);
    }

    const clientNotificationsBeforeProposal = await notifications(server, client.token);
    const partnerNotificationsBeforeProposal = await notifications(server, partner.token);
    const future = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const booking = await request(server, `${baseUrl}/chats/${changaId}/citas`, {
      method: "POST", token: partner.token, body: { empiezaAt: future, tarifaVisita: 10000 },
    });
    assert.equal(booking.status, 201);
    // Keep both authenticated clients open: the Partner creates the proposal
    // and the Client's already-open conversation must observe its audit entry.
    const partnerHistoryAfterProposal = await request(server, `${baseUrl}/chats/${changaId}/historial-visitas`, {
      token: partner.token,
    });
    assert.equal(partnerHistoryAfterProposal.status, 200);
    assert.equal(partnerHistoryAfterProposal.body.some((attempt: any) =>
      attempt.appointmentId === booking.body.id &&
      attempt.accion === "proponer" &&
      attempt.resultado === "exitoso"
    ), true);
    const clientHistoryAfterProposal = await request(server, `${baseUrl}/chats/${changaId}/historial-visitas`, {
      token: client.token,
    });
    assert.equal(clientHistoryAfterProposal.status, 200);
    assert.deepEqual(clientHistoryAfterProposal.body, partnerHistoryAfterProposal.body);
    const listedAppointments = await request(server, `${baseUrl}/chats/${changaId}/citas`, { token: client.token });
    assert.equal(listedAppointments.status, 200);
    assert.equal(listedAppointments.body.some((item: any) => item.id === booking.body.id), true);
    const clientNotificationsAfterProposal = await notifications(server, client.token);
    const proposalNotification = clientNotificationsAfterProposal.items.find((item) =>
      item.id > Math.max(0, ...clientNotificationsBeforeProposal.items.map((notification) => notification.id)) &&
      item.titulo === "Nueva propuesta de visita"
    );
    assert.ok(proposalNotification);
    assert.equal(proposalNotification.usuarioId, clientId);
    assert.equal(proposalNotification.href, `/chat/${changaId}`);
    assert.equal(proposalNotification.detalle.includes("privacy-client"), false);
    assert.equal((await notifications(server, outsider.token)).items.some((item) => item.titulo === "Nueva propuesta de visita"), false);
    assert.equal((await notifications(server, partner.token)).items.length, partnerNotificationsBeforeProposal.items.length);
    assert.equal((await request(server, `${baseUrl}/citas/${booking.body.id}/aceptar`, {
      method: "POST", token: partner.token, body: { paymentMethod: "efectivo" },
    })).status, 403);
    const acceptedAppointment = await request(server, `${baseUrl}/citas/${booking.body.id}/aceptar`, {
      method: "POST", token: client.token, body: { paymentMethod: "efectivo" },
    });
    assert.equal(acceptedAppointment.status, 200);
    assert.equal(acceptedAppointment.body.appointment.estado, "confirmada");
    assert.equal(acceptedAppointment.body.appointment.finanzas.status, "cash_pending_visit");
    // The second session sees the acceptance as a new history record, not
    // merely the stale proposal it loaded before the action.
    const partnerHistoryAfterAcceptance = await request(server, `${baseUrl}/chats/${changaId}/historial-visitas`, {
      token: partner.token,
    });
    assert.equal(partnerHistoryAfterAcceptance.body.some((attempt: any) =>
      attempt.appointmentId === booking.body.id &&
      attempt.accion === "aceptar" &&
      attempt.resultado === "exitoso"
    ), true);
    assert.equal(partnerHistoryAfterAcceptance.body.length, clientHistoryAfterProposal.body.length + 1);
    const partnerNotificationsAfterAcceptance = await notifications(server, partner.token);
    const acceptanceNotification = partnerNotificationsAfterAcceptance.items.find((item) =>
      item.id > Math.max(0, ...partnerNotificationsBeforeProposal.items.map((notification) => notification.id)) &&
      item.titulo === "Visita confirmada"
    );
    assert.ok(acceptanceNotification);
    assert.equal(acceptanceNotification.usuarioId, partnerId);
    assert.equal(acceptanceNotification.href, `/chat/${changaId}`);

    const blockedBooking = await request(server, `${baseUrl}/chats/${changaId}/citas`, {
      method: "POST", token: partner.token, body: { empiezaAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(), tarifaVisita: 10000 },
    });
    assert.equal(blockedBooking.status, 409);
    assert.equal((await request(server, `${baseUrl}/citas/${booking.body.id}/llegada`, { method: "POST", token: partner.token })).status, 200);
    const completedVisit = await request(server, `${baseUrl}/citas/${booking.body.id}/completar`, { method: "POST", token: partner.token });
    assert.equal(completedVisit.status, 200);
    assert.equal(completedVisit.body.finanzas.status, "cash_commission_due");
    const confirmedVisit = await request(server, `${baseUrl}/citas/${booking.body.id}/confirmar-visita`, { method: "POST", token: client.token });
    assert.equal(confirmedVisit.status, 200);
    assert.equal(confirmedVisit.body.finanzas.status, "cash_commission_due");
    const [visitLedger] = await db.select().from(visitPayments).where(eq(visitPayments.bookingId, booking.body.id));
    await db.update(visitPayments).set({
      method: "mercado_pago",
      status: "pending_release",
      releaseAt: new Date(Date.now() - 60_000),
    }).where(eq(visitPayments.id, visitLedger.id));
    assert.ok(await releaseMaturedVisitBalances() >= 1);
    const [releasedVisit] = await db.select().from(visitPayments).where(eq(visitPayments.id, visitLedger.id));
    assert.equal(releasedVisit.status, "available");
    const cancelableBooking = await request(server, `${baseUrl}/chats/${changaId}/citas`, {
      method: "POST", token: partner.token, body: { empiezaAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(), tarifaVisita: 10000 },
    });
    assert.equal(cancelableBooking.status, 201);
    const cancelledAppointment = await request(server, `${baseUrl}/citas/${cancelableBooking.body.id}`, {
      method: "PATCH", token: client.token, body: { accion: "cancelar" },
    });
    assert.equal(cancelledAppointment.status, 200);
    assert.equal(cancelledAppointment.body.estado, "cancelada");
    const rejectedBooking = await request(server, `${baseUrl}/chats/${changaId}/citas`, {
      method: "POST", token: partner.token, body: { empiezaAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(), tarifaVisita: 10000 },
    });
    assert.equal(rejectedBooking.status, 201);
    assert.equal((await request(server, `${baseUrl}/citas/${rejectedBooking.body.id}/rechazar`, {
      method: "POST", token: partner.token,
    })).status, 403);
    const rejectedAppointment = await request(server, `${baseUrl}/citas/${rejectedBooking.body.id}/rechazar`, {
      method: "POST", token: client.token,
    });
    assert.equal(rejectedAppointment.status, 200);
    assert.equal(rejectedAppointment.body.estado, "cancelada");
    const partnerNotificationsAfterRejection = await notifications(server, partner.token);
    const rejectionNotification = partnerNotificationsAfterRejection.items.find((item) =>
      item.id > acceptanceNotification.id && item.titulo === "Visita rechazada"
    );
    assert.ok(rejectionNotification);
    assert.equal(rejectionNotification.usuarioId, partnerId);
    assert.equal(rejectionNotification.href, `/chat/${changaId}`);
    assert.equal((await notifications(server, client.token)).items.some((item) =>
      item.titulo === "Visita confirmada" || item.titulo === "Visita rechazada"
    ), false);

    const failedAttempts = [
      { accion: "aceptar", resultado: "error_permiso", detalle: "Solo el cliente puede aceptar la visita." },
      { accion: "proponer", resultado: "error_validacion", detalle: "Elegí una fecha futura válida." },
      { accion: "rechazar", resultado: "error_red", detalle: "No se pudo conectar con el servidor." },
    ];
    for (const attempt of failedAttempts) {
      const logged = await request(server, `${baseUrl}/chats/${changaId}/historial-visitas`, {
        method: "POST", token: client.token, body: attempt,
      });
      assert.equal(logged.status, 201);
      assert.equal(logged.body.accion, attempt.accion);
      assert.equal(logged.body.resultado, attempt.resultado);
      assert.equal(logged.body.detalle, attempt.detalle);
    }
    assert.equal((await request(server, `${baseUrl}/chats/${changaId}/historial-visitas`, {
      token: outsider.token,
    })).status, 403);
    const history = await request(server, `${baseUrl}/chats/${changaId}/historial-visitas`, { token: client.token });
    assert.equal(history.status, 200);
    assert.equal(history.body.length, 9);
    assert.deepEqual(new Set(history.body.map((attempt: any) => `${attempt.accion}:${attempt.resultado}`)), new Set([
      "rechazar:error_red",
      "proponer:error_validacion",
      "aceptar:error_permiso",
      "rechazar:rechazado",
      "aceptar:exitoso",
       "cancelar:exitoso",
      "proponer:exitoso",
    ]));
    for (let index = 1; index < history.body.length; index += 1) {
      assert.ok(new Date(history.body[index - 1].createdAt).getTime() >= new Date(history.body[index].createdAt).getTime());
    }
    const reopenedHistory = await request(server, `${baseUrl}/chats/${changaId}/historial-visitas`, { token: client.token });
    assert.deepEqual(reopenedHistory.body, history.body);

    const second = await request(server, `${baseUrl}/trabajos`, {
      method: "POST", token: client.token,
      body: { ubicacion: { direccionTexto: `${unique} - segundo domicilio` }, categoria: "Gas", precioOfrecido: 16000 },
    });
    assert.equal(second.status, 201);
    secondChangaId = second.body.id;
    assert.equal((await request(server, `${baseUrl}/trabajos/${secondChangaId}/aceptar`, {
      method: "PATCH", token: partner.token,
    })).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await request(server, `${baseUrl}/chats/${secondChangaId}/mensajes`, {
      method: "POST", token: partner.token, body: { texto: `${unique} - actividad más reciente` },
    })).status, 201);
    const clientNotificationsBeforeSecondProposal = await notifications(server, client.token);
    const secondProposal = await request(server, `${baseUrl}/chats/${secondChangaId}/citas`, {
      method: "POST", token: partner.token, body: { empiezaAt: new Date(Date.now() + 120 * 60 * 60 * 1000).toISOString(), tarifaVisita: 10000 },
    });
    assert.equal(secondProposal.status, 201);
    const clientNotificationsAfterSecondProposal = await notifications(server, client.token);
    const secondProposalNotification = clientNotificationsAfterSecondProposal.items.find((item) =>
      item.id > Math.max(0, ...clientNotificationsBeforeSecondProposal.items.map((notification) => notification.id)) &&
      item.titulo === "Nueva propuesta de visita"
    );
    assert.ok(secondProposalNotification);
    assert.equal(secondProposalNotification.usuarioId, clientId);
    assert.equal(secondProposalNotification.href, `/chat/${secondChangaId}`);
    const proposalHrefs = clientNotificationsAfterSecondProposal.items
      .filter((item) => item.titulo === "Nueva propuesta de visita")
      .map((item) => item.href);
    assert.ok(proposalHrefs.includes(`/chat/${changaId}`));
    assert.ok(proposalHrefs.includes(`/chat/${secondChangaId}`));
    assert.equal((await notifications(server, client.token)).items.some((item) =>
      item.titulo === "Nueva propuesta de visita" && item.href === `/chat/${changaId}`
    ), true);
    const secondAttempt = await request(server, `${baseUrl}/chats/${secondChangaId}/historial-visitas`, {
      method: "POST", token: partner.token,
      body: { accion: "proponer", resultado: "error_validacion", detalle: "Otro historial" },
    });
    assert.equal(secondAttempt.status, 201);
    const firstHistoryAfterSecondConversation = await request(server, `${baseUrl}/chats/${changaId}/historial-visitas`, { token: client.token });
    assert.equal(firstHistoryAfterSecondConversation.body.length, history.body.length);
    assert.equal(firstHistoryAfterSecondConversation.body.some((attempt: any) => attempt.detalle === "Otro historial"), false);
    assert.equal((await request(server, `${baseUrl}/chats/${secondChangaId}/historial-visitas`, { token: client.token })).body.length, 2);
    const ordered = await request(server, `${baseUrl}/conversaciones`, { token: client.token });
    assert.equal(ordered.body[0].changaId, secondChangaId);
    assert.equal(ordered.body.some((item: any) => item.changaId === changaId), true);

    assert.equal((await request(server, `${baseUrl}/trabajos/${changaId}`, {
      method: "PATCH", token: partner.token, body: { estado: "en_curso" },
    })).status, 200);
    assert.equal((await request(server, `${baseUrl}/trabajos/${changaId}`, {
      method: "PATCH", token: partner.token, body: { estado: "finalizada" },
    })).status, 409);
    const reviewPayload = {
      changaId,
      rating: 5,
      comentario: "Trabajo excelente.",
      adjuntos: [{ objectPath: "reviews/evidence.jpg", nombre: "evidence.jpg", mimeType: "image/jpeg" }],
    };
    const workDone = await request(server, `${baseUrl}/trabajos/${changaId}`, {
      method: "PATCH", token: partner.token, body: { estado: "trabajo_realizado" },
    });
    assert.equal(workDone.status, 200);
    assert.equal(workDone.body.estado, "trabajo_realizado");
    assert.equal((await request(server, `${baseUrl}/reviews`, {
      method: "POST", token: client.token, body: reviewPayload,
    })).status, 409);
    const clientCashConfirmation = await request(server, `${baseUrl}/trabajos/${changaId}/confirmar-pago-efectivo`, {
      method: "POST", token: client.token,
    });
    assert.equal(clientCashConfirmation.status, 200);
    assert.equal(clientCashConfirmation.body.estado, "trabajo_realizado");
    assert.equal(clientCashConfirmation.body.cashConfirmedByClient, true);
    assert.equal(clientCashConfirmation.body.cashConfirmedByProfessional, false);
    const professionalCashConfirmation = await request(server, `${baseUrl}/trabajos/${changaId}/confirmar-pago-efectivo`, {
      method: "POST", token: partner.token,
    });
    assert.equal(professionalCashConfirmation.status, 200);
    assert.equal(professionalCashConfirmation.body.estado, "finalizada");
    assert.equal((await db.select().from(payments).where(and(eq(payments.changaId, changaId), eq(payments.provider, "efectivo")))).at(0)?.status, "aprobado");
    assert.equal((await request(server, `${baseUrl}/reviews`, {
      method: "POST", token: partner.token, body: reviewPayload,
    })).status, 403);
    assert.equal((await request(server, `${baseUrl}/reviews`, {
      method: "POST", token: outsider.token, body: reviewPayload,
    })).status, 403);
    const createdReview = await request(server, `${baseUrl}/reviews`, {
      method: "POST", token: client.token, body: reviewPayload,
    });
    assert.equal(createdReview.status, 201);
    assert.equal(createdReview.body.changaId, changaId);
    assert.deepEqual(createdReview.body.adjuntos, [{
      objectPath: "reviews/evidence.jpg",
      nombre: "evidence.jpg",
      contentType: "application/octet-stream",
      sizeBytes: 0,
    }]);
    const clientJobsAfterReview = await request(server, `${baseUrl}/trabajos/mias`, { token: client.token });
    assert.equal(clientJobsAfterReview.status, 200);
    const reviewedJob = clientJobsAfterReview.body.find((job: any) => job.id === changaId);
    assert.equal(reviewedJob?.calificada, true);
    assert.equal((await request(server, `${baseUrl}/reviews`, {
      method: "POST", token: client.token, body: reviewPayload,
    })).status, 409);
    assert.equal((await db.select().from(reviews).where(eq(reviews.changaId, changaId))).length, 1);
  } finally {
    await Promise.all(clientVerificationObjectPaths.map((path) => deleteObject(path).catch(() => false)));
    if (partnerStream) await closeNotificationStream(partnerStream);
    if (partnerSurvivorStream) await closeNotificationStream(partnerSurvivorStream);
    if (outsiderStream) await closeNotificationStream(outsiderStream);
    const createdUserIds = [clientId, partnerId, outsiderId].filter((id): id is number => id !== undefined);
    const createdChangaIds = [changaId, secondChangaId].filter((id): id is number => id !== undefined);
    if (createdChangaIds.length) {
      await db.delete(workyAuditEvents).where(and(
        eq(workyAuditEvents.entidad, "appointment_attempt"),
        or(...createdChangaIds.map((id) => eq(workyAuditEvents.entidadId, id))),
      ));
    }
    if (createdUserIds.length) {
      await db.delete(workyAuditEvents).where(or(...createdUserIds.map((id) => eq(workyAuditEvents.usuarioId, id))));
    }
    if (secondChangaId) {
      await db.delete(bookings).where(eq(bookings.changaId, secondChangaId));
      await db.delete(messages).where(eq(messages.changaId, secondChangaId));
    }
    if (changaId) {
      await db.delete(payments).where(eq(payments.changaId, changaId));
      await db.delete(reviews).where(eq(reviews.changaId, changaId));
      await db.delete(bookings).where(eq(bookings.changaId, changaId));
      await db.delete(messages).where(eq(messages.changaId, changaId));
    }
    if (streamChangaId) await db.delete(jobs).where(eq(jobs.id, streamChangaId));
    if (secondChangaId) await db.delete(jobs).where(eq(jobs.id, secondChangaId));
    if (changaId) await db.delete(jobs).where(eq(jobs.id, changaId));
    if (clientVerificationId) {
      await db.delete(workyAuditEvents).where(and(
        eq(workyAuditEvents.entidad, "client_identity_verification"),
        eq(workyAuditEvents.entidadId, clientVerificationId),
      ));
      await db.delete(clientIdentityVerifications).where(eq(clientIdentityVerifications.id, clientVerificationId));
    }
    if (partnerId) {
      await db.delete(professionalProfiles).where(eq(professionalProfiles.usuarioId, partnerId));
      await db.delete(workyNotifications).where(eq(workyNotifications.usuarioId, partnerId));
    }
    if (clientId) await db.delete(workyNotifications).where(eq(workyNotifications.usuarioId, clientId));
    if (outsiderId) await db.delete(workyNotifications).where(eq(workyNotifications.usuarioId, outsiderId));
    if (outsiderId) await db.delete(users).where(eq(users.id, outsiderId));
    if (partnerId) await db.delete(users).where(eq(users.id, partnerId));
    if (clientId) await db.delete(users).where(eq(users.id, clientId));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

run().then(() => {
  console.log("Worky privacy integration tests passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});