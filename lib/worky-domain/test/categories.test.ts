import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkyCategory } from "../src/index";

test("normalizes common names and spelling variants to official categories", () => {
  const cases = [
    ["Albañil", "Albañilería"],
    ["ALBAÑILES", "Albañilería"],
    ["albanileria", "Albañilería"],
    ["plomero", "Plomería"],
    ["fontanera", "Plomería"],
    ["electricista domiciliario", "Electricidad"],
    ["instalador de gas", "Gas"],
    ["Pintor", "Otro"],
  ] as const;

  for (const [input, expected] of cases) {
    assert.equal(resolveWorkyCategory(input)?.category, expected, input);
  }
});

test("preserves trades that are grouped under Otro", () => {
  const result = resolveWorkyCategory("Carpintero");
  assert.equal(result?.category, "Otro");
  assert.equal(result?.preserveOriginalTrade, true);
  assert.equal(result?.original, "Carpintero");
});

test("uses Otro for an unlisted trade while retaining its label", () => {
  const result = resolveWorkyCategory("Colocador de cerámicos");
  assert.equal(result?.category, "Otro");
  assert.equal(result?.preserveOriginalTrade, true);
});

test("rejects missing or non-text input", () => {
  assert.equal(resolveWorkyCategory("  "), null);
  assert.equal(resolveWorkyCategory(null), null);
  assert.equal(resolveWorkyCategory(123), null);
});
