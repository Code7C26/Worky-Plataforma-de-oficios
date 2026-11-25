import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("agrupa documentos por perfil y solo permite habilitar después de todas las revisiones", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const globals = ["window", "document", "navigator", "HTMLElement", "React"] as const;
  const previous = globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const name of ["window", "document", "navigator", "HTMLElement"] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
  const React = await import("react");
  Object.defineProperty(globalThis, "React", { configurable: true, value: React });
  const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { middlewareMode: true, hmr: false }, appType: "custom" });
  try {
    const { AdminVerificationQueue } = await vite.ssrLoadModule("/src/pages/admin-verification-queue.tsx");
    const application = {
      partner: { userId: 11, name: "Partner QA", email: "partner@example.test", trade: "Plomería", category: "Plomería", verified: true, enabled: false, accountActive: true, verificationStatus: "verified" },
      emailVerifiedAt: new Date().toISOString(), matriculaHabilitante: null,
      documents: ["dni_frente", "dni_dorso", "antecedentes_penales"].map((tipo, index) => ({
        id: index + 1, tipo, nombre: `${tipo}.pdf`, estado: "verified", sizeBytes: 1000, createdAt: new Date().toISOString(),
      })),
    };
    let opened = 0;
    let approved = 0;
    let rejected = 0;
    let enabled = 0;
    const element = () => React.createElement(AdminVerificationQueue, {
      applications: [application], total: 1, busy: false, docLoading: null, docError: "",
      onOpen: () => opened++, onResolve: (_doc: unknown, status: string) => status === "verified" ? approved++ : rejected++, onEnable: () => enabled++,
    });
    const view = render(element());
    assert.ok(screen.getByTestId("card-application-11"));
    assert.match(screen.getByTestId("document-11-matricula").textContent!, /No adjuntada/);
    assert.equal(screen.getByTestId("button-enable-application-11").hasAttribute("disabled"), false);
    fireEvent.click(screen.getByTestId("button-open-document-1"));
    fireEvent.click(screen.getByTestId("button-enable-application-11"));
    assert.equal(opened, 1); assert.equal(enabled, 1);
    application.documents.push({ ...application.documents[0], id: 4, tipo: "matricula", estado: "pending_verification" });
    view.rerender(element());
    assert.equal(screen.getByTestId("button-enable-application-11").hasAttribute("disabled"), true);
    fireEvent.click(screen.getByTestId("button-approve-document-4"));
    fireEvent.click(screen.getByTestId("button-reject-document-4"));
    assert.equal(approved, 1); assert.equal(rejected, 1);
    application.documents[3].estado = "rejected";
    view.rerender(element());
    assert.equal(screen.getByTestId("button-enable-application-11").hasAttribute("disabled"), true);
    application.documents[3].estado = "verified";
    view.rerender(element());
    assert.equal(screen.getByTestId("button-enable-application-11").hasAttribute("disabled"), false);
    application.documents.splice(0, 1);
    view.rerender(element());
    assert.match(screen.getByTestId("document-11-dni_frente").textContent!, /Sin adjuntar/);
    assert.equal(screen.getByTestId("button-enable-application-11").hasAttribute("disabled"), true);
    application.documents.unshift({ ...application.documents[0], id: 1, tipo: "dni_frente" });
    application.emailVerifiedAt = "";
    view.rerender(element());
    assert.equal(screen.getByTestId("button-enable-application-11").hasAttribute("disabled"), true);
    application.emailVerifiedAt = new Date().toISOString(); application.partner.accountActive = false;
    view.rerender(element());
    assert.equal(screen.getByTestId("button-enable-application-11").hasAttribute("disabled"), true);
  } finally {
    cleanup(); await vite.close(); dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
