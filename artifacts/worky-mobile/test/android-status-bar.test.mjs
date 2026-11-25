import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const capturePath = path.join(mobileRoot, 'test-results', 'android-status-bar', 'capture.png');
const nativeTestEnabled = process.env.WORKY_ANDROID_STATUS_BAR_NATIVE === '1';
const { PNG } = pngjs;

function runAdb(serial, args, { binary = false, timeout = 15_000 } = {}) {
  const result = spawnSync('adb', ['-s', serial, ...args], {
    encoding: binary ? undefined : 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `Falló adb ${args.join(' ')}: ${result.stderr?.toString?.() ?? result.stderr ?? ''}`,
  );
  return binary ? result.stdout : result.stdout.trim();
}

function getEmulatorSerial() {
  const output = spawnSync('adb', ['devices'], { encoding: 'utf8' });
  if (output.error) throw new Error(`No se pudo ejecutar adb: ${output.error.message}`);
  assert.equal(output.status, 0, `adb devices falló: ${output.stderr}`);

  const devices = output.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial);
  const serial = process.env.ANDROID_SERIAL || devices.find((device) => device.startsWith('emulator-'));
  assert.ok(serial && devices.includes(serial), 'Conectá un emulador Android encendido (o indicá ANDROID_SERIAL).');

  const qemu = runAdb(serial, ['shell', 'getprop', 'ro.kernel.qemu']);
  assert.ok(serial.startsWith('emulator-') || qemu === '1', `${serial} no parece ser un emulador Android.`);
  return serial;
}

function getInsetsFrame(dump, insetName, width, height) {
  const lineIndex = dump.split(/\r?\n/).findIndex((line) => line.includes(`mType=${insetName}`));
  assert.notEqual(lineIndex, -1, `Android no informó la barra ${insetName}.`);
  const nearbyLines = dump.split(/\r?\n/).slice(lineIndex, lineIndex + 3).join(' ');
  const frame = /mFrame=\[(\d+),\s*(\d+)\]\[(\d+),\s*(\d+)\]/.exec(nearbyLines);
  assert.ok(frame, `No se pudo leer el área de ${insetName} en los insets de Android.`);
  const [, left, top, right, bottom] = frame.map(Number);
  assert.ok(left >= 0 && top >= 0 && right <= width && bottom <= height && right > left && bottom > top,
    `El área de ${insetName} queda fuera de la captura.`);
  return { left, top, right, bottom };
}

function colorCoverage(image, frame, matches) {
  let matchingPixels = 0;
  const totalPixels = (frame.right - frame.left) * (frame.bottom - frame.top);
  for (let y = frame.top; y < frame.bottom; y += 1) {
    for (let x = frame.left; x < frame.right; x += 1) {
      const offset = (y * image.width + x) * 4;
      if (matches(image.data[offset], image.data[offset + 1], image.data[offset + 2])) {
        matchingPixels += 1;
      }
    }
  }
  return totalPixels ? matchingPixels / totalPixels : 0;
}

function hasNavyPixel(red, green, blue) {
  return blue - red >= 24 && blue - green >= 12 && blue <= 150;
}

function hasWarmPixel(red, green, blue) {
  return red >= 90 && red >= green && green > blue && red - blue <= 36;
}

async function waitForTabs(serial) {
  const deadline = Date.now() + 60_000;
  let hierarchy = '';
  while (Date.now() < deadline) {
    try {
      runAdb(serial, ['shell', 'uiautomator', 'dump', '/sdcard/worky-android-status-bar.xml'], { timeout: 10_000 });
      hierarchy = runAdb(serial, ['exec-out', 'cat', '/sdcard/worky-android-status-bar.xml']);
      const tabsVisible = [
        ['Buscar', 'Inicio'],
        ['Actividad', 'Panel'],
        ['Trabajos', 'Changas'],
        ['Mensajes'],
        ['Perfil', 'Más'],
      ].every((labels) => labels.some((label) => hierarchy.includes(label)));
      if (tabsVisible) return hierarchy;
    } catch {
      // Reintenta mientras Android termina de iniciar la app.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return hierarchy;
}

test('Android conserva azul el encabezado y evita una franja azul bajo las pestañas', async () => {
  const app = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8'));
  const tabs = await readFile(new URL('../app/(tabs)/_layout.tsx', import.meta.url), 'utf8');
  const colors = await readFile(new URL('../constants/colors.ts', import.meta.url), 'utf8');

  assert.equal(app.expo.androidStatusBar.backgroundColor, '#203655');
  assert.equal(app.expo.androidStatusBar.barStyle, 'light-content');
  assert.equal(app.expo.androidStatusBar.translucent, true);
  assert.match(colors, /secondary:\s*'#203655'/);
  assert.match(colors, /background:\s*'#f9f6f0'/);
  assert.match(tabs, /Platform\.OS === 'android'[\s\S]*?SystemUI\.setBackgroundColorAsync\(colors\.background\)/);
  assert.match(tabs, /backgroundColor: colors\.secondary \}\]\}>/);
  assert.match(tabs, /<StatusBar style="light"/);
});

