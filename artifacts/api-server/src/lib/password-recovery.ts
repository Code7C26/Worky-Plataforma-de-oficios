import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, passwordRecoveryTokens, users } from "@workspace/db";
import { gmailDeliveryFailureDetails, sendGmailEmail } from "./gmail-mailer";

export const PASSWORD_RECOVERY_TTL_MS = 15 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function recoveryUrl(origin: string, token: string) {
  const url = new URL("/", origin);
  url.searchParams.set("resetToken", token);
  return url.toString();
}

async function sendRecoveryEmail({
  email,
  name,
  url,
}: {
  email: string;
  name: string;
  url: string;
}) {
  const greeting = `Hola ${name.trim() || "de Worky"}.`;
  const safeName = escapeHtml(name.trim() || "de Worky");
  const safeUrl = escapeHtml(url);
  const text = `${greeting}\n\nRecibimos un pedido para cambiar tu contraseña. Abrí este enlace dentro de los próximos 15 minutos:\n\n${url}\n\nSi no fuiste vos, podés ignorar este correo.`;
  const html = `<p>Hola ${safeName}.</p><p>Recibimos un pedido para cambiar tu contraseña. El enlace es válido durante 15 minutos y solo puede usarse una vez.</p><p><a href="${safeUrl}">Crear una nueva contraseña</a></p><p>Si no fuiste vos, podés ignorar este correo.</p>`;

  await sendGmailEmail({
    to: email,
    subject: "Recuperá tu contraseña de Worky",
    text,
    html,
  });
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

export function passwordRecoveryFailureDetails(error: unknown) {
  return gmailDeliveryFailureDetails(error);
}

export function passwordRecoveryTokenHash(token: string) {
  return hashToken(token);
}

export function isPasswordRecoveryTokenValid(expiresAt: Date, usedAt: Date | null, now = new Date()) {
  return !usedAt && expiresAt.getTime() > now.getTime();
}