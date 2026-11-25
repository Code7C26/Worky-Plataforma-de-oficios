import { and, eq, inArray, sql, type SQLWrapper } from "drizzle-orm";
import { db, jobs, payments } from "@workspace/db";

export const RECOMMENDATION_RANKING_ACTIVATION_ENVIRONMENT = "production";
export const RECOMMENDATION_RISK_WINDOW_DAYS = 30;
export const RECOMMENDATION_RISK_REVIEW_THRESHOLD = 2;
export const RECOMMENDATION_VISIT_BALANCE_PENALTY = 1;
export const RECOMMENDATION_REVIEWED_RISK_PENALTY = 1;
export const RECOMMENDATION_RISK_DECISION_ACTIONS = [
  "recommendation_incident_confirmed",
  "recommendation_incident_dismissed",
] as const;

export async function isPaidJobRecommendationRankingActive() {
  if (process.env.NODE_ENV !== RECOMMENDATION_RANKING_ACTIVATION_ENVIRONMENT) return false;
  const [confirmedPayment] = await db.select({ id: payments.id })
    .from(payments)
    .innerJoin(jobs, eq(jobs.id, payments.changaId))
    .where(and(
      eq(payments.status, "aprobado"),
      inArray(payments.provider, ["mercado_pago", "efectivo"]),
      eq(jobs.estado, "finalizada"),
    ))
    .limit(1);
  return shouldActivatePaidJobRanking(process.env.NODE_ENV, Boolean(confirmedPayment));
}

export function confirmedIncidentCountSql(professionalId: SQLWrapper) {
  return sql<number>`(
    select count(distinct confirmed_event.entidad_id)::int
    from worky_audit_events confirmed_event
    inner join worky_jobs incident_job on incident_job.id = confirmed_event.entidad_id
    where confirmed_event.entidad = 'job'
      and confirmed_event.accion = 'recommendation_incident_confirmed'
      and incident_job.profesional_id = ${professionalId}
      and confirmed_event.created_at >= now() - (${RECOMMENDATION_RISK_WINDOW_DAYS} * interval '1 day')
      and not exists (
        select 1
        from worky_audit_events later_event
        where later_event.entidad = 'job'
          and later_event.entidad_id = confirmed_event.entidad_id
          and later_event.accion in ('recommendation_incident_confirmed', 'recommendation_incident_dismissed')
          and (
            later_event.created_at > confirmed_event.created_at
            or (later_event.created_at = confirmed_event.created_at and later_event.id > confirmed_event.id)
          )
      )
  )`;
}

export function shouldActivatePaidJobRanking(environment: string | undefined, hasConfirmedPaidJob: boolean) {
  return environment === RECOMMENDATION_RANKING_ACTIVATION_ENVIRONMENT && hasConfirmedPaidJob;
}

export function calculateVisibilityRank(input: {
  currentVisibilityRank: number;
  rankingActive: boolean;
  cashVisitCommissionDue: number;
  confirmedRecentIncidents: number;
}) {
  const currentRank = Math.max(0, Math.trunc(input.currentVisibilityRank));
  if (!input.rankingActive) return currentRank;

  const pendingBalancePenalty = input.cashVisitCommissionDue > 0
    ? RECOMMENDATION_VISIT_BALANCE_PENALTY
    : 0;
  const reviewedRiskPenalty = input.confirmedRecentIncidents >= RECOMMENDATION_RISK_REVIEW_THRESHOLD
    ? RECOMMENDATION_REVIEWED_RISK_PENALTY
    : 0;

  return currentRank + pendingBalancePenalty + reviewedRiskPenalty;
}

export function isReviewableActivitySignal(input: {
  jobStatus: string;
  messageCount: number;
  acceptedVisitCount: number;
}) {
  return input.jobStatus === "cancelada" && input.messageCount > 0 && input.acceptedVisitCount > 0;
}
