import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db, emailVerificationTokens } from "@workspace/db";

export const EMAIL_VERIFICATION_TTL_MS = 15 * 60 * 1000;
export const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_EMAIL_VERIFICATION_ATTEMPTS = 5;

type VerificationPurpose = "account";
type ConfirmedVerification = { challengeId: number; expiresAt: Date };

type DeliveryFailureReason = "missing_api_key" | "missing_sender" | "provider_rejected" | "network_or_timeout";

export class EmailVerificationDeliveryError extends Error {
  constructor(readonly reason: DeliveryFailureReason, readonly providerStatus?: number) {
    super(`Email verification delivery failed: ${reason}`);
    this.name = "EmailVerificationDeliveryError";
  }
}

export function emailVerificationFailureDetails(error: unknown) {
  return error instanceof EmailVerificationDeliveryError
    ? { reason: error.reason, providerStatus: error.providerStatus }
    : { reason: "internal_error" };
}

export function verificationMailConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new EmailVerificationDeliveryError("missing_api_key");
  const configuredSender = process.env.RESEND_FROM_EMAIL?.trim();
  if (process.env.NODE_ENV === "production" &&
      (!configuredSender || /@resend\.dev(?:>|$)/i.test(configuredSender))) {
    throw new EmailVerificationDeliveryError("missing_sender");
  }
  return { apiKey, from: configuredSender || "Worky <onboarding@resend.dev>" };
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET no está configurado.");
  return secret;
}

function hashCode(email: string, purpose: VerificationPurpose, code: string) {
  return createHmac("sha256", sessionSecret())
    .update(`${purpose}:${normalizeEmail(email)}:${code}`)
    .digest("hex");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

async function sendVerificationEmail(email: string, name: string, code: string, config: ReturnType<typeof verificationMailConfig>) {
  const greeting = name.trim() ? `Hola ${name.trim()}` : "Hola";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [email],
      subject: "Verificá tu email de Worky",
      text: `${greeting}.\n\nTu código para verificar el email es ${code}. Es válido durante 15 minutos y solo puede usarse una vez.\n\nSi no pediste este código, podés ignorar este correo.`,
      html: `<p>${escapeHtml(greeting)}.</p><p>Ingresá este código en Worky para verificar tu email:</p><p style="font-size:28px;font-weight:700;letter-spacing:8px">${code}</p><p>El código vence en 15 minutos y solo puede usarse una vez.</p><p>Si no pediste este código, podés ignorar este correo.</p>`,
    }),
  }).catch(() => {
    throw new EmailVerificationDeliveryError("network_or_timeout");
  });

  if (!response.ok) {
    throw new EmailVerificationDeliveryError("provider_rejected", response.status);
  }
}

export async function createEmailVerificationChallenge({
  email,
  name = "",
  purpose,
  usuarioId = null,
}: {
  email: string;
  name?: string;
  purpose: VerificationPurpose;
  usuarioId?: number | null;
}): Promise<{ sent: boolean; throttled: boolean }> {
  const mailConfig = verificationMailConfig();
  const normalizedEmail = normalizeEmail(email);
  const now = new Date();

  await db.delete(emailVerificationTokens)
    .where(lt(emailVerificationTokens.createdAt, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)));

  const [recent] = await db.select({ id: emailVerificationTokens.id })
    .from(emailVerificationTokens)
    .where(and(
      eq(emailVerificationTokens.email, normalizedEmail),
      eq(emailVerificationTokens.purpose, purpose),
      gt(emailVerificationTokens.createdAt, new Date(now.getTime() - EMAIL_VERIFICATION_RESEND_COOLDOWN_MS)),
    ))
    .limit(1);
  if (recent) return { sent: false, throttled: true };

  await db.update(emailVerificationTokens)
    .set({ usedAt: now })
    .where(and(
      eq(emailVerificationTokens.email, normalizedEmail),
      eq(emailVerificationTokens.purpose, purpose),
      isNull(emailVerificationTokens.usedAt),
    ));

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const [created] = await db.insert(emailVerificationTokens).values({
    email: normalizedEmail,
    usuarioId,
    purpose,
    tokenHash: hashCode(normalizedEmail, purpose, code),
    expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
  }).returning({ id: emailVerificationTokens.id });

  try {
    await sendVerificationEmail(normalizedEmail, name, code, mailConfig);
  } catch (error) {
    if (created) await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.id, created.id));
    throw error;
  }

  return { sent: true, throttled: false };
}

export async function confirmEmailVerificationCode({
  email,
  purpose,
  code,
  usuarioId,
  consume = false,
}: {
  email: string;
  purpose: VerificationPurpose;
  code: string;
  usuarioId?: number;
  consume?: boolean;
}): Promise<ConfirmedVerification | false> {
  const normalizedEmail = normalizeEmail(email);
  const now = new Date();
  const conditions = [
    eq(emailVerificationTokens.email, normalizedEmail),
    eq(emailVerificationTokens.purpose, purpose),
    isNull(emailVerificationTokens.usedAt),
    gt(emailVerificationTokens.expiresAt, now),
    lt(emailVerificationTokens.attempts, MAX_EMAIL_VERIFICATION_ATTEMPTS),
    ...(usuarioId === undefined
      ? [isNull(emailVerificationTokens.usuarioId)]
      : [eq(emailVerificationTokens.usuarioId, usuarioId)]),
  ];
  const [challenge] = await db.select().from(emailVerificationTokens)
    .where(and(...conditions))
    .orderBy(desc(emailVerificationTokens.createdAt))
    .limit(1);

  if (!challenge || !/^\d{6}$/.test(code)) return false;

  const expected = Buffer.from(challenge.tokenHash, "hex");
  const candidate = Buffer.from(hashCode(normalizedEmail, purpose, code), "hex");
  if (expected.length !== candidate.length || !timingSafeEqual(expected, candidate)) {
    const nextAttemptCount = challenge.attempts + 1;
    await db.update(emailVerificationTokens)
      .set({
        attempts: sql`${emailVerificationTokens.attempts} + 1`,
        ...(nextAttemptCount >= MAX_EMAIL_VERIFICATION_ATTEMPTS ? { usedAt: now } : {}),
      })
      .where(and(
        eq(emailVerificationTokens.id, challenge.id),
        isNull(emailVerificationTokens.usedAt),
        lt(emailVerificationTokens.attempts, MAX_EMAIL_VERIFICATION_ATTEMPTS),
      ));
    return false;
  }

  if (challenge.verifiedAt) {
    return { challengeId: challenge.id, expiresAt: challenge.expiresAt };
  }

  const [verified] = await db.update(emailVerificationTokens)
    .set({ verifiedAt: now, ...(consume ? { usedAt: now } : {}) })
    .where(and(
      eq(emailVerificationTokens.id, challenge.id),
      isNull(emailVerificationTokens.usedAt),
      gt(emailVerificationTokens.expiresAt, now),
      lt(emailVerificationTokens.attempts, MAX_EMAIL_VERIFICATION_ATTEMPTS),
    ))
    .returning({ id: emailVerificationTokens.id });

  return verified ? { challengeId: challenge.id, expiresAt: challenge.expiresAt } : false;
}