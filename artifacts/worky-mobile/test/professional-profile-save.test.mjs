import assert from 'node:assert/strict';
import test from 'node:test';
import { runProfessionalProfileSave } from '../lib/professional-profile-save.ts';

test('si falla el guardado del perfil profesional, conserva el error y no actualiza los datos', async () => {
  let refreshed = false;

  const result = await runProfessionalProfileSave(
    async () => {
      throw new Error('No hay conexión.');
    },
    async () => {
      refreshed = true;
    },
  );

  assert.deepEqual(result, { kind: 'error', message: 'No hay conexión.' });
  assert.equal(refreshed, false);
});

test('si falla la actualización posterior al guardado, muestra el fallo en lugar del éxito', async () => {
  const result = await runProfessionalProfileSave(
    async () => ({ id: 'profile-1' }),
    async () => {
      throw new Error('No se pudo actualizar la vista.');
    },
  );

  assert.deepEqual(result, { kind: 'error', message: 'No se pudo actualizar la vista.' });
});

test('si el guardado falla con un valor inesperado, muestra el mensaje de respaldo', async () => {
  const result = await runProfessionalProfileSave(
    async () => Promise.reject('falló'),
    async () => assert.fail('No se deben actualizar los datos cuando falla el guardado'),
  );

  assert.deepEqual(result, { kind: 'error', message: 'No pudimos guardar tu perfil.' });
});