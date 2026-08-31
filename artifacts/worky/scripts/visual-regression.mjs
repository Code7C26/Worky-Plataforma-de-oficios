import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';
import process from 'node:process';
import { chromium } from 'playwright';

const port = Number(process.env.WORKY_VISUAL_PORT || 22943);
const baseUrl = process.env.WORKY_VISUAL_URL || `http://127.0.0.1:${port}`;
const routes = [
  ['/home', 'home'],
  ['/jobs', 'channas'],
  ['/conversations', 'conversations'],
  ['/profile', 'profile'],
  ['/partner/dashboard', 'dashboard'],
];
const widths = [360, 390, 430, 768, 1024, 1440];
const resultsDir = new URL('../test-results/visual/', import.meta.url).pathname;
const baselinesDir = new URL('../test/visual-baselines/', import.meta.url).pathname;
const diffDir = new URL('../test-results/visual-diff/', import.meta.url).pathname;
const updateBaselines = process.argv.includes('--update-baselines') || process.env.UPDATE_VISUAL_BASELINES === '1';
const profile = {
  id: 7, usuarioId: 42, oficio: 'Electricista', categoria: 'Electricidad',
  rating: 4.8, completedJobs: 32, experienciaAnios: 8, precioReferencia: 12000,
  disponible: true, verificado: true, about: 'Instalaciones y mantenimiento.',
  skills: ['Urgencias', 'Mantenimiento'], reviewsCount: 18, recommendationsCount: 12,
  usuario: { id: 42, nombre: 'Ana Pérez', email: 'ana@example.com', ubicacion: { zona: 'Palermo' } },
};
const user = { id: 42, nombre: 'Ana Pérez', email: 'ana@example.com', rol: 'profesional' };

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

