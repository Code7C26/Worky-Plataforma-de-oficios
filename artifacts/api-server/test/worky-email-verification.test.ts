import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, emailVerificationTokens, users } from "@workspace/db";
import app from "../src/app";
import { createEmailVerificationChallenge, EmailVerificationDeliveryError, emailVerificationFailureDetails } from "../src/lib/email-verification";
import { signToken } from "../src/middlewares/auth";

const unique = `email-verification-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const registrationEmail = `${unique}-registration@example.test`;
const changedEmail = `${unique}-changed@example.test`;
const failedEmail = `${unique}-failed@example.test`;
const failedRegistrationEmail = `${unique}-registration-failed@example.test`;
const registrationPassword = "registration-password";
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
  let body: Record<string, any> | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, any>;
    } catch {
      body = { raw: text };
    }
  }
  return { status: response.status, body };
}

async function run() {
  const originalCreateProxyFetch = ReplitConnectors.prototype.createProxyFetch;
  const verificationCodes = new Map<string, string>();
  let deliveryMode: "success" | "rejected" | "network" = "success";
  let senderProfileMode: "valid" | "missing" = "valid";
  const createdUserIds: number[] = [];
  const server = app.listen(0);

  ReplitConnectors.prototype.createProxyFetch = function (connectorName) {
    assert.equal(connectorName, "google-mail");
    return async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const path = new URL(url).pathname;
      if (path === "/gmail/v1/users/me/profile") {
        return new Response(JSON.stringify(senderProfileMode === "valid"
          ? { emailAddress: "worky-sender@example.test" }
          : {}), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path === "/gmail/v1/users/me/messages/send") {
        if (deliveryMode === "rejected") {
          return new Response(JSON.stringify({ message: "Provider rejection with private details" }), { status: 403 });
        }
        if (deliveryMode === "network") throw new TypeError("network failure with sensitive provider details");
        const requestBody = JSON.parse(String(init?.body)) as { raw?: string };
        assert(requestBody.raw, "Gmail API should receive a base64url MIME message.");
        const message = Buffer.from(requestBody.raw, "base64url").toString("utf8");
        assert.match(message, /^From: Worky <worky-sender@example\.test>$/m);
        const recipient = message.match(/^To: ([^\r\n]+)$/m)?.[1];
        assert(recipient, "Verification email should have one recipient.");
        const encodedText = message.match(/Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/i)?.[1];
        assert(encodedText, "Verification email should contain a plain-text body.");
        const text = Buffer.from(encodedText.replace(/\r\n/g, ""), "base64").toString("utf8");
        const code = text.match(/\b(\d{6})\b/)?.[1];
        assert(code, "Verification email should contain a six-digit code.");
        verificationCodes.set(recipient, code);
        return new Response(JSON.stringify({ id: "email-verification-test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error("Unexpected Gmail API request.");
    };
  };

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));

    senderProfileMode = "missing";
    await assert.rejects(createEmailVerificationChallenge({ email: failedEmail, purpose: "account" }),
      (error: unknown) => error instanceof EmailVerificationDeliveryError && error.reason === "missing_sender");
    const [noConfiguredChallenge] = await db.select({ id: emailVerificationTokens.id })
      .from(emailVerificationTokens).where(eq(emailVerificationTokens.email, failedEmail));
    assert.equal(noConfiguredChallenge, undefined, "Missing Gmail sender must not create a challenge.");
    senderProfileMode = "valid";

    deliveryMode = "rejected";
    await assert.rejects(createEmailVerificationChallenge({ email: failedEmail, purpose: "account" }),
      (error: unknown) => {
        assert.deepEqual(emailVerificationFailureDetails(error), { reason: "provider_rejected", providerStatus: 403 });
        return true;
      });
    deliveryMode = "network";
    await assert.rejects(createEmailVerificationChallenge({ email: failedEmail, purpose: "account" }),
      (error: unknown) => {
        assert.deepEqual(emailVerificationFailureDetails(error), { reason: "network_or_timeout", providerStatus: undefined });
        return true;
      });
    const [noFailedChallenge] = await db.select({ id: emailVerificationTokens.id })
      .from(emailVerificationTokens).where(eq(emailVerificationTokens.email, failedEmail));
    assert.equal(noFailedChallenge, undefined, "Failed deliveries must not block a retry.");
    deliveryMode = "success";
    assert.deepEqual(await createEmailVerificationChallenge({ email: failedEmail, purpose: "account" }),
      { sent: true, throttled: false });
    assert.deepEqual(await createEmailVerificationChallenge({ email: failedEmail, purpose: "account" }),
      { sent: false, throttled: true });
    assert.deepEqual(emailVerificationFailureDetails(new Error("private details")), { reason: "internal_error" });

    const registration = await request(server, `${baseUrl}/auth/register`, {
      method: "POST",
      body: { nombre: "Registro sin confirmar", email: registrationEmail, password: registrationPassword },
    });
    assert.equal(registration.status, 202);
    assert.equal(typeof registration.body.message, "string");
    assert.equal(registration.body.token, undefined, "Registration must not issue a session before email confirmation.");
    assert.equal(registration.body.usuario, undefined);
    const [createdRegistrationUser] = await db.select({
      id: users.id,
      emailVerifiedAt: users.emailVerifiedAt,
    }).from(users).where(eq(users.email, registrationEmail));
    assert(createdRegistrationUser);
    createdUserIds.push(createdRegistrationUser.id);
    assert.equal(createdRegistrationUser.emailVerifiedAt, null);
    assert(verificationCodes.has(registrationEmail), "Registration should send its code before creating a session.");

    const invalidEmailRegistration = await request(server, `${baseUrl}/auth/register`, {
      method: "POST",
      body: { nombre: "Email inválido", email: "no-es-email", password: registrationPassword },
    });
    assert.equal(invalidEmailRegistration.status, 400);

    deliveryMode = "rejected";
    const failedRegistration = await request(server, `${baseUrl}/auth/register`, {
      method: "POST",
      body: { nombre: "Registro con reintento", email: failedRegistrationEmail, password: registrationPassword },
    });
    assert.equal(failedRegistration.status, 503);
    assert.equal(JSON.stringify(failedRegistration.body).includes("private details"), false);
    deliveryMode = "success";
    const [failedRegistrationUser] = await db.select({ id: users.id })
      .from(users).where(eq(users.email, failedRegistrationEmail));
    assert(failedRegistrationUser);
    createdUserIds.push(failedRegistrationUser.id);

    const duplicateRegistration = await request(server, `${baseUrl}/auth/register`, {
      method: "POST",
      body: { nombre: "Registro duplicado", email: registrationEmail, password: registrationPassword },
    });
    assert.equal(duplicateRegistration.status, 409);

    const login = await request(server, `${baseUrl}/auth/login`, {
      method: "POST",
      body: { email: registrationEmail, password: registrationPassword },
    });
    assert.equal(login.status, 403);
    assert.equal(login.body.code, "EMAIL_NOT_VERIFIED");

    const oldSession = signToken(createdRegistrationUser.id);
    const blockedOldSession = await request(server, `${baseUrl}/auth/me`, { token: oldSession });
    assert.equal(blockedOldSession.status, 403);
    assert.equal(blockedOldSession.body.code, "EMAIL_NOT_VERIFIED");

    const registrationRequest = await request(server, `${baseUrl}/auth/email-verification/registration/request`, {
      method: "POST",
      body: { email: failedRegistrationEmail },
    });
    assert.equal(registrationRequest.status, 202);
    assert(verificationCodes.has(failedRegistrationEmail));

    const registrationCode = verificationCodes.get(registrationEmail);
    assert(registrationCode);
    const registrationConfirmation = await request(server, `${baseUrl}/auth/email-verification/registration/confirm`, {
      method: "POST",
      body: { email: registrationEmail, code: registrationCode },
    });
    assert.equal(registrationConfirmation.status, 200);
    assert(registrationConfirmation.body.token);
    assert.equal(registrationConfirmation.body.usuario.emailVerifiedAt !== null, true);

    const verifiedLogin = await request(server, `${baseUrl}/auth/login`, {
      method: "POST",
      body: { email: registrationEmail, password: registrationPassword },
    });
    assert.equal(verifiedLogin.status, 200);
    assert(verifiedLogin.body.usuario.emailVerifiedAt);

    const me = await request(server, `${baseUrl}/auth/me`, { token: verifiedLogin.body.token });
    assert.equal(me.status, 200);
    assert(me.body.emailVerifiedAt);

    const changedEmailResponse = await request(server, `${baseUrl}/auth/me`, {
      method: "PATCH",
      token: verifiedLogin.body.token,
      body: { email: changedEmail, currentPassword: registrationPassword },
    });
    assert.equal(changedEmailResponse.status, 200);
    assert.equal(changedEmailResponse.body.email, changedEmail);
    assert.equal(changedEmailResponse.body.emailVerifiedAt, null);

    const blockedChangedEmailSession = await request(server, `${baseUrl}/auth/me`, { token: verifiedLogin.body.token });
    assert.equal(blockedChangedEmailSession.status, 403);
    const changedEmailVerificationRequest = await request(server, `${baseUrl}/auth/email-verification/account/request`, {
      method: "POST",
      token: verifiedLogin.body.token,
    });
    assert.equal(changedEmailVerificationRequest.status, 202);
    const changedEmailCode = verificationCodes.get(changedEmail);
    assert(changedEmailCode);
    const changedEmailConfirmation = await request(server, `${baseUrl}/auth/email-verification/account/confirm`, {
      method: "POST",
      token: verifiedLogin.body.token,
      body: { code: changedEmailCode },
    });
    assert.equal(changedEmailConfirmation.status, 200);
  } finally {
    try {
      await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.email, registrationEmail));
      await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.email, changedEmail));
      await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.email, failedEmail));
      await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.email, failedRegistrationEmail));
      for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      ReplitConnectors.prototype.createProxyFetch = originalCreateProxyFetch;
    }
  }
}

run().then(() => {
  console.log("Worky email verification integration tests passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});