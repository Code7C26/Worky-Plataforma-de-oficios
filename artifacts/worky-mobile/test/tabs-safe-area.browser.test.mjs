import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import pngjs from 'pngjs';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiOrigin = 'https://tabs-safe-area-test.invalid';
const capturesDir = path.join(mobileRoot, 'test-results', 'tabs-safe-area');
const baselinesDir = path.join(capturesDir, 'baselines');
const diffsDir = path.join(capturesDir, 'diffs');
const updateBaselines = process.env.UPDATE_TABS_SAFE_AREA_BASELINES === '1';
const { PNG } = pngjs;
const pixelChannelTolerance = 3;
const allowedRasterizationNoisePixels = 16;
const devices = [
  { platform: 'ios', model: 'small', width: 320, height: 640, scale: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  { platform: 'ios', model: 'common', width: 390, height: 844, scale: 3, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  { platform: 'android', model: 'small', width: 360, height: 720, scale: 2, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36' },
  { platform: 'android', model: 'common', width: 412, height: 915, scale: 2.625, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36' },
];
const tabs = [
  { name: 'index', clientContent: 'input-professional-search', partnerContent: 'Oportunidades cerca tuyo' },
  { name: 'activity', clientContent: 'Tu cuenta', partnerContent: 'Tu operación' },
  { name: 'jobs', clientContent: 'Tu actividad', partnerContent: 'Mis trabajos' },
  { name: 'conversations', clientContent: 'Tus conversaciones de Worky', partnerContent: 'Tus conversaciones de Worky' },
  { name: 'profile', clientContent: 'Perfil y configuración', partnerContent: 'Tu cuenta' },
];
const longListSize = 12;

function createJobFixtures(firstId, role) {
  return Array.from({ length: longListSize }, (_, index) => {
    const id = firstId + index;
    const professional = {
      id: 900 + index,
      nombre: `Profesional de prueba ${String(index + 1).padStart(2, '0')}`,
      email: `profesional-${id}@example.test`,
      telefono: null,
      fotoObjectPath: null,
      rol: 'profesional',
    };
    const client = {
      id: 700 + index,
      nombre: `Cliente de prueba ${String(index + 1).padStart(2, '0')}`,
      email: `cliente-${id}@example.test`,
      telefono: null,
      fotoObjectPath: null,
      rol: 'cliente',
    };

    return {
      id,
      clienteId: client.id,
      profesionalId: role === 'profesional' && firstId === 3000 ? null : professional.id,
      ubicacion: { ciudad: 'Buenos Aires', provincia: 'Buenos Aires' },
      categoria: `Trabajo largo ${String(index + 1).padStart(2, '0')}`,
      precioOfrecido: 25000 + index * 1000,
      detalle: `Descripción de prueba para el trabajo ${String(index + 1).padStart(2, '0')}.`,
      estado: role === 'profesional' && firstId === 3000 ? 'publicada' : 'aceptada',
      createdAt: '2026-10-30T10:00:00.000Z',
      updatedAt: '2026-10-30T10:00:00.000Z',
      cliente: client,
      profesional: role === 'profesional' && firstId === 3000 ? null : professional,
      calificada: false,
    };
  });
}

function createConversationFixtures(role) {
  return Array.from({ length: longListSize }, (_, index) => {
    const id = 4000 + index;
    const participant = {
      id: 500 + index,
      nombre: `Contacto de prueba ${String(index + 1).padStart(2, '0')}`,
      email: `contacto-${id}@example.test`,
      telefono: null,
      fotoObjectPath: null,
      rol: role === 'profesional' ? 'cliente' : 'profesional',
    };

    return {
      changaId: id,
      estado: 'aceptada',
      categoria: `Conversación larga ${String(index + 1).padStart(2, '0')}`,
      detalle: `Detalle de prueba para la conversación ${String(index + 1).padStart(2, '0')}.`,
      updatedAt: '2026-10-30T10:00:00.000Z',
      unread: index % 2,
      interlocutor: participant,
      ultimoMensaje: {
        id: 6000 + index,
        changaId: id,
        emisorId: participant.id,
        texto: `Mensaje de prueba ${String(index + 1).padStart(2, '0')}.`,
        adjuntos: [],
        leido: true,
        createdAt: '2026-10-30T10:00:00.000Z',
        emisor: participant,
      },
    };
  });
}

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
      EXPO_PUBLIC_DOMAIN: 'tabs-safe-area-test.invalid',
      EXPO_PUBLIC_REPL_ID: 'tabs-safe-area-browser-test',
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

function installApiMocks(page, role) {
  const account = {
    id: 'safe-area-account',
    nombre: 'María Pérez',
    email: 'maria@example.test',
    telefono: null,
    fotoObjectPath: null,
    rol: role,
  };
  const profile = {
    id: 'safe-area-professional',
    oficio: 'Plomería',
    categoria: 'Hogar',
    precioReferencia: 0,
    experienciaAnios: 0,
    about: null,
    skills: [],
    disponible: true,
    ubicacionFija: { direccionTexto: 'Calle de prueba 123', ciudad: 'Alta Gracia', provincia: 'Córdoba' },
  };

  return page.route(`${apiOrigin}/api/v1/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/v1/auth/me') return route.fulfill(response(account));
    if (pathname === '/api/v1/partner-profile/me' && route.request().method() === 'PUT') {
      return route.fulfill(response({
        ...profile,
        ...JSON.parse(route.request().postData() ?? '{}'),
        updatedAt: '2026-10-31T10:00:00.000Z',
      }));
    }
    if (pathname === '/api/v1/partner-profile/me') return route.fulfill(response(profile));
    if (pathname === '/api/v1/trabajos/mias') return route.fulfill(response(createJobFixtures(1000, role)));
    if (pathname === '/api/v1/trabajos/asignadas') return route.fulfill(response(createJobFixtures(2000, role)));
    if (pathname === '/api/v1/trabajos/disponibles') return route.fulfill(response(createJobFixtures(3000, role)));
    if (pathname === '/api/v1/conversaciones') return route.fulfill(response(createConversationFixtures(role)));
    if (pathname.includes('/partner/dashboard')) {
      return route.fulfill(response({ trabajos: [], calendario: [], archivos: [], notificacionesNoLeidas: 0 }));
    }
    if (pathname.endsWith('/notificaciones/stream')) {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': safe-area test\n\n' });
    }
    if (pathname.includes('/notificaciones')) return route.fulfill(response({ items: [], unread: 0 }));
    if (pathname.includes('/profesionales')) return route.fulfill(response([]));
    return route.fulfill(response([]));
  });
}

function getFirstContent(page, name, role) {
  const item = tabs.find((tab) => tab.name === name);
  const content = role === 'profesional' ? item.partnerContent : item.clientContent;
  return content.startsWith('input-')
    ? page.getByTestId(content)
    : page.getByText(content, { exact: true }).first();
}

async function waitForStableLayout(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function assertLastRowAccessibleAboveTabBar(page, testId, context) {
  const lastRow = page.getByTestId(testId);
  await lastRow.waitFor({ state: 'visible', timeout: 30_000 });
  const beforeScroll = await lastRow.boundingBox();
  const tabBar = await page.getByTestId('tab-jobs').evaluate((tab) => {
    let element = tab;
    while (element && getComputedStyle(element).position !== 'absolute') element = element.parentElement;
    if (!element) return null;
    const { top, bottom } = element.getBoundingClientRect();
    return { top, bottom };
  });
  assert.ok(beforeScroll && tabBar, `${context}: no se pudo medir la última fila y la navegación fija`);
  assert.ok(
    beforeScroll.y + beforeScroll.height > tabBar.top,
    `${context}: la lista de prueba no requiere desplazamiento hasta su última fila`,
  );

  await lastRow.scrollIntoViewIfNeeded();
  await waitForStableLayout(page);
  const afterScroll = await lastRow.boundingBox();
  assert.ok(afterScroll, `${context}: la última fila no tiene posición visible tras desplazar`);
  assert.ok(afterScroll.y >= 0, `${context}: la última fila queda recortada arriba`);
  assert.ok(
    afterScroll.y + afterScroll.height <= tabBar.top - 4,
    `${context}: la última fila queda debajo de la navegación fija`,
  );
  assert.ok(
    afterScroll.y + afterScroll.height <= page.viewportSize().height,
    `${context}: la última fila queda fuera del viewport`,
  );
}

async function assertProfessionalProfileSaveWithReducedViewport(page, device) {
  await page.setViewportSize({
    width: device.width,
    height: Math.min(420, device.height - 280),
  });

  const skillsField = page.getByTestId('input-professional-skills');
  await skillsField.focus();
  await skillsField.fill('Instalaciones, reparaciones');
  await waitForStableLayout(page);
  assert.equal(
    await skillsField.evaluate((field) => document.activeElement === field),
    true,
    `${device.platform}/${device.model}: el último campo perdió el foco`,
  );

  const profileTab = page.getByTestId('tab-profile');
  const hasTabBar = await profileTab.evaluate((tab) => {
    let element = tab;
    while (element && getComputedStyle(element).position !== 'absolute') element = element.parentElement;
    return Boolean(element);
  });
  assert.ok(hasTabBar, `${device.platform}/${device.model}: no se encontró la navegación inferior`);
  await profileTab.evaluate((tab) => {
    let element = tab;
    while (element && getComputedStyle(element).position !== 'absolute') element = element.parentElement;
    if (element instanceof HTMLElement) element.style.display = 'none';
  });
  const visibleBottom = await page.evaluate(() => window.innerHeight);
  const fieldBox = await skillsField.boundingBox();
  assert.ok(fieldBox, `${device.platform}/${device.model}: el último campo no tiene posición visible`);
  assert.ok(fieldBox.y >= 0, `${device.platform}/${device.model}: el último campo queda recortado arriba`);
  assert.ok(
    fieldBox.y + fieldBox.height <= visibleBottom,
    `${device.platform}/${device.model}: el último campo queda cubierto por la navegación inferior`,
  );

  const saveButton = page.getByTestId('button-save-professional-profile');
  await saveButton.scrollIntoViewIfNeeded();
  await waitForStableLayout(page);
  const saveBox = await saveButton.boundingBox();
  assert.ok(saveBox, `${device.platform}/${device.model}: el botón de guardado no tiene posición visible`);
  assert.ok(
    saveBox.y + saveBox.height <= visibleBottom,
    `${device.platform}/${device.model}: el botón para guardar queda tapado en el viewport reducido`,
  );

  await saveButton.click();
  await page.getByTestId('notice-professional-profile-saved').waitFor({ state: 'visible' });
}

function compareScreenshots(expectedBuffer, actualBuffer) {
  const expected = PNG.sync.read(expectedBuffer);
  const actual = PNG.sync.read(actualBuffer);
  const width = Math.max(expected.width, actual.width);
  const height = Math.max(expected.height, actual.height);
  const gutter = 8;
  const diff = new PNG({ width: width * 3 + gutter * 2, height });
  let changedPixels = 0;
  let maxChannelDelta = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  const copyPixel = (source, x, y, targetX, dim = false) => {
    const targetOffset = (y * diff.width + targetX) * 4;
    if (x >= source.width || y >= source.height) {
      diff.data[targetOffset] = 0;
      diff.data[targetOffset + 1] = 0;
      diff.data[targetOffset + 2] = 0;
      diff.data[targetOffset + 3] = 255;
      return;
    }
    const sourceOffset = (y * source.width + x) * 4;
    const shade = dim ? 0.45 : 1;
    diff.data[targetOffset] = Math.round(source.data[sourceOffset] * shade);
    diff.data[targetOffset + 1] = Math.round(source.data[sourceOffset + 1] * shade);
    diff.data[targetOffset + 2] = Math.round(source.data[sourceOffset + 2] * shade);
    diff.data[targetOffset + 3] = source.data[sourceOffset + 3];
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const expectedExists = x < expected.width && y < expected.height;
      const actualExists = x < actual.width && y < actual.height;
      copyPixel(expected, x, y, x);
      copyPixel(actual, x, y, width + gutter + x);

      let pixelChanged = !expectedExists || !actualExists;
      if (expectedExists && actualExists) {
        const expectedOffset = (y * expected.width + x) * 4;
        const actualOffset = (y * actual.width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          const delta = Math.abs(expected.data[expectedOffset + channel] - actual.data[actualOffset + channel]);
          maxChannelDelta = Math.max(maxChannelDelta, delta);
          if (delta > pixelChannelTolerance) pixelChanged = true;
        }
      }

      const diffOffset = (y * diff.width + width * 2 + gutter * 2 + x) * 4;
      if (pixelChanged) {
        changedPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        diff.data[diffOffset] = 255;
        diff.data[diffOffset + 1] = 32;
        diff.data[diffOffset + 2] = 128;
        diff.data[diffOffset + 3] = 255;
      } else {
        const actualOffset = (y * actual.width + x) * 4;
        diff.data[diffOffset] = Math.round(actual.data[actualOffset] * 0.45);
        diff.data[diffOffset + 1] = Math.round(actual.data[actualOffset + 1] * 0.45);
        diff.data[diffOffset + 2] = Math.round(actual.data[actualOffset + 2] * 0.45);
        diff.data[diffOffset + 3] = actual.data[actualOffset + 3];
      }
    }
  }

  const dimensionsMatch = expected.width === actual.width && expected.height === actual.height;
  const pixelCount = width * height;
  const exceedsNoiseAllowance = changedPixels > allowedRasterizationNoisePixels;
  return {
    diff: PNG.sync.write(diff),
    changedPixels,
    pixelCount,
    changedPercent: (changedPixels / pixelCount) * 100,
    maxChannelDelta,
    dimensionsMatch,
    matches: dimensionsMatch && !exceedsNoiseAllowance,
    bounds: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

function solidPng(width, height, color) {
  const data = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = 255;
  }
  return PNG.sync.write({ width, height, data });
}

test('el comparador distingue capturas iguales y señala cambios relevantes', () => {
  const baseline = solidPng(20, 20, [255, 255, 255]);
  const unchanged = compareScreenshots(baseline, solidPng(20, 20, [255, 255, 255]));
  assert.equal(unchanged.matches, true);
  assert.equal(unchanged.changedPixels, 0);

  const changedImage = PNG.sync.read(baseline);
  for (let y = 4; y < 9; y += 1) {
    for (let x = 6; x < 11; x += 1) {
      const offset = (y * changedImage.width + x) * 4;
      changedImage.data[offset] = 0;
      changedImage.data[offset + 1] = 0;
      changedImage.data[offset + 2] = 0;
    }
  }
  const changed = compareScreenshots(baseline, PNG.sync.write(changedImage));
  assert.equal(changed.matches, false);
  assert.equal(changed.changedPixels, 25);
  assert.deepEqual(changed.bounds, { x: 6, y: 4, width: 5, height: 5 });

  const diff = PNG.sync.read(changed.diff);
  const markedPixel = (4 * diff.width + 20 * 2 + 8 * 2 + 6) * 4;
  assert.deepEqual([...diff.data.subarray(markedPixel, markedPixel + 4)], [255, 32, 128, 255]);
});

test('las cinco pestañas conservan el logo y el primer contenido en pantallas móviles estrechas', { timeout: 300_000 }, async () => {
  const layoutSource = await readFile(path.join(mobileRoot, 'app', '(tabs)', '_layout.tsx'), 'utf8');
  const [discoverSource, activitySource, jobsSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'app', '(tabs)', 'index.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', '(tabs)', 'activity.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', '(tabs)', 'jobs.tsx'), 'utf8'),
  ]);
  assert.match(discoverSource, /placeholder="¿Qué estás buscando\?"/, 'la búsqueda debe invitar a decir qué necesita la persona');
  assert.match(activitySource, /Notificaciones sobre tus trabajos y nuevos mensajes/, 'Actividad debe explicar qué avisos reúne');
  assert.doesNotMatch(jobsSource, /Contanos qué necesitás resolver[\s\S]{0,180}<Feather name="chevron-right"/, 'el acceso para publicar un trabajo no debe mostrar la flecha de la captura');
  assert.match(layoutSource, /<StatusBar style="light"/, 'la barra de estado debe conservar iconos claros sobre la franja azul');
  assert.match(layoutSource, /<View style=\{\[styles\.headerSafeArea, \{ paddingTop: insets\.top, backgroundColor: colors\.secondary \}\]\}>/, 'la franja azul debe cubrir explícitamente el área segura nativa');
  assert.match(layoutSource, /headerContent: \{[\s\S]*height: 56,[\s\S]*flexDirection: 'row',[\s\S]*justifyContent: 'space-between',[\s\S]*paddingHorizontal: 18/, 'la marca debe quedar a la izquierda y el perfil a la derecha');
  assert.match(layoutSource, /<BrandHeader onDark compact onPress=\{\(\) => router\.replace\('\/'\)\} \/>/, 'el logo Worky debe quedar alineado al inicio de la franja azul y volver al inicio');
  assert.match(layoutSource, /<Avatar name=\{account\.nombre\} size=\{36\} photoObjectPath=\{account\.fotoObjectPath\} \/>/, 'el encabezado debe usar la foto del usuario autenticado');
  assert.match(layoutSource, /testID="button-header-profile"/, 'el avatar del encabezado debe ser una acción accesible al perfil');
  assert.match(layoutSource, /headerShown: false,/, 'las pestañas deben dejar el encabezado a cargo de la franja compartida');

  await mkdir(capturesDir, { recursive: true });
  await mkdir(baselinesDir, { recursive: true });
  const expo = await startExpoWebServer();
  let browser;
  const captured = [];
  const visualFailures = [];

  try {
    browser = await chromium.launch({ headless: true });

    for (const device of devices) {
      for (const role of ['cliente', 'profesional']) {
        const context = await browser.newContext({
          viewport: { width: device.width, height: device.height },
          screen: { width: device.width, height: device.height },
          deviceScaleFactor: device.scale,
          isMobile: true,
          hasTouch: true,
          timezoneId: 'UTC',
          userAgent: device.userAgent,
          reducedMotion: 'reduce',
        });
        await context.addInitScript(() => {
          localStorage.setItem('worky-mobile-session', 'safe-area-browser-test-token');
          const RealDate = Date;
          const fixedNow = RealDate.parse('2026-10-30T12:00:00.000Z');
          class FixedDate extends RealDate {
            constructor(...args) {
              super(...(args.length ? args : [fixedNow]));
            }

            static now() {
              return fixedNow;
            }
          }
          globalThis.Date = FixedDate;
        });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await installApiMocks(page, role);

        try {
          await page.goto(`${expo.url}/profile`);
          await page.getByTestId('worky-brand-header').waitFor({ state: 'visible', timeout: 120_000 });
          await page.getByTestId('worky-profile-screen').waitFor({ state: 'visible', timeout: 30_000 });
          const securityDisclosure = page.getByTestId('button-toggle-profile-security');
          await securityDisclosure.waitFor({ state: 'visible', timeout: 30_000 });
          assert.equal(
            await page.getByTestId('button-toggle-two-factor').count(),
            0,
            `${device.platform}/${device.model}/${role}: los ajustes de seguridad deben iniciar contraídos`,
          );
          const themeDescription = page.getByTestId('text-theme-description');
          await themeDescription.waitFor({ state: 'visible', timeout: 30_000 });
          const lightBackground = await page.getByTestId('worky-profile-screen').evaluate(
            (screen) => getComputedStyle(screen).backgroundColor,
          );
          await page.getByTestId('button-toggle-theme').click();
          await page.getByText('Modo oscuro activado. La franja azul se mantiene.', { exact: true }).waitFor({ state: 'visible' });
          const darkBackground = await page.getByTestId('worky-profile-screen').evaluate(
            (screen) => getComputedStyle(screen).backgroundColor,
          );
          assert.notEqual(darkBackground, lightBackground, `${device.platform}/${device.model}/${role}: el botón debe cambiar el fondo a oscuro`);
          await page.getByTestId('button-toggle-theme').click();
          await page.getByText('Usá un fondo oscuro y conservá el azul de Worky.', { exact: true }).waitFor({ state: 'visible' });
          await page.evaluate(() => {
            window.scrollTo(0, 0);
            document.querySelectorAll('*').forEach((element) => {
              if (element.scrollHeight > element.clientHeight) element.scrollTop = 0;
            });
          });
          await page.getByTestId('tab-index').click();
          await getFirstContent(page, 'index', role).waitFor({ state: 'visible', timeout: 30_000 });
          await page.getByTestId('button-header-profile').click();
          await page.getByTestId('tab-profile').waitFor({ state: 'visible', timeout: 30_000 });
          assert.equal(
            await page.getByTestId('tab-profile').getAttribute('aria-selected'),
            'true',
            `${device.platform}/${device.model}/${role}: el avatar del encabezado debe abrir el perfil`,
          );
          await page.getByTestId('tab-index').click();
          await getFirstContent(page, 'index', role).waitFor({ state: 'visible', timeout: 30_000 });
          await page.addStyleTag({
            content: `
              *, *::before, *::after {
                animation-delay: 0s !important;
                animation-duration: 0s !important;
                transition-delay: 0s !important;
                transition-duration: 0s !important;
                scroll-behavior: auto !important;
                caret-color: transparent !important;
              }
            `,
          });

          for (const tab of tabs) {
            await page.getByTestId(`tab-${tab.name}`).click();
            const firstContent = getFirstContent(page, tab.name, role);
            await firstContent.waitFor({ state: 'visible', timeout: 30_000 });
            await waitForStableLayout(page);

            const logo = page.getByTestId('worky-brand-header').last();
            const logoBox = await logo.boundingBox();
            const logoImage = logo.locator('img').first();
            const imageIsLoaded = await logoImage.evaluate((image) => image.complete && image.naturalWidth > 0);
            const contentBox = await firstContent.boundingBox();

            assert.ok(logoBox && logoBox.width > 0 && logoBox.height > 0, `${device.platform}/${device.model}/${role}/${tab.name}: logo fuera de pantalla`);
            assert.ok(imageIsLoaded, `${device.platform}/${device.model}/${role}/${tab.name}: logo no cargó`);
            assert.ok(logoBox.y >= 0, `${device.platform}/${device.model}/${role}/${tab.name}: logo recortado arriba`);
            assert.ok(contentBox && contentBox.height > 0, `${device.platform}/${device.model}/${role}/${tab.name}: primer contenido no visible`);
            assert.ok(
              contentBox.y >= logoBox.y + logoBox.height,
              `${device.platform}/${device.model}/${role}/${tab.name}: el contenido comienza detrás del logo (${JSON.stringify({ logoBox, contentBox })})`,
            );
            assert.ok(
              contentBox.y < device.height,
              `${device.platform}/${device.model}/${role}/${tab.name}: primer contenido queda fuera de la pantalla`,
            );

            const filename = `${device.platform}-${device.model}-${role}-${tab.name}.png`;
            const screenshot = await page.screenshot({
              path: path.join(capturesDir, filename),
              animations: 'disabled',
              caret: 'hide',
              fullPage: false,
            });
            captured.push(filename);

            if (tab.name === 'profile') {
              const securityDisclosure = page.getByTestId('button-toggle-profile-security');
              await securityDisclosure.click();
              await page.getByTestId('button-toggle-two-factor').waitFor({ state: 'visible', timeout: 15_000 });
              await securityDisclosure.click();
              await page.getByTestId('button-toggle-two-factor').waitFor({ state: 'detached', timeout: 15_000 });
            }

            if (tab.name === 'jobs') {
              const lastJobId = role === 'profesional' ? 2011 : 1011;
              await assertLastRowAccessibleAboveTabBar(
                page,
                `card-job-${lastJobId}`,
                `${device.platform}/${device.model}/${role}/trabajos asignados o propios`,
              );
              if (role === 'profesional') {
                await page.getByRole('button', { name: 'Disponibles', exact: true }).click();
                await assertLastRowAccessibleAboveTabBar(
                  page,
                  'card-job-3011',
                  `${device.platform}/${device.model}/${role}/trabajos disponibles`,
                );
              }
            }
            if (tab.name === 'conversations') {
              await page.getByText('Conversación larga 01 – Contacto de prueba 01', { exact: true }).waitFor({ state: 'visible' });
              await assertLastRowAccessibleAboveTabBar(
                page,
                'card-conversation-4011-general',
                `${device.platform}/${device.model}/${role}/conversaciones`,
              );
            }

            const baselinePath = path.join(baselinesDir, filename);
            if (updateBaselines) {
              await writeFile(baselinePath, screenshot);
              continue;
            }

            let baseline;
            try {
              baseline = await readFile(baselinePath);
            } catch (error) {
              if (error.code !== 'ENOENT') throw error;
              visualFailures.push(
                `${filename}: falta la referencia ${path.relative(mobileRoot, baselinePath)}. ` +
                `Créala ejecutando UPDATE_TABS_SAFE_AREA_BASELINES=1 pnpm --filter @workspace/worky-mobile run test:tabs-safe-area.`,
              );
              continue;
            }

            const comparison = compareScreenshots(baseline, screenshot);
            if (!comparison.matches) {
              const diffPath = path.join(diffsDir, filename.replace(/\.png$/, '.diff.png'));
              await mkdir(diffsDir, { recursive: true });
              await writeFile(diffPath, comparison.diff);
              const bounds = comparison.bounds
                ? `; región x=${comparison.bounds.x}, y=${comparison.bounds.y}, ${comparison.bounds.width}×${comparison.bounds.height}`
                : '';
              const dimensions = comparison.dimensionsMatch
                ? ''
                : `; dimensiones esperadas ${PNG.sync.read(baseline).width}×${PNG.sync.read(baseline).height}, actuales ${PNG.sync.read(screenshot).width}×${PNG.sync.read(screenshot).height}`;
              visualFailures.push(
                `${filename}: ${comparison.changedPixels}/${comparison.pixelCount} píxeles distintos ` +
                `(${comparison.changedPercent.toFixed(4)}%; máximo ${comparison.maxChannelDelta} niveles por canal)` +
                `${bounds}${dimensions}. Referencia: ${path.relative(mobileRoot, baselinePath)}; ` +
                `captura: ${path.relative(mobileRoot, path.join(capturesDir, filename))}; ` +
                `comparación lado a lado: ${path.relative(mobileRoot, diffPath)}.`,
              );
            }
          }

          if (role === 'profesional' && device.model === 'small') {
            await page.getByTestId('tab-profile').click();
            await assertProfessionalProfileSaveWithReducedViewport(page, device);
          }

          assert.deepEqual(
            pageErrors,
            [],
            `${device.platform}/${device.model}/${role}: errores de JavaScript: ${pageErrors.join('; ')}`,
          );
        } finally {
          await context.close();
        }
      }
    }

    assert.equal(captured.length, devices.length * 2 * tabs.length, 'debe generarse una captura por pestaña, tamaño y perfil');
    if (updateBaselines) {
      console.log(`Referencias visuales actualizadas: ${path.relative(mobileRoot, baselinesDir)} (${captured.length} imágenes)`);
    } else {
      assert.deepEqual(
        visualFailures,
        [],
        `Las capturas no coinciden con sus referencias (${visualFailures.length} diferencias):\n${visualFailures.join('\n')}`,
      );
      console.log(`Capturas comparadas con referencias: ${path.relative(mobileRoot, capturesDir)} (${captured.length} imágenes)`);
    }
  } catch (error) {
    throw new Error(`${error.message}\nSalida de Expo:\n${expo.output().slice(-5000)}`);
  } finally {
    await browser?.close();
    expo.server.kill('SIGTERM');
    await Promise.race([once(expo.server, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (expo.server.exitCode === null) expo.server.kill('SIGKILL');
  }
});
