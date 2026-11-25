import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, mobileLoginChallenges, mobileTrustedDevices, users } from "@workspace/db";
import app from "../src/app";

const email = `mobile-device-${Date.now()}@example.test`;
const password = "device-login-test-password";
const deviceId = randomBytes(24).toString("hex");
const previousSessionSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = "mobile-device-login-test-secret";

const originalCreateProxyFetch = ReplitConnectors.prototype.createProxyFetch;
let deliveredCode: string | undefined;
let deliveryCount = 0;
ReplitConnectors.prototype.createProxyFetch = function () {
  return async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    if (path === "/gmail/v1/users/me/profile") {
      return new Response(JSON.stringify({ emailAddress: "worky@example.test" }), { status: 200 });
    }
    if (path === "/gmail/v1/users/me/messages/send") {
      const payload = JSON.parse(String(init?.body)) as { raw?: string };
      assert(payload.raw);
      const message = Buffer.from(payload.raw, "base64url").toString("utf8");
      const encodedText = message.match(/Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/i)?.[1];
      assert(encodedText);
      const text = Buffer.from(encodedText.replace(/\r\n/g, ""), "base64").toString("utf8");
      deliveredCode = text.match(/\b(\d{6})\b/)?.[1];
      assert(deliveredCode);
      deliveryCount += 1;
      return new Response(JSON.stringify({ id: "mobile-device-login-test" }), { status: 200 });
    }
    throw new Error("Unexpected Gmail API request.");
  };
};

async function request(server: http.Server, path: string, body: unknown, clientIp?: string) {
  return requestApi(server, path, { method: "POST", body, clientIp });
}

