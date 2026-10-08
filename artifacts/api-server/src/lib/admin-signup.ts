import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const ADMIN_SIGNUP_CODE_TTL_MS = 15 * 60 * 1000;
export const ADMIN_SIGNUP_RESEND_COOLDOWN_MS = 60 * 1000;
export const ADMIN_SIGNUP_MAX_ATTEMPTS = 5;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getAdminSignupAllowlist(raw = process.env.WORKY_ADMIN_SIGNUP_ALLOWED_EMAILS) {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => EMAIL_PATTERN.test(email)),
  );
}

function signupCodeHash(email: string, code: string, salt: string) {
  const key = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!key) throw new Error("La clave de sesión de Worky no está configurada.");
  return createHmac("sha256", key).update(`${email}\u0000${salt}\u0000${code}`).digest("hex");
}

export function createAdminSignupChallenge(email: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const salt = randomBytes(16).toString("hex");
  return { code, salt, codeHash: signupCodeHash(email, code, salt) };
}

export function matchesAdminSignupCode(email: string, code: string, salt: string, expectedHash: string) {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(signupCodeHash(email, code, salt), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
