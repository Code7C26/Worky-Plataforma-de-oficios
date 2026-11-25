import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiOrigin = 'https://jobs-role-access-test.invalid';

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
      EXPO_PUBLIC_DOMAIN: new URL(apiOrigin).hostname,
      EXPO_PUBLIC_REPL_ID: 'jobs-role-access-browser-test',
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

function response(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

async function installApiMocks(page, role, notificationItems = []) {
  await page.route(`${apiOrigin}/api/v1/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/v1/auth/me') {
      return route.fulfill(response({
        id: `jobs-role-${role}`,
        nombre: 'María Pérez',
        email: 'maria@example.test',
        telefono: null,
        fotoObjectPath: null,
        rol: role,
      }));
    }
    if (pathname === '/api/v1/partner-profile/me') {
      return route.fulfill(response({
        id: 'professional-1',
        oficio: 'Plomería',
        categoria: 'Hogar',
        precioReferencia: 0,
        experienciaAnios: 0,
        about: null,
        skills: [],
        disponible: true,
      }));
    }
    if (pathname.endsWith('/notificaciones/stream')) {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': jobs role test\n\n' });
    }
    if (pathname.endsWith('/notificaciones')) {
      return route.fulfill(response({ items: notificationItems, unread: notificationItems.length }));
    }
    return route.fulfill(response([]));
  });
}

function getColor(source, name) {
  const match = source.match(new RegExp(`\\b${name}:\\s*'(#[0-9a-fA-F]{6})'`));
  assert.ok(match, `Debe existir el token de color ${name}`);
  return match[1];
}

function luminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((channel) => parseInt(channel, 16) / 255);
  const linear = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('el acceso central guía a clientes a publicar y a profesionales a sus changas', { timeout: 300_000 }, async () => {
  const colorsSource = await readFile(path.join(mobileRoot, 'constants', 'colors.ts'), 'utf8');
  const layoutSource = await readFile(path.join(mobileRoot, 'app', '(tabs)', '_layout.tsx'), 'utf8');
  const jobsSource = await readFile(path.join(mobileRoot, 'app', '(tabs)', 'jobs.tsx'), 'utf8');
  const secondary = getColor(colorsSource, 'secondary');
  const secondaryForeground = getColor(colorsSource, 'secondaryForeground');
  const card = getColor(colorsSource, 'card');
  const foreground = getColor(colorsSource, 'foreground');
  const darkPalette = colorsSource.slice(colorsSource.indexOf('  dark: {'));
  const darkForeground = getColor(darkPalette, 'foreground');
  const darkCard = getColor(darkPalette, 'card');

  assert.ok(contrastRatio(secondaryForeground, secondary) >= 4.5, 'el icono central debe contrastar con su fondo azul');
  assert.ok(contrastRatio(foreground, card) >= 4.5, 'la etiqueta de la pestaña central debe contrastar con la superficie clara');
  assert.ok(contrastRatio(darkForeground, darkCard) >= 4.5, 'los textos principales deben contrastar con la superficie oscura');
  assert.match(jobsSource, /trabajo_realizado:\s*'Pago pendiente'/, 'el pago pendiente debe tener una etiqueta clara');
  assert.match(jobsSource, /color: colors\.foreground \}\}>\{statusLabels\[job\.estado\]/, 'el estado del trabajo debe usar texto legible en modo oscuro');
  assert.match(layoutSource, /route\.name === 'jobs' && role === 'profesional'\s*\?\s*'briefcase'/, 'Changas debe conservar el icono de maletín');
  assert.match(layoutSource, /role === 'profesional'\s*\?\s*'Changas\. Ver trabajos asignados y disponibles'/, 'la pestaña profesional debe anunciar sus destinos');
  assert.match(layoutSource, /'Trabajos\. Publicar un trabajo'/, 'la pestaña cliente debe anunciar la acción de publicación');

  const expo = await startExpoWebServer();
  let browser;
  let clientIconMarkup;
  let professionalIconMarkup;
  try {
    browser = await chromium.launch({ headless: true });
    for (const role of ['cliente', 'profesional']) {
      const context = await browser.newContext({
        viewport: { width: 400, height: 720 },
        isMobile: true,
        hasTouch: true,
      });
      await context.addInitScript(() => localStorage.setItem('worky-mobile-session', 'jobs-role-access-test-token'));
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await installApiMocks(page, role);

      try {
        await page.goto(`${expo.url}/profile`);
        await page.getByTestId('worky-brand-header').waitFor({ state: 'visible', timeout: 120_000 });
        if (role === 'cliente') {
          await page.getByTestId('button-toggle-theme').click();
          await page.getByText('Modo oscuro activado. La franja azul se mantiene.', { exact: true }).waitFor({ state: 'visible' });
        }
        const tabLabel = role === 'cliente'
          ? 'Trabajos. Publicar un trabajo'
          : 'Changas. Ver trabajos asignados y disponibles';
        const jobsTab = page.getByRole('tab', { name: tabLabel });
        await jobsTab.waitFor({ state: 'visible', timeout: 30_000 });
        await jobsTab.click();
        assert.equal(await jobsTab.getAttribute('aria-selected'), 'true', `${role}: la pestaña activa debe anunciarse como seleccionada`);
        await page.getByTestId('tab-jobs-icon').waitFor({ state: 'visible' });

        if (role === 'cliente') {
          const publishButton = page.getByTestId('button-new-job');
          await publishButton.waitFor({ state: 'visible' });
          clientIconMarkup = await page.getByTestId('tab-jobs-icon').innerHTML();
          await publishButton.click();
          await page.getByText('Publicá un trabajo', { exact: true }).waitFor({ state: 'visible' });
          await page.getByTestId('input-job-category').waitFor({ state: 'visible' });
          await page.getByTestId('input-job-address').waitFor({ state: 'visible' });
          const formPublishButton = page.getByTestId('button-publish-job');
          const cancelButton = page.getByRole('button', { name: 'Cancelar' });
          const publishBox = await formPublishButton.boundingBox();
          const cancelBox = await cancelButton.boundingBox();
          assert.ok(publishBox && cancelBox, 'las acciones de publicar y cancelar deben estar visibles');
          assert.equal(publishBox.width, cancelBox.width, 'publicar y cancelar deben ocupar el mismo ancho');
          assert.equal(publishBox.height, cancelBox.height, 'publicar y cancelar deben tener la misma altura');
          assert.equal(
            await formPublishButton.evaluate((element) => getComputedStyle(element).backgroundColor),
            'rgb(32, 54, 85)',
            'publicar debe destacar con el azul oscuro de Worky',
          );
          assert.equal(
            await page.getByText('Publicar trabajo', { exact: true }).evaluate((element) => getComputedStyle(element).color),
            'rgb(253, 253, 252)',
            'el texto de publicar debe quedar claro sobre el botón oscuro',
          );
        } else {
          await page.getByText('Mis trabajos', { exact: true }).waitFor({ state: 'visible' });
          await page.getByRole('button', { name: 'Asignados' }).waitFor({ state: 'visible' });
          const availableTab = page.getByRole('button', { name: 'Disponibles' });
          await availableTab.waitFor({ state: 'visible' });
          professionalIconMarkup = await page.getByTestId('tab-jobs-icon').innerHTML();
          assert.equal(await page.getByTestId('button-new-job').count(), 0, 'el perfil profesional no debe mostrar la acción de publicar');
          await availableTab.click();
          await page.getByText('No hay trabajos disponibles', { exact: true }).waitFor({ state: 'visible' });
        }

        assert.deepEqual(pageErrors, [], `${role}: errores de JavaScript: ${pageErrors.join('; ')}`);
      } finally {
        await context.close();
      }
    }
    assert.ok(clientIconMarkup && professionalIconMarkup, 'ambos perfiles deben mostrar un icono en su pestaña central');
    assert.notEqual(clientIconMarkup, professionalIconMarkup, 'el icono de publicar y el maletín deben ser visualmente distintos');
  } catch (error) {
    throw new Error(`${error.message}\nSalida de Expo:\n${expo.output().slice(-5000)}`);
  } finally {
    await browser?.close();
    expo.server.kill('SIGTERM');
    await Promise.race([once(expo.server, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (expo.server.exitCode === null) expo.server.kill('SIGKILL');
  }
});

test('Actividad muestra precio, hora real, Worker y rubro solo en avisos vinculados a una changa', { timeout: 300_000 }, async () => {
  const expo = await startExpoWebServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 400, height: 820 },
      isMobile: true,
      hasTouch: true,
    });
    await context.addInitScript(() => localStorage.setItem('worky-mobile-session', 'jobs-role-access-test-token'));
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await installApiMocks(page, 'cliente', [
      {
        id: 801,
        tipo: 'actividad',
        titulo: 'Pago confirmado',
        detalle: 'Mercado Pago confirmó el cobro.',
        href: '/jobs',
        leida: false,
        createdAt: '2026-11-25T18:00:00.000Z',
        changaId: 412,
        jobContext: {
          changaId: 412,
          price: 18000,
          paymentMethod: 'mercado_pago',
          paymentStatus: 'aprobado',
          paymentConfirmedAt: '2026-11-25T14:35:00',
          workerName: 'María Pérez',
          trade: 'Plomería',
        },
      },
      {
        id: 802,
        tipo: 'actividad',
        titulo: 'Aviso general',
        detalle: 'Este aviso no pertenece a una changa.',
        href: null,
        leida: true,
        createdAt: '2026-11-25T17:00:00.000Z',
        changaId: null,
        jobContext: null,
      },
    ]);

    await page.goto(`${expo.url}/activity`);
    await page.getByTestId('notification-job-context-801').waitFor({ state: 'visible', timeout: 120_000 });
    await page.getByText('Worker: María Pérez', { exact: true }).waitFor({ state: 'visible' });
    await page.getByText('Rubro: Plomería', { exact: true }).waitFor({ state: 'visible' });
    await page.getByText(/Precio de la changa:.*18\.000/).waitFor({ state: 'visible' });
    const jobContextText = await page.getByTestId('notification-job-context-801').innerText();
    assert.match(jobContextText, /Pago de la changa confirmado/, 'el pago aprobado debe aparecer en el detalle');
    assert.match(jobContextText, /\d{1,2}:\d{2}/, 'la confirmación debe mostrar una hora local legible');
    assert.equal(await page.getByTestId('notification-job-context-802').count(), 0, 'los avisos generales conservan su presentación normal');
    assert.deepEqual(pageErrors, []);
    await context.close();
  } finally {
    await browser?.close();
    expo.server.kill('SIGTERM');
  }
});
