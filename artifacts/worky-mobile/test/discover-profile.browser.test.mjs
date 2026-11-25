import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiHost = 'worky-mobile-discover-test.invalid';

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
      EXPO_PUBLIC_DOMAIN: apiHost,
      EXPO_PUBLIC_REPL_ID: 'worky-mobile-discover-browser-test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const collect = (chunk) => { output = `${output}${chunk}`.slice(-12_000); };
  server.stdout.on('data', collect);
  server.stderr.on('data', collect);
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Expo web server exited with ${server.exitCode}:\n${output}`);
    try {
      if ((await fetch(url)).ok) return { server, url };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  server.kill('SIGTERM');
  throw new Error(`Expo web server did not become ready:\n${output}`);
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

test('la búsqueda muestra perfiles habilitados y los controles de perfil quedan accesibles', { timeout: 300_000 }, async () => {
  const expo = await startExpoWebServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 402, height: 874 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    await context.addInitScript(() => {
      localStorage.setItem('worky-mobile-session', 'discover-browser-test-token');
      localStorage.setItem('worky-mobile-saved-accounts', JSON.stringify([{
        token: 'saved-second-account-token',
        account: {
          id: 18,
          nombre: 'Cuenta Secundaria',
          email: 'segunda@example.test',
          rol: 'cliente',
          fotoObjectPath: null,
          username: 'cuenta_dos',
        },
      }]));
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    let currentPhotoPath = '/objects/profile-photos/17/rendered/test.webp';
    let secondAccountPhotoPath = '/objects/profile-photos/18/rendered/test.webp';
    await page.route(`https://${apiHost}/api/v1/**`, async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/api/v1/auth/client-verification') {
        return route.fulfill(json({ status: 'not_requested', submittedAt: null, reviewedAt: null, reasonCode: null }));
      }
      if (pathname === '/api/v1/auth/me') {
        const authorization = route.request().headers().authorization;
        if (authorization === 'Bearer saved-second-account-token') {
          return route.fulfill(json({
            id: 18,
            nombre: 'Cuenta Secundaria',
            email: 'segunda@example.test',
            telefono: null,
            emailVerifiedAt: '2026-11-01T12:00:00.000Z',
            fotoObjectPath: secondAccountPhotoPath,
            username: 'cuenta_dos',
            rol: 'cliente',
          }));
        }
        if (route.request().method() === 'PATCH') {
          const updates = JSON.parse(route.request().postData() ?? '{}');
          return route.fulfill(json({
            id: 17,
            nombre: updates.nombre ?? 'Santiago Romero',
            email: 'santiago@example.test',
            telefono: updates.telefono ?? null,
            emailVerifiedAt: '2026-11-01T12:00:00.000Z',
            fotoObjectPath: currentPhotoPath,
            username: updates.username ?? null,
            rol: 'admin',
          }));
        }
        return route.fulfill(json({
          id: 17,
          nombre: 'Santiago Romero',
          email: 'santiago@example.test',
          telefono: null,
          emailVerifiedAt: '2026-11-01T12:00:00.000Z',
          fotoObjectPath: currentPhotoPath,
          username: null,
          rol: 'admin',
        }));
      }
      if (pathname === '/api/v1/auth/profile-photo' && route.request().method() === 'DELETE') {
        currentPhotoPath = null;
        secondAccountPhotoPath = null;
        return route.fulfill(json({ fotoObjectPath: null }));
      }
      if (pathname === '/api/v1/profesionales') {
        return route.fulfill(json([{
          id: 81,
          usuarioId: 170,
          oficio: 'Plomero',
          categoria: 'Plomería',
          verificado: true,
          estadoVerificacion: 'verified',
          skills: ['Reparaciones'],
          about: 'Atención de instalaciones y reparaciones.',
          experienciaAnios: 6,
          precioReferencia: 15000,
          disponible: true,
          rating: 5,
          cantidadChangas: 3,
          createdAt: '2026-10-01T10:00:00.000Z',
          updatedAt: '2026-11-01T10:00:00.000Z',
          usuario: {
            id: 170,
            nombre: 'Profesional habilitado',
            edad: null,
            fotoObjectPath: null,
            rol: 'profesional',
            ubicacion: null,
            onboardingRespuestas: {},
          },
          reviewsCount: 1,
          completedJobs: 3,
          recommendationsCount: 0,
          distanceKm: null,
        }]));
      }
      if (pathname === '/api/v1/notificaciones/stream') {
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': test\n\n' });
      }
      return route.fulfill(json([]));
    });

    await page.goto(expo.url, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('card-professional-81').waitFor({ state: 'visible', timeout: 30_000 });
    const filters = await page.getByTestId('filter-professional-categories').boundingBox();
    assert.ok(filters && filters.height <= 50, `los filtros de oficio deben ocupar una franja compacta; alto: ${filters?.height}`);
    assert.equal(await page.getByText('1 resultado', { exact: true }).isVisible(), true);

    await page.getByTestId('tab-profile').click();
    await page.getByTestId('button-profile-photo-actions').waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal(await page.getByTestId('profile-photo-section').isVisible(), true);
    assert.equal(await page.getByTestId('profile-rating-summary').getByText('(0)', { exact: true }).isVisible(), true);
    assert.equal(await page.getByText('Administración', { exact: true }).count(), 0, 'no mostrar la etiqueta Administración en el resumen del perfil');

    await page.getByTestId('button-profile-photo-actions').click();
    await page.getByTestId('button-view-profile-photo').waitFor({ state: 'visible' });
    await page.getByTestId('button-change-profile-photo').waitFor({ state: 'visible' });
    await page.getByTestId('button-remove-profile-photo').waitFor({ state: 'visible' });
    await page.getByTestId('button-view-profile-photo').click();
    await page.getByTestId('profile-photo-preview').waitFor({ state: 'visible' });
    await page.getByTestId('button-close-profile-photo-preview').click();

    await page.getByTestId('button-profile-photo-actions').click();
    await page.getByTestId('button-view-profile-photo').waitFor({ state: 'visible' });
    await page.getByTestId('button-cancel-profile-photo-actions').click();

    await page.getByTestId('button-toggle-personal-details').click();
    await page.getByTestId('input-account-name').waitFor({ state: 'visible' });
    await page.getByTestId('input-account-phone').waitFor({ state: 'visible' });
    await page.getByTestId('text-account-email').waitFor({ state: 'visible' });
    await page.getByText('DNI', { exact: true }).waitFor({ state: 'visible' });
    const usernameField = page.getByTestId('input-account-username');
    await page.getByText('Nombre de usuario', { exact: true }).waitFor({ state: 'visible' });
    await usernameField.fill('santiago_worky');
    await page.getByTestId('button-save-account-details').click();
    await page.getByTestId('notice-account-saved').waitFor({ state: 'visible' });
    assert.equal(await usernameField.inputValue(), 'santiago_worky');

    const appearanceBox = await page.getByTestId('theme-mode-section').boundingBox();
    const accountsBox = await page.getByTestId('accounts-section').boundingBox();
    const logoutBox = await page.getByTestId('logout-section').boundingBox();
    assert.ok(appearanceBox && accountsBox && logoutBox && accountsBox.y < appearanceBox.y && appearanceBox.y < logoutBox.y, 'Cuentas debe preceder Apariencia y Cerrar sesión debe quedar debajo');
    await page.getByText('Cuentas', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('button-add-account').count(), 0, 'Agregar cuenta debe quedar dentro del botón desplegable');
    await page.getByTestId('button-toggle-account-management').click();
    await page.getByTestId('account-management-options').waitFor({ state: 'visible' });
    await page.getByText('Cuenta activa', { exact: true }).waitFor({ state: 'visible' });
    await page.getByTestId('button-add-account').waitFor({ state: 'visible' });
    await page.getByTestId('button-switch-account-18').waitFor({ state: 'visible' });
    await page.getByTestId('button-switch-account-18').click();
    await page.getByText('Cuenta Secundaria', { exact: true }).first().waitFor({ state: 'visible' });
    await page.getByTestId('client-identity-verification-card').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('button-submit-client-verification').isDisabled(), true, 'el envío requiere DNI, selfie y consentimiento');
    const savedTokens = await page.evaluate(() => JSON.parse(localStorage.getItem('worky-mobile-saved-accounts') ?? '[]'));
    assert.equal(savedTokens.length, 2, 'cambiar de cuenta debe conservar ambas sesiones');
    assert.equal(await page.evaluate(() => localStorage.getItem('worky-mobile-session')), 'saved-second-account-token');
    await page.getByTestId('button-profile-photo-actions').click();
    await page.getByTestId('button-remove-profile-photo').waitFor({ state: 'visible' });
    await page.getByTestId('button-remove-profile-photo').click();
    await page.getByText('¿Eliminar tu foto?', { exact: true }).waitFor({ state: 'visible' });
    await page.getByTestId('button-confirm-remove-profile-photo').click();
    await page.getByTestId('notice-profile-photo-saved').waitFor({ state: 'visible' });
    await page.getByTestId('button-toggle-account-management').click();
    await page.getByTestId('button-add-account').click();
    await page.getByText('Agregar otra cuenta.', { exact: true }).waitFor({ state: 'visible' });
    assert.deepEqual(pageErrors, []);
    await context.close();
  } finally {
    await browser?.close();
    expo.server.kill('SIGTERM');
  }
});
