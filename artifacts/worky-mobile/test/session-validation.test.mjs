import assert from 'node:assert/strict';
import test from 'node:test';
import { getSessionValidationStatus, loadAccountWithRetry } from '../lib/session-validation.ts';

test('recupera la sesión si la API vuelve a responder durante el reintento', async () => {
  let calls = 0;
  const waits = [];
  const account = await loadAccountWithRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new TypeError('Network request failed');
      return { id: 42 };
    },
    {
      retryDelaysMs: [10, 25],
      wait: async (milliseconds) => { waits.push(milliseconds); },
    },
  );

  assert.deepEqual(account, { id: 42 });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10, 25]);
});

test('no reintenta sesiones rechazadas ni errores de ruta', async () => {
  for (const status of [401, 403, 404]) {
    let calls = 0;
    await assert.rejects(
      loadAccountWithRetry(
        async () => {
          calls += 1;
          throw { status };
        },
        { wait: async () => assert.fail('No debería esperar en errores definitivos.') },
      ),
    );
    assert.equal(calls, 1, `status ${status}`);
  }
});

test('reintenta respuestas de servidor y conserva el código de estado', async () => {
  let calls = 0;
  let statusOnFailure;
  const result = await loadAccountWithRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw { response: { status: 503 } };
      return 'ok';
    },
    { retryDelaysMs: [1], wait: async () => undefined },
  );

  try {
    await loadAccountWithRetry(
      async () => { throw { response: { status: 503 } }; },
      { retryDelaysMs: [], wait: async () => undefined },
    );
  } catch (error) {
    statusOnFailure = getSessionValidationStatus(error);
  }

  assert.equal(result, 'ok');
  assert.equal(calls, 2);
  assert.equal(statusOnFailure, 503);
});
