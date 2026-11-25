import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("el perfil y las changas del cliente incluyen la experiencia y controles pedidos", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const settings = await readFile(new URL("../src/pages/settings.tsx", import.meta.url), "utf8");

  assert.match(app, /data-testid="client-profile-rating"/);
  assert.match(app, /\(0 reseñas\)/);
  assert.match(app, /<AccountPasswordForm account=\{user\} \/>/);
  assert.match(settings, /Verificación en dos pasos por email/);
  assert.match(settings, /\/auth\/security\/two-factor/);
  assert.match(app, /button-edit-job-\$\{job\.id\}/);
  assert.match(app, /button-delete-job-\$\{job\.id\}/);
  assert.match(app, /\/trabajos\/\$\{job\.id\}/, "The editor calls the authenticated job endpoint.");
  assert.match(app, /href="\/home"/, "The Worky brand keeps a route back to the main screen.");
});

test("la bandeja y el chat mantienen una ruta distinta por profesional", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const server = await readFile(new URL("../../api-server/src/routes/worky.ts", import.meta.url), "utf8");

  assert.match(app, /key=\{\`\$\{conversation\.changaId\}-\$\{conversation\.profesionalId/);
  assert.match(app, /hilos\/\$\{threadProfessionalId\}\/mensajes/);
  assert.match(app, /link-chat-professional-profile/);
  assert.match(server, /conversacionProfesionalId: thread\.profesionalId/);
  assert.match(server, /threadMessagesWhere\(changaId, thread\.job\.clienteId, thread\.profesionalId\)/);
});
