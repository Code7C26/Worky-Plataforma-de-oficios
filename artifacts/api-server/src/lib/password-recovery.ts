import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, passwordRecoveryTokens, users } from "@workspace/db";
import { sendWorkyEmail } from "./worky-email";

export const PASSWORD_RECOVERY_TTL_MS = 15 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function recoveryUrl(origin: string, token: string) {
  const url = new URL("/", origin);
  url.searchParams.set("resetToken", token);
  return url.toString();
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
    await sendWorkyEmail({
      to: user.email,
      subject: "Recuperá tu contraseña de Worky",
      text: `Hola ${user.nombre || "de Worky"}.\n\nRecibimos un pedido para cambiar tu contraseña. Abrí este enlace dentro de los próximos 15 minutos:\n\n${recoveryUrl(origin, token)}\n\nSi no fuiste vos, podés ignorar este correo.`,
      html: `<p>Hola ${user.nombre || "de Worky"}.</p><p>Recibimos un pedido para cambiar tu contraseña. El enlace es válido durante 15 minutos y solo puede usarse una vez.</p><p><a href="${recoveryUrl(origin, token)}">Crear una nueva contraseña</a></p><p>Si no fuiste vos, podés ignorar este correo.</p>`,
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