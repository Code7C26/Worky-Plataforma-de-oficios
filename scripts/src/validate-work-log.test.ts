import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateWorkLog } from "./validate-work-log";

const section = `## 20. Registro de nuevas entregas

### 2026-10-26 — Validación del registro
- Resultado: se añadió el comando de comprobación.
- Validación: pnpm run validate:work-log pasó.
- Evidencia: scripts/src/validate-work-log.test.ts.
- Estado de publicación: sin publicar; solo desarrollo.
`;

describe("validación de la bitácora de nuevas entregas", () => {
  it("acepta una entrada completa sin inspeccionar el historial anterior", () => {
    const content = `## 19. Entrada histórica
- La entrada histórica no usa el formato nuevo.

${section}
## Resumen ejecutivo
`;

    assert.deepEqual(validateWorkLog(content), []);
  });

  it("informa de cada campo obligatorio que falta", () => {
    const incomplete = `## 20. Registro de nuevas entregas

### 2026-10-26 — Entrada incompleta
- Resultado: cambio aplicado.
`;

    const errors = validateWorkLog(incomplete).join("\n");

    assert.match(errors, /falta el campo "Validación"/);
    assert.match(errors, /falta el campo "Evidencia"/);
    assert.match(errors, /falta el campo "Estado de publicación"/);
  });

  it("rechaza fechas inválidas, títulos ausentes y campos vacíos", () => {
    const invalid = `## 20. Registro de nuevas entregas

### 2026-02-30 —
- Resultado: ...
- Validación:
- Evidencia: TBD
- Estado de publicación: -
`;

    const errors = validateWorkLog(invalid).join("\n");

    assert.match(errors, /fecha válida y título/);
    assert.match(errors, /"Resultado" no puede estar vacío ni ser un marcador/);
    assert.match(errors, /"Validación" no puede estar vacío ni ser un marcador/);
    assert.match(errors, /"Evidencia" no puede estar vacío ni ser un marcador/);
    assert.match(errors, /"Estado de publicación" no puede estar vacío ni ser un marcador/);
  });

  it("falla con un mensaje claro si no existe la sección destinada a entradas nuevas", () => {
    const errors = validateWorkLog("# Bitácora\n").join("\n");

    assert.match(errors, /No se encontró la sección/);
    assert.match(errors, /historial-de-cambios-worky\.md/);
  });
});
