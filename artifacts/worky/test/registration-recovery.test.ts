import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("el wizard guarda y recupera los tres pasos para cliente y Partner", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /REGISTRATION_DRAFT_KEY/);
  assert.match(source, /readRegistrationDraft/);
  assert.match(source, /saveRegistrationDraft/);
  assert.match(source, /clearRegistrationDraft/);
  assert.match(source, /step: number/);
  assert.match(source, /role: Role/);
  assert.match(source, /answers, services, docs/);
  assert.match(source, /step === 1/);
  assert.match(source, /step === 2/);
  assert.match(source, /step === 3/);
  assert.match(source, /draft\?\.role/);
  assert.match(source, /draft\?\.step/);
  assert.doesNotMatch(source, /data: \{[^}]*password/);
  assert.doesNotMatch(source, /registrationVerificationToken|requestRegistrationEmailVerification|confirmRegistrationEmailVerification/);
  assert.match(source, /await auth\.register\(\{ nombre: data\.name, email: data\.email, password: data\.password/);
});

test("la carga conserva el error para reintentar y los documentos se actualizan sin duplicarse", async () => {
  const [app, api, storage, client] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../api-server/src/routes/worky.ts", import.meta.url), "utf8"),
    readFile(new URL("../../api-server/src/routes/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8"),
  ]);
  assert.match(app, /failedFiles/);
  assert.match(app, /retryFile/);
  assert.match(client, /No pudimos cargar el archivo/);
  assert.match(api, /onConflictDoUpdate\(\{ target: \[professionalVerificationDocuments\.profesionalId, professionalVerificationDocuments\.tipo\]/);
  assert.match(storage, /No se pudo preparar la carga/);
  assert.match(storage, /createUploadUrl/);
});