function mockFor(url) {
  const path = new URL(url).pathname;
  if (path.endsWith('/auth/me')) return json(user);
  if (path.endsWith('/partner-profile/me')) return json(profile);
  if (path.includes('/partner/dashboard')) return json({ trabajos: [], calendario: [], archivos: [], notificacionesNoLeidas: 0 });
  if (path.includes('/catalogo/categorias')) return json(['Plomería', 'Electricidad', 'Gas', 'Albañilería', 'Otro']);
  if (/\/profesionales\/\d+$/.test(path)) return json(profile);
  if (path.includes('/profesionales')) return json([profile]);
  if (path.includes('/conversaciones')) return json([]);
  if (path.endsWith('/notificaciones/stream')) return { status: 200, contentType: 'text/event-stream', body: ': visual audit\n\n' };
  if (path.includes('/notificaciones')) return json({ items: [], unread: 0 });
  if (path.includes('/appointments') || path.includes('/turnos')) return json([]);
  if (path.includes('/trabajos') || path.includes('/jobs') || path.includes('/ch changas')) return json([]);
  return json({});
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Worky no inició en ${baseUrl}`);
}

async function stabilizeForScreenshot(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(50);
}

function visible(el) {
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function readPng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('archivo PNG inválido');
  let width;
  let height;
  let colorType;
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || ![2, 6].includes(colorType) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error('PNG no compatible: se requiere RGB/RGBA de 8 bits sin entrelazado');
      }
    } else if (type === 'IDAT') chunks.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const bytesPerPixel = dataColorType(colorType);
  const inputStride = width * bytesPerPixel;
  const pixels = Buffer.alloc(width * height * 4);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset++];
    const row = raw.subarray(sourceOffset, sourceOffset + inputStride);
    sourceOffset += inputStride;
    const previous = y ? pixels.subarray((y - 1) * width * 4, y * width * 4) : null;
    const target = pixels.subarray(y * width * 4, (y + 1) * width * 4);
    const unfiltered = Buffer.alloc(inputStride);
    for (let i = 0; i < inputStride; i += 1) {
      const left = i >= bytesPerPixel ? unfiltered[i - bytesPerPixel] : 0;
      const up = previous ? previous[Math.floor(i / bytesPerPixel) * 4 + (i % bytesPerPixel)] : 0;
      const upperLeft = previous && i >= bytesPerPixel
        ? previous[(Math.floor(i / bytesPerPixel) - 1) * 4 + (i % bytesPerPixel)]
        : 0;
      let value;
      if (filter === 0) value = row[i];
      else if (filter === 1) value = (row[i] + left) & 255;
      else if (filter === 2) value = (row[i] + up) & 255;
      else if (filter === 3) value = (row[i] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const estimate = left + up - upperLeft;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - up);
        const pc = Math.abs(estimate - upperLeft);
        value = (row[i] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft)) & 255;
      } else throw new Error(`PNG usa filtro desconocido ${filter}`);
      unfiltered[i] = filter === 0 ? row[i] : value;
    }
    for (let x = 0; x < width; x += 1) {
      const input = x * bytesPerPixel;
      const output = x * 4;
      target[output] = unfiltered[input];
      target[output + 1] = unfiltered[input + 1];
      target[output + 2] = unfiltered[input + 2];
      target[output + 3] = bytesPerPixel === 4 ? unfiltered[input + 3] : 255;
    }
  }
  return { width, height, pixels };
}

function dataColorType(colorType) {
  if (colorType === 2) return 3;
  if (colorType === 6) return 4;
  throw new Error(`PNG no compatible: tipo de color ${colorType}`);
}

function writePng({ width, height, pixels }) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunk = (type, data) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])), 0);
    return Buffer.concat([header, data, crc]);
  };
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', (() => { const d = Buffer.alloc(13); d.writeUInt32BE(width, 0); d.writeUInt32BE(height, 4); d[8] = 8; d[9] = 6; return d; })()),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function compareImages(actualPath, baselinePath, diffPath) {
  const actual = readPng(await readFile(actualPath));
  const baseline = readPng(await readFile(baselinePath));
  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    return { ok: false, summary: `dimensiones ${actual.width}x${actual.height} vs ${baseline.width}x${baseline.height}` };
  }
  const diff = Buffer.alloc(actual.pixels.length);
  let differentPixels = 0;
  let maxDelta = 0;
  for (let i = 0; i < actual.pixels.length; i += 4) {
    const delta = Math.max(
      Math.abs(actual.pixels[i] - baseline.pixels[i]),
      Math.abs(actual.pixels[i + 1] - baseline.pixels[i + 1]),
      Math.abs(actual.pixels[i + 2] - baseline.pixels[i + 2]),
      Math.abs(actual.pixels[i + 3] - baseline.pixels[i + 3]),
    );
    maxDelta = Math.max(maxDelta, delta);
    if (delta) {
      differentPixels += 1;
      diff[i] = 255; diff[i + 1] = 40; diff[i + 2] = 40; diff[i + 3] = 255;
    }
  }
  if (!differentPixels) return { ok: true };
  await writeFile(diffPath, writePng({ width: actual.width, height: actual.height, pixels: diff }));
  const totalPixels = actual.width * actual.height;
  return {
    ok: false,
    summary: `${differentPixels}/${totalPixels} píxeles distintos (${(differentPixels / totalPixels * 100).toFixed(3)}%), delta máximo ${maxDelta}; diff: ${diffPath}`,
  };
}

const server = spawn('pnpm', ['run', 'dev'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), BASE_PATH: '/' },
  stdio: 'ignore',
});
let browser;
const failures = [];
try {
  await waitForServer();
  await rm(resultsDir, { recursive: true, force: true });
  await rm(diffDir, { recursive: true, force: true });
  await mkdir(resultsDir, { recursive: true });
  await mkdir(diffDir, { recursive: true });
  if (updateBaselines) await mkdir(baselinesDir, { recursive: true });
  browser = await chromium.launch({ headless: true });

  for (const [route, name] of routes) {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      const consoleErrors = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      await page.route('**/api/v1/**', (route) => route.fulfill(mockFor(route.request().url())));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(() => {
        localStorage.setItem('worky-token', 'visual-audit-token');
        localStorage.setItem('worky-role', 'professional');
      });
      try {
        await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
        await stabilizeForScreenshot(page);
        const audit = await page.evaluate(({ width }) => {
          const isVisible = (el) => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };
          const body = document.body;
          const viewport = document.documentElement.clientWidth;
          const overflow = Math.max(document.documentElement.scrollWidth, body.scrollWidth) - viewport;
          const offscreen = [...document.querySelectorAll('body *')].filter((el) => {
            if (!isVisible(el)) return false;
            if (el.closest('.mobile-scroll')) return false;
            if (!el.matches('a,button,input,select,textarea,[role="button"],h1,h2,h3')) return false;
            const rect = el.getBoundingClientRect();
            return (rect.left < -1 && rect.right > 0) || (rect.right > width + 1 && rect.left < width);
          }).slice(0, 8).map((el) => ({ tag: el.tagName, testId: el.getAttribute('data-testid'), right: Math.round(el.getBoundingClientRect().right) }));
          const interactives = [...document.querySelectorAll('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(isVisible);
          return { overflow, offscreen, interactiveCount: interactives.length, heading: document.querySelector('h1,h2')?.textContent?.trim() || '' };
        }, { width });
        const screenshotPath = `${resultsDir}${name}-${width}.png`;
        const baselinePath = `${baselinesDir}${name}-${width}.png`;
        const diffPath = `${diffDir}${name}-${width}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
        if (updateBaselines) {
          await copyFile(screenshotPath, baselinePath);
        } else {
          try {
            const comparison = await compareImages(screenshotPath, baselinePath, diffPath);
            if (!comparison.ok) throw new Error(`cambio visual: ${comparison.summary}`);
          } catch (error) {
            if (error.code === 'ENOENT') {
              throw new Error(`baseline faltante (${baselinePath}); ejecuta pnpm run test:visual:update para aprobarlo`);
            }
            throw error;
          }
        }
        if (!audit.heading) throw new Error('no se encontró un encabezado visible');
        if (audit.overflow > 1) throw new Error(`overflow horizontal de ${audit.overflow}px`);
        if (audit.offscreen.length) throw new Error(`elementos fuera de pantalla: ${JSON.stringify(audit.offscreen)}`);
        if (audit.interactiveCount) {
          await page.keyboard.press('Tab');
          const focusAudit = await page.evaluate(() => {
            const active = document.activeElement;
            if (!active || active === document.body) return { ok: false, element: '' };
            const style = getComputedStyle(active);
            const outline = parseFloat(style.outlineWidth) || 0;
            const shadow = style.boxShadow !== 'none';
            return { ok: outline > 0 || shadow, element: active.getAttribute('data-testid') || active.tagName };
          });
          if (!focusAudit.ok) throw new Error(`foco sin indicador visible en ${focusAudit.element}`);
        }
        if (consoleErrors.length) throw new Error(`errores de consola: ${consoleErrors.join(' | ')}`);
      } catch (error) {
        failures.push(`${route} @ ${width}px: ${error.message}`);
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}

if (failures.length) {
  console.error(`Auditoría visual fallida (${failures.length} casos):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(updateBaselines
  ? `Baselines visuales actualizados: ${routes.length} rutas × ${widths.length} anchos en test/visual-baselines.`
  : `Auditoría visual OK: ${routes.length} rutas × ${widths.length} anchos; no hubo cambios pixel a pixel.`);