import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("el acceso admin usa el rol actualizado de la sesión sin solicitar códigos", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/admin" });
  const globals = ["window", "document", "navigator", "HTMLElement", "React"] as const;
  const previous = globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const name of globals.filter((name) => name !== "React")) {
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { middlewareMode: true }, appType: "custom" });
  const React = await import("react");
  Object.defineProperty(globalThis, "React", { configurable: true, value: React });
  const { render, screen, waitFor, cleanup, fireEvent } = await import("@testing-library/react");
  try {
    const { AdminSessionGate } = await vite.ssrLoadModule("/src/components/admin-session-gate.tsx");
    const element = (loadUser: () => Promise<{ rol: string } | null>) => React.createElement(AdminSessionGate, {
      loadUser,
      panel: React.createElement("p", { "data-testid": "panel" }, "Panel admin"),
      activation: React.createElement("p", { "data-testid": "activation" }, "Alta inicial"),
    });
    let confirm!: (value: { rol: string }) => void;
    let reads = 0;
    render(element(() => { reads++; return new Promise((resolve) => { confirm = resolve; }); }));
    assert.ok(screen.getByRole("status"));
    assert.equal(screen.queryByTestId("activation"), null);
    assert.equal(screen.queryByTestId("panel"), null);
    confirm({ rol: "admin" });
    await waitFor(() => assert.ok(screen.getByTestId("panel")));
    assert.equal(screen.queryByTestId("activation"), null);
    assert.equal(reads, 1);
    cleanup();

    // Refreshing an already open session must use the server role, not a local preference.
    render(element(async () => ({ rol: "cliente" })));
    await waitFor(() => assert.ok(screen.getByTestId("activation")));
    assert.equal(screen.queryByTestId("panel"), null);
    cleanup();

    let fail = true;
    render(element(async () => { if (fail) throw new Error("network"); return { rol: "admin" }; }));
    await waitFor(() => assert.ok(screen.getByRole("alert")));
    assert.equal(screen.queryByTestId("activation"), null);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Volver a comprobar" }));
    await waitFor(() => assert.ok(screen.getByTestId("panel")));
    cleanup();

    render(element(async () => null));
    await waitFor(() => assert.ok(screen.getByRole("alert")));
    assert.equal(screen.queryByTestId("panel"), null);
    assert.equal(screen.queryByTestId("activation"), null);
  } finally {
    cleanup();
    await vite.close();
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
