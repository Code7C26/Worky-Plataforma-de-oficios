import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiOrigin = 'https://role-switch-test.invalid';

async function getFreePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startExpoWebServer() {
  const port = await getFreePort();
  const server = spawn('pnpm', ['exec', 'expo', 'start', '--web', '--localhost', '--port', String(port)], {
    cwd: mobileRoot,
    env: {
      ...process.env,
      CI: '1',
      EXPO_NO_TELEMETRY: '1',
      EXPO_PUBLIC_DOMAIN: 'role-switch-test.invalid',
      EXPO_PUBLIC_REPL_ID: 'role-switch-browser-test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const collect = (chunk) => {
    output = `${output}${chunk}`.slice(-16000);
  };
  server.stdout.on('data', collect);
  server.stderr.on('data', collect);

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Expo web server exited with ${server.exitCode}:\n${output}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return { server, url, output: () => output };
    } catch {
      // Expo is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  server.kill('SIGTERM');
  throw new Error(`Expo web server did not become ready:\n${output}`);
}

function createApiHarness(page, initialRole) {
  let currentRole = initialRole;
  const queuedSwitches = [];
  const waitingTests = [];
  const requests = [];

  const nextSwitch = () => new Promise((resolve) => {
    const pending = queuedSwitches.shift();
    if (pending) resolve(pending);
    else waitingTests.push(resolve);
  });

  page.route(`${apiOrigin}/api/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(`${request.method()} ${url.pathname}`);

    if (url.pathname === '/api/v1/auth/me' && request.method() === 'GET') {
      await route.fulfill({ json: { id: 'account-1', nombre: 'María', email: 'maria@example.test', telefono: null, fotoObjectPath: null, rol: currentRole } });
      return;
    }

    if (url.pathname === '/api/v1/auth/role' && request.method() === 'PATCH') {
      const { rol } = request.postDataJSON();
      let fulfillResponse;
      const response = new Promise((resolve) => {
        fulfillResponse = resolve;
      });
      const pendingSwitch = {
        role: rol,
        respond: (status = 200) => fulfillResponse(status),
      };
      const resolveTest = waitingTests.shift();
      if (resolveTest) resolveTest(pendingSwitch);
      else queuedSwitches.push(pendingSwitch);

      const status = await response;
      if (status >= 200 && status < 300) currentRole = rol;
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(
          status >= 200 && status < 300
            ? { id: 'account-1', nombre: 'María', email: 'maria@example.test', telefono: null, fotoObjectPath: null, rol }
            : { message: 'No se pudo cambiar el perfil.' },
        ),
      });
      return;
    }

    if (url.pathname === '/api/v1/partner-profile/me' && request.method() === 'GET') {
      await route.fulfill({
        json: {
          id: 'professional-1',
          oficio: 'Plomería',
          categoria: 'Hogar',
          precioReferencia: 0,
          experienciaAnios: 0,
          about: null,
          skills: [],
          disponible: true,
        },
      });
      return;
    }

    await route.fulfill({ json: [] });
  });

  return { nextSwitch, requests };
}

async function captureFocusedElement(page) {
  await page.evaluate(() => {
    window.__workyRoleSwitchFocusSnapshot = document.activeElement;
  });
}

async function focusIsUnchanged(page) {
  return page.evaluate(() => document.activeElement === window.__workyRoleSwitchFocusSnapshot);
}

test('el cambio de perfil web anuncia el éxito polite solo tras confirmar el servidor y conserva el foco', { timeout: 240_000 }, async () => {
  const expo = await startExpoWebServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 400, height: 720 } });
    await context.addInitScript(() => localStorage.setItem('worky-mobile-session', 'browser-test-token'));
    const page = await context.newPage();
    const api = createApiHarness(page, 'cliente');
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(`${expo.url}/profile`);
    const clienteOption = page.getByTestId('button-role-cliente');
    const partnerOption = page.getByTestId('button-role-partner');
    await clienteOption.waitFor({ state: 'visible', timeout: 120_000 });
    const success = page.getByTestId('text-role-switch-success');

    for (const scenario of [
      {
        target: partnerOption,
        role: 'profesional',
        message: 'Ahora usás Worky como Partner. Completá tu perfil para que puedan encontrarte.',
      },
      {
        target: clienteOption,
        role: 'cliente',
        message: 'Ahora usás Worky como Cliente. Tu perfil profesional sigue guardado.',
      },
    ]) {
      await scenario.target.click();
      const pending = await api.nextSwitch();
      assert.equal(pending.role, scenario.role);
      assert.equal(await success.count(), 0, 'el aviso de éxito no debe aparecer antes de la respuesta del servidor');
      await captureFocusedElement(page);

      pending.respond();
      const successShown = await success.waitFor({ state: 'visible' }).then(() => true).catch(() => false);
      if (!successShown) {
        throw new Error([
          `El aviso de éxito no apareció para ${scenario.role}.`,
          `Error visible: ${await page.getByTestId('text-role-switch-error').allInnerTexts().catch(() => [])}`,
          `Contenido: ${(await page.locator('body').innerText()).slice(-2500)}`,
          `Errores de página: ${pageErrors.join('; ')}`,
          `Solicitudes API: ${api.requests.join(', ')}`,
          `Salida de Expo: ${expo.output().slice(-5000)}`,
        ].join('\n'));
      }
      assert.equal(await success.getAttribute('role'), 'status');
      assert.equal(await success.getAttribute('aria-live'), 'polite');
      assert.equal((await success.innerText()).trim(), scenario.message);
      assert.equal(
        await focusIsUnchanged(page),
        true,
        'la aparición del aviso no debe cambiar el foco actual',
      );
      assert.equal(await scenario.target.getAttribute('aria-checked'), 'true');
    }

    await partnerOption.click();
    const failedSwitch = await api.nextSwitch();
    assert.equal(failedSwitch.role, 'profesional');
    assert.equal(await success.count(), 0, 'el aviso anterior debe retirarse al iniciar otro cambio');
    await captureFocusedElement(page);
    failedSwitch.respond(500);

    const error = page.getByTestId('text-role-switch-error');
    await error.waitFor({ state: 'visible' });
    assert.equal(await success.count(), 0, 'un cambio fallido no debe mostrar el anuncio de éxito');
    assert.match((await error.innerText()).trim(), /No pudimos cambiar tu perfil/);
    assert.equal(
      await focusIsUnchanged(page),
      true,
      'el fallo tampoco debe desplazar el foco',
    );
    assert.deepEqual(pageErrors, [], `la pantalla no debe producir errores de JavaScript: ${pageErrors.join('; ')}`);
    await context.close();
  } finally {
    await browser?.close();
    expo.server.kill('SIGTERM');
    await Promise.race([once(expo.server, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (expo.server.exitCode === null) expo.server.kill('SIGKILL');
  }
});