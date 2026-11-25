import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("la pantalla de administración permite delegar y reserva el roster al administrador principal", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/admin" });
  const globals = ["window", "document", "navigator", "HTMLElement", "localStorage", "React", "fetch"] as const;
  const previous = globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const name of globals.filter((name) => name !== "React" && name !== "fetch")) {
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const vite = await createServer({
    root,
    configFile: path.join(root, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
  });
  const React = await import("react");
  Object.defineProperty(globalThis, "React", { configurable: true, value: React });
  const { render, screen, waitFor, cleanup, fireEvent } = await import("@testing-library/react");
  let isPrimaryAdmin = true;
  let promoted = false;
  const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const apiPath = url.replace(/^\/api\/v1/, "");
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      calls.push({ path: apiPath, method, body });

      if (apiPath === "/admin/admins" && method === "GET") {
        return Response.json({
          isPrimaryAdmin,
          primaryAdminId: isPrimaryAdmin ? 1 : null,
          items: isPrimaryAdmin
            ? [
                { id: 1, name: "Admin principal QA", email: "principal@example.test", emailVerifiedAt: "2026-10-01T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z" },
                ...(promoted ? [{ id: 2, name: "Cuenta QA", email: "delegado@example.test", emailVerifiedAt: "2026-10-02T00:00:00.000Z", createdAt: "2026-10-02T00:00:00.000Z" }] : []),
              ]
            : [],
        });
      }
      if (apiPath === "/admin/cuentas/rol" && method === "PATCH") {
        promoted = true;
        return Response.json({ rol: "admin", changed: true });
      }
      throw new Error(`Petición inesperada: ${method} ${apiPath}`);
    },
  });

  try {
    const { AdminAdminsPanel } = await vite.ssrLoadModule("/src/pages/admin-admins.tsx");
    const messages: Array<{ type: string; text: string }> = [];
    const element = () => React.createElement(AdminAdminsPanel, {
      onMessage: (type: string, text: string) => messages.push({ type, text }),
    });

    render(element());
    await waitFor(() => assert.ok(screen.getByRole("heading", { name: "Delegar acceso administrador" })));
    fireEvent.change(screen.getByRole("textbox", { name: "Correo de la cuenta" }), { target: { value: "delegado@example.test" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Motivo" }), { target: { value: "Delegación QA aprobada" } });
    fireEvent.click(screen.getByRole("button", { name: "Delegar admin" }));
    await waitFor(() => assert.ok(screen.getByText("delegado@example.test")));
    assert.ok(calls.some((call) => call.path === "/admin/cuentas/rol" && call.method === "PATCH"
      && call.body?.email === "delegado@example.test" && call.body?.motivo === "Delegación QA aprobada"));
    assert.equal(messages.at(-1)?.type, "success");
    assert.ok(screen.getByRole("button", { name: "Quitar rol admin" }));
    cleanup();

    isPrimaryAdmin = false;
    render(element());
    await waitFor(() => assert.ok(screen.getByText("Solo el administrador principal puede delegar o quitar roles admin.")));
    assert.equal(screen.queryByRole("heading", { name: "Delegar acceso administrador" }), null);
    assert.equal(screen.queryByRole("heading", { name: "Administradores actuales" }), null);
    assert.equal(screen.queryByRole("button", { name: "Delegar admin" }), null);
    assert.equal(screen.queryByRole("button", { name: "Quitar rol admin" }), null);
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
