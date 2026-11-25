import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptAppointment, rejectAppointment, setAuthTokenGetter, setBaseUrl,
} from '@workspace/api-client-react';
import { buildChatTimeline, canRespondToVisit } from '../lib/chat-timeline.ts';

const appointment = {
  id: 1, changaId: 61, clienteId: 101, profesionalId: 202,
  empiezaAt: '2026-11-20T14:00:00Z', terminaAt: null, estado: 'solicitada',
  createdAt: '2026-10-28T15:00:00Z', updatedAt: '2026-10-28T15:00:00Z',
};

test('una visita aparece aunque no exista ningún mensaje de texto', () => {
  const timeline = buildChatTimeline([], [appointment]);
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].kind, 'visit');
  assert.equal(timeline[0].appointment.id, appointment.id);
});

test('ordena mensajes y visitas por creación y mantiene claves distintas aunque compartan id', () => {
  const messages = [
    { id: 1, texto: 'Antes', createdAt: '2026-10-28T14:00:00Z' },
    { id: 2, texto: 'Después', createdAt: '2026-10-28T16:00:00Z' },
  ];
  const visits = [appointment];
  assert.deepEqual(buildChatTimeline(messages, visits).map((item) => item.key),
    ['message-2', 'visit-1', 'message-1']);
  assert.equal(messages[0].texto, 'Antes');
  assert.equal(visits[0].estado, 'solicitada');
});

test('solo el cliente de una visita pendiente puede responder, independientemente del rol visual', () => {
  assert.equal(canRespondToVisit(appointment, 101), true);
  assert.equal(canRespondToVisit(appointment, 202), false);
  assert.equal(canRespondToVisit(appointment, 303), false);
  assert.equal(canRespondToVisit(appointment), false);
  for (const estado of ['confirmada', 'en_curso', 'completada', 'cancelada']) {
    assert.equal(canRespondToVisit({ ...appointment, estado }, 101), false);
  }
});

test('aceptar y rechazar usan los endpoints existentes con Bearer, sin enviar mensajes ficticios', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  setBaseUrl('https://visit-contract.example.test');
  setAuthTokenGetter(() => 'qa-visit-token');
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    return Response.json({ ...appointment, estado: String(input).endsWith('/aceptar') ? 'confirmada' : 'cancelada' });
  };
  try {
    assert.equal((await acceptAppointment(1)).estado, 'confirmada');
    assert.equal((await rejectAppointment(1)).estado, 'cancelada');
    assert.deepEqual(calls.map((call) => new URL(call.url).pathname),
      ['/api/v1/citas/1/aceptar', '/api/v1/citas/1/rechazar']);
    for (const call of calls) {
      assert.equal(call.options.method, 'POST');
      assert.equal(new Headers(call.options.headers).get('Authorization'), 'Bearer qa-visit-token');
    }
  } finally {
    globalThis.fetch = originalFetch;
    setAuthTokenGetter(() => null);
    setBaseUrl('');
  }
});
