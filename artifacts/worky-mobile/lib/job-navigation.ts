import type { Job } from '@workspace/api-client-react';

export function getJobParticipant(job: Job, accountId?: number) {
  return job.clienteId === accountId ? job.profesional : job.cliente;
}

export function formatJobContextTitle(category: string, participantName?: string | null) {
  const name = participantName?.trim();
  return name ? `${category} – ${name}` : category;
}

export function canReviewJob(job: Job, accountId?: number) {
  return job.clienteId === accountId && Boolean(job.profesionalId) &&
    job.estado === 'finalizada' && !job.calificada;
}

export function getJobReviewRoute(jobId: number) {
  return { pathname: '/(tabs)/jobs' as const, params: { jobId: String(jobId) } };
}
