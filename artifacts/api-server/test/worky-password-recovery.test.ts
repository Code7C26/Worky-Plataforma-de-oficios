import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, passwordRecoveryTokens, users } from "@workspace/db";
import app from "../src/app";
import { GmailDeliveryError } from "../src/lib/gmail-mailer";
import { passwordRecoveryFailureDetails, passwordRecoveryTokenHash } from "../src/lib/password-recovery";

const unique = `password-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const email = `${unique}@example.test`;
const oldPassword = "old-password-for-recovery-test";
const baseUrl = "/api/v1";

async function request(
  server: http.Server,
  path: string,
  options: { method?: string; body?: unknown } = {},
) {
  const address = server.address();
  assert(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: options.method ?? "GET",
    ...(options.body !== undefined ? { headers: { "content-type": "application/json" } } : {}),
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

function decodePlainText(rawMessage: string) {
  const encodedText = rawMessage.match(
    /Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/i,
  )?.[1];
  assert(encodedText, "Recovery email should contain a plain-text body.");
  return Buffer.from(encodedText.replace(/\r\n/g, ""), "base64").toString("utf8");
}

async function run() {
  const originalCreateProxyFetch = ReplitConnectors.prototype.createProxyFetch;
  const createdUserIds: number[] = [];
  const sentMessages: string[] = [];
  let deliveryMode: "success" | "rejected" = "success";
  const server = app.listen(0);

  ReplitConnectors.prototype.createProxyFetch = function (connectorName) {
    assert.equal(connectorName, "google-mail");
    return async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const path = new URL(url).pathname;
      if (path === "/gmail/v1/users/me/profile") {
        return new Response(JSON.stringify({ emailAddress: "worky-sender@example.test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path === "/gmail/v1/users/me/messages/send") {
        if (deliveryMode === "rejected") {
          return new Response(JSON.stringify({ message: "private provider body that must not be logged" }), { status: 403 });
        }
        const requestBody = JSON.parse(String(init?.body)) as { raw?: string };
        assert(requestBody.raw, "Gmail API should receive a base64url MIME message.");
        sentMessages.push(Buffer.from(requestBody.raw, "base64url").toString("utf8"));
        return new Response(JSON.stringify({ id: "password-recovery-test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error("Unexpected Gmail API request.");
    };
  };

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));

    const [createdUser] = await db.insert(users).values({
      nombre: "Cuenta de prueba",
      email,
      emailVerifiedAt: new Date(),
      passwordHash: await bcrypt.hash(oldPassword, 12),
      rol: "cliente",
    }).returning({ id: users.id });
    const userId = createdUser.id;
    createdUserIds.push(userId);

    const recoveryRequest = await request(server, `${baseUrl}/auth/password-recovery/request`, {
      method: "POST",
      body: { email },
    });
    assert.equal(recoveryRequest.status, 202);
    assert.equal(sentMessages.length, 1);

    const rawMessage = sentMessages[0];
    assert.match(rawMessage, /^From: Worky <worky-sender@example\.test>$/m);
    assert.match(rawMessage, new RegExp(`^To: ${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
    assert.match(rawMessage, /^Subject: =\?UTF-8\?B\?.*\?=$/m);
    const plainText = decodePlainText(rawMessage);
    assert.match(plainText, /Recibimos un pedido para cambiar tu contraseña/);
    const recoveryUrl = plainText.match(/https?:\/\/\S+/)?.[0];
    assert(recoveryUrl, "Recovery email should contain a reset link.");
    const recoveryToken = new URL(recoveryUrl).searchParams.get("resetToken");
    assert(recoveryToken, "Recovery link should contain its one-time token.");

    const [storedToken] = await db.select().from(passwordRecoveryTokens)
      .where(eq(passwordRecoveryTokens.usuarioId, userId)).limit(1);
    assert(storedToken);
    assert.equal(storedToken.tokenHash, passwordRecoveryTokenHash(recoveryToken));
    assert.notEqual(storedToken.tokenHash, recoveryToken);

    const reset = await request(server, `${baseUrl}/auth/password-recovery/reset`, {
      method: "POST",
      body: { token: recoveryToken, newPassword: "new-password-for-recovery-test" },
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.body?.success, true);

    const oldLogin = await request(server, `${baseUrl}/auth/login`, {
      method: "POST",
      body: { email, password: oldPassword },
    });
    assert.equal(oldLogin.status, 401);
    const newLogin = await request(server, `${baseUrl}/auth/login`, {
      method: "POST",
      body: { email, password: "new-password-for-recovery-test" },
    });
    assert.equal(newLogin.status, 200);

    deliveryMode = "rejected";
    const failedRequest = await request(server, `${baseUrl}/auth/password-recovery/request`, {
      method: "POST",
      body: { email },
    });
    assert.equal(failedRequest.status, 503);
    assert.equal(JSON.stringify(failedRequest.body).includes("private provider body"), false);
    assert.deepEqual(passwordRecoveryFailureDetails(new GmailDeliveryError("provider_rejected", 403)), {
      reason: "provider_rejected",
      providerStatus: 403,
    });
    assert.deepEqual(passwordRecoveryFailureDetails(new Error("private provider details")), {
      reason: "internal_error",
    });
    const remainingTokens = await db.select().from(passwordRecoveryTokens)
      .where(eq(passwordRecoveryTokens.usuarioId, userId));
    assert.equal(remainingTokens.length, 1, "A failed delivery must remove its newly created recovery token.");
  } finally {
    try {
      for (const id of createdUserIds) {
        await db.delete(passwordRecoveryTokens).where(eq(passwordRecoveryTokens.usuarioId, id));
        await db.delete(users).where(eq(users.id, id));
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      ReplitConnectors.prototype.createProxyFetch = originalCreateProxyFetch;
    }
  }
}

run().then(() => {
  console.log("Worky password recovery integration tests passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
