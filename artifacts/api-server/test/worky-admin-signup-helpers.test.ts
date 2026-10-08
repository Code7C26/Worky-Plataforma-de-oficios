import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createAdminSignupChallenge, getAdminSignupAllowlist, matchesAdminSignupCode } from "../src/lib/admin-signup";

const previousJwtSecret = process.env.JWT_SECRET;
const previousSessionSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = "test-only-admin-signup-secret";

after(() => {
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
  if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSessionSecret;
});

test("admin signup allowlist normalizes addresses and ignores invalid entries", () => {
  const allowlist = getAdminSignupAllowlist(" Admin.One@example.test,not-an-email,ADMIN.TWO@example.test ");

  assert.deepEqual([...allowlist], ["admin.one@example.test", "admin.two@example.test"]);
  assert.equal(getAdminSignupAllowlist("").size, 0);
});

test("verification codes are six digits and are bound to their email and salt", () => {
  const email = "admin.one@example.test";
  const challenge = createAdminSignupChallenge(email);

  assert.match(challenge.code, /^\d{6}$/);
  assert.notEqual(challenge.codeHash, challenge.code);
  assert.equal(matchesAdminSignupCode(email, challenge.code, challenge.salt, challenge.codeHash), true);
  assert.equal(matchesAdminSignupCode("admin.two@example.test", challenge.code, challenge.salt, challenge.codeHash), false);
  const wrongCode = challenge.code === "000000" ? "000001" : "000000";
  assert.equal(matchesAdminSignupCode(email, wrongCode, challenge.salt, challenge.codeHash), false);
});
