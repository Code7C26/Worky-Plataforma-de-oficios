import assert from 'node:assert/strict';
import test from 'node:test';
import { savePersonalDetails } from '../lib/personal-details-save.ts';

test('al guardar los datos personales, actualiza la cuenta y confirma el éxito', async () => {
  const account = { nombre: 'Ana', telefono: '555-0101' };
  const events = [];

  const result = await savePersonalDetails(
    async () => {
      events.push('persist');
      return account;
    },
    (savedAccount) => events.push(['commit', savedAccount]),
  );

  assert.deepEqual(result, { kind: 'saved' });
  assert.deepEqual(events, ['persist', ['commit', account]]);
});

test('si falla el guardado de datos personales, conserva el error y no confirma éxito', async () => {
  const events = [];

  const result = await savePersonalDetails(
    async () => {
      events.push('persist');
      throw new Error('No hay conexión.');
    },
    (account) => events.push(['commit', account]),
  );

  assert.deepEqual(result, { kind: 'error', message: 'No hay conexión.' });
  assert.deepEqual(events, ['persist']);
});

test('si el error de guardado no es una excepción, muestra el mensaje de respaldo', async () => {
  const result = await savePersonalDetails(
    async () => Promise.reject('falló'),
    () => assert.fail('No se debe confirmar una cuenta cuando falla el guardado'),
  );

  assert.deepEqual(result, { kind: 'error', message: 'No pudimos guardar tus datos.' });
});