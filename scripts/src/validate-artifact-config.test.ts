import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  discoverArtifacts,
  validateWorkspace,
} from "./validate-artifact-config";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createWorkspace(serviceConfig: string): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "validate-artifact-"));
  temporaryDirectories.push(workspaceRoot);
  const artifactRoot = join(workspaceRoot, "artifacts", "new-vite-artifact");

  await mkdir(join(artifactRoot, ".replit-artifact"), { recursive: true });
  await writeFile(
    join(artifactRoot, "vite.config.ts"),
    [
      'const rawPort = process.env.PORT ?? "4321";',
      'const basePath = process.env.BASE_PATH ?? "/new-artifact";',
    ].join("\n"),
  );
  if (serviceConfig !== "") {
    await writeFile(
      join(artifactRoot, ".replit-artifact", "artifact.toml"),
      serviceConfig,
    );
  }

  return workspaceRoot;
}

const matchingService = `
localPort = 4321
PORT = "4321"
BASE_PATH = "/new-artifact"
`;

describe("validación de configuración de artefactos", () => {
  it("incluye un artefacto Vite nuevo descubierto automáticamente", async () => {
    const workspaceRoot = await createWorkspace(matchingService);

    assert.deepEqual(
      discoverArtifacts(workspaceRoot).map((artifact) => artifact.name),
      ["new-vite-artifact"],
    );
    assert.deepEqual(validateWorkspace(workspaceRoot).failures, []);
  });

  it("falla explícitamente cuando falta artifact.toml", async () => {
    const workspaceRoot = await createWorkspace("");

    const result = validateWorkspace(workspaceRoot);

    assert.match(result.failures.join("\n"), /new-vite-artifact/);
    assert.match(
      result.failures.join("\n"),
      /No se pudo leer la configuración del servicio/,
    );
    assert.match(
      result.failures.join("\n"),
      /\.replit-artifact\/artifact\.toml/,
    );
  });

  it("falla explícitamente cuando los valores están desalineados", async () => {
    const workspaceRoot = await createWorkspace(`
localPort = 9999
PORT = "9999"
BASE_PATH = "/wrong-path"
`);

    const result = validateWorkspace(workspaceRoot);
    const failures = result.failures.join("\n");

    assert.match(failures, /PORT: Vite usa "4321"/);
    assert.match(failures, /BASE_PATH: Vite usa "\/new-artifact"/);
  });
});