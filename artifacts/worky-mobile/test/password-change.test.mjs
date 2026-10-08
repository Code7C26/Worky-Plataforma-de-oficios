import assert from 'node:assert/strict';
import test from 'node:test';
import { changePasswordWithValidation } from '../lib/password-change.ts';

const validInput = {
  currentPassword: 'current-pass',
  newPassword: 'new-password',
  confirmation: 'new-password',
};

test('un cambio de contraseña exitoso se confirma después de persistir', async () => {
  let persistCalls = 0;

  const result = await changePasswordWithValidation(validInput, async () => {
    persistCalls += 1;
  });

  assert.deepEqual(result, { kind: 'saved' });
  assert.equal(persistCalls, 1);
});

test('un cambio de contraseña fallido conserva el error y no confirma éxito', async () => {
  const result = await changePasswordWithValidation(validInput, async () => {
    throw new Error('La contraseña actual no es correcta.');
  });

  assert.deepEqual(result, { kind: 'error', message: 'La contraseña actual no es correcta.' });
});

test('la validación de contraseña no envía un cambio inválido al servidor', async () => {
  let persistCalls = 0;

  const result = await changePasswordWithValidation({
    ...validInput,
    confirmation: 'different-password',
  }, async () => {
    persistCalls += 1;
  });

  assert.deepEqual(result, { kind: 'error', message: 'Las contraseñas nuevas no coinciden.' });
  assert.equal(persistCalls, 0);
});