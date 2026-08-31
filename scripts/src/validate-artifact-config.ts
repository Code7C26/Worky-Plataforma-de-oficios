import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Artifact = {
  name: string;
  viteConfig: string;
  artifactConfig: string;
};

type ConfigValues = {
  port: string;
  basePath: string;
};

export type ValidationResult = {
  artifacts: Artifact[];
  failures: string[];
};

export function discoverArtifacts(workspaceRoot: string): Artifact[] {
  const artifactsRoot = resolve(workspaceRoot, "artifacts");

  return readdirSync(artifactsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        readdirSync(resolve(artifactsRoot, entry.name)).includes("vite.config.ts"),
    )
    .map((entry) => ({
      name: entry.name,
      viteConfig: `artifacts/${entry.name}/vite.config.ts`,
      artifactConfig: `artifacts/${entry.name}/.replit-artifact/artifact.toml`,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function readViteDefaults(workspaceRoot: string, path: string): ConfigValues {
  const source = readFileSync(resolve(workspaceRoot, path), "utf8");
  const port = source.match(
    /const\s+rawPort\s*=\s*process\.env\.PORT\s*\?\?\s*["']([^"']+)["']/,
  )?.[1];
  const basePath = source.match(
    /const\s+basePath\s*=\s*process\.env\.BASE_PATH\s*\?\?\s*["']([^"']+)["']/,
  )?.[1];

  if (port === undefined || basePath === undefined) {
    throw new Error(
      `No se pudieron encontrar los valores por defecto de PORT y BASE_PATH en ${path}.`,
    );
  }

  return { port, basePath };
}

function readServiceValues(
  workspaceRoot: string,
  path: string,
): ConfigValues & { localPort: string } {
  let source: string;
  try {
    source = readFileSync(resolve(workspaceRoot, path), "utf8");
  } catch {
    throw new Error(`No se pudo leer la configuración del servicio ${path}.`);
  }

  const localPort = source.match(/^\s*localPort\s*=\s*(\d+)\s*$/m)?.[1];
  const port = source.match(/^\s*PORT\s*=\s*["']([^"']+)["']\s*$/m)?.[1];
  const basePath = source.match(
    /^\s*BASE_PATH\s*=\s*["']([^"']+)["']\s*$/m,
  )?.[1];

  if (localPort === undefined || port === undefined || basePath === undefined) {
    throw new Error(
      `No se pudieron encontrar localPort, PORT y BASE_PATH en ${path}.`,
    );
  }

  return { localPort, port, basePath };
}

export function validateArtifact(
  workspaceRoot: string,
  artifact: Artifact,
): string[] {
  const vite = readViteDefaults(workspaceRoot, artifact.viteConfig);
  const service = readServiceValues(workspaceRoot, artifact.artifactConfig);
  const errors: string[] = [];

  if (vite.port !== service.port) {
    errors.push(
      `PORT: Vite usa "${vite.port}" por defecto, pero el servicio declara "${service.port}".`,
    );
  }

  if (vite.port !== service.localPort) {
    errors.push(
      `PORT: Vite usa "${vite.port}" por defecto, pero localPort declara "${service.localPort}".`,
    );
  }

  if (vite.basePath !== service.basePath) {
    errors.push(
      `BASE_PATH: Vite usa "${vite.basePath}" por defecto, pero el servicio declara "${service.basePath}".`,
    );
  }

  return errors;
}

export function validateWorkspace(workspaceRoot: string): ValidationResult {
  const artifacts = discoverArtifacts(workspaceRoot);
  const failures: string[] = [];

  for (const artifact of artifacts) {
    try {
      const errors = validateArtifact(workspaceRoot, artifact);
      if (errors.length > 0) {
        failures.push(
          `${artifact.name}:\n${errors.map((error) => `  - ${error}`).join("\n")}`,
        );
      }
    } catch (error) {
      failures.push(
        `${artifact.name}:\n  - ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { artifacts, failures };
}

export function runValidation(workspaceRoot: string): number {
  const result = validateWorkspace(workspaceRoot);
  const failedArtifacts = new Set(
    result.failures.map((failure) => failure.split(":", 1)[0]),
  );

  for (const artifact of result.artifacts) {
    if (!failedArtifacts.has(artifact.name)) {
      console.log(`✓ ${artifact.name}: configuración de Vite y servicio coincide.`);
    }
  }

  if (result.failures.length > 0) {
    console.error(
      [
        "Desajustes de configuración detectados entre Vite y los servicios:",
        ...result.failures,
        "Actualiza vite.config.ts o artifact.toml para que sus valores coincidan.",
      ].join("\n"),
    );
    return 1;
  }

  console.log("Configuración de artefactos válida.");
  return 0;
}

const workspaceRoot = resolve(import.meta.dirname, "../..");
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  process.exitCode = runValidation(workspaceRoot);
}
