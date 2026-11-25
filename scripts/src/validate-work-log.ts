import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORK_LOG_PATH = "docs/historial-de-cambios-worky.md";
const NEW_ENTRIES_HEADING = /^## 20\. Registro de nuevas entregas\s*$/m;
const REQUIRED_FIELDS = [
  "Resultado",
  "Validación",
  "Evidencia",
  "Estado de publicación",
] as const;

function isPlaceholder(value: string): boolean {
  return /^(?:-|—|\.{3}|todo|tbd|por completar|por definir)$/i.test(value.trim());
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

export function validateWorkLog(content: string): string[] {
  const sectionHeading = NEW_ENTRIES_HEADING.exec(content);
  if (!sectionHeading || sectionHeading.index === undefined) {
    return [
      `No se encontró la sección "## 20. Registro de nuevas entregas" en ${WORK_LOG_PATH}.`,
    ];
  }

  const sectionStart = sectionHeading.index + sectionHeading[0].length;
  const sectionStartLine = content.slice(0, sectionHeading.index).split(/\r?\n/).length + 1;
  const followingSection = content.slice(sectionStart).search(/^##\s/m);
  const section = content.slice(
    sectionStart,
    followingSection === -1 ? undefined : sectionStart + followingSection,
  );
  const lines = section.split(/\r?\n/);
  const entries: { heading: string; line: number; body: string[] }[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^###\s/.test(lines[index])) continue;
    const entry = { heading: lines[index], line: index + 1, body: [] as string[] };
    entries.push(entry);

    for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
      if (/^###\s/.test(lines[bodyIndex]) || /^##\s/.test(lines[bodyIndex])) break;
      entry.body.push(lines[bodyIndex]);
    }
  }

  const errors: string[] = [];
  for (const entry of entries) {
    const dateAndTitle = /^###\s+(\d{4}-\d{2}-\d{2})\s+—\s+(.+?)\s*$/.exec(
      entry.heading,
    );
    const location = `${WORK_LOG_PATH}:${sectionStartLine + entry.line - 1}`;

    if (!dateAndTitle || !isValidDate(dateAndTitle[1]) || !dateAndTitle[2].trim()) {
      errors.push(
        `${location}: la entrada debe tener fecha válida y título: "### AAAA-MM-DD — Título".`,
      );
    }

    for (const field of REQUIRED_FIELDS) {
      const fieldPattern = new RegExp(`^\\s*-\\s*${field}:\\s*(.*?)\\s*$`, "i");
      const values = entry.body.flatMap((line) => {
        const match = fieldPattern.exec(line);
        return match ? [match[1]] : [];
      });

      if (values.length === 0) {
        errors.push(`${location}: falta el campo "${field}".`);
      } else if (values.length > 1) {
        errors.push(`${location}: el campo "${field}" aparece más de una vez.`);
      } else if (!values[0] || isPlaceholder(values[0])) {
        errors.push(`${location}: el campo "${field}" no puede estar vacío ni ser un marcador.`);
      }
    }
  }

  return errors;
}

export function runWorkLogValidation(workspaceRoot: string): number {
  let content: string;
  try {
    content = readFileSync(resolve(workspaceRoot, WORK_LOG_PATH), "utf8");
  } catch {
    console.error(`No se pudo leer ${WORK_LOG_PATH}.`);
    return 1;
  }

  const errors = validateWorkLog(content);
  if (errors.length > 0) {
    console.error(
      [
        `La bitácora no cumple el formato requerido (${WORK_LOG_PATH}):`,
        ...errors.map((error) => `- ${error}`),
        "Cada entrada nueva debe incluir fecha y título, Resultado, Validación, Evidencia y Estado de publicación.",
      ].join("\n"),
    );
    return 1;
  }

  console.log(`Bitácora válida: las entradas nuevas de ${WORK_LOG_PATH} están completas.`);
  return 0;
}

const workspaceRoot = resolve(import.meta.dirname, "../..");
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  process.exitCode = runWorkLogValidation(workspaceRoot);
}