test('el analizador distingue el azul superior del fondo cálido inferior', () => {
  const sample = { width: 2, data: Buffer.from([32, 54, 85, 255, 249, 246, 240, 255]) };
  assert.equal(colorCoverage(sample, { left: 0, top: 0, right: 1, bottom: 1 }, hasNavyPixel), 1);
  assert.equal(colorCoverage(sample, { left: 1, top: 0, right: 2, bottom: 1 }, hasWarmPixel), 1);
  assert.equal(colorCoverage(sample, { left: 0, top: 0, right: 1, bottom: 1 }, hasWarmPixel), 0);
  assert.equal(colorCoverage(sample, { left: 1, top: 0, right: 2, bottom: 1 }, hasNavyPixel), 0);
});

test('emulador Android captura el encabezado, las pestañas y las barras nativas', {
  skip: nativeTestEnabled ? false : 'Usá test:android-status-bar:native para ejecutar la captura en un emulador.',
}, async () => {
  const app = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8'));
  const serial = getEmulatorSerial();
  const packageName = app.expo.android.package;
  assert.ok(runAdb(serial, ['shell', 'pm', 'path', packageName]).includes('package:'),
    `Instalá la APK actual de ${packageName} en el emulador antes de correr esta prueba.`);

  runAdb(serial, ['shell', 'monkey', '-p', packageName, '1']);
  const hierarchy = await waitForTabs(serial);
  await mkdir(path.dirname(capturePath), { recursive: true });
  const screenshot = runAdb(serial, ['exec-out', 'screencap', '-p'], { binary: true, timeout: 20_000 });
  await writeFile(capturePath, screenshot);

  const tabGroups = [
    ['Buscar', 'Inicio'],
    ['Actividad', 'Panel'],
    ['Trabajos', 'Changas'],
    ['Mensajes'],
    ['Perfil', 'Más'],
  ];
  for (const labels of tabGroups) {
    assert.ok(labels.some((label) => hierarchy.includes(label)),
      `No se encontró la pestaña ${labels.join(' / ')}. Abrí Worky con una sesión iniciada; captura: ${path.relative(mobileRoot, capturePath)}.`);
  }

  const image = PNG.sync.read(screenshot);
  const displaySize = runAdb(serial, ['shell', 'wm', 'size']).match(/(\d+)x(\d+)(?![\s\S]*\d+x\d+)/);
  assert.ok(displaySize, 'No se pudo obtener el tamaño de pantalla del emulador.');
  assert.equal(image.width, Number(displaySize[1]), 'La captura no cubre todo el ancho del emulador.');
  assert.equal(image.height, Number(displaySize[2]), 'La captura no cubre toda la altura del emulador.');

  const insets = runAdb(serial, ['shell', 'dumpsys', 'window', 'displays'], { timeout: 20_000 });
  const statusBarFrame = getInsetsFrame(insets, 'statusBars', image.width, image.height);
  const navigationBarFrame = getInsetsFrame(insets, 'navigationBars', image.width, image.height);
  const statusCoverage = colorCoverage(image, statusBarFrame, hasNavyPixel);
  assert.ok(statusCoverage >= 0.65,
    `La barra superior no conserva suficiente azul Worky (cobertura ${Math.round(statusCoverage * 100)} %).`);

  const densityOutput = runAdb(serial, ['shell', 'wm', 'density']);
  const densityMatch = [...densityOutput.matchAll(/density:\s*(\d+)/g)].at(-1);
  assert.ok(densityMatch, 'No se pudo obtener la densidad del emulador.');
  const headerFrame = {
    left: 0,
    top: statusBarFrame.bottom,
    right: image.width,
    bottom: Math.min(image.height, statusBarFrame.bottom + Math.round(56 * Number(densityMatch[1]) / 160)),
  };
  const headerCoverage = colorCoverage(image, headerFrame, hasNavyPixel);
  assert.ok(headerCoverage >= 0.65,
    `El encabezado no conserva suficiente azul Worky (cobertura ${Math.round(headerCoverage * 100)} %).`);

  const warmCoverage = colorCoverage(image, navigationBarFrame, hasWarmPixel);
  assert.ok(warmCoverage >= 0.55,
    `La navegación del sistema no conserva el fondo cálido debajo de la barra flotante (cobertura ${Math.round(warmCoverage * 100)} %).`);

  console.log(`Captura Android guardada en ${path.relative(mobileRoot, capturePath)}; azul superior ${Math.round(statusCoverage * 100)} %, encabezado ${Math.round(headerCoverage * 100)} %, fondo cálido inferior ${Math.round(warmCoverage * 100)} %.`);
});
