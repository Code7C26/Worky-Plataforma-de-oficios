import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("la UI conserva el selector de adjuntos y las tres secciones del Partner", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(source, /data-testid="input-review-files"/);
  assert.match(source, /type="file" multiple accept="image\/\*,\.pdf"/);
  assert.match(source, /setFiles\(Array\.from\(event\.target\.files \|\| \[\]\)\.slice\(0, 6\)\)/);
  assert.match(source, /data-testid=\{`jobs-section-\$\{selected\.key\}`\}/);
  assert.match(source, /title: 'Oportunidades'/);
  assert.match(source, /title: 'En proceso'/);
  assert.match(source, /title: 'Mis trabajos'/);
  assert.match(source, /key: 'completed'.*jobs: assignedJobs\.filter\(\(job\) => job\.status === 'completed'\)/s);
  assert.match(source, /job\.calificada/);
  assert.match(source, /data-testid=\{`text-review-sent-\$\{job\.id\}`\}/);
});