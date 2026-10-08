import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db, emailVerificationTokens, users } from "@workspace/db";
import app from "../src/app";
import { createEmailVerificationChallenge, EmailVerificationDeliveryError, emailVerificationFailureDetails } from "../src/lib/email-verification";

const unique = `email-verification-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const registrationEmail = `${unique}-registration@example.test`;
const changedEmail = `${unique}-changed@example.test`;
const failedEmail = `${unique}-failed@example.test`;
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
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  };
  process.env.RESEND_API_KEY = "verification-test-only-key";
  process.env.RESEND_FROM_EMAIL = "Worky <verify@worky.example.test>";
  const verificationCodes = new Map<string, string>();
  let deliveryMode: "success" | "rejected" | "network" = "success";
  const createdUserIds: number[] = [];
  const server = app.listen(0);

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://api.resend.com/emails") {
      const message = JSON.parse(String(init?.body)) as { to: string[]; text: string; from: string };
      assert.equal(message.from, "Worky <verify@worky.example.test>");
      assert(init?.signal, "Delivery must have a timeout signal.");
      if (deliveryMode === "rejected") {
        return new Response(JSON.stringify({ message: "Provider rejection" }), { status: 403 });
      }
      if (deliveryMode === "network") throw new TypeError("network failure with sensitive provider details");
      const code = message.text.match(/\b(\d{6})\b/)?.[1];
      assert(code, "Verification email should contain a six-digit code.");
      verificationCodes.set(message.to[0], code);
      return new Response(JSON.stringify({ id: "email-verification-test" }), { status: 200 });
    }
    return originalFetch(input, init);
  };

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));

    process.env.NODE_ENV = "production";
    delete process.env.RESEND_FROM_EMAIL;
    await assert.rejects(createEmailVerificationChallenge({ email: failedEmail, purpose: "account" }),
      (error: unknown) => error instanceof EmailVerificationDeliveryError && error.reason === "missing_sender");
    process.env.RESEND_FROM_EMAIL = "Worky <onboarding@resend.dev>";
    await assert.rejects(createEmailVerificationChallenge({ email: failedEmail, purpose: "account" }),
      (error: unknown) => error instanceof EmailVerificationDeliveryError && error.reason === "missing_sender");
    const [noConfiguredChallenge] = await db.select({ id: emailVerificationTokens.id })
      .from(emailVerificationTokens).where(eq(emailVerificationTokens.email, failedEmail));
    assert.equal(noConfiguredChallenge, undefined, "Missing sender must not create a challenge.");
    process.env.RESEND_FROM_EMAIL = "Worky <verify@worky.example.test>";

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

    const removedRegistrationVerification = await request(server, `${baseUrl}/auth/email-verification/registration/request`, {
      method: "POST",
      body: { email: registrationEmail },
    });
    assert.equal(removedRegistrationVerification.status, 404);

    const invalidEmailRegistration = await request(server, `${baseUrl}/auth/register`, {
      method: "POST",
      body: { nombre: "Email inválido", email: "no-es-email", password: registrationPassword },
    });
    assert.equal(invalidEmailRegistration.status, 400);

    const registration = await request(server, `${baseUrl}/auth/register`, {
      method: "POST",
      body: { nombre: "Registro sin confirmar", email: registrationEmail, password: registrationPassword },
    });
    assert.equal(registration.status, 201);
    createdUserIds.push(registration.body.usuario.id);
    assert.equal(registration.body.usuario.emailVerifiedAt, null);

    const duplicateRegistration = await request(server, `${baseUrl}/auth/register`, {
      method: "POST",
      body: { nombre: "Registro duplicado", email: registrationEmail, password: registrationPassword },
    });
    assert.equal(duplicateRegistration.status, 409);

    const login = await request(server, `${baseUrl}/auth/login`, {
      method: "POST",
      body: { email: registrationEmail, password: registrationPassword },
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.usuario.emailVerifiedAt, null);
    const accountRequest = await request(server, `${baseUrl}/auth/email-verification/account/request`, {
      method: "POST",
      token: login.body.token,
    });
    assert.equal(accountRequest.status, 202);
    const accountCode = verificationCodes.get(registrationEmail);
    assert(accountCode);
    const accountConfirmation = await request(server, `${baseUrl}/auth/email-verification/account/confirm`, {
      method: "POST",
      token: login.body.token,
      body: { code: accountCode },
    });
    assert.equal(accountConfirmation.status, 200);
    assert.equal(accountConfirmation.body.verified, true);

    const me = await request(server, `${baseUrl}/auth/me`, { token: login.body.token });
    assert.equal(me.status, 200);
    assert(me.body.emailVerifiedAt);

    const changedEmailResponse = await request(server, `${baseUrl}/auth/me`, {
      method: "PATCH",
      token: login.body.token,
      body: { email: changedEmail, currentPassword: registrationPassword },
    });
    assert.equal(changedEmailResponse.status, 200);
    assert.equal(changedEmailResponse.body.email, changedEmail);
    assert.equal(changedEmailResponse.body.emailVerifiedAt, null);
  } finally {
    try {
      await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.email, registrationEmail));
      await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.email, changedEmail));
      await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.email, failedEmail));
      for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }
}

run().then(() => {
  console.log("Worky email verification integration tests passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});