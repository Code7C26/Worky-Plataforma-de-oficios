import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canReviewJob, formatJobContextTitle, getJobParticipant, getJobReviewRoute } from '../lib/job-navigation.ts';
import { createJobReview, setBaseUrl, setAuthTokenGetter } from '@workspace/api-client-react';

const job = { id: 61, clienteId: 101, profesionalId: 202, estado: 'finalizada', calificada: false,
  cliente: { id: 101, nombre: 'Cliente QA' }, profesional: { id: 202, nombre: 'Profesional QA', fotoObjectPath: '/objects/qa' } };

test('chat resolves other participant from job, not navigation params or active role', () => {
  assert.equal(getJobParticipant(job, 101), job.profesional);
  assert.equal(getJobParticipant(job, 202), job.cliente);
});
test('job title includes the category and participant without dangling separators', () => {
  assert.equal(formatJobContextTitle('Plomería', 'Mateo Villarreal'), 'Plomería – Mateo Villarreal');
  assert.equal(formatJobContextTitle('Plomería', '  '), 'Plomería');
});
test('only actual client can review completed, assigned, unreviewed job', () => {
  assert.equal(canReviewJob(job, 101), true);
  for (const estado of ['publicada', 'aceptada', 'en_curso', 'cancelada']) {
    assert.equal(canReviewJob({ ...job, estado }, 101), false);
  }
  assert.equal(canReviewJob(job, 202), false);
  assert.equal(canReviewJob({ ...job, calificada: true }, 101), false);
  assert.equal(canReviewJob({ ...job, profesionalId: null }, 101), false);
  assert.equal(getJobReviewRoute(61).params.jobId, '61');
});
test('review uses shared generated API with Bearer and correct payload', async () => {
  const original = globalThis.fetch;
  setBaseUrl('https://worky-qa.test');
  setAuthTokenGetter(() => 'qa-review-token');
  let call;
  globalThis.fetch = async (url, options) => {
    call = { url, options };
    return Response.json({ id: 1, changaId: 61, rating: 5 }, { status: 201 });
  };
  try {
    const result = await createJobReview({ changaId: 61, rating: 5, comentario: 'Buen trabajo' });
    assert.equal(result.rating, 5);
    assert.equal(new URL(call.url).pathname, '/api/v1/reviews');
    assert.equal(call.options.method, 'POST');
    assert.equal(new Headers(call.options.headers).get('Authorization'), 'Bearer qa-review-token');
    assert.deepEqual(JSON.parse(call.options.body), { changaId: 61, rating: 5, comentario: 'Buen trabajo' });
  } finally {
    globalThis.fetch = original;
    setBaseUrl('');
    setAuthTokenGetter(() => null);
  }
});
