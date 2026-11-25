import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("el profesional espera aprobación, puede corregir documentos y se desbloquea solo al ser habilitado", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/home" });
  const globals = ["window", "document", "navigator", "HTMLElement", "localStorage", "location", "history", "addEventListener", "removeEventListener", "React", "fetch"] as const;
  const previous = globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const name of ["window", "document", "navigator", "HTMLElement", "localStorage", "location", "history"] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
  for (const name of ["addEventListener", "removeEventListener"] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name].bind(dom.window) });
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { middlewareMode: true, hmr: false }, appType: "custom" });
  const React = await import("react");
  Object.defineProperty(globalThis, "React", { configurable: true, value: React });
  const { render, screen, waitFor, cleanup } = await import("@testing-library/react");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  let enabled = false;
  let approved = false;
  let noProfile = false;
  let storedDocuments = [
    { tipo: "dni_frente", nombre: "qa-dni.jpg", estado: "verified" },
    { tipo: "dni_dorso", nombre: "qa-dorso.jpg", estado: "rejected" },
    { tipo: "antecedentes_penales", nombre: "qa-certificado.pdf", estado: "pending_verification" },
  ];
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url: string) => {
    if (url.endsWith("/partner-profile/me")) return Response.json(noProfile ? null : { verificado: approved, habilitado: enabled, estadoVerificacion: approved ? "verified" : "pending_verification" });
    if (url.endsWith("/auth/verification-documents")) return Response.json(storedDocuments);
    throw new Error(`Petición inesperada: ${url}`);
  } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  try {
    const { PartnerApprovalGate } = await vite.ssrLoadModule("/src/components/partner-approval-gate.tsx");
    const element = (allowEditing = false) => React.createElement(QueryClientProvider, { client },
      React.createElement(PartnerApprovalGate, { allowEditing }, React.createElement("p", { "data-testid": "professional-operation" }, "Operación habilitada")));
    render(element());
    await waitFor(() => assert.ok(screen.getByTestId("partner-approval-pending")));
    assert.equal(screen.queryByTestId("professional-operation"), null);
    await waitFor(() => assert.ok(screen.getByLabelText("Reemplazar DNI dorso")));
    assert.equal(screen.queryByLabelText("Reemplazar DNI frente"), null);
    assert.equal(screen.queryByLabelText("Reemplazar Antecedentes penales"), null);
    assert.ok(screen.getByText("Rechazado: reemplazá este documento"));
    assert.ok(screen.getByText("Tus documentos no son públicos.", { exact: false }));
    const allDocuments = storedDocuments.map((doc) => ({ ...doc, estado: "pending_verification" }));
    storedDocuments = allDocuments;
    await client.invalidateQueries();
    await waitFor(() => assert.ok(screen.getByText("Recibimos tus documentos.", { exact: false })));
    assert.equal(screen.queryByLabelText("Reemplazar DNI dorso"), null);
    assert.equal(screen.queryByLabelText("Subir DNI frente"), null);
    assert.equal(screen.queryByLabelText("Subir DNI dorso"), null);
    assert.equal(screen.queryByLabelText("Subir Antecedentes penales"), null);
    assert.equal(screen.queryByTestId("professional-operation"), null);
    storedDocuments = allDocuments.filter((doc) => doc.tipo !== "dni_dorso");
    await client.invalidateQueries();
    await waitFor(() => assert.ok(screen.getByLabelText("Subir DNI dorso")));
    assert.equal(screen.queryByLabelText("Reemplazar DNI frente"), null);
    assert.equal(screen.queryByLabelText("Subir DNI frente"), null);
    storedDocuments = allDocuments.map((doc) => ({ ...doc, estado: "verified" }));
    approved = true;
    await client.invalidateQueries();
    await waitFor(() => assert.ok(screen.getByText("La documentación fue aprobada.", { exact: false })));
    assert.equal(screen.queryByTestId("professional-operation"), null);
    enabled = true;
    await client.invalidateQueries();
    await waitFor(() => assert.ok(screen.getByTestId("professional-operation")));
    assert.equal(screen.queryByTestId("partner-approval-pending"), null);
    cleanup(); client.clear();
    enabled = false; approved = false;
    render(element(true));
    await waitFor(() => assert.ok(screen.getByTestId("partner-approval-pending")));
    assert.equal(screen.queryByTestId("professional-operation"), null, "Un perfil existente no usa funcionalidades profesionales aunque la ruta permita completar el alta");
    cleanup(); client.clear();
    noProfile = true;
    render(element());
    await waitFor(() => assert.ok(screen.getByRole("link", { name: "Completar mi perfil profesional" })));
    assert.equal(screen.queryByTestId("professional-operation"), null);
    cleanup(); client.clear();
    render(element(true));
    await waitFor(() => assert.ok(screen.getByRole("link", { name: "Completar mi perfil profesional" })));
    assert.ok(screen.getByTestId("professional-operation"), "Solo se permite completar el alta cuando todavía no existe el perfil");
  } finally {
    cleanup(); client.clear(); await vite.close(); dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
