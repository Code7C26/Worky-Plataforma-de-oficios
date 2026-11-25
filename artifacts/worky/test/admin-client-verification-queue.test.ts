import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import type { AdminClientIdentityVerification } from "@workspace/api-client-react";

test("la cola de clientes mantiene los documentos privados y exige motivo al rechazar", async () => {
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
    const { AdminClientVerificationQueue } = await vite.ssrLoadModule("/src/pages/admin-client-verification-queue.tsx");
    const application: AdminClientIdentityVerification = {
      id: 81,
      userId: 18,
      name: "Cliente QA",
      email: "cliente@example.test",
      submittedAt: new Date().toISOString(),
      hasDni: true,
      hasSelfie: true,
    };
    const opened: string[] = [];
    const resolved: Array<{ decision: string; reason?: string }> = [];
    const element = () => React.createElement(AdminClientVerificationQueue, {
      applications: [application],
      total: 1,
      busy: false,
      docLoading: null,
      docError: "",
      onOpen: (_application: AdminClientIdentityVerification, kind: string) => opened.push(kind),
      onResolve: (_application: AdminClientIdentityVerification, decision: string, reason?: string) => resolved.push({ decision, reason }),
    });
    render(element());
    assert.match(screen.getByTestId("client-verification-81").textContent ?? "", /cliente@example\.test/);
    assert.equal(screen.getByTestId("button-open-client-verification-81-dni").getAttribute("disabled"), null);
    fireEvent.click(screen.getByTestId("button-open-client-verification-81-dni"));
    assert.deepEqual(opened, ["dni"]);

    fireEvent.click(screen.getByTestId("button-approve-client-verification-81"));
    assert.ok(screen.getByTestId("client-verification-review-dialog"));
    fireEvent.click(screen.getByTestId("button-confirm-client-verification-review"));
    assert.deepEqual(resolved, [{ decision: "verified", reason: undefined }]);

    fireEvent.click(screen.getByTestId("button-reject-client-verification-81"));
    const confirmReject = screen.getByTestId("button-confirm-client-verification-review") as HTMLButtonElement;
    assert.equal(confirmReject.disabled, true);
    fireEvent.change(screen.getByTestId("select-client-verification-rejection-reason"), { target: { value: "dni_unreadable" } });
    assert.equal(confirmReject.disabled, false);
    fireEvent.click(confirmReject);
    assert.deepEqual(resolved[1], { decision: "rejected", reason: "dni_unreadable" });
  } finally {
    cleanup(); await vite.close(); dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
