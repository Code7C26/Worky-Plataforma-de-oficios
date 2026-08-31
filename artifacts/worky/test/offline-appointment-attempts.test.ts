import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  addPendingAppointmentAttempt,
  getPendingAppointmentAttempts,
  savePendingAppointmentAttempts,
  syncPendingAppointmentAttempts,
  type PendingAppointmentAttempt,
} from '../src/lib/api';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

const attempt: PendingAppointmentAttempt = {
  id: -101,
  changaId: 42,
  accion: 'proponer',
  resultado: 'error_red',
  detalle: 'No pudimos conectar con el servidor.',
  appointmentId: null,
  empiezaAt: null,
  createdAt: '2026-08-23T12:00:00.000Z',
};

afterEach(() => {
  storage.clear();
});

test('una caída de red deja un único pendiente visible', () => {
  const first = addPendingAppointmentAttempt(attempt.changaId, attempt);
  const second = addPendingAppointmentAttempt(attempt.changaId, { ...attempt });

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.deepEqual(getPendingAppointmentAttempts(attempt.changaId), [attempt]);
});

test('un reintento fallido conserva el pendiente y uno exitoso lo elimina después de responder', async () => {
  savePendingAppointmentAttempts(attempt.changaId, [attempt]);
  let calls = 0;
  const request = async () => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
  };

  await assert.rejects(syncPendingAppointmentAttempts(attempt.changaId, request), /offline/);
  assert.deepEqual(getPendingAppointmentAttempts(attempt.changaId), [attempt]);

  await syncPendingAppointmentAttempts(attempt.changaId, request);
  assert.equal(calls, 2);
  assert.deepEqual(getPendingAppointmentAttempts(attempt.changaId), []);
});

test('mantiene el intento mientras la confirmación del servidor sigue pendiente', async () => {
  savePendingAppointmentAttempts(attempt.changaId, [attempt]);
  let resolveRequest!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    resolveRequest = resolve;
  });
  const request = async () => {
    await requestStarted;
  };

  const sync = syncPendingAppointmentAttempts(attempt.changaId, request);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(getPendingAppointmentAttempts(attempt.changaId), [attempt]);

  resolveRequest();
  await sync;
  assert.deepEqual(getPendingAppointmentAttempts(attempt.changaId), []);
});

test('dos señales de reconexión simultáneas crean un solo registro remoto', async () => {
  savePendingAppointmentAttempts(attempt.changaId, [attempt]);
  const remoteHistory: Array<{ changaId: number; body: string }> = [];
  let calls = 0;
  const request = async (path: string, init?: RequestInit) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    remoteHistory.push({ changaId: Number(path.match(/\/chats\/(\d+)\//)?.[1]), body: String(init?.body) });
  };

  await Promise.all([
    syncPendingAppointmentAttempts(attempt.changaId, request),
    syncPendingAppointmentAttempts(attempt.changaId, request),
  ]);

  assert.equal(calls, 1);
  assert.equal(remoteHistory.length, 1);
  assert.equal(remoteHistory[0].changaId, attempt.changaId);
  assert.match(remoteHistory[0].body, /"accion":"proponer"/);
  assert.deepEqual(getPendingAppointmentAttempts(attempt.changaId), []);
});

test('sincroniza conversaciones distintas sin cruzar sus intentos', async () => {
  const otherAttempt: PendingAppointmentAttempt = {
    ...attempt,
    id: -202,
    changaId: 84,
    accion: 'aceptar',
    resultado: 'error_validacion',
    detalle: 'La visita ya no está disponible.',
  };
  savePendingAppointmentAttempts(attempt.changaId, [attempt]);
  savePendingAppointmentAttempts(otherAttempt.changaId, [otherAttempt]);
  const requests: Array<{ changaId: number; body: string }> = [];

  const request = async (path: string, init?: RequestInit) => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    requests.push({ changaId: Number(path.match(/\/chats\/(\d+)\//)?.[1]), body: String(init?.body) });
  };

  await Promise.all([
    syncPendingAppointmentAttempts(attempt.changaId, request),
    syncPendingAppointmentAttempts(otherAttempt.changaId, request),
  ]);

  assert.deepEqual(
    requests.map(({ changaId, body }) => [changaId, JSON.parse(body).accion]),
    [[attempt.changaId, attempt.accion], [otherAttempt.changaId, otherAttempt.accion]],
  );
  assert.deepEqual(getPendingAppointmentAttempts(attempt.changaId), []);
  assert.deepEqual(getPendingAppointmentAttempts(otherAttempt.changaId), []);
});