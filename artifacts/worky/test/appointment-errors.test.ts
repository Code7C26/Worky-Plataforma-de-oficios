import assert from 'node:assert/strict';
import test from 'node:test';
import { appointmentErrorMessage } from '../src/appointment-errors';

test('explica qué operación de visita falló', () => {
  assert.match(appointmentErrorMessage('propose', new Error('Permiso insuficiente')), /No pudimos proponer la visita\. Permiso insuficiente/);
  assert.match(appointmentErrorMessage('accept', new Error('Permiso insuficiente')), /No pudimos aceptar la visita\. Permiso insuficiente/);
  assert.match(appointmentErrorMessage('reject', new Error('Permiso insuficiente')), /No pudimos rechazar la visita\. Permiso insuficiente/);
});

test('usa una indicación legible para errores de red', () => {
  for (const [action, fallback] of [
    ['propose', 'No pudimos proponer la visita.'],
    ['accept', 'No pudimos aceptar la visita.'],
    ['reject', 'No pudimos rechazar la visita.'],
  ] as const) {
    assert.equal(appointmentErrorMessage(action, new Error('Failed to fetch')), `${fallback} Revisá tu conexión y probá de nuevo.`);
  }
});

test('conserva el motivo para validación y distingue cada acción', () => {
  assert.equal(appointmentErrorMessage('propose', new Error('Elegí una fecha futura válida.')), 'No pudimos proponer la visita. Elegí una fecha futura válida.');
  assert.equal(appointmentErrorMessage('accept', new Error('Solo el cliente puede aceptar la visita.')), 'No pudimos aceptar la visita. Solo el cliente puede aceptar la visita.');
  assert.equal(appointmentErrorMessage('reject', new Error('Solo el cliente puede rechazar la visita.')), 'No pudimos rechazar la visita. Solo el cliente puede rechazar la visita.');
});