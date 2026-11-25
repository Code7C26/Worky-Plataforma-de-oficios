import { and, asc, eq } from "drizzle-orm";
import { cashJobCommissions, db, visitPayments, workyAuditEvents } from "@workspace/db";

export async function settleAvailableVisitCommissions(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  professionalId: number,
  now: Date,
) {
  const debts = await tx.select().from(visitPayments)
    .where(and(eq(visitPayments.profesionalId, professionalId), eq(visitPayments.status, "cash_commission_due")))
    .orderBy(asc(visitPayments.createdAt), asc(visitPayments.id))
    .for("update");
  const balances = await tx.select().from(visitPayments)
    .where(and(eq(visitPayments.profesionalId, professionalId), eq(visitPayments.status, "available")))
    .orderBy(asc(visitPayments.createdAt), asc(visitPayments.id))
    .for("update");

  let balanceIndex = 0;
  for (const debt of debts) {
    let remainingDebt = Math.max(0, Math.round(Number(debt.commissionAmount) * 100));
    while (remainingDebt > 0 && balanceIndex < balances.length) {
      const balance = balances[balanceIndex];
      let remainingBalance = Math.max(0, Math.round(Number(balance.partnerAmount) * 100));
      if (remainingBalance === 0) {
        balanceIndex += 1;
        continue;
      }
      const offset = Math.min(remainingDebt, remainingBalance);
      remainingDebt -= offset;
      remainingBalance -= offset;
      await tx.update(visitPayments).set({
        partnerAmount: (remainingBalance / 100).toFixed(2),
        updatedAt: now,
      }).where(eq(visitPayments.id, balance.id));
      await tx.update(visitPayments).set({
        commissionAmount: (remainingDebt / 100).toFixed(2),
        status: remainingDebt === 0 ? "cash_commission_settled" : "cash_commission_due",
        updatedAt: now,
      }).where(eq(visitPayments.id, debt.id));
      await tx.insert(workyAuditEvents).values({
        entidad: "visit_payment",
        entidadId: debt.id,
        accion: "cash_commission_offset",
        estadoAnterior: "cash_commission_due",
        estadoNuevo: remainingDebt === 0 ? "cash_commission_settled" : "cash_commission_due",
        metadata: {
          bookingId: debt.bookingId,
          offsetByBookingId: balance.bookingId,
          amount: (offset / 100).toFixed(2),
          remainingCommissionAmount: (remainingDebt / 100).toFixed(2),
          remainingAvailableAmount: (remainingBalance / 100).toFixed(2),
        },
      });
      balance.partnerAmount = (remainingBalance / 100).toFixed(2);
      if (remainingBalance === 0) balanceIndex += 1;
    }
    if (balanceIndex >= balances.length) break;
  }
}

export async function settleAvailableCashJobCommissions(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  professionalId: number,
  now: Date,
) {
  const debts = await tx.select().from(cashJobCommissions)
    .where(and(eq(cashJobCommissions.profesionalId, professionalId), eq(cashJobCommissions.status, "due")))
    .orderBy(asc(cashJobCommissions.createdAt), asc(cashJobCommissions.id))
    .for("update");
  const balances = await tx.select().from(visitPayments)
    .where(and(eq(visitPayments.profesionalId, professionalId), eq(visitPayments.status, "available")))
    .orderBy(asc(visitPayments.createdAt), asc(visitPayments.id))
    .for("update");

  let balanceIndex = 0;
  for (const debt of debts) {
    let remainingDebt = Math.max(0, Math.round(Number(debt.remainingAmount) * 100));
    while (remainingDebt > 0 && balanceIndex < balances.length) {
      const balance = balances[balanceIndex];
      let remainingBalance = Math.max(0, Math.round(Number(balance.partnerAmount) * 100));
      if (remainingBalance === 0) {
        balanceIndex += 1;
        continue;
      }
      const offset = Math.min(remainingDebt, remainingBalance);
      remainingDebt -= offset;
      remainingBalance -= offset;
      await tx.update(visitPayments).set({
        partnerAmount: (remainingBalance / 100).toFixed(2),
        updatedAt: now,
      }).where(eq(visitPayments.id, balance.id));
      await tx.update(cashJobCommissions).set({
        remainingAmount: (remainingDebt / 100).toFixed(2),
        status: remainingDebt === 0 ? "settled" : "due",
        settledAt: remainingDebt === 0 ? now : null,
        updatedAt: now,
      }).where(eq(cashJobCommissions.id, debt.id));
      await tx.insert(workyAuditEvents).values({
        entidad: "cash_job_commission",
        entidadId: debt.id,
        accion: "cash_job_commission_offset",
        estadoAnterior: "due",
        estadoNuevo: remainingDebt === 0 ? "settled" : "due",
        metadata: {
          changaId: debt.changaId,
          offsetByBookingId: balance.bookingId,
          amount: (offset / 100).toFixed(2),
          remainingCommissionAmount: (remainingDebt / 100).toFixed(2),
          remainingAvailableAmount: (remainingBalance / 100).toFixed(2),
        },
      });
      balance.partnerAmount = (remainingBalance / 100).toFixed(2);
      if (remainingBalance === 0) balanceIndex += 1;
    }
    if (balanceIndex >= balances.length) break;
  }
}

/** Preserve visit-fee debt priority, then compensate cash-job commissions. */
export async function settleAvailablePartnerCommissions(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  professionalId: number,
  now: Date,
) {
  await settleAvailableVisitCommissions(tx, professionalId, now);
  await settleAvailableCashJobCommissions(tx, professionalId, now);
}
