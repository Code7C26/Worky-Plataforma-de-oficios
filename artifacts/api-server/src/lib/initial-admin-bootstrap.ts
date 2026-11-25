import { and, eq, isNotNull } from "drizzle-orm";
import { db, users, workyAuditEvents } from "@workspace/db";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function configuredInitialAdminEmail(): string | null {
  const raw = process.env.WORKY_INITIAL_ADMIN_EMAIL;
  if (!raw?.trim()) return null;

  const email = raw.trim().toLowerCase();
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
    throw new Error("WORKY_INITIAL_ADMIN_EMAIL must contain a valid email address.");
  }
  return email;
}

/**
 * Promotes only the configured, active, email-verified account, and only while
 * Worky has no active, verified administrator. Returns null when ineligible.
 */
export async function grantInitialAdminIfEligible(userId: number) {
  const email = configuredInitialAdminEmail();
  if (!email) return null;

  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(users)
      .where(and(
        eq(users.id, userId),
        eq(users.email, email),
        eq(users.activo, true),
        isNotNull(users.emailVerifiedAt),
      ))
      .for("update")
      .limit(1);

    if (!target) return null;
    if (target.rol === "admin") return target;

    const [existingAdmin] = await tx.select({ id: users.id }).from(users)
      .where(and(
        eq(users.rol, "admin"),
        eq(users.activo, true),
        isNotNull(users.emailVerifiedAt),
      ))
      .limit(1);
    if (existingAdmin) return target;

    const [updated] = await tx.update(users)
      .set({ rol: "admin", updatedAt: new Date() })
      .where(and(
        eq(users.id, target.id),
        eq(users.email, email),
        eq(users.activo, true),
        isNotNull(users.emailVerifiedAt),
        eq(users.rol, target.rol),
      ))
      .returning();

    if (!updated) return target;

    await tx.insert(workyAuditEvents).values({
      usuarioId: null,
      entidad: "account",
      entidadId: updated.id,
      accion: "role_granted",
      estadoAnterior: target.rol,
      estadoNuevo: "admin",
      metadata: {
        source: "verified_initial_admin_bootstrap",
        reason: "First administrator assigned after email verification",
      },
    });

    return updated;
  });
}