async function requestApi(server: http.Server, path: string, options: { method?: string; token?: string; body?: unknown; clientIp?: string } = {}) {
  const address = server.address();
  assert(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.clientIp ? { "x-forwarded-for": options.clientIp } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const responseBody = response.status === 204 ? undefined : await response.json() as Record<string, any> | unknown[];
  return { status: response.status, body: responseBody };
}

async function run() {
  const server = app.listen(0);
  let userId: number | undefined;
  let otherUserId: number | undefined;
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const [user] = await db.insert(users).values({
      nombre: "Cuenta móvil de prueba",
      email,
      emailVerifiedAt: new Date(),
      passwordHash: await bcrypt.hash(password, 4),
    }).returning({ id: users.id });
    userId = user.id;

    const expiredDeviceId = randomBytes(24).toString("hex");
    const expiredRequest = await request(server, "/auth/mobile-login/request", {
      email, password, deviceId: expiredDeviceId,
    }, "198.51.100.11");
    assert.equal(expiredRequest.status, 202);
    assert.equal(typeof expiredRequest.body.token, "undefined");
    assert(deliveredCode);
    const expiredCode = deliveredCode;
    await db.update(mobileLoginChallenges)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(mobileLoginChallenges.id, expiredRequest.body.challengeId));
    const expiredConfirmation = await request(server, "/auth/mobile-login/confirm", {
      email, deviceId: expiredDeviceId, challengeId: expiredRequest.body.challengeId, code: expiredCode,
    }, "198.51.100.11");
    assert.equal(expiredConfirmation.status, 400, "An expired code must not create a session.");
    assert.equal(typeof expiredConfirmation.body.token, "undefined");
    assert.deepEqual(
      await db.select().from(mobileTrustedDevices).where(eq(mobileTrustedDevices.usuarioId, user.id)),
      [],
      "An expired code must not create a trusted device.",
    );

    const lockedDeviceId = randomBytes(24).toString("hex");
    const lockedRequest = await request(server, "/auth/mobile-login/request", {
      email, password, deviceId: lockedDeviceId,
    }, "198.51.100.12");
    assert.equal(lockedRequest.status, 202);
    assert(deliveredCode);
    const lockedCode = deliveredCode;
    const incorrectCode = lockedCode === "000000" ? "000001" : "000000";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rejected = await request(server, "/auth/mobile-login/confirm", {
        email, deviceId: lockedDeviceId, challengeId: lockedRequest.body.challengeId, code: incorrectCode,
      }, "198.51.100.12");
      assert.equal(rejected.status, 400, `Incorrect attempt ${attempt + 1} must be rejected.`);
      assert.equal(typeof rejected.body.token, "undefined");
    }
    const blockedCorrectCode = await request(server, "/auth/mobile-login/confirm", {
      email, deviceId: lockedDeviceId, challengeId: lockedRequest.body.challengeId, code: lockedCode,
    }, "198.51.100.12");
    assert.equal(blockedCorrectCode.status, 400, "A locked challenge must reject the correct code.");
    assert.equal(typeof blockedCorrectCode.body.token, "undefined");
    const [lockedChallenge] = await db.select().from(mobileLoginChallenges)
      .where(eq(mobileLoginChallenges.id, lockedRequest.body.challengeId));
    assert.equal(lockedChallenge.attempts, 5);
    assert(lockedChallenge.usedAt, "The challenge must be marked used after the final incorrect attempt.");
    assert.deepEqual(
      await db.select().from(mobileTrustedDevices).where(eq(mobileTrustedDevices.usuarioId, user.id)),
      [],
      "Incorrect attempts must not create a trusted device.",
    );

    const cooldownDeviceId = randomBytes(24).toString("hex");
    const deliveryCountBeforeCooldown = deliveryCount;
    const cooldownFirst = await request(server, "/auth/mobile-login/request", {
      email, password, deviceId: cooldownDeviceId,
    }, "198.51.100.13");
    assert.equal(cooldownFirst.status, 202);
    const cooldownRepeat = await request(server, "/auth/mobile-login/request", {
      email, password, deviceId: cooldownDeviceId,
    }, "198.51.100.13");
    assert.equal(cooldownRepeat.status, 202);
    assert.equal(cooldownRepeat.body.challengeId, cooldownFirst.body.challengeId);
    assert.equal(typeof cooldownRepeat.body.token, "undefined");
    assert.equal(deliveryCount, deliveryCountBeforeCooldown + 1, "A repeat request during cooldown must not send another email.");

    const deliveryCountBeforeFirst = deliveryCount;
    const first = await request(server, "/auth/mobile-login/request", { email, password, deviceId });
    assert.equal(first.status, 202);
    assert.equal(first.body.requiresCode, true);
    assert.equal(typeof first.body.token, "undefined");
    assert.equal(deliveryCount, deliveryCountBeforeFirst + 1);
    assert(deliveredCode);

    const confirmed = await request(server, "/auth/mobile-login/confirm", {
      email, deviceId, challengeId: first.body.challengeId, code: deliveredCode,
    });
    assert.equal(confirmed.status, 200);
    assert.equal(typeof confirmed.body.token, "string");
    const sessionToken = confirmed.body.token as string;

    const trusted = await request(server, "/auth/mobile-login/request", { email, password, deviceId });
    assert.equal(trusted.status, 200);
    assert.equal(trusted.body.requiresCode, false);
    assert.equal(typeof trusted.body.token, "string");
    assert.equal(deliveryCount, deliveryCountBeforeFirst + 1, "A trusted device must not receive another code.");

    const unauthenticatedList = await requestApi(server, "/auth/mobile-devices");
    assert.equal(unauthenticatedList.status, 401, "Listing trusted devices requires an authenticated account.");

    const listed = await requestApi(server, "/auth/mobile-devices", { token: sessionToken });
    assert.equal(listed.status, 200);
    assert.equal(Array.isArray(listed.body), true);
    const devices = listed.body as Array<Record<string, unknown>>;
    assert.equal(devices.length, 1);
    assert.equal(typeof devices[0].deviceKey, "string");
    assert.equal("id" in devices[0], false, "The internal numeric ID must not be exposed.");
    assert.equal("deviceHash" in devices[0], false, "The private device hash must not be exposed.");

    const deviceKey = devices[0].deviceKey as string;
    const unauthorizedRevoke = await requestApi(server, `/auth/mobile-devices/${deviceKey}`, { method: "DELETE" });
    assert.equal(unauthorizedRevoke.status, 401, "Revoking a trusted device requires an authenticated account.");

    const otherEmail = `other-mobile-device-${Date.now()}@example.test`;
    const [otherUser] = await db.insert(users).values({
      nombre: "Otra cuenta de prueba",
      email: otherEmail,
      emailVerifiedAt: new Date(),
      passwordHash: await bcrypt.hash(password, 4),
    }).returning({ id: users.id });
    otherUserId = otherUser.id;
    const otherLogin = await request(server, "/auth/login", { email: otherEmail, password });
    assert.equal(otherLogin.status, 200);
    const otherToken = otherLogin.body.token as string;
    const otherListed = await requestApi(server, "/auth/mobile-devices", { token: otherToken });
    assert.deepEqual(otherListed.body, [], "A user must not see another account's trusted devices.");
    const crossAccountRevoke = await requestApi(server, `/auth/mobile-devices/${deviceKey}`, { method: "DELETE", token: otherToken });
    assert.equal(crossAccountRevoke.status, 404, "A user must not revoke another account's trusted devices.");

    const revoked = await requestApi(server, `/auth/mobile-devices/${deviceKey}`, { method: "DELETE", token: sessionToken });
    assert.equal(revoked.status, 204);

    const listedAfterRevoke = await requestApi(server, "/auth/mobile-devices", { token: sessionToken });
    assert.deepEqual(listedAfterRevoke.body, []);

    const loginAfterRevoke = await request(server, "/auth/mobile-login/request", { email, password, deviceId });
    assert.equal(loginAfterRevoke.status, 202, "A revoked installation must be challenged again.");
    assert.equal(loginAfterRevoke.body.requiresCode, true);
    assert.equal(deliveryCount, deliveryCountBeforeFirst + 2);

    const replay = await request(server, "/auth/mobile-login/confirm", {
      email, deviceId, challengeId: first.body.challengeId, code: deliveredCode,
    });
    assert.equal(replay.status, 400, "A device login code must be single-use.");
  } finally {
    if (userId) {
      await db.delete(mobileLoginChallenges).where(eq(mobileLoginChallenges.usuarioId, userId));
      await db.delete(mobileTrustedDevices).where(eq(mobileTrustedDevices.usuarioId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    if (otherUserId) await db.delete(users).where(eq(users.id, otherUserId));
    ReplitConnectors.prototype.createProxyFetch = originalCreateProxyFetch;
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
