import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, passwordRecoveryTokens, users } from "@workspace/db";

export const PASSWORD_RECOVERY_TTL_MS = 15 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function recoveryUrl(origin: string, token: string) {
  const url = new URL("/", origin);
  url.searchParams.set("resetToken", token);
  return url.toString();
}

async function sendRecoveryEmail({ email, name, url }: { email: string; name: string; url: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY no está configurado.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || "Worky <onboarding@resend.dev>",
      to: [email],
      subject: "Recuperá tu contraseña de Worky",
      text: `Hola ${name || "de Worky"}.\n\nRecibimos un pedido para cambiar tu contraseña. Abrí este enlace dentro de los próximos 15 minutos:\n\n${url}\n\nSi no fuiste vos, podés ignorar este correo.`,
      html: `<p>Hola ${name || "de Worky"}.</p><p>Recibimos un pedido para cambiar tu contraseña. El enlace es válido durante 15 minutos y solo puede usarse una vez.</p><p><a href="${url}">Crear una nueva contraseña</a></p><p>Si no fuiste vos, podés ignorar este correo.</p>`,
    }),
  });
  if (!response.ok) throw new Error(`El proveedor de recuperación rechazó el correo (${response.status}).`);
}

export async function createPasswordRecovery(email: string, origin: string) {
  const [user] = await db.select({ id: users.id, nombre: users.nombre, email: users.email })
    .from(users)
    .where(and(eq(users.email, email), eq(users.activo, true)))
    .limit(1);

  if (!user) return { sent: false };

  const now = new Date();
  const token = randomBytes(32).toString("hex");
  await db.update(passwordRecoveryTokens)
    .set({ usedAt: now })
    .where(and(eq(passwordRecoveryTokens.usuarioId, user.id), isNull(passwordRecoveryTokens.usedAt)));
  const [created] = await db.insert(passwordRecoveryTokens).values({
    usuarioId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + PASSWORD_RECOVERY_TTL_MS),
  }).returning({ id: passwordRecoveryTokens.id });

  try {
    await sendRecoveryEmail({
      email: user.email,
      name: user.nombre,
      url: recoveryUrl(origin, token),
    });
  } catch (error) {
    if (created) await db.delete(passwordRecoveryTokens).where(eq(passwordRecoveryTokens.id, created.id));
    throw error;
  }

  return { sent: true };
}

export function passwordRecoveryTokenHash(token: string) {
  return hashToken(token);
}

export function isPasswordRecoveryTokenValid(expiresAt: Date, usedAt: Date | null, now = new Date()) {
  return !usedAt && expiresAt.getTime() > now.getTime();
}