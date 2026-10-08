import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import router from "../src/routes/worky";
import { verifyToken } from "../src/middlewares/auth";
import { ADMIN_SIGNUP_MAX_ATTEMPTS, ADMIN_SIGNUP_CODE_TTL_MS, createAdminSignupChallenge } from "../src/lib/admin-signup";
import { db, users, adminSignupTokens, workyAuditEvents, isolatedPostgres, initializeDatabase, resetDatabase, statements } from "./support/admin-signup-db";
import { deliveries, resetEmail, failEmail } from "./support/admin-signup-email";

const email = "admin@example.test";
const password = "IsolatedPassword123!";
const endpoint = "/auth/admin-signup";
let server: Server;
let base: string;
let scenario = 0;
let passwordHash: string;

before(async () => {
  assert.equal(process.env.DATABASE_URL, undefined);
  assert.equal(process.env.RESEND_API_KEY, undefined);
  await initializeDatabase();
  passwordHash = await bcrypt.hash(password, 12);
  const app = express();
  // Separate RFC 5737 test IP per scenario keeps the real per-IP limiters active.
  app.set("trust proxy", "loopback");
  app.use(express.json());
  app.use((req, _res, next) => { req.log = { error() {} } as any; next(); });
  app.use("/api/v1", router);
  app.use((error: unknown, _req: unknown, res: express.Response, _next: unknown) => {
    res.status(500).json({ error: "isolated test transaction failed" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api/v1`;
});

beforeEach(async () => {
  await resetDatabase();
  resetEmail();
  process.env.WORKY_ADMIN_SIGNUP_ALLOWED_EMAILS = email;
  scenario++;
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await isolatedPostgres.close();
});

async function post(path: string, body: unknown) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${scenario}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

function complete(codigo: string, extra: Record<string, unknown> = {}) {
  return post(endpoint + "/complete", { nombre: "Test Admin", email, password, codigo, ...extra });
}

async function seedChallenge(extra: Partial<typeof adminSignupTokens.$inferInsert> = {}) {
  const challenge = createAdminSignupChallenge(email);
  const [row] = await db.insert(adminSignupTokens).values({
    email, codeHash: challenge.codeHash, codeSalt: challenge.salt,
    expiresAt: new Date(Date.now() + ADMIN_SIGNUP_CODE_TTL_MS), ...extra,
  }).returning();
  return { ...challenge, row };
}

async function seedAccount(extra: Partial<typeof users.$inferInsert> = {}) {
  const [account] = await db.insert(users).values({
    nombre: "Existing Test", email, passwordHash, rol: "cliente", ...extra,
  }).returning();
  return account;
}

async function snapshot() {
  return {
    accounts: await db.select().from(users),
    codes: await db.select().from(adminSignupTokens),
    audit: await db.select().from(workyAuditEvents),
  };
}

async function assertNoPrivilege(response: Awaited<ReturnType<typeof post>>) {
  assert.equal(response.body.token, undefined);
  assert.equal(response.body.usuario, undefined);
  assert.equal((await db.select().from(users)).some((account) => account.rol === "admin"), false);
  assert.equal((await db.select().from(workyAuditEvents)).length, 0);
}

test("missing or invalid allowlist fails closed on both routes", async () => {
  for (const raw of [undefined, "", "invalid-entry"]) {
    if (raw === undefined) delete process.env.WORKY_ADMIN_SIGNUP_ALLOWED_EMAILS;
    else process.env.WORKY_ADMIN_SIGNUP_ALLOWED_EMAILS = raw;
    const before = await snapshot();
    assert.equal((await post(endpoint + "/request", { email })).status, 503);
    const response = await complete("123456");
    assert.equal(response.status, 503);
    await assertNoPrivilege(response);
    assert.deepEqual(await snapshot(), before);
  }
  assert.equal(deliveries.length, 0);
});

test("unauthorized email receives generic request response and cannot complete even with a valid code", async () => {
  const challenge = await seedChallenge();
  process.env.WORKY_ADMIN_SIGNUP_ALLOWED_EMAILS = "other@example.test";
  const before = await snapshot();
  const denied = await post(endpoint + "/request", { email });
  assert.equal(denied.status, 202);
  assert.equal(deliveries.length, 0);
  const response = await complete(challenge.code);
  assert.equal(response.status, 400);
  await assertNoPrivilege(response);
  assert.deepEqual(await snapshot(), before);
  const allowed = await post(endpoint + "/request", { email: "other@example.test" });
  assert.deepEqual(denied.body, allowed.body);
});

test("request normalizes allowlisted email, hashes the code, sets TTL and respects resend cooldown", async () => {
  const start = Date.now();
  const response = await post(endpoint + "/request", { email: " ADMIN@EXAMPLE.TEST " });
  assert.equal(response.status, 202);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].to, email);
  const code = deliveries[0].text.match(/\b\d{6}\b/)?.[0];
  assert(code);
  assert.equal(JSON.stringify(response.body).includes(code), false);
  const state = await snapshot();
  const row = state.codes[0];
  assert.equal(row.email, email);
  assert.notEqual(row.codeHash, code);
  assert.equal(row.attempts, 0);
  assert.equal(row.usedAt, null);
  assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), ADMIN_SIGNUP_CODE_TTL_MS);
  assert(row.createdAt.getTime() >= start);
  await post(endpoint + "/request", { email });
  assert.equal(deliveries.length, 1);
  assert.deepEqual(await snapshot(), state);
  assert.equal((await complete(code)).status, 201);
});

test("email delivery failure invalidates the unsent challenge", async () => {
  failEmail();
  assert.equal((await post(endpoint + "/request", { email })).status, 503);
  const state = await snapshot();
  assert(state.codes[0].usedAt);
  assert.equal(state.accounts.length, 0);
  assert.equal(state.audit.length, 0);
  assert.equal(deliveries.length, 0);
});

for (const invalid of ["missing", "expired", "consumed", "attempts-exhausted"] as const) {
  test(`${invalid} challenge cannot grant admin and does not mutate state`, async () => {
    const challenge = invalid === "missing" ? undefined : await seedChallenge({
      ...(invalid === "expired" ? { expiresAt: new Date(0) } : {}),
      ...(invalid === "consumed" ? { usedAt: new Date(0) } : {}),
      ...(invalid === "attempts-exhausted" ? { attempts: ADMIN_SIGNUP_MAX_ATTEMPTS } : {}),
    });
    const before = await snapshot();
    const response = await complete(challenge?.code ?? "123456");
    assert.equal(response.status, 400);
    await assertNoPrivilege(response);
    assert.deepEqual(await snapshot(), before);
  });
}

test("five incorrect codes consume the challenge; the correct code then fails", async () => {
  const challenge = await seedChallenge();
  const wrong = challenge.code === "000000" ? "000001" : "000000";
  for (let attempt = 1; attempt <= ADMIN_SIGNUP_MAX_ATTEMPTS; attempt++) {
    const response = await complete(wrong);
    assert.equal(response.status, 400);
    await assertNoPrivilege(response);
    const state = await snapshot();
    assert.equal(state.codes[0].attempts, attempt);
    assert.equal(Boolean(state.codes[0].usedAt), attempt === ADMIN_SIGNUP_MAX_ATTEMPTS);
  }
  const before = await snapshot();
  assert.equal((await complete(challenge.code)).status, 400);
  assert.deepEqual(await snapshot(), before);
});

test("existing account needs its current password and wrong passwords also exhaust the code", async () => {
  const account = await seedAccount();
  const challenge = await seedChallenge();
  for (let attempt = 1; attempt <= ADMIN_SIGNUP_MAX_ATTEMPTS; attempt++) {
    const response = await complete(challenge.code, { password: "NotTheCurrentPassword" });
    assert.equal(response.status, 401);
    await assertNoPrivilege(response);
    const state = await snapshot();
    assert.deepEqual(state.accounts, [account]);
    assert.equal(state.codes[0].attempts, attempt);
  }
  assert((await snapshot()).codes[0].usedAt);
  assert.equal((await complete(challenge.code)).status, 400);
});

test("a disabled account stays disabled and consumes the challenge", async () => {
  const account = await seedAccount({ activo: false });
  const challenge = await seedChallenge();
  const response = await complete(challenge.code);
  assert.equal(response.status, 409);
  await assertNoPrivilege(response);
  const state = await snapshot();
  assert.deepEqual(state.accounts, [account]);
  assert(state.codes[0].usedAt);
  assert.equal((await complete(challenge.code)).status, 400);
});

test("a new short password is rejected without consumption and can be corrected", async () => {
  const challenge = await seedChallenge();
  const before = await snapshot();
  const response = await complete(challenge.code, { password: "elevenchars" });
  assert.equal(response.status, 422);
  await assertNoPrivilege(response);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await complete(challenge.code, { password: "twelvechars!" })).status, 201);
});

test("malformed input never reaches account creation or consumes a challenge", async () => {
  const challenge = await seedChallenge();
  const before = await snapshot();
  for (const body of [{ codigo: "12345" }, { codigo: "abcdef" }, { password: "short" }, { nombre: " " }, { email: "invalid" }]) {
    assert.equal((await complete(challenge.code, body)).status, 400);
    assert.deepEqual(await snapshot(), before);
  }
});

test("creation atomically persists account, consumption and a single audit event; replay fails", async () => {
  const challenge = await seedChallenge();
  statements.length = 0;
  const response = await complete(challenge.code, { email: " ADMIN@EXAMPLE.TEST " });
  assert.equal(response.status, 201);
  const sql = [...statements];
  const state = await snapshot();
  const account = state.accounts[0];
  assert.equal(account.rol, "admin");
  assert.equal(account.email, email);
  assert(account.emailVerifiedAt);
  assert.equal(account.activo, true);
  assert(await bcrypt.compare(password, account.passwordHash));
  assert(state.codes[0].usedAt);
  assert.equal(verifyToken(response.body.token), account.id);
  assert.equal(response.body.usuario.rol, "admin");
  assert.equal(response.body.usuario.passwordHash, undefined);
  assert.equal(JSON.stringify(response.body).includes(challenge.codeHash), false);
  assert.equal(state.audit.length, 1);
  assert.deepEqual(
    { ...state.audit[0], id: undefined, createdAt: undefined },
    { id: undefined, createdAt: undefined, usuarioId: account.id, entidad: "account", entidadId: account.id,
      accion: "admin_self_signup", estadoAnterior: null, estadoNuevo: "admin",
      metadata: { method: "verified_allowlisted_email" } },
  );
  assert(sql.some((query) => query.includes('"worky_admin_signup_tokens"') && query.includes("for update")));
  const replay = await complete(challenge.code);
  assert.equal(replay.status, 400);
  assert.equal(replay.body.token, undefined);
  assert.deepEqual(await snapshot(), state);
});

for (const role of ["cliente", "profesional"] as const) {
  test(`${role} promotion preserves password/profile and records exactly one role-grant event`, async () => {
    // Case-insensitive lookup must find legacy mixed-case addresses.
    const account = await seedAccount({ rol: role, email: "ADMIN@EXAMPLE.TEST", telefono: "test-phone" });
    const challenge = await seedChallenge();
    statements.length = 0;
    const response = await complete(challenge.code, { nombre: "Must not replace profile" });
    assert.equal(response.status, 200);
    assert(statements.some((query) => query.includes('"worky_users"') && query.includes("for update")));
    const state = await snapshot();
    const promoted = state.accounts[0];
    assert.equal(promoted.id, account.id);
    assert.equal(promoted.rol, "admin");
    assert.equal(promoted.passwordHash, account.passwordHash);
    assert.equal(promoted.nombre, account.nombre);
    assert.equal(promoted.telefono, account.telefono);
    assert(promoted.emailVerifiedAt);
    assert(state.codes[0].usedAt);
    assert.equal(verifyToken(response.body.token), account.id);
    assert.equal(state.audit.length, 1);
    assert.equal(state.audit[0].accion, "role_granted");
    assert.equal(state.audit[0].usuarioId, account.id);
    assert.equal(state.audit[0].entidadId, account.id);
    assert.equal(state.audit[0].estadoAnterior, role);
    assert.equal(state.audit[0].estadoNuevo, "admin");
    assert.deepEqual(state.audit[0].metadata, { method: "verified_allowlisted_email" });
    assert.equal((await complete(challenge.code)).status, 400);
    assert.deepEqual(await snapshot(), state);
  });
}

test("an existing admin can authenticate once without duplicate promotion or audit", async () => {
  const account = await seedAccount({ rol: "admin", emailVerifiedAt: new Date(0) });
  const challenge = await seedChallenge();
  const response = await complete(challenge.code);
  assert.equal(response.status, 200);
  assert.equal(verifyToken(response.body.token), account.id);
  const state = await snapshot();
  assert.deepEqual(state.accounts, [account]);
  assert.equal(state.audit.length, 0);
  assert(state.codes[0].usedAt);
  assert.equal((await complete(challenge.code)).status, 400);
});

for (const existing of [false, true]) {
  test(`simultaneous completion has one winner for ${existing ? "promotion" : "creation"}`, async () => {
    if (existing) await seedAccount();
    const challenge = await seedChallenge();
    statements.length = 0;
    // Both requests are dispatched without awaiting the other.
    const responses = await Promise.all([complete(challenge.code), complete(challenge.code)]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [existing ? 200 : 201, 400]);
    assert.equal(responses.filter((r) => r.body.token).length, 1);
    const lockedReads = statements.filter((q) => q.includes('"worky_admin_signup_tokens"') && q.includes("for update"));
    assert.equal(lockedReads.length, 2, "Each route must lock and re-read the challenge in its transaction");
    const state = await snapshot();
    assert.equal(state.accounts.length, 1);
    assert.equal(state.accounts[0].rol, "admin");
    assert.equal(state.audit.length, 1);
    assert(state.codes[0].usedAt);
    assert.equal((await complete(challenge.code)).status, 400);
    assert.deepEqual(await snapshot(), state);
  });
}

for (const existing of [false, true]) {
  for (const failure of ["account", "audit", "consumption"] as const) {
    test(`${failure} write failure rolls back ${existing ? "promotion" : "creation"}, audit and consumption`, async () => {
      if (existing) await seedAccount();
      const challenge = await seedChallenge();
      const before = await snapshot();
      const table = failure === "account" ? "worky_users" : failure === "audit" ? "worky_audit_events" : "worky_admin_signup_tokens";
      const operation = failure === "account" && !existing || failure === "audit" ? "INSERT" : "UPDATE";
      await isolatedPostgres.exec(`CREATE TRIGGER reject_${failure} BEFORE ${operation} ON ${table}
        FOR EACH ROW EXECUTE FUNCTION reject_signup_write();`);
      statements.length = 0;
      const response = await complete(challenge.code);
      assert.equal(response.status, 500);
      assert.equal(response.body.token, undefined);
      assert.deepEqual(await snapshot(), before, "No partial privilege, audit or consumed challenge may survive");
      await isolatedPostgres.exec(`DROP TRIGGER reject_${failure} ON ${table};`);
      assert.equal((await complete(challenge.code)).status, existing ? 200 : 201, "Rolled-back code remains usable");
    });
  }
}

test("ordinary registration cannot grant admin even to an allowlisted email", async () => {
  for (const [index, rol] of ["admin", "ADMIN", "cliente", "profesional"].entries()) {
    const address = `ordinary-${index}@example.test`;
    process.env.WORKY_ADMIN_SIGNUP_ALLOWED_EMAILS = address;
    const response = await post("/auth/register", {
      nombre: "Ordinary Test", email: address, password, rol,
      activo: true, emailVerifiedAt: new Date().toISOString(), isAdmin: true,
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.usuario.rol, rol === "profesional" ? "profesional" : "cliente");
    assert.equal(response.body.usuario.emailVerifiedAt, null);
    const [account] = await db.select().from(users).where(eq(users.id, response.body.usuario.id));
    assert.notEqual(account.rol, "admin");
    assert.equal(account.emailVerifiedAt, null);
  }
  assert.equal(deliveries.length, 0);
  assert.equal((await snapshot()).audit.length, 0);
});
