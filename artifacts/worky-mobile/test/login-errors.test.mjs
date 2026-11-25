import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ApiError, customFetch } from '../../../lib/api-client-react/src/custom-fetch.ts';
import { getLoginError } from '../lib/login-error.ts';

const request = { method: 'POST', url: '/api/v1/auth/mobile-login/request' };
function apiError(status, data) {
  return new ApiError(new Response(null, { status }), data, request);
}

test('un 404 HTML real del cliente se convierte en un aviso sin detalles internos', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    return new Response('<!DOCTYPE html><pre>Cannot POST /api/v1/auth/mobile-login/request</pre>', {
      status: 404, headers: { 'Content-Type': 'text/html' },
    });
  });
  await assert.rejects(customFetch(request.url, { method: 'POST', body: '{}' }), (reason) => {
    assert.ok(reason instanceof ApiError);
    assert.match(reason.message, /Cannot POST/);
    assert.equal(getLoginError(reason).message,
      'El ingreso móvil no está disponible en este servidor. Intentá más tarde o contactá al equipo de Worky.');
    return true;
  });
  assert.deepEqual(calls, [request.url]);
});

test('5xx HTML o JSON no revela mensajes internos ni redirige a verificar email', () => {
  for (const status of [500, 502, 503]) {
    for (const data of ['<html>stack trace</html>', { error: 'SQL passwordHash users', code: 'EMAIL_NOT_VERIFIED' }]) {
      assert.deepEqual(getLoginError(apiError(status, data)), {
        message: 'Worky no pudo completar el ingreso en este momento. Intentá de nuevo más tarde.',
      });
    }
  }
});

test('fallas de red del cliente muestran cómo reintentar sin copiar el error técnico', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Network request failed'); });
  await assert.rejects(customFetch(request.url, { method: 'POST' }), (reason) => {
    assert.equal(getLoginError(reason).message,
      'No pudimos conectarnos con Worky. Revisá tu conexión a internet e intentá de nuevo.');
    return true;
  });
  for (const reason of [new DOMException('aborted', 'AbortError'), { status: 0 }, { name: 'TimeoutError' }]) {
    assert.match(getLoginError(reason).message, /Revisá tu conexión/);
  }
});

test('credenciales inválidas conservan el mensaje en español sin el prefijo HTTP', () => {
  assert.deepEqual(getLoginError(apiError(401, { error: 'Email o contraseña incorrectos.' })), {
    message: 'Email o contraseña incorrectos.',
  });
  assert.deepEqual(getLoginError(apiError(401, '<html>Unauthorized</html>')), {
    message: 'Email o contraseña incorrectos.',
  });
});

test('email sin verificar preserva el código para el desvío existente', () => {
  assert.deepEqual(getLoginError(apiError(403, {
    code: 'EMAIL_NOT_VERIFIED', error: 'Verificá tu email para ingresar.',
  })), { code: 'EMAIL_NOT_VERIFIED', message: 'Verificá tu email para ingresar.' });
});

test('preserva los mensajes JSON conocidos de solicitud y confirmación del dispositivo', () => {
  for (const message of [
    'Revisá tu email, contraseña y dispositivo.',
    'Ingresá el código de 6 dígitos recibido por email.',
    'El código no es válido o venció. Solicitá uno nuevo al iniciar sesión.',
  ]) {
    for (const key of ['error', 'message']) {
      assert.deepEqual(getLoginError(apiError(400, { [key]: message })), { message });
    }
  }
});

test('los límites de intentos y métodos incompatibles tienen avisos claros', () => {
  assert.match(getLoginError(apiError(429, 'Too many requests')).message, /Esperá unos minutos/);
  assert.match(getLoginError(apiError(405, '<html>Method Not Allowed</html>')).message, /no está disponible/);
});

test('rechaza HTML, detalles internos en JSON, valores imprevistos y excepciones locales', () => {
  for (const reason of [
    null, undefined, 'falló', new Error('SQL SELECT passwordHash FROM users'),
    apiError(400, { error: '<b>Revisá tu email</b>' }),
    apiError(400, { error: 'Falló SQL SELECT passwordHash FROM users' }),
    apiError(400, { message: 'Error at /srv/server.ts:12' }),
    apiError(400, { error: 'Email o contraseña incorrectos.\nSQL SELECT' }),
    apiError(400, ['Email o contraseña incorrectos.']),
    apiError(403, { code: 123, error: {} }),
  ]) {
    assert.deepEqual(getLoginError(reason), { message: 'No pudimos iniciar sesión. Intentá de nuevo.' });
  }
});

test('la pantalla usa el mensaje seguro y conserva el desvío y la verificación de dispositivos', async () => {
  const screen = await readFile(new URL('../app/(auth)/login.tsx', import.meta.url), 'utf8');
  const context = await readFile(new URL('../context/AuthContext.tsx', import.meta.url), 'utf8');
  assert.match(screen, /const details = getLoginError\(reason\)/);
  assert.match(screen, /setError\(details\.message\)/);
  assert.doesNotMatch(screen, /reason\.message/);
  assert.match(screen, /details\.code === 'EMAIL_NOT_VERIFIED'/);
  assert.match(screen, /pathname: '\/\(auth\)\/verify-email'/);
  assert.match(screen, /codeSent: '0'/);
  assert.match(screen, /await confirmDeviceLogin\(/);
  assert.match(context, /await requestMobileDeviceLogin\(/);
  assert.match(context, /await confirmMobileDeviceLogin\(/);
  assert.doesNotMatch(context, /\bloginAccount\(/);
});